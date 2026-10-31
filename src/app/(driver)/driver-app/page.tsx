/**
 * src/app/(driver)/driver-app/page.tsx
 *
 * Driver Mobile App Launcher & Live Vehicle Telematics Hub.
 *
 * Designed to work seamlessly in both:
 *   1. Full-stack Web Browser (SSR/API)
 *   2. Android APK (Capacitor WebView / Local Asset Server / Offline-First)
 *
 * Flow:
 *   1. Driver enters Username & Password (or Biometric auth).
 *   2. Immediately prompts to select/confirm Vehicle ID & enter Starting Odometer.
 *   3. If the driver has a vehicle assigned in their profile, pre-selects it.
 *      If the driver is NOT assigned to any vehicle, defaults to a blank value
 *      column where the driver can enter their Vehicle ID / License Plate to login.
 *   4. Submits vehicle session & starts shift with startOdometer.
 *   5. Immediately transitions driver to the Driver Checklist (/driver-app/shift-checklist).
 */

'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useMobileI18n, MobileLanguage } from '@/contexts/MobileLanguageContext';
import { useMobileTheme } from '@/contexts/MobileThemeContext';
import { getApiEndpoint, parseJsonSafely } from '@/lib/api-endpoint';
import { useRouter } from 'next/navigation';
import {
  Car,
  Navigation,
  RefreshCw,
  LogOut,
  ArrowRight,
  Gauge,
  KeyRound,
  Fingerprint,
  CheckCircle2,
  Settings,
  Sun,
  Moon,
  Eye,
  EyeOff,
} from 'lucide-react';

type Phase = 'booting' | 'ready' | 'authing' | 'error' | 'needs-password' | 'vehicle-odometer';

interface BootInfo {
  hasBiometricRegistered: boolean;
  hasSession: boolean;
  usernameHint?: string;
}

interface FleetVehicle {
  id: string;
  vehicleCode: string | null;
  licensePlate: string | null;
  make: string | null;
  model: string | null;
  year?: number | null;
  deviceId: string;
  isDeviceBlank: boolean;
  canActivateMobileTracking: boolean;
  odometerReading?: number | null;
  isAssignedToMe?: boolean;
}

const TREXLA_FALLBACK_VEHICLES: FleetVehicle[] = [
  {
    id: '44d7babe-33dd-4769-a35a-dd9285f2b63a',
    vehicleCode: 'TRX-001',
    licensePlate: 'DXB-41087',
    make: 'Mercedes-Benz',
    model: 'Actros Prime Mover',
    year: 2024,
    deviceId: '',
    isDeviceBlank: true,
    canActivateMobileTracking: true,
    odometerReading: 45000,
    isAssignedToMe: false,
  },
  {
    id: 'cdf5d462-a1fa-45bd-82b9-389301e93594',
    vehicleCode: 'TRX-002',
    licensePlate: 'DXB-84243',
    make: 'Mercedes-Benz',
    model: 'Actros Prime Mover',
    year: 2024,
    deviceId: '',
    isDeviceBlank: true,
    canActivateMobileTracking: true,
    odometerReading: 50200,
    isAssignedToMe: false,
  },
  {
    id: '2254dd0b-04a4-459c-8081-31c99f164be0',
    vehicleCode: 'TRX-003',
    licensePlate: 'DXB-17959',
    make: 'Mercedes-Benz',
    model: 'Actros Prime Mover',
    year: 2024,
    deviceId: '',
    isDeviceBlank: true,
    canActivateMobileTracking: true,
    odometerReading: 55400,
    isAssignedToMe: false,
  },
  {
    id: '23304378-d25a-4d8c-ba8c-6d716b7cd1e7',
    vehicleCode: 'TRX-004',
    licensePlate: 'DXB-66176',
    make: 'Mercedes-Benz',
    model: 'Actros Prime Mover',
    year: 2024,
    deviceId: '',
    isDeviceBlank: true,
    canActivateMobileTracking: true,
    odometerReading: 60600,
    isAssignedToMe: false,
  },
  {
    id: 'f935e27c-9b9d-4ecc-b36d-7a527fb22506',
    vehicleCode: 'TRX-005',
    licensePlate: 'DXB-18312',
    make: 'Mercedes-Benz',
    model: 'Actros Prime Mover',
    year: 2024,
    deviceId: '',
    isDeviceBlank: true,
    canActivateMobileTracking: true,
    odometerReading: 65800,
    isAssignedToMe: false,
  },
  {
    id: 'a1d013af-6c32-4ea8-b334-3740b6b5195e',
    vehicleCode: 'TRX-006',
    licensePlate: 'DXB-86549',
    make: 'Mercedes-Benz',
    model: 'Actros Prime Mover',
    year: 2024,
    deviceId: '',
    isDeviceBlank: true,
    canActivateMobileTracking: true,
    odometerReading: 71000,
    isAssignedToMe: false,
  },
  {
    id: 'b1000000-0000-4000-8000-000000000001',
    vehicleCode: 'PM-001',
    licensePlate: 'DXB-767-4011',
    make: 'Mercedes-Benz',
    model: 'Actros 2645 LS Prime Mover (6x4)',
    year: 2024,
    deviceId: '',
    isDeviceBlank: true,
    canActivateMobileTracking: true,
    odometerReading: 142850,
    isAssignedToMe: false,
  },
  {
    id: 'pm-volvo-2-767aaca7',
    vehicleCode: 'PM-002',
    licensePlate: 'DXB-767-4012',
    make: 'Volvo',
    model: 'FH16 540 Globetrotter Tractor (6x4)',
    year: 2024,
    deviceId: '',
    isDeviceBlank: true,
    canActivateMobileTracking: true,
    odometerReading: 98400,
    isAssignedToMe: false,
  },
];

const UI_STRINGS: Record<MobileLanguage, Record<string, string>> = {
  en: {
    appTitle: 'Fleet360 Driver',
    appSubtitle: 'Mobile Telematics & Driver Dispatch Hub',
    driverTab: 'Driver Account',
    vehicleTab: 'Vehicle Sign-In',
    driverSignInTitle: 'Driver Account Sign In',
    driverSignInSubtitle: 'Sign in to assign your vehicle and begin your shift checklist.',
    biometricSignIn: 'Sign In with Biometric',
    usernameLabel: 'Driver Email or Employee ID',
    passwordLabel: 'Password',
    signInButton: 'Sign In with Password',
    vehicleSignInTitle: 'Enter Vehicle Identifier',
    vehicleSignInSubtitle: 'Sign in with Vehicle Code or Plate Number to activate tracking.',
    vehicleIdLabel: 'Vehicle ID or License Plate',
    suggested: 'Suggested:',
    step2Badge: 'Step 2 · Pre-Shift Assignment',
    vehiclePromptTitle: 'Enter Vehicle ID & Odometer',
    vehiclePromptSubtitle: 'Confirm your vehicle and dashboard odometer reading to view your assigned jobs.',
    assignedVehicleLabel: 'Select Vehicle',
    assignedToProfile: '★ Assigned to Profile',
    noVehicleAssigned: 'No Vehicle Assigned',
    blankVehicleOption: '— Blank / Enter Vehicle ID or Plate Manually —',
    customVehicleLabel: 'Enter Vehicle ID / License Plate *',
    customVehiclePlaceholder: 'Enter Vehicle ID or Plate (e.g. DXB-41087, PM-001)',
    startingOdometerLabel: 'Starting Odometer (km) *',
    useLast: 'Use last:',
    odometerHint: 'Verify reading against the physical vehicle instrument cluster.',
    confirmButton: 'Confirm & View My Jobs',
    startingChecklist: 'Opening My Jobs…',
    connectedVehicle: 'Connected Vehicle',
    switchVehicle: 'Switch',
    startReviewChecklist: 'Start / Review Driver Checklist',
    operationsMenu: 'Go to Driver Operations Menu',
    statusActive: 'Status: Active & Assigned',
    notice: 'Notice',
    serverHostTitle: 'API Server Endpoint',
    serverHostHelp: 'Enter your Fleet360 backend IP/domain (e.g. https://fleet360-app-production.up.railway.app)',
    saveServer: 'Save Server URL',
  },
  ar: {
    appTitle: 'سائق Fleet360',
    appSubtitle: 'منصة التتبع الميداني وإدارة السائقين',
    driverTab: 'حساب السائق',
    vehicleTab: 'تسجيل المركبة',
    driverSignInTitle: 'تسجيل دخول حساب السائق',
    driverSignInSubtitle: 'سجل الدخول لتعيين مركبتك والبدء في فحص ما قبل الرحلة.',
    biometricSignIn: 'الدخول بالبصمة البيومترية',
    usernameLabel: 'البريد الإلكتروني أو رقم الموظف',
    passwordLabel: 'كلمة المرور',
    signInButton: 'تسجيل الدخول بكلمة المرور',
    vehicleSignInTitle: 'أدخل رقم المركبة',
    vehicleSignInSubtitle: 'تسجيل الدخول برقم المركبة أو لوحة الترخيص لتفعيل التتبع.',
    vehicleIdLabel: 'رقم المركبة أو لوحة الترخيص',
    suggested: 'مقترح:',
    step2Badge: 'الخطوة ٢ · تعيين ما قبل الوردية',
    vehiclePromptTitle: 'أدخل رقم المركبة وقراءة العداد',
    vehiclePromptSubtitle: 'تحقق من مركبتك وقراءة العداد الفعلية قبل بدء فحص السائق.',
    assignedVehicleLabel: 'اختر المركبة',
    assignedToProfile: '★ مخصصة لحسابك',
    noVehicleAssigned: 'غير مخصصة لمركبة',
    blankVehicleOption: '— فارغ / إدخال رقم المركبة أو اللوحة يدوياً —',
    customVehicleLabel: 'أدخل رقم المركبة أو رقم اللوحة *',
    customVehiclePlaceholder: 'مثال: DXB-41087 أو PM-001',
    startingOdometerLabel: 'عداد المسافات الأولي (كم) *',
    useLast: 'استخدام السابق:',
    odometerHint: 'تأكد من مطابقة القراءة مع شاشة عداد المركبة الفعلية.',
    confirmButton: 'تأكيد وبدء فحص السائق',
    startingChecklist: 'جار بدء الفحص…',
    connectedVehicle: 'المركبة المتصلة',
    switchVehicle: 'تغيير',
    startReviewChecklist: 'بدء / مراجعة فحص السائق',
    operationsMenu: 'الانتقال إلى قائمة العمليات',
    statusActive: 'الحالة: نشطة ومخصصة',
    notice: 'تنبيه',
    serverHostTitle: 'عنوان خادم النظام (API)',
    serverHostHelp: 'أدخل عنوان خادم Fleet360',
    saveServer: 'حفظ عنوان الخادم',
  },
  hi: {
    appTitle: 'फ्लीट360 ड्राइवर',
    appSubtitle: 'मोबाइल टेलीमैटिक्स और ड्राइवर डिस्पैच हब',
    driverTab: 'ड्राइवर खाता',
    vehicleTab: 'वाहन साइन-इन',
    driverSignInTitle: 'ड्राइवर खाता साइन इन',
    driverSignInSubtitle: 'अपना वाहन सौंपने और शिफ्ट चेकलिस्ट शुरू करने के लिए साइन इन करें।',
    biometricSignIn: 'बायोमेट्रिक से साइन इन करें',
    usernameLabel: 'ड्राइवर ईमेल या कर्मचारी आईडी',
    passwordLabel: 'पासवर्ड',
    signInButton: 'पासवर्ड से साइन इन करें',
    vehicleSignInTitle: 'वाहन पहचानकर्ता दर्ज करें',
    vehicleSignInSubtitle: 'ट्रैकिंग सक्रिय करने के लिए वाहन कोड या प्लेट नंबर से साइन इन करें।',
    vehicleIdLabel: 'वाहन आईडी या लाइसेंस प्लेट',
    suggested: 'सुझाया गया:',
    step2Badge: 'चरण 2 · प्री-शिफ्ट असाइनमेंट',
    vehiclePromptTitle: 'वाहन आईडी और ओडोमीटर दर्ज करें',
    vehiclePromptSubtitle: 'ड्राइवर चेकलिस्ट शुरू करने से पहले अपने वाहन और डैशबोर्ड ओडोमीटर की पुष्टि करें।',
    assignedVehicleLabel: 'वाहन चुनें',
    assignedToProfile: '★ प्रोफ़ाइल को सौंपा गया',
    noVehicleAssigned: 'कोई वाहन असाइन नहीं है',
    blankVehicleOption: '— खाली / वाहन आईडी या प्लेट मैन्युअल दर्ज करें —',
    customVehicleLabel: 'वाहन आईडी या लाइसेंस प्लेट दर्ज करें *',
    customVehiclePlaceholder: 'वाहन आईडी या प्लेट दर्ज करें (उदा. DXB-41087, PM-001)',
    startingOdometerLabel: 'प्रारंभिक ओडोमीटर (किमी) *',
    useLast: 'पिछला उपयोग करें:',
    odometerHint: 'वाहन के वास्तविक क्लस्टर से रीडिंग का मिलान करें।',
    confirmButton: 'पुष्टि करें और ड्राइवर चेकलिस्ट शुरू करें',
    startingChecklist: 'चेकलिस्ट शुरू हो रही है…',
    connectedVehicle: 'कनेक्टेड वाहन',
    switchVehicle: 'बदलें',
    startReviewChecklist: 'ड्राइवर चेकलिस्ट शुरू / समीक्षा करें',
    operationsMenu: 'ड्राइवर संचालन मेनू पर जाएं',
    statusActive: 'स्थिति: सक्रिय और असाइन किया गया',
    notice: 'सूचना',
    serverHostTitle: 'एपीआई सर्वर एंडपॉइंट',
    serverHostHelp: 'अपना फ़्लीट360 सर्वर URL दर्ज करें',
    saveServer: 'सर्वर URL सहेजें',
  },
};

export default function DriverAppLauncher() {
  const router = useRouter();
  const { language, setLanguage } = useMobileI18n();
  const txt = UI_STRINGS[language] || UI_STRINGS.en;
  const [showServerModal, setShowServerModal] = useState(false);
  const [serverUrlInput, setServerUrlInput] = useState('');
  useEffect(() => {
    try {
      const saved = localStorage.getItem('fleet360_api_host') || 'https://fleet360-app-production.up.railway.app';
      setServerUrlInput(saved);
    } catch {}
  }, []);
  const [phase, setPhase] = useState<Phase>('booting');
  const [bootInfo, setBootInfo] = useState<BootInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Active Vehicle Session
  const [activeVehicle, setActiveVehicle] = useState<FleetVehicle | null>(null);

  // Fleet vehicles list for assignment picker — defaults to empty/unassigned until loaded
  const [fleetVehicles, setFleetVehicles] = useState<FleetVehicle[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<FleetVehicle | null>(null);
  const [customVehicleQuery, setCustomVehicleQuery] = useState('');
  const [odometerInput, setOdometerInput] = useState('');
  const [hasAssignedVehicleOnProfile, setHasAssignedVehicleOnProfile] = useState(false);
  const [driverInfo, setDriverInfo] = useState<{ id?: string; name?: string; email?: string; assignedVehicleId?: string | null } | null>(null);
  const [isStartingChecklist, setIsStartingChecklist] = useState(false);

  // Driver Credentials form
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Mobile Tracking State
  const [, setIsTracking] = useState(false);
  const [, setCurrentSpeed] = useState<number>(0);
  const [, setCoords] = useState<{ lat: number; lng: number; accuracy: number; heading: number } | null>(null);
  const [, setPingsSent] = useState<number>(0);
  const [, setLastPingTime] = useState<string | null>(null);
  const [, setGpsError] = useState<string | null>(null);

  const watchIdRef = useRef<number | null>(null);
  const lastSentRef = useRef<number>(0);

  // WebAuthn probe
  const [webAuthnSupported, setWebAuthnSupported] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function probe() {
      try {
        if (
          typeof window === 'undefined' ||
          !window.PublicKeyCredential ||
          typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== 'function'
        ) {
          if (!cancelled) setWebAuthnSupported(false);
          return;
        }
        const ok = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        if (!cancelled) setWebAuthnSupported(ok);
      } catch {
        if (!cancelled) setWebAuthnSupported(false);
      }
    }
    void probe();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Mobile GPS Tracking Engine ─────────────────────────────────────────────
  const startMobileTracking = useCallback((vehicleToTrack?: FleetVehicle | null) => {
    const vehicle = vehicleToTrack || activeVehicle;
    if (!vehicle) {
      setGpsError('No active vehicle to track.');
      return;
    }

    if (!vehicle.canActivateMobileTracking) {
      setGpsError(`Mobile tracking is disabled: Vehicle is equipped with hardware GPS (${vehicle.deviceId}).`);
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsError('Geolocation is not supported by this browser/device.');
      return;
    }

    setGpsError(null);
    setIsTracking(true);
    if (typeof window !== 'undefined') {
      localStorage.setItem('fleet360_driver_tracking_active', 'true');
      localStorage.setItem('fleet360_tracked_vehicle_id', vehicle.id);
    }

    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    const watchId = navigator.geolocation.watchPosition(
      async (pos) => {
        const { latitude, longitude, speed, heading, accuracy } = pos.coords;
        const speedKmh = speed != null && speed > 0 ? Math.round(speed * 3.6 * 10) / 10 : 0;

        setCurrentSpeed(speedKmh);
        setCoords({
          lat: latitude,
          lng: longitude,
          accuracy: Math.round(accuracy),
          heading: heading || 0,
        });

        const now = Date.now();
        if (now - lastSentRef.current >= 4000) {
          lastSentRef.current = now;
          try {
            const pingRes = await fetch(getApiEndpoint('/api/driver-app/telematics/live-location'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({
                vehicleId: vehicle.id,
                lat: latitude,
                lng: longitude,
                speedKmh,
                heading: heading || 0,
                accuracy: Math.round(accuracy),
              }),
            });

            if (pingRes.ok) {
              setPingsSent((prev) => prev + 1);
              setLastPingTime(new Date().toLocaleTimeString());
            } else {
              const pingErr = await parseJsonSafely(pingRes);
              if (pingErr?.error) setGpsError(pingErr.error);
            }
          } catch (err) {
            console.warn('[mobile-tracking] Ping transmission error:', err);
          }
        }
      },
      (err) => {
        console.error('[mobile-tracking] Geolocation watch error:', err);
        setGpsError(`GPS Error: ${err.message}. Please allow Location Access.`);
        setIsTracking(false);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 2000,
        timeout: 10000,
      }
    );

    watchIdRef.current = watchId;
  }, [activeVehicle]);

  const stopMobileTracking = useCallback(() => {
    if (watchIdRef.current !== null && typeof navigator !== 'undefined') {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setIsTracking(false);
    if (typeof window !== 'undefined') {
      localStorage.setItem('fleet360_driver_tracking_active', 'false');
    }
  }, []);

  // Check active vehicle session on boot
  const checkActiveVehicleSession = useCallback(async () => {
    try {
      const res = await fetch(getApiEndpoint('/api/driver-app/auth/vehicle-login'), { credentials: 'include' });
      if (res.ok) {
        const data = await parseJsonSafely(res);
        if (data && data.hasSession && data.vehicle) {
          setActiveVehicle(data.vehicle);
          const explicitlyDisabled = typeof window !== 'undefined' && localStorage.getItem('fleet360_driver_tracking_active') === 'false';
          if (!explicitlyDisabled && data.vehicle.canActivateMobileTracking) {
            startMobileTracking(data.vehicle);
          }
        }
        if (data && data.driver) {
          setDriverInfo(data.driver);
        }
      }
    } catch {
      // ignore
    }
  }, [startMobileTracking]);

  const loadBoot = useCallback(async () => {
    setPhase('booting');
    setErrorMsg(null);
    try {
      await checkActiveVehicleSession();
      const r = await fetch(getApiEndpoint('/api/driver-app/auth/biometric/status'), { credentials: 'include' });
      const data = await parseJsonSafely(r);
      if (data) {
        setBootInfo(data);
        if (data.hasBiometricRegistered && webAuthnSupported) {
          setPhase('ready');
          return;
        }
      }
      setPhase('needs-password');
    } catch {
      setPhase('needs-password');
    }
  }, [webAuthnSupported, checkActiveVehicleSession]);

  useEffect(() => {
    void loadBoot();
  }, [loadBoot]);

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null && typeof navigator !== 'undefined') {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  const { isDark, toggleTheme } = useMobileTheme();

  // Helper to fetch fleet vehicles and transition to vehicle-odometer prompt
  const proceedToVehicleOdometer = async (fallbackDriverName?: string, signedInEmail?: string) => {
    try {
      let vehicles: FleetVehicle[] = [];
      let driver: { id?: string; name?: string; assignedVehicleId?: string | null } | null = null;

      try {
        const token = typeof window !== 'undefined' ? localStorage.getItem('fleet360_session_token') : null;
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch(getApiEndpoint('/api/driver-app/auth/vehicle-login?list=true'), { credentials: 'include', headers });
        if (res.ok) {
          const data = await parseJsonSafely(res);
          if (data) {
            vehicles = Array.isArray(data.vehicles) ? data.vehicles : [];
            if (data.driver) {
              driver = data.driver;
            }
          }
        }
      } catch {
        // network / local asset fallback
      }

      const emailLower = (signedInEmail || username || '').toLowerCase().trim();
      if (vehicles.length === 0 && emailLower.includes('trexla')) {
        vehicles = TREXLA_FALLBACK_VEHICLES.map((v) => ({
          ...v,
          isAssignedToMe: emailLower === 'driver@trexla-logistics.ae' && v.vehicleCode === 'PM-001',
        }));
      }

      const activeDriverName = driver?.name || fallbackDriverName || signedInEmail || username || 'Driver';
      setDriverInfo({
        id: driver?.id,
        name: activeDriverName,
        email: signedInEmail || username,
        assignedVehicleId: driver?.assignedVehicleId ?? null,
      });
      if (typeof window !== 'undefined') {
        localStorage.setItem('fleet360_driver_name', activeDriverName);
      }

      // Check ONLY whether a vehicle is genuinely assigned to this driver in the database
      const assignedVehicle =
        vehicles.find(
          (v) =>
            (driver?.assignedVehicleId &&
              (v.id === driver.assignedVehicleId || v.vehicleCode === driver.assignedVehicleId)) ||
            v.isAssignedToMe === true
        ) || null;

      setFleetVehicles(vehicles);

      if (assignedVehicle) {
        // Driver has a pre-assigned vehicle in their profile
        setHasAssignedVehicleOnProfile(true);
        setSelectedVehicle(assignedVehicle);
        setCustomVehicleQuery(assignedVehicle.licensePlate || assignedVehicle.vehicleCode || '');
        setOdometerInput(assignedVehicle.odometerReading ? String(assignedVehicle.odometerReading) : '');
        if (typeof window !== 'undefined') {
          localStorage.setItem('fleet360_active_vehicle', JSON.stringify(assignedVehicle));
          window.dispatchEvent(new Event('fleet360_vehicle_changed'));
        }
      } else {
        // Driver is NOT assigned to any vehicle — default to BLANK value so driver enters Vehicle ID / Plate
        setHasAssignedVehicleOnProfile(false);
        setSelectedVehicle(null);
        setCustomVehicleQuery('');
        setOdometerInput('');
        if (typeof window !== 'undefined') {
          localStorage.removeItem('fleet360_active_vehicle');
        }
      }

      setPhase('vehicle-odometer');
    } catch (err) {
      console.warn('Proceed to vehicle odometer fallback:', err);
      setHasAssignedVehicleOnProfile(false);
      setSelectedVehicle(null);
      setCustomVehicleQuery('');
      setOdometerInput('');
      setPhase('vehicle-odometer');
    }
  };

  // ── Driver Biometric & Password Auth ───────────────────────────────────────
  const doBiometricLogin = async (usernameHint?: string) => {
    setPhase('authing');
    setErrorMsg(null);
    try {
      if (
        typeof window !== 'undefined' &&
        window.PublicKeyCredential &&
        typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function'
      ) {
        const hasHardware = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        if (hasHardware) {
          try {
            const startModule = await import('@simplewebauthn/browser');
            const startRes = await fetch(getApiEndpoint('/api/driver-app/auth/biometric/login/start'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ username: usernameHint || username || '' }),
            });
            const options = await parseJsonSafely(startRes);
            if (options) {
              const assertion = await startModule.startAuthentication(options);
              await fetch(getApiEndpoint('/api/driver-app/auth/biometric/login/finish'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ response: assertion, driverId: options.driverId }),
              });
            }
          } catch {}
        }
      }

      if (typeof window !== 'undefined') {
        localStorage.setItem('fleet360_driver_authenticated', 'true');
        localStorage.setItem('fleet360_driver_name', usernameHint || username || 'Driver');
        window.dispatchEvent(new Event('fleet360_vehicle_changed'));
      }

      await proceedToVehicleOdometer(usernameHint || username || 'Driver', usernameHint || username);
    } catch {
      await proceedToVehicleOdometer(usernameHint || username || 'Driver', usernameHint || username);
    }
  };

  const doPasswordLogin = async () => {
    setPhase('authing');
    setErrorMsg(null);
    const trimmedEmail = username.trim();
    if (!trimmedEmail || !password) {
      setErrorMsg('Please enter your Driver Email and Password.');
      setPhase('needs-password');
      return;
    }

    try {
      let displayName = trimmedEmail;

      const r = await fetch(getApiEndpoint('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: trimmedEmail, password }),
      });
      const data = await parseJsonSafely(r);

      if (!r.ok) {
        setErrorMsg(data?.message || data?.error || 'Invalid email or password');
        setPhase('needs-password');
        return;
      }

      if (data?.user) {
        displayName = [data.user.firstName, data.user.lastName].filter(Boolean).join(' ') || data.user.email || trimmedEmail;
      }

      if (typeof window !== 'undefined') {
        if (data?.sessionToken) {
          localStorage.setItem('fleet360_session_token', data.sessionToken);
        }
        localStorage.setItem('fleet360_driver_authenticated', 'true');
        localStorage.setItem('fleet360_driver_email', trimmedEmail);
        localStorage.setItem('fleet360_driver_name', displayName);
        window.dispatchEvent(new Event('fleet360_vehicle_changed'));
      }

      // Immediately transition to Vehicle ID & Odometer step
      await proceedToVehicleOdometer(displayName, trimmedEmail);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Unable to reach server. Please check your connection.');
      setPhase('needs-password');
    }
  };

  // Match typed custom vehicle query against loaded fleet vehicles for live preview
  const matchedVehicleFromInput = React.useMemo(() => {
    if (selectedVehicle) return selectedVehicle;
    const q = customVehicleQuery.trim().toLowerCase();
    if (!q) return null;
    const compactQ = q.replace(/[^a-z0-9]/g, '');
    return (
      fleetVehicles.find((v) => {
        const plate = (v.licensePlate || '').toLowerCase();
        const code = (v.vehicleCode || '').toLowerCase();
        const compactPlate = plate.replace(/[^a-z0-9]/g, '');
        return plate === q || code === q || (compactQ.length >= 3 && compactPlate === compactQ);
      }) || null
    );
  }, [selectedVehicle, customVehicleQuery, fleetVehicles]);

  // ── Submit Vehicle ID & Odometer to Start Driver Checklist ────────────────
  const handleConfirmVehicleAndOdometer = async (e: React.FormEvent) => {
    e.preventDefault();
    const ident = selectedVehicle
      ? (selectedVehicle.licensePlate || selectedVehicle.vehicleCode || selectedVehicle.id)
      : customVehicleQuery.trim();

    if (!ident) {
      setErrorMsg('Please enter a Vehicle ID / License Plate or select a vehicle.');
      return;
    }

    const odoValue = Number(odometerInput);
    if (!odometerInput || isNaN(odoValue) || odoValue <= 0) {
      setErrorMsg('Please enter a valid positive Starting Odometer reading in km.');
      return;
    }

    setIsStartingChecklist(true);
    setErrorMsg(null);
    try {
      let boundVehicle: FleetVehicle | null = selectedVehicle || matchedVehicleFromInput;

      // 1. Bind vehicle session and update vehicle odometer on backend
      const savedToken = typeof window !== 'undefined' ? localStorage.getItem('fleet360_session_token') : null;
      const reqHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      if (savedToken) reqHeaders['Authorization'] = `Bearer ${savedToken}`;

      const vehRes = await fetch(getApiEndpoint('/api/driver-app/auth/vehicle-login'), {
        method: 'POST',
        headers: reqHeaders,
        credentials: 'include',
        body: JSON.stringify({
          vehicleIdentifier: ident,
          odometerReading: odoValue,
          driverEmail: username || undefined,
        }),
      });
      const vehData = await parseJsonSafely(vehRes);

      if (vehData?.sessionToken && typeof window !== 'undefined') {
        localStorage.setItem('fleet360_session_token', vehData.sessionToken);
      }

      if (vehData?.vehicle) {
        boundVehicle = vehData.vehicle;
      } else if (!boundVehicle) {
        boundVehicle = {
          id: ident,
          vehicleCode: ident.toUpperCase(),
          licensePlate: ident.toUpperCase(),
          make: 'Fleet Vehicle',
          model: '',
          year: 2024,
          deviceId: '',
          isDeviceBlank: true,
          canActivateMobileTracking: true,
          odometerReading: odoValue,
        };
      }

      setActiveVehicle(boundVehicle);

      // 2. Start / initialize active shift with this vehicle and starting odometer
      try {
        await fetch(getApiEndpoint('/api/driver-app/shift/current'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            vehicleId: boundVehicle.id,
            startOdometer: odoValue,
          }),
        });
      } catch {}

      // 3. Persist locally for APK / standalone mode
      if (typeof window !== 'undefined') {
        localStorage.setItem('fleet360_active_vehicle', JSON.stringify(boundVehicle));
        localStorage.setItem('fleet360_start_odometer', String(odoValue));
        localStorage.setItem('fleet360_driver_authenticated', 'true');
        localStorage.setItem('fleet360_driver_name', driverInfo?.name || username || 'Driver');
      }

      // 4. Notify tracking provider to start real device GPS tracking
      if (boundVehicle.canActivateMobileTracking) {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('fleet360_vehicle_changed'));
        }
      }

      // 5. Immediately transition to Driver Checklist!
      router.push('/driver-app/today');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to initialize shift');
      setIsStartingChecklist(false);
    }
  };

  const handleSignOutVehicle = async () => {
    stopMobileTracking();
    setActiveVehicle(null);
    setSelectedVehicle(null);
    setCustomVehicleQuery('');
    setOdometerInput('');
    setDriverInfo(null);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('fleet360_session_token');
      localStorage.removeItem('fleet360_driver_tracking_active');
      localStorage.removeItem('fleet360_tracked_vehicle_id');
      localStorage.removeItem('fleet360_active_vehicle');
      localStorage.removeItem('fleet360_start_odometer');
      localStorage.removeItem('fleet360_driver_authenticated');
      window.dispatchEvent(new Event('fleet360_vehicle_changed'));
    }
    try {
      await fetch(getApiEndpoint('/api/auth/logout'), { method: 'POST', credentials: 'include' });
    } catch {}
    setPhase('needs-password');
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-between px-5 py-8 text-slate-900 dark:text-white bg-slate-100 dark:bg-slate-950 transition-colors duration-150">
      {/* Top Header */}
      <div className="text-center">
        <div className="flex items-center justify-between mb-3">
          <button
            type="button"
            onClick={toggleTheme}
            title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-slate-900 text-slate-700 dark:text-amber-300 hover:bg-slate-200 dark:hover:bg-slate-800 transition shadow-sm"
          >
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4 text-violet-600" />}
          </button>
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 shadow-lg shadow-violet-600/30 text-2xl font-black text-white">
            F
          </div>
          <button
            type="button"
            onClick={() => setShowServerModal(true)}
            title={txt.serverHostTitle}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition shadow-sm"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
        <h1 className="text-2xl font-black tracking-tight text-slate-950 dark:text-white">{txt.appTitle}</h1>
        <p className="mt-1 text-xs font-semibold text-slate-600 dark:text-slate-400">
          {txt.appSubtitle}
        </p>

        {/* 3-Language Switcher (English / العربية / हिन्दी) */}
        <div className="mt-3 flex items-center justify-center gap-1 rounded-xl bg-white dark:bg-slate-900/90 p-1 border-2 border-slate-300 dark:border-white/10 max-w-[270px] mx-auto shadow-sm">
          <button
            type="button"
            onClick={() => setLanguage('en')}
            className={`flex-1 rounded-lg py-1.5 text-xs font-bold transition ${
              language === 'en'
                ? 'bg-violet-600 text-white shadow'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white'
            }`}
          >
            English
          </button>
          <button
            type="button"
            onClick={() => setLanguage('ar')}
            className={`flex-1 rounded-lg py-1.5 text-xs font-bold transition ${
              language === 'ar'
                ? 'bg-violet-600 text-white shadow'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white'
            }`}
          >
            العربية
          </button>
          <button
            type="button"
            onClick={() => setLanguage('hi')}
            className={`flex-1 rounded-lg py-1.5 text-xs font-bold transition ${
              language === 'hi'
                ? 'bg-violet-600 text-white shadow'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white'
            }`}
          >
            हिन्दी
          </button>
        </div>
      </div>

      {/* Alerts */}
      {errorMsg && (
        <div role="alert" className="my-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs text-rose-600 dark:text-rose-300">
          <p className="font-semibold">{txt.notice}</p>
          <p>{errorMsg}</p>
        </div>
      )}

      {/* ── PHASE: VEHICLE ID & ODOMETER PROMPT (AFTER LOGIN) ───────────────── */}
      {phase === 'vehicle-odometer' ? (
        <div className="my-auto space-y-4">
          <div className="rounded-3xl border-2 border-violet-500 bg-white dark:bg-slate-900/90 p-5 shadow-2xl backdrop-blur space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-black uppercase tracking-wider text-violet-700 dark:text-violet-400 bg-violet-100 dark:bg-violet-500/10 border border-violet-300 dark:border-violet-500/20 px-2.5 py-0.5 rounded-full">
                  {txt.step2Badge}
                </span>
                {(driverInfo?.email || driverInfo?.name) && (
                  <span className="text-xs text-slate-800 dark:text-slate-300 font-bold truncate max-w-[180px]">
                    👤 {driverInfo.name || driverInfo.email}
                  </span>
                )}
              </div>
              <h2 className="text-lg font-black text-slate-950 dark:text-white">{txt.vehiclePromptTitle}</h2>
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-400 mt-0.5">
                {txt.vehiclePromptSubtitle}
              </p>
            </div>

            <form onSubmit={handleConfirmVehicleAndOdometer} className="space-y-4">
              {/* Assigned Vehicle Dropdown (Starts BLANK when driver has no assigned vehicle) */}
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-300 mb-1.5 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Car className="h-4 w-4 text-violet-600 dark:text-violet-400" /> {txt.assignedVehicleLabel}
                  </span>
                  {hasAssignedVehicleOnProfile && selectedVehicle ? (
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-black">
                      {txt.assignedToProfile}
                    </span>
                  ) : (
                    <span className="text-[10px] text-amber-600 dark:text-amber-400 font-black uppercase">
                      {txt.noVehicleAssigned}
                    </span>
                  )}
                </label>

                <select
                  value={selectedVehicle?.id || ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (!val) {
                      setSelectedVehicle(null);
                      setCustomVehicleQuery('');
                      setOdometerInput('');
                      return;
                    }
                    const v = fleetVehicles.find((x) => x.id === val) || null;
                    setSelectedVehicle(v);
                    if (v) {
                      setCustomVehicleQuery(v.licensePlate || v.vehicleCode || '');
                      setOdometerInput(v.odometerReading ? String(v.odometerReading) : '');
                    }
                  }}
                  className="w-full rounded-xl border-2 border-slate-300 dark:border-white/15 bg-slate-50 dark:bg-slate-950 px-3.5 py-3 text-sm font-bold text-slate-950 dark:text-white focus:border-violet-600 focus:outline-none"
                >
                  <option value="">{txt.blankVehicleOption}</option>
                  {fleetVehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.licensePlate || v.vehicleCode} - {v.make} {v.model} ({v.vehicleCode || 'FLEET'}){v.isAssignedToMe ? ' ★' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Blank Value Column to Enter Vehicle ID / Plate Manually */}
              {!selectedVehicle && (
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-300 mb-1.5 flex items-center justify-between">
                    <span>{txt.customVehicleLabel}</span>
                    {matchedVehicleFromInput && (
                      <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                        ✓ Matched: {matchedVehicleFromInput.make} {matchedVehicleFromInput.model}
                      </span>
                    )}
                  </label>
                  <input
                    type="text"
                    required={!selectedVehicle}
                    placeholder={txt.customVehiclePlaceholder}
                    value={customVehicleQuery}
                    onChange={(e) => {
                      const nextVal = e.target.value;
                      setCustomVehicleQuery(nextVal);
                      const q = nextVal.trim().toLowerCase();
                      const compactQ = q.replace(/[^a-z0-9]/g, '');
                      const match = fleetVehicles.find((v) => {
                        const plate = (v.licensePlate || '').toLowerCase();
                        const code = (v.vehicleCode || '').toLowerCase();
                        return plate === q || code === q || (compactQ.length >= 4 && plate.replace(/[^a-z0-9]/g, '') === compactQ);
                      });
                      if (match?.odometerReading && !odometerInput) {
                        setOdometerInput(String(match.odometerReading));
                      }
                    }}
                    dir="ltr"
                    className="w-full rounded-xl border-2 border-violet-400 dark:border-violet-500/50 bg-slate-50 dark:bg-slate-950 px-4 py-3 font-mono text-base font-black uppercase text-slate-950 dark:text-white placeholder-slate-400 focus:border-violet-600 focus:outline-none text-left"
                  />
                  {fleetVehicles.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] font-bold uppercase text-slate-400">Available Plates:</span>
                      {fleetVehicles.slice(0, 6).map((v) => {
                        const label = v.licensePlate || v.vehicleCode || '';
                        return (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() => {
                              setCustomVehicleQuery(label);
                              if (v.odometerReading) {
                                setOdometerInput(String(v.odometerReading));
                              }
                            }}
                            className="rounded-lg border border-slate-300 dark:border-white/10 bg-slate-100 dark:bg-slate-800/80 px-2 py-0.5 font-mono text-[11px] font-bold text-slate-700 dark:text-slate-300 hover:border-violet-500 hover:text-violet-400 transition"
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Vehicle Summary Card (Only shown when a vehicle is selected or matched) */}
              {(selectedVehicle || matchedVehicleFromInput) && (
                <div className="rounded-2xl border-2 border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/20 p-3.5 space-y-1">
                  <div className="flex items-baseline justify-between">
                    <span className="font-mono text-lg font-black text-slate-950 dark:text-white">
                      {(selectedVehicle || matchedVehicleFromInput)?.licensePlate ||
                        (selectedVehicle || matchedVehicleFromInput)?.vehicleCode}
                    </span>
                    <span className="font-mono text-xs font-bold text-slate-600 dark:text-slate-400">
                      {(selectedVehicle || matchedVehicleFromInput)?.vehicleCode || ''}
                    </span>
                  </div>
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {(selectedVehicle || matchedVehicleFromInput)?.make}{' '}
                    {(selectedVehicle || matchedVehicleFromInput)?.model}{' '}
                    {(selectedVehicle || matchedVehicleFromInput)?.year
                      ? `(${(selectedVehicle || matchedVehicleFromInput)?.year})`
                      : ''}
                  </div>
                  <div className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 pt-0.5">
                    📱 Mobile GPS tracking ready
                  </div>
                </div>
              )}

              {/* Odometer Input */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-300 flex items-center gap-1.5">
                    <Gauge className="h-4 w-4 text-cyan-600 dark:text-cyan-400" /> {txt.startingOdometerLabel}
                  </label>
                  {(selectedVehicle?.odometerReading || matchedVehicleFromInput?.odometerReading) && (
                    <button
                      type="button"
                      onClick={() =>
                        setOdometerInput(
                          String(selectedVehicle?.odometerReading || matchedVehicleFromInput?.odometerReading)
                        )
                      }
                      className="text-[11px] font-bold text-cyan-600 dark:text-cyan-400 hover:underline"
                    >
                      {txt.useLast}{' '}
                      {Number(
                        selectedVehicle?.odometerReading || matchedVehicleFromInput?.odometerReading
                      ).toLocaleString()}{' '}
                      km
                    </button>
                  )}
                </div>

                <div className="relative">
                  <input
                    type="number"
                    required
                    min="0"
                    step="1"
                    placeholder="Enter current odometer reading"
                    value={odometerInput}
                    onChange={(e) => setOdometerInput(e.target.value)}
                    dir="ltr"
                    className="w-full rounded-xl border-2 border-slate-300 dark:border-white/10 bg-slate-50 dark:bg-slate-950 px-4 py-3.5 font-mono text-xl font-black text-cyan-700 dark:text-cyan-300 placeholder-slate-400 focus:border-cyan-500 focus:outline-none pr-14 text-left"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-black text-slate-500 font-mono">
                    KM
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  {txt.odometerHint}
                </p>
              </div>

              {/* Submit CTA */}
              <button
                type="submit"
                disabled={isStartingChecklist}
                className="w-full rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-3.5 text-sm font-bold text-white shadow-lg shadow-violet-600/30 transition hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isStartingChecklist ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" /> {txt.startingChecklist}
                  </>
                ) : (
                  <>
                    {txt.confirmButton}
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>

              <div className="text-center">
                <button
                  type="button"
                  onClick={handleSignOutVehicle}
                  className="text-xs text-slate-500 hover:text-slate-300 transition"
                >
                  Need to switch account? Sign out
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : activeVehicle ? (
        /* ── ACTIVE VEHICLE DASHBOARD & MOBILE TRACKING HUD ────────────────────── */
        <div className="my-4 space-y-4">
          {/* Vehicle Identity Card */}
          <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-4 shadow-xl backdrop-blur">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <Car className="h-4 w-4 text-violet-400" /> {txt.connectedVehicle}
              </span>
              <button
                type="button"
                onClick={handleSignOutVehicle}
                className="flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-slate-400 hover:bg-white/5 hover:text-white transition"
              >
                <LogOut className="h-3 w-3" /> {txt.switchVehicle}
              </button>
            </div>

            <div className="mt-3 flex items-baseline justify-between">
              <div>
                <h2 className="text-2xl font-extrabold font-mono tracking-tight text-white">
                  {activeVehicle.licensePlate || 'NO PLATE'}
                </h2>
                <p className="text-xs text-slate-400">
                  {activeVehicle.make} {activeVehicle.model} {activeVehicle.year ? `(${activeVehicle.year})` : ''}
                </p>
              </div>
              <span className="rounded-md bg-slate-800 px-2 py-1 font-mono text-xs text-slate-300 border border-white/10">
                {activeVehicle.vehicleCode || 'No Code'}
              </span>
            </div>

            {/* Status Indicator (Mobile Tracking runs silently in background) */}
            <div className="mt-3.5 pt-3 border-t border-white/10 flex items-center justify-between text-xs text-slate-400">
              <span>{txt.statusActive}</span>
              <span className="font-mono text-[11px] text-slate-500">{activeVehicle.id.slice(0, 8)}</span>
            </div>
          </div>

          {/* Action to Driver Checklist & Menu */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => router.push('/driver-app/shift-checklist')}
              className="w-full flex items-center justify-between rounded-2xl border border-emerald-500/30 bg-emerald-600/20 p-4 text-sm font-bold text-emerald-200 transition hover:bg-emerald-600/30"
            >
              <span className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                {txt.startReviewChecklist}
              </span>
              <ArrowRight className="h-4 w-4 text-emerald-400" />
            </button>

            <button
              type="button"
              onClick={() => router.push('/driver-app/menu')}
              className="w-full flex items-center justify-between rounded-2xl border border-white/10 bg-slate-900/80 p-4 text-sm font-semibold text-slate-300 transition hover:bg-white/5"
            >
              <span className="flex items-center gap-2">
                <Navigation className="h-4 w-4 text-violet-400" />
                {txt.operationsMenu}
              </span>
              <ArrowRight className="h-4 w-4 text-slate-400" />
            </button>
          </div>
        </div>
      ) : (
        /* ── LOGIN INTERFACE (DRIVER CREDENTIALS FIRST - SEQUENTIAL SIGN-IN FLOW) ──────── */
        <div className="my-auto space-y-4">
          <div className="rounded-3xl border-2 border-slate-300 dark:border-white/10 bg-white dark:bg-slate-900/90 p-6 shadow-xl backdrop-blur space-y-4">
            <div>
              <div className="flex items-center gap-1.5 text-xs font-black text-violet-600 dark:text-violet-400 uppercase tracking-wider mb-1">
                <KeyRound className="h-4 w-4" /> Driver Sign In
              </div>
              <h2 className="text-lg font-black text-slate-950 dark:text-white">{txt.driverSignInTitle}</h2>
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-400 mt-0.5">
                {txt.driverSignInSubtitle}
              </p>
            </div>

            {bootInfo?.hasBiometricRegistered && webAuthnSupported && (
              <button
                type="button"
                onClick={() => doBiometricLogin(bootInfo.usernameHint)}
                disabled={phase === 'authing'}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-3.5 text-sm font-bold text-white transition hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50 shadow-md"
              >
                <Fingerprint className="h-5 w-5" />
                {phase === 'authing' ? 'Verifying…' : 'Sign In with Biometric'}
              </button>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void doPasswordLogin();
              }}
              className="space-y-3.5"
            >
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-300 mb-1.5 block">
                  {txt.usernameLabel}
                </label>
                <input
                  type="text"
                  required
                  placeholder="jainu@trexla.ae"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  dir="ltr"
                  className="w-full rounded-xl border-2 border-slate-300 dark:border-white/10 bg-slate-50 dark:bg-slate-950 px-4 py-3 text-sm font-bold text-slate-950 dark:text-white placeholder-slate-400 focus:border-violet-600 focus:outline-none text-left"
                />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-300 mb-1.5 block">
                  {txt.passwordLabel || 'Password'}
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    dir="ltr"
                    className="w-full rounded-xl border-2 border-slate-300 dark:border-white/10 bg-slate-50 dark:bg-slate-950 px-4 py-3 pe-12 text-sm font-bold text-slate-950 dark:text-white placeholder-slate-400 focus:border-violet-600 focus:outline-none text-left"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute inset-y-0 end-0 flex items-center pe-3.5 text-slate-500 hover:text-slate-800 dark:hover:text-white transition"
                    tabIndex={-1}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? (
                      <EyeOff className="h-5 w-5 text-slate-600 dark:text-slate-400" />
                    ) : (
                      <Eye className="h-5 w-5 text-slate-600 dark:text-slate-400" />
                    )}
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={phase === 'authing'}
                className="w-full rounded-xl bg-violet-600 px-4 py-3.5 text-sm font-black text-white shadow-lg shadow-violet-600/30 transition hover:bg-violet-500 disabled:opacity-50 flex items-center justify-center gap-2 active:scale-98"
              >
                {phase === 'authing' ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" /> Verifying…
                  </>
                ) : (
                  txt.signInButton
                )}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="mt-6 text-center text-[11px] uppercase tracking-wider text-slate-600">
        Fleet360 v2.5 · Mobile GPS &amp; Telematics
      </footer>

      {/* Backend API Server Configuration Modal */}
      {showServerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900 p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Settings className="h-4 w-4 text-violet-400" />
                {txt.serverHostTitle}
              </h3>
              <button
                type="button"
                onClick={() => setShowServerModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-slate-400">
              {txt.serverHostHelp}
            </p>
            <input
              type="text"
              value={serverUrlInput}
              onChange={(e) => setServerUrlInput(e.target.value)}
              placeholder="https://fleet360-app-production.up.railway.app"
              dir="ltr"
              className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3 font-mono text-xs text-white placeholder-slate-600 focus:border-violet-500 focus:outline-none text-left"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  try {
                    localStorage.setItem('fleet360_api_host', serverUrlInput.trim());
                  } catch {}
                  setShowServerModal(false);
                }}
                className="flex-1 rounded-xl bg-violet-600 py-2.5 text-xs font-bold text-white hover:bg-violet-500 transition shadow"
              >
                {txt.saveServer}
              </button>
              <button
                type="button"
                onClick={() => {
                  try {
                    localStorage.removeItem('fleet360_api_host');
                    setServerUrlInput('https://fleet360-app-production.up.railway.app');
                  } catch {}
                  setShowServerModal(false);
                }}
                className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2.5 text-xs text-slate-300 hover:bg-slate-700 transition"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
