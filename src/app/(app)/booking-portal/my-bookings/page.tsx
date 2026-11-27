'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { MyServiceRequests } from './my-service-requests';

interface BookingAttachment {
  url: string;
  originalName: string;
  label?: string;
}

interface UserBooking {
  id: string;
  bookingRef: string;
  serviceType: string;
  vehicleCategory: string;
  startDate: string;
  endDate: string;
  status: 'Pending' | 'Approved' | 'Completed' | 'Rejected';
  rawStatus: string;
  createdDate: string;
  notes: string;
  attachments: BookingAttachment[];
}

function extractBookingAttachments(rawNotes: unknown): BookingAttachment[] {
  if (typeof rawNotes !== 'string' || !rawNotes.trim().startsWith('{')) return [];
  try {
    const parsed = JSON.parse(rawNotes) as { attachments?: unknown };
    if (!Array.isArray(parsed.attachments)) return [];
    return parsed.attachments
      .filter((a): a is BookingAttachment => !!a && typeof a === 'object' && typeof (a as BookingAttachment).url === 'string')
      .map((a) => ({
        url: a.url,
        originalName: typeof a.originalName === 'string' ? a.originalName : 'Attachment',
        label: typeof a.label === 'string' ? a.label : undefined,
      }));
  } catch {
    return [];
  }
}

function normalizeStatus(raw: string): UserBooking['status'] {
  const upper = (raw || '').toUpperCase();
  if (['APPROVED', 'CONFIRMED', 'ACTIVE', 'IN_PROGRESS', 'DISPATCHED'].includes(upper)) {
    return 'Approved';
  }
  if (upper === 'COMPLETED') {
    return 'Completed';
  }
  if (['REJECTED', 'CANCELLED', 'FAILED'].includes(upper)) {
    return 'Rejected';
  }
  return 'Pending';
}

function formatBookingNotes(rawNotes: unknown): string {
  if (!rawNotes) return '';
  if (typeof rawNotes !== 'string') return '';
  const trimmed = rawNotes.trim();
  if (!trimmed.startsWith('{')) return trimmed;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const parts: string[] = [];
    if (parsed.pickupLocation || parsed.origin) {
      parts.push(`From: ${String(parsed.pickupLocation ?? parsed.origin)}`);
    }
    if (parsed.dropoffLocation || parsed.destination) {
      parts.push(`To: ${String(parsed.dropoffLocation ?? parsed.destination)}`);
    }
    if (parsed.totalFareAed) {
      parts.push(`Fare: AED ${Number(parsed.totalFareAed).toFixed(2)}`);
    }
    if (parsed.costCenter) {
      parts.push(`Cost Center: ${String(parsed.costCenter)}`);
    } else if (parsed.renterAccountType === 'PERSONAL') {
      parts.push('Personal / Walk-in');
    }
    if (Array.isArray(parsed.attachments) && parsed.attachments.length > 0) {
      parts.push(`Attachments: ${parsed.attachments.length} file(s)`);
    }
    if (parsed.specialInstructions || parsed.rawNotes) {
      parts.push(String(parsed.specialInstructions ?? parsed.rawNotes));
    }
    return parts.join(' · ');
  } catch {
    return trimmed;
  }
}

export default function MyBookings() {
  const [bookings, setBookings] = useState<UserBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState('');

  useEffect(() => {
    const fetchMyBookings = async () => {
      try {
        setLoading(true);
        setError('');
        const res = await fetch('/api/bookings');
        if (!res.ok) throw new Error('Failed to fetch bookings');
        const data = await res.json();
        const rows: Record<string, unknown>[] = Array.isArray(data)
          ? data
          : Array.isArray(data?.bookings)
            ? data.bookings
            : Array.isArray(data?.data)
              ? data.data
              : [];

        const normalized: UserBooking[] = rows.map((r) => {
          const rawStatus = String(r.status ?? 'PENDING');
          return {
            id: String(r.id ?? ''),
            bookingRef: String(r.bookingRef ?? r.booking_ref ?? r.id ?? '—'),
            serviceType: String(r.serviceType ?? r.service_type ?? 'RENTAL'),
            vehicleCategory: String(r.vehicleCategory ?? r.vehicle_category ?? 'Standard'),
            startDate: String(r.startDate ?? r.start_date ?? new Date().toISOString()),
            endDate: String(r.endDate ?? r.end_date ?? r.startDate ?? new Date().toISOString()),
            status: normalizeStatus(rawStatus),
            rawStatus,
            createdDate: String(r.createdDate ?? r.createdAt ?? r.created_at ?? new Date().toISOString()),
            notes: formatBookingNotes(r.notes),
            attachments: extractBookingAttachments(r.notes),
          };
        });
        setBookings(normalized);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load bookings');
      } finally {
        setLoading(false);
      }
    };

    fetchMyBookings();
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Pending':
        return 'bg-amber-500/20 text-amber-400 border border-amber-500/30';
      case 'Approved':
        return 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
      case 'Rejected':
        return 'bg-red-500/20 text-red-400 border border-red-500/30';
      case 'Completed':
        return 'bg-slate-500/20 text-[var(--text-muted)] border border-slate-500/30';
      default:
        return 'bg-slate-500/20 text-[var(--text-muted)] border border-slate-500/30';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'Pending':
        return '⏳';
      case 'Approved':
        return '✓';
      case 'Rejected':
        return '✕';
      case 'Completed':
        return '✓';
      default:
        return '○';
    }
  };

  const groupedBookings = {
    active: bookings.filter((b) => ['Pending', 'Approved'].includes(b.status)),
    completed: bookings.filter((b) => b.status === 'Completed'),
    rejected: bookings.filter((b) => b.status === 'Rejected'),
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin">
          <div className="w-12 h-12 border-4 border-[var(--border-subtle)] border-t-violet-500 rounded-full"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-8">
        <MyServiceRequests />
        <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-6 text-red-400">
          <p className="font-medium">Error loading bookings</p>
          <p className="text-sm mt-1">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[var(--text-main)] mb-2">My Requests</h1>
          <p className="text-[var(--text-muted)]">Your service requests and transport bookings in one place</p>
        </div>
        <Link href="/booking-portal/new">
          <button className="rounded-lg bg-blue-600 hover:bg-blue-500 px-6 py-2.5 text-xs font-bold text-white shadow-sm transition-colors">
            + New Booking
          </button>
        </Link>
      </div>

      <MyServiceRequests />

      <h2 className="text-xl font-bold text-[var(--text-main)] pt-2">Transport bookings</h2>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-[var(--bg-main)] border border-[var(--border-subtle)] rounded-2xl p-6">
          <p className="text-[var(--text-muted)] text-sm font-medium mb-2">Total Bookings</p>
          <p className="text-3xl font-bold text-[var(--text-main)]">{bookings.length}</p>
        </div>
        <div className="bg-[var(--bg-main)] border border-[var(--border-subtle)] rounded-2xl p-6">
          <p className="text-[var(--text-muted)] text-sm font-medium mb-2">Pending/Active</p>
          <p className="text-3xl font-bold text-amber-400">{groupedBookings.active.length}</p>
        </div>
        <div className="bg-[var(--bg-main)] border border-[var(--border-subtle)] rounded-2xl p-6">
          <p className="text-[var(--text-muted)] text-sm font-medium mb-2">Completed</p>
          <p className="text-3xl font-bold text-emerald-400">{groupedBookings.completed.length}</p>
        </div>
        <div className="bg-[var(--bg-main)] border border-[var(--border-subtle)] rounded-2xl p-6">
          <p className="text-[var(--text-muted)] text-sm font-medium mb-2">Rejected</p>
          <p className="text-3xl font-bold text-red-400">{groupedBookings.rejected.length}</p>
        </div>
      </div>

      {/* Active Bookings */}
      {groupedBookings.active.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-2xl font-bold text-[var(--text-main)]">Active Bookings</h2>
          <div className="space-y-4">
            {groupedBookings.active.map((booking) => (
              <div key={booking.id} className="bg-[var(--bg-main)] border border-[var(--border-subtle)] rounded-2xl overflow-hidden">
                <div
                  onClick={() => setExpandedId(expandedId === booking.id ? '' : booking.id)}
                  className="p-6 cursor-pointer hover:bg-[var(--bg-main)] transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4 flex-1">
                      <div className="text-3xl">{getStatusIcon(booking.status)}</div>
                      <div>
                        <p className="text-sm text-[var(--text-muted)]">Booking Reference</p>
                        <p className="text-xl font-mono font-bold text-[var(--text-main)]">{booking.bookingRef}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(booking.status)}`}>
                        {booking.status}
                      </span>
                    </div>
                  </div>
                </div>

                {expandedId === booking.id && (
                  <div className="border-t border-[var(--border-subtle)] p-6 bg-[var(--bg-surface)]">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div>
                        <p className="text-sm text-[var(--text-muted)] mb-1">Service Type</p>
                        <p className="text-[var(--text-main)] font-medium">{booking.serviceType}</p>
                      </div>
                      <div>
                        <p className="text-sm text-[var(--text-muted)] mb-1">Vehicle Category</p>
                        <p className="text-[var(--text-main)] font-medium">{booking.vehicleCategory}</p>
                      </div>
                      <div>
                        <p className="text-sm text-[var(--text-muted)] mb-1">Created Date</p>
                        <p className="text-[var(--text-main)] font-medium">{new Date(booking.createdDate).toLocaleDateString()}</p>
                      </div>
                      <div>
                        <p className="text-sm text-[var(--text-muted)] mb-1">Start Date</p>
                        <p className="text-[var(--text-main)] font-medium">{new Date(booking.startDate).toLocaleDateString()}</p>
                      </div>
                      <div>
                        <p className="text-sm text-[var(--text-muted)] mb-1">End Date</p>
                        <p className="text-[var(--text-main)] font-medium">{new Date(booking.endDate).toLocaleDateString()}</p>
                      </div>
                      <div>
                        <p className="text-sm text-[var(--text-muted)] mb-1">Duration</p>
                        <p className="text-[var(--text-main)] font-medium">
                          {Math.max(1, Math.ceil((new Date(booking.endDate).getTime() - new Date(booking.startDate).getTime()) / (1000 * 60 * 60 * 24)))} days
                        </p>
                      </div>
                    </div>
                    {booking.notes && (
                      <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]">
                        <p className="text-sm text-[var(--text-muted)] mb-2">Notes</p>
                        <p className="text-[var(--text-main)]">{booking.notes}</p>
                      </div>
                    )}
                    {booking.attachments.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]">
                        <p className="text-sm text-[var(--text-muted)] mb-2">
                          Attached Documents ({booking.attachments.length})
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {booking.attachments.map((att, idx) => (
                            <a
                              key={`${att.url}-${idx}`}
                              href={att.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] hover:border-blue-500/40 text-xs font-medium text-[var(--text-main)] transition-colors"
                            >
                              <span>📎</span>
                              <span>{att.label ? `${att.label}: ${att.originalName}` : att.originalName}</span>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Completed Bookings */}
      {groupedBookings.completed.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-2xl font-bold text-[var(--text-main)]">Completed Bookings</h2>
          <div className="space-y-2">
            {groupedBookings.completed.map((booking) => (
              <div key={booking.id} className="bg-[var(--bg-main)] border border-[var(--border-subtle)] rounded-xl p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <span className="text-2xl">✓</span>
                  <div>
                    <p className="text-[var(--text-main)] font-mono font-medium">{booking.bookingRef}</p>
                    <p className="text-xs text-[var(--text-muted)]">{booking.serviceType}</p>
                  </div>
                </div>
                <span className="text-xs text-[var(--text-muted)]">{new Date(booking.startDate).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rejected Bookings */}
      {groupedBookings.rejected.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-2xl font-bold text-[var(--text-main)]">Rejected Bookings</h2>
          <div className="space-y-2">
            {groupedBookings.rejected.map((booking) => (
              <div key={booking.id} className="bg-red-500/5 border border-red-500/20 rounded-xl p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <span className="text-2xl">✕</span>
                  <div>
                    <p className="text-[var(--text-main)] font-mono font-medium">{booking.bookingRef}</p>
                    <p className="text-xs text-[var(--text-muted)]">{booking.serviceType}</p>
                  </div>
                </div>
                <span className="text-xs text-[var(--text-muted)]">{new Date(booking.createdDate).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {bookings.length === 0 && (
        <div className="text-center py-20">
          <div className="text-6xl mb-4">📭</div>
          <h2 className="text-2xl font-bold text-[var(--text-main)] mb-2">No Bookings Yet</h2>
          <p className="text-[var(--text-muted)] mb-6">Start by creating your first transport booking</p>
          <Link href="/booking-portal/new">
            <button className="rounded-lg bg-blue-600 hover:bg-blue-500 px-8 py-2.5 text-xs font-bold text-white shadow-sm transition-colors">
              Create New Booking
            </button>
          </Link>
        </div>
      )}
    </div>
  );
}
