import React, { useState } from 'react';
import { DatabasePool, EngineType } from '../types';
import { DataTable, Column } from '../components/shared/DataTable';
import { SlideOver } from '../components/ui/SlideOver';
import { Button } from '../components/ui/Button';
import { Database, Plus, CheckCircle2, Shield, Activity, RefreshCw, Trash2, Key } from 'lucide-react';

export function Databases() {
  const [pools, setPools] = useState<DatabasePool[]>([
    {
      alias: 'local_db',
      engine: 'POSTGRESQL',
      version: 'PostgreSQL 16.2',
      url: 'postgres://app:secret@127.0.0.1:5432/axiom_local',
      minConnections: 1,
      maxConnections: 10,
      idleTimeoutSeconds: 30,
      readonly: false,
      status: 'Ready',
      latencyMs: 0.42,
    },
    {
      alias: 'prod_pg',
      engine: 'POSTGRESQL',
      version: 'PostgreSQL 16.1',
      url: 'postgres://prod_app:******@prod-db.internal:5432/primary',
      minConnections: 5,
      maxConnections: 50,
      idleTimeoutSeconds: 15,
      readonly: false,
      status: 'Ready',
      latencyMs: 1.15,
    },
    {
      alias: 'analytics_ch',
      engine: 'CLICKHOUSE',
      version: 'ClickHouse 24.3',
      url: 'clickhouse://analytics:******@ch-cluster:8123/default',
      minConnections: 2,
      maxConnections: 20,
      idleTimeoutSeconds: 60,
      readonly: true,
      status: 'Ready',
      latencyMs: 2.75,
    },
    {
      alias: 'edge_turso_db',
      engine: 'LIBSQL',
      version: 'LibSQL 0.14',
      url: 'libsql://cache-edge.turso.io',
      minConnections: 1,
      maxConnections: 5,
      idleTimeoutSeconds: 120,
      readonly: false,
      status: 'Ready',
      latencyMs: 0.18,
    },
  ]);

  // Attach DB SlideOver State
  const [attachOpen, setAttachOpen] = useState(false);
  const [newAlias, setNewAlias] = useState('');
  const [newEngine, setNewEngine] = useState<string>('POSTGRESQL');
  const [newUrl, setNewUrl] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);

  // Edit DB SlideOver State
  const [editOpen, setEditOpen] = useState(false);
  const [selectedPool, setSelectedPool] = useState<DatabasePool | null>(null);
  const [editMin, setEditMin] = useState(1);
  const [editMax, setEditMax] = useState(10);
  const [editTimeout, setEditTimeout] = useState(30);

  // Schema SlideOver State
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [schemaPool, setSchemaPool] = useState<DatabasePool | null>(null);

  function handleTestConnection() {
    setTestResult('testing');
    setTimeout(() => {
      setTestResult('success');
    }, 450);
  }

  function handleAttach() {
    if (!newAlias.trim()) return;
    const newPool: DatabasePool = {
      alias: newAlias.trim(),
      engine: newEngine as EngineType,
      url: newUrl,
      minConnections: 1,
      maxConnections: 10,
      idleTimeoutSeconds: 30,
      readonly: false,
      status: 'Ready',
      latencyMs: 0.85,
    };
    setPools([...pools, newPool]);
    setAttachOpen(false);
    setNewAlias('');
    setNewUrl('');
    setTestResult(null);
  }

  function handleSaveEdit() {
    if (!selectedPool) return;
    setPools(
      pools.map((p) =>
        p.alias === selectedPool.alias
          ? { ...p, minConnections: editMin, maxConnections: editMax, idleTimeoutSeconds: editTimeout }
          : p
      )
    );
    setEditOpen(false);
  }

  const columns: Column<DatabasePool>[] = [
    {
      id: 'alias',
      header: 'Pool Alias',
      accessorKey: 'alias',
      isSortable: true,
      width: 220,
      cell: (row) => (
        <div className="flex items-center gap-2.5">
          <Database className="w-4 h-4 text-[#8c8c8c] shrink-0" />
          <span className="font-medium text-white text-[14px]">{row.alias}</span>
        </div>
      ),
    },
    {
      id: 'engine',
      header: 'Engine Dialect',
      accessorKey: 'engine',
      width: 170,
      className: 'px-3',
      cell: (row) => (
        <span className="text-[14px] text-[#cccccc] font-normal">
          {row.engine}
        </span>
      ),
    },
    {
      id: 'conns',
      header: 'Connection Limits',
      width: 180,
      className: 'px-3',
      cell: (row) => (
        <span className="tabular-nums text-[14px] text-[#d4d4d4] font-normal">
          {row.minConnections} min / {row.maxConnections} max
        </span>
      ),
    },
    {
      id: 'latency',
      header: 'Ping Latency',
      width: 140,
      className: 'px-3',
      cell: (row) => (
        <span className="tabular-nums text-[14px] text-[#8c8c8c] font-normal">
          {row.latencyMs} ms
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Health State',
      accessorKey: 'status',
      width: 140,
      className: 'px-3',
      cell: (row) => (
        <div className="flex items-center gap-2 text-[14px] text-white font-normal">
          <span className="size-1.5 rounded-full bg-[#30a46c] shrink-0" />
          <span>{row.status}</span>
        </div>
      ),
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      isFlex: true,
      headerClassName: 'justify-end pr-4 text-right',
      className: 'pl-3 pr-4 justify-end',
      cell: (row) => (
        <div className="flex items-center justify-end gap-2 w-full">
          <button
            type="button"
            onClick={() => {
              setSelectedPool(row);
              setEditMin(row.minConnections);
              setEditMax(row.maxConnections);
              setEditTimeout(row.idleTimeoutSeconds);
              setEditOpen(true);
            }}
            className="inline-flex items-center justify-center h-7 px-3 rounded-[6px] text-[13px] font-medium leading-none text-white hover:text-white bg-transparent hover:bg-[#1a1a1a] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer shrink-0"
          >
            Edit Bounds
          </button>
          <button
            type="button"
            onClick={() => {
              setSchemaPool(row);
              setSchemaOpen(true);
            }}
            className="inline-flex items-center justify-center h-7 px-3 rounded-[6px] text-[13px] font-medium leading-none text-[#cccccc] hover:text-white bg-transparent hover:bg-[#161616] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer shrink-0"
          >
            Schema
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm(`Disconnect database pool "${row.alias}"?`)) {
                setPools(pools.filter((p) => p.alias !== row.alias));
              }
            }}
            className="inline-flex items-center justify-center h-7 px-2.5 rounded-[6px] text-[13px] font-medium leading-none text-[#8c8c8c] hover:text-[#e5484d] bg-transparent hover:bg-[#161616] border border-transparent hover:border-[#262626] transition-colors cursor-pointer shrink-0"
          >
            Disconnect
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-[16px] font-semibold text-white tracking-tight">Databases</h1>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            setTestResult(null);
            setAttachOpen(true);
          }}
        >
          <Plus className="w-3.5 h-3.5 mr-1" />
          Attach Database
        </Button>
      </div>

      {/* Pools Read-Only DataTable */}
      <DataTable
        columns={columns}
        data={pools}
        ariaLabel="Database Pools Table"
        pagination={{
          page: 1,
          pageSize: 10,
          totalCount: pools.length,
          onPageChange: () => {},
          onPageSizeChange: () => {},
        }}
      />

      {/* Attach DB SlideOver */}
      <SlideOver
        isOpen={attachOpen}
        onClose={() => setAttachOpen(false)}
        title="Attach Database Pool"
        subtitle="Configure connection endpoint, dialect engine, and credential URI"
      >
        <div className="flex-1 p-5 overflow-y-auto space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-[#cccccc] mb-1.5">Database Engine</label>
            <select
              value={newEngine}
              onChange={(e) => setNewEngine(e.target.value)}
              className="h-9 w-full rounded-md border border-[#262626] bg-[#121212] px-3 text-[13px] text-white focus:outline-none focus:border-[#3b82f6]"
            >
              <option value="POSTGRESQL">PostgreSQL 14 / 15 / 16 (sqlx driver)</option>
              <option value="MYSQL">MySQL 8.0 / MariaDB (sqlx driver)</option>
              <option value="MSSQL">Microsoft SQL Server (tiberius TDS)</option>
              <option value="CLICKHOUSE">ClickHouse OLAP (HTTP engine)</option>
              <option value="LIBSQL">LibSQL / SQLite (Turso &amp; local)</option>
            </select>
          </div>

          <div>
            <label className="block text-[12px] font-medium text-[#cccccc] mb-1.5">Pool Alias (Identifier)</label>
            <input
              type="text"
              value={newAlias}
              onChange={(e) => setNewAlias(e.target.value)}
              placeholder="e.g. analytics_warehouse"
              className="h-9 w-full rounded-md border border-[#262626] bg-[#121212] px-3 text-[13px] text-white focus:outline-none focus:border-[#3b82f6]"
            />
          </div>

          <div>
            <label className="block text-[12px] font-medium text-[#cccccc] mb-1.5">Connection URL (Encrypted)</label>
            <input
              type="password"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="postgres://user:secret@host:5432/dbname"
              className="h-9 w-full rounded-md border border-[#262626] bg-[#121212] px-3 text-[13px] text-white focus:outline-none focus:border-[#3b82f6]"
            />
          </div>

          <div>
            <button
              type="button"
              onClick={handleTestConnection}
              className="h-8 px-3 rounded-md text-[12px] font-medium border border-[#262626] bg-[#161616] text-[#cccccc] hover:text-white hover:border-[#383838] transition-colors inline-flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${testResult === 'testing' ? 'animate-spin text-[#3b82f6]' : ''}`} />
              <span>Test Connection Handshake</span>
            </button>
          </div>

          {testResult === 'testing' && (
            <div className="rounded-md border border-[#262626] bg-[#141414] p-3 text-[12px] text-[#8c8c8c]">
              Probing TCP handshake and validating dialect authentication...
            </div>
          )}

          {testResult === 'success' && (
            <div className="rounded-md border border-[#30a46c]/30 bg-[#30a46c]/10 p-3 text-[12px] text-[#30a46c] font-medium flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              Connection handshake verified. Round-trip: 0.94 ms.
            </div>
          )}
        </div>

        <div className="p-4 border-t border-[#222222] bg-[#000000] flex items-center justify-end gap-2.5">
          <Button variant="outline" size="sm" onClick={() => setAttachOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleAttach}>
            Attach Pool
          </Button>
        </div>
      </SlideOver>

      {/* Edit Pool Bounds SlideOver */}
      <SlideOver
        isOpen={editOpen}
        onClose={() => setEditOpen(false)}
        title={`Edit Pool: ${selectedPool?.alias}`}
        subtitle="Update concurrency thresholds and statement timeouts"
      >
        <div className="flex-1 p-5 overflow-y-auto space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-medium text-[#cccccc] mb-1.5">Min Connections</label>
              <input
                type="number"
                value={editMin}
                onChange={(e) => setEditMin(Number(e.target.value))}
                className="h-9 w-full rounded-md border border-[#262626] bg-[#121212] px-3 text-[13px] text-white focus:outline-none focus:border-[#3b82f6] tabular-nums"
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[#cccccc] mb-1.5">Max Connections</label>
              <input
                type="number"
                value={editMax}
                onChange={(e) => setEditMax(Number(e.target.value))}
                className="h-9 w-full rounded-md border border-[#262626] bg-[#121212] px-3 text-[13px] text-white focus:outline-none focus:border-[#3b82f6] tabular-nums"
              />
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-medium text-[#cccccc] mb-1.5">Idle Timeout (seconds)</label>
            <input
              type="number"
              value={editTimeout}
              onChange={(e) => setEditTimeout(Number(e.target.value))}
              className="h-9 w-full rounded-md border border-[#262626] bg-[#121212] px-3 text-[13px] text-white focus:outline-none focus:border-[#3b82f6] tabular-nums"
            />
          </div>
        </div>

        <div className="p-4 border-t border-[#222222] bg-[#000000] flex items-center justify-end gap-2.5">
          <Button variant="outline" size="sm" onClick={() => setEditOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleSaveEdit}>
            Save Changes
          </Button>
        </div>
      </SlideOver>

      {/* Schema Inspector SlideOver */}
      <SlideOver
        isOpen={schemaOpen}
        onClose={() => setSchemaOpen(false)}
        title={`Introspected Schema: ${schemaPool?.alias}`}
        subtitle="Cataloged tables, column types, and foreign key relations"
      >
        <div className="flex-1 p-5 overflow-y-auto space-y-4">
          <div className="rounded-lg border border-[#222222] bg-[#121212] p-3.5 space-y-2">
            <span className="text-[13px] font-semibold text-white font-mono flex items-center gap-2">
              <Database className="w-3.5 h-3.5 text-[#3b82f6]" />
              users
            </span>
            <div className="text-[12px] text-[#8c8c8c] space-y-1 font-mono divide-y divide-[#1e1e1e]">
              <div className="flex justify-between py-1">
                <span className="text-white">id</span>
                <span className="text-[#3b82f6]">INTEGER (PK)</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-white">email</span>
                <span>VARCHAR(255) NOT NULL</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-white">status</span>
                <span>VARCHAR(50) DEFAULT 'active'</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-white">created_at</span>
                <span>TIMESTAMPTZ</span>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-[#222222] bg-[#121212] p-3.5 space-y-2">
            <span className="text-[13px] font-semibold text-white font-mono flex items-center gap-2">
              <Database className="w-3.5 h-3.5 text-[#3b82f6]" />
              orders
            </span>
            <div className="text-[12px] text-[#8c8c8c] space-y-1 font-mono divide-y divide-[#1e1e1e]">
              <div className="flex justify-between py-1">
                <span className="text-white">id</span>
                <span className="text-[#3b82f6]">INTEGER (PK)</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-white">user_id</span>
                <span className="text-[#f59e0b]">INTEGER (FK &rarr; users.id)</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-white">total_amount</span>
                <span>NUMERIC(12, 2)</span>
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-[#222222] bg-[#000000] flex items-center justify-end">
          <Button variant="outline" size="sm" onClick={() => setSchemaOpen(false)}>
            Close
          </Button>
        </div>
      </SlideOver>
    </div>
  );
}
