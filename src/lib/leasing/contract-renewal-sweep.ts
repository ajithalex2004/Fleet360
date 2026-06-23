import { prisma } from '@/lib/prisma';
import { captureException, captureMessage } from '@/lib/sentry';

export type ContractRenewalBucket = 'EXPIRED' | 'EXPIRING_30D' | 'EXPIRING_60D' | 'EXPIRING_90D';

export interface ContractRenewalHit {
  contractId: string;
  contractNumber: string;
  lesseeName: string;
  expiryDate: Date;
  daysUntilExpiry: number;
  bucket: ContractRenewalBucket;
}

export interface ContractRenewalSweepResult {
  scanned: number;
  hits: ContractRenewalHit[];
  alertsCreated: number;
  alertsSkipped: number;
  statusUpdates: number;
  errors: { contractId: string; message: string }[];
}

function bucketFor(days: number): ContractRenewalBucket | null {
  if (days < 0) return 'EXPIRED';
  if (days <= 30) return 'EXPIRING_30D';
  if (days <= 60) return 'EXPIRING_60D';
  if (days <= 90) return 'EXPIRING_90D';
  return null;
}

function severityFor(bucket: ContractRenewalBucket): 'ERROR' | 'WARNING' | 'INFO' {
  switch (bucket) {
    case 'EXPIRED':
      return 'ERROR';
    case 'EXPIRING_30D':
      return 'WARNING';
    case 'EXPIRING_60D':
    case 'EXPIRING_90D':
      return 'INFO';
    default:
      return 'WARNING';
  }
}

export async function runContractRenewalSweep(opts: { dryRun?: boolean } = {}): Promise<ContractRenewalSweepResult> {
  const dryRun = opts.dryRun ?? false;
  const now = new Date();
  const errors: { contractId: string; message: string }[] = [];
  const hits: ContractRenewalHit[] = [];
  let alertsCreated = 0;
  let alertsSkipped = 0;
  let statusUpdates = 0;

  const contracts = await prisma.leaseContract2.findMany({
    where: {
      deletedAt: null,
      status: { in: ['ACTIVE', 'EXTENDED', 'APPROVED'] },
    },
    select: {
      id: true,
      contractNumber: true,
      endDate: true,
      status: true,
      lesseeId: true,
      renewals: {
        where: { status: { in: ['PROPOSED', 'SENT_TO_CUSTOMER', 'ACCEPTED'] } },
        select: { id: true, status: true },
      },
    },
  });

  const lesseeIds = [...new Set(contracts.map((contract) => contract.lesseeId).filter(Boolean))];
  const lessees = lesseeIds.length
    ? await prisma.lessee.findMany({ where: { id: { in: lesseeIds } }, select: { id: true, name: true } })
    : [];
  const lesseeNames = new Map(lessees.map((lessee) => [lessee.id, lessee.name]));

  for (const contract of contracts) {
    const expiryDate = contract.endDate;
    if (!expiryDate) continue;

    const daysUntilExpiry = Math.ceil((expiryDate.getTime() - now.getTime()) / 86400000);
    const bucket = bucketFor(daysUntilExpiry);
    if (!bucket) continue;
    if ((contract.renewals?.length ?? 0) > 0) continue;

    hits.push({
      contractId: contract.id,
      contractNumber: contract.contractNumber ?? contract.id,
      lesseeName: lesseeNames.get(contract.lesseeId ?? '') ?? 'Unknown Lessee',
      expiryDate,
      daysUntilExpiry,
      bucket,
    });

    if (dryRun) continue;

    try {
      const fingerprint = `contract-renewal:${contract.id}:${bucket}`;
      const existing = await prisma.leaseAlert.findFirst({
        where: {
          alertType: 'CUSTOM',
          status: 'OPEN',
          message: { contains: fingerprint },
        },
      });

      if (existing) {
        alertsSkipped += 1;
        continue;
      }

      await prisma.leaseAlert.create({
        data: {
          contractId: contract.id,
          alertType: 'CUSTOM',
          severity: severityFor(bucket),
          title:
            bucket === 'EXPIRED'
              ? `Contract expired: ${contract.contractNumber ?? contract.id}`
              : `Contract renewal due: ${contract.contractNumber ?? contract.id}`,
          message:
            `${fingerprint}\n` +
            `Contract: ${contract.contractNumber ?? contract.id}\n` +
            `Lessee: ${lesseeNames.get(contract.lesseeId ?? '') ?? 'Unknown Lessee'}\n` +
            `Expiry: ${expiryDate.toISOString().slice(0, 10)} (${daysUntilExpiry >= 0 ? `in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'}` : `${Math.abs(daysUntilExpiry)} day${Math.abs(daysUntilExpiry) === 1 ? '' : 's'} ago`})\n` +
            `Action: open Leasing Renewals and propose a renewal.`,
          status: 'OPEN',
        },
      });
      alertsCreated += 1;

      if (bucket === 'EXPIRED' && contract.status !== 'TERMINATED') {
        statusUpdates += 0;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ contractId: contract.id, message });
      captureException(err, { context: 'leasing.contract-renewal-sweep', tags: { contractId: contract.id, bucket } });
    }
  }

  if (alertsCreated > 0) {
    captureMessage(`Contract renewal sweep: ${alertsCreated} new alert(s)`, {
      level: 'info',
      context: 'leasing.contract-renewal-sweep',
      extra: { scanned: contracts.length, hits: hits.length, alertsSkipped },
    });
  }

  return {
    scanned: contracts.length,
    hits,
    alertsCreated,
    alertsSkipped,
    statusUpdates,
    errors,
  };
}
