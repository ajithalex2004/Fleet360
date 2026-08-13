export enum MaintenanceStatus {
    REQUESTED = 'Requested',
    SUBMITTED = 'Submitted',
    ACCEPTED = 'Accepted',
    REJECTED = 'Rejected',
    RE_ASSIGN = 'Re-Assign',
    UNDER_ESTIMATION = 'Under Estimation',
    PENDING_ESTIMATION_APPROVAL = 'Pending Estimation Approval',
    ESTIMATION_APPROVED = 'Estimation Approved',
    PENDING_OPERATIONS_ACK = 'Pending Operations Ack',
    PENDING_MAINTENANCE_APPROVAL = 'Pending Maintenance Approval',
    REJECTED_BY_MAINTENANCE = 'Rejected By Maintenance',
    UNDER_MAINTENANCE = 'Under Maintenance',
    REPAIR_COMPLETED = 'Repair Completed',       // Garage marks repair done
    QUALITY_INSPECTION = 'Quality Inspection',   // Fleet QC inspector reviews
    INSPECTION_FAILED = 'Inspection Failed',     // QC failed — vehicle returned to garage
    READY_FOR_SERVICE = 'Ready For Service',     // QC passed — vehicle cleared for use
    MAINTENANCE_COMPLETED = 'Maintenance Completed',
    COMPLETED = 'Completed',
    PENDING_INVOICE = 'Pending Invoice',
    INVOICE_SUBMITTED = 'Invoice Submitted',
    CLOSED = 'Closed',
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
    BREAKDOWN = 'BREAKDOWN',
}

export enum MaintenancePriority {
    LOW = 'LOW',
    MEDIUM = 'MEDIUM',
    HIGH = 'HIGH',
    CRITICAL = 'CRITICAL',
}

export enum AttachmentType {
    INVOICE = 'INVOICE',
    REPORT = 'REPORT',
    IMAGE = 'IMAGE',
    QUOTATION = 'QUOTATION',
    WORK_ORDER = 'WORK_ORDER',
    ESTIMATE = 'ESTIMATE',
    APPROVED_ESTIMATE = 'APPROVED_ESTIMATE',
    INSPECTION_REPORT = 'INSPECTION_REPORT',
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
    CUSTOMER_SUPPLIED = 'Customer Supplied',
}

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
    // Driver Hub core fields (Layer 2.7 — sync with Prisma Driver model)
    firstName?: string;
    lastName?: string;
    hierarchy?: string;
    driverType?: string; // PERMANENT|CONTRACT|OUTSOURCED
    nationality?: string;
    dob?: string; // ISO Date
    emiratesId?: string;
    communicationLanguage?: string;
    dateOfJoin?: string; // ISO Date
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
    expectedCompletionDate?: string; // ISO Date — alias used by the request detail UI
    description: string;
    status: MaintenanceStatus;

    // New Fields
    odometer?: number;
    garageId?: string;
    candidateGarageIds?: string[]; // For RFQ
    maintenanceType?: MaintenanceType;
    priority?: MaintenancePriority;
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
    quotationDate: string;
    submittedDate?: string; // ISO Date — when this quotation was submitted to the requestor
    validUntil: string;
    laborCost: number;
    partsCost: number;
    totalCost: number; // Subtotal (Parts + Labor)
    currency?: 'AED';
    parts: PartItem[];
    labor: LaborItem[];
    partsBreakdown?: PartItem[]; // Layer 2.7 — line-by-line parts the garage will supply
    consumablesCost: number;
    vatAmount: number;
    grandTotal: number;
    estimatedDuration: number; // hours
    estimatedCompletionDate?: string; // ISO Date
    additionalCosts?: number;
    taxAmount?: number;
    notes?: string;
    status: QuotationStatus;
    submittedBy: string;
    attachments?: Attachment[];
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
    source: PartSource;
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
    partSource?: PartSource;
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
    selectedQuotationId: string;
    approvedBy: string;
    approvedByName: string;
    approvedByRole: UserRole;
    approvalMethod: 'IN_APP' | 'EMAIL_LINK';
    approvedAt: string; // ISO Date
    approvedCost?: number; // Cost at the moment of approval (frozen for audit trail)
    comments?: string;
    rejectionReason?: string; // if rejected
}

// Secure Approval Link
export interface ApprovalLink {
    id: string;
    token: string; // JWT or UUID
    requestId: string;
    quotationId: string;
    approverEmail: string;
    approverName: string;
    createdAt: string; // ISO Date
    expiresAt: string; // ISO Date
    expiresInHours?: number; // Layer 2.7 — convenience alias for email templates
    approvalUrl?: string; // Layer 2.7 — fully-qualified URL embedded in emails
    usedAt?: string; // ISO Date (if used)
    status: 'ACTIVE' | 'USED' | 'EXPIRED';
}

// ============================================
// QUALITY INSPECTION
// ============================================

export enum InspectionResult {
    PASSED = 'PASSED',
    FAILED = 'FAILED',
    CONDITIONAL = 'CONDITIONAL', // passed with minor remarks
}

export interface InspectionChecklistItem {
    id: string;
    category: string;           // e.g., 'Safety', 'Mechanical', 'Cosmetic'
    item: string;               // e.g., 'Brake response'
    result: 'OK' | 'FAIL' | 'N/A';
    notes?: string;
}

export interface QualityInspection {
    id: string;
    requestId: string;
    workOrderNo?: string;
    inspectorId: string;
    inspectorName: string;
    inspectedAt: string;        // ISO Date
    result: InspectionResult;
    checklistItems: InspectionChecklistItem[];
    defectsFound?: string[];    // Free-text list of defects
    recommendations?: string;
    returnToGarageReason?: string; // populated when result = FAILED
    photos?: string[];          // URLs
    signatureUrl?: string;      // Inspector digital signature
    attachments?: Attachment[];
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
    notes?: string;
    completionNotes?: string; // Layer 2.7 — alias for `notes` used in some email templates
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
    priority: MaintenancePriority;
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
    status: 'SENT' | 'FAILED' | 'PENDING' | 'MOCK_SENT';
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

    // Quality Inspection
    qualityInspections?: QualityInspection[];
    latestInspectionId?: string;

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

// ============================================
// PREVENTIVE MAINTENANCE ENGINE
// ============================================

export enum PMTriggerType {
    ODOMETER        = 'ODOMETER',
    CALENDAR        = 'CALENDAR',
    ENGINE_HOURS    = 'ENGINE_HOURS',
    OPERATING_HOURS = 'OPERATING_HOURS',
    COMPONENT_LIFE  = 'COMPONENT_LIFE',
}

export enum PMItemStatus {
    UPCOMING  = 'UPCOMING',
    DUE       = 'DUE',
    OVERDUE   = 'OVERDUE',
    COMPLETED = 'COMPLETED',
    SNOOZED   = 'SNOOZED',
}

export interface PMApplicability {
    allVehicles:   boolean;
    vehicleIds?:   string[];
    vehicleTypes?: string[];
    vehicleGroups?: string[];
}

export interface PMTrigger {
    id:            string;
    planId:        string;
    triggerType:   PMTriggerType;
    /** Numeric interval: km for ODOMETER, days for CALENDAR, hours for ENGINE_HOURS */
    intervalValue: number;
    intervalUnit:  'KM' | 'DAYS' | 'HOURS';
}

export interface MaintenancePlan {
    id:               string;
    tenantId:         string;
    name:             string;
    description?:     string;
    maintenanceType?: MaintenanceType;
    applicability:    PMApplicability;
    /** Days after nominal due date before status escalates to OVERDUE */
    gracePeriodDays?: number;
    /** Flag as DUE this many days before the calculated due date */
    earlyWindowDays?: number;
    /** Flag as DUE this many km before the calculated due odometer */
    earlyWindowKm?:   number;
    isActive:         boolean;
    notifyDaysBefore?: number;
    triggers:         PMTrigger[];
    createdAt?:       string;
    updatedAt?:       string;
}

export interface PMScheduleItem {
    id:                 string;
    tenantId:           string;
    planId:             string;
    plan?:              MaintenancePlan;
    vehicleId:          string;
    /** ISO Date — when the vehicle last received this service */
    lastServiceDate?:   string;
    /** Odometer reading at last service (km) */
    lastOdometerKm?:    number;
    /** Pre-computed next due date from calendar trigger */
    nextDueDateCalc?:   string;
    /** Pre-computed next due odometer from odometer trigger (km) */
    nextDueOdometerKm?: number;
    status:             PMItemStatus;
    generatedRequestId?: string;
}

/** Computed due calculation result — not persisted, returned by the due-calc engine */
export interface PMDueCalculation {
    item:             PMScheduleItem;
    effectiveStatus:  PMItemStatus;
    /** Positive = days until due, negative = days overdue */
    daysUntilDue?:    number;
    /** Positive = km until due, negative = km overdue */
    kmUntilDue?:      number;
    /** Which trigger fired first */
    triggeringFactor: 'ODOMETER' | 'CALENDAR' | 'BOTH' | 'NONE';
    /** 0–100 urgency score; higher = act sooner */
    urgencyScore:     number;
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

// ============================================
// PHASE C — JOB CARDS
// ============================================

export type JobCardStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';

export interface JobTask {
    id: string;
    jobCardId: string;
    description: string;
    completed: boolean;
    completedAt?: string;  // ISO Date
    completedBy?: string;
}

export interface JobCard {
    id: string;
    workOrderId: string;
    title: string;
    description?: string;
    technicianId?: string;
    technicianName?: string;
    status: JobCardStatus;
    estimatedHours?: number;
    actualHours?: number;
    tasks: JobTask[];
    createdAt: string; // ISO Date
}

// ============================================
// PHASE C — WARRANTY MANAGEMENT
// ============================================

export type WarrantyType = 'MANUFACTURER' | 'EXTENDED' | 'THIRD_PARTY';
export type WarrantyClaimStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAID';

export interface VehicleWarranty {
    id: string;
    tenantId: string;
    vehicleId: string;
    warrantyType: WarrantyType;
    provider?: string;
    startDate: string;    // ISO Date (date only)
    expiryDate: string;   // ISO Date (date only)
    coverageDescription?: string;
    maxClaimAmount?: number;
    isActive: boolean;
    claims?: WarrantyClaim[];
}

export interface WarrantyClaim {
    id: string;
    warrantyId: string;
    requestId?: string;   // linked MaintenanceRequest
    claimDate?: string;   // ISO Date
    claimedAmount?: number;
    approvedAmount?: number;
    status: WarrantyClaimStatus;
    description?: string;
    referenceNumber?: string;
    createdAt: string;    // ISO Date
}

/** Returned by GET /api/maintenance/[id]/warranty-check */
export interface WarrantyCheckResult {
    hasActiveWarranty: boolean;
    warranties: (VehicleWarranty & { coverageNote: string })[];
}

// ============================================
// PHASE C — QC CHECKLIST (DB-backed)
// ============================================

export type QCItemResult = 'PASS' | 'FAIL' | 'NA';
export type QCOverallResult = 'PENDING' | 'PASS' | 'FAIL';

export interface QCChecklistItem {
    id: string;
    item: string;
    result: QCItemResult;
    notes?: string;
    photoUrl?: string;
}

/** DB-backed quality inspection record (maps to quality_inspections table) */
export interface QualityInspectionRecord {
    id: string;
    requestId: string;
    tenantId: string;
    inspectorId?: string;
    inspectorName?: string;
    overallResult: QCOverallResult;
    notes?: string;
    inspectedAt?: string; // ISO Date
    checklist: QCChecklistItem[];
    createdAt: string;    // ISO Date
}

// ============================================
// PHASE E — BREAKDOWN MAINTENANCE
// ============================================

export type BreakdownType =
    | 'FLAT_TYRE'
    | 'ENGINE_FAILURE'
    | 'BATTERY_DEAD'
    | 'ACCIDENT'
    | 'FUEL_EMPTY'
    | 'OVERHEATING'
    | 'ELECTRICAL'
    | 'TRANSMISSION'
    | 'OTHER';

export type BreakdownStatus =
    | 'REPORTED'
    | 'RECOVERY_DISPATCHED'
    | 'RECOVERY_COMPLETED'
    | 'AT_WORKSHOP'
    | 'RESOLVED';

export type BreakdownSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** Maps to breakdown_reports table */
export interface BreakdownReport {
    id: string;
    reportNo: string | null;          // BRK-YYYYMM-NNNNN
    tenantId: string;
    vehicleId: string | null;
    driverId: string | null;
    reportedAt: string;               // ISO Date
    breakdownType: BreakdownType;
    location: string | null;
    latitude: number | null;
    longitude: number | null;
    driverNotes: string | null;
    photoUrls: string[];
    severity: BreakdownSeverity;
    status: BreakdownStatus;
    // Recovery fields
    recoveryVehicleId: string | null;
    recoveryDriverId: string | null;
    recoveryNotes: string | null;
    recoveryDispatchedAt: string | null;  // ISO Date
    recoveryCompletedAt: string | null;   // ISO Date
    estimatedArrivalAt: string | null;    // ISO Date
    // Linked maintenance request (auto-created)
    maintenanceRequestId: string | null;
    MaintenanceRequest?: { id: string; status: string; workOrderNo: string | null } | null;
    createdAt: string;                // ISO Date
    updatedAt: string | null;
}

/** POST /api/maintenance/breakdown-reports — body */
export interface CreateBreakdownReportBody {
    vehicleId: string;
    driverId?: string;
    breakdownType: BreakdownType;
    location?: string;
    latitude?: number;
    longitude?: number;
    driverNotes?: string;
    photoUrls?: string[];
    severity?: BreakdownSeverity;
}

/** POST /api/maintenance/breakdown-reports/[id]/dispatch-recovery — body */
export interface DispatchRecoveryBody {
    recoveryVehicleId?: string;
    recoveryDriverId?: string;
    recoveryNotes?: string;
    estimatedArrivalAt?: string; // ISO Date
}

// ── Phase F — MAINTENANCE SLA MANAGEMENT ─────────────────────────────────────

export type SLAStatus = 'MET' | 'AT_RISK' | 'BREACHED';

export type SLAPhaseName =
    | 'RESPONSE'    // MR created → first status change (Submitted/Accepted)
    | 'DIAGNOSIS'   // Accepted → Under Estimation / Under Maintenance
    | 'ESTIMATION'  // Under Estimation → Pending Estimation Approval
    | 'APPROVAL'    // Pending Estimation Approval → Estimation Approved
    | 'REPAIR'      // Under Maintenance → Repair Completed
    | 'COMPLETION'  // Repair Completed → Maintenance Completed
    | 'VENDOR';     // Accepted → Repair Completed (end-to-end vendor SLA)

export type SLATier = 'CRITICAL' | 'HIGH' | 'NORMAL';

export interface SLARuleSet {
    tier: SLATier;
    responseMinutes: number;
    repairMinutes: number;
    phaseMinutes: Record<SLAPhaseName, number>;
}

export const DEFAULT_SLA_RULES: Record<SLATier, SLARuleSet> = {
    CRITICAL: {
        tier: 'CRITICAL',
        responseMinutes: 15,
        repairMinutes: 240,
        phaseMinutes: {
            RESPONSE:   15,
            DIAGNOSIS:  30,
            ESTIMATION: 30,
            APPROVAL:   60,
            REPAIR:     120,
            COMPLETION: 15,
            VENDOR:     240,
        },
    },
    HIGH: {
        tier: 'HIGH',
        responseMinutes: 30,
        repairMinutes: 480,
        phaseMinutes: {
            RESPONSE:   30,
            DIAGNOSIS:  60,
            ESTIMATION: 60,
            APPROVAL:   120,
            REPAIR:     240,
            COMPLETION: 30,
            VENDOR:     480,
        },
    },
    NORMAL: {
        tier: 'NORMAL',
        responseMinutes: 240,
        repairMinutes: 2880,
        phaseMinutes: {
            RESPONSE:   240,
            DIAGNOSIS:  480,
            ESTIMATION: 480,
            APPROVAL:   1440,
            REPAIR:     1440,
            COMPLETION: 240,
            VENDOR:     2880,
        },
    },
};

export interface SLAPhaseSnapshot {
    phase: SLAPhaseName;
    label: string;
    startedAt: string | null;        // ISO
    completedAt: string | null;      // ISO
    deadlineAt: string | null;       // ISO — null if phase not yet started
    targetMinutes: number;
    elapsedMinutes: number | null;   // null if not started
    remainingMinutes: number | null; // null if completed or not started
    status: SLAStatus | 'PENDING';   // PENDING = phase not started yet
}

export interface SLASnapshot {
    mrId: string;
    priority: string;
    tier: SLATier;
    createdAt: string;
    overallStatus: SLAStatus;
    responseDeadlineAt: string | null;
    repairDeadlineAt: string | null;
    responseStatus: SLAStatus | 'PENDING';
    repairStatus: SLAStatus | 'PENDING';
    phases: SLAPhaseSnapshot[];
    rules: SLARuleSet;
}

// ── Phase G — MAINTENANCE RISK SCORE ─────────────────────────────────────────

export type RiskBand = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** Raw inputs fed to the risk engine — all optional so callers can omit unknowns. */
export interface RiskScoreInputs {
    vehicleId:            string;
    vehicleCode?:         string;
    licensePlate?:        string;
    make?:                string;
    model?:               string;
    /** Years since manufacture date (float). */
    ageYears?:            number;
    /** Current odometer reading in km. */
    odometerKm?:          number;
    /** Expected full-lifecycle km (e.g. 300 000). */
    expectedLifetimeKm?:  number;
    /** Days since last completed PM service (overdue when > PM interval). */
    daysSinceLastPM?:     number;
    /** PM interval in days (typically 90 or 180). */
    pmIntervalDays?:      number;
    /** BREAKDOWN / EMERGENCY / CORRECTIVE MR count in the last 90 days. */
    failuresLast90d?:     number;
    /** Unique jobs that recurred in the last 180 days (repeat repair count). */
    repeatJobsLast180d?:  number;
    /** Open MRs still in REQUESTED / SUBMITTED / ACCEPTED states. */
    openDefects?:         number;
    /** Days the vehicle was UNDER_MAINTENANCE in the last 90 days. */
    downtimeDaysLast90d?: number;
    /** True if a warranty is active; false/undefined = no warranty cover. */
    warrantyActive?:      boolean;
    /** Quality inspections that ended with INSPECTION_FAILED and no re-pass. */
    failedInspections?:   number;
    /** AI risk score from fleet_risk_scores (0–1). Used for factor 10. */
    aiRiskScore01?:       number;
}

export interface RiskFactor {
    key:         string;
    label:       string;
    score:       number;   // actual points contributed (0 – maxScore)
    maxScore:    number;
    pct:         number;   // score / maxScore  (0–1)
    description: string;   // human-readable "why"
}

export interface MaintenanceRiskScore {
    vehicleId:    string;
    vehicleCode:  string;
    licensePlate: string;
    make:         string;
    model:        string;
    score:        number;    // 0–100 integer
    band:         RiskBand;
    emoji:        string;    // 🔴 🟠 🟡 🟢
    factors:      RiskFactor[];
    computedAt:   string;    // ISO
}
