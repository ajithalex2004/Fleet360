export enum MaintenanceStatus {
    SUBMITTED = 'Submitted',
    REQUESTED = 'Requested',
    ACCEPTED = 'Accepted',
    REJECTED = 'Rejected',
    PENDING_OPERATIONS_ACK = 'Pending Operations Ack',
    PENDING_MAINTENANCE_APPROVAL = 'Pending Maintenance Approval',
    REJECTED_BY_MAINTENANCE = 'Rejected By Maintenance',
    RE_ASSIGN = 'Re-Assign',
    UNDER_ESTIMATION = 'Under Estimation',
    PENDING_ESTIMATION_APPROVAL = 'Pending Estimation Approval',
    ESTIMATION_APPROVED = 'Estimation Approved',
    UNDER_MAINTENANCE = 'Under Maintenance',
    MAINTENANCE_COMPLETED = 'Maintenance Completed',
    PENDING_INVOICE = 'Pending Invoice',
    INVOICE_SUBMITTED = 'Invoice Submitted',
    CLOSED = 'Closed',
    COMPLETED = 'Completed',
}


export enum AlertSeverity {
    LOW = 'LOW',
    MEDIUM = 'MEDIUM',
    HIGH = 'HIGH',
    CRITICAL = 'CRITICAL',
}

export enum AlertType {
    PREVENTIVE_MAINTENANCE = 'PREVENTIVE_MAINTENANCE',
    REGISTRATION_RENEWAL = 'REGISTRATION_RENEWAL',
    LICENSE_RENEWAL = 'LICENSE_RENEWAL',
    PERMIT_RENEWAL = 'PERMIT_RENEWAL',
    OTHER = 'OTHER',
}

export enum ActionStatus {
    PENDING = 'PENDING',
    ACKNOWLEDGED = 'ACKNOWLEDGED',
    ASSIGNED = 'ASSIGNED',
    ESCALATED = 'ESCALATED',
    RESOLVED = 'RESOLVED',
}

export enum MaintenanceType {
    PREVENTIVE = 'PREVENTIVE',
    CORRECTIVE = 'CORRECTIVE',
    EMERGENCY = 'EMERGENCY',
    INSPECTION = 'INSPECTION',
}

export enum MaintenancePriority {
    LOW = 'LOW',
    MEDIUM = 'MEDIUM',
    HIGH = 'HIGH',
    CRITICAL = 'CRITICAL',
}

export type MaintenancePriorityValue = MaintenancePriority | 'Low' | 'Medium' | 'High' | 'Critical';

export enum AttachmentType {
    INVOICE = 'INVOICE',
    REPORT = 'REPORT',
    IMAGE = 'IMAGE',
    QUOTATION = 'QUOTATION',
    WORK_ORDER = 'WORK_ORDER',
    ESTIMATE = 'ESTIMATE',
    APPROVED_ESTIMATE = 'APPROVED_ESTIMATE',
    OTHER = 'OTHER',
}

// Quotation Management
export enum QuotationStatus {
    PENDING = 'PENDING',
    ACCEPTED = 'ACCEPTED',
    APPROVED = 'APPROVED',
    REJECTED = 'REJECTED',
    EXPIRED = 'EXPIRED',
}

// Approval Workflow
export enum ApprovalStatus {
    PENDING = 'Pending Approval',
    APPROVED = 'Approved',
    REJECTED = 'Rejected',
    ESCALATED = 'Escalated',
}

export enum ApproverRole {
    FLEET_MANAGER = 'Fleet Manager',
    FINANCE_MANAGER = 'Finance Manager',
    OPERATIONS_HEAD = 'Operations Head',
    MAINTENANCE_MANAGER = 'Maintenance Manager',
}

// Work Order
export enum WorkOrderStatus {
    NOT_STARTED = 'Not Started',
    IN_PROGRESS = 'In Progress',
    ON_HOLD = 'On Hold',
    QUALITY_CHECK = 'Quality Check',
    COMPLETED = 'Completed',
    SUBMIT_INVOICE = 'Invoice Submitted',
}

export enum PartSource {
    STOCK = 'Stock',
    ORDERED = 'Ordered',
    ORDERED_KEY = 'ORDERED',
    CUSTOMER_SUPPLIED = 'Customer Supplied',
}

export type PartSourceValue = PartSource | 'ORDERED';

// Invoice
export enum PaymentStatus {
    UNPAID = 'Unpaid',
    PARTIALLY_PAID = 'Partially Paid',
    PAID = 'Paid',
    OVERDUE = 'Overdue',
}

export enum InvoiceCategory {
    LABOR = 'Labor',
    PARTS = 'Parts',
    SERVICE = 'Service',
    OTHER = 'Other',
}

export interface Attachment {
    id: string;
    type: AttachmentType;
    fileName: string;
    url: string;
    uploadedAt: string;
}

export interface Vehicle {
    id: string;
    make: string;
    model: string;
    type: string; // e.g., Sedan, SUV, Truck, Van
    year: number;
    licensePlate: string;
    vin: string;
    currentMileage: number;
    status: 'Active' | 'Inactive' | 'In Service';
    registrationExpiry: string; // ISO Date
    insuranceExpiry: string; // ISO Date
    registrationLastRenewed?: string; // ISO Date
    insuranceLastRenewed?: string; // ISO Date

    // Extended Fields
    registrationNumber?: string;
    deviceId?: string;
    hierarchy?: string;
    vehicleGroup?: string;
    vehicleClass?: string;
    vehicleUsage?: string;
    simCardNumber?: string;
    emirate?: string;
    plateCategory?: string;
    plateCode?: string;
    chassisNumber?: string;
    color?: string;
    fuelType?: string;
    transmissionType?: string;
    passengerCapacity?: number;
}

export interface Driver {
    id: string;
    name: string;
    licenseNumber: string;
    licenseExpiry: string; // ISO Date
    assignedVehicleId?: string;
    contactNumber: string;
    email?: string;
    licenseLastRenewed?: string; // ISO Date
    hierarchy?: string;
    driverType?: string;
    nationality?: string;
    dob?: string;
    emiratesId?: string;
    communicationLanguage?: string;
    dateOfJoin?: string;
    dallasId?: string;
}

export interface Garage {
    id: string;
    name: string;
    location: string;
    contactPerson: string;
    designation: string;
    email: string;
    contactNumber: string;
    specialties: string[];
    services?: MaintenanceType[];
    isInternal: boolean;
    isExternal?: boolean;
}

export interface MaintenanceRequest {
    id: string;
    readableId?: string;
    vehicleId: string;
    vehicle?: Vehicle;
    driverId: string;
    requestDate: string; // ISO Date / Start Date
    expectedEndDate?: string; // ISO Date
    expectedCompletionDate?: string; // ISO Date
    description: string;
    status: MaintenanceStatus;

    // New Fields
    odometer?: number;
    garageId?: string;
    candidateGarageIds?: string[]; // For RFQ
    maintenanceType?: MaintenanceType;
    priority?: MaintenancePriorityValue;
    maintenanceJobs?: string[];
    workOrderNo?: string;
    attachments?: Attachment[];

    estimatedCost?: number;
    actualCost?: number;
    actualPartsCost?: number; // Cost of parts used
    actualLaborCost?: number; // Labor charges
    actualOtherCost?: number; // Miscellaneous costs
    actualCosts?: ActualCosts; // Structured breakdown — persisted as JSON in actualCostsData column
    currency?: 'AED';
    scheduledDate?: string; // ISO Date
    completionDate?: string; // ISO Date
    comments: Comment[];

    // Work-order execution payload — page-side rich types; the schema
    // stores each as JSON-serialized text via raw SQL (work_log,
    // parts_used, checklist_items, assigned_technicians columns).
    workLog?: WorkLogEntry[];
    partsUsed?: PartUsage[];
    checklistItems?: ChecklistItem[];
    assignedTechnicians?: Technician[];

    // Status Timeline
    statusTimeline?: Partial<Record<MaintenanceStatus, string>>; // ISO Date for each status
    history?: {
        status: MaintenanceStatus;
        date: string;
        note?: string;
        actor?: string;
    }[];

    // Advanced Features - Phase 1-5
    quotations?: Quotation[]; // All quotations received
    selectedQuotationId?: string; // Accepted quotation
    approvalRecords?: ApprovalRecord[]; // Approval history
    currentApprovalStatus?: ApprovalStatus;
    workOrderId?: string; // Link to work order
    invoiceId?: string; // Link to invoice
    driverFeedbackId?: string; // Link to driver feedback

    // Calculated fields
    downtimeHours?: number; // Auto-calculated
    costVariance?: number; // Actual vs Estimated
}

export interface Comment {
    id: string;
    author: string;
    text: string;
    timestamp: string;
}

export interface Alert {
    id: string;
    type: AlertType;
    title: string;
    description: string;
    severity: AlertSeverity;
    dateCreated: string; // ISO Date
    relatedEntityId?: string; // VehicleID, DriverID, etc.
    status: ActionStatus;
    assignedTo?: string;
    assignedDate?: string; // ISO Date
    assignmentNote?: string;
}

export interface ServiceSchedule {
    id: string;
    vehicleId: string;
    serviceType: string;
    intervalMonths: number;
    intervalMileage: number;
    lastServiceDate: string;
    lastServiceMileage: number;
    nextServiceDate: string;
    nextServiceMileage: number;
}

// ============================================
// QUOTATION MANAGEMENT
// ============================================

export interface PartItem {
    id: string;
    name: string;
    partNumber?: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
}

export interface LaborItem {
    id: string;
    description: string;
    hours: number;
    ratePerHour: number;
    totalPrice: number;
}

export interface Quotation {
    id: string;
    requestId: string;
    garageId: string;
    garageName: string;
    quotationDate?: string;
    submittedDate?: string;
    validUntil: string;
    laborCost: number;
    partsCost: number;
    totalCost: number; // Subtotal (Parts + Labor)
    currency?: 'AED';
    parts?: PartItem[];
    labor?: LaborItem[];
    consumablesCost?: number;
    vatAmount?: number;
    grandTotal?: number;
    estimatedDuration: number; // hours
    estimatedCompletionDate?: string; // ISO Date
    notes?: string;
    status: QuotationStatus;
    submittedBy?: string;
    attachments?: Attachment[];
    partsBreakdown?: PartItem[];
    revision?: number;
}

// ============================================
// APPROVAL WORKFLOW
// ============================================

export interface ApprovalRecord {
    id: string;
    requestId: string;
    approverRole: ApproverRole;
    approverName: string;
    approverEmail: string;
    requestedAt: string;
    respondedAt?: string;
    status: ApprovalStatus;
    comments?: string;
    estimatedCost?: number;
}

export interface ApprovalRule {
    id: string;
    name: string;
    minCost: number;
    maxCost: number;
    requiredApprovers: ApproverRole[];
    autoApprove: boolean;
    escalationDays?: number;
}

// ============================================
// WORK ORDER TRACKING
// ============================================

export interface Technician {
    id: string;
    name: string;
    specialization: string[];
    certifications: string[];
    garageId: string;
}

export interface WorkLogEntry {
    id: string;
    timestamp: string;
    technicianId: string;
    technicianName: string;
    activity: string;
    hoursSpent: number;
    notes: string;
    photos?: string[];
}

export interface PartUsage {
    id: string;
    partId: string;
    partName: string;
    partNumber?: string;
    quantityUsed: number;
    unitCost: number;
    totalCost: number;
    source: PartSourceValue;
}

export interface ChecklistItem {
    id: string;
    task: string;
    category?: string;
    completed: boolean;
    completedBy?: string;
    completedAt?: string;
    notes?: string;
}

export interface ActualCosts {
    parts: number;
    labor: number;
    other: number;
    total: number;
}

export interface WorkOrder {
    id: string;
    /** Human-readable WO number, e.g. "WO-241001". Falls back to id when absent. */
    workOrderNo?: string;
    requestId: string;
    garageId: string;
    quotationId?: string;
    assignedTechnicians: Technician[];
    startDate: string;
    estimatedCompletionDate: string;
    actualCompletionDate?: string;
    workLog: WorkLogEntry[];
    partsUsed: PartUsage[];
    totalLaborHours: number;
    status: WorkOrderStatus;
    checklistItems: ChecklistItem[];
    qualityCheckPassed?: boolean;
    qualityCheckNotes?: string;
    actualCosts?: ActualCosts;
    invoiceAttachments?: Attachment[];
}

// ============================================
// INVOICE & COST MANAGEMENT
// ============================================

export interface InvoiceLineItem {
    id: string;
    description: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    category: InvoiceCategory;
}

export interface Invoice {
    id: string;
    invoiceNumber: string;
    requestId: string;
    workOrderId: string;
    garageId: string;
    invoiceDate: string;
    dueDate: string;
    laborCost: number;
    partsCost: number;
    taxAmount: number;
    discountAmount: number;
    totalAmount: number;
    paidAmount: number;
    currency?: 'AED';
    paymentStatus: PaymentStatus;
    paymentDate?: string;
    lineItems: InvoiceLineItem[];
    attachments: Attachment[];
    notes?: string;
}

export interface Budget {
    id: string;
    name: string;
    period: 'Monthly' | 'Quarterly' | 'Yearly';
    startDate: string;
    endDate: string;
    allocatedAmount: number;
    spentAmount: number;
    remainingAmount: number;
    category?: MaintenanceType;
    vehicleType?: string;
}

// ============================================
// VEHICLE HISTORY & ANALYTICS
// ============================================

export interface RecurringIssue {
    issue: string;
    category: string;
    occurrences: number;
    lastOccurrence: string;
    averageCost: number;
    requestIds: string[];
}

export interface VehicleHistory {
    vehicleId: string;
    totalMaintenanceRequests: number;
    totalCost: number;
    averageCostPerService: number;
    totalDowntimeDays: number;
    lastServiceDate: string;
    nextScheduledService: string;
    recurringIssues: RecurringIssue[];
    servicesByType: Record<MaintenanceType, number>;
    costByYear: Record<string, number>;
    healthScore: number; // 0-100
}

// ============================================
// PREVENTIVE MAINTENANCE
// ============================================

export interface MaintenanceSchedule {
    id: string;
    vehicleId: string;
    templateId?: string;
    scheduledDate: string;
    maintenanceType: MaintenanceType;
    description: string;
    estimatedCost: number;
    autoCreateRequest: boolean;
    notifyDaysBefore: number;
    recurring: boolean;
    recurringInterval?: number; // days
}

export interface MaintenanceTemplate {
    id: string;
    name: string;
    maintenanceType: MaintenanceType;
    description: string;
    estimatedDuration: number; // hours
    estimatedCost: number;
    requiredParts: string[];
    checklistItems: string[];
    intervalDays: number;
}

// ============================================
// DRIVER FEEDBACK
// ============================================

export interface DriverFeedback {
    id: string;
    requestId: string;
    driverId: string;
    vehicleId: string;
    submittedDate: string;
    issueReported: string;
    severity: 'Low' | 'Medium' | 'High' | 'Critical';
    category: string;
    photos: string[];
    audioNote?: string;
    // Post-repair feedback
    satisfactionRating?: number; // 1-5
    repairQualityRating?: number; // 1-5
    wouldRecommendGarage?: boolean;
    comments?: string;
    feedbackDate?: string;
}

// ============================================
// GARAGE PERFORMANCE
// ============================================

export interface GaragePerformance {
    garageId: string;
    garageName: string;
    period: string; // e.g., '2024-Q4'
    totalJobs: number;
    completedJobs: number;
    averageCompletionTime: number; // days
    averageCost: number;
    customerSatisfaction: number; // 1-5
    onTimeDeliveryRate: number; // percentage
    qualityScore: number; // 0-100
    responseTime: number; // hours
    costVariance: number; // percentage
}

// ============================================
// ENHANCED WORKFLOW - REVAMP PHASE 1-4
// ============================================

// Operations Acknowledgment
export interface OperationsAcknowledgment {
    acknowledgedBy: string;
    acknowledgedByName: string;
    acknowledgedAt: string; // ISO Date
    comments?: string;
}

// Maintenance Team Approval
export interface MaintenanceApproval {
    approvedBy: string;
    approvedByName: string;
    approvedAt: string; // ISO Date
    decision: 'APPROVED' | 'REJECTED';
    rejectionReason?: string;
    comments?: string;
}

// Garage Matching
export interface GarageMatch {
    garageId: string;
    garageName: string;
    matchScore: number; // 0-100
    matchedSpecialties: string[];
    matchedServices: MaintenanceType[];
    rfqSentAt?: string; // ISO Date
    rfqEmailStatus?: 'SENT' | 'FAILED' | 'PENDING';
}

// Enhanced Estimate (replaces Quotation in new workflow)
export interface Estimate {
    id: string;
    requestId: string;
    garageId: string;
    garageName: string;
    estimatedCost: number;
    currency: 'AED';
    breakdown: {
        parts: number;
        labor: number;
        other: number;
    };
    estimateDocument?: string; // File URL
    notes?: string;
    validUntil?: string; // ISO Date
    submittedAt: string; // ISO Date
    submittedBy: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    approvalComments?: string;
}

// Driver Assignment (for external garages)
export interface DriverAssignment {
    driverId: string;
    driverName: string;
    driverContact: string;
    assignedAt: string; // ISO Date
    assignedBy: string;
    assignedByName: string;
    notes?: string;
    notificationSent: boolean;
}

// Work Order Confirmation
export interface WorkOrderConfirmation {
    workOrderNumber: string;
    requestId: string;
    selectedGarageId: string;
    selectedGarageName: string;
    approvedEstimateId: string;
    expectedStartDate: string; // ISO Date
    expectedCompletionDate: string; // ISO Date
    specialInstructions?: string;
    workOrderDocument?: string; // PDF URL
    sentAt: string; // ISO Date
    sentBy: string;
    emailStatus: 'SENT' | 'FAILED' | 'PENDING';
}

// Enhanced Invoice Line Item
export interface EnhancedInvoiceLineItem {
    id: string;
    type: 'PART' | 'LABOR' | 'OTHER';
    description: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    // Part-specific fields
    partNumber?: string;
    partSource?: PartSourceValue;
    // Labor-specific fields
    laborHours?: number;
    technicianName?: string;
}

// Enhanced Invoice
export interface EnhancedInvoice {
    id: string;
    invoiceNumber: string;
    requestId: string;
    workOrderNumber: string;
    garageId: string;
    garageName: string;
    invoiceDate: string; // ISO Date
    dueDate: string; // ISO Date

    lineItems: EnhancedInvoiceLineItem[];

    // Totals
    partsTotal: number;
    laborTotal: number;
    otherCharges: number;
    subtotal: number;
    taxRate: number; // e.g., 0.05 for 5% VAT
    taxAmount: number;
    grandTotal: number;
    currency: 'AED';

    // Attachments
    invoiceDocument: string; // PDF/Image URL
    supportingDocuments?: string[]; // Additional attachments

    // Payment
    paidAmount: number;
    paymentStatus: PaymentStatus;
    paymentDate?: string; // ISO Date
    paymentMethod?: string;
    paymentReference?: string;

    // Metadata
    createdAt: string; // ISO Date
    createdBy: string;
    approvedBy?: string;
    approvedAt?: string; // ISO Date
}


// Enhanced Driver (extends existing Driver interface)
export interface EnhancedDriver extends Driver {
    availability: 'AVAILABLE' | 'ASSIGNED' | 'ON_LEAVE';
    currentAssignments?: string[]; // Request IDs
}

// Enhanced Garage (extends existing Garage interface)
export interface EnhancedGarage extends Garage {
    rating?: number; // 0-5
    completedJobs?: number;
    averageCompletionTime?: number; // in days
    averageCost?: number;
}

// ========== TRIPEXL WORKFLOW INTERFACES ==========

// User Roles for RBAC
export enum UserRole {
    DRIVER = 'DRIVER',
    OPERATIONS_TEAM = 'OPERATIONS_TEAM',
    MAINTENANCE_TEAM = 'MAINTENANCE_TEAM',
    FLEET_MANAGER = 'FLEET_MANAGER',
    ADMIN = 'ADMIN'
}

// Vendor Quotation (for RFQ responses)
export interface VendorQuotation {
    id: string;
    requestId: string;
    garageId: string;
    garageName: string;
    partsCost: number;
    laborCost: number;
    otherCharges: number;
    totalCost: number;
    estimatedDuration: number; // in days
    validUntil: string; // ISO Date
    notes?: string;
    submittedAt: string; // ISO Date
    submittedBy: string;
    status: 'PENDING' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
}

// Estimate Approval Record
export interface EstimateApproval {
    id: string;
    requestId: string;
    selectedQuotationId?: string;
    quotationId?: string;
    approvedBy: string;
    approvedByName: string;
    approvedByRole?: UserRole;
    approvalMethod: 'IN_APP' | 'EMAIL_LINK';
    approvedAt: string; // ISO Date
    approvedCost?: number;
    comments?: string;
    rejectionReason?: string; // if rejected
}

// Secure Approval Link
export interface ApprovalLink {
    id: string;
    token: string; // JWT or UUID
    approvalUrl?: string;
    expiresInHours?: number;
    requestId: string;
    quotationId: string;
    approverEmail: string;
    approverName: string;
    createdAt: string; // ISO Date
    expiresAt: string; // ISO Date
    usedAt?: string; // ISO Date (if used)
    status: 'ACTIVE' | 'USED' | 'EXPIRED';
}

// Work Order Closure with Cost Entry
export interface WorkOrderClosure {
    id: string;
    requestId: string;
    actualPartsCost: number;
    actualLaborCost: number;
    actualOtherCharges: number;
    totalActualCost: number;
    costVariance: number; // difference from estimate
    variancePercentage: number;
    invoiceAttachments: Attachment[];
    supportingDocuments: Attachment[];
    completedBy: string;
    completedByName: string;
    completedAt: string; // ISO Date
    completionNotes?: string;
    notes?: string;
}

// RFQ Email Details
export interface RFQDetails {
    requestId: string;
    vehicleDetails: {
        make: string;
        model: string;
        year: number;
        licensePlate: string;
        currentMileage: number;
    };
    workOrderReference: string;
    requiredJobTypes: string[];
    priority: MaintenancePriorityValue;
    sla: string; // e.g., "24 hours", "3 days"
    requiredCompletionDate: string; // ISO Date
    attachments: Attachment[];
    additionalNotes?: string;
}

// Workflow State Transition
export interface StatusTransition {
    from: MaintenanceStatus;
    to: MaintenanceStatus;
    transitionedAt: string; // ISO Date
    transitionedBy: string;
    transitionedByName: string;
    comments?: string;
    automated: boolean; // true if automated, false if manual
}

// Email Log
export interface EmailLog {
    id: string;
    requestId: string;
    emailType: 'RFQ' | 'APPROVAL' | 'WORK_ORDER' | 'NOTIFICATION' | 'REMINDER' | 'CLOSURE' | 'ESTIMATE_APPROVAL';
    recipients: string[];
    cc?: string[];
    subject: string;
    sentAt: string; // ISO Date
    status: 'SENT' | 'FAILED' | 'PENDING';
    errorMessage?: string;
    retryCount: number;
}

// Enhanced Maintenance Request (extends existing)
export interface EnhancedMaintenanceRequest extends MaintenanceRequest {
    // Operations & Approval
    operationsAcknowledgment?: OperationsAcknowledgment;
    maintenanceApproval?: MaintenanceApproval;

    // Garage Matching & Estimation
    matchedGarages?: GarageMatch[];
    estimates?: Estimate[];
    selectedEstimateId?: string;

    // TRIPEXL Workflow - Vendor Quotations
    vendorQuotations?: VendorQuotation[];
    selectedQuotationId?: string;
    estimateApproval?: EstimateApproval;
    approvalLinks?: ApprovalLink[];

    // Work Order
    workOrderConfirmation?: WorkOrderConfirmation;
    assignedDriver?: DriverAssignment;
    workOrderClosure?: WorkOrderClosure;

    // RFQ Details
    rfqDetails?: RFQDetails;
    rfqSentAt?: string; // ISO Date

    // Invoice
    enhancedInvoice?: EnhancedInvoice;

    // Email & Communication
    emailLogs?: EmailLog[];

    // Workflow History
    statusTransitions?: StatusTransition[];

    // Active Work Order Progress (Persisted)
    workLog?: WorkLogEntry[];
    partsUsed?: PartUsage[];
    checklistItems?: ChecklistItem[];
    actualCosts?: ActualCosts;
}

export interface ServiceRequest {
    id: string;
    /** Human-friendly ticker like "SR2026-10001". Optional — derived in
     *  the UI from creation order if the backend hasn't supplied one. */
    readableId?: string;
    requestorId: string;
    serviceType: string;
    vehicleId: string;
    priority: 'Low' | 'Medium' | 'High';
    description: string;
    date: string;
    status: 'Pending' | 'In Progress' | 'Completed' | 'Rejected' | 'Acknowledged' | 'Assigned' | 'Escalated' | 'Resolved';
    maintenanceRequestId?: string; // Link to Maintenance Request
    assignedTo?: string;
    relatedDriverId?: string; // For driver-related services
    history?: {
        status: string;
        date: string; // ISO string
        note?: string;
        actor?: string; // Who performed the action
    }[];
    attachments?: Attachment[];
    createdAt?: string; // ISO Date - Captured at submission
}

