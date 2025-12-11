-- CreateEnum
CREATE TYPE "MaintenanceStatus" AS ENUM ('REQUESTED', 'ACCEPTED', 'REJECTED', 'RE_ASSIGN', 'UNDER_ESTIMATION', 'PENDING_ESTIMATION_APPROVAL', 'ESTIMATION_APPROVED', 'UNDER_MAINTENANCE', 'MAINTENANCE_COMPLETED', 'PENDING_INVOICE', 'INVOICE_SUBMITTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('PREVENTIVE_MAINTENANCE', 'REGISTRATION_RENEWAL', 'LICENSE_RENEWAL', 'PERMIT_RENEWAL', 'OTHER');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('PENDING', 'ACKNOWLEDGED', 'ASSIGNED', 'ESCALATED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "MaintenanceType" AS ENUM ('PREVENTIVE', 'CORRECTIVE', 'EMERGENCY', 'INSPECTION');

-- CreateEnum
CREATE TYPE "MaintenancePriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AttachmentType" AS ENUM ('INVOICE', 'REPORT', 'IMAGE', 'QUOTATION', 'WORK_ORDER', 'ESTIMATE', 'APPROVED_ESTIMATE', 'OTHER');

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'ON_HOLD', 'QUALITY_CHECK', 'COMPLETED', 'INVOICE_SUBMITTED');

-- CreateEnum
CREATE TYPE "PartSource" AS ENUM ('STOCK', 'ORDERED', 'CUSTOMER_SUPPLIED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'OVERDUE');

-- CreateEnum
CREATE TYPE "InvoiceCategory" AS ENUM ('LABOR', 'PARTS', 'SERVICE', 'OTHER');

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "licensePlate" TEXT NOT NULL,
    "vin" TEXT NOT NULL,
    "currentMileage" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "registrationExpiry" TIMESTAMP(3) NOT NULL,
    "insuranceExpiry" TIMESTAMP(3) NOT NULL,
    "registrationLastRenewed" TIMESTAMP(3),
    "insuranceLastRenewed" TIMESTAMP(3),

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Driver" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "licenseNumber" TEXT NOT NULL,
    "licenseExpiry" TIMESTAMP(3) NOT NULL,
    "contactNumber" TEXT NOT NULL,
    "email" TEXT,
    "licenseLastRenewed" TIMESTAMP(3),
    "assignedVehicleId" TEXT,

    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Garage" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "contactPerson" TEXT NOT NULL,
    "designation" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "contactNumber" TEXT NOT NULL,
    "specialties" TEXT[],
    "isInternal" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Garage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceRequest" (
    "id" TEXT NOT NULL,
    "readableId" TEXT NOT NULL,
    "requestDate" TIMESTAMP(3) NOT NULL,
    "expectedEndDate" TIMESTAMP(3),
    "description" TEXT NOT NULL,
    "status" "MaintenanceStatus" NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "garageId" TEXT,
    "maintenanceType" "MaintenanceType",
    "priority" "MaintenancePriority",
    "estimatedCost" DOUBLE PRECISION,
    "actualCost" DOUBLE PRECISION,

    CONSTRAINT "MaintenanceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestId" TEXT NOT NULL,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusHistory" (
    "id" TEXT NOT NULL,
    "status" "MaintenanceStatus" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "actor" TEXT,
    "requestId" TEXT NOT NULL,

    CONSTRAINT "StatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quotation" (
    "id" TEXT NOT NULL,
    "quotationDate" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "laborCost" DOUBLE PRECISION NOT NULL,
    "partsCost" DOUBLE PRECISION NOT NULL,
    "consumablesCost" DOUBLE PRECISION NOT NULL,
    "vatAmount" DOUBLE PRECISION NOT NULL,
    "totalCost" DOUBLE PRECISION NOT NULL,
    "grandTotal" DOUBLE PRECISION NOT NULL,
    "estimatedDuration" INTEGER NOT NULL,
    "status" "QuotationStatus" NOT NULL,
    "submittedBy" TEXT NOT NULL,
    "notes" TEXT,
    "requestId" TEXT NOT NULL,
    "garageId" TEXT NOT NULL,

    CONSTRAINT "Quotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationPart" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "totalPrice" DOUBLE PRECISION NOT NULL,
    "quotationId" TEXT NOT NULL,

    CONSTRAINT "QuotationPart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationLabor" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL,
    "ratePerHour" DOUBLE PRECISION NOT NULL,
    "totalPrice" DOUBLE PRECISION NOT NULL,
    "quotationId" TEXT NOT NULL,

    CONSTRAINT "QuotationLabor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrder" (
    "id" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "estimatedCompletionDate" TIMESTAMP(3) NOT NULL,
    "actualCompletionDate" TIMESTAMP(3),
    "totalLaborHours" DOUBLE PRECISION NOT NULL,
    "status" "WorkOrderStatus" NOT NULL,
    "requestId" TEXT NOT NULL,
    "garageId" TEXT NOT NULL,

    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkLog" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "technicianName" TEXT NOT NULL,
    "activity" TEXT NOT NULL,
    "hoursSpent" DOUBLE PRECISION NOT NULL,
    "notes" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,

    CONSTRAINT "WorkLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartUsage" (
    "id" TEXT NOT NULL,
    "partName" TEXT NOT NULL,
    "quantityUsed" INTEGER NOT NULL,
    "unitCost" DOUBLE PRECISION NOT NULL,
    "totalCost" DOUBLE PRECISION NOT NULL,
    "source" "PartSource" NOT NULL,
    "workOrderId" TEXT NOT NULL,

    CONSTRAINT "PartUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistItem" (
    "id" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "workOrderId" TEXT NOT NULL,

    CONSTRAINT "ChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "laborCost" DOUBLE PRECISION NOT NULL,
    "partsCost" DOUBLE PRECISION NOT NULL,
    "taxAmount" DOUBLE PRECISION NOT NULL,
    "discountAmount" DOUBLE PRECISION NOT NULL,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "paidAmount" DOUBLE PRECISION NOT NULL,
    "paymentStatus" "PaymentStatus" NOT NULL,
    "paymentDate" TIMESTAMP(3),
    "requestId" TEXT NOT NULL,
    "garageId" TEXT NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLineItem" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "totalPrice" DOUBLE PRECISION NOT NULL,
    "category" "InvoiceCategory" NOT NULL,
    "invoiceId" TEXT NOT NULL,

    CONSTRAINT "InvoiceLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "type" "AlertType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "dateCreated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ActionStatus" NOT NULL,
    "assignedTo" TEXT,
    "vehicleId" TEXT,
    "driverId" TEXT,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertConfig" (
    "id" TEXT NOT NULL,
    "alertFor" TEXT NOT NULL,
    "alertType" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "frequencyValue" INTEGER NOT NULL,
    "thresholdValue" INTEGER NOT NULL,
    "notificationEnabled" BOOLEAN NOT NULL,
    "whatsappEnabled" BOOLEAN NOT NULL DEFAULT false,
    "assignedIds" TEXT[],

    CONSTRAINT "AlertConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceSchedule" (
    "id" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL,
    "intervalMonths" INTEGER NOT NULL,
    "intervalMileage" INTEGER NOT NULL,
    "lastServiceDate" TIMESTAMP(3) NOT NULL,
    "lastServiceMileage" INTEGER NOT NULL,
    "nextServiceDate" TIMESTAMP(3) NOT NULL,
    "nextServiceMileage" INTEGER NOT NULL,
    "vehicleId" TEXT NOT NULL,

    CONSTRAINT "ServiceSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "type" "AttachmentType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestId" TEXT,
    "quotationId" TEXT,
    "workOrderId" TEXT,
    "invoiceId" TEXT,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_licensePlate_key" ON "Vehicle"("licensePlate");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_vin_key" ON "Vehicle"("vin");

-- CreateIndex
CREATE UNIQUE INDEX "Driver_licenseNumber_key" ON "Driver"("licenseNumber");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceRequest_readableId_key" ON "MaintenanceRequest"("readableId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_requestId_key" ON "WorkOrder"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_requestId_key" ON "Invoice"("requestId");

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_assignedVehicleId_fkey" FOREIGN KEY ("assignedVehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRequest" ADD CONSTRAINT "MaintenanceRequest_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRequest" ADD CONSTRAINT "MaintenanceRequest_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRequest" ADD CONSTRAINT "MaintenanceRequest_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "MaintenanceRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusHistory" ADD CONSTRAINT "StatusHistory_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "MaintenanceRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "MaintenanceRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationPart" ADD CONSTRAINT "QuotationPart_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationLabor" ADD CONSTRAINT "QuotationLabor_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "MaintenanceRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkLog" ADD CONSTRAINT "WorkLog_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartUsage" ADD CONSTRAINT "PartUsage_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "MaintenanceRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceSchedule" ADD CONSTRAINT "ServiceSchedule_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "MaintenanceRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
