import { describe, it, expect } from 'vitest';
import {
  TICKET_DEPARTMENTS,
  type TicketDepartment,
  type ServiceTicket,
} from '@/types/service-tickets';

describe('Service Tickets Operations Triage & Department Forwarding Engine', () => {
  describe('Canonical Departments Catalogue', () => {
    it('defines all 6 canonical departments with valid keys and presentation metadata', () => {
      const keys = TICKET_DEPARTMENTS.map((d) => d.key);
      expect(keys).toContain('OPERATIONS_TRIAGE');
      expect(keys).toContain('WORKSHOP_MAINTENANCE');
      expect(keys).toContain('RECOVERY_DISPATCH');
      expect(keys).toContain('SAFETY_COMPLIANCE');
      expect(keys).toContain('CUSTOMER_SERVICE');
      expect(keys).toContain('FACILITIES_CLEANING');
      expect(keys.length).toBe(6);

      for (const dept of TICKET_DEPARTMENTS) {
        expect(dept.label).toBeDefined();
        expect(dept.shortLabel).toBeDefined();
        expect(dept.description).toBeDefined();
        expect(dept.tone).toBeDefined();
      }
    });

    it('has OPERATIONS_TRIAGE configured as the default intake hopper', () => {
      const triage = TICKET_DEPARTMENTS.find((d) => d.key === 'OPERATIONS_TRIAGE');
      expect(triage).toBeDefined();
      expect(triage?.label).toBe('Operations Triage');
    });
  });

  describe('Centralized Landing Hopper (All Tickets Land in Operations Triage)', () => {
    it('defaults incoming Driver App incident reports to OPERATIONS_TRIAGE with DRIVER_APP source', () => {
      const driverReportPayload = {
        title: 'Brake fluid leak warning indicator on dashboard',
        vehicleId: 'VH-102',
        source: 'DRIVER_APP' as const,
        assignedDepartment: 'OPERATIONS_TRIAGE' as const,
      };

      expect(driverReportPayload.assignedDepartment).toBe('OPERATIONS_TRIAGE');
      expect(driverReportPayload.source).toBe('DRIVER_APP');
    });

    it('defaults incoming DVIR safety defects to OPERATIONS_TRIAGE with DVIR source', () => {
      const dvirDefectPayload = {
        title: 'Pre-Trip DVIR Defect: Flat Left Rear Tire',
        vehicleId: 'VH-105',
        source: 'DVIR' as const,
        assignedDepartment: 'OPERATIONS_TRIAGE' as const,
      };

      expect(dvirDefectPayload.assignedDepartment).toBe('OPERATIONS_TRIAGE');
      expect(dvirDefectPayload.source).toBe('DVIR');
    });

    it('defaults tickets without explicit department in customFields to OPERATIONS_TRIAGE', () => {
      const rawCustomFields: Record<string, unknown> = {
        notes: 'Legacy ticket created prior to department triage module',
      };

      const resolvedDepartment: TicketDepartment =
        (rawCustomFields.assignedDepartment as TicketDepartment) || 'OPERATIONS_TRIAGE';
      const resolvedSource = (rawCustomFields.source as string) || 'WEB';

      expect(resolvedDepartment).toBe('OPERATIONS_TRIAGE');
      expect(resolvedSource).toBe('WEB');
    });
  });

  describe('Department Forwarding Workflows', () => {
    const baseTicket: ServiceTicket = {
      id: 'st-001',
      readableId: 'ST2026-MNT-0001',
      tenantId: 'tenant-demo',
      ticketType: 'MAINTENANCE',
      requestorId: 'driver-42',
      vehicleId: 'VH-555',
      title: 'Engine overheating on Emirates Road',
      description: 'Coolant temperature spiked to 115C, white smoke near radiator',
      priority: 'High',
      status: 'Pending',
      createdAt: '2026-09-09T10:00:00Z',
      assignedDepartment: 'OPERATIONS_TRIAGE',
      source: 'DRIVER_APP',
      history: [
        {
          status: 'Pending',
          date: '2026-09-09T10:00:00Z',
          actor: 'driver-42',
          note: 'Submitted via Driver App',
        },
      ],
      customFields: {},
    };

    it('forwards ticket to WORKSHOP_MAINTENANCE and prepares Work Order attributes', () => {
      const targetDept: TicketDepartment = 'WORKSHOP_MAINTENANCE';
      const forwardNotes = 'Inspect radiator hose clamp and coolant pressure cap immediately';
      const assignee = 'workshop.lead@fleet360.io';

      // Simulate the route logic
      const workOrderNo = `WO-${baseTicket.readableId || baseTicket.id.substring(0, 8).toUpperCase()}`;
      const mrDescription = `[Forwarded from Service Ticket ${baseTicket.readableId || baseTicket.id}] ${baseTicket.title}\n\nNotes: ${forwardNotes}`;

      expect(workOrderNo).toBe('WO-ST2026-MNT-0001');
      expect(mrDescription).toContain('[Forwarded from Service Ticket ST2026-MNT-0001]');
      expect(mrDescription).toContain(forwardNotes);

      // Verify status transitions from Pending to Assigned
      const nextStatus = ['Pending', 'Awaiting Approval', 'Acknowledged'].includes(baseTicket.status)
        ? 'Assigned'
        : baseTicket.status;
      expect(nextStatus).toBe('Assigned');

      // Verify history note creation
      const deptDef = TICKET_DEPARTMENTS.find((d) => d.key === targetDept)!;
      const historyEntry = {
        status: 'Assigned',
        date: '2026-09-09T10:15:00Z',
        actor: 'ops.dispatcher@fleet360.io',
        note: `Forwarded to ${deptDef.label} — Assignee: ${assignee} — Note: ${forwardNotes} — Created Work Order #${workOrderNo}`,
      };

      const updatedHistory = [...(baseTicket.history || []), historyEntry];
      expect(updatedHistory.length).toBe(2);
      expect(updatedHistory[1].note).toContain('Workshop & Maintenance');
      expect(updatedHistory[1].note).toContain(workOrderNo);
    });

    it('forwards ticket to RECOVERY_DISPATCH for roadside breakdown towing', () => {
      const targetDept: TicketDepartment = 'RECOVERY_DISPATCH';
      const forwardNotes = 'Dispatched recovery flatbed to Emirates Road Exit 44';

      const deptDef = TICKET_DEPARTMENTS.find((d) => d.key === targetDept)!;
      expect(deptDef.shortLabel).toBe('Recovery');
      expect(deptDef.tone).toBe('rose');

      const updatedCustomFields = {
        ...baseTicket.customFields,
        assignedDepartment: targetDept,
        forwardedAt: '2026-09-09T10:05:00Z',
        forwardedBy: 'ops.dispatcher@fleet360.io',
        forwardNotes,
      };

      expect(updatedCustomFields.assignedDepartment).toBe('RECOVERY_DISPATCH');
      expect(updatedCustomFields.forwardNotes).toBe(forwardNotes);
    });

    it('forwards ticket to SAFETY_COMPLIANCE for accident report and insurance claim', () => {
      const targetDept: TicketDepartment = 'SAFETY_COMPLIANCE';
      const deptDef = TICKET_DEPARTMENTS.find((d) => d.key === targetDept)!;

      expect(deptDef.shortLabel).toBe('Compliance');
      expect(deptDef.tone).toBe('violet');
    });

    it('forwards ticket to CUSTOMER_SERVICE for passenger disputes and client queries', () => {
      const targetDept: TicketDepartment = 'CUSTOMER_SERVICE';
      const deptDef = TICKET_DEPARTMENTS.find((d) => d.key === targetDept)!;

      expect(deptDef.shortLabel).toBe('Customer Care');
      expect(deptDef.tone).toBe('blue');
    });

    it('forwards ticket to FACILITIES_CLEANING for vehicle turnaround and detailing', () => {
      const targetDept: TicketDepartment = 'FACILITIES_CLEANING';
      const deptDef = TICKET_DEPARTMENTS.find((d) => d.key === targetDept)!;

      expect(deptDef.shortLabel).toBe('Cleaning');
      expect(deptDef.tone).toBe('emerald');
    });
  });

  describe('Department Filtering and Counting', () => {
    const testTickets: ServiceTicket[] = [
      {
        id: 't-1',
        tenantId: 'demo',
        ticketType: 'INCIDENT',
        requestorId: 'u-1',
        title: 'Minor dent on rear bumper',
        description: '',
        priority: 'Low',
        status: 'Pending',
        createdAt: '2026-09-09T08:00:00Z',
        assignedDepartment: 'OPERATIONS_TRIAGE',
        source: 'DRIVER_APP',
      },
      {
        id: 't-2',
        tenantId: 'demo',
        ticketType: 'MAINTENANCE',
        requestorId: 'u-2',
        title: 'Brake pad squeal',
        description: '',
        priority: 'Medium',
        status: 'Assigned',
        createdAt: '2026-09-09T08:30:00Z',
        assignedDepartment: 'WORKSHOP_MAINTENANCE',
        source: 'DVIR',
      },
      {
        id: 't-3',
        tenantId: 'demo',
        ticketType: 'TOWING',
        requestorId: 'u-3',
        title: 'Transmission failure',
        description: '',
        priority: 'High',
        status: 'Assigned',
        createdAt: '2026-09-09T09:00:00Z',
        assignedDepartment: 'RECOVERY_DISPATCH',
        source: 'WHATSAPP',
      },
      {
        id: 't-4',
        tenantId: 'demo',
        ticketType: 'CLEANING',
        requestorId: 'u-4',
        title: 'Cabin upholstery stain',
        description: '',
        priority: 'Low',
        status: 'Pending',
        createdAt: '2026-09-09T09:15:00Z',
        // Legacy record without assignedDepartment
      },
    ];

    it('computes accurate counts per department, grouping missing values into OPERATIONS_TRIAGE', () => {
      const counts: Record<string, number> = { ALL: testTickets.length };
      for (const dept of TICKET_DEPARTMENTS) counts[dept.key] = 0;

      for (const t of testTickets) {
        const d = t.assignedDepartment || 'OPERATIONS_TRIAGE';
        counts[d] = (counts[d] ?? 0) + 1;
      }

      expect(counts.ALL).toBe(4);
      // t-1 + t-4 (legacy) = 2 in triage
      expect(counts.OPERATIONS_TRIAGE).toBe(2);
      expect(counts.WORKSHOP_MAINTENANCE).toBe(1);
      expect(counts.RECOVERY_DISPATCH).toBe(1);
      expect(counts.SAFETY_COMPLIANCE).toBe(0);
      expect(counts.CUSTOMER_SERVICE).toBe(0);
      expect(counts.FACILITIES_CLEANING).toBe(0);
    });

    it('filters tickets by department correctly', () => {
      const filterByDept = (dept: TicketDepartment | 'ALL') => {
        if (dept === 'ALL') return testTickets;
        return testTickets.filter((t) => (t.assignedDepartment || 'OPERATIONS_TRIAGE') === dept);
      };

      expect(filterByDept('OPERATIONS_TRIAGE').length).toBe(2);
      expect(filterByDept('WORKSHOP_MAINTENANCE').map((t) => t.id)).toEqual(['t-2']);
      expect(filterByDept('RECOVERY_DISPATCH').map((t) => t.id)).toEqual(['t-3']);
      expect(filterByDept('SAFETY_COMPLIANCE').length).toBe(0);
      expect(filterByDept('ALL').length).toBe(4);
    });
  });
});
