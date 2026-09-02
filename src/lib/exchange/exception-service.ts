/**
 * src/lib/exchange/exception-service.ts
 *
 * Phase 2.5: Exception Management & Resolution Bridge for Fleet360 Exchange.
 * Handles operational breakdowns, driver/vehicle no-shows, late arrivals, accidents, and resource substitutions.
 */

import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { raiseAlert } from '@/lib/alerts/raise';
import { OutsourceExceptionType, OutsourceExceptionStatus } from '@prisma/client';
import { OutsourceEngine } from '@/lib/exchange/outsource-engine';

export interface RaiseExceptionInput {
  tenantId: string;
  partnerId: string;
  awardId?: string;
  assignmentId?: string;
  type: OutsourceExceptionType;
  severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  description: string;
  raisedBy: string;
}

export interface ResolveExceptionInput {
  exceptionId: string;
  tenantId: string;
  resolutionNotes: string;
  resolvedBy: string;
  replacementResource?: {
    vehiclePlate: string;
    driverName: string;
    driverPhone: string;
    replacedReason: string;
  };
}

export class ExceptionService {
  /**
   * Raise an operational exception on an outsourced trip
   */
  static async raiseException(input: RaiseExceptionInput) {
    const exception = await prisma.outsourceException.create({
      data: {
        tenantId: input.tenantId,
        partnerId: input.partnerId,
        awardId: input.awardId,
        assignmentId: input.assignmentId,
        type: input.type,
        status: OutsourceExceptionStatus.RAISED,
        severity: input.severity || 'HIGH',
        description: input.description,
        raisedBy: input.raisedBy,
      },
      include: {
        partner: true,
        award: true,
      },
    });

    // Alert enterprise dispatch
    await raiseAlert({
      tenantId: input.tenantId,
      code: 'OUTSOURCE_EXCEPTION_RAISED',
      sourceModule: 'exchange',
      subjectType: 'OutsourceException' as any,
      subjectId: exception.id,
      title: `🚨 Outsource Exception: ${input.type.replace(/_/g, ' ')} (${exception.partner.legalName})`,
      description: input.description,
      severity: input.severity === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
      actor: input.raisedBy,
    });

    await logAudit(
      prisma,
      input.tenantId,
      'OutsourceException',
      exception.id,
      'CREATE',
      { type: input.type, severity: input.severity || 'HIGH', awardId: input.awardId },
      input.raisedBy
    );

    return exception;
  }

  /**
   * Acknowledge an exception
   */
  static async acknowledgeException(
    exceptionId: string,
    tenantId: string,
    actor: string
  ) {
    const updated = await prisma.outsourceException.update({
      where: { id: exceptionId, tenantId },
      data: { status: OutsourceExceptionStatus.ACKNOWLEDGED },
    });

    await logAudit(
      prisma,
      tenantId,
      'OutsourceException',
      exceptionId,
      'UPDATE',
      { action: 'ACKNOWLEDGED' },
      actor
    );

    return updated;
  }

  /**
   * Resolve an exception and execute resource replacement if provided
   */
  static async resolveException(input: ResolveExceptionInput) {
    const exception = await prisma.outsourceException.findUnique({
      where: { id: input.exceptionId, tenantId: input.tenantId },
      include: { award: true },
    });

    if (!exception) throw new Error('Exception not found');

    let replacementResult = null;
    if (input.replacementResource && exception.awardId) {
      replacementResult = await OutsourceEngine.replaceResource({
        awardId: exception.awardId,
        partnerId: exception.partnerId,
        vehiclePlate: input.replacementResource.vehiclePlate,
        driverName: input.replacementResource.driverName,
        driverPhone: input.replacementResource.driverPhone,
        replacedReason: input.replacementResource.replacedReason || `Resolved from Exception: ${exception.type}`,
        actorUserId: input.resolvedBy,
      });
    }

    const updated = await prisma.outsourceException.update({
      where: { id: exception.id },
      data: {
        status: OutsourceExceptionStatus.RESOLVED,
        resolutionNotes: input.resolutionNotes,
        resolvedAt: new Date(),
        resolvedBy: input.resolvedBy,
      },
    });

    await logAudit(
      prisma,
      input.tenantId,
      'OutsourceException',
      exception.id,
      'UPDATE',
      {
        action: 'RESOLVED',
        resolutionNotes: input.resolutionNotes,
        replacedResource: !!input.replacementResource,
      },
      input.resolvedBy
    );

    return {
      exception: updated,
      replacement: replacementResult,
    };
  }
}
