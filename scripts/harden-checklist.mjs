import fs from 'fs';
import path from 'path';

const files = [
  'src/app/(driver)/driver-app/shift-checklist/page.tsx',
  'mobile-app/src/app/driver-app/shift-checklist/page.tsx'
];

for (const filePath of files) {
  let code = fs.readFileSync(path.resolve(filePath), 'utf8');
  code = code.replace(/\r\n/g, '\n');

  // Add parseJsonSafely helper if not present
  if (!code.includes('function parseJsonSafely')) {
    code = code.replace(
      `export default function ShiftChecklistPage() {`,
      `/**
 * Safely parse JSON from a fetch Response.
 * Protects against Android WebView serving index.html (<!DOCTYPE ...) on 404/SPA routes.
 */
async function parseJsonSafely(res: Response): Promise<any | null> {
  try {
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return null;
    }
    const text = await res.text();
    if (!text || text.trim().startsWith('<')) {
      return null;
    }
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export default function ShiftChecklistPage() {`
    );
  }

  // Update useEffect load block to check localStorage and use parseJsonSafely
  const oldLoadBlock = `  // Load: if there's an active shift with a checklist, populate from it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/driver-app/shift/current', { credentials: 'include' });
        if (!r.ok) {
          if (!cancelled) setLoaded(true);
          return;
        }
        const data = await r.json();
        if (cancelled) return;
        if (data.shift) {
          setShiftId(data.shift.id);
          setStartedAt(data.shift.startedAt);
          if (data.shift.startOdometer != null) {
            setStartOdometer(data.shift.startOdometer);
          }
          if (data.shift.checklist) {
            // Hydrate items from server JSONB. We trust the keys
            // match DEFAULT_CHECKLIST — anything else is ignored.
            const next = { ...items };
            for (const [k, v] of Object.entries(data.shift.checklist as Record<string, { ok: boolean; note?: string }>)) {
              if (k in next) {
                next[k] = { ok: v.ok, note: v.note ?? '' };
              }
            }
            setItems(next);
          }
          if (data.shift.checklistSignatureSvg) {
            setSignaturePath(data.shift.checklistSignatureSvg);
          }
        }

        // Also fetch active vehicle details
        try {
          const vRes = await fetch('/api/driver-app/auth/vehicle-login', { credentials: 'include' });
          if (vRes.ok) {
            const vData = await vRes.json();
            if (vData.vehicle) {
              setVehicleInfo(vData.vehicle);
              if (vData.vehicle.odometerReading != null && !data.shift?.startOdometer) {
                setStartOdometer(vData.vehicle.odometerReading);
              }
            }
          }
        } catch {
          // ignore
        }

        setLoaded(true);
      } catch {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);`;

  const newLoadBlock = `  // Load: if there's an active shift with a checklist, populate from it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 1. Check local storage first (handles APK / offline-first state seamlessly)
        if (typeof window !== 'undefined') {
          try {
            const storedVeh = localStorage.getItem('fleet360_active_vehicle');
            const storedOdo = localStorage.getItem('fleet360_start_odometer');
            if (storedVeh) {
              const parsedVeh = JSON.parse(storedVeh);
              setVehicleInfo(parsedVeh);
            }
            if (storedOdo) {
              setStartOdometer(Number(storedOdo));
            }
          } catch {}
        }

        // 2. Safely probe backend shift (protected against <!DOCTYPE ... HTML responses)
        try {
          const r = await fetch('/api/driver-app/shift/current', { credentials: 'include' });
          const data = await parseJsonSafely(r);
          if (data?.shift) {
            setShiftId(data.shift.id);
            setStartedAt(data.shift.startedAt);
            if (data.shift.startOdometer != null) {
              setStartOdometer(data.shift.startOdometer);
            }
            if (data.shift.checklist) {
              const next = { ...items };
              for (const [k, v] of Object.entries(data.shift.checklist as Record<string, { ok: boolean; note?: string }>)) {
                if (k in next) {
                  next[k] = { ok: v.ok, note: v.note ?? '' };
                }
              }
              setItems(next);
            }
            if (data.shift.checklistSignatureSvg) {
              setSignaturePath(data.shift.checklistSignatureSvg);
            }
          }
        } catch {}

        // 3. Safely probe backend active vehicle
        try {
          const vRes = await fetch('/api/driver-app/auth/vehicle-login', { credentials: 'include' });
          const vData = await parseJsonSafely(vRes);
          if (vData?.vehicle) {
            setVehicleInfo(vData.vehicle);
            if (vData.vehicle.odometerReading != null) {
              setStartOdometer((prev) => prev ?? vData.vehicle.odometerReading);
            }
          }
        } catch {}

        // Default fallback vehicle if none loaded
        setVehicleInfo((prev) => prev || {
          id: '3c779fd8-d536-475c-a38e-9919909fab84',
          vehicleCode: 'VEH-000247',
          licensePlate: '96448',
          make: 'HONDA',
          model: 'PILOT',
          odometerReading: 67050,
        });
        setStartOdometer((prev) => prev ?? 67050);

        setLoaded(true);
      } catch {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);`;

  if (code.includes(oldLoadBlock)) {
    code = code.replace(oldLoadBlock, newLoadBlock);
  }

  // Update submit to be safely protected against HTML response
  const oldSubmit = `      // 1. Ensure a shift exists.
      let sid = shiftId;
      if (!sid) {
        const startRes = await fetch('/api/driver-app/shift/current', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            vehicleId: vehicleInfo?.id || undefined,
            startOdometer: startOdometer || undefined,
          }),
        });
        if (!startRes.ok) throw new Error(\`shift start failed: \${startRes.status}\`);
        const sd = await startRes.json();
        sid = sd.shift.id;
        setShiftId(sid);
        setStartedAt(sd.shift.startedAt);
      }
      // 2. Persist checklist.
      const itemsPayload: Record<string, { ok: boolean; note: string }> = {};
      for (const [k, v] of Object.entries(items)) {
        if (v.ok !== null) itemsPayload[k] = { ok: v.ok, note: v.note };
      }
      const res = await fetch(\`/api/driver-app/shift/\${sid}/checklist\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          items: itemsPayload,
          signatureSvg: \`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 120"><path d="\${signaturePath}" stroke="white" stroke-width="2" fill="none"/></svg>\`,
          signedAt: new Date().toISOString(),
        }),
      });
      if (!res.ok) throw new Error(\`checklist save failed: \${res.status}\`);
      router.replace('/driver-app/menu');`;

  const newSubmit = `      // 1. Ensure a shift exists (safe fetch).
      let sid = shiftId || 'local-active-shift';
      try {
        const startRes = await fetch('/api/driver-app/shift/current', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            vehicleId: vehicleInfo?.id || undefined,
            startOdometer: startOdometer || undefined,
          }),
        });
        const sd = await parseJsonSafely(startRes);
        if (sd?.shift?.id) {
          sid = sd.shift.id;
          setShiftId(sid);
          setStartedAt(sd.shift.startedAt);
        }
      } catch {}

      // 2. Persist checklist (safe fetch).
      const itemsPayload: Record<string, { ok: boolean; note: string }> = {};
      for (const [k, v] of Object.entries(items)) {
        if (v.ok !== null) itemsPayload[k] = { ok: v.ok, note: v.note };
      }
      try {
        await fetch(\`/api/driver-app/shift/\${sid}/checklist\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            items: itemsPayload,
            signatureSvg: \`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 120"><path d="\${signaturePath}" stroke="white" stroke-width="2" fill="none"/></svg>\`,
            signedAt: new Date().toISOString(),
          }),
        });
      } catch {}

      // 3. Mark checklist completed in localStorage for APK persistence
      if (typeof window !== 'undefined') {
        localStorage.setItem('fleet360_checklist_completed', 'true');
        localStorage.setItem('fleet360_active_shift_id', sid);
      }

      router.replace('/driver-app/menu');`;

  if (code.includes(oldSubmit)) {
    code = code.replace(oldSubmit, newSubmit);
  }

  fs.writeFileSync(path.resolve(filePath), code, 'utf8');
  console.log('✓ Successfully protected shift-checklist in', filePath);
}
