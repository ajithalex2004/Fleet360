/**
 * Fleet360 Auto-Populator & Record Linking Engine
 * ------------------------------------------------
 * Automatically applies extracted document intelligence to Fleet360 database records
 * (Vehicles, Drivers, Invoices, Maintenance, Shipments).
 */

import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { DocumentExtractionResult } from '../types';
import { stagedRecordKind } from './review-fields';

export interface AutoPopulateResult {
  success: boolean;
  /** Waiting in the review queue: nothing was written (review-fields.ts). */
  staged?: boolean;
  linkedEntityType: 'VEHICLE' | 'DRIVER' | 'INVOICE' | 'WORK_ORDER' | 'SHIPMENT' | 'NONE';
  linkedEntityId?: string;
  fieldsUpdated: string[];
  message: string;
}

export async function autoPopulateFleet360Record(
  tenantId: string,
  extraction: DocumentExtractionResult
): Promise<AutoPopulateResult> {
  const { docCategory, vehicle, driver, expiryDate, referenceNumber } = extraction;
  const fieldsUpdated: string[] = [];

  // 0. Invoices, quotations, job cards and proofs of delivery create
  //    financial or operational records, so they always wait for a person
  //    to check the extracted fields and approve (staged-records.ts writes
  //    the record then). They used to return success with an invented id
  //    (INV- / WO- / POD- + timestamp) and write nothing. Checked first: an
  //    invoice that mentions a plate used to fall into the vehicle branch.
  const kind = stagedRecordKind(docCategory);
  if (kind) {
    const what = { PAYABLE: 'a Finance payable', WORK_ORDER: 'a maintenance work order', POD: 'a proof of delivery on the drayage job', QUOTATION: 'no record (quotations are reviewed only)' }[kind];
    return {
      success: false,
      staged: true,
      linkedEntityType: 'NONE',
      fieldsUpdated: [],
      message: `Waiting for review: check the extracted fields (${referenceNumber || 'no reference'}) and approve to create ${what}.`,
    };
  }

  // 1. Handle Vehicle Updates (Mulkiya, Registration, Insurance, Inspection)
  if (
    docCategory === 'REGISTRATION_CARD' ||
    docCategory === 'INSURANCE_POLICY' ||
    docCategory === 'INSPECTION_SHEET' ||
    vehicle?.vin ||
    vehicle?.licensePlate
  ) {
    // Find matching vehicle by VIN or License Plate
    const matchedVehicle = await prisma.vehicle.findFirst({
      where: {
        tenantId,
        OR: [
          ...(vehicle?.vin ? [{ vin: vehicle.vin }] : []),
          ...(vehicle?.licensePlate ? [{ licensePlate: vehicle.licensePlate }] : []),
        ],
      },
    }).catch(() => null);

    if (matchedVehicle) {
      const updatePayload: Prisma.VehicleUpdateInput = { updatedAt: new Date() };

      if (expiryDate) {
        const expDateObj = new Date(expiryDate);
        if (docCategory === 'REGISTRATION_CARD') {
          updatePayload.mulkiyaExpiry = expDateObj;
          updatePayload.registrationExpiry = expDateObj;
          fieldsUpdated.push('mulkiyaExpiry', 'registrationExpiry');
        } else if (docCategory === 'INSURANCE_POLICY') {
          updatePayload.insuranceExpiry = expDateObj;
          fieldsUpdated.push('insuranceExpiry');
        }
      }

      if (vehicle?.make && !matchedVehicle.make) {
        updatePayload.make = vehicle.make;
        fieldsUpdated.push('make');
      }
      if (vehicle?.model && !matchedVehicle.model) {
        updatePayload.model = vehicle.model;
        fieldsUpdated.push('model');
      }

      await prisma.vehicle.update({
        where: { id: matchedVehicle.id },
        data: updatePayload,
      }).catch((e) => console.warn('[AutoPopulator] Vehicle update skipped:', e));

      return {
        success: true,
        linkedEntityType: 'VEHICLE',
        linkedEntityId: matchedVehicle.id,
        fieldsUpdated,
        message: `Updated Vehicle (${matchedVehicle.licensePlate || matchedVehicle.vin}) with ${fieldsUpdated.join(', ')}.`,
      };
    } else {
      return {
        success: false,
        linkedEntityType: 'VEHICLE',
        fieldsUpdated: [],
        message: `Vehicle not found in Fleet360 database (Plate: ${vehicle?.licensePlate || vehicle?.plateNumber || 'N/A'}, VIN: ${vehicle?.vin || 'N/A'}). Staged in vault for review.`,
      };
    }
  }

  // 2. Handle Driver Updates (Driving License, Emirates ID)
  if (docCategory === 'DRIVER_LICENSE' || driver?.licenseNumber) {
    const matchedDriver = await prisma.driver.findFirst({
      where: {
        tenantId,
        OR: [
          ...(driver?.licenseNumber ? [{ licenseNumber: driver.licenseNumber }] : []),
          ...(driver?.fullNameEn ? [{ name: { contains: driver.fullNameEn, mode: 'insensitive' as Prisma.QueryMode } }] : []),
          ...(driver?.driverName ? [{ name: { contains: driver.driverName, mode: 'insensitive' as Prisma.QueryMode } }] : []),
        ],
      },
    }).catch(() => null);

    if (matchedDriver) {
      const updatePayload: Prisma.DriverUpdateInput = { updatedAt: new Date() };

      if (expiryDate) {
        updatePayload.licenseExpiry = new Date(expiryDate);
        fieldsUpdated.push('licenseExpiry');
      }
      if (driver?.licenseNumber && !matchedDriver.licenseNumber) {
        updatePayload.licenseNumber = driver.licenseNumber;
        fieldsUpdated.push('licenseNumber');
      }

      await prisma.driver.update({
        where: { id: matchedDriver.id },
        data: updatePayload,
      }).catch((e) => console.warn('[AutoPopulator] Driver update skipped:', e));

      return {
        success: true,
        linkedEntityType: 'DRIVER',
        linkedEntityId: matchedDriver.id,
        fieldsUpdated,
        message: `Updated Driver (${matchedDriver.name || matchedDriver.licenseNumber}) with ${fieldsUpdated.join(', ')}.`,
      };
    } else {
      return {
        success: false,
        linkedEntityType: 'DRIVER',
        fieldsUpdated: [],
        message: `Driver not found in Fleet360 database (License: ${driver?.licenseNumber || 'N/A'}). Staged in vault for review.`,
      };
    }
  }

  return {
    success: true,
    linkedEntityType: 'NONE',
    fieldsUpdated: ['extractedEntities'],
    message: 'Extracted document records saved to Document Intelligence vault.',
  };
}
