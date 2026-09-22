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
import type { AlertSubjectType } from '@/events/contracts/alert.events';

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
      // AlertSubjectType (events/contracts/alert.events) only covers the
      // bus-ops/fleet domain today (TripSchedule/Vehicle/Driver/...); the
      // Exchange module's own subject kinds (see marketplace-service.ts for
      // the established pattern) aren't represented. Widening that union is
      // a cross-cutting decision beyond this file, so this stays a narrow
      // cast rather than a silent `any`.
      subjectType: 'OutsourceException' as unknown as AlertSubjectType,
      subjectId: exception.id,
      title: `🚨 Outsource Exception: ${input.type.replace(/_/g, ' ')} (${exception.partner.legalName})`,
      description: input.description,
      severity: input.severity === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
      actor: input.raisedBy,
    });

    await logAudit({
      tenantId: input.tenantId,
      entityType: 'OutsourceException',
      entityId: exception.id,
      action: 'CREATE',
      details: `Raised ${input.type} exception (severity ${input.severity || 'HIGH'})${input.awardId ? ` for award ${input.awardId}` : ''}`,
      userId: input.raisedBy,
    });

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

    await logAudit({
      tenantId,
      entityType: 'OutsourceException',
      entityId: exceptionId,
      action: 'UPDATE',
      details: 'Exception acknowledged',
      userId: actor,
    });

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

    await logAudit({
      tenantId: input.tenantId,
      entityType: 'OutsourceException',
      entityId: exception.id,
      action: 'UPDATE',
      details: `Exception resolved${input.replacementResource ? ' with resource replacement' : ''}. Notes: ${input.resolutionNotes}`,
      userId: input.resolvedBy,
    });

    return {
      exception: updated,
      replacement: replacementResult,
    };
  }
}
