'use client';
/**
 * Show a linked vehicle or driver by its plate / name instead of its internal
 * ID. The tenant's vehicle and driver lists are fetched once per session
 * (useFetchedData cache) and shared by every reference on the page; a record
 * that is not found falls back to its short internal ID (see display-id.ts).
 */
import React from 'react';
import { useFetchedData } from '@/hooks/useFetchedData';
import { shortId } from '@/lib/ui/display-id';

interface VehicleRow { id: string; licensePlate?: string | null; plateNumber?: string | null; make?: string | null; model?: string | null }
interface DriverRow { id: string; name?: string | null; firstName?: string | null; lastName?: string | null; employeeCode?: string | null }

const listOf = <T,>(d: unknown): T[] =>
  Array.isArray(d) ? (d as T[]) : Array.isArray((d as { data?: unknown })?.data) ? ((d as { data: T[] }).data) : [];

export function useVehicleLabel(id: string | null | undefined): string {
  const { data } = useFetchedData<unknown>(id ? '/api/vehicles' : null);
  if (!id) return '—';
  const v = listOf<VehicleRow>(data).find((x) => x.id === id);
  const label = v?.licensePlate || v?.plateNumber || [v?.make, v?.model].filter(Boolean).join(' ');
  return label || shortId(id);
}

export function useDriverLabel(id: string | null | undefined): string {
  const { data } = useFetchedData<unknown>(id ? '/api/drivers' : null);
  if (!id) return '—';
  const d = listOf<DriverRow>(data).find((x) => x.id === id);
  const label = d?.name || [d?.firstName, d?.lastName].filter(Boolean).join(' ') || d?.employeeCode;
  return label || shortId(id);
}

/** A vehicle by plate (or make and model); short internal ID when unknown. */
export function VehicleRef({ id }: { id: string | null | undefined }) {
  return <>{useVehicleLabel(id)}</>;
}

/** A driver by name; short internal ID when unknown. */
export function DriverRef({ id }: { id: string | null | undefined }) {
  return <>{useDriverLabel(id)}</>;
}
