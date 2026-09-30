import React, { useState, useMemo, useRef, useEffect } from 'react';
import { NavPath } from '../components/Layout';
import { SlideOver } from '../components/ui/SlideOver';
import { DataTable, Column } from '../components/shared/DataTable';
import { TelemetryCard, formatTimeFromPct } from '../components/shared/TelemetryCard';
import { CustomSelect } from '../components/shared/CustomSelect';
import { formatEngine } from '../types';
import { Database, Key, RefreshCw, Search, FileText } from 'lucide-react';

interface OverviewProps {
  onNavigate: (path: NavPath) => void;
}

interface DatabaseRow {
  alias: string;
  engine: string;
  conns: string;
  status: 'Ready' | 'Connecting' | 'Degraded';
  latency: string;
}

interface KeyRow {
  name: string;
  role: string;
  rateLimit: string;
  status: 'Active' | 'Revoked';
  created: string;
}

interface AuditRow {
  time: string;
  actor: string;
  action: string;
  target: string;
  status: '200 OK' | '403 Forbidden';
}

export interface FilterRule {
  id: string;
  field: string;
  operator: 'contains' | 'equals' | 'starts_with';
  value: string;
}

export function Overview({ onNavigate }: OverviewProps) {
  const [activeTab, setActiveTab] = useState<'databases' | 'keys' | 'audit'>('databases');
  const [searchFilter, setSearchFilter] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Edit DB SlideOver State
  const [editDbOpen, setEditDbOpen] = useState(false);
  const [dbMinConns, setDbMinConns] = useState(1);
  const [dbMaxConns, setDbMaxConns] = useState(10);
  const [dbTimeout, setDbTimeout] = useState(30);
  const [dbUpdatedNotice, setDbUpdatedNotice] = useState(false);

  // Edit Key SlideOver State
  const [editKeyOpen, setEditKeyOpen] = useState(false);
  const [keyRole, setKeyRole] = useState('admin');
  const [keyRate, setKeyRate] = useState(10000);
  const [keyUpdatedNotice, setKeyUpdatedNotice] = useState(false);

  // Filter & Display options state
  const [showFilters, setShowFilters] = useState(false);
  const filtersRef = useRef<HTMLDivElement | null>(null);

  const [showDisplayOptions, setShowDisplayOptions] = useState(false);
  const displayOptionsRef = useRef<HTMLDivElement | null>(null);

  const [matchMode, setMatchMode] = useState<'all' | 'any'>('all');

  const [dbFilterRules, setDbFilterRules] = useState<FilterRule[]>([]);
  const [appliedDbFilterRules, setAppliedDbFilterRules] = useState<FilterRule[]>([]);

  const [keyFilterRules, setKeyFilterRules] = useState<FilterRule[]>([]);
  const [appliedKeyFilterRules, setAppliedKeyFilterRules] = useState<FilterRule[]>([]);

  const [auditFilterRules, setAuditFilterRules] = useState<FilterRule[]>([]);
  const [appliedAuditFilterRules, setAppliedAuditFilterRules] = useState<FilterRule[]>([]);

  // Visible columns map per tab
  const [visibleDbCols, setVisibleDbCols] = useState<Record<string, boolean>>({
    status: true,
    alias: true,
    engine: true,
    conns: true,
    latency: true,
  });

  const [visibleKeyCols, setVisibleKeyCols] = useState<Record<string, boolean>>({
    status: true,
    name: true,
    role: true,
    rateLimit: true,
    created: true,
  });

  const [visibleAuditCols, setVisibleAuditCols] = useState<Record<string, boolean>>({
    time: true,
    actor: true,
    action: true,
    target: true,
    status: true,
  });

  useEffect(() => {
    if (!showFilters && !showDisplayOptions) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (showFilters && filtersRef.current && !filtersRef.current.contains(target)) {
        setShowFilters(false);
      }
      if (showDisplayOptions && displayOptionsRef.current && !displayOptionsRef.current.contains(target)) {
        setShowDisplayOptions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showFilters, showDisplayOptions]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 500);
  };

  // Sample Data Sets
  const rawDbData: DatabaseRow[] = [
    {
      alias: 'local_db',
      engine: 'PostgreSQL',
      conns: `${dbMinConns} – ${dbMaxConns} active`,
      status: 'Ready',
      latency: '0.42 ms',
    },
    {
      alias: 'analytics_clickhouse',
      engine: 'ClickHouse',
      conns: '2 – 20 active',
      status: 'Ready',
      latency: '1.15 ms',
    },
    {
      alias: 'turso_edge_cache',
      engine: 'LibSQL',
      conns: '1 – 5 active',
      status: 'Ready',
      latency: '0.18 ms',
    },
  ];

  const rawKeyData: KeyRow[] = [
    {
      name: 'default_admin',
      role: keyRole,
      rateLimit: `${keyRate.toLocaleString()} req/m`,
      status: 'Active',
      created: '2026-09-28',
    },
    {
      name: 'backend_worker',
      role: 'readwrite',
      rateLimit: '5,000 req/m',
      status: 'Active',
      created: '2026-09-29',
    },
    {
      name: 'grafana_telemetry',
      role: 'readonly',
      rateLimit: '2,000 req/m',
      status: 'Active',
      created: '2026-09-30',
    },
  ];

  const rawAuditData: AuditRow[] = [
    { time: '12:45:00', actor: 'admin', action: 'auth.login', target: '/admin/v1/auth', status: '200 OK' },
    { time: '12:30:15', actor: 'system', action: 'pool.connect', target: 'local_db', status: '200 OK' },
    { time: '12:15:22', actor: 'attacker_ip', action: 'waf.blocked', target: '/api/v1/query?drop=1', status: '403 Forbidden' },
    { time: '12:00:00', actor: 'system', action: 'gateway.boot', target: '0.0.0.0:4500', status: '200 OK' },
  ];

  function matchesRule(itemVal: string, operator: string, ruleVal: string): boolean {
    const i = (itemVal || '').toLowerCase();
    const r = (ruleVal || '').toLowerCase();
    if (operator === 'equals') return i === r;
    if (operator === 'starts_with') return i.startsWith(r);
    return i.includes(r);
  }

  const currentFilterFieldOptions = useMemo(() => {
    if (activeTab === 'databases') {
      return [
        { value: 'alias', label: 'Database Alias' },
        { value: 'engine', label: 'Engine' },
        { value: 'status', label: 'Status' },
      ];
    }
    if (activeTab === 'keys') {
      return [
        { value: 'name', label: 'Key Identifier' },
        { value: 'role', label: 'Role' },
        { value: 'status', label: 'Status' },
      ];
    }
    return [
      { value: 'actor', label: 'Actor' },
      { value: 'action', label: 'Event Action' },
      { value: 'target', label: 'Target URI / Pool' },
      { value: 'status', label: 'Status Result' },
    ];
  }, [activeTab]);

  const currentDisplayColumns = useMemo(() => {
    if (activeTab === 'databases') {
      return [
        { id: 'status', label: 'Status' },
        { id: 'alias', label: 'Database Alias' },
        { id: 'engine', label: 'Engine' },
        { id: 'conns', label: 'Pool Connections' },
        { id: 'latency', label: 'Ping Latency' },
      ];
    }
    if (activeTab === 'keys') {
      return [
        { id: 'status', label: 'Status' },
        { id: 'name', label: 'Key Identifier' },
        { id: 'role', label: 'Role' },
        { id: 'rateLimit', label: 'Rate Limit' },
        { id: 'created', label: 'Created Date' },
      ];
    }
    return [
      { id: 'time', label: 'Timestamp' },
      { id: 'actor', label: 'Actor' },
      { id: 'action', label: 'Event Action' },
      { id: 'target', label: 'Target URI / Pool' },
      { id: 'status', label: 'Status Result' },
    ];
  }, [activeTab]);

  const currentFilterRules = activeTab === 'databases' ? dbFilterRules : activeTab === 'keys' ? keyFilterRules : auditFilterRules;
  const currentAppliedFilterRules = activeTab === 'databases' ? appliedDbFilterRules : activeTab === 'keys' ? appliedKeyFilterRules : appliedAuditFilterRules;

  const setCurrentFilterRules = (fn: (prev: FilterRule[]) => FilterRule[]) => {
    if (activeTab === 'databases') setDbFilterRules(fn);
    else if (activeTab === 'keys') setKeyFilterRules(fn);
    else setAuditFilterRules(fn);
  };

  const setAppliedRules = (rules: FilterRule[]) => {
    if (activeTab === 'databases') setAppliedDbFilterRules(rules);
    else if (activeTab === 'keys') setAppliedKeyFilterRules(rules);
    else setAppliedAuditFilterRules(rules);
  };

  const handleAddRule = () => {
    const newId = String(Date.now());
    setCurrentFilterRules((prev) => [
      ...prev,
      { id: newId, field: currentFilterFieldOptions[0].value, operator: 'contains', value: '' },
    ]);
  };

  const handleRemoveRule = (id: string) => {
    setCurrentFilterRules((prev) => prev.filter((r) => r.id !== id));
  };

  const handleUpdateRule = (id: string, updates: Partial<FilterRule>) => {
    setCurrentFilterRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...updates } : r))
    );
  };

  const handleApplyFilters = () => {
    setAppliedRules(currentFilterRules.filter((r) => r.value.trim() !== ''));
    setShowFilters(false);
  };

  const handleClearFilters = () => {
    setCurrentFilterRules(() => []);
    setAppliedRules([]);
    setShowFilters(false);
  };

  const currentVisibleMap = activeTab === 'databases' ? visibleDbCols : activeTab === 'keys' ? visibleKeyCols : visibleAuditCols;
  const toggleColVisibility = (colId: string) => {
    if (activeTab === 'databases') {
      setVisibleDbCols((prev) => ({ ...prev, [colId]: !prev[colId] }));
    } else if (activeTab === 'keys') {
      setVisibleKeyCols((prev) => ({ ...prev, [colId]: !prev[colId] }));
    } else {
      setVisibleAuditCols((prev) => ({ ...prev, [colId]: !prev[colId] }));
    }
  };

  const handleResetColumns = () => {
    if (activeTab === 'databases') {
      setVisibleDbCols({ status: true, alias: true, engine: true, conns: true, latency: true });
    } else if (activeTab === 'keys') {
      setVisibleKeyCols({ status: true, name: true, role: true, rateLimit: true, created: true });
    } else {
      setVisibleAuditCols({ time: true, actor: true, action: true, target: true, status: true });
    }
  };

  const filteredDbData = useMemo(() => {
    let list = rawDbData;
    if (searchFilter.trim()) {
      const q = searchFilter.toLowerCase();
      list = list.filter((d) => d.alias.toLowerCase().includes(q) || d.engine.toLowerCase().includes(q));
    }
    if (appliedDbFilterRules.length > 0) {
      list = list.filter((d) => {
        const tests = appliedDbFilterRules.map((rule) => {
          const val = ((d as unknown) as Record<string, string>)[rule.field] || '';
          return matchesRule(val, rule.operator, rule.value);
        });
        return matchMode === 'any' ? tests.some(Boolean) : tests.every(Boolean);
      });
    }
    return list;
  }, [rawDbData, searchFilter, appliedDbFilterRules, matchMode]);

  const filteredKeyData = useMemo(() => {
    let list = rawKeyData;
    if (searchFilter.trim()) {
      const q = searchFilter.toLowerCase();
      list = list.filter((k) => k.name.toLowerCase().includes(q) || k.role.toLowerCase().includes(q));
    }
    if (appliedKeyFilterRules.length > 0) {
      list = list.filter((k) => {
        const tests = appliedKeyFilterRules.map((rule) => {
          const val = ((k as unknown) as Record<string, string>)[rule.field] || '';
          return matchesRule(val, rule.operator, rule.value);
        });
        return matchMode === 'any' ? tests.some(Boolean) : tests.every(Boolean);
      });
    }
    return list;
  }, [rawKeyData, searchFilter, appliedKeyFilterRules, matchMode]);

  const filteredAuditData = useMemo(() => {
    let list = rawAuditData;
    if (searchFilter.trim()) {
      const q = searchFilter.toLowerCase();
      list = list.filter((a) => a.actor.toLowerCase().includes(q) || a.action.toLowerCase().includes(q) || a.target.toLowerCase().includes(q));
    }
    if (appliedAuditFilterRules.length > 0) {
      list = list.filter((a) => {
        const tests = appliedAuditFilterRules.map((rule) => {
          const val = ((a as unknown) as Record<string, string>)[rule.field] || '';
          return matchesRule(val, rule.operator, rule.value);
        });
        return matchMode === 'any' ? tests.some(Boolean) : tests.every(Boolean);
      });
    }
    return list;
  }, [rawAuditData, searchFilter, appliedAuditFilterRules, matchMode]);

  // Table Column Definitions
  const dbColumns: Column<DatabaseRow>[] = [
    {
      id: 'status',
      header: 'Status',
      accessorKey: 'status',
      width: 130,
      isResizable: true,
      className: 'pl-4 pr-3',
      cell: (row) => (
        <div className="flex items-center gap-2 text-[14px] text-white font-normal">
          <span
            className={`size-1.5 rounded-full shrink-0 ${
              row.status === 'Ready' ? 'bg-[#30a46c]' : 'bg-[#f59e0b]'
            }`}
          />
          <span>{row.status}</span>
        </div>
      ),
    },
    {
      id: 'alias',
      header: 'Database Alias',
      accessorKey: 'alias',
      isSortable: true,
      isResizable: true,
      width: 240,
      className: 'px-3',
      cell: (row) => (
        <div className="flex items-center gap-2.5">
          <Database className="w-4 h-4 text-[#8c8c8c] shrink-0" />
          <span className="font-medium text-white text-[14px]">{row.alias}</span>
        </div>
      ),
    },
    {
      id: 'engine',
      header: 'Engine',
      accessorKey: 'engine',
      width: 170,
      isResizable: true,
      className: 'px-3',
      cell: (row) => (
        <span className="text-[14px] text-[#cccccc] font-normal">
          {formatEngine(row.engine)}
        </span>
      ),
    },
    {
      id: 'conns',
      header: 'Pool Connections',
      accessorKey: 'conns',
      width: 170,
      isResizable: true,
      className: 'px-3',
      cell: (row) => (
        <span className="tabular-nums text-[14px] text-[#d4d4d4] font-normal">
          {row.conns}
        </span>
      ),
    },
    {
      id: 'latency',
      header: 'Ping Latency',
      accessorKey: 'latency',
      width: 140,
      isResizable: true,
      className: 'px-3',
      cell: (row) => (
        <span className="tabular-nums text-[14px] text-[#8c8c8c] font-normal">
          {row.latency}
        </span>
      ),
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      isFlex: true,
      headerClassName: 'justify-end pr-4 text-right',
      className: 'pl-3 pr-4 justify-end',
      cell: () => (
        <div className="flex items-center justify-end gap-2 w-full">
          <button
            type="button"
            onClick={() => setEditDbOpen(true)}
            className="inline-flex items-center justify-center h-7 px-3 rounded-[6px] text-[13px] font-medium leading-none text-white hover:text-white bg-transparent hover:bg-[#1a1a1a] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer shrink-0"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => onNavigate('/ui/databases')}
            className="inline-flex items-center justify-center h-7 px-2.5 rounded-[6px] text-[13px] font-medium leading-none text-[#8c8c8c] hover:text-white bg-transparent hover:bg-[#161616] border border-transparent hover:border-[#262626] transition-colors cursor-pointer shrink-0"
          >
            Manage &rarr;
          </button>
        </div>
      ),
    },
  ];
  const keyColumns: Column<KeyRow>[] = [
    {
      id: 'status',
      header: 'Status',
      accessorKey: 'status',
      width: 130,
      isResizable: true,
      className: 'pl-4 pr-3',
      cell: (row) => (
        <div className="flex items-center gap-2 text-[14px] text-white font-normal">
          <span
            className={`size-1.5 rounded-full shrink-0 ${
              row.status === 'Active' ? 'bg-[#30a46c]' : 'bg-[#e5484d]'
            }`}
          />
          <span>{row.status}</span>
        </div>
      ),
    },
    {
      id: 'name',
      header: 'Key Identifier',
      accessorKey: 'name',
      isSortable: true,
      isResizable: true,
      width: 240,
      className: 'px-3',
      cell: (row) => (
        <div className="flex items-center gap-2.5">
          <Key className="w-4 h-4 text-[#8c8c8c] shrink-0" />
          <span className="font-medium text-white text-[14px]">{row.name}</span>
        </div>
      ),
    },
    {
      id: 'role',
      header: 'Role',
      accessorKey: 'role',
      width: 170,
      isResizable: true,
      className: 'px-3',
      cell: (row) => (
        <span className="text-[14px] text-[#cccccc] font-normal">
          {row.role}
        </span>
      ),
    },
    {
      id: 'rateLimit',
      header: 'Rate Limit',
      accessorKey: 'rateLimit',
      width: 170,
      isResizable: true,
      className: 'px-3',
      cell: (row) => (
        <span className="tabular-nums text-[14px] text-[#8c8c8c] font-normal">
          {row.rateLimit}
        </span>
      ),
    },
    {
      id: 'created',
      header: 'Created Date',
      accessorKey: 'created',
      width: 150,
      isResizable: true,
      className: 'px-3',
      cell: (row) => (
        <span className="tabular-nums text-[14px] text-[#8c8c8c] font-normal">
          {row.created}
        </span>
      ),
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      isFlex: true,
      headerClassName: 'justify-end pr-4 text-right',
      className: 'pl-3 pr-4 justify-end',
      cell: () => (
        <div className="flex items-center justify-end gap-2 w-full">
          <button
            type="button"
            onClick={() => setEditKeyOpen(true)}
            className="inline-flex items-center justify-center h-7 px-3 rounded-[6px] text-[13px] font-medium leading-none text-white hover:text-white bg-transparent hover:bg-[#1a1a1a] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer shrink-0"
          >
            Modify
          </button>
          <button
            type="button"
            onClick={() => onNavigate('/ui/keys')}
            className="inline-flex items-center justify-center h-7 px-2.5 rounded-[6px] text-[13px] font-medium leading-none text-[#8c8c8c] hover:text-white bg-transparent hover:bg-[#161616] border border-transparent hover:border-[#262626] transition-colors cursor-pointer shrink-0"
          >
            Details &rarr;
          </button>
        </div>
      ),
    },
  ];

  const auditColumns: Column<AuditRow>[] = [
    {
      id: 'time',
      header: 'Timestamp',
      accessorKey: 'time',
      width: 180,
      isResizable: true,
      className: 'pl-4 pr-3',
      cell: (row) => (
        <span className="tabular-nums text-[14px] text-[#8c8c8c] font-normal">
          {row.time}
        </span>
      ),
    },
    {
      id: 'actor',
      header: 'Actor',
      accessorKey: 'actor',
      width: 170,
      isResizable: true,
      className: 'px-3',
      cell: (row) => (
        <span className="font-medium text-white text-[14px]">{row.actor}</span>
      ),
    },
    {
      id: 'action',
      header: 'Event Action',
      accessorKey: 'action',
      width: 180,
      isResizable: true,
      className: 'px-3',
      cell: (row) => (
        <span className="text-[14px] text-[#cccccc] font-normal">
          {row.action}
        </span>
      ),
    },
    {
      id: 'target',
      header: 'Target URI / Pool',
      accessorKey: 'target',
      isFlex: true,
      className: 'px-3',
      cell: (row) => (
        <span className="text-[14px] text-[#8c8c8c] font-normal truncate block" title={row.target}>
          {row.target}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status Result',
      width: 140,
      isResizable: true,
      resizerPosition: 'before',
      headerClassName: 'justify-end pr-4 text-right',
      className: 'pl-3 pr-4 justify-end',
      cell: (row) => (
        <div className="flex items-center justify-end gap-2 text-[14px] text-white font-normal w-full">
          <span
            className={`size-1.5 rounded-full shrink-0 ${
              row.status.startsWith('200') ? 'bg-[#30a46c]' : 'bg-[#e5484d]'
            }`}
          />
          <span className={row.status.startsWith('200') ? 'text-[#d4d4d4]' : 'text-[#e5484d]'}>
            {row.status}
          </span>
        </div>
      ),
    },
  ];

  const activeDbColumns = useMemo(() => {
    return dbColumns.filter((col) => col.id === 'actions' || visibleDbCols[col.id] !== false);
  }, [dbColumns, visibleDbCols]);

  const activeKeyColumns = useMemo(() => {
    return keyColumns.filter((col) => col.id === 'actions' || visibleKeyCols[col.id] !== false);
  }, [keyColumns, visibleKeyCols]);

  const activeAuditColumns = useMemo(() => {
    return auditColumns.filter((col) => visibleAuditCols[col.id] !== false);
  }, [auditColumns, visibleAuditCols]);

  function handleSaveDb() {
    setDbUpdatedNotice(true);
    setTimeout(() => {
      setDbUpdatedNotice(false);
      setEditDbOpen(false);
    }, 600);
  }

  function handleSaveKey() {
    setKeyUpdatedNotice(true);
    setTimeout(() => {
      setKeyUpdatedNotice(false);
      setEditKeyOpen(false);
    }, 600);
  }

  return (
    <div className="space-y-6 w-full max-w-[1600px] mx-auto pb-12 select-none font-sans">
      {/* Top Header Row with Actions (Cloudflare / binary_alive style) */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-[16px] font-semibold text-white tracking-tight">
            Overview
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {/* Refresh metrics button */}
          <button
            type="button"
            onClick={handleRefresh}
            title="Refresh metrics"
            className="flex items-center justify-center h-8 w-8 text-[#8c8c8c] hover:text-white rounded-[8px] bg-[#0c0c0c] hover:bg-[#141414] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin opacity-50' : ''}`} />
          </button>
        </div>
      </div>

      {/* 4 Telemetry Analytics Cards Grid (Clean technical minimal style) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 w-full font-sans">
        <TelemetryCard
          title="Throughput (req/s)"
          value="1,420"
          subLabel="peak 2.1k"
          badge={{ text: '+12.4%', icon: 'up', color: '#2f80ed' }}
          gradientId="ov-throughput"
          strokeColor="#2f80ed"
          pathD="M 0,105 C 150,95 280,45 450,55 C 600,65 750,20 1000,35"
          yAxisLabels={['2k', '1.5k', '500', '0']}
          tooltipMetricName="Throughput"
          onHoverCompute={(pct, _svgX, exactYPct) => {
            const norm = exactYPct !== undefined ? Math.max(0, Math.min(1, (116 - exactYPct * 130) / 102)) : pct;
            const val = Math.round(950 + norm * 1150);
            return {
              pct,
              yPct: exactYPct ?? 0.35,
              time: formatTimeFromPct(pct),
              value: `${val.toLocaleString()} req/s`,
            };
          }}
        />

        <TelemetryCard
          title="L1 Cache Hit Ratio"
          value="99.4%"
          subLabel="<1µs lookup"
          badge={{ text: '<1µs L1', icon: 'none', color: '#8c8c8c' }}
          gradientId="ov-cache"
          strokeColor="#2f80ed"
          pathD="M 0,40 C 200,35 400,28 600,32 C 800,25 900,28 1000,26"
          yAxisLabels={['100%', '95%', '90%', '80%']}
          tooltipMetricName="Cache Hit Ratio"
          onHoverCompute={(pct, _svgX, exactYPct) => {
            const norm = exactYPct !== undefined ? Math.max(0, Math.min(1, (116 - exactYPct * 130) / 102)) : 0.8;
            const val = (98.9 + norm * 0.8).toFixed(1);
            return {
              pct,
              yPct: exactYPct ?? 0.25,
              time: formatTimeFromPct(pct),
              value: `${val}%`,
            };
          }}
        />

        <TelemetryCard
          title="Pipeline p95 Latency"
          value="0.74 ms"
          subLabel="AST + Pool"
          badge={{ text: '-8.1%', icon: 'down', color: '#2f80ed' }}
          gradientId="ov-latency"
          strokeColor="#2f80ed"
          pathD="M 0,85 C 200,80 400,95 600,60 C 800,70 900,45 1000,50"
          yAxisLabels={['2.0ms', '1.0ms', '0.5ms', '0ms']}
          tooltipMetricName="p95 Latency"
          onHoverCompute={(pct, _svgX, exactYPct) => {
            const norm = exactYPct !== undefined ? Math.max(0, Math.min(1, (116 - exactYPct * 130) / 102)) : 0.5;
            const val = (0.45 + norm * 1.55).toFixed(2);
            return {
              pct,
              yPct: exactYPct ?? 0.45,
              time: formatTimeFromPct(pct),
              value: `${val} ms`,
            };
          }}
        />

        <TelemetryCard
          title="Active Pool Connections"
          value="3 / 35"
          subLabel="3 live pools"
          badge={{ text: '3 active', icon: 'none', color: '#8c8c8c' }}
          gradientId="ov-pools"
          strokeColor="#2f80ed"
          pathD="M 0,90 C 250,92 500,80 750,75 C 900,78 950,72 1000,70"
          yAxisLabels={['35', '20', '10', '0']}
          tooltipMetricName="Active Connections"
          onHoverCompute={(pct, _svgX, exactYPct) => {
            const norm = exactYPct !== undefined ? Math.max(0, Math.min(1, (116 - exactYPct * 130) / 102)) : 0.4;
            const val = Math.max(1, Math.round(1 + norm * 6));
            return {
              pct,
              yPct: exactYPct ?? 0.65,
              time: formatTimeFromPct(pct),
              value: `${val} / 35 active`,
            };
          }}
        />
      </div>

      {/* Table Controls Toolbar & Segmented Tabs (Matches binary_alive style exactly) */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1 select-none font-sans">
        {/* Search filter input */}
        <label
          title="Search current view (/ or Ctrl+K)"
          className="relative flex items-center h-9 rounded-[8px] bg-transparent border border-[#262626] focus-within:border-[#2f80ed] transition-colors px-3 gap-2 w-full sm:w-[260px] md:w-[300px]"
        >
          <Search className="w-3.5 h-3.5 text-[#8c8c8c] shrink-0" />
          <input
            type="text"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            placeholder="Search records..."
            className="w-full bg-transparent border-0 text-[14px] text-white placeholder-[#8c8c8c] outline-none font-normal font-sans"
          />
          {searchFilter && (
            <button
              type="button"
              onClick={() => setSearchFilter('')}
              className="flex items-center justify-center w-5 h-5 rounded hover:bg-[#222222] text-[#8c8c8c] hover:text-white transition-colors cursor-pointer shrink-0 font-sans"
              title="Clear search"
            >
              ✕
            </button>
          )}
        </label>

        {/* Right cluster: Filters, Display options, and Segmented Tab Switcher */}
        <div className="flex flex-wrap items-center gap-2 font-sans">
          {/* Filters dropdown button & popover */}
          <div className="relative" ref={filtersRef}>
            <button
              type="button"
              onClick={() => {
                setShowFilters((prev) => {
                  const next = !prev;
                  if (next) {
                    setShowDisplayOptions(false);
                    if (currentAppliedFilterRules.length > 0) {
                      setCurrentFilterRules(() => currentAppliedFilterRules.map((r) => ({ ...r })));
                    } else if (currentFilterRules.length === 0) {
                      setCurrentFilterRules(() => [
                        { id: '1', field: currentFilterFieldOptions[0].value, operator: 'contains', value: '' },
                      ]);
                    }
                  }
                  return next;
                });
              }}
              className={`flex items-center gap-1.5 h-9 px-3 rounded-[8px] bg-transparent border text-[14px] font-medium transition-colors cursor-pointer shrink-0 font-sans ${
                showFilters || currentAppliedFilterRules.length > 0
                  ? 'border-[#444444] text-white bg-[#141414]'
                  : 'border-[#262626] text-white hover:bg-[#141414] hover:border-[#383838]'
              }`}
              title="Filter records"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                fill="currentColor"
                viewBox="0 0 256 256"
                className="text-[#8c8c8c] shrink-0"
              >
                <path d="M230.6,49.53A15.81,15.81,0,0,0,216,40H40A16,16,0,0,0,28.19,66.76l.08.09L96,139.17V216a16,16,0,0,0,24.87,13.32l32-21.34A16,16,0,0,0,160,194.66V139.17l67.74-72.32.08-.09A15.8,15.8,0,0,0,230.6,49.53ZM40,56h0Zm106.18,74.58A8,8,0,0,0,144,136v58.66L112,216V136a8,8,0,0,0-2.16-5.47L40,56H216Z" />
              </svg>
              <span>Filters</span>
              {currentAppliedFilterRules.length > 0 && (
                <span className="text-[12px] text-[#8c8c8c] font-normal font-mono">
                  ({currentAppliedFilterRules.length})
                </span>
              )}
            </button>

            {showFilters && (
              <div className="absolute right-0 top-10 w-[540px] max-w-[calc(100vw-32px)] rounded-[8px] bg-[#0c0c0c] border border-[#262626] shadow-2xl p-4 z-50 select-none animate-in fade-in font-sans">
                {/* Header */}
                <div className="flex items-center justify-between pb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-semibold text-white font-sans">
                      {activeTab === 'databases' ? 'Database Filters' : activeTab === 'keys' ? 'API Key Filters' : 'Audit Filters'}
                    </span>
                    {currentFilterRules.length >= 2 && (
                      <button
                        type="button"
                        onClick={() => setMatchMode((prev) => (prev === 'any' ? 'all' : 'any'))}
                        className="px-2.5 py-0.5 rounded text-[13px] text-[#cccccc] hover:text-white bg-[#141414] border border-[#2e2e2e] hover:border-[#444444] transition-colors cursor-pointer font-sans"
                      >
                        Match {matchMode === 'any' ? 'any (OR)' : 'all (AND)'}
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowFilters(false)}
                    className="text-[#888888] hover:text-white transition-colors cursor-pointer text-[14px] p-1 leading-none"
                    title="Close filters"
                  >
                    ✕
                  </button>
                </div>

                {/* Rules List */}
                <div className={`space-y-2.5 ${currentFilterRules.length > 3 ? 'max-h-[320px] overflow-y-auto pr-0.5' : ''}`}>
                  {currentFilterRules.map((rule) => (
                    <div key={rule.id} className="flex items-center gap-2">
                      <CustomSelect
                        value={rule.field}
                        options={currentFilterFieldOptions}
                        onChange={(val) => handleUpdateRule(rule.id, { field: val })}
                        className="w-32 sm:w-36 shrink-0"
                        menuWidth="w-40"
                      />

                      <CustomSelect
                        value={rule.operator}
                        options={[
                          { value: 'contains', label: 'contains' },
                          { value: 'equals', label: 'equals' },
                          { value: 'starts_with', label: 'starts with' },
                        ]}
                        onChange={(val) => handleUpdateRule(rule.id, { operator: val as 'contains' | 'equals' | 'starts_with' })}
                        className="w-32 sm:w-36 shrink-0"
                        menuWidth="w-44"
                      />

                      <input
                        type="text"
                        value={rule.value}
                        onChange={(e) => handleUpdateRule(rule.id, { value: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleApplyFilters();
                        }}
                        placeholder="Filter value..."
                        className="flex-1 min-w-0 h-9 px-3 rounded-[8px] bg-[#141414] border border-[#262626] hover:border-[#383838] focus:border-[#2f80ed] text-[14px] text-white placeholder-[#555555] outline-none transition-colors font-sans"
                      />

                      <button
                        type="button"
                        onClick={() => handleRemoveRule(rule.id)}
                        className="w-8 h-8 flex items-center justify-center text-[#777777] hover:text-white cursor-pointer transition-colors shrink-0"
                        title="Delete filter rule"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="currentColor" viewBox="0 0 256 256">
                          <path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>

                {/* Footer Controls */}
                <div className="flex items-center justify-between pt-2.5 mt-1 font-sans">
                  <button
                    type="button"
                    onClick={handleAddRule}
                    className="text-[14px] text-white hover:text-[#2f80ed] font-medium flex items-center gap-1.5 transition-colors cursor-pointer font-sans"
                  >
                    <span>+ Add filter</span>
                  </button>
                  <div className="flex items-center gap-3">
                    <span className="text-[12px] text-[#666666] font-sans">Press Enter to apply</span>
                    {currentAppliedFilterRules.length > 0 && (
                      <button
                        type="button"
                        onClick={handleClearFilters}
                        className="text-[14px] text-[#888888] hover:text-white transition-colors cursor-pointer font-sans"
                      >
                        Clear
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleApplyFilters}
                      className="group relative flex shrink-0 items-center justify-center h-8 px-3.5 rounded-[8px] font-medium text-white shadow-xs outline-none cursor-pointer disabled:opacity-50 overflow-hidden ring-1 ring-[#1d4ed8] bg-[#2563eb] font-sans"
                    >
                      <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-[#3b82f6] to-[#2563eb] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]" />
                      <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black opacity-0 group-hover:opacity-15 transition-opacity duration-200" />
                      <span className="relative flex items-center gap-1.5 text-[14px] font-sans">
                        Apply filters
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Display options dropdown */}
          <div className="relative" ref={displayOptionsRef}>
            <button
              type="button"
              onClick={() => {
                setShowDisplayOptions((prev) => !prev);
                setShowFilters(false);
              }}
              className={`flex items-center gap-1.5 h-9 px-3 rounded-[8px] bg-transparent border text-[14px] font-medium transition-colors cursor-pointer shrink-0 font-sans ${
                showDisplayOptions
                  ? 'border-[#444444] text-white bg-[#141414]'
                  : 'border-[#262626] text-white hover:bg-[#141414] hover:border-[#383838]'
              }`}
              title="Toggle visible table columns"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 256 256" className="text-[#8c8c8c] shrink-0">
                <path d="M222.87,74.56,134.87,23.75a16,16,0,0,0-15.74,0L31.13,74.56A16,16,0,0,0,23.26,88.4v101.6a16,16,0,0,0,7.87,13.84l88,50.81a16,16,0,0,0,15.74,0l88-50.81a16,16,0,0,0,7.87-13.84V88.4A16,16,0,0,0,222.87,74.56ZM127,160a32,32,0,1,1,32-32A32,32,0,0,1,127,160Z" />
              </svg>
              <span>Display options</span>
            </button>

            {showDisplayOptions && (
              <div className="absolute right-0 top-10 w-52 rounded-md bg-[#0c0c0c] border border-[#262626] shadow-xl p-1 z-40 select-none font-sans">
                {currentDisplayColumns.map((col) => {
                  const isVisible = currentVisibleMap[col.id] !== false;
                  return (
                    <button
                      key={col.id}
                      type="button"
                      onClick={() => toggleColVisibility(col.id)}
                      className="w-full flex items-center justify-between px-2.5 py-1.5 rounded text-[14px] text-[#cccccc] hover:text-white hover:bg-[#1a1a1a] transition-colors cursor-pointer font-sans"
                    >
                      <span className={isVisible ? 'text-white' : 'text-[#777777]'}>
                        {col.label}
                      </span>
                      {isVisible && (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="14"
                          height="14"
                          viewBox="0 0 256 256"
                          fill="currentColor"
                          className="text-[#2f80ed] shrink-0"
                        >
                          <path d="M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z" />
                        </svg>
                      )}
                    </button>
                  );
                })}
                <div className="-mx-1 my-1 border-t border-[#222222]" />
                <button
                  type="button"
                  onClick={handleResetColumns}
                  className="w-full text-left px-2.5 py-1.5 rounded text-[14px] text-[#888888] hover:text-white hover:bg-[#1a1a1a] transition-colors cursor-pointer font-sans"
                >
                  Reset columns
                </button>
              </div>
            )}
          </div>

          {/* Tab Switcher (Segmented Control matching binary_alive with zero layout shift) */}
          <div className="inline-flex items-center p-0.5 rounded-[8px] bg-transparent border border-[#262626]">
            <button
              type="button"
              onClick={() => {
                setActiveTab('databases');
                setShowFilters(false);
                setShowDisplayOptions(false);
              }}
              className={`flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[14px] font-medium transition-colors duration-75 cursor-pointer font-sans outline-none focus:outline-none border ${
                activeTab === 'databases'
                  ? 'bg-[#161616] text-white border-[#333333]'
                  : 'text-[#8c8c8c] hover:text-white hover:bg-[#141414] border-transparent'
              }`}
            >
              <Database className="w-4 h-4 shrink-0" />
              <span>Databases</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab('keys');
                setShowFilters(false);
                setShowDisplayOptions(false);
              }}
              className={`flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[14px] font-medium transition-colors duration-75 cursor-pointer font-sans outline-none focus:outline-none border ${
                activeTab === 'keys'
                  ? 'bg-[#161616] text-white border-[#333333]'
                  : 'text-[#8c8c8c] hover:text-white hover:bg-[#141414] border-transparent'
              }`}
            >
              <Key className="w-4 h-4 shrink-0" />
              <span>API Keys</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab('audit');
                setShowFilters(false);
                setShowDisplayOptions(false);
              }}
              className={`flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[14px] font-medium transition-colors duration-75 cursor-pointer font-sans outline-none focus:outline-none border ${
                activeTab === 'audit'
                  ? 'bg-[#161616] text-white border-[#333333]'
                  : 'text-[#8c8c8c] hover:text-white hover:bg-[#141414] border-transparent'
              }`}
            >
              <FileText className="w-4 h-4 shrink-0" />
              <span>Audit Trail</span>
            </button>
          </div>
        </div>
      </div>

      {/* DataTable direct render (No duplicate outer border wrapper) */}
      {activeTab === 'databases' && (
        <DataTable
          columns={activeDbColumns}
          data={filteredDbData}
          ariaLabel="Active Database Pools"
          pagination={{
            page: 1,
            pageSize: 10,
            totalCount: filteredDbData.length,
            onPageChange: () => {},
            onPageSizeChange: () => {},
          }}
        />
      )}

      {activeTab === 'keys' && (
        <DataTable
          columns={activeKeyColumns}
          data={filteredKeyData}
          ariaLabel="Configured API Keys"
          pagination={{
            page: 1,
            pageSize: 10,
            totalCount: filteredKeyData.length,
            onPageChange: () => {},
            onPageSizeChange: () => {},
          }}
        />
      )}

      {activeTab === 'audit' && (
        <DataTable
          columns={activeAuditColumns}
          data={filteredAuditData}
          ariaLabel="System Audit Trail"
          pagination={{
            page: 1,
            pageSize: 10,
            totalCount: filteredAuditData.length,
            onPageChange: () => {},
            onPageSizeChange: () => {},
          }}
        />
      )}

      {/* Edit Database Bounds SlideOver */}
      <SlideOver
        isOpen={editDbOpen}
        onClose={() => setEditDbOpen(false)}
        title="Edit Database Pool Bounds"
        subtitle="Update connection pool limits and probe timeout for local_db."
      >
        <div className="space-y-4 font-sans">
          {dbUpdatedNotice && (
            <div className="p-3 bg-[#30a46c]/10 border border-[#30a46c]/20 text-[#30a46c] text-[13px] rounded-[8px]">
              Connection bounds successfully committed to axiom.db snapshot.
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-[#8c8c8c]">Minimum Idle Connections</label>
            <input
              type="number"
              min={1}
              max={20}
              value={dbMinConns}
              onChange={(e) => setDbMinConns(Number(e.target.value))}
              className="w-full h-9 px-3 rounded-[8px] bg-[#141414] border border-[#262626] hover:border-[#383838] focus:border-[#2f80ed] text-[13px] text-white outline-none font-sans"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-[#8c8c8c]">Maximum Active Connections</label>
            <input
              type="number"
              min={5}
              max={100}
              value={dbMaxConns}
              onChange={(e) => setDbMaxConns(Number(e.target.value))}
              className="w-full h-9 px-3 rounded-[8px] bg-[#141414] border border-[#262626] hover:border-[#383838] focus:border-[#2f80ed] text-[13px] text-white outline-none font-sans"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-[#8c8c8c]">Probe Timeout (seconds)</label>
            <input
              type="number"
              min={5}
              max={120}
              value={dbTimeout}
              onChange={(e) => setDbTimeout(Number(e.target.value))}
              className="w-full h-9 px-3 rounded-[8px] bg-[#141414] border border-[#262626] hover:border-[#383838] focus:border-[#2f80ed] text-[13px] text-white outline-none font-sans"
            />
          </div>
          <div className="pt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditDbOpen(false)}
              className="h-9 px-4 rounded-[8px] text-[13px] font-medium text-[#cccccc] hover:text-white bg-transparent border border-[#262626] hover:border-[#383838] hover:bg-[#161616] transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveDb}
              className="group relative inline-flex items-center justify-center h-9 px-4 rounded-[8px] font-medium text-white shadow-xs outline-none cursor-pointer overflow-hidden ring-1 ring-[#1d4ed8] bg-[#2563eb] text-[13px]"
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-[#3b82f6] to-[#2563eb] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black opacity-0 group-hover:opacity-15 transition-opacity duration-200"
              />
              <span className="relative">Commit Bounds</span>
            </button>
          </div>
        </div>
      </SlideOver>

      {/* Edit API Key SlideOver */}
      <SlideOver
        isOpen={editKeyOpen}
        onClose={() => setEditKeyOpen(false)}
        title="Modify API Key Configuration"
        subtitle="Update rate limits and assigned RBAC role for default_admin."
      >
        <div className="space-y-4 font-sans">
          {keyUpdatedNotice && (
            <div className="p-3 bg-[#30a46c]/10 border border-[#30a46c]/20 text-[#30a46c] text-[13px] rounded-[8px]">
              API Key permissions updated in ArcSwap metadata snapshot.
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-[#8c8c8c]">Assigned Role</label>
            <select
              value={keyRole}
              onChange={(e) => setKeyRole(e.target.value)}
              className="w-full h-9 px-3 rounded-[8px] bg-[#141414] border border-[#262626] hover:border-[#383838] focus:border-[#2f80ed] text-[13px] text-white outline-none font-sans"
            >
              <option value="admin">admin (Full Cluster Access)</option>
              <option value="readwrite">readwrite (CRUD Scoped)</option>
              <option value="readonly">readonly (SELECT Queries Only)</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-[#8c8c8c]">Rate Limit (requests / minute)</label>
            <input
              type="number"
              step={1000}
              value={keyRate}
              onChange={(e) => setKeyRate(Number(e.target.value))}
              className="w-full h-9 px-3 rounded-[8px] bg-[#141414] border border-[#262626] hover:border-[#383838] focus:border-[#2f80ed] text-[13px] text-white outline-none font-sans"
            />
          </div>
          <div className="pt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditKeyOpen(false)}
              className="h-9 px-4 rounded-[8px] text-[13px] font-medium text-[#cccccc] hover:text-white bg-transparent border border-[#262626] hover:border-[#383838] hover:bg-[#161616] transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveKey}
              className="group relative inline-flex items-center justify-center h-9 px-4 rounded-[8px] font-medium text-white shadow-xs outline-none cursor-pointer overflow-hidden ring-1 ring-[#1d4ed8] bg-[#2563eb] text-[13px]"
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-[#3b82f6] to-[#2563eb] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black opacity-0 group-hover:opacity-15 transition-opacity duration-200"
              />
              <span className="relative">Update Policy</span>
            </button>
          </div>
        </div>
      </SlideOver>
    </div>
  );
}
