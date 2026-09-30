import React, { useState } from 'react';
import { ApiKey } from '../types';
import { DataTable, Column } from '../components/shared/DataTable';
import { SlideOver } from '../components/ui/SlideOver';
import { Button } from '../components/ui/Button';
import { Key, Plus, RefreshCw, Copy, Check, Shield, AlertTriangle } from 'lucide-react';

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
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  // Edit Key SlideOver State
  const [editOpen, setEditOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState<ApiKey | null>(null);
  const [editRole, setEditRole] = useState('admin');
  const [editRate, setEditRate] = useState(10000);

  // Rotate Key SlideOver State
  const [rotateOpen, setRotateOpen] = useState(false);
  const [rotateKey, setRotateKey] = useState<ApiKey | null>(null);
  const [rotatedSecret, setRotatedSecret] = useState<string | null>(null);
  const [gracePeriod, setGracePeriod] = useState('24h');

  function handleCreateKey() {
    if (!newName.trim()) return;
    const generatedSecret = `axk_live_${Math.random().toString(36).substring(2, 15)}_${Math.random().toString(36).substring(2, 10)}`;
    const newKeyObj: ApiKey = {
      name: newName.trim(),
      role: newRole,
      rateLimit: newRateLimit,
      status: 'Active',
      expiresAt: null,
      createdAt: new Date().toISOString().split('T')[0],
    };
    setKeys([...keys, newKeyObj]);
    setCreatedSecret(generatedSecret);
  }

  function handleSaveEdit() {
    if (!selectedKey) return;
    setKeys(
      keys.map((k) =>
        k.name === selectedKey.name ? { ...k, role: editRole, rateLimit: editRate } : k
      )
    );
    setEditOpen(false);
  }

  function handleRotateKey() {
    const freshSecret = `axk_rot_${Math.random().toString(36).substring(2, 15)}_${Math.random().toString(36).substring(2, 10)}`;
    setRotatedSecret(freshSecret);
  }

  const columns: Column<ApiKey>[] = [
    {
      id: 'name',
      header: 'Key Identifier',
      accessorKey: 'name',
      isSortable: true,
      width: 220,
      cell: (row) => (
        <div className="flex items-center gap-2.5">
          <Key className="w-4 h-4 text-[#8c8c8c] shrink-0" />
          <span className="font-medium text-white text-[14px]">{row.name}</span>
        </div>
      ),
    },
    {
      id: 'role',
      header: 'Assigned Role',
      accessorKey: 'role',
      width: 170,
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
      className: 'px-3',
      cell: (row) => (
        <span className="tabular-nums text-[14px] text-[#8c8c8c] font-normal">
          {row.rateLimit.toLocaleString()} req/min
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      accessorKey: 'status',
      width: 130,
      className: 'px-3',
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
      id: 'createdAt',
      header: 'Created Date',
      accessorKey: 'createdAt',
      width: 140,
      className: 'px-3',
      cell: (row) => (
        <span className="tabular-nums text-[14px] text-[#8c8c8c] font-normal">
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
        <div className="flex items-center justify-end gap-2 w-full">
          <button
            type="button"
            onClick={() => {
              setSelectedKey(row);
              setEditRole(row.role);
              setEditRate(row.rateLimit);
              setEditOpen(true);
            }}
            className="inline-flex items-center justify-center h-7 px-3 rounded-[6px] text-[13px] font-medium leading-none text-white hover:text-white bg-transparent hover:bg-[#1a1a1a] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer shrink-0"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => {
              setRotateKey(row);
              setRotatedSecret(null);
              setRotateOpen(true);
            }}
            className="inline-flex items-center justify-center h-7 px-3 rounded-[6px] text-[13px] font-medium leading-none text-[#cccccc] hover:text-white bg-transparent hover:bg-[#161616] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer shrink-0"
          >
            Rotate
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm(`Revoke API key "${row.name}"?`)) {
                setKeys(keys.filter((item) => item.name !== row.name));
              }
            }}
            className="inline-flex items-center justify-center h-7 px-2.5 rounded-[6px] text-[13px] font-medium leading-none text-[#8c8c8c] hover:text-[#e5484d] bg-transparent hover:bg-[#161616] border border-transparent hover:border-[#262626] transition-colors cursor-pointer shrink-0"
          >
            Revoke
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
        <div className="flex-1 p-5 overflow-y-auto space-y-4">
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
                <label className="block text-[12px] font-medium text-[#cccccc] mb-1.5">Key Identifier Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. payment_service_prod"
                  className="h-9 w-full rounded-md border border-[#262626] bg-[#121212] px-3 text-[13px] text-white focus:outline-none focus:border-[#3b82f6]"
                />
              </div>

              <div>
                <label className="block text-[12px] font-medium text-[#cccccc] mb-1.5">Assigned RBAC Role</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  className="h-9 w-full rounded-md border border-[#262626] bg-[#121212] px-3 text-[13px] text-white focus:outline-none focus:border-[#3b82f6]"
                >
                  <option value="admin">admin (Full Root Privileges)</option>
                  <option value="readwrite">readwrite (CRUD Access)</option>
                  <option value="readonly">readonly (SELECT Queries Only)</option>
                </select>
              </div>

              <div>
                <label className="block text-[12px] font-medium text-[#cccccc] mb-1.5">Rate Limit Threshold (req/min)</label>
                <input
                  type="number"
                  value={newRateLimit}
                  onChange={(e) => setNewRateLimit(Number(e.target.value))}
                  className="h-9 w-full rounded-md border border-[#262626] bg-[#121212] px-3 text-[13px] text-white focus:outline-none focus:border-[#3b82f6] tabular-nums"
                />
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-[#222222] bg-[#000000] flex items-center justify-end gap-2.5">
          {createdSecret ? (
            <Button variant="primary" size="sm" onClick={() => setCreateOpen(false)}>
              Done
            </Button>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={handleCreateKey}>
                Generate Secret
              </Button>
            </>
          )}
        </div>
      </SlideOver>

      {/* Edit Key SlideOver */}
      <SlideOver
        isOpen={editOpen}
        onClose={() => setEditOpen(false)}
        title={`Edit API Key: ${selectedKey?.name}`}
        subtitle="Adjust permissions or update traffic rate limiting"
      >
        <div className="flex-1 p-5 overflow-y-auto space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-[#cccccc] mb-1.5">RBAC Role</label>
            <select
              value={editRole}
              onChange={(e) => setEditRole(e.target.value)}
              className="h-9 w-full rounded-md border border-[#262626] bg-[#121212] px-3 text-[13px] text-white focus:outline-none focus:border-[#3b82f6]"
            >
              <option value="admin">admin (Full Root Privileges)</option>
              <option value="readwrite">readwrite (CRUD Access)</option>
              <option value="readonly">readonly (SELECT Queries Only)</option>
            </select>
          </div>

          <div>
            <label className="block text-[12px] font-medium text-[#cccccc] mb-1.5">Rate Limit (req/min)</label>
            <input
              type="number"
              value={editRate}
              onChange={(e) => setEditRate(Number(e.target.value))}
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

      {/* Rotate Key SlideOver */}
      <SlideOver
        isOpen={rotateOpen}
        onClose={() => setRotateOpen(false)}
        title={`Rotate Secret: ${rotateKey?.name}`}
        subtitle="Provision a replacement secret with zero-downtime grace transition"
      >
        <div className="flex-1 p-5 overflow-y-auto space-y-4">
          {rotatedSecret ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-[#30a46c]/30 bg-[#30a46c]/10 p-4 space-y-2">
                <span className="text-[13px] font-semibold text-[#30a46c] flex items-center gap-1.5">
                  <Check className="w-4 h-4" />
                  New Secret Provisioned
                </span>
                <p className="text-[12px] text-[#cccccc]">
                  Copy this replacement secret. Both old and new secrets will authenticate during the {gracePeriod} grace window.
                </p>
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="text"
                    readOnly
                    value={rotatedSecret}
                    className="h-9 flex-1 rounded-md border border-[#262626] bg-[#0c0c0c] px-3 font-mono text-[12px] text-[#3b82f6] select-all"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(rotatedSecret);
                      alert('Rotated secret copied!');
                    }}
                  >
                    Copy
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border border-[#f59e0b]/30 bg-[#f59e0b]/10 p-3 text-[12px] text-[#f59e0b] flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  Rotating will invalidate the existing secret after the selected grace period expires. Ensure client applications update their credentials.
                </span>
              </div>

              <div>
                <label className="block text-[12px] font-medium text-[#cccccc] mb-1.5">Dual-Auth Grace Period</label>
                <select
                  value={gracePeriod}
                  onChange={(e) => setGracePeriod(e.target.value)}
                  className="h-9 w-full rounded-md border border-[#262626] bg-[#121212] px-3 text-[13px] text-white focus:outline-none focus:border-[#3b82f6]"
                >
                  <option value="0">Immediate Invalidation (0s)</option>
                  <option value="1h">1 Hour Window</option>
                  <option value="24h">24 Hours (Recommended)</option>
                  <option value="7d">7 Days</option>
                </select>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-[#222222] bg-[#000000] flex items-center justify-end gap-2.5">
          {rotatedSecret ? (
            <Button variant="primary" size="sm" onClick={() => setRotateOpen(false)}>
              Done
            </Button>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={() => setRotateOpen(false)}>
                Cancel
              </Button>
              <Button variant="danger" size="sm" onClick={handleRotateKey}>
                Rotate Now
              </Button>
            </>
          )}
        </div>
      </SlideOver>
    </div>
  );
}
