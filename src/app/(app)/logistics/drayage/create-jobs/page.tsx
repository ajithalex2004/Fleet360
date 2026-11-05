'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import {
  PlusCircle,
  Package,
  Trash2,
  Plus,
  CheckCircle2,
  AlertTriangle,
  Building2,
  MapPin,
  ShieldCheck,
  FileText,
  UploadCloud,
  X,
  Calendar,
  Clock,
  Sparkles,
  FileSpreadsheet,
  Download,
  Loader2,
} from 'lucide-react';
import { PageHeader, Panel } from '@/components/ui/page-theme';
import { SearchableSelect, type SearchableSelectOption } from '@/components/ui/SearchableSelect';
import {
  fetchDrayageWorkspaceCached,
  getCachedDrayageData,
  invalidateDrayageClientCache,
} from '@/lib/logistics/drayage-client-cache';
import {
  ConsigneeDestinationModal,
  type DrayageClientOption,
} from '@/components/logistics/drayage/ConsigneeDestinationModal';

interface CustomerOption {
  id: string;
  name: string;
}

interface TerminalOption {
  id: string;
  name: string;
  portName: string;
}

interface WarehouseOption {
  id: string;
  customerId: string | null;
  customerName: string;
  name: string;
  zone: string;
  tripAmountAed?: number;
  driverAllowanceAed?: number;
}

interface ContainerItem {
  id: string;
  containerNumber: string;
  size: '20FT' | '40FT' | '40HC' | '45HC';
  containerType: 'DRY' | 'REEFER' | 'OPEN_TOP' | 'FLAT_RACK';
  warehouseId: string;
  dischargeDate: string;
  deliveryDate?: string;
  deliveryTime?: string;
  doExpiryDate: string;
  doExpiryTime?: string;
  sealNumber: string;
  weightTonnes: number;
  customsInspection: boolean;
  municipalityInspection: boolean;
  cpipInspection: boolean;
  mercInspection: boolean;
  boxcareInspection: boolean;
}

interface ExtractionSummary {
  fileName: string;
  provider: string;
  containerCount: number;
  blOrDoNumber?: string;
  shippingLine?: string;
  matchedCustomer?: string;
  matchedTerminal?: string;
  matchedWarehouse?: string;
  confidencePct?: number;
}

function createEmptyContainerRow(
  id: string,
  defaultType: ContainerItem['containerType'] = 'DRY',
  defaultWarehouseId: string = '',
): ContainerItem {
  return {
    id,
    containerNumber: '',
    size: '40HC',
    containerType: defaultType,
    warehouseId: defaultWarehouseId,
    dischargeDate: '',
    deliveryDate: '',
    deliveryTime: '',
    doExpiryDate: '',
    doExpiryTime: '23:59',
    sealNumber: '',
    weightTonnes: 0,
    customsInspection: false,
    municipalityInspection: false,
    cpipInspection: false,
    mercInspection: false,
    boxcareInspection: false,
  };
}

export default function DrayageCreateJobsPage() {
  const router = useRouter();
  const cached = getCachedDrayageData();
  const [, setLoading] = useState(!cached?.customers?.length);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Master Data State
  const [customers, setCustomers] = useState<CustomerOption[]>(cached?.customers || []);
  const [terminals, setTerminals] = useState<TerminalOption[]>(cached?.terminals || []);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>(cached?.warehouses || []);
  const [clients, setClients] = useState<DrayageClientOption[]>(cached?.clients || []);

  // Form State (Starts empty — no random/dummy pre-fills; rates populate from Master on selection)
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [selectedTerminalId, setSelectedTerminalId] = useState<string>('');
  const [shipmentType, setShipmentType] = useState<'IMPORT' | 'EXPORT'>('IMPORT');
  const [priority, setPriority] = useState<'STANDARD' | 'HIGH' | 'URGENT'>('STANDARD');
  const [rateAmountAed, setRateAmountAed] = useState<number>(0);
  const [driverAllowanceAed, setDriverAllowanceAed] = useState<number>(0);
  const [notes, setNotes] = useState<string>('');

  // AI OCR & Manifest File Upload State
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [extractingFile, setExtractingFile] = useState(false);
  const [extractionSummary, setExtractionSummary] = useState<ExtractionSummary | null>(null);

  // Quick Customer Creation Modal State
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerType, setNewCustomerType] = useState('CORPORATE');
  const [newCustomerContact, setNewCustomerContact] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [newCustomerEmail, setNewCustomerEmail] = useState('');
  const [newCustomerTrn, setNewCustomerTrn] = useState('');
  const [newCustomerLicense, setNewCustomerLicense] = useState('');
  const [newCustomerCity, setNewCustomerCity] = useState('Dubai');
  const [savingCustomer, setSavingCustomer] = useState(false);

  // Quick Client (Client Master) Creation Modal State
  const [showClientModal, setShowClientModal] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientCode, setNewClientCode] = useState('');
  const [newClientContact, setNewClientContact] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');
  const [newClientAddress, setNewClientAddress] = useState('');
  const [newClientCity, setNewClientCity] = useState('Dubai');
  const [newClientTrn, setNewClientTrn] = useState('');
  const [newClientLicense, setNewClientLicense] = useState('');
  const [savingClient, setSavingClient] = useState(false);

  // Consignee Destination Modal State (Per-Container Facility Selection & Creation)
  const [showWarehouseModal, setShowWarehouseModal] = useState(false);
  const [activeWarehouseModalContainerId, setActiveWarehouseModalContainerId] = useState<string | null>(null);

  // Container rows (Starts with 1 completely blank row — no dummy values)
  const [containers, setContainers] = useState<ContainerItem[]>([
    createEmptyContainerRow('c-init-1'),
  ]);

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4500);
  };

  const loadMasters = useCallback(async (forceFresh = false) => {
    try {
      if (!getCachedDrayageData()?.customers?.length) {
        setLoading(true);
      }
      const data = await fetchDrayageWorkspaceCached({ forceFresh });
      const rawCustomers: CustomerOption[] = Array.isArray(data?.customers)
        ? data.customers.filter((c: CustomerOption) => !String(c?.id || '').startsWith('cli-'))
        : [];
      const rawClients: DrayageClientOption[] = Array.isArray(data?.clients) ? data.clients : [];
      setCustomers(rawCustomers);
      setTerminals(data?.terminals || []);
      setWarehouses(data?.warehouses || []);
      setClients(rawClients);
    } catch (err) {
      if (!getCachedDrayageData()?.customers?.length) {
        showToast('error', err instanceof Error ? err.message : 'Failed to load master data');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMasters();
  }, [loadMasters]);

  // Resolve facilities mapped strictly to the selected Client in Haulage Stakeholders & Port Route
  const selectedClient = useMemo(
    () => clients.find((c) => c.id === selectedClientId) || null,
    [clients, selectedClientId],
  );

  const clientWarehouses = useMemo<WarehouseOption[]>(() => {
    if (!selectedClientId) return [];
    const cli = clients.find((c) => c.id === selectedClientId);
    const normClientName = (cli?.name || '').trim().toLowerCase();
    const combined: WarehouseOption[] = [
      ...((cli?.warehouses as WarehouseOption[] | undefined) || []),
      ...warehouses,
    ];
    const seen = new Set<string>();
    const filtered: WarehouseOption[] = [];
    for (const w of combined) {
      if (!w || !w.id) continue;
      const matchId = Boolean(w.customerId && String(w.customerId) === String(selectedClientId));
      const matchName = Boolean(
        normClientName &&
          w.customerName &&
          String(w.customerName).trim().toLowerCase() === normClientName,
      );
      if (!matchId && !matchName) continue;
      if (seen.has(w.id)) continue;
      seen.add(w.id);
      filtered.push(w);
    }
    return filtered;
  }, [selectedClientId, clients, warehouses]);

  // Auto-populate Contract Rate and Driver Allowance from Client Master (or its default facility) when Client is selected
  useEffect(() => {
    if (!selectedClientId) return;
    const cli = clients.find((c) => c.id === selectedClientId);
    const primaryWh = clientWarehouses[0];
    if (cli && Number(cli.defaultTripAmountAed) > 0) {
      setRateAmountAed(Number(cli.defaultTripAmountAed));
    } else if (primaryWh && Number(primaryWh.tripAmountAed) > 0) {
      setRateAmountAed(Number(primaryWh.tripAmountAed));
    }
    if (cli && Number(cli.defaultDriverAllowanceAed) > 0) {
      setDriverAllowanceAed(Number(cli.defaultDriverAllowanceAed));
    } else if (primaryWh && Number(primaryWh.driverAllowanceAed) > 0) {
      setDriverAllowanceAed(Number(primaryWh.driverAllowanceAed));
    }
  }, [selectedClientId, clients, clientWarehouses]);

  // Ensure container warehouse selections strictly belong to the selected Client
  useEffect(() => {
    const validIds = new Set(clientWarehouses.map((w) => w.id));
    const autoDefaultWhId = clientWarehouses.length === 1 ? clientWarehouses[0].id : '';
    setContainers((prev) =>
      prev.map((c) => {
        if (!selectedClientId) {
          return c.warehouseId ? { ...c, warehouseId: '' } : c;
        }
        if (c.warehouseId && validIds.has(c.warehouseId)) {
          return c;
        }
        return { ...c, warehouseId: autoDefaultWhId };
      }),
    );
  }, [selectedClientId, clientWarehouses]);

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustomerName.trim()) {
      showToast('error', 'Please enter customer company name');
      return;
    }
    try {
      setSavingCustomer(true);
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nameEn: newCustomerName.trim(),
          customerType: newCustomerType || 'CORPORATE',
          contactPerson: newCustomerContact.trim() || undefined,
          mobileNumber: newCustomerPhone.trim() || undefined,
          email: newCustomerEmail.trim() || undefined,
          city: newCustomerCity.trim() || 'Dubai',
          taxRegistrationNumber: newCustomerTrn.trim() || undefined,
          tradeLicense: newCustomerLicense.trim() || undefined,
          country: 'UAE',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create customer');

      const createdCustomer: CustomerOption = {
        id: data.id,
        name: data.name_en || data.nameEn || newCustomerName.trim(),
      };
      setCustomers((prev) => [createdCustomer, ...prev]);
      setSelectedCustomerId(createdCustomer.id);
      setShowCustomerModal(false);
      setNewCustomerName('');
      setNewCustomerContact('');
      setNewCustomerPhone('');
      setNewCustomerEmail('');
      setNewCustomerTrn('');
      setNewCustomerLicense('');
      invalidateDrayageClientCache();
      showToast('success', `Customer "${createdCustomer.name}" created and selected!`);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error creating customer');
    } finally {
      setSavingCustomer(false);
    }
  };

  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClientName.trim()) {
      showToast('error', 'Please enter Client name');
      return;
    }
    const generatedCode =
      newClientCode.trim().toUpperCase() || newClientName.trim().slice(0, 3).toUpperCase();
    try {
      setSavingClient(true);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_client',
          name: newClientName.trim(),
          code: generatedCode,
          contactPerson: newClientContact.trim() || undefined,
          contactNo: newClientPhone.trim() || undefined,
          streetAddress: newClientAddress.trim() || undefined,
          city: newClientCity.trim() || 'Dubai',
          trn: newClientTrn.trim() || undefined,
          tradeLicense: newClientLicense.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create client');

      const createdClient: DrayageClientOption = data.client || {
        id: data.clientId || `client-${Date.now()}`,
        name: newClientName.trim(),
        code: generatedCode,
        contactPerson: newClientContact.trim() || null,
        contactNo: newClientPhone.trim() || null,
        streetAddress: newClientAddress.trim() || null,
        city: newClientCity.trim() || 'Dubai',
        trn: newClientTrn.trim() || null,
        tradeLicense: newClientLicense.trim() || null,
      };
      setClients((prev) => [createdClient, ...prev]);
      setSelectedClientId(createdClient.id);
      setShowClientModal(false);
      setNewClientName('');
      setNewClientCode('');
      setNewClientContact('');
      setNewClientPhone('');
      setNewClientAddress('');
      setNewClientTrn('');
      setNewClientLicense('');
      invalidateDrayageClientCache();
      showToast('success', `Client "${createdClient.name}" created in Client Master and selected!`);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error creating client');
    } finally {
      setSavingClient(false);
    }
  };

  const handleAddContainerRow = () => {
    const lastRow = containers[containers.length - 1];
    const isReefer = lastRow?.containerType === 'REEFER';
    const defaultWhId =
      lastRow?.warehouseId || (clientWarehouses.length === 1 ? clientWarehouses[0].id : '');
    setContainers((prev) => [
      ...prev,
      createEmptyContainerRow(
        `c-${Date.now()}-${Math.random()}`,
        isReefer ? 'REEFER' : 'DRY',
        defaultWhId,
      ),
    ]);
  };

  const handleRemoveContainerRow = (id: string) => {
    if (containers.length <= 1) {
      showToast('error', 'Manifest must have at least one container');
      return;
    }
    setContainers((prev) => prev.filter((c) => c.id !== id));
  };

  const updateContainer = (id: string, updates: Partial<ContainerItem>) => {
    setContainers((prev) => prev.map((c) => (c.id === id ? { ...c, ...updates } : c)));
  };

  // Download pre-formatted Excel (.xlsx) manifest template
  const handleDownloadManifestTemplate = () => {
    const templateHeaders = [
      [
        'Container Number',
        'Size',
        'Cargo Type',
        'Seal Number',
        'Gross Weight (Tonnes)',
        'Delivery Date (YYYY-MM-DD)',
        'Delivery Time (HH:MM)',
        'DO Expiry Date (YYYY-MM-DD)',
        'DO Cutoff Time (11:59 PM Default)',
        'Dubai Customs',
        'Municipality DM',
        'CPIP',
        'Merc Fumigation',
        'Boxcare',
        'DO / BL Number',
        'Shipping Line',
        'Consignor / Customer',
        'Port Terminal',
        'Consignee Warehouse',
        'Special Instructions',
      ],
    ];
    const ws = XLSX.utils.aoa_to_sheet(templateHeaders);
    ws['!cols'] = templateHeaders[0].map((h) => ({ wch: Math.max(h.length + 4, 16) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Container Manifest');
    const arrayBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const blob = new Blob([arrayBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Fleet360-Drayage-Manifest-Template.xlsx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Upload & Extract DO / BL / Manifest file via /api/logistics/drayage/ocr-manifest
  const handleProcessManifestFile = async (file: File) => {
    try {
      setExtractingFile(true);
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/logistics/drayage/ocr-manifest', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok || !data.ok || !data.manifest) {
        throw new Error(data.error || 'Failed to extract containers from document');
      }

      const manifest = data.manifest as {
        blOrDoNumber?: string;
        shippingLine?: string;
        customerName?: string;
        terminalName?: string;
        warehouseName?: string;
        shipmentType?: 'IMPORT' | 'EXPORT';
        notes?: string;
        provider: string;
        fileName: string;
        confidencePct?: number;
        containers: Array<{
          containerNumber: string;
          size: ContainerItem['size'];
          containerType: ContainerItem['containerType'];
          sealNumber: string;
          weightKg: number;
          dischargeDate: string;
          deliveryDate: string;
          deliveryTime: string;
          doExpiryDate: string;
          doExpiryTime: string;
          customsInspection: boolean;
          municipalityInspection: boolean;
          cpipInspection: boolean;
          mercInspection: boolean;
          boxcareInspection: boolean;
        }>;
      };

      // Token-based Master matching (prevents generic words like "LLC" or "Dubai" from false-matching)
      const STOPWORDS = new Set([
        'llc', 'fze', 'fzco', 'ltd', 'co', 'company', 'trading', 'logistics',
        'general', 'enterprise', 'enterprises', 'group', 'uae', 'dubai', 'abu', 'dhabi',
      ]);
      const tokenizeDistinctive = (s: string): string[] =>
        s
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, ' ')
          .split(/\s+/)
          .filter((w) => w.length >= 2 && !STOPWORDS.has(w));

      const findBestMasterMatch = <T,>(
        query: string | undefined,
        items: T[],
        getLabel: (item: T) => string,
      ): T | undefined => {
        if (!query || query.trim().length < 3) return undefined;
        const normQuery = query.trim().toLowerCase();
        // 1. Exact case-insensitive match
        const exact = items.find((it) => getLabel(it).trim().toLowerCase() === normQuery);
        if (exact) return exact;

        const qTokens = tokenizeDistinctive(query);
        if (qTokens.length === 0) return undefined;

        let bestItem: T | undefined;
        let bestScore = 0;
        for (const it of items) {
          const cTokens = tokenizeDistinctive(getLabel(it));
          if (cTokens.length === 0) continue;
          const matched = qTokens.filter((qt) =>
            cTokens.some((ct) => ct === qt || (qt.length >= 4 && ct.startsWith(qt)) || (ct.length >= 4 && qt.startsWith(ct))),
          );
          const score = matched.length / Math.max(Math.min(qTokens.length, cTokens.length), 1);
          if (matched.length >= 1 && score > bestScore && score >= 0.65) {
            bestScore = score;
            bestItem = it;
          }
        }
        return bestItem;
      };

      let matchedCustLabel: string | undefined;
      const foundCust = findBestMasterMatch(manifest.customerName, customers, (c) => c.name);
      if (foundCust) {
        setSelectedCustomerId(foundCust.id);
        matchedCustLabel = foundCust.name;
      }

      let matchedTermLabel: string | undefined;
      if (manifest.terminalName) {
        const q = manifest.terminalName.toUpperCase();
        const termNumMatch = q.match(/\b(?:TERMINAL\s*|T)([1234])\b/);
        const foundTerm =
          (termNumMatch
            ? terminals.find((t) =>
                new RegExp(`\\b(?:TERMINAL\\s*|T)${termNumMatch[1]}\\b`, 'i').test(t.name),
              )
            : undefined) ||
          findBestMasterMatch(manifest.terminalName, terminals, (t) => `${t.name} ${t.portName}`);
        if (foundTerm) {
          setSelectedTerminalId(foundTerm.id);
          matchedTermLabel = foundTerm.name;
        }
      }

      let matchedWhLabel: string | undefined;
      let resolvedDefaultWhId = clientWarehouses[0]?.id || '';
      const foundCli = findBestMasterMatch(manifest.warehouseName, clients, (c) => c.name);
      const foundWh = findBestMasterMatch(manifest.warehouseName, warehouses, (w) => w.name);
      if (foundCli) {
        setSelectedClientId(foundCli.id);
        matchedWhLabel = foundCli.name;
        const cliWhs = warehouses.filter(
          (w) =>
            w.customerId === foundCli.id ||
            (w.customerName && w.customerName.trim().toLowerCase() === foundCli.name.trim().toLowerCase()),
        );
        if (cliWhs[0]?.id) {
          resolvedDefaultWhId = cliWhs[0].id;
        }
      } else if (foundWh) {
        matchedWhLabel = foundWh.name;
        resolvedDefaultWhId = foundWh.id;
        const parentCli = clients.find(
          (c) =>
            c.id === foundWh.customerId ||
            (foundWh.customerName && c.name.trim().toLowerCase() === foundWh.customerName.trim().toLowerCase()),
        );
        if (parentCli) {
          setSelectedClientId(parentCli.id);
        }
      }

      const extractedRows: ContainerItem[] = (manifest.containers || []).map((c, idx) => {
        const rawW = Number(c.weightKg) || 0;
        const weightTonnes = rawW > 100 ? Math.round((rawW / 1000) * 100) / 100 : rawW;
        return {
          id: `c-ocr-${Date.now()}-${idx}`,
          containerNumber: c.containerNumber || '',
          size: c.size || '40HC',
          containerType: c.containerType || 'DRY',
          warehouseId: resolvedDefaultWhId,
          sealNumber: c.sealNumber || '',
          weightTonnes,
          dischargeDate: c.dischargeDate || c.deliveryDate || '',
          deliveryDate: c.deliveryDate || c.dischargeDate || '',
          deliveryTime: c.deliveryTime || '',
          doExpiryDate: c.doExpiryDate ? c.doExpiryDate.slice(0, 10) : '',
          doExpiryTime: '23:59',
          customsInspection: Boolean(c.customsInspection),
          municipalityInspection: Boolean(c.municipalityInspection),
          cpipInspection: Boolean(c.cpipInspection),
          mercInspection: Boolean(c.mercInspection),
          boxcareInspection: Boolean(c.boxcareInspection),
        };
      });

      if (extractedRows.length === 0) {
        throw new Error('No container records were detected in the uploaded document.');
      }

      setContainers((prev) =>
        prev.length === 1 && !prev[0].containerNumber.trim()
          ? extractedRows
          : [...prev, ...extractedRows],
      );

      if (manifest.shipmentType === 'IMPORT' || manifest.shipmentType === 'EXPORT') {
        setShipmentType(manifest.shipmentType);
      }

      if (manifest.notes || manifest.blOrDoNumber || manifest.shippingLine) {
        const noteParts = [
          manifest.blOrDoNumber ? `DO/BL: ${manifest.blOrDoNumber}` : '',
          manifest.shippingLine ? `Carrier: ${manifest.shippingLine}` : '',
          manifest.notes || '',
        ].filter(Boolean);
        const combined = Array.from(new Set(noteParts)).join(' | ');
        if (combined) {
          setNotes((prev) => (prev ? `${prev} | ${combined}` : combined));
        }
      }

      setExtractionSummary({
        fileName: manifest.fileName || file.name,
        provider: manifest.provider,
        containerCount: extractedRows.length,
        blOrDoNumber: manifest.blOrDoNumber || undefined,
        shippingLine: manifest.shippingLine || undefined,
        matchedCustomer: matchedCustLabel,
        matchedTerminal: matchedTermLabel,
        matchedWarehouse: matchedWhLabel,
        confidencePct: manifest.confidencePct,
      });

      showToast(
        'success',
        `Extracted ${extractedRows.length} container(s) from "${file.name}" into manifest!`,
      );
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error extracting manifest');
    } finally {
      setExtractingFile(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const invalidContainers = containers.filter((c) => !c.containerNumber.trim());
    if (invalidContainers.length > 0) {
      showToast('error', 'Please fill in all container numbers before submitting');
      return;
    }

    const custObj = customers.find((c) => c.id === selectedCustomerId);
    const termObj = terminals.find((t) => t.id === selectedTerminalId);
    const cliObj = clients.find((c) => c.id === selectedClientId);

    if (!custObj?.name?.trim()) {
      showToast('error', 'Please select a Customer (Consignor/Shipper) before creating jobs');
      return;
    }
    if (!termObj?.name?.trim()) {
      showToast('error', 'Please select a Port Terminal before creating jobs');
      return;
    }
    if (!cliObj?.name?.trim()) {
      showToast('error', 'Please select a Client from Client Master in Haulage Stakeholders & Port Route');
      return;
    }

    const missingFacilityIndex = containers.findIndex((c) => {
      const wh = clientWarehouses.find((w) => w.id === c.warehouseId);
      return !wh;
    });
    if (missingFacilityIndex !== -1) {
      showToast(
        'error',
        `Please select or create a Consignee Destination / Facility for Container #${missingFacilityIndex + 1} (under Client "${cliObj.name}")`,
      );
      return;
    }

    const safeRateAed = Number.isFinite(Number(rateAmountAed)) && Number(rateAmountAed) >= 0 ? Number(rateAmountAed) : 1550;
    const safeDriverAllowanceAed =
      Number.isFinite(Number(driverAllowanceAed)) && Number(driverAllowanceAed) >= 0
        ? Number(driverAllowanceAed)
        : 150;

    const firstContainerWh = clientWarehouses.find((w) => w.id === containers[0]?.warehouseId);

    try {
      setSubmitting(true);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_jobs',
          shipmentType,
          priority,
          customerId: selectedCustomerId || null,
          customerName: custObj.name.trim(),
          terminalId: selectedTerminalId || null,
          terminalName: termObj.name.trim(),
          warehouseId: firstContainerWh?.id || selectedClientId || null,
          warehouseName: firstContainerWh?.name?.trim() || cliObj.name.trim(),
          rateAmountAed: safeRateAed,
          driverAllowanceAed: safeDriverAllowanceAed,
          notes,
          containers: containers.map((c) => {
            const cntWh = clientWarehouses.find((w) => w.id === c.warehouseId);
            const cntWeightKg =
              Number.isFinite(Number(c.weightTonnes)) && Number(c.weightTonnes) > 0
                ? Math.round(Number(c.weightTonnes) * 1000)
                : 22000;
            const doDateOnly = c.doExpiryDate ? c.doExpiryDate.slice(0, 10) : '';
            const doExpiryWith1159Pm = doDateOnly ? `${doDateOnly}T23:59:00` : '';
            return {
              containerNumber: c.containerNumber.trim().toUpperCase(),
              size: c.size || '40HC',
              containerType: c.containerType || 'DRY',
              warehouseId: cntWh?.id || null,
              warehouseName: cntWh?.name?.trim() || cliObj.name.trim(),
              rateAmountAed:
                cntWh?.tripAmountAed && Number(cntWh.tripAmountAed) > 0
                  ? Number(cntWh.tripAmountAed)
                  : safeRateAed,
              driverAllowanceAed:
                cntWh?.driverAllowanceAed && Number(cntWh.driverAllowanceAed) > 0
                  ? Number(cntWh.driverAllowanceAed)
                  : safeDriverAllowanceAed,
              dischargeDate: c.deliveryDate || c.dischargeDate || '',
              deliveryDate: c.deliveryDate || c.dischargeDate || '',
              deliveryTime: c.deliveryTime || '',
              doExpiryDate: doExpiryWith1159Pm,
              doExpiryTime: '23:59',
              sealNumber: c.sealNumber || '',
              weightKg: cntWeightKg,
              customsInspection: Boolean(c.customsInspection),
              municipalityInspection: Boolean(c.municipalityInspection),
              cpipInspection: Boolean(c.cpipInspection),
              mercInspection: Boolean(c.mercInspection),
              boxcareInspection: Boolean(c.boxcareInspection),
            };
          }),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create drayage jobs');

      showToast('success', `Created ${data.createdCount} drayage job(s) successfully!`);
      invalidateDrayageClientCache();
      setTimeout(() => {
        router.push('/logistics/drayage/assignment');
      }, 1500);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error creating jobs');
    } finally {
      setSubmitting(false);
    }
  };

  // Memoized Searchable Options
  const customerOptions = useMemo<SearchableSelectOption[]>(() => {
    return customers.map((c) => ({
      value: c.id,
      label: c.name,
      sublabel: 'Customer (Consignor / Shipper)',
    }));
  }, [customers]);

  const terminalOptions = useMemo<SearchableSelectOption[]>(() => {
    return terminals.map((t) => ({
      value: t.id,
      label: `${t.name} (${t.portName})`,
      sublabel: `${t.portName} • Gate Operations`,
    }));
  }, [terminals]);

  // Strictly Client Master options for Haulage Stakeholders & Port Route
  const clientMasterOptions = useMemo<SearchableSelectOption[]>(() => {
    return clients.map((cli) => {
      const whCount = warehouses.filter(
        (w) =>
          w.customerId === cli.id ||
          (w.customerName && w.customerName.trim().toLowerCase() === cli.name.trim().toLowerCase()),
      ).length;
      return {
        value: cli.id,
        label: `${cli.name}${cli.code ? ` (${cli.code})` : ''}`,
        sublabel: cli.streetAddress
          ? `${cli.city || 'Dubai'} • ${cli.streetAddress} • ${whCount} Facility(s)`
          : `Client Master • ${cli.city || 'Dubai'} • ${whCount} Mapped Facility(s)`,
        badge: `${whCount} Dest.`,
      };
    });
  }, [clients, warehouses]);

  // Consignee Destination / Facility options strictly filtered by the selected Client
  const clientFacilityOptions = useMemo<SearchableSelectOption[]>(() => {
    return clientWarehouses.map((w) => ({
      value: w.id,
      label: `${w.name} (${w.zone})`,
      sublabel: `${selectedClient?.name || w.customerName} • Zone: ${w.zone}${
        w.tripAmountAed ? ` • Rate: AED ${w.tripAmountAed}` : ''
      }`,
      badge: w.zone,
    }));
  }, [clientWarehouses, selectedClient]);

  return (
    <div className="space-y-6">
      {/* Toast Alert */}
      {toast && (
        <div
          className={`fixed top-5 right-5 z-50 flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg text-xs font-semibold ${
            toast.type === 'success'
              ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-200'
              : 'bg-rose-950/90 border-rose-500/40 text-rose-200'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          )}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Page Header */}
      <PageHeader
        title="Create Container Drayage Jobs"
        subtitle="Provision FCL haulage jobs via AI Document OCR, Excel/CSV Manifest Import, or manual entry"
        icon={PlusCircle}
        accent="blue"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadManifestTemplate}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
              title="Download pre-formatted Excel (.xlsx) manifest template"
            >
              <Download className="w-3.5 h-3.5 text-emerald-400" />
              Excel Template (.xlsx)
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={extractingFile}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/15 border border-emerald-500/30 text-xs font-semibold text-emerald-400 hover:bg-emerald-600/25 transition-colors disabled:opacity-50"
            >
              {extractingFile ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              {extractingFile ? 'Scanning Document...' : 'Upload DO / Manifest (OCR)'}
            </button>
            <button
              type="button"
              onClick={handleAddContainerRow}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/15 border border-blue-500/30 text-xs font-semibold text-blue-400 hover:bg-blue-600/25 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Container Row
            </button>
          </div>
        }
      />

      {/* Hidden File Input for OCR & Spreadsheet Upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleProcessManifestFile(f);
        }}
      />

      {/* AI Document OCR & Automated Manifest Ingestion Dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDraggingFile(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDraggingFile(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDraggingFile(false);
          const f = e.dataTransfer.files?.[0];
          if (f) handleProcessManifestFile(f);
        }}
        onClick={() => !extractingFile && fileInputRef.current?.click()}
        className={`relative rounded-2xl border-2 border-dashed p-5 transition-all cursor-pointer ${
          isDraggingFile
            ? 'border-blue-400 bg-blue-500/10 shadow-lg'
            : 'border-blue-500/30 bg-[var(--bg-surface)] hover:border-blue-400/60 hover:bg-[var(--bg-surface-hover)]/40'
        }`}
      >
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center shrink-0">
              {extractingFile ? (
                <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
              ) : (
                <Sparkles className="w-5 h-5 text-blue-400" />
              )}
            </div>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xs sm:text-sm font-bold text-[var(--text-main)]">
                  AI Document OCR & Automated Manifest Ingestion (Zero-Typing Job Creation)
                </h3>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  PDF • Excel (.xlsx) • CSV • Image OCR
                </span>
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                {extractingFile
                  ? 'Extracting containers, seal numbers, weights, DO cutoff dates, and matching Master records...'
                  : 'Drag & drop a Shipping Line Delivery Order (PDF/Image), Dubai Trade Gate Pass, or Excel/CSV Manifest here — or click to browse.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={handleDownloadManifestTemplate}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-main)] hover:border-emerald-500/40 transition-colors"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
              Template (.xlsx)
            </button>
            <button
              type="button"
              disabled={extractingFile}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-500 transition-colors shadow-sm disabled:opacity-50"
            >
              <UploadCloud className="w-3.5 h-3.5" />
              {extractingFile ? 'Processing...' : 'Select File'}
            </button>
          </div>
        </div>

        {/* Extraction Result Summary Banner */}
        {extractionSummary && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="mt-4 pt-3.5 border-t border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-2 text-xs"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-semibold">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {extractionSummary.containerCount} Container(s) Extracted from {extractionSummary.fileName}
              </span>
              <span className="px-2 py-0.5 rounded bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[11px] font-mono text-[var(--text-muted)]">
                Engine: {extractionSummary.provider}
                {extractionSummary.confidencePct ? ` (${extractionSummary.confidencePct}%)` : ''}
              </span>
              {extractionSummary.blOrDoNumber && (
                <span className="px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/30 text-[11px] font-mono text-blue-400 font-semibold">
                  DO/BL: {extractionSummary.blOrDoNumber}
                </span>
              )}
              {extractionSummary.shippingLine && (
                <span className="px-2 py-0.5 rounded bg-violet-500/10 border border-violet-500/30 text-[11px] font-semibold text-violet-400">
                  Line: {extractionSummary.shippingLine}
                </span>
              )}
              {extractionSummary.matchedCustomer && (
                <span className="px-2 py-0.5 rounded bg-sky-500/10 border border-sky-500/30 text-[11px] font-semibold text-sky-400">
                  Matched Client: {extractionSummary.matchedCustomer}
                </span>
              )}
              {extractionSummary.matchedTerminal && (
                <span className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-[11px] font-semibold text-amber-400">
                  Matched Terminal: {extractionSummary.matchedTerminal}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setExtractionSummary(null)}
              className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-main)]"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* Main Creation Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Shipment Details Panel */}
        <Panel
          title="Shipment & Commercial Parameters"
          subtitle="Configure haulage route stakeholders, consignor billing account, consignee destination, and Master-driven commercial rates"
          icon={FileText}
          accent="blue"
          className="overflow-visible"
        >
          <div className="space-y-5 text-xs">
            {/* ── Tier 1: Haulage Route & Stakeholders (3 Spacious Columns) ── */}
            <div className="bg-[var(--bg-main)]/60 rounded-xl p-4 border border-[var(--border-subtle)] space-y-3">
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[var(--text-main)]">
                <MapPin className="w-3.5 h-3.5 text-blue-400" />
                <span>Haulage Stakeholders & Port Route</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* 1. Customer (Consignor/Shipper) */}
                <div className="space-y-1.5">
                  <label className="font-semibold text-[var(--text-main)] block">
                    Customer <span className="font-normal text-[var(--text-muted)]">(Consignor/Shipper)</span>
                  </label>
                  <SearchableSelect
                    value={selectedCustomerId}
                    onChange={(newCustId) => {
                      setSelectedCustomerId(newCustId);
                    }}
                    options={customerOptions}
                    placeholder="Search or select customer (consignor/shipper)..."
                    searchPlaceholder="Type customer name, code..."
                    addonAction={{
                      label: 'New',
                      icon: Plus,
                      title: 'Create New Customer (Consignor/Shipper)',
                      variant: 'blue',
                      onClick: () => setShowCustomerModal(true),
                    }}
                  />
                  <p className="text-[10px] text-[var(--text-muted)]">Type to search commercial haulage bill-to accounts</p>
                </div>

                {/* 2. Port Terminal */}
                <div className="space-y-1.5">
                  <label className="font-semibold text-[var(--text-main)] block">
                    Port Terminal <span className="font-normal text-[var(--text-muted)]">(Origin / Return Gate)</span>
                  </label>
                  <SearchableSelect
                    value={selectedTerminalId}
                    onChange={(newTermId) => setSelectedTerminalId(newTermId)}
                    options={terminalOptions}
                    placeholder="Search port terminal..."
                    searchPlaceholder="Type port, DP World, terminal name..."
                  />
                  <p className="text-[10px] text-[var(--text-muted)]">Primary container yard gate-in & discharge facility</p>
                </div>

                {/* 3. Client (Client Master) */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="font-semibold text-[var(--text-main)] block">
                      Client <span className="font-normal text-[var(--text-muted)]">(Client Master)</span>
                    </label>
                    {selectedClient ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        {clientWarehouses.length} Facility{clientWarehouses.length === 1 ? '' : 'ies'} Linked
                      </span>
                    ) : null}
                  </div>
                  <SearchableSelect
                    value={selectedClientId}
                    onChange={(newCliId) => setSelectedClientId(newCliId)}
                    options={clientMasterOptions}
                    placeholder="Select client from Client Master..."
                    searchPlaceholder="Type client name, code, city, contact..."
                    accent="emerald"
                    addonAction={{
                      label: 'New',
                      icon: Plus,
                      title: 'Add New Client to Client Master',
                      variant: 'emerald',
                      onClick: () => {
                        setShowClientModal(true);
                      },
                    }}
                  />
                  <p className="text-[10px] text-[var(--text-muted)]">
                    Select Client from Client Master — filters Consignee Destination facilities per container below
                  </p>
                </div>
              </div>
            </div>

            {/* ── Tier 2: Commercial Terms & Dispatch Classification (4 Distinct Columns) ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Shipment Type */}
              <div className="space-y-1.5">
                <label className="font-semibold text-[var(--text-muted)] block">Shipment Direction (FCL)</label>
                <select
                  value={shipmentType}
                  onChange={(e) => setShipmentType(e.target.value as 'IMPORT' | 'EXPORT')}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500 font-medium"
                >
                  <option value="IMPORT">IMPORT (Discharge → Delivery)</option>
                  <option value="EXPORT">EXPORT (Stuffing → Gate-In)</option>
                </select>
              </div>

              {/* Priority */}
              <div className="space-y-1.5">
                <label className="font-semibold text-[var(--text-muted)] block">Dispatch Priority</label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as 'STANDARD' | 'HIGH' | 'URGENT')}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500 font-medium"
                >
                  <option value="STANDARD">Standard Haulage</option>
                  <option value="HIGH">High Priority</option>
                  <option value="URGENT">Urgent (Demurrage Risk)</option>
                </select>
              </div>

              {/* Contract Rate */}
              <div className="space-y-1.5">
                <label className="font-semibold text-[var(--text-muted)] block">Contract Rate (AED / Container)</label>
                <div className="relative">
                  <input
                    type="number"
                    value={rateAmountAed}
                    onChange={(e) => setRateAmountAed(Number(e.target.value))}
                    className="w-full pl-3 pr-12 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500 font-mono"
                  />
                  <span className="absolute right-3 top-2 text-[10px] text-[var(--text-muted)] font-mono font-bold select-none">AED</span>
                </div>
              </div>

              {/* Driver Trip Allowance */}
              <div className="space-y-1.5">
                <label className="font-semibold text-[var(--text-muted)] block">Driver Trip Allowance (AED)</label>
                <div className="relative">
                  <input
                    type="number"
                    value={driverAllowanceAed}
                    onChange={(e) => setDriverAllowanceAed(Number(e.target.value))}
                    className="w-full pl-3 pr-12 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500 font-mono"
                  />
                  <span className="absolute right-3 top-2 text-[10px] text-[var(--text-muted)] font-mono font-bold select-none">AED</span>
                </div>
              </div>
            </div>

            {/* ── Tier 3: Special Instructions / Port Notes (Full Width) ── */}
            <div className="space-y-1.5">
              <label className="font-semibold text-[var(--text-muted)] block">
                Special Instructions, Gate Passes & Port Operational Notes
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Enter gate pass instructions, weighbridge notes, or DO reference..."
                className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500 text-xs"
              />
            </div>
          </div>
        </Panel>

        {/* Multi-Container Manifest Builder */}
        <Panel
          title={`Container Manifest (${containers.length} Units)`}
          subtitle="Configure container specifications, consignee destination/facility (filtered by selected Client), discharge timestamps, DO expiry dates, and regulatory inspection requirements"
          icon={Package}
          accent="blue"
        >
          <div className="space-y-4">
            {containers.map((c, index) => {
              const containerWarehouse = warehouses.find((w) => w.id === c.warehouseId);
              return (
              <div
                key={c.id}
                className="p-4 sm:p-5 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)] space-y-4 shadow-sm"
              >
                {/* Header: Container Unit & Quick Actions */}
                <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="w-6 h-6 rounded-lg bg-blue-600/15 text-blue-400 font-bold flex items-center justify-center text-xs">
                      {index + 1}
                    </span>
                    <span className="text-xs font-bold text-[var(--text-main)]">
                      Container #{index + 1}
                    </span>
                    {c.containerNumber ? (
                      <span className="font-mono text-xs px-2 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-blue-400 font-bold tracking-wide">
                        {c.containerNumber}
                      </span>
                    ) : null}
                    {containerWarehouse ? (
                      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold">
                        <MapPin className="w-3 h-3" />
                        {containerWarehouse.name} ({containerWarehouse.zone})
                      </span>
                    ) : null}
                  </div>
                  {containers.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveContainerRow(c.id)}
                      className="text-xs text-rose-400 hover:text-rose-300 inline-flex items-center gap-1.5 font-medium px-2 py-1 rounded-md hover:bg-rose-500/10 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Remove Unit
                    </button>
                  )}
                </div>

                {/* ── Tier 0: Consignee Destination / Facility (Per-Container, Filtered by Selected Client) ── */}
                <div className="p-3.5 rounded-xl bg-[var(--bg-surface)] border border-emerald-500/20 space-y-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="text-[11px] font-bold text-[var(--text-main)] flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Consignee Destination / Facility *</span>
                      {selectedClient ? (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          Client: {selectedClient.name}
                        </span>
                      ) : (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                          Select Client in Stakeholders section above
                        </span>
                      )}
                    </label>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          if (!selectedClientId) {
                            showToast('error', 'Please select a Client in Haulage Stakeholders & Port Route first.');
                            return;
                          }
                          setActiveWarehouseModalContainerId(c.id);
                          setShowWarehouseModal(true);
                        }}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 transition-colors"
                        title="Create & plot a new Consignee Destination / Facility for the selected Client"
                      >
                        <Plus className="w-3 h-3" />
                        Add / Plot New Facility for Client
                      </button>
                      <Link
                        href="/logistics/drayage/terminal-map"
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--text-muted)] hover:text-emerald-300 transition-colors"
                        title="Open Terminal & Consignee Map directly"
                      >
                        <MapPin className="w-3 h-3" />
                        Map Page
                      </Link>
                    </div>
                  </div>
                  <SearchableSelect
                    value={c.warehouseId}
                    onChange={(newWhId) => {
                      updateContainer(c.id, { warehouseId: newWhId });
                      const wh = warehouses.find((w) => w.id === newWhId);
                      if (wh) {
                        if (wh.tripAmountAed && wh.tripAmountAed > 0) setRateAmountAed(wh.tripAmountAed);
                        if (wh.driverAllowanceAed && wh.driverAllowanceAed > 0) setDriverAllowanceAed(wh.driverAllowanceAed);
                      }
                    }}
                    options={clientFacilityOptions}
                    placeholder={
                      selectedClient
                        ? clientFacilityOptions.length > 0
                          ? `Select destination facility for ${selectedClient.name}...`
                          : `No facilities found for ${selectedClient.name} — click "+ New" to add one`
                        : 'Select a Client in Haulage Stakeholders & Port Route first...'
                    }
                    searchPlaceholder="Type facility name, warehouse, JAFZA, DIC, city..."
                    accent="emerald"
                    addonAction={{
                      label: 'New',
                      icon: Plus,
                      title: 'Add Consignee Destination / Facility for Selected Client',
                      variant: 'emerald',
                      onClick: () => {
                        if (!selectedClientId) {
                          showToast('error', 'Please select a Client in Haulage Stakeholders & Port Route first.');
                          return;
                        }
                        setActiveWarehouseModalContainerId(c.id);
                        setShowWarehouseModal(true);
                      },
                    }}
                  />
                  <p className="text-[10px] text-[var(--text-muted)]">
                    Showing only Consignee Destination / Warehouse facilities belonging to{' '}
                    <span className="font-semibold text-[var(--text-main)]">
                      {selectedClient ? selectedClient.name : 'the selected Client'}
                    </span>
                  </p>
                </div>

                {/* ── Tier 1: Container Physical Specifications (5 Columns) ── */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5 text-xs">
                  {/* Container Number */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold text-[var(--text-muted)] flex items-center justify-between">
                      <span>Container Number *</span>
                      <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-mono">ISO 6346</span>
                    </label>
                    <input
                      type="text"
                      value={c.containerNumber}
                      onChange={(e) => updateContainer(c.id, { containerNumber: e.target.value.toUpperCase() })}
                      placeholder="Enter container number"
                      className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono font-bold uppercase outline-none focus:border-blue-500 text-xs shadow-inner"
                    />
                  </div>

                  {/* Size */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold text-[var(--text-muted)]">Container Size</label>
                    <select
                      value={c.size}
                      onChange={(e) => updateContainer(c.id, { size: e.target.value as ContainerItem['size'] })}
                      className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500 text-xs font-medium"
                    >
                      <option value="40HC">40HC (40ft High Cube)</option>
                      <option value="40FT">40FT (Standard Dry)</option>
                      <option value="20FT">20FT (Dry Box)</option>
                      <option value="45HC">45HC (High Cube)</option>
                    </select>
                  </div>

                  {/* Type */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold text-[var(--text-muted)]">Cargo / Equipment Type</label>
                    <select
                      value={c.containerType}
                      onChange={(e) => updateContainer(c.id, { containerType: e.target.value as ContainerItem['containerType'] })}
                      className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500 text-xs font-medium"
                    >
                      <option value="DRY">DRY (General Merchandise)</option>
                      <option value="REEFER">REEFER (Refrigerated)</option>
                      <option value="OPEN_TOP">OPEN TOP</option>
                      <option value="FLAT_RACK">FLAT RACK</option>
                    </select>
                  </div>

                  {/* Seal Number */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold text-[var(--text-muted)] flex items-center justify-between">
                      <span>Seal Number</span>
                      <span className="text-[10px] text-[var(--text-muted)]">Liner / Bolt</span>
                    </label>
                    <input
                      type="text"
                      value={c.sealNumber}
                      onChange={(e) => updateContainer(c.id, { sealNumber: e.target.value })}
                      placeholder="Enter seal number"
                      className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono outline-none focus:border-blue-500 text-xs"
                    />
                  </div>

                  {/* Gross Weight (Tonnes) */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold text-[var(--text-muted)] flex items-center justify-between">
                      <span>Gross Weight</span>
                      <span className="text-[10px] text-blue-400 font-mono font-bold">TONNES</span>
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        value={c.weightTonnes || ''}
                        onChange={(e) => updateContainer(c.id, { weightTonnes: Number(e.target.value) || 0 })}
                        placeholder="0.00"
                        className="w-full pl-3 pr-14 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono outline-none focus:border-blue-500 text-xs"
                      />
                      <span className="absolute right-2.5 top-2 text-[10px] text-[var(--text-muted)] font-mono font-bold select-none">
                        TONNES
                      </span>
                    </div>
                  </div>
                </div>

                {/* ── Tier 2: Schedule & Expiry Timings (2 Spacious Half-Width Cards) ── */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
                  {/* Card 1: Target Delivery Schedule */}
                  <div className="p-3.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center">
                          <Calendar className="w-3.5 h-3.5" />
                        </div>
                        <div>
                          <span className="font-semibold text-xs text-[var(--text-main)]">Target Delivery Schedule</span>
                          <p className="text-[10px] text-[var(--text-muted)]">Consignee ramp arrival & discharge window</p>
                        </div>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium">
                        Client Window
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                      <div className="sm:col-span-7 space-y-1">
                        <label className="text-[11px] font-medium text-[var(--text-muted)] flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-blue-400" />
                          <span>Discharge/Delivery Date *</span>
                        </label>
                        <input
                          type="date"
                          value={c.deliveryDate || c.dischargeDate}
                          onChange={(e) => updateContainer(c.id, { deliveryDate: e.target.value, dischargeDate: e.target.value })}
                          className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500 text-xs font-medium cursor-pointer"
                        />
                      </div>

                      <div className="sm:col-span-5 space-y-1">
                        <label className="text-[11px] font-medium text-[var(--text-muted)] flex items-center gap-1">
                          <Clock className="w-3 h-3 text-blue-400" />
                          <span>Target Time</span>
                        </label>
                        <input
                          type="time"
                          value={c.deliveryTime || ''}
                          onChange={(e) => updateContainer(c.id, { deliveryTime: e.target.value })}
                          className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500 text-xs font-medium font-mono cursor-pointer"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Card 2: Delivery Order (DO) Expiry */}
                  <div className="p-3.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center">
                          <Clock className="w-3.5 h-3.5" />
                        </div>
                        <div>
                          <span className="font-semibold text-xs text-[var(--text-main)]">Delivery Order (DO) Validity</span>
                          <p className="text-[10px] text-[var(--text-muted)]">Port free time cutoff before demurrage/detention</p>
                        </div>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium">
                        Demurrage Cutoff
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                      <div className="sm:col-span-7 space-y-1">
                        <label className="text-[11px] font-medium text-[var(--text-muted)] flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-amber-400" />
                          <span>DO Validity Date *</span>
                        </label>
                        <input
                          type="date"
                          value={c.doExpiryDate}
                          onChange={(e) => updateContainer(c.id, { doExpiryDate: e.target.value, doExpiryTime: '23:59' })}
                          className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500 text-xs font-medium cursor-pointer"
                        />
                      </div>

                      <div className="sm:col-span-5 space-y-1">
                        <label className="text-[11px] font-medium text-[var(--text-muted)] flex items-center gap-1">
                          <Clock className="w-3 h-3 text-amber-400" />
                          <span>DO Cutoff Time (Fixed)</span>
                        </label>
                        <div
                          title="DO Validity cutoff time is fixed to 11:59 PM by default; only DO Date is editable"
                          className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)]/70 border border-[var(--border-subtle)] text-amber-400 text-xs font-bold font-mono flex items-center justify-between select-none cursor-not-allowed"
                        >
                          <span>11:59 PM</span>
                          <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-300">
                            Default
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ── Tier 3: Regulatory Inspection Clearance Flags ── */}
                <div className="pt-2 border-t border-[var(--border-subtle)]">
                  <div className="text-[10px] uppercase tracking-wider font-semibold text-[var(--text-muted)] mb-2 flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
                    <span>Regulatory Inspection Clearance Flags:</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2.5 text-xs">
                    <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-blue-500/40 cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={c.customsInspection}
                        onChange={(e) => updateContainer(c.id, { customsInspection: e.target.checked })}
                        className="rounded border-[var(--border-subtle)] text-blue-600 focus:ring-0 cursor-pointer"
                      />
                      <span className="font-medium text-[var(--text-main)]">Dubai Customs</span>
                    </label>
                    <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-blue-500/40 cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={c.municipalityInspection}
                        onChange={(e) => updateContainer(c.id, { municipalityInspection: e.target.checked })}
                        className="rounded border-[var(--border-subtle)] text-blue-600 focus:ring-0 cursor-pointer"
                      />
                      <span className="font-medium text-[var(--text-main)]">Municipality (DM)</span>
                    </label>
                    <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-blue-500/40 cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={c.cpipInspection}
                        onChange={(e) => updateContainer(c.id, { cpipInspection: e.target.checked })}
                        className="rounded border-[var(--border-subtle)] text-blue-600 focus:ring-0 cursor-pointer"
                      />
                      <span className="font-medium text-[var(--text-main)]">CPIP Inspection</span>
                    </label>
                    <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-blue-500/40 cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={c.mercInspection}
                        onChange={(e) => updateContainer(c.id, { mercInspection: e.target.checked })}
                        className="rounded border-[var(--border-subtle)] text-blue-600 focus:ring-0 cursor-pointer"
                      />
                      <span className="font-medium text-[var(--text-main)]">Merc / Fumigation</span>
                    </label>
                    <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-blue-500/40 cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={c.boxcareInspection}
                        onChange={(e) => updateContainer(c.id, { boxcareInspection: e.target.checked })}
                        className="rounded border-[var(--border-subtle)] text-blue-600 focus:ring-0 cursor-pointer"
                      />
                      <span className="font-medium text-[var(--text-main)]">Boxcare Seal Audit</span>
                    </label>
                  </div>
                </div>
              </div>
              );
            })}
          </div>

          <div className="mt-4 pt-3 border-t border-[var(--border-subtle)] flex items-center justify-between">
            <button
              type="button"
              onClick={handleAddContainerRow}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add Another Container
            </button>

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-500 transition-colors shadow-sm disabled:opacity-50"
            >
              <PlusCircle className={`w-4 h-4 ${submitting ? 'animate-spin' : ''}`} />
              {submitting ? 'Creating Drayage Jobs...' : `Submit & Create ${containers.length} Job(s)`}
            </button>
          </div>
        </Panel>
      </form>

      {/* Quick Create Customer Modal */}
      {showCustomerModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <h3 className="text-sm font-bold text-[var(--text-main)] flex items-center gap-2">
                <Building2 className="w-4 h-4 text-blue-400" />
                Create Consignor Customer (Shipper / Bill-To Party)
              </h3>
              <button
                type="button"
                onClick={() => setShowCustomerModal(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-main)] p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateCustomer} className="space-y-3.5 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-[var(--text-muted)]">
                  Consignor Company Name (Customer / Shipper) *
                </label>
                <input
                  type="text"
                  required
                  value={newCustomerName}
                  onChange={(e) => setNewCustomerName(e.target.value)}
                  placeholder="Enter company name"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Consignor Type</label>
                  <select
                    value={newCustomerType}
                    onChange={(e) => setNewCustomerType(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                  >
                    <option value="CORPORATE">Corporate Shipper</option>
                    <option value="INTERNAL">Internal Division</option>
                    <option value="VIP">VIP Key Account</option>
                    <option value="INDIVIDUAL">Individual Consignor / Merchant</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Emirate / City</label>
                  <select
                    value={newCustomerCity}
                    onChange={(e) => setNewCustomerCity(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                  >
                    <option value="Dubai">Dubai</option>
                    <option value="Abu Dhabi">Abu Dhabi</option>
                    <option value="Sharjah">Sharjah</option>
                    <option value="Ajman">Ajman</option>
                    <option value="Ras Al Khaimah">Ras Al Khaimah</option>
                    <option value="Fujairah">Fujairah</option>
                    <option value="Umm Al Quwain">Umm Al Quwain</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Contact Person</label>
                  <input
                    type="text"
                    value={newCustomerContact}
                    onChange={(e) => setNewCustomerContact(e.target.value)}
                    placeholder="Enter contact person"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Phone / Mobile</label>
                  <input
                    type="tel"
                    value={newCustomerPhone}
                    onChange={(e) => setNewCustomerPhone(e.target.value)}
                    placeholder="+971 50 000 0000"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[var(--text-muted)]">Email Address</label>
                <input
                  type="email"
                  value={newCustomerEmail}
                  onChange={(e) => setNewCustomerEmail(e.target.value)}
                  placeholder="Enter email address"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">UAE TRN (Tax No.)</label>
                  <input
                    type="text"
                    value={newCustomerTrn}
                    onChange={(e) => setNewCustomerTrn(e.target.value)}
                    placeholder="100XXXXXXXXX003"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Trade License</label>
                  <input
                    type="text"
                    value={newCustomerLicense}
                    onChange={(e) => setNewCustomerLicense(e.target.value)}
                    placeholder="Enter trade license"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border-subtle)]">
                <button
                  type="button"
                  onClick={() => setShowCustomerModal(false)}
                  className="px-3.5 py-1.5 rounded-lg border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingCustomer}
                  className="px-4 py-1.5 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-500 transition-colors disabled:opacity-50"
                >
                  {savingCustomer ? 'Creating Customer...' : 'Save & Select Customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quick Create Client (Client Master) Modal */}
      {showClientModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <h3 className="text-sm font-bold text-[var(--text-main)] flex items-center gap-2">
                <Building2 className="w-4 h-4 text-emerald-400" />
                Create New Client (Client Master)
              </h3>
              <button
                type="button"
                onClick={() => setShowClientModal(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-main)] p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateClient} className="space-y-3.5 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-[var(--text-muted)]">
                  Client Company Name (Consignee / End User) *
                </label>
                <input
                  type="text"
                  required
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  placeholder="Enter client company name"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Client Code (Optional)</label>
                  <input
                    type="text"
                    value={newClientCode}
                    onChange={(e) => setNewClientCode(e.target.value.toUpperCase())}
                    placeholder="Auto-generated if blank"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono outline-none focus:border-emerald-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Emirate / City</label>
                  <select
                    value={newClientCity}
                    onChange={(e) => setNewClientCity(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-emerald-500"
                  >
                    <option value="Dubai">Dubai</option>
                    <option value="Abu Dhabi">Abu Dhabi</option>
                    <option value="Sharjah">Sharjah</option>
                    <option value="Ajman">Ajman</option>
                    <option value="Ras Al Khaimah">Ras Al Khaimah</option>
                    <option value="Fujairah">Fujairah</option>
                    <option value="Umm Al Quwain">Umm Al Quwain</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Contact Person</label>
                  <input
                    type="text"
                    value={newClientContact}
                    onChange={(e) => setNewClientContact(e.target.value)}
                    placeholder="Enter contact person"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-emerald-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Phone / Mobile</label>
                  <input
                    type="tel"
                    value={newClientPhone}
                    onChange={(e) => setNewClientPhone(e.target.value)}
                    placeholder="+971 50 000 0000"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[var(--text-muted)]">Primary Address / Industrial Zone</label>
                <input
                  type="text"
                  value={newClientAddress}
                  onChange={(e) => setNewClientAddress(e.target.value)}
                  placeholder="Enter client office or primary zone address"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">UAE TRN (Tax No.)</label>
                  <input
                    type="text"
                    value={newClientTrn}
                    onChange={(e) => setNewClientTrn(e.target.value)}
                    placeholder="100XXXXXXXXX003"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-emerald-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Trade License</label>
                  <input
                    type="text"
                    value={newClientLicense}
                    onChange={(e) => setNewClientLicense(e.target.value)}
                    placeholder="Enter trade license"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border-subtle)]">
                <button
                  type="button"
                  onClick={() => setShowClientModal(false)}
                  className="px-3.5 py-1.5 rounded-lg border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingClient}
                  className="px-4 py-1.5 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-500 transition-colors disabled:opacity-50"
                >
                  {savingClient ? 'Creating Client...' : 'Save & Select Client'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Unified Consignee Destination (Client Facility / Warehouse) Modal */}
      <ConsigneeDestinationModal
        isOpen={showWarehouseModal}
        onClose={() => {
          setShowWarehouseModal(false);
          setActiveWarehouseModalContainerId(null);
        }}
        clients={clients}
        warehouses={warehouses}
        defaultClientId={selectedClientId || null}
        forceNewFacility={true}
        onClientCreated={(newCli) => {
          setClients((prev) => [newCli, ...prev]);
          if (newCli.id) {
            setSelectedClientId(newCli.id);
          }
        }}
        onSaved={async (savedWh) => {
          invalidateDrayageClientCache();
          await loadMasters(true);
          if (savedWh.customerId) {
            setSelectedClientId(savedWh.customerId);
          }
          const createdWhId = savedWh.id;
          if (createdWhId) {
            if (activeWarehouseModalContainerId) {
              updateContainer(activeWarehouseModalContainerId, { warehouseId: createdWhId });
            } else {
              setContainers((prev) =>
                prev.map((row) => (!row.warehouseId ? { ...row, warehouseId: createdWhId } : row))
              );
            }
          }
          if (savedWh.tripAmountAed) {
            setRateAmountAed(savedWh.tripAmountAed);
          }
          if (savedWh.driverAllowanceAed) {
            setDriverAllowanceAed(savedWh.driverAllowanceAed);
          }
          setShowWarehouseModal(false);
          setActiveWarehouseModalContainerId(null);
          showToast('success', `Consignee destination "${savedWh.name}" added and assigned to container!`);
        }}
      />
    </div>
  );
}
