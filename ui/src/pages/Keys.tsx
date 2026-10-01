import React, { useState } from 'react';
import { ApiKey } from '../types';
import { DataTable, Column } from '../components/shared/DataTable';
import { SlideOver } from '../components/ui/SlideOver';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { CustomSelect } from '../components/shared/CustomSelect';
import { DatePicker } from '../components/shared/DatePicker';
import { Key, Plus, RefreshCw, Copy, Check } from 'lucide-react';

const ROLE_OPTIONS = [
  { value: 'admin', label: 'admin (Full Root Privileges)' },
  { value: 'readwrite', label: 'readwrite (CRUD Access)' },
  { value: 'readonly', label: 'readonly (SELECT Queries Only)' },
];

const STATUS_OPTIONS: { value: 'Active' | 'Revoked' | 'Expired'; label: string; icon: React.ReactNode }[] = [
  {
    value: 'Active',
    label: 'Active',
    icon: <span className="size-2 rounded-full shrink-0 bg-[#30a46c]" />,
  },
  {
    value: 'Revoked',
    label: 'Revoked',
    icon: <span className="size-2 rounded-full shrink-0 bg-[#e5484d]" />,
  },
  {
    value: 'Expired',
    label: 'Expired',
    icon: <span className="size-2 rounded-full shrink-0 bg-[#f59e0b]" />,
  },
];

const GRACE_OPTIONS = [
  { value: '1h', label: '1 hour' },
  { value: '6h', label: '6 hours' },
  { value: '24h', label: '24 hours' },
  { value: '72h', label: '72 hours' },
];

export function Keys() {
  const [keys, setKeys] = useState<ApiKey[]>([
    {
      name: 'default_admin',
      role: 'admin',
      rateLimit: 10000,
      status: 'Active',
      expiresAt: null,
      createdAt: '2026-09-27',
    },
    {
      name: 'frontend_app',
      role: 'readwrite',
      rateLimit: 1200,
      status: 'Active',
      expiresAt: '2027-01-01',
      createdAt: '2026-09-28',
    },
    {
      name: 'analytics_agent',
      role: 'readonly',
      rateLimit: 300,
      status: 'Active',
      expiresAt: '2026-12-31',
      createdAt: '2026-09-29',
    },
  ]);

  // Create Key SlideOver State
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('readwrite');
  const [newRateLimit, setNewRateLimit] = useState(1000);
  const [newExpiresAt, setNewExpiresAt] = useState<string | null>(null);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  // Manage SlideOver State
  const [manageOpen, setManageOpen] = useState(false);
  const [manageTab, setManageTab] = useState<'edit' | 'rotate' | 'danger'>('edit');
  const [selectedKey, setSelectedKey] = useState<ApiKey | null>(null);
  const [editStatus, setEditStatus] = useState<'Active' | 'Revoked' | 'Expired'>('Active');
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState('admin');
  const [editRate, setEditRate] = useState(10000);
  const [editExpiresAt, setEditExpiresAt] = useState<string | null>(null);
  const [rotatedSecret, setRotatedSecret] = useState<string | null>(null);
  const [gracePeriod, setGracePeriod] = useState('24h');
  const [confirmRevokeOpen, setConfirmRevokeOpen] = useState(false);

  const isModified = Boolean(
    selectedKey &&
      editName.trim() !== '' &&
      (editName.trim() !== selectedKey.name ||
        editStatus !== selectedKey.status ||
        editRole !== selectedKey.role ||
        editRate !== selectedKey.rateLimit ||
        editExpiresAt !== selectedKey.expiresAt)
  );

  function handleCreateKey() {
    if (!newName.trim()) return;
    const generatedSecret = `axk_live_${Math.random().toString(36).substring(2, 15)}_${Math.random().toString(36).substring(2, 10)}`;
    const newKeyObj: ApiKey = {
      name: newName.trim(),
      role: newRole,
      rateLimit: newRateLimit,
      status: 'Active',
      expiresAt: newExpiresAt,
      createdAt: new Date().toISOString().split('T')[0],
    };
    setKeys([...keys, newKeyObj]);
    setCreatedSecret(generatedSecret);
  }

  function handleSaveEdit() {
    if (!selectedKey || !editName.trim()) return;
    setKeys(
      keys.map((k) =>
        k.name === selectedKey.name
          ? {
              ...k,
              name: editName.trim(),
              status: editStatus,
              role: editRole,
              rateLimit: editRate,
              expiresAt: editExpiresAt,
            }
          : k
      )
    );
    setManageOpen(false);
  }

  function handleRotateKey() {
    const freshSecret = `axk_rot_${Math.random().toString(36).substring(2, 15)}_${Math.random().toString(36).substring(2, 10)}`;
    setRotatedSecret(freshSecret);
  }

  // 1. Status, 2. Name, 3. Role, 4. Rate Limit, 5. Expiry Date, 6. Created Date
  const columns: Column<ApiKey>[] = [
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
              row.status === 'Active'
                ? 'bg-[#30a46c]'
                : row.status === 'Expired'
                ? 'bg-[#f59e0b]'
                : 'bg-[#e5484d]'
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
      width: 220,
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
      header: 'Assigned Role',
      accessorKey: 'role',
      isResizable: true,
      width: 160,
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
      isResizable: true,
      width: 160,
      className: 'px-3',
      cell: (row) => (
        <span className="tabular-nums text-[14px] text-[#8c8c8c] font-normal truncate whitespace-nowrap block" title={`${row.rateLimit.toLocaleString()} req/min`}>
          {row.rateLimit.toLocaleString()} req/min
        </span>
      ),
    },
    {
      id: 'expiresAt',
      header: 'Expiry Date',
      accessorKey: 'expiresAt',
      isResizable: true,
      width: 140,
      className: 'px-3',
      cell: (row) => (
        <span className={`tabular-nums text-[14px] font-normal truncate whitespace-nowrap block ${row.expiresAt ? 'text-[#8c8c8c]' : 'text-[#666666]'}`} title={row.expiresAt || 'Never'}>
          {row.expiresAt || 'Never'}
        </span>
      ),
    },
    {
      id: 'createdAt',
      header: 'Created Date',
      accessorKey: 'createdAt',
      width: 140,
      className: 'px-3',
      cell: (row) => (
        <span className="tabular-nums text-[14px] text-[#8c8c8c] font-normal truncate whitespace-nowrap block" title={row.createdAt}>
          {row.createdAt}
        </span>
      ),
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      isFlex: true,
      headerClassName: 'justify-end pr-4 text-right',
      className: 'pl-3 pr-4 justify-end',
      cell: (row) => (
        <div className="flex items-center justify-end w-full">
          <button
            type="button"
            onClick={() => {
              setSelectedKey(row);
              setEditName(row.name);
              setEditStatus(row.status);
              setEditRole(row.role);
              setEditRate(row.rateLimit);
              setEditExpiresAt(row.expiresAt);
              setManageTab('edit');
              setManageOpen(true);
            }}
            className="inline-flex items-center justify-center h-7 px-3 rounded-[6px] text-[13px] font-medium leading-none text-[#8c8c8c] hover:text-white bg-transparent hover:bg-[#1a1a1a] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer shrink-0"
          >
            Manage
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
          <h1 className="text-[16px] font-semibold text-white tracking-tight">API Keys</h1>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            setCreatedSecret(null);
            setNewName('');
            setNewRole('readwrite');
            setNewRateLimit(1000);
            setNewExpiresAt(null);
            setCopiedKey(false);
            setCreateOpen(true);
          }}
        >
          <Plus className="w-3.5 h-3.5 mr-1" />
          Generate Key
        </Button>
      </div>

      {/* Keys Read-Only DataTable */}
      <DataTable
        columns={columns}
        data={keys}
        ariaLabel="API Keys Table"
        pagination={{
          page: 1,
          pageSize: 10,
          totalCount: keys.length,
          onPageChange: () => {},
          onPageSizeChange: () => {},
        }}
      />

      {/* Create Key SlideOver */}
      <SlideOver
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Generate Machine API Key"
        subtitle="Issue an authorized cryptographic credential with attached RBAC role"
      >
        <div className="flex-1 p-5 pb-36 overflow-y-auto space-y-4">
          {createdSecret ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-[#30a46c]/30 bg-[#30a46c]/10 p-4 space-y-2">
                <span className="text-[13px] font-semibold text-[#30a46c] flex items-center gap-1.5">
                  <Check className="w-4 h-4" />
                  Key Generated Successfully
                </span>
                <p className="text-[12px] text-[#cccccc] leading-relaxed">
                  Store this secret securely now. Axiom uses irreversible BLAKE3 hashing and cannot recover this plaintext value later.
                </p>
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="text"
                    readOnly
                    value={createdSecret}
                    className="h-9 flex-1 rounded-md border border-[#262626] bg-[#0c0c0c] px-3 font-mono text-[12px] text-[#3b82f6] select-all"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(createdSecret);
                      setCopiedKey(true);
                      setTimeout(() => setCopiedKey(false), 2000);
                    }}
                  >
                    {copiedKey ? <Check className="w-3.5 h-3.5 text-[#30a46c]" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedKey ? 'Copied' : 'Copy'}</span>
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border border-[#222222] bg-[#121212] p-3 text-[12px] text-[#8c8c8c] space-y-1">
                <span className="font-semibold text-white block">Usage Example:</span>
                <pre className="p-2 rounded bg-[#0a0a0a] border border-[#1e1e1e] font-mono text-[11px] text-[#3b82f6] overflow-x-auto">
                  {`curl -X POST https://axiom.internal/api/v1/db/local_db/query \\\n  -H "X-Axiom-Key: ${Buffer ? '...' : 'base64(name:secret)'}" \\\n  -d '{"sql": "SELECT 1"}'`}
                </pre>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <h3 className="text-[16px] font-semibold text-white tracking-tight">Key Configuration</h3>
                <p className="text-[13px] text-[#8c8c8c] mt-0.5">Provide key identifier, assigned RBAC permissions, and usage limits.</p>
              </div>

              {/* 1. Name */}
              <div>
                <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">Key Identifier Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. payment_service_prod"
                  className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white font-mono focus:outline-none focus:border-[#3b82f6]"
                />
              </div>

              {/* 2. Role */}
              <div>
                <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">Assigned RBAC Role</label>
                <CustomSelect
                  value={newRole}
                  options={ROLE_OPTIONS}
                  onChange={(val) => setNewRole(val)}
                  menuWidth="w-full"
                />
              </div>

              {/* 3. Rate Limit */}
              <div>
                <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">Rate Limit Threshold (req/min)</label>
                <input
                  type="number"
                  value={newRateLimit}
                  onChange={(e) => setNewRateLimit(Number(e.target.value))}
                  className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6] tabular-nums"
                />
              </div>

              {/* 4. Expiry Date */}
              <div>
                <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">Expiry Date</label>
                <DatePicker
                  value={newExpiresAt}
                  onChange={(val) => setNewExpiresAt(val)}
                  placeholder="No expiry (Never)"
                />
                <p className="text-[12px] text-[#8c8c8c] mt-1">
                  Optional. Leave empty or choose Never to keep key valid indefinitely.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 bg-[#0e0e0e] flex items-center justify-end gap-2.5">
          {createdSecret ? (
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="group relative flex shrink-0 items-center justify-center h-9 px-4 rounded-[8px] font-medium text-white shadow-xs outline-none cursor-pointer overflow-hidden ring-1 ring-[#1d4ed8] bg-[#2563eb] font-sans text-[14px]"
            >
              <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-[#3b82f6] to-[#2563eb] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]" />
              <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black opacity-0 group-hover:opacity-15 transition-opacity duration-200" />
              <span className="relative flex items-center gap-1.5 font-sans">
                Done
              </span>
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="inline-flex items-center justify-center h-9 px-4 rounded-[8px] text-[14px] font-medium text-[#cccccc] hover:text-white bg-transparent hover:bg-[#161616] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer font-sans"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateKey}
                disabled={!newName.trim()}
                className="group relative flex shrink-0 items-center justify-center h-9 px-4 rounded-[8px] font-medium text-white shadow-xs outline-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed overflow-hidden ring-1 ring-[#1d4ed8] bg-[#2563eb] font-sans text-[14px]"
              >
                <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-[#3b82f6] to-[#2563eb] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]" />
                <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black opacity-0 group-hover:opacity-15 transition-opacity duration-200" />
                <span className="relative flex items-center gap-1.5 font-sans">
                  Generate Secret
                </span>
              </button>
            </>
          )}
        </div>
      </SlideOver>

      {/* Manage Key SlideOver */}
      <SlideOver
        isOpen={manageOpen}
        onClose={() => { setManageOpen(false); setManageTab('edit'); }}
        title={selectedKey?.name ?? ''}
        subtitle={selectedKey ? `Role: ${selectedKey.role} · ${selectedKey.status}` : ''}
      >
        {/* Tab bar (Segmented control matching dashboard) */}
        <div className="px-5 py-3 border-b border-[#222222] bg-[#0e0e0e]">
          <div className="inline-flex items-center p-0.5 rounded-[8px] bg-transparent border border-[#262626]">
            <button
              type="button"
              onClick={() => setManageTab('edit')}
              className={`flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[14px] font-medium transition-colors duration-75 cursor-pointer font-sans outline-none focus:outline-none border ${
                manageTab === 'edit'
                  ? 'bg-[#161616] text-white border-[#333333]'
                  : 'text-[#8c8c8c] hover:text-white hover:bg-[#141414] border-transparent'
              }`}
            >
              <span>Settings</span>
            </button>
            <button
              type="button"
              onClick={() => setManageTab('rotate')}
              className={`flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[14px] font-medium transition-colors duration-75 cursor-pointer font-sans outline-none focus:outline-none border ${
                manageTab === 'rotate'
                  ? 'bg-[#161616] text-white border-[#333333]'
                  : 'text-[#8c8c8c] hover:text-white hover:bg-[#141414] border-transparent'
              }`}
            >
              <span>Rotate Secret</span>
            </button>
            <button
              type="button"
              onClick={() => setManageTab('danger')}
              className={`flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[14px] font-medium transition-colors duration-75 cursor-pointer font-sans outline-none focus:outline-none border ${
                manageTab === 'danger'
                  ? 'bg-[#161616] text-white border-[#333333]'
                  : 'text-[#8c8c8c] hover:text-white hover:bg-[#141414] border-transparent'
              }`}
            >
              <span>Danger</span>
            </button>
          </div>
        </div>

        {manageTab === 'edit' && (
          <div className="flex-1 p-5 pb-36 overflow-y-auto space-y-4">
            <div>
              <h3 className="text-[16px] font-semibold text-white tracking-tight">Key Settings</h3>
              <p className="text-[13px] text-[#8c8c8c] mt-0.5">Update key lifecycle status, assigned role, rate threshold, and expiry.</p>
            </div>

            {/* 1. Status */}
            <div>
              <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">Status</label>
              <CustomSelect
                value={editStatus}
                options={STATUS_OPTIONS}
                onChange={(val) => setEditStatus(val as 'Active' | 'Revoked' | 'Expired')}
                menuWidth="w-full"
              />
            </div>

            {/* 2. Name */}
            <div>
              <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">Key Identifier Name</label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="e.g. payment_service_prod"
                className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white font-mono focus:outline-none focus:border-[#3b82f6]"
              />
            </div>

            {/* 3. Role */}
            <div>
              <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">Assigned Role</label>
              <CustomSelect
                value={editRole}
                options={ROLE_OPTIONS}
                onChange={(val) => setEditRole(val)}
                menuWidth="w-full"
              />
            </div>

            {/* 4. Rate Limit */}
            <div>
              <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">Rate Limit Threshold (req/min)</label>
              <input
                type="number"
                value={editRate}
                onChange={(e) => setEditRate(Number(e.target.value))}
                className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6] tabular-nums"
              />
            </div>

            {/* 5. Expiry Date */}
            <div>
              <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">Expiry Date</label>
              <DatePicker
                value={editExpiresAt}
                onChange={(val) => setEditExpiresAt(val)}
                placeholder="No expiry (Never)"
              />
              <p className="text-[12px] text-[#8c8c8c] mt-1">
                Optional. Leave empty or choose Never to keep key valid indefinitely.
              </p>
            </div>

            {/* 6. Created Date */}
            <div>
              <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">Created Date</label>
              <div className="h-9 w-full rounded-[6px] border border-[#262626]/60 bg-[#0e0e0e] px-3 flex items-center text-[13px] text-[#8c8c8c] tabular-nums">
                {selectedKey?.createdAt ?? '—'}
              </div>
              <p className="text-[12px] text-[#8c8c8c] mt-1">
                Creation timestamp is immutable.
              </p>
            </div>
          </div>
        )}

        {manageTab === 'rotate' && (
          <div className="flex-1 p-5 overflow-y-auto space-y-4">
            <div>
              <h3 className="text-[16px] font-semibold text-white tracking-tight">Rotate Key Secret</h3>
              <p className="text-[13px] text-[#8c8c8c] mt-0.5">
                Generate a fresh cryptographic credential for <span className="text-white font-mono">{selectedKey?.name}</span> while keeping the old secret valid during the grace period.
              </p>
            </div>

            <div>
              <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">Grace Period</label>
              <CustomSelect
                value={gracePeriod}
                options={GRACE_OPTIONS}
                onChange={(val) => setGracePeriod(val)}
                menuWidth="w-full"
              />
            </div>

            {rotatedSecret && (
              <div className="rounded-[6px] border border-[#1a3a1a] bg-[#040e04] p-3 space-y-1">
                <div className="text-[11px] text-[#30a46c] uppercase tracking-wide font-medium">New Secret — copy now, won't be shown again</div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-[12px] text-[#30a46c] font-mono break-all">{rotatedSecret}</code>
                  <button
                    type="button"
                    onClick={() => { navigator.clipboard.writeText(rotatedSecret); }}
                    className="shrink-0 text-[#8c8c8c] hover:text-white transition-colors cursor-pointer"
                    title="Copy Secret"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            <div>
              <button
                type="button"
                onClick={handleRotateKey}
                className="h-8 px-3 rounded-[6px] text-[13px] font-medium border border-[#262626] bg-[#161616] text-[#cccccc] hover:text-white hover:border-[#383838] transition-colors inline-flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Generate New Secret</span>
              </button>
            </div>
          </div>
        )}

        {manageTab === 'danger' && (
          <div className="flex-1 p-5 overflow-y-auto">
            <div className="rounded-[8px] border border-[#3a1515] bg-[#0e0404] p-4">
              <div className="text-[13px] font-medium text-[#e5484d] mb-1">Revoke API Key</div>
              <div className="text-[12px] text-[#8c8c8c] mb-4">
                Permanently revoke <span className="text-white font-mono">{selectedKey?.name}</span>. All requests using this key will immediately fail.
              </div>
              <button
                type="button"
                onClick={() => setConfirmRevokeOpen(true)}
                className="group relative flex shrink-0 items-center justify-center h-8 px-3.5 rounded-[8px] font-medium text-white shadow-xs outline-none cursor-pointer overflow-hidden ring-1 ring-[#be123c] bg-[#e11d48] font-sans text-[13px]"
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-[#f43f5e] to-[#e11d48] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]"
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black opacity-0 group-hover:opacity-15 transition-opacity duration-200"
                />
                <span className="relative flex items-center gap-1.5 font-sans">
                  Revoke Key
                </span>
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        {manageTab === 'edit' && (
          <div className="p-4 bg-[#0e0e0e] flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={() => setManageOpen(false)}
              className="inline-flex items-center justify-center h-9 px-4 rounded-[8px] text-[14px] font-medium text-[#cccccc] hover:text-white bg-transparent hover:bg-[#161616] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer font-sans"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!isModified}
              onClick={handleSaveEdit}
              className="group relative flex shrink-0 items-center justify-center h-9 px-4 rounded-[8px] font-medium text-white shadow-xs outline-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed overflow-hidden ring-1 ring-[#1d4ed8] bg-[#2563eb] font-sans text-[14px]"
            >
              <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-[#3b82f6] to-[#2563eb] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]" />
              <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black opacity-0 group-hover:opacity-15 transition-opacity duration-200" />
              <span className="relative flex items-center gap-1.5 font-sans">
                Save
              </span>
            </button>
          </div>
        )}
      </SlideOver>

      {/* Revoke API Key Confirmation Dialog */}
      <ConfirmDialog
        isOpen={confirmRevokeOpen}
        onClose={() => setConfirmRevokeOpen(false)}
        onConfirm={() => {
          if (selectedKey) {
            setKeys(keys.filter((item) => item.name !== selectedKey.name));
          }
          setConfirmRevokeOpen(false);
          setManageOpen(false);
        }}
        title="Revoke API Key"
        description={
          <>
            Permanently revoke API key{' '}
            <span className="font-mono text-white font-medium">{selectedKey?.name}</span>?
            All client applications and services using this secret will immediately fail authorization.
          </>
        }
        confirmLabel="Revoke Key"
        cancelLabel="Cancel"
      />
    </div>
  );
}
