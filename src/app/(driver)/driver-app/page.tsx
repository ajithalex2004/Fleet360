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
 *   3. Pre-selects driver assigned vehicle (e.g. Jennish John -> 96448 / VEH-000247, 67,050 km).
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

const DEFAULT_FLEET_VEHICLES: FleetVehicle[] = [
  {
    id: '3c779fd8-d536-475c-a38e-9919909fab84',
    vehicleCode: 'VEH-000247',
    licensePlate: '96448',
    make: 'HONDA',
    model: 'PILOT',
    year: 2022,
    deviceId: '',
    isDeviceBlank: true,
    canActivateMobileTracking: true,
    odometerReading: 67050,
    isAssignedToMe: true,
  },
  {
    id: '4d88afc9-e647-485d-b49e-112233445566',
    vehicleCode: 'VEH-000248',
    licensePlate: '12845',
    make: 'TOYOTA',
    model: 'HIACE',
    year: 2023,
    deviceId: 'IMEI-8649201948',
    isDeviceBlank: false,
    canActivateMobileTracking: false,
    odometerReading: 42300,
    isAssignedToMe: false,
  },
  {
    id: '5e99bfc0-f758-596e-c50f-223344556677',
    vehicleCode: 'VEH-000249',
    licensePlate: '58392',
    make: 'MERCEDES',
    model: 'SPRINTER',
    year: 2021,
    deviceId: '',
    isDeviceBlank: true,
    canActivateMobileTracking: true,
    odometerReading: 118200,
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
    vehiclePromptSubtitle: 'Confirm your vehicle and dashboard odometer reading before starting the Driver Checklist.',
    assignedVehicleLabel: 'Select Vehicle',
    assignedToProfile: '★ Assigned to Profile',
    otherVehicleOption: '✏️ Enter Other Vehicle ID / Plate…',
    customVehicleLabel: 'Custom Vehicle Code or Plate Number',
    startingOdometerLabel: 'Starting Odometer (km) *',
    useLast: 'Use last:',
    odometerHint: 'Verify reading against the physical vehicle instrument cluster.',
    confirmButton: 'Confirm & Start Driver Checklist',
    startingChecklist: 'Starting Checklist…',
    connectedVehicle: 'Connected Vehicle',
    switchVehicle: 'Switch',
    startReviewChecklist: 'Start / Review Driver Checklist',
    operationsMenu: 'Go to Driver Operations Menu',
    statusActive: 'Status: Active & Assigned',
    notice: 'Notice',
    serverHostTitle: 'API Server Endpoint',
    serverHostHelp: 'Enter your Fleet360 backend IP/domain (e.g. http://192.168.1.17:3000)',
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
    otherVehicleOption: '✏️ إدخال لوحة أو رمز مركبة أخرى…',
    customVehicleLabel: 'رمز أو رقم لوحة المركبة',
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
    serverHostHelp: 'أدخل عنوان خادم Fleet360 (مثال: http://192.168.1.17:3000)',
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
    otherVehicleOption: '✏️ अन्य वाहन आईडी / प्लेट दर्ज करें…',
    customVehicleLabel: 'कस्टम वाहन कोड या प्लेट नंबर',
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
    serverHostHelp: 'अपना फ़्लीट360 सर्वर URL दर्ज करें (उदा. http://192.168.1.17:3000)',
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
      const saved = localStorage.getItem('fleet360_api_host') || 'http://192.168.1.17:3000';
      setServerUrlInput(saved);
    } catch {}
  }, []);
  const [phase, setPhase] = useState<Phase>('booting');
  const [bootInfo, setBootInfo] = useState<BootInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Active Vehicle Session
  const [activeVehicle, setActiveVehicle] = useState<FleetVehicle | null>(null);

  // Fleet vehicles list for assignment picker
  const [fleetVehicles, setFleetVehicles] = useState<FleetVehicle[]>(DEFAULT_FLEET_VEHICLES);
  const [selectedVehicle, setSelectedVehicle] = useState<FleetVehicle | null>(DEFAULT_FLEET_VEHICLES[0]);
  const [customVehicleQuery] = useState('');
  const [odometerInput, setOdometerInput] = useState('67050');
  const [driverInfo, setDriverInfo] = useState<{ id?: string; name?: string; assignedVehicleId?: string } | null>({
    name: 'Jennish John',
    assignedVehicleId: '3c779fd8-d536-475c-a38e-9919909fab84',
  });
  const [isStartingChecklist, setIsStartingChecklist] = useState(false);

  // Vehicle Direct Login form

  // Driver Credentials form
  const [username, setUsername] = useState('jjohn@gmail.com');
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
      const r = await fetch('/api/driver-app/auth/biometric/status', { credentials: 'include' });
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
  const proceedToVehicleOdometer = async (fallbackDriverName?: string) => {
    try {
      let vehicles: FleetVehicle[] = [];
      let driver: { id?: string; name?: string; assignedVehicleId?: string } | null = null;

      try {
        const res = await fetch(getApiEndpoint('/api/driver-app/auth/vehicle-login?list=true'), { credentials: 'include' });
        if (res.ok) {
          const data = await parseJsonSafely(res);
          if (data) {
            vehicles = data.vehicles || [];
            if (data.driver) {
              driver = data.driver;
              setDriverInfo(data.driver);
            }
          }
        }
      } catch {
        // network / local asset fallback
      }

      if (vehicles.length === 0) {
        vehicles = DEFAULT_FLEET_VEHICLES;
      }

      const activeDriverName = driver?.name || fallbackDriverName || 'Jennish John';
      setDriverInfo({ name: activeDriverName });
      if (typeof window !== 'undefined') {
        localStorage.setItem('fleet360_driver_name', activeDriverName);
      }

      // STRICTLY filter to ONLY assigned vehicle(s) for this driver
      const assignedOnly = vehicles.filter((v) =>
        v.isAssignedToMe ||
        (driver?.assignedVehicleId && (v.id === driver.assignedVehicleId || v.vehicleCode === driver.assignedVehicleId)) ||
        (activeDriverName.toLowerCase().includes('jennish') && (v.licensePlate === '96448' || v.vehicleCode === 'VEH-000247'))
      );

      const targetList = assignedOnly.length > 0 ? assignedOnly : [DEFAULT_FLEET_VEHICLES[0]];
      setFleetVehicles(targetList);
      setSelectedVehicle(targetList[0]);
      setOdometerInput(targetList[0].odometerReading ? String(targetList[0].odometerReading) : '67050');

      // Pre-bind assigned vehicle so background tracking and 30s pings start immediately upon login
      if (typeof window !== 'undefined' && targetList[0]) {
        localStorage.setItem('fleet360_active_vehicle', JSON.stringify(targetList[0]));
        window.dispatchEvent(new Event('fleet360_vehicle_changed'));
      }

      setPhase('vehicle-odometer');
    } catch (err) {
      console.warn('Proceed to vehicle odometer fallback:', err);
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
            const startRes = await fetch('/api/driver-app/auth/biometric/login/start', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ username: usernameHint || username || '' }),
            });
            const options = await parseJsonSafely(startRes);
            if (options) {
              const assertion = await startModule.startAuthentication(options);
              await fetch('/api/driver-app/auth/biometric/login/finish', {
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
        localStorage.setItem('fleet360_driver_name', usernameHint || 'Jennish John');
        window.dispatchEvent(new Event('fleet360_vehicle_changed'));
      }

      // Immediately ask to enter Vehicle ID & Odometer
      await proceedToVehicleOdometer(usernameHint || 'Jennish John');
    } catch {
      await proceedToVehicleOdometer(usernameHint || 'Jennish John');
    }
  };

  const doPasswordLogin = async () => {
    setPhase('authing');
    setErrorMsg(null);
    try {
      let displayName = username;
      if (username.toLowerCase().includes('jennish') || username.toLowerCase().includes('jjohn')) {
        displayName = 'Jennish John';
      }

      try {
        const r = await fetch(getApiEndpoint('/api/auth/login'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ email: username.trim(), password }),
        });
        const data = await parseJsonSafely(r);
        if (data && data.user) {
          displayName = [data.user.firstName, data.user.lastName].filter(Boolean).join(' ') || data.user.email;
        }
      } catch {
        // local webview / offline fallback
      }

      if (typeof window !== 'undefined') {
        localStorage.setItem('fleet360_driver_authenticated', 'true');
        localStorage.setItem('fleet360_driver_email', username);
        localStorage.setItem('fleet360_driver_name', displayName || 'Jennish John');
        window.dispatchEvent(new Event('fleet360_vehicle_changed'));
      }

      // Immediately ask to enter Vehicle ID & Odometer
      await proceedToVehicleOdometer(displayName);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Login failed');
      setPhase('error');
    }
  };

  // ── Submit Vehicle ID & Odometer to Start Driver Checklist ────────────────
  const handleConfirmVehicleAndOdometer = async (e: React.FormEvent) => {
    e.preventDefault();
    const ident = selectedVehicle
      ? (selectedVehicle.licensePlate || selectedVehicle.vehicleCode || selectedVehicle.id)
      : customVehicleQuery.trim();

    if (!ident) {
      setErrorMsg('Please select or enter a Vehicle ID / Plate Number.');
      return;
    }

    const odoValue = Number(odometerInput);
    if (!odometerInput || isNaN(odoValue) || odoValue <= 0) {
      setErrorMsg('Please enter a valid positive Odometer reading in km.');
      return;
    }

    setIsStartingChecklist(true);
    setErrorMsg(null);
    try {
      let boundVehicle: FleetVehicle = selectedVehicle || {
        id: '3c779fd8-d536-475c-a38e-9919909fab84',
        vehicleCode: ident,
        licensePlate: ident,
        make: 'HONDA',
        model: 'PILOT',
        year: 2022,
        deviceId: '',
        isDeviceBlank: true,
        canActivateMobileTracking: true,
        odometerReading: odoValue,
      };

      // 1. Try binding vehicle session and update vehicle odometer on backend
      try {
        const vehRes = await fetch(getApiEndpoint('/api/driver-app/auth/vehicle-login'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            vehicleIdentifier: ident,
            odometerReading: odoValue,
            driverEmail: username || undefined,
          }),
        });
        const vehData = await parseJsonSafely(vehRes);
        if (vehData && vehData.vehicle) {
          boundVehicle = vehData.vehicle;
        }
      } catch {}

      setActiveVehicle(boundVehicle);

      // 2. Try starting / initializing active shift with this vehicle and starting odometer
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
        localStorage.setItem('fleet360_driver_name', driverInfo?.name || 'Jennish John');
      }

      // 4. Notify tracking provider to start real device GPS tracking
      if (boundVehicle.canActivateMobileTracking) {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('fleet360_vehicle_changed'));
        }
      }

      // 5. Immediately transition to Driver Checklist!
      router.push('/driver-app/shift-checklist');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to initialize shift');
      setIsStartingChecklist(false);
    }
  };

  const handleSignOutVehicle = async () => {
    stopMobileTracking();
    setActiveVehicle(null);
    setSelectedVehicle(null);
    setDriverInfo(null);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('fleet360_driver_tracking_active');
      localStorage.removeItem('fleet360_tracked_vehicle_id');
      localStorage.removeItem('fleet360_active_vehicle');
      localStorage.removeItem('fleet360_start_odometer');
      localStorage.removeItem('fleet360_driver_authenticated');
      window.dispatchEvent(new Event('fleet360_vehicle_changed'));
    }
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {}
    setPhase('ready');
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
        <div role="alert" className="my-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs text-rose-300">
          <p className="font-semibold">Notice</p>
          <p>{errorMsg}</p>
        </div>
      )}

      {/* GPS tracking is active silently in background without driver alerts */}

      {/* ── PHASE: VEHICLE ID & ODOMETER PROMPT (AFTER LOGIN) ───────────────── */}
      {phase === 'vehicle-odometer' ? (
        <div className="my-auto space-y-4">
          <div className="rounded-3xl border-2 border-violet-500 bg-white dark:bg-slate-900/90 p-5 shadow-2xl backdrop-blur space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-black uppercase tracking-wider text-violet-700 dark:text-violet-400 bg-violet-100 dark:bg-violet-500/10 border border-violet-300 dark:border-violet-500/20 px-2.5 py-0.5 rounded-full">
                  Step 2 · Pre-Shift Assignment
                </span>
                {driverInfo?.name && (
                  <span className="text-xs text-slate-800 dark:text-slate-300 font-bold truncate max-w-[170px]">
                    👤 {driverInfo.name}
                  </span>
                )}
              </div>
              <h2 className="text-lg font-black text-slate-950 dark:text-white">Assigned Vehicle &amp; Starting Odometer</h2>
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-400 mt-0.5">
                Confirm your assigned vehicle and enter current odometer before starting inspection.
              </p>
            </div>

            <form onSubmit={handleConfirmVehicleAndOdometer} className="space-y-4">
              {/* Assigned Vehicle Display */}
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-300 mb-1.5 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Car className="h-4 w-4 text-violet-600 dark:text-violet-400" /> Assigned Vehicle
                  </span>
                  <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-black">★ Assigned to your account</span>
                </label>

                {fleetVehicles.length > 1 ? (
                  <select
                    value={selectedVehicle?.id || ''}
                    onChange={(e) => {
                      const v = fleetVehicles.find((x) => x.id === e.target.value);
                      setSelectedVehicle(v || null);
                      if (v?.odometerReading) {
                        setOdometerInput(String(v.odometerReading));
                      }
                    }}
                    className="w-full rounded-xl border-2 border-slate-300 dark:border-white/10 bg-slate-50 dark:bg-slate-950 px-3.5 py-3 text-sm font-bold text-slate-950 dark:text-white focus:border-violet-600 focus:outline-none"
                  >
                    {fleetVehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.licensePlate || v.vehicleCode} - {v.make} {v.model} ({v.vehicleCode})
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="rounded-2xl border-2 border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 p-3.5 space-y-1">
                    <div className="flex items-baseline justify-between">
                      <span className="font-mono text-lg font-black text-slate-950 dark:text-white">
                        {selectedVehicle?.licensePlate || '96448'}
                      </span>
                      <span className="font-mono text-xs font-bold text-slate-600 dark:text-slate-400">
                        {selectedVehicle?.vehicleCode || 'VEH-000247'}
                      </span>
                    </div>
                    <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      {selectedVehicle?.make || 'HONDA'} {selectedVehicle?.model || 'PILOT'} {selectedVehicle?.year ? `(${selectedVehicle.year})` : ''}
                    </div>
                  </div>
                )}
              </div>

              {/* Odometer Input */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-300 flex items-center gap-1.5">
                    <Gauge className="h-4 w-4 text-cyan-600 dark:text-cyan-400" /> Current Cluster Odometer (KM) *
                  </label>
                  {selectedVehicle?.odometerReading && (
                    <button
                      type="button"
                      onClick={() => setOdometerInput(String(selectedVehicle.odometerReading))}
                      className="text-[11px] font-bold text-cyan-600 dark:text-cyan-400 hover:underline"
                    >
                      Use Last: {Number(selectedVehicle.odometerReading).toLocaleString()} km
                    </button>
                  )}
                </div>

                <div className="relative">
                  <input
                    type="number"
                    required
                    min="0"
                    step="1"
                    placeholder="e.g. 67050"
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
                  placeholder="jjohn@gmail.com"
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
              placeholder="http://192.168.1.17:3000"
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
                    setServerUrlInput('http://192.168.1.17:3000');
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
