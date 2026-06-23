'use client';

import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_RENTAL_MASTER_DATA, type RentalMasterCatalog } from '@/lib/rental-master-data';

export function useRentalMasterData() {
  const [masterData, setMasterData] = useState<RentalMasterCatalog>(DEFAULT_RENTAL_MASTER_DATA);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/rental/master-data', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load rental master data');
      const json = await res.json();
      if (json?.catalog) {
        setMasterData(json.catalog as RentalMasterCatalog);
      }
    } catch {
      setMasterData(DEFAULT_RENTAL_MASTER_DATA);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { masterData, loading, reload: load };
}
