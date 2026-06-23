import { prisma } from '@/lib/prisma';
import { buildLesseeDisplayName } from '@/lib/leasing-lessee-display';

export type LeasingDocumentEntityType = 'CONTRACT' | 'LESSEE' | 'QUOTATION' | 'VEHICLE';

export type LeasingDocumentEntityOption = {
  id: string;
  label: string;
  secondaryLabel?: string | null;
  status?: string | null;
};

type LeaseContractOptionRecord = {
  id: string;
  contractNumber?: string | null;
  lesseeId?: string | null;
  status?: string | null;
};

const leaseContractRepo = (prisma as unknown as {
  leaseContract2: {
    findMany(args: unknown): Promise<LeaseContractOptionRecord[]>;
  };
}).leaseContract2;

export async function getLeasingDocumentEntityOptions() {
  const [lessees, quotations, contracts] = await Promise.all([
    prisma.lessee.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, type: true },
      orderBy: { name: 'asc' },
    }),
    prisma.leaseQuotation.findMany({
      where: { deletedAt: null },
      include: { lessee: true, inquiry: true },
      orderBy: { createdAt: 'desc' },
    }),
    leaseContractRepo.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const lesseeNameMap = new Map(lessees.map((lessee) => [lessee.id, lessee.name]));

  const contractOptions: LeasingDocumentEntityOption[] = contracts.map((contract) => ({
    id: contract.id,
    label: contract.contractNumber ?? contract.id,
    secondaryLabel: contract.lesseeId ? lesseeNameMap.get(contract.lesseeId) ?? contract.lesseeId : null,
    status: contract.status ?? null,
  }));

  const lesseeOptions: LeasingDocumentEntityOption[] = lessees.map((lessee) => ({
    id: lessee.id,
    label: lessee.name,
    secondaryLabel: lessee.type,
  }));

  const quotationOptions: LeasingDocumentEntityOption[] = quotations.map((quotation) => ({
    id: quotation.id,
    label: quotation.quotationNumber ?? quotation.id,
    secondaryLabel: buildLesseeDisplayName(quotation),
    status: quotation.status ?? null,
  }));

  return {
    CONTRACT: contractOptions,
    LESSEE: lesseeOptions,
    QUOTATION: quotationOptions,
    VEHICLE: [],
  } satisfies Record<LeasingDocumentEntityType, LeasingDocumentEntityOption[]>;
}
