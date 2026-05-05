'use client';
import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

export interface Branch {
  id: string;
  tenant_id: string;
  tenant_name?: string;
  tenant_code?: string;
  tenant_trn?: string;
  branch_name: string;
  emirate: string;
  trade_license_no?: string;
  trade_license_authority?: string;
  trade_license_expiry?: string;
  billing_address?: string;
  billing_city?: string;
  billing_po_box?: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  cost_center_code?: string;
  is_default: boolean;
  is_active: boolean;
  invoice_count: number;
  vehicle_count: number;
}

export const EMIRATE_LABELS: Record<string, string> = {
  ABU_DHABI:      'Abu Dhabi',
  DUBAI:          'Dubai',
  SHARJAH:        'Sharjah',
  AJMAN:          'Ajman',
  UMM_AL_QUWAIN: 'Umm Al Quwain',
  RAS_AL_KHAIMAH: 'Ras Al Khaimah',
  FUJAIRAH:       'Fujairah',
};

export const EMIRATE_FLAGS: Record<string, string> = {
  ABU_DHABI:      '🏛️',
  DUBAI:          '🏙️',
  SHARJAH:        '🕌',
  AJMAN:          '⛵',
  UMM_AL_QUWAIN: '🌿',
  RAS_AL_KHAIMAH: '⛰️',
  FUJAIRAH:       '🌊',
};

interface BranchContextValue {
  branches:         Branch[];
  activeBranch:     Branch | null;  // null = "All Branches"
  setActiveBranch:  (branch: Branch | null) => void;
  loadBranches:     (tenantId?: string) => Promise<void>;
  loading:          boolean;
  activeTenantId:   string | null;
  setActiveTenantId:(id: string | null) => void;
}

const BranchContext = createContext<BranchContextValue>({
  branches:         [],
  activeBranch:     null,
  setActiveBranch:  () => {},
  loadBranches:     async () => {},
  loading:          false,
  activeTenantId:   null,
  setActiveTenantId:() => {},
});

const STORAGE_KEY_BRANCH   = 'xlai_active_branch_id';
const STORAGE_KEY_TENANT   = 'xlai_active_tenant_id';

export function BranchProvider({ children }: { children: ReactNode }) {
  const [branches,       setBranches]       = useState<Branch[]>([]);
  const [activeBranch,   setActiveBranchState] = useState<Branch | null>(null);
  const [loading,        setLoading]        = useState(false);
  const [activeTenantId, setActiveTenantIdState] = useState<string | null>(null);

  // Persist active branch
  const setActiveBranch = useCallback((branch: Branch | null) => {
    setActiveBranchState(branch);
    if (branch) {
      localStorage.setItem(STORAGE_KEY_BRANCH, branch.id);
    } else {
      localStorage.removeItem(STORAGE_KEY_BRANCH);
    }
  }, []);

  const setActiveTenantId = useCallback((id: string | null) => {
    setActiveTenantIdState(id);
    if (id) {
      localStorage.setItem(STORAGE_KEY_TENANT, id);
    } else {
      localStorage.removeItem(STORAGE_KEY_TENANT);
    }
  }, []);

  const loadBranches = useCallback(async (tenantId?: string) => {
    const tid = tenantId ?? activeTenantId;
    if (!tid) {
      setBranches([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/tenant-branches?tenantId=${tid}`);
      if (res.ok) {
        const data = await res.json();
        const list: Branch[] = data.data ?? [];
        setBranches(list);

        // Restore persisted branch selection
        const savedId = localStorage.getItem(STORAGE_KEY_BRANCH);
        if (savedId) {
          const found = list.find(b => b.id === savedId);
          if (found) setActiveBranchState(found);
        }
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [activeTenantId]);

  // Restore tenant from storage on mount
  useEffect(() => {
    const savedTenant = localStorage.getItem(STORAGE_KEY_TENANT);
    if (savedTenant) {
      setActiveTenantIdState(savedTenant);
      loadBranches(savedTenant);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <BranchContext.Provider value={{
      branches, activeBranch, setActiveBranch,
      loadBranches, loading,
      activeTenantId, setActiveTenantId,
    }}>
      {children}
    </BranchContext.Provider>
  );
}

export function useBranch() {
  return useContext(BranchContext);
}
