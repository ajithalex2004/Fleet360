import { describe, it, expect, vi } from 'vitest';
import {
  classifyTicketDeterministic,
  computeAutoStatusOnCreate,
  computeAutoStatusOnUpdate,
  dispatchTicketAutomationNotifications,
  evaluateTicketForAutoClosure,
  evaluateTicketForReminder,
  maxPriority,
  resolveAutomationRouting,
  resolveAutomationRules,
} from '@/lib/service-tickets/automation-engine';
import { DEFAULT_AUTOMATION_RULES } from '@/types/service-rules';

describe('FSM Runtime Automation Engine', () => {
  it('classifies multilingual emergency, facilities, and fleet tickets accurately without downgrading priority', () => {
    const entrapment = classifyTicketDeterministic({
      ticketType: 'FM_LIFT',
      title: 'Someone is trapped in Lift L3',
      description: 'Urgent entrapment on floor 12',
      currentPriority: 'Medium',
    });
    expect(entrapment.tags).toContain('urgent-safety');
    expect(entrapment.tags).toContain('lift');
    expect(entrapment.suggestedPriority).toBe('Critical');
    expect(entrapment.suggestedDepartment).toBe('FM_HARD_SERVICES');
    expect(maxPriority('Medium', entrapment.suggestedPriority)).toBe('Critical');

    // Arabic fire safety keyword
    const arabicFire = classifyTicketDeterministic({
      ticketType: 'FM_FIRE_SAFETY',
      title: 'إنذار حريق في المبنى الرئيسي',
      description: 'دخان في الطابق الثاني',
      currentPriority: 'High',
    });
    expect(arabicFire.tags).toContain('urgent-safety');
    expect(arabicFire.suggestedPriority).toBe('Critical');

    // Never downgrades an already-Critical priority
    expect(maxPriority('Critical', 'Low')).toBe('Critical');
    expect(maxPriority('High', null)).toBe('High');

    // Fallback tag derived from ticket type key when no keyword matches
    const fallback = classifyTicketDeterministic({
      ticketType: 'FM_CUSTOM_AUDIT',
      title: 'Routine quarterly inspection',
      currentPriority: 'Low',
    });
    expect(fallback.tags).toEqual(['fm-custom-audit']);
  });

  it('routes tickets only to active tenant departments and applies defaultAssignee safely', () => {
    const activeDepts = [
      { key: 'OPERATIONS_TRIAGE', isActive: true },
      { key: 'FM_HARD_SERVICES', isActive: true },
      { key: 'FM_SOFT_SERVICES', isActive: false },
      { key: 'FACILITIES_CLEANING', isActive: true },
      { key: 'WORKSHOP_MAINTENANCE', isActive: true },
    ];

    // Hard service -> FM_HARD_SERVICES + valid defaultAssignee
    const hvac = resolveAutomationRouting({
      ticketType: 'FM_HVAC',
      currentDepartment: 'OPERATIONS_TRIAGE',
      currentAssignee: null,
      availableDepartments: activeDepts,
      ticketingRules: { autoAssignment: true, defaultAssignee: 'hvac.lead@company.ae' },
      aiRoutingEnabled: true,
    });
    expect(hvac.routed).toBe(true);
    expect(hvac.department).toBe('FM_HARD_SERVICES');
    expect(hvac.autoAssigned).toBe(true);
    expect(hvac.assignedTo).toBe('hvac.lead@company.ae');

    // FM_SOFT_SERVICES is inactive -> falls back to active FACILITIES_CLEANING
    const cleaning = resolveAutomationRouting({
      ticketType: 'FM_CLEANING',
      currentDepartment: 'OPERATIONS_TRIAGE',
      currentAssignee: null,
      availableDepartments: activeDepts,
      ticketingRules: { autoAssignment: true, defaultAssignee: 'not-an-email' },
      aiRoutingEnabled: true,
    });
    expect(cleaning.routed).toBe(true);
    expect(cleaning.department).toBe('FACILITIES_CLEANING');
    expect(cleaning.autoAssigned).toBe(false);
    expect(cleaning.assignedTo).toBeNull();

    // Respects existing non-triage department (does not overwrite manual choice)
    const manual = resolveAutomationRouting({
      ticketType: 'FM_HVAC',
      currentDepartment: 'WORKSHOP_MAINTENANCE',
      currentAssignee: 'tech@company.ae',
      availableDepartments: activeDepts,
      aiRoutingEnabled: true,
    });
    expect(manual.routed).toBe(false);
    expect(manual.department).toBe('WORKSHOP_MAINTENANCE');
    expect(manual.assignedTo).toBe('tech@company.ae');
  });

  it('advances statuses automatically without ever bypassing Awaiting Approval or Operations Triage', () => {
    // On create: never bypasses Awaiting Approval
    expect(
      computeAutoStatusOnCreate({
        initialStatus: 'Awaiting Approval',
        assignedDepartment: 'FM_HARD_SERVICES',
        assignedTo: 'tech@company.ae',
        autoStatusUpdate: true,
      }),
    ).toBe('Awaiting Approval');

    // On create: stays Pending if still in Operations Triage
    expect(
      computeAutoStatusOnCreate({
        initialStatus: 'Pending',
        assignedDepartment: 'OPERATIONS_TRIAGE',
        assignedTo: 'tech@company.ae',
        autoStatusUpdate: true,
      }),
    ).toBe('Pending');

    // On create: routed + assigned -> Assigned; routed without assignee -> Acknowledged
    expect(
      computeAutoStatusOnCreate({
        initialStatus: 'Pending',
        assignedDepartment: 'FM_HARD_SERVICES',
        assignedTo: 'tech@company.ae',
        autoStatusUpdate: true,
      }),
    ).toBe('Assigned');

    expect(
      computeAutoStatusOnCreate({
        initialStatus: 'Pending',
        assignedDepartment: 'FM_HARD_SERVICES',
        assignedTo: null,
        autoStatusUpdate: true,
      }),
    ).toBe('Acknowledged');

    // On PATCH: assigning an assignee advances Pending/Acknowledged -> Assigned
    expect(
      computeAutoStatusOnUpdate({
        currentStatus: 'Acknowledged',
        requestedStatus: undefined,
        prevAssignedTo: null,
        nextAssignedTo: 'tech@company.ae',
        assignedDepartment: 'FM_HARD_SERVICES',
        autoStatusUpdate: true,
      }),
    ).toBe('Assigned');

    // On PATCH: approving an already-assigned ticket advances Awaiting Approval -> Assigned
    expect(
      computeAutoStatusOnUpdate({
        currentStatus: 'Awaiting Approval',
        requestedStatus: 'Pending',
        prevAssignedTo: 'tech@company.ae',
        nextAssignedTo: 'tech@company.ae',
        assignedDepartment: 'FM_HARD_SERVICES',
        autoStatusUpdate: true,
      }),
    ).toBe('Assigned');
  });

  it('evaluates auto-closure eligibility strictly for Resolved/Completed tickets past quiet hours', () => {
    const now = new Date('2026-11-28T12:00:00Z');
    const rules = resolveAutomationRules({ autoClosure: true, autoClosureAfterHours: 48 });

    // Eligible: Resolved 50 hours ago (>= 48h)
    const due = evaluateTicketForAutoClosure({
      status: 'Resolved',
      updatedAt: '2026-11-26T10:00:00Z',
      rules,
      now,
    });
    expect(due.eligible).toBe(true);
    expect(due.inactiveHours).toBe(50);

    // Not yet due: Resolved 12 hours ago (< 48h)
    expect(
      evaluateTicketForAutoClosure({
        status: 'Resolved',
        updatedAt: '2026-11-28T00:00:00Z',
        rules,
        now,
      }).eligible,
    ).toBe(false);

    // Ineligible status: open Assigned ticket 100 hours old must NEVER auto-close
    expect(
      evaluateTicketForAutoClosure({
        status: 'Assigned',
        updatedAt: '2026-11-24T00:00:00Z',
        rules,
        now,
      }).eligible,
    ).toBe(false);

    // Disabled toggle
    expect(
      evaluateTicketForAutoClosure({
        status: 'Resolved',
        updatedAt: '2026-11-20T00:00:00Z',
        rules: { ...DEFAULT_AUTOMATION_RULES, autoClosure: false, autoClosureAfterHours: 24 },
        now,
      }).eligible,
    ).toBe(false);
  });

  it('evaluates periodic reminder intervals with anti-spam lastReminderAt protection', () => {
    const now = new Date('2026-11-28T12:00:00Z');
    const rules = resolveAutomationRules({ reminderNotifications: true, reminderIntervalHours: 12 });

    // Due: open ticket last updated 15h ago, never reminded
    const firstDue = evaluateTicketForReminder({
      status: 'Assigned',
      createdAt: '2026-11-27T12:00:00Z',
      updatedAt: '2026-11-27T21:00:00Z',
      lastReminderAt: null,
      rules,
      now,
    });
    expect(firstDue.eligible).toBe(true);
    expect(firstDue.hoursSinceActivity).toBe(15);

    // Anti-spam: reminded 4 hours ago -> NOT due even though updatedAt was 15h ago
    const recentlyReminded = evaluateTicketForReminder({
      status: 'Assigned',
      createdAt: '2026-11-27T12:00:00Z',
      updatedAt: '2026-11-27T21:00:00Z',
      lastReminderAt: '2026-11-28T08:00:00Z',
      rules,
      now,
    });
    expect(recentlyReminded.eligible).toBe(false);

    // Terminal tickets never receive reminders
    expect(
      evaluateTicketForReminder({
        status: 'Resolved',
        createdAt: '2026-11-20T00:00:00Z',
        updatedAt: '2026-11-20T00:00:00Z',
        lastReminderAt: null,
        rules,
        now,
      }).eligible,
    ).toBe(false);
  });

  it('fans out notifications strictly per enabled channel and honors notificationEngineEnabled kill-switch', async () => {
    const sendEmailFn = vi.fn().mockResolvedValue({ sent: true, transport: 'resend' });
    const sendWhatsAppFn = vi.fn().mockResolvedValue({ sent: true, sid: 'WA123' });
    const sendSmsFn = vi.fn().mockRejectedValue(new Error('network blip'));

    const rules = resolveAutomationRules({
      emailNotifications: true,
      whatsappNotifications: true,
      smsNotifications: true,
    });

    // 1. All 3 enabled — SMS error is caught safely without throwing
    const res = await dispatchTicketAutomationNotifications(
      {
        event: 'CREATED',
        rules,
        notificationEngineEnabled: true,
        readableId: 'FSM-SR-ACME-260001',
        title: 'Chiller fault',
        status: 'Assigned',
        priority: 'High',
        serviceTypeName: 'Air conditioning / HVAC',
        assignedDepartment: 'FM_HARD_SERVICES',
        assignedTo: 'tech@acme.ae',
        recipientEmails: ['tech@acme.ae', 'site@acme.ae'],
        recipientPhone: '+971501234567',
      },
      { sendEmailFn, sendWhatsAppFn, sendSmsFn },
    );

    expect(res.email.sent).toBe(true);
    expect(res.whatsapp.sent).toBe(true);
    expect(res.sms.attempted).toBe(true);
    expect(res.sms.sent).toBe(false);
    // Deduplicated emails
    expect(sendEmailFn).toHaveBeenCalledWith(
      expect.objectContaining({ to: ['tech@acme.ae', 'site@acme.ae'] }),
    );

    // 2. Module mapping notificationEngineEnabled = false blocks all channels
    sendEmailFn.mockClear();
    sendWhatsAppFn.mockClear();
    const blocked = await dispatchTicketAutomationNotifications(
      {
        event: 'REMINDER',
        rules,
        notificationEngineEnabled: false,
        readableId: 'FSM-SR-ACME-260001',
        title: 'Chiller fault',
        status: 'Assigned',
        priority: 'High',
        serviceTypeName: 'Air conditioning / HVAC',
        assignedTo: 'tech@acme.ae',
        recipientPhone: '+971501234567',
      },
      { sendEmailFn, sendWhatsAppFn, sendSmsFn },
    );
    expect(blocked.email.attempted).toBe(false);
    expect(blocked.whatsapp.attempted).toBe(false);
    expect(blocked.sms.attempted).toBe(false);
    expect(sendEmailFn).not.toHaveBeenCalled();
    expect(sendWhatsAppFn).not.toHaveBeenCalled();
  });
});
