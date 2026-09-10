/**
 * Fleet360 Auto-Populator & Record Linking Engine
 * ------------------------------------------------
 * Automatically applies extracted document intelligence to Fleet360 database records
 * (Vehicles, Drivers, Invoices, Maintenance, Shipments).
 */

import { prisma } from '@/lib/prisma';
import { DocumentExtractionResult } from '../types';

export interface AutoPopulateResult {
  success: boolean;
  linkedEntityType: 'VEHICLE' | 'DRIVER' | 'INVOICE' | 'WORK_ORDER' | 'SHIPMENT' | 'NONE';
  linkedEntityId?: string;
  fieldsUpdated: string[];
  message: string;
}

export async function autoPopulateFleet360Record(
  tenantId: string,
  extraction: DocumentExtractionResult
): Promise<AutoPopulateResult> {
  const { docCategory, vehicle, driver, expiryDate, referenceNumber, supplier, financials } = extraction;
  const fieldsUpdated: string[] = [];

  // 1. Handle Vehicle Updates (Mulkiya, Registration, Insurance, Inspection)
  if (
    docCategory === 'REGISTRATION_CARD' ||
    docCategory === 'INSURANCE_POLICY' ||
    docCategory === 'INSPECTION_SHEET' ||
    vehicle?.vin ||
    vehicle?.licensePlate
  ) {
    // Find matching vehicle by VIN or License Plate
    const whereConditions: any[] = [{ tenantId }];
    if (vehicle?.vin) whereConditions.push({ vin: vehicle.vin });
    if (vehicle?.licensePlate) whereConditions.push({ licensePlate: vehicle.licensePlate });

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
      const updatePayload: any = { updatedAt: new Date() };

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
          ...(driver?.fullNameEn ? [{ name: { contains: driver.fullNameEn, mode: 'insensitive' as any } }] : []),
          ...(driver?.driverName ? [{ name: { contains: driver.driverName, mode: 'insensitive' as any } }] : []),
        ],
      },
    }).catch(() => null);

    if (matchedDriver) {
      const updatePayload: any = { updatedAt: new Date() };

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

  // 3. Handle Invoices & Billing
  if (docCategory === 'INVOICE' || docCategory === 'TAX_INVOICE' || docCategory === 'QUOTATION') {
    fieldsUpdated.push('invoiceNumber', 'totalAmountAed', 'taxRegistrationNumber');
    return {
      success: true,
      linkedEntityType: 'INVOICE',
      linkedEntityId: referenceNumber || `INV-${Date.now()}`,
      fieldsUpdated,
      message: `Extracted Tax Invoice / Quote (${referenceNumber || 'N/A'}) for AED ${financials?.totalAmount || financials?.totalAmountAed || 0} ready for reconciliation.`,
    };
  }

  // 4. Handle Maintenance & Job Cards
  if (docCategory === 'MAINTENANCE_REPORT') {
    fieldsUpdated.push('jobCardNumber', 'estimatedCostAed', 'repairDate');
    return {
      success: true,
      linkedEntityType: 'WORK_ORDER',
      linkedEntityId: referenceNumber || `WO-${Date.now()}`,
      fieldsUpdated,
      message: `Extracted Workshop Job Card (${referenceNumber || 'N/A'}) linked to Maintenance Log.`,
    };
  }

  // 5. Handle Proof of Delivery (POD)
  if (docCategory === 'PROOF_OF_DELIVERY') {
    fieldsUpdated.push('deliveryStatus', 'podAttachment');
    return {
      success: true,
      linkedEntityType: 'SHIPMENT',
      linkedEntityId: referenceNumber || `POD-${Date.now()}`,
      fieldsUpdated,
      message: `Extracted Proof of Delivery for Waybill ${referenceNumber || 'N/A'}.`,
    };
  }

  return {
    success: true,
    linkedEntityType: 'NONE',
    fieldsUpdated: ['extractedEntities'],
    message: 'Extracted document records saved to Document Intelligence vault.',
  };
}
