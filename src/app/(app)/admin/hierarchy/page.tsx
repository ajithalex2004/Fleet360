'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Plus,
  Search,
  CheckCircle2,
  AlertTriangle,
  FolderTree,
  Building2,
  MapPin,
  Layers,
  ChevronRight,
  ChevronDown,
  Edit2,
  Trash2,
  RotateCcw,
} from 'lucide-react';

export interface HierarchyNode {
  id: string;
  name: string;
  code?: string | null;
  level: 'REGION' | 'DEPARTMENT' | 'UNIT';
  parent_id?: string | null;
  parent_name?: string | null;
  parent_code?: string | null;
  description?: string | null;
  is_active?: boolean;
  departments?: DepartmentNode[];
  sections?: HierarchyNode[];
  departmentsCount?: number;
  sectionsCount?: number;
  unitsCount?: number;
}

export interface DepartmentNode extends HierarchyNode {
  sections: HierarchyNode[];
}

export interface RegionNode extends HierarchyNode {
  departments: DepartmentNode[];
}

type ActiveTab = 'TREE' | 'REGIONS' | 'DEPARTMENTS' | 'SECTIONS';

interface ModalState {
  isOpen: boolean;
  mode: 'CREATE' | 'EDIT';
  level: 'REGION' | 'DEPARTMENT' | 'UNIT';
  nodeId?: string;
  name: string;
  code: string;
  parentId: string;
  description: string;
  isActive: boolean;
}

const INITIAL_MODAL: ModalState = {
  isOpen: false,
  mode: 'CREATE',
  level: 'REGION',
  name: '',
  code: '',
  parentId: '',
  description: '',
  isActive: true,
};

export default function OrganizationHierarchyMasterPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('TREE');
  const [treeData, setTreeData] = useState<RegionNode[]>([]);
  const [flatNodes, setFlatNodes] = useState<HierarchyNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [regionFilter, setRegionFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');

  // Expanded nodes state in Tree view
  const [expandedRegions, setExpandedRegions] = useState<Record<string, boolean>>({});
  const [expandedDepts, setExpandedDepts] = useState<Record<string, boolean>>({});

  // Modal
  const [modal, setModal] = useState<ModalState>(INITIAL_MODAL);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Fetch Hierarchy
  const fetchHierarchy = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [treeRes, allRes] = await Promise.all([
        fetch('/api/customer-hierarchy?tree=true&includeInactive=true'),
        fetch('/api/customer-hierarchy?all=true&includeInactive=true'),
      ]);

      if (!treeRes.ok || !allRes.ok) {
        throw new Error('Failed to load organizational hierarchy');
      }

      const treeJson = await treeRes.json();
      const allJson = await allRes.json();

      const regions: RegionNode[] = treeJson.tree || [];
      setTreeData(regions);
      setFlatNodes(Array.isArray(allJson) ? allJson : []);

      // Auto-expand all regions on initial load
      const initExpReg: Record<string, boolean> = {};
      const initExpDept: Record<string, boolean> = {};
      regions.forEach((r) => {
        initExpReg[r.id] = true;
        r.departments?.forEach((d) => {
          initExpDept[d.id] = true;
        });
      });
      setExpandedRegions(initExpReg);
      setExpandedDepts(initExpDept);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHierarchy();
  }, [fetchHierarchy]);

  // Derived filtered collections
  const allRegions = useMemo(() => flatNodes.filter((n) => n.level === 'REGION'), [flatNodes]);
  const allDepartments = useMemo(() => flatNodes.filter((n) => n.level === 'DEPARTMENT'), [flatNodes]);
  const allSections = useMemo(() => flatNodes.filter((n) => n.level === 'UNIT'), [flatNodes]);

  const activeRegions = useMemo(() => allRegions.filter((r) => r.is_active !== false), [allRegions]);
  const activeDepartments = useMemo(() => allDepartments.filter((d) => d.is_active !== false), [allDepartments]);

  // Quick stats
  const stats = useMemo(() => {
    return {
      regionsCount: allRegions.length,
      departmentsCount: allDepartments.length,
      sectionsCount: allSections.length,
      totalCount: flatNodes.length,
      activeCount: flatNodes.filter((n) => n.is_active !== false).length,
    };
  }, [allRegions, allDepartments, allSections, flatNodes]);

  // Filtered lists for table tabs
  const filteredRegions = useMemo(() => {
    return allRegions.filter((r) => {
      if (search && !r.name.toLowerCase().includes(search.toLowerCase()) && !r.code?.toLowerCase().includes(search.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [allRegions, search]);

  const filteredDepartments = useMemo(() => {
    return allDepartments.filter((d) => {
      if (regionFilter && d.parent_id !== regionFilter) return false;
      if (search && !d.name.toLowerCase().includes(search.toLowerCase()) && !d.code?.toLowerCase().includes(search.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [allDepartments, regionFilter, search]);

  const filteredSections = useMemo(() => {
    return allSections.filter((s) => {
      if (deptFilter && s.parent_id !== deptFilter) return false;
      if (regionFilter) {
        const parentDept = allDepartments.find((d) => d.id === s.parent_id);
        if (!parentDept || parentDept.parent_id !== regionFilter) return false;
      }
      if (search && !s.name.toLowerCase().includes(search.toLowerCase()) && !s.code?.toLowerCase().includes(search.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [allSections, regionFilter, deptFilter, allDepartments, search]);

  // Modal actions
  const openCreateModal = (level: 'REGION' | 'DEPARTMENT' | 'UNIT', defaultParentId?: string) => {
    setModal({
      isOpen: true,
      mode: 'CREATE',
      level,
      name: '',
      code: '',
      parentId: defaultParentId || (level === 'DEPARTMENT' ? activeRegions[0]?.id || '' : activeDepartments[0]?.id || ''),
      description: '',
      isActive: true,
    });
    setFormError('');
  };

  const openEditModal = (node: HierarchyNode) => {
    setModal({
      isOpen: true,
      mode: 'EDIT',
      level: node.level,
      nodeId: node.id,
      name: node.name,
      code: node.code || '',
      parentId: node.parent_id || '',
      description: node.description || '',
      isActive: node.is_active !== false,
    });
    setFormError('');
  };

  const handleSave = async () => {
    setFormError('');
    if (!modal.name.trim()) {
      setFormError('Name is required');
      return;
    }
    if (modal.level !== 'REGION' && !modal.parentId) {
      setFormError(`Please select a parent ${modal.level === 'DEPARTMENT' ? 'Region' : 'Department'}`);
      return;
    }

    setSaving(true);
    try {
      if (modal.mode === 'CREATE') {
        const payload = {
          level: modal.level,
          name: modal.name.trim(),
          code: modal.code.trim().toUpperCase() || null,
          parentId: modal.parentId || null,
          description: modal.description.trim() || null,
          isActive: modal.isActive,
        };
        const res = await fetch('/api/customer-hierarchy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error || 'Failed to create hierarchy node');
        }
      } else {
        const payload = {
          name: modal.name.trim(),
          code: modal.code.trim().toUpperCase() || null,
          parentId: modal.parentId || null,
          description: modal.description.trim() || null,
          isActive: modal.isActive,
        };
        const res = await fetch(`/api/customer-hierarchy/${modal.nodeId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error || 'Failed to update hierarchy node');
        }
      }

      setModal(INITIAL_MODAL);
      fetchHierarchy();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (node: HierarchyNode) => {
    setActionLoading(node.id);
    try {
      const nextActive = !(node.is_active !== false);
      const res = await fetch(`/api/customer-hierarchy/${node.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: nextActive }),
      });
      if (!res.ok) throw new Error('Toggle active failed');
      fetchHierarchy();
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (node: HierarchyNode) => {
    const childCount =
      node.level === 'REGION'
        ? allDepartments.filter((d) => d.parent_id === node.id).length
        : allSections.filter((s) => s.parent_id === node.id).length;

    let confirmMsg = `Are you sure you want to delete ${node.level} "${node.name}"?`;
    if (childCount > 0) {
      confirmMsg += ` Warning: This ${node.level} contains ${childCount} child items which will also be deactivated.`;
    }

    if (!confirm(confirmMsg)) return;

    setActionLoading(node.id);
    try {
      const res = await fetch(`/api/customer-hierarchy/${node.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      fetchHierarchy();
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(null);
    }
  };

  const toggleRegionExpand = (id: string) => {
    setExpandedRegions((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleDeptExpand = (id: string) => {
    setExpandedDepts((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const inputCls =
    'bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-4 py-2.5 text-[var(--text-main)] text-sm focus:border-orange-500/50 focus:outline-none w-full transition-colors';
  const labelCls = 'block text-xs font-medium text-[var(--text-muted)] mb-1.5';

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link
              href="/admin"
              className="text-xs text-[var(--text-muted)] hover:text-orange-400 flex items-center gap-1 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to Administration
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-orange-400">
              <FolderTree className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[var(--text-main)]">
                Region, Department & Section Master
              </h1>
              <p className="text-[var(--text-muted)] text-xs mt-0.5">
                Centralized 3-level organizational hierarchy (Region ➔ Department ➔ Section / Unit) for fleet allocations, vehicles & logistics
              </p>
            </div>
          </div>
        </div>

        {/* Quick Create Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => openCreateModal('REGION')}
            className="flex items-center gap-1.5 px-3 py-2 bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl text-xs font-semibold text-[var(--text-main)] transition-all shadow-sm"
          >
            <Plus className="w-3.5 h-3.5 text-blue-400" />
            <span>+ Add Region</span>
          </button>
          <button
            onClick={() => openCreateModal('DEPARTMENT')}
            className="flex items-center gap-1.5 px-3 py-2 bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl text-xs font-semibold text-[var(--text-main)] transition-all shadow-sm"
          >
            <Plus className="w-3.5 h-3.5 text-purple-400" />
            <span>+ Add Department</span>
          </button>
          <button
            onClick={() => openCreateModal('UNIT')}
            className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white rounded-xl text-xs font-semibold transition-all shadow-md shadow-orange-500/20"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>+ Add Section</span>
          </button>
        </div>
      </div>

      {/* KPI Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-4 flex items-center gap-3 shadow-sm">
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 flex-shrink-0">
            <MapPin className="w-5 h-5" />
          </div>
          <div>
            <span className="text-xs text-[var(--text-muted)] font-medium block">Level 1: Regions</span>
            <span className="text-2xl font-bold text-[var(--text-main)]">{stats.regionsCount}</span>
          </div>
        </div>

        <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-4 flex items-center gap-3 shadow-sm">
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 flex-shrink-0">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <span className="text-xs text-[var(--text-muted)] font-medium block">Level 2: Departments</span>
            <span className="text-2xl font-bold text-[var(--text-main)]">{stats.departmentsCount}</span>
          </div>
        </div>

        <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-4 flex items-center gap-3 shadow-sm">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 flex-shrink-0">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <span className="text-xs text-[var(--text-muted)] font-medium block">Level 3: Sections / Units</span>
            <span className="text-2xl font-bold text-[var(--text-main)]">{stats.sectionsCount}</span>
          </div>
        </div>

        <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-4 flex items-center gap-3 shadow-sm">
          <div className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-orange-400 flex-shrink-0">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <span className="text-xs text-[var(--text-muted)] font-medium block">Active Coverage</span>
            <span className="text-2xl font-bold text-orange-400">
              {stats.totalCount > 0 ? `${Math.round((stats.activeCount / stats.totalCount) * 100)}%` : '100%'}
            </span>
          </div>
        </div>
      </div>

      {/* Navigation View Switcher (Tree vs Master Tables) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-2">
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-none">
          <button
            onClick={() => setActiveTab('TREE')}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 ${
              activeTab === 'TREE'
                ? 'bg-orange-500 text-white shadow-md shadow-orange-500/20'
                : 'bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-muted)] border border-[var(--border-subtle)]'
            }`}
          >
            <FolderTree className="w-3.5 h-3.5" />
            <span>Interactive Hierarchy Tree</span>
          </button>

          <button
            onClick={() => setActiveTab('REGIONS')}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 ${
              activeTab === 'REGIONS'
                ? 'bg-orange-500 text-white shadow-md shadow-orange-500/20'
                : 'bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-muted)] border border-[var(--border-subtle)]'
            }`}
          >
            <MapPin className="w-3.5 h-3.5" />
            <span>Region Master ({stats.regionsCount})</span>
          </button>

          <button
            onClick={() => setActiveTab('DEPARTMENTS')}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 ${
              activeTab === 'DEPARTMENTS'
                ? 'bg-orange-500 text-white shadow-md shadow-orange-500/20'
                : 'bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-muted)] border border-[var(--border-subtle)]'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>Department Master ({stats.departmentsCount})</span>
          </button>

          <button
            onClick={() => setActiveTab('SECTIONS')}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 ${
              activeTab === 'SECTIONS'
                ? 'bg-orange-500 text-white shadow-md shadow-orange-500/20'
                : 'bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-muted)] border border-[var(--border-subtle)]'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Section Master ({stats.sectionsCount})</span>
          </button>
        </div>

        <button
          onClick={fetchHierarchy}
          className="px-3 py-1.5 bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl text-xs font-medium text-[var(--text-muted)] flex items-center gap-1.5 transition-colors self-end sm:self-auto"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}

      {/* ─────────────────── TAB 1: INTERACTIVE HIERARCHY TREE VIEW ─────────────────── */}
      {activeTab === 'TREE' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-[var(--text-muted)] px-1">
            <span className="font-medium">
              Click on any Region or Department to expand/collapse child hierarchy levels.
            </span>
            <div className="flex items-center gap-3 text-[11px]">
              <span className="flex items-center gap-1 text-blue-400">
                <span className="w-2 h-2 rounded-full bg-blue-400"></span> Level 1: Region
              </span>
              <span className="flex items-center gap-1 text-purple-400">
                <span className="w-2 h-2 rounded-full bg-purple-400"></span> Level 2: Department
              </span>
              <span className="flex items-center gap-1 text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span> Level 3: Section
              </span>
            </div>
          </div>

          {loading ? (
            <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-12 text-center text-[var(--text-faint)]">
              Loading organizational hierarchy tree...
            </div>
          ) : treeData.length === 0 ? (
            <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-12 text-center text-[var(--text-faint)]">
              No regions configured yet. Click <strong>+ Add Region</strong> to begin building your hierarchy.
            </div>
          ) : (
            <div className="space-y-3">
              {treeData.map((reg) => {
                const isRegExp = !!expandedRegions[reg.id];
                const depts = reg.departments || [];

                return (
                  <div
                    key={reg.id}
                    className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl overflow-hidden shadow-sm transition-all"
                  >
                    {/* Region Header Row */}
                    <div className="flex items-center justify-between p-4 bg-[var(--bg-surface-hover)]/30 border-b border-[var(--border-subtle)]">
                      <div
                        className="flex items-center gap-3 cursor-pointer flex-1"
                        onClick={() => toggleRegionExpand(reg.id)}
                      >
                        <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                          <MapPin className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold text-[var(--text-main)] text-sm">{reg.name}</h3>
                            {reg.code && (
                              <span className="font-mono text-[11px] px-2 py-0.2 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-bold">
                                {reg.code}
                              </span>
                            )}
                            {reg.is_active === false && (
                              <span className="text-[10px] px-2 py-0.2 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20">
                                Inactive
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-[var(--text-muted)]">
                            {depts.length} Departments &bull; {reg.sectionsCount || 0} Sections
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openCreateModal('DEPARTMENT', reg.id)}
                          className="px-2.5 py-1 bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 border border-purple-500/20 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors"
                          title="Add department to this region"
                        >
                          <Plus className="w-3 h-3" /> Dept
                        </button>
                        <button
                          onClick={() => openEditModal(reg)}
                          className="p-1.5 hover:bg-[var(--bg-surface-hover)] text-[var(--text-muted)] hover:text-orange-400 rounded-lg transition-colors"
                          title="Edit Region"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(reg)}
                          className="p-1.5 hover:bg-red-500/10 text-[var(--text-muted)] hover:text-red-400 rounded-lg transition-colors"
                          title="Delete Region"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => toggleRegionExpand(reg.id)}
                          className="p-1.5 hover:bg-[var(--bg-surface-hover)] text-[var(--text-muted)] rounded-lg transition-colors ml-1"
                        >
                          {isRegExp ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    {/* Departments under this Region */}
                    {isRegExp && (
                      <div className="p-4 space-y-3 bg-[var(--bg-surface)]">
                        {depts.length === 0 ? (
                          <div className="py-4 text-center text-xs text-[var(--text-faint)]">
                            No departments in {reg.name}. Click <strong>+ Dept</strong> to create one.
                          </div>
                        ) : (
                          depts.map((d) => {
                            const isDeptExp = !!expandedDepts[d.id];
                            const sections = d.sections || [];

                            return (
                              <div
                                key={d.id}
                                className="border border-[var(--border-subtle)] rounded-xl bg-[var(--bg-surface-hover)]/20 overflow-hidden"
                              >
                                {/* Department Header Row */}
                                <div className="flex items-center justify-between p-3 bg-[var(--bg-surface)] border-b border-[var(--border-subtle)]">
                                  <div
                                    className="flex items-center gap-2.5 cursor-pointer flex-1"
                                    onClick={() => toggleDeptExpand(d.id)}
                                  >
                                    <div className="w-7 h-7 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                                      <Building2 className="w-3.5 h-3.5" />
                                    </div>
                                    <div>
                                      <div className="flex items-center gap-2">
                                        <span className="font-semibold text-[var(--text-main)] text-xs">
                                          {d.name}
                                        </span>
                                        {d.code && (
                                          <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">
                                            {d.code}
                                          </span>
                                        )}
                                      </div>
                                      <span className="text-[11px] text-[var(--text-faint)]">
                                        {sections.length} Sections / Units
                                      </span>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-1.5">
                                    <button
                                      onClick={() => openCreateModal('UNIT', d.id)}
                                      className="px-2 py-0.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 rounded-md text-[11px] font-semibold flex items-center gap-1 transition-colors"
                                      title="Add Section to this department"
                                    >
                                      <Plus className="w-2.5 h-2.5" /> Section
                                    </button>
                                    <button
                                      onClick={() => openEditModal(d)}
                                      className="p-1 hover:bg-[var(--bg-surface-hover)] text-[var(--text-muted)] hover:text-orange-400 rounded transition-colors"
                                    >
                                      <Edit2 className="w-3 h-3" />
                                    </button>
                                    <button
                                      onClick={() => handleDelete(d)}
                                      className="p-1 hover:bg-red-500/10 text-[var(--text-muted)] hover:text-red-400 rounded transition-colors"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                    <button
                                      onClick={() => toggleDeptExpand(d.id)}
                                      className="p-1 hover:bg-[var(--bg-surface-hover)] text-[var(--text-muted)] rounded transition-colors"
                                    >
                                      {isDeptExp ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                                    </button>
                                  </div>
                                </div>

                                {/* Sections / Units under this Department */}
                                {isDeptExp && (
                                  <div className="p-3 bg-[var(--bg-surface-hover)]/10">
                                    {sections.length === 0 ? (
                                      <div className="py-2 text-center text-[11px] text-[var(--text-faint)]">
                                        No sections in {d.name}. Click <strong>+ Section</strong> to add one.
                                      </div>
                                    ) : (
                                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                        {sections.map((s) => (
                                          <div
                                            key={s.id}
                                            className="p-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-between shadow-xs hover:border-emerald-500/30 transition-all"
                                          >
                                            <div className="flex items-center gap-2 min-w-0">
                                              <Layers className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                                              <div className="min-w-0">
                                                <span className="font-medium text-[var(--text-main)] text-xs truncate block">
                                                  {s.name}
                                                </span>
                                                {s.code && (
                                                  <span className="font-mono text-[10px] text-emerald-400 block">
                                                    {s.code}
                                                  </span>
                                                )}
                                              </div>
                                            </div>
                                            <div className="flex items-center gap-1 flex-shrink-0">
                                              <button
                                                onClick={() => openEditModal(s)}
                                                className="p-1 hover:bg-[var(--bg-surface-hover)] text-[var(--text-muted)] hover:text-orange-400 rounded transition-colors"
                                              >
                                                <Edit2 className="w-3 h-3" />
                                              </button>
                                              <button
                                                onClick={() => handleDelete(s)}
                                                className="p-1 hover:bg-red-500/10 text-[var(--text-muted)] hover:text-red-400 rounded transition-colors"
                                              >
                                                <Trash2 className="w-3 h-3" />
                                              </button>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─────────────────── TAB 2: REGION MASTER TABLE ─────────────────── */}
      {activeTab === 'REGIONS' && (
        <div className="space-y-4">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-4 flex items-center justify-between shadow-sm">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search regions by code or name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl pl-9 pr-4 py-2 text-xs text-[var(--text-main)] w-full focus:outline-none focus:border-orange-500/50"
              />
            </div>
            <button
              onClick={() => openCreateModal('REGION')}
              className="px-3.5 py-2 bg-gradient-to-r from-orange-500 to-amber-500 text-white rounded-xl text-xs font-semibold shadow-md flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" /> Add Region
            </button>
          </div>

          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl overflow-hidden shadow-sm">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface-hover)]/40 text-[var(--text-muted)] uppercase tracking-wider font-semibold text-[11px]">
                  <th className="py-3 px-4">Code</th>
                  <th className="py-3 px-4">Region Name</th>
                  <th className="py-3 px-4">Description</th>
                  <th className="py-3 px-4 text-center">Departments</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {filteredRegions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-[var(--text-faint)]">
                      No regions found
                    </td>
                  </tr>
                ) : (
                  filteredRegions.map((r) => {
                    const deptsCount = allDepartments.filter((d) => d.parent_id === r.id).length;
                    return (
                      <tr key={r.id} className="hover:bg-[var(--bg-surface-hover)] transition-colors">
                        <td className="px-4 py-3 font-mono font-bold text-blue-400">{r.code || '—'}</td>
                        <td className="px-4 py-3 font-semibold text-[var(--text-main)] text-sm">{r.name}</td>
                        <td className="px-4 py-3 text-[var(--text-muted)]">{r.description || '—'}</td>
                        <td className="px-4 py-3 text-center">
                          <span className="px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-400 border border-purple-500/20 font-semibold">
                            {deptsCount} Depts
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => handleToggleActive(r)}
                            disabled={actionLoading === r.id}
                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              r.is_active !== false ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'
                            }`}
                          >
                            {r.is_active !== false ? 'Active' : 'Inactive'}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => openEditModal(r)}
                              className="p-1.5 hover:bg-[var(--bg-surface-hover)] text-[var(--text-muted)] hover:text-orange-400 rounded-lg transition-colors"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete(r)}
                              className="p-1.5 hover:bg-red-500/10 text-[var(--text-muted)] hover:text-red-400 rounded-lg transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─────────────────── TAB 3: DEPARTMENT MASTER TABLE ─────────────────── */}
      {activeTab === 'DEPARTMENTS' && (
        <div className="space-y-4">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-4 flex flex-wrap gap-3 items-center justify-between shadow-sm">
            <div className="flex items-center gap-3 flex-1 min-w-[280px]">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search departments..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl pl-9 pr-4 py-2 text-xs text-[var(--text-main)] w-full focus:outline-none focus:border-orange-500/50"
                />
              </div>

              <div className="w-48">
                <select
                  value={regionFilter}
                  onChange={(e) => setRegionFilter(e.target.value)}
                  className="bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-xs text-[var(--text-main)] w-full focus:outline-none focus:border-orange-500/50"
                >
                  <option value="">All Regions</option>
                  {allRegions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.code})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button
              onClick={() => openCreateModal('DEPARTMENT')}
              className="px-3.5 py-2 bg-gradient-to-r from-orange-500 to-amber-500 text-white rounded-xl text-xs font-semibold shadow-md flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" /> Add Department
            </button>
          </div>

          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl overflow-hidden shadow-sm">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface-hover)]/40 text-[var(--text-muted)] uppercase tracking-wider font-semibold text-[11px]">
                  <th className="py-3 px-4">Code</th>
                  <th className="py-3 px-4">Department Name</th>
                  <th className="py-3 px-4">Parent Region</th>
                  <th className="py-3 px-4 text-center">Sections</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {filteredDepartments.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-[var(--text-faint)]">
                      No departments found
                    </td>
                  </tr>
                ) : (
                  filteredDepartments.map((d) => {
                    const parentReg = allRegions.find((r) => r.id === d.parent_id);
                    const sectionsCount = allSections.filter((s) => s.parent_id === d.id).length;
                    return (
                      <tr key={d.id} className="hover:bg-[var(--bg-surface-hover)] transition-colors">
                        <td className="px-4 py-3 font-mono font-bold text-purple-400">{d.code || '—'}</td>
                        <td className="px-4 py-3 font-semibold text-[var(--text-main)] text-sm">{d.name}</td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium">
                            {parentReg?.name || d.parent_name || 'Unassigned'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold">
                            {sectionsCount} Sections
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => handleToggleActive(d)}
                            disabled={actionLoading === d.id}
                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              d.is_active !== false ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'
                            }`}
                          >
                            {d.is_active !== false ? 'Active' : 'Inactive'}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => openEditModal(d)}
                              className="p-1.5 hover:bg-[var(--bg-surface-hover)] text-[var(--text-muted)] hover:text-orange-400 rounded-lg transition-colors"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete(d)}
                              className="p-1.5 hover:bg-red-500/10 text-[var(--text-muted)] hover:text-red-400 rounded-lg transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─────────────────── TAB 4: SECTION / UNIT MASTER TABLE ─────────────────── */}
      {activeTab === 'SECTIONS' && (
        <div className="space-y-4">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-4 flex flex-wrap gap-3 items-center justify-between shadow-sm">
            <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[280px]">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search sections/units..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl pl-9 pr-4 py-2 text-xs text-[var(--text-main)] w-full focus:outline-none focus:border-orange-500/50"
                />
              </div>

              <div className="w-44">
                <select
                  value={regionFilter}
                  onChange={(e) => {
                    setRegionFilter(e.target.value);
                    setDeptFilter('');
                  }}
                  className="bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-xs text-[var(--text-main)] w-full focus:outline-none focus:border-orange-500/50"
                >
                  <option value="">All Regions</option>
                  {allRegions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="w-44">
                <select
                  value={deptFilter}
                  onChange={(e) => setDeptFilter(e.target.value)}
                  className="bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-xs text-[var(--text-main)] w-full focus:outline-none focus:border-orange-500/50"
                >
                  <option value="">All Departments</option>
                  {(regionFilter
                    ? allDepartments.filter((d) => d.parent_id === regionFilter)
                    : allDepartments
                  ).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button
              onClick={() => openCreateModal('UNIT')}
              className="px-3.5 py-2 bg-gradient-to-r from-orange-500 to-amber-500 text-white rounded-xl text-xs font-semibold shadow-md flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" /> Add Section
            </button>
          </div>

          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl overflow-hidden shadow-sm">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface-hover)]/40 text-[var(--text-muted)] uppercase tracking-wider font-semibold text-[11px]">
                  <th className="py-3 px-4">Code</th>
                  <th className="py-3 px-4">Section / Unit Name</th>
                  <th className="py-3 px-4">Parent Department</th>
                  <th className="py-3 px-4">Parent Region</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {filteredSections.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-[var(--text-faint)]">
                      No sections found
                    </td>
                  </tr>
                ) : (
                  filteredSections.map((s) => {
                    const parentDept = allDepartments.find((d) => d.id === s.parent_id);
                    const parentReg = parentDept ? allRegions.find((r) => r.id === parentDept.parent_id) : null;

                    return (
                      <tr key={s.id} className="hover:bg-[var(--bg-surface-hover)] transition-colors">
                        <td className="px-4 py-3 font-mono font-bold text-emerald-400">{s.code || '—'}</td>
                        <td className="px-4 py-3 font-semibold text-[var(--text-main)] text-sm">{s.name}</td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-400 border border-purple-500/20 font-medium">
                            {parentDept?.name || s.parent_name || 'Unassigned'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[var(--text-muted)]">
                          {parentReg ? (
                            <span className="px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium text-[11px]">
                              {parentReg.name}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => handleToggleActive(s)}
                            disabled={actionLoading === s.id}
                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              s.is_active !== false ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'
                            }`}
                          >
                            {s.is_active !== false ? 'Active' : 'Inactive'}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => openEditModal(s)}
                              className="p-1.5 hover:bg-[var(--bg-surface-hover)] text-[var(--text-muted)] hover:text-orange-400 rounded-lg transition-colors"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete(s)}
                              className="p-1.5 hover:bg-red-500/10 text-[var(--text-muted)] hover:text-red-400 rounded-lg transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─────────────────── CREATE / EDIT MODAL ─────────────────── */}
      {modal.isOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
              <div className="flex items-center gap-2">
                <div
                  className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                    modal.level === 'REGION'
                      ? 'bg-blue-500/10 text-blue-400'
                      : modal.level === 'DEPARTMENT'
                      ? 'bg-purple-500/10 text-purple-400'
                      : 'bg-emerald-500/10 text-emerald-400'
                  }`}
                >
                  {modal.level === 'REGION' ? (
                    <MapPin className="w-4 h-4" />
                  ) : modal.level === 'DEPARTMENT' ? (
                    <Building2 className="w-4 h-4" />
                  ) : (
                    <Layers className="w-4 h-4" />
                  )}
                </div>
                <h2 className="text-base font-semibold text-[var(--text-main)]">
                  {modal.mode === 'CREATE' ? 'Add' : 'Edit'}{' '}
                  {modal.level === 'REGION'
                    ? 'Region'
                    : modal.level === 'DEPARTMENT'
                    ? 'Department'
                    : 'Section / Unit'}
                </h2>
              </div>
              <button
                onClick={() => setModal(INITIAL_MODAL)}
                className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-xl leading-none"
              >
                &times;
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {formError && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Hierarchy Parent Selection */}
              {modal.level === 'DEPARTMENT' && (
                <div>
                  <label className={labelCls}>Parent Region *</label>
                  <select
                    value={modal.parentId}
                    onChange={(e) => setModal((m) => ({ ...m, parentId: e.target.value }))}
                    className={inputCls}
                  >
                    <option value="">-- Choose Parent Region --</option>
                    {activeRegions.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({r.code || 'No Code'})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {modal.level === 'UNIT' && (
                <div>
                  <label className={labelCls}>Parent Department *</label>
                  <select
                    value={modal.parentId}
                    onChange={(e) => setModal((m) => ({ ...m, parentId: e.target.value }))}
                    className={inputCls}
                  >
                    <option value="">-- Choose Parent Department --</option>
                    {activeDepartments.map((d) => {
                      const parentReg = allRegions.find((r) => r.id === d.parent_id);
                      return (
                        <option key={d.id} value={d.id}>
                          {d.name} ({parentReg ? `${parentReg.name} - ` : ''}
                          {d.code || 'Dept'})
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className={labelCls}>
                    {modal.level === 'REGION'
                      ? 'Region Name *'
                      : modal.level === 'DEPARTMENT'
                      ? 'Department Name *'
                      : 'Section / Unit Name *'}
                  </label>
                  <input
                    type="text"
                    value={modal.name}
                    onChange={(e) => setModal((m) => ({ ...m, name: e.target.value }))}
                    className={inputCls}
                    placeholder={`e.g. ${
                      modal.level === 'REGION'
                        ? 'Dubai'
                        : modal.level === 'DEPARTMENT'
                        ? 'Fleet Operations'
                        : 'VIP Fleet Unit'
                    }`}
                  />
                </div>

                <div>
                  <label className={labelCls}>Code</label>
                  <input
                    type="text"
                    value={modal.code}
                    onChange={(e) => setModal((m) => ({ ...m, code: e.target.value.toUpperCase() }))}
                    className={inputCls}
                    placeholder={`e.g. ${
                      modal.level === 'REGION' ? 'DXB' : modal.level === 'DEPARTMENT' ? 'FLT' : 'VIP'
                    }`}
                  />
                </div>
              </div>

              <div>
                <label className={labelCls}>Description (Optional)</label>
                <textarea
                  value={modal.description}
                  onChange={(e) => setModal((m) => ({ ...m, description: e.target.value }))}
                  className={`${inputCls} resize-none h-20`}
                  placeholder="Operational responsibilities, territory scope, or organizational notes..."
                />
              </div>

              <div>
                <label className="flex items-center gap-2 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={modal.isActive}
                    onChange={(e) => setModal((m) => ({ ...m, isActive: e.target.checked }))}
                    className="w-4 h-4 rounded text-orange-500 focus:ring-orange-500/30 border-[var(--border-subtle)] bg-[var(--bg-surface)]"
                  />
                  <span className="text-xs text-[var(--text-main)] font-medium">
                    Active & Available in Fleet Allocations, Vehicles & Transfers dropdowns
                  </span>
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--border-subtle)]">
              <button
                onClick={() => setModal(INITIAL_MODAL)}
                className="px-4 py-2 bg-[var(--bg-surface-hover)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-main)] rounded-xl text-xs font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition-all shadow-md shadow-orange-500/20"
              >
                {saving ? 'Saving...' : modal.mode === 'CREATE' ? 'Create' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
