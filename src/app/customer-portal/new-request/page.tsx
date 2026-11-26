'use client';

/** Customer Portal — New Request: the same five-section form as staff, locked to the signed-in company. */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { FormAlert } from '@/components/ui/form-kit';
import {
  NewServiceRequestForm, type RequestFormApi, type RequestTypeConfig,
} from '@/app/(app)/service-tickets/components/new-service-request-form';
import type { FormFieldDef, TicketType } from '@/types/service-tickets';
import { usePortal } from '../portal-shell';
import { canRaiseRequests } from '@/lib/customer-portal/catalog';

interface TypesResponse {
  typeConfig: Record<string, RequestTypeConfig>;
  formFields: Record<string, FormFieldDef[]>;
  channels: Array<{ value: string; label: string }>;
  entitlements: Array<{ value: string; label: string }>;
}

export default function CustomerPortalNewRequest() {
  const me = usePortal();
  const router = useRouter();
  const [types, setTypes] = useState<TypesResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch('/api/customer-portal/fsm/types', { cache: 'no-store' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) { setErr(data?.error ?? 'Could not load service types'); return; }
      setTypes(data);
    })();
  }, []);

  const api = useMemo<RequestFormApi | null>(() => (types && me ? {
    customersUrl: null,
    contextUrl: () => '/api/customer-portal/fsm/context',
    createUrl: '/api/customer-portal/fsm/requests',
    photosUrl: (id) => `/api/customer-portal/fsm/requests/${id}/attachments`,
    addSiteUrl: () => '/api/customer-portal/fsm/sites',
    addAssetUrl: () => '/api/customer-portal/fsm/assets',
    canAddSite: me.user.roles.FSM === 'ADMIN',
    canAddAsset: me.user.roles.FSM === 'ADMIN',
    channels: types.channels,
    entitlements: types.entitlements,
  } : null), [types, me]);

  if (me && !canRaiseRequests(me.user.roles.FSM)) {
    return <FormAlert tone="info">Your role can view requests but not raise them. Ask your company admin for Requester access.</FormAlert>;
  }
  if (err) return <FormAlert>{err}</FormAlert>;
  if (!types || !api || !me) return <div className="py-16 flex justify-center text-[var(--text-muted)]"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  if (Object.keys(types.typeConfig).length === 0) {
    return <FormAlert tone="info">No service types are available yet. Contact your service provider.</FormAlert>;
  }

  return (
    <NewServiceRequestForm
      enabledTypes={Object.keys(types.typeConfig) as TicketType[]}
      formFieldsByType={types.formFields as Partial<Record<TicketType, FormFieldDef[]>>}
      typeConfigByType={types.typeConfig as Partial<Record<TicketType, RequestTypeConfig>>}
      vehicles={[]}
      fixedCustomerId={me.customer.id}
      api={api}
      onCreated={(t) => router.push(`/customer-portal/requests?id=${t.id}`)}
      onCancel={() => router.push('/customer-portal')}
    />
  );
}
