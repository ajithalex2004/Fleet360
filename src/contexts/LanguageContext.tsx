'use client';
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export type Language = 'en' | 'ar';

interface LanguageContextValue {
  language: Language;
  isRTL: boolean;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
  /** Translate by the English label string — use in layouts/nav */
  tLabel: (english: string) => string;
}

/* ── Key-based translations ──────────────────────────────────────────────── */
const translations: Record<string, Record<Language, string>> = {
  // Navigation
  'nav.dashboard':  { en: 'Dashboard',  ar: 'لوحة التحكم' },
  'nav.analytics':  { en: 'Analytics',  ar: 'التحليلات' },
  'nav.bookings':   { en: 'Bookings',   ar: 'الحجوزات' },
  'nav.agreements': { en: 'Agreements', ar: 'العقود' },
  'nav.invoices':   { en: 'Invoices',   ar: 'الفواتير' },
  'nav.customers':  { en: 'Customers',  ar: 'العملاء' },
  'nav.vehicles':   { en: 'Vehicles',   ar: 'المركبات' },
  'nav.branches':   { en: 'Branches',   ar: 'الفروع' },
  'nav.staff':      { en: 'Staff',      ar: 'الموظفون' },
  'nav.reports':    { en: 'Reports',    ar: 'التقارير' },
  'nav.settings':   { en: 'Settings',   ar: 'الإعدادات' },
  // Actions
  'action.save':    { en: 'Save',    ar: 'حفظ' },
  'action.cancel':  { en: 'Cancel',  ar: 'إلغاء' },
  'action.edit':    { en: 'Edit',    ar: 'تعديل' },
  'action.delete':  { en: 'Delete',  ar: 'حذف' },
  'action.approve': { en: 'Approve', ar: 'موافقة' },
  'action.reject':  { en: 'Reject',  ar: 'رفض' },
  'action.submit':  { en: 'Submit',  ar: 'إرسال' },
  'action.search':  { en: 'Search',  ar: 'بحث' },
  'action.filter':  { en: 'Filter',  ar: 'تصفية' },
  'action.export':  { en: 'Export',  ar: 'تصدير' },
  'action.print':   { en: 'Print',   ar: 'طباعة' },
  'action.send':    { en: 'Send',    ar: 'إرسال' },
  'action.sign':    { en: 'Sign',    ar: 'توقيع' },
  'action.new':     { en: 'New',     ar: 'جديد' },
  'action.create':  { en: 'Create',  ar: 'إنشاء' },
  'action.close':   { en: 'Close',   ar: 'إغلاق' },
  'action.open':    { en: 'Open',    ar: 'فتح' },
  'action.view':    { en: 'View',    ar: 'عرض' },
  // Status
  'status.active':    { en: 'Active',    ar: 'نشط' },
  'status.inactive':  { en: 'Inactive',  ar: 'غير نشط' },
  'status.pending':   { en: 'Pending',   ar: 'معلق' },
  'status.approved':  { en: 'Approved',  ar: 'معتمد' },
  'status.rejected':  { en: 'Rejected',  ar: 'مرفوض' },
  'status.completed': { en: 'Completed', ar: 'مكتمل' },
  'status.cancelled': { en: 'Cancelled', ar: 'ملغى' },
  'status.draft':     { en: 'Draft',     ar: 'مسودة' },
  'status.signed':    { en: 'Signed',    ar: 'موقع' },
  'status.paid':      { en: 'Paid',      ar: 'مدفوع' },
  'status.overdue':   { en: 'Overdue',   ar: 'متأخر' },
  'status.held':      { en: 'Held',      ar: 'محتجز' },
  // Common labels
  'label.name':      { en: 'Name',      ar: 'الاسم' },
  'label.phone':     { en: 'Phone',     ar: 'الهاتف' },
  'label.email':     { en: 'Email',     ar: 'البريد الإلكتروني' },
  'label.date':      { en: 'Date',      ar: 'التاريخ' },
  'label.amount':    { en: 'Amount',    ar: 'المبلغ' },
  'label.notes':     { en: 'Notes',     ar: 'ملاحظات' },
  'label.status':    { en: 'Status',    ar: 'الحالة' },
  'label.branch':    { en: 'Branch',    ar: 'الفرع' },
  'label.vehicle':   { en: 'Vehicle',   ar: 'المركبة' },
  'label.customer':  { en: 'Customer',  ar: 'العميل' },
  'label.contract':  { en: 'Contract',  ar: 'العقد' },
  'label.reference': { en: 'Reference', ar: 'المرجع' },
  'label.total':     { en: 'Total',     ar: 'الإجمالي' },
  'label.loading':   { en: 'Loading…',  ar: '...جار التحميل' },
  // UAE specific
  'uae.emirate':    { en: 'Emirate',    ar: 'الإمارة' },
  'uae.trn':        { en: 'TRN',        ar: 'رقم التسجيل الضريبي' },
  'uae.vat':        { en: 'VAT (5%)',   ar: 'ضريبة القيمة المضافة (5%)' },
  'uae.aed':        { en: 'AED',        ar: 'درهم' },
  'uae.emirates_id':{ en: 'Emirates ID',ar: 'الهوية الإماراتية' },
  // Platform
  'platform.title':  { en: 'Smart Mobility Platform',      ar: 'منصة التنقل الذكي' },
  'platform.tagline':{ en: 'UAE Smart Transport Management', ar: 'إدارة النقل الذكي في الإمارات' },
  'platform.home':   { en: 'XL AI Platform Home',          ar: 'الرئيسية' },
  // Modules
  'module.finance':      { en: 'Finance ERP',          ar: 'المالية' },
  'module.leasing':      { en: 'Vehicle Leasing',      ar: 'تأجير المركبات' },
  'module.rental':       { en: 'Rent-A-Car',           ar: 'تأجير السيارات' },
  'module.maintenance':  { en: 'Vehicle Maintenance',  ar: 'صيانة المركبات' },
  'module.fleet':        { en: 'Fleet Management',     ar: 'إدارة الأسطول' },
  'module.logistics':    { en: 'Logistics',            ar: 'اللوجستيات' },
  'module.driver':       { en: 'Driver Management',   ar: 'إدارة السائقين' },
  'module.school_bus':   { en: 'School Bus',           ar: 'حافلة مدرسية' },
  'module.incidents':    { en: 'Incidents',            ar: 'الحوادث' },
  'module.compliance':   { en: 'Compliance',           ar: 'الامتثال' },
  'module.admin':        { en: 'Admin',                ar: 'الإدارة' },
  'module.reports':      { en: 'Reports',              ar: 'التقارير' },
  'module.approvals':    { en: 'Approvals',            ar: 'الموافقات' },
  'module.bus_ops':      { en: 'Staff Transport',      ar: 'نقل الموظفين' },
  'module.school_bus':   { en: 'School Bus',           ar: 'حافلة مدرسية' },
  'module.sustainability':{ en: 'Sustainability & ESG', ar: 'الاستدامة والحوكمة' },
};

/* ── Arabic translations for every nav label (value-keyed) ──────────────── */
// Used by tLabel() so layouts translate labels without restructuring NAV_GROUPS
const arabicLabels: Record<string, string> = {
  // ── Group headers ─────────────────────────────────────────
  'Overview':               'نظرة عامة',
  'Sales Pipeline':         'خط المبيعات',
  'Sales Lifecycle':        'دورة حياة المبيعات',
  'Reservations':           'الحجوزات',
  'Rental Operations':      'عمليات التأجير',
  'Billing':                'الفواتير',
  'Billing & Finance':      'الفواتير والمالية',
  'Operational Billing':    'الفواتير التشغيلية',
  'Customer':               'العميل',
  'Compliance & Ops':       'الامتثال والعمليات',
  'Compliance & Analytics': 'الامتثال والتحليلات',
  'Fleet & Compliance':     'الأسطول والامتثال',
  'Management':             'الإدارة',
  'Operations':             'العمليات',
  'Work Management':        'إدارة العمل',
  'Garage':                 'المستودع',
  'Alerts & Monitoring':    'التنبيهات والمراقبة',
  'Data Masters':           'بيانات المرجع',
  'Administration':         'الإدارة العامة',
  'Receivables':            'المستحقات',
  'UAE Compliance':         'الامتثال الإماراتي',
  'Multi-Branch':           'متعدد الفروع',
  'Accounting':             'المحاسبة',
  // ── Nav item labels — Finance ─────────────────────────────
  'Dashboard':              'لوحة التحكم',
  'Analytics & BI':         'التحليلات والذكاء الاصطناعي',
  'CRM Pipeline':           'خط إدارة العملاء',
  'Invoices':               'الفواتير',
  'Recurring Invoices':     'الفواتير المتكررة',
  'Payments':               'المدفوعات',
  'Credit Notes':           'إشعارات الخصم',
  'AR Aging Report':        'تقرير استحقاق الذمم',
  'Collections & Dunning':  'التحصيل والمطالبات',
  'Payment Reminders':      'تذكيرات الدفع',
  'Security Deposits':      'الودائع الأمنية',
  'Expense Management':     'إدارة المصروفات',
  'Bank Reconciliation':    'تسوية البنك',
  'Budget vs Actual':       'الميزانية مقابل الفعلي',
  'PDC Register':           'سجل الشيكات المؤجلة',
  'Tax Engine':             'محرك الضرائب',
  'VAT Returns':            'إقرارات ضريبة القيمة المضافة',
  'VAT by Branch':          'ضريبة القيمة المضافة حسب الفرع',
  'VAT Consolidation':      'توحيد ضريبة القيمة المضافة',
  'Branch P&L':             'أرباح وخسائر الفرع',
  'Chart of Accounts':      'دليل الحسابات',
  'Journal Entries':        'قيود اليومية',
  'General Ledger':         'دفتر الأستاذ العام',
  'Fixed Assets':           'الأصول الثابتة',
  'Management Accounts':    'حسابات الإدارة',
  'Balance Sheet':          'الميزانية العمومية',
  'Corporate Tax (UAE)':    'ضريبة الشركات (الإمارات)',
  'Revenue Analysis':       'تحليل الإيرادات',
  'Budget Approvals':       'موافقات الميزانية',
  'Period Locking':         'قفل الفترة',
  'Audit Log':              'سجل المراجعة',
  // ── Nav item labels — Leasing ─────────────────────────────
  'Inquiries':              'الاستفسارات',
  'Quotations':             'عروض الأسعار',
  'Agreements':             'العقود',
  'Renewals':               'التجديدات',
  'Early Termination':      'الإنهاء المبكر',
  'Pre-Billing':            'الفوترة المسبقة',
  'Receipts':               'الإيصالات',
  'Receivables (AR)':       'الذمم المدينة',
  'Direct Debits':          'الخصم المباشر',
  'Traffic Fines':          'المخالفات المرورية',
  'Fuel Management':        'إدارة الوقود',
  'Mileage & Overage':      'الكيلومترات والزيادة',
  'Insurance':              'التأمين',
  'Documents':              'الوثائق',
  'Amendments':             'التعديلات',
  'Handover & Return':      'التسليم والإرجاع',
  'Vehicle Exchange':       'استبدال المركبة',
  'Vehicle Transfers':      'نقل المركبات',
  'Vehicle Returns':        'إرجاع المركبات',
  'Remarketing':            'إعادة التسويق',
  'Lessees':                'المستأجرون',
  'Credit Assessment':      'تقييم الائتمان',
  'Workflow & Approvals':   'سير العمل والموافقات',
  'Expiry Alerts':          'تنبيهات انتهاء الصلاحية',
  'Branches':               'الفروع',
  'Branch Management':      'إدارة الفروع',
  'Staff Management':       'إدارة الموظفين',
  // ── Nav item labels — RAC ────────────────────────────────
  'Bookings':               'الحجوزات',
  'Vehicle Availability':   'توفر المركبات',
  'Rental Agreements':      'اتفاقيات الإيجار',
  'Damage Claims':          'مطالبات الأضرار',
  'Rate Engine':            'محرك الأسعار',
  'Pricing':                'التسعير',
  'Customers':              'العملاء',
  'Document Vault':         'خزنة الوثائق',
  // ── Nav item labels — Maintenance ───────────────────────
  'Service Requests':       'طلبات الخدمة',
  'Predictive Maintenance': 'الصيانة التنبؤية',
  'Requests List':          'قائمة الطلبات',
  'Maintenance History':    'تاريخ الصيانة',
  'Approvals':              'الموافقات',
  'Analytics':              'التحليلات',
  'Garage Management':      'إدارة المستودع',
  'Submit Quote':           'تقديم عرض',
  'Work Orders':            'أوامر العمل',
  'Alert Configuration':    'إعداد التنبيهات',
  'Action Centre':          'مركز الإجراءات',
  'Garages':                'المستودعات',
  'Attachment Types':       'أنواع المرفقات',
  'Integrations':           'التكاملات',
  'Email / SMS Alerts':     'تنبيهات البريد / الرسائل',
  'Notification Rules':     'قواعد الإشعارات',
  // ── Module badge descriptions ─────────────────────────────
  'Contracts · Billing · Fleet · CRM':          'العقود · الفواتير · الأسطول · إدارة العملاء',
  'Inquiries · Quotes · Handover · Compliance': 'الاستفسارات · العروض · التسليم · الامتثال',
  'Predictive · Garage · Alerts · Analytics':   'التنبؤي · المستودع · التنبيهات · التحليلات',
  'Balance Sheet · CT · Budgets · Periods · Audit': 'الميزانية · ضريبة الشركات · الميزانيات · الفترات · المراجعة',
  // ── Nav item labels — Fleet ──────────────────────────────────
  'Masters':                  'البيانات الرئيسية',
  'Finance & Analytics':      'المالية والتحليلات',
  'Vehicle Types':            'أنواع المركبات',
  'Vehicle Master':           'سجل المركبات',
  'Lifecycle Events':         'أحداث دورة الحياة',
  'Allocations':              'التخصيصات',
  'Transfers':                'التحويلات',
  'Fuel Logs':                'سجلات الوقود',
  'TCO Analysis':             'تحليل التكلفة الإجمالية',
  // ── Nav item labels — Driver ─────────────────────────────────
  'Driver Profiles':          'ملفات السائقين',
  'Shifts':                   'الورديات',
  'Training':                 'التدريب',
  'Performance':              'الأداء',
  // ── Nav item labels — Bus Ops / Staff Transport ──────────────
  'Dispatch Board':           'لوحة التوزيع',
  'Routes':                   'المسارات',
  'Route Optimizer':          'محسّن المسارات',
  'Schedules':                'الجداول الزمنية',
  'Passengers':               'الركاب',
  'Staff Members':            'أعضاء الفريق',
  'Incidents':                'الحوادث',
  // ── Nav item labels — Compliance ─────────────────────────────
  'Salik':                    'سالك',
  'Permits':                  'التصاريح',
  // ── Nav item labels — Admin ──────────────────────────────────
  'Tenants':                  'المستأجرون',
  'Branches & Regions':       'الفروع والمناطق',
  'Billing & Subscriptions':  'الفواتير والاشتراكات',
  'Roles & Permissions':      'الأدوار والصلاحيات',
  'Users':                    'المستخدمون',
  'Workflow Management':      'إدارة سير العمل',
  'Platform Info':            'معلومات المنصة',
  'Notifications':            'الإشعارات',
  'Integrations & ERP':       'التكاملات ونظام ERP',
  'E-Signing Console':        'وحدة التوقيع الإلكتروني',
  'WhatsApp Support':         'دعم واتساب',
  'Platform Settings':        'إعدادات المنصة',
  // ── Nav item labels — Reports ────────────────────────────────
  'Fleet Utilization':        'استخدام الأسطول',
  'Maintenance Cost':         'تكلفة الصيانة',
  'Driver Performance':       'أداء السائق',
  'Scheduled Reports':        'التقارير المجدولة',
  // ── Nav item labels — School Bus (emoji-prefixed labels) ──────
  '🏫 Dashboard':             '🏫 لوحة التحكم',
  '🗺️ Routes':                '🗺️ المسارات',
  '✨ Route Optimizer':        '✨ محسّن المسارات',
  '👧 Students':              '👧 الطلاب',
  '📋 Attendance':            '📋 الحضور',
  '📅 Schedules':             '📅 الجداول الزمنية',
  '🚨 Incidents':             '🚨 الحوادث',
  // ── Nav item labels — Incidents (emoji-prefixed labels) ───────
  '🚨 Dashboard':             '🚨 لوحة التحكم',
  '🔴 Active Incidents':      '🔴 الحوادث النشطة',
  '🚑 Ambulance Fleet':       '🚑 أسطول الإسعاف',
  '📋 Incident Reports':      '📋 تقارير الحوادث',
  // ── Nav item labels — Logistics (emoji-prefixed labels) ──────
  '📊 Dashboard':             '📊 لوحة التحكم',
  '🚦 Dispatch Board':        '🚦 لوحة التوزيع',
  '🗺️ Route Optimizer':       '🗺️ محسّن المسارات',
  '📋 All Trips':             '📋 جميع الرحلات',
  '🚛 Vehicles':              '🚛 المركبات',
  '👤 Drivers':               '👤 السائقون',
  '📍 Live Tracking':         '📍 التتبع المباشر',
  '💰 Freight Quotes':        '💰 عروض الشحن',
  '📈 Analytics':             '📈 التحليلات',
  // ── Nav item labels — Sustainability ─────────────────────────
  'ESG Dashboard':            'لوحة حوكمة ESG',
  'Emission Reports':         'تقارير الانبعاثات',
  'Fleet Carbon':             'كربون الأسطول',
  'Modal Shift':              'التحول الوسيط',
  'Paperless Ops':            'عمليات بلا ورق',
  'Certifications':           'الشهادات',
  'Methodology Settings':     'إعدادات المنهجية',
  // ── Common page phrases ───────────────────────────────────
  'Loading…':               '...جار التحميل',
  'No data found':          'لا توجد بيانات',
  'Save':                   'حفظ',
  'Cancel':                 'إلغاء',
  'Delete':                 'حذف',
  'Edit':                   'تعديل',
  'Close':                  'إغلاق',
  'Approve':                'موافقة',
  'Reject':                 'رفض',
  'Submit':                 'إرسال',
  'Search':                 'بحث',
  'Export XLSX':            'تصدير XLSX',
  'New':                    'جديد',
  'Create':                 'إنشاء',
  'View':                   'عرض',
  'Back':                   'رجوع',
  'Generate Now':           'إنشاء الآن',
  'Run All Now':            'تشغيل الكل الآن',
  'Add Deduction':          'إضافة خصم',
  'Process Refund':         'معالجة الاسترداد',
  'Forfeit Deposit':        'مصادرة الوديعة',
};

const LanguageContext = createContext<LanguageContextValue>({
  language: 'en',
  isRTL: false,
  setLanguage: () => {},
  t: (key) => key,
  tLabel: (english) => english,
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>('en');

  useEffect(() => {
    const saved = localStorage.getItem('xlai_language') as Language | null;
    if (saved === 'ar' || saved === 'en') setLanguageState(saved);
  }, []);

  useEffect(() => {
    document.documentElement.dir  = language === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = language;
    localStorage.setItem('xlai_language', language);
  }, [language]);

  const setLanguage = (lang: Language) => setLanguageState(lang);

  const t = (key: string): string =>
    translations[key]?.[language] ?? translations[key]?.en ?? key;

  /** Translate by the English label value — used in sidebar layouts */
  const tLabel = (english: string): string =>
    language === 'ar' ? (arabicLabels[english] ?? english) : english;

  return (
    <LanguageContext.Provider value={{ language, isRTL: language === 'ar', setLanguage, t, tLabel }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
