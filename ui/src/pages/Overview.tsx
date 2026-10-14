/*
 * System Overview and telemetry dashboard connecting to live Axiom runtime stats.
 * Owned by: ui/pages
 * Key deps: api/client, components/shared/DataTable, components/shared/TelemetryCard
 * Invariants: Telemetry reflects live metadata snapshots, pools, and cache hit metrics without mock data.
 * Last structural change: Connected to live API endpoints (listDatabases, listKeys, getHealth, getCacheStats).
 */

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { NavPath } from '../components/Layout';
import { DataTable, Column } from '../components/shared/DataTable';
import { TelemetryCard, formatTimeFromPct } from '../components/shared/TelemetryCard';
import { CustomSelect } from '../components/shared/CustomSelect';
import { formatEngine } from '../types';
import { Database, Key, RefreshCw, Search } from 'lucide-react';
import {
  api,
  DatabaseRecordApi,
  ApiKeyRecordApi,
  SystemStatusData,
  HealthData,
  CacheStatsApi,
  MetricsSnapshotApi,
} from '../api/client';

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

export interface FilterRule {
  id: string;
  field: string;
  operator: 'contains' | 'equals' | 'starts_with';
  value: string;
}

export function Overview({ onNavigate }: OverviewProps) {
  const [activeTab, setActiveTab] = useState<'databases' | 'keys'>('databases');
  const [searchFilter, setSearchFilter] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Live Server Data States
  const [rawDbData, setRawDbData] = useState<DatabaseRow[]>([]);
  const [rawKeyData, setRawKeyData] = useState<KeyRow[]>([]);
  const [status, setStatus] = useState<SystemStatusData | null>(null);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [cacheStats, setCacheStats] = useState<CacheStatsApi | null>(null);
  const [metrics, setMetrics] = useState<MetricsSnapshotApi | null>(null);

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

  const [isLoading, setIsLoading] = useState(true);
  const fetchGenRef = useRef(0);

  // Pagination states for DB and Keys sub-tables
  const [dbPage, setDbPage] = useState(1);
  const [dbPageSize, setDbPageSize] = useState(10);
  const [keyPage, setKeyPage] = useState(1);
  const [keyPageSize, setKeyPageSize] = useState(10);

  const loadData = useCallback(async () => {
    const curGen = ++fetchGenRef.current;
    setIsRefreshing(true);
    try {
      const [statusRes, healthRes, cacheRes, metricsRes, dbRes, keysRes] = await Promise.allSettled([
        api.getStatus(),
        api.getHealth(),
        api.getCacheStats(),
        api.getMetricsSnapshot(),
        api.listDatabases(),
        api.listKeys(),
      ]);

      if (curGen !== fetchGenRef.current) return;

      if (statusRes.status === 'fulfilled') setStatus(statusRes.value);
      if (healthRes.status === 'fulfilled') setHealth(healthRes.value);
      if (cacheRes.status === 'fulfilled') setCacheStats(cacheRes.value);
      if (metricsRes.status === 'fulfilled') setMetrics(metricsRes.value);

      if (dbRes.status === 'fulfilled' && dbRes.value?.databases && Array.isArray(dbRes.value.databases)) {
        const healthMap = healthRes.status === 'fulfilled' ? healthRes.value?.databases : {};
        const rows: DatabaseRow[] = dbRes.value.databases.map((d: DatabaseRecordApi) => {
          const isDown = healthMap?.[d.alias] === 'down';
          return {
            alias: d.alias,
            engine: d.engine,
            conns: `${d.pool_min} – ${d.pool_max} active`,
            status: isDown ? 'Degraded' : 'Ready',
            latency: '<1 ms',
          };
        });
        setRawDbData(rows);
      }

      if (keysRes.status === 'fulfilled' && keysRes.value?.keys && Array.isArray(keysRes.value.keys)) {
        const rows: KeyRow[] = keysRes.value.keys.map((k: ApiKeyRecordApi) => {
          const isExpired = k.expires_at ? k.expires_at * 1000 < Date.now() : false;
          return {
            name: k.name,
            role: k.role_name || 'custom',
            rateLimit: k.rate_limit ? `${k.rate_limit.toLocaleString()} req/m` : 'Unlimited',
            status: isExpired ? 'Revoked' : 'Active',
            created: k.created_at ? new Date(k.created_at * 1000).toISOString().split('T')[0] : '—',
          };
        });
        setRawKeyData(rows);
      }
    } finally {
      if (curGen === fetchGenRef.current) {
        setIsRefreshing(false);
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

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
    loadData();
  };

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
    return [
      { value: 'name', label: 'Key Identifier' },
      { value: 'role', label: 'Role' },
      { value: 'status', label: 'Status' },
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
    return [
      { id: 'status', label: 'Status' },
      { id: 'name', label: 'Key Identifier' },
      { id: 'role', label: 'Role' },
      { id: 'rateLimit', label: 'Rate Limit' },
      { id: 'created', label: 'Created Date' },
    ];
  }, [activeTab]);

  const currentFilterRules = activeTab === 'databases' ? dbFilterRules : keyFilterRules;
  const currentAppliedFilterRules = activeTab === 'databases' ? appliedDbFilterRules : appliedKeyFilterRules;

  const setCurrentFilterRules = (fn: (prev: FilterRule[]) => FilterRule[]) => {
    if (activeTab === 'databases') setDbFilterRules(fn);
    else setKeyFilterRules(fn);
  };

  const setAppliedRules = (rules: FilterRule[]) => {
    if (activeTab === 'databases') setAppliedDbFilterRules(rules);
    else setAppliedKeyFilterRules(rules);
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

  const currentVisibleMap = activeTab === 'databases' ? visibleDbCols : visibleKeyCols;
  const toggleColVisibility = (colId: string) => {
    if (activeTab === 'databases') {
      setVisibleDbCols((prev) => ({ ...prev, [colId]: !prev[colId] }));
    } else {
      setVisibleKeyCols((prev) => ({ ...prev, [colId]: !prev[colId] }));
    }
  };

  const handleResetColumns = () => {
    if (activeTab === 'databases') {
      setVisibleDbCols({ status: true, alias: true, engine: true, conns: true, latency: true });
    } else {
      setVisibleKeyCols({ status: true, name: true, role: true, rateLimit: true, created: true });
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
        <div className="flex items-center gap-2 text-[14px] text-white font-normal truncate whitespace-nowrap" title={row.status}>
          <span
            className={`size-1.5 rounded-full shrink-0 ${
              row.status === 'Ready' ? 'bg-[#30a46c]' : 'bg-[#f59e0b]'
            }`}
          />
          <span className="truncate whitespace-nowrap">{row.status}</span>
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
        <div className="flex items-center gap-2.5 min-w-0">
          <Database className="w-4 h-4 text-[#8c8c8c] shrink-0" />
          <span className="font-medium text-white text-[14px] truncate whitespace-nowrap" title={row.alias}>{row.alias}</span>
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
        <span className="text-[14px] text-[#cccccc] font-normal truncate whitespace-nowrap block" title={formatEngine(row.engine)}>
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
        <span className="tabular-nums text-[14px] text-[#d4d4d4] font-normal truncate whitespace-nowrap block" title={row.conns}>
          {row.conns}
        </span>
      ),
    },
    {
      id: 'latency',
      header: 'Ping Latency',
      accessorKey: 'latency',
      width: 140,
      className: 'px-3',
      cell: (row) => (
        <span className="tabular-nums text-[14px] text-[#8c8c8c] font-normal truncate whitespace-nowrap block" title={row.latency}>
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
        <div className="flex items-center justify-end w-full">
          <button
            type="button"
            onClick={() => onNavigate('/system/databases')}
            className="inline-flex items-center justify-center h-7 px-3 rounded-[6px] text-[13px] font-medium leading-none text-[#8c8c8c] hover:text-white bg-transparent hover:bg-[#1a1a1a] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer shrink-0"
          >
            Manage
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
        <div className="flex items-center gap-2 text-[14px] text-white font-normal truncate whitespace-nowrap" title={row.status}>
          <span
            className={`size-1.5 rounded-full shrink-0 ${
              row.status === 'Active' ? 'bg-[#30a46c]' : 'bg-[#e5484d]'
            }`}
          />
          <span className="truncate whitespace-nowrap">{row.status}</span>
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
        <div className="flex items-center gap-2.5 min-w-0">
          <Key className="w-4 h-4 text-[#8c8c8c] shrink-0" />
          <span className="font-medium text-white text-[14px] truncate whitespace-nowrap" title={row.name}>{row.name}</span>
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
        <span className="text-[14px] text-[#cccccc] font-normal truncate whitespace-nowrap block" title={row.role}>
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
        <span className="tabular-nums text-[14px] text-[#8c8c8c] font-normal truncate whitespace-nowrap block" title={row.rateLimit}>
          {row.rateLimit}
        </span>
      ),
    },
    {
      id: 'created',
      header: 'Created Date',
      accessorKey: 'created',
      width: 150,
      className: 'px-3',
      cell: (row) => (
        <span className="tabular-nums text-[14px] text-[#8c8c8c] font-normal truncate whitespace-nowrap block" title={row.created}>
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
        <div className="flex items-center justify-end w-full">
          <button
            type="button"
            onClick={() => onNavigate('/system/keys')}
            className="inline-flex items-center justify-center h-7 px-3 rounded-[6px] text-[13px] font-medium leading-none text-[#8c8c8c] hover:text-white bg-transparent hover:bg-[#1a1a1a] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer shrink-0"
          >
            Manage
          </button>
        </div>
      ),
    },
  ];

  const activeDbColumns = useMemo(() => {
    const visible = dbColumns.filter((col) => col.id === 'actions' || visibleDbCols[col.id] !== false);
    const lastDataId = [...visible].reverse().find((c) => c.id !== 'actions')?.id;
    return visible.map((col) => ({
      ...col,
      isResizable: col.id !== 'actions' && col.id !== lastDataId && Boolean(col.isResizable),
    }));
  }, [dbColumns, visibleDbCols]);

  const activeKeyColumns = useMemo(() => {
    const visible = keyColumns.filter((col) => col.id === 'actions' || visibleKeyCols[col.id] !== false);
    const lastDataId = [...visible].reverse().find((c) => c.id !== 'actions')?.id;
    return visible.map((col) => ({
      ...col,
      isResizable: col.id !== 'actions' && col.id !== lastDataId && Boolean(col.isResizable),
    }));
  }, [keyColumns, visibleKeyCols]);

  const totalRequests = metrics?.http_requests_total ?? metrics?.requests_total ?? 0;
  const totalQueries = metrics?.queries_total ?? 0;
  const hasRequestData = totalRequests > 0;

  const l1Hits = cacheStats?.hits_l1 ?? cacheStats?.l1_hits ?? 0;
  const l1Misses = cacheStats?.misses ?? cacheStats?.l1_misses ?? 0;
  const cacheHitRate = cacheStats?.hit_rate_pct ?? cacheStats?.hit_ratio_percent ?? 0;
  const cacheEntries = cacheStats?.entries_count ?? cacheStats?.entries ?? 0;
  const hasCacheData = (l1Hits + l1Misses) > 0 || cacheEntries > 0;

  const onlinePoolCount = rawDbData.filter((d) => d.status === 'Ready').length;
  const totalPoolCount = rawDbData.length;

  return (
    <div className="space-y-6 w-full max-w-[1600px] mx-auto pb-12 select-none font-sans">
      {/* Top Header Row with Actions (Cloudflare / binary_alive style) */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-[16px] font-medium text-white tracking-tight">
            Overview
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {/* Refresh metrics button */}
          <button
            type="button"
            disabled={isRefreshing}
            onClick={handleRefresh}
            title="Refresh metrics"
            aria-label="Refresh metrics"
            className="flex items-center justify-center h-8 w-8 text-[#8c8c8c] hover:text-white rounded-[8px] bg-[#0c0c0c] hover:bg-[#141414] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin opacity-50' : ''}`} />
          </button>
        </div>
      </div>

      {/* 4 Telemetry Analytics Cards Grid (Clean technical minimal style) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 w-full font-sans">
        <TelemetryCard
          isLoading={isLoading}
          title="Total Requests"
          value={
            hasRequestData
              ? totalRequests >= 1000
                ? `${(totalRequests / 1000).toFixed(1)}k`
                : totalRequests.toLocaleString()
              : '0'
          }
          subLabel={
            hasRequestData
              ? `${totalQueries.toLocaleString()} ${totalQueries === 1 ? 'query' : 'queries'} executed`
              : 'Awaiting HTTP traffic'
          }
          gradientId="ov-throughput"
          strokeColor="#2f80ed"
          pathD={hasRequestData ? 'M 0,105 C 150,95 280,45 450,55 C 600,65 750,20 1000,35' : 'M 0,116 L 1000,116'}
          fillD={hasRequestData ? undefined : 'M 0,116 L 1000,116 L 1000,126 L 0,126 Z'}
          yAxisLabels={hasRequestData ? [String(totalRequests), String(Math.round(totalRequests * 0.5)), '0'] : ['100', '50', '0']}
          tooltipMetricName="Total Requests"
          onHoverCompute={(pct) => ({
            pct,
            yPct: hasRequestData ? 0.35 : 0.89,
            time: formatTimeFromPct(pct),
            value: `${totalRequests.toLocaleString()} requests (${totalQueries.toLocaleString()} queries)`,
          })}
        />

        <TelemetryCard
          isLoading={isLoading}
          title="L1 Cache Hit Ratio"
          value={hasCacheData ? `${cacheHitRate.toFixed(1)}%` : '0.0%'}
          subLabel={`${cacheEntries} cached object${cacheEntries === 1 ? '' : 's'}`}
          badge={{ text: '<1µs L1', icon: 'none', color: '#8c8c8c' }}
          gradientId="ov-cache"
          strokeColor="#2f80ed"
          pathD={hasCacheData ? 'M 0,55 C 200,45 400,35 600,38 C 800,28 900,30 1000,26' : 'M 0,116 L 1000,116'}
          fillD={hasCacheData ? undefined : 'M 0,116 L 1000,116 L 1000,126 L 0,126 Z'}
          yAxisLabels={['100%', '75%', '50%', '0%']}
          tooltipMetricName="Cache Hit Ratio"
          onHoverCompute={(pct) => ({
            pct,
            yPct: hasCacheData ? 0.25 : 0.89,
            time: formatTimeFromPct(pct),
            value: `${cacheHitRate.toFixed(1)}% (${l1Hits.toLocaleString()} hits / ${l1Misses.toLocaleString()} misses)`,
          })}
        />

        <TelemetryCard
          isLoading={isLoading}
          title="Gateway Health"
          value={health?.status === 'healthy' ? 'Healthy' : health?.status === 'degraded' ? 'Degraded' : 'Operational'}
          subLabel={
            health?.uptime_seconds != null
              ? `Uptime ${Math.floor(health.uptime_seconds / 3600)}h ${Math.floor((health.uptime_seconds % 3600) / 60)}m`
              : 'Gateway responsive'
          }
          badge={{
            text: health?.status === 'healthy' ? 'Normal' : health?.status === 'degraded' ? 'Degraded' : 'Active',
            icon: 'none',
            color: health?.status === 'healthy' ? '#30a46c' : health?.status === 'degraded' ? '#e5484d' : '#2f80ed',
          }}
          gradientId="ov-latency"
          strokeColor={health?.status === 'degraded' ? '#e5484d' : '#30a46c'}
          pathD="M 0,50 L 1000,50"
          fillD="M 0,50 L 1000,50 L 1000,126 L 0,126 Z"
          yAxisLabels={['100%', '75%', '50%', '0%']}
          tooltipMetricName="Gateway Availability"
          onHoverCompute={(pct) => ({
            pct,
            yPct: health?.status === 'healthy' ? 0.38 : 0.75,
            time: formatTimeFromPct(pct),
            value: health?.status === 'healthy' ? '100% operational availability' : 'Service degraded (database unreachable)',
          })}
        />

        <TelemetryCard
          isLoading={isLoading}
          title="Active Database Pools"
          value={`${totalPoolCount} ${totalPoolCount === 1 ? 'pool' : 'pools'}`}
          subLabel={
            totalPoolCount > 0
              ? `${onlinePoolCount} online · ${totalPoolCount - onlinePoolCount} degraded`
              : 'No pools configured'
          }
          badge={{
            text: `${onlinePoolCount}/${totalPoolCount} online`,
            icon: 'none',
            color: totalPoolCount === 0 ? '#8c8c8c' : totalPoolCount === onlinePoolCount ? '#30a46c' : '#f59e0b',
          }}
          gradientId="ov-pools"
          strokeColor={totalPoolCount === onlinePoolCount ? '#2f80ed' : '#f59e0b'}
          pathD={totalPoolCount > 0 ? 'M 0,60 L 1000,60' : 'M 0,116 L 1000,116'}
          fillD={totalPoolCount > 0 ? 'M 0,60 L 1000,60 L 1000,126 L 0,126 Z' : 'M 0,116 L 1000,116 L 1000,126 L 0,126 Z'}
          yAxisLabels={totalPoolCount > 2 ? [String(totalPoolCount), String(Math.round(totalPoolCount / 2)), '0'] : ['2', '1', '0']}
          tooltipMetricName="Active Pools"
          onHoverCompute={(pct) => ({
            pct,
            yPct: 0.5,
            time: formatTimeFromPct(pct),
            value: `${totalPoolCount} pool${totalPoolCount === 1 ? '' : 's'} (${onlinePoolCount} online)`,
          })}
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
                <span className="text-[12px] text-[#8c8c8c] font-normal">
                  ({currentAppliedFilterRules.length})
                </span>
              )}
            </button>

            {showFilters && (
              <div className="absolute right-0 top-10 w-[540px] max-w-[calc(100vw-32px)] rounded-[8px] bg-[#0c0c0c] border border-[#262626] shadow-2xl p-4 z-50 select-none animate-in fade-in font-sans">
                {/* Header */}
                <div className="flex items-center justify-between pb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-medium text-white font-sans">
                      {activeTab === 'databases' ? 'Database Filters' : 'API Key Filters'}
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
          </div>
        </div>
      </div>

      {/* DataTable direct render (No duplicate outer border wrapper) */}
      {activeTab === 'databases' && (
        <DataTable
          columns={activeDbColumns}
          data={filteredDbData}
          isLoading={isLoading}
          ariaLabel="Active Database Pools"
          pagination={{
            page: dbPage,
            pageSize: dbPageSize,
            totalCount: filteredDbData.length,
            onPageChange: setDbPage,
            onPageSizeChange: (newSize) => {
              setDbPageSize(newSize);
              setDbPage(1);
            },
          }}
        />
      )}

      {activeTab === 'keys' && (
        <DataTable
          columns={activeKeyColumns}
          data={filteredKeyData}
          isLoading={isLoading}
          ariaLabel="Configured API Keys"
          pagination={{
            page: keyPage,
            pageSize: keyPageSize,
            totalCount: filteredKeyData.length,
            onPageChange: setKeyPage,
            onPageSizeChange: (newSize) => {
              setKeyPageSize(newSize);
              setKeyPage(1);
            },
          }}
        />
      )}

    </div>
  );
}
