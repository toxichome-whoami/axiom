import React, { useState } from 'react';
import { AdminUser } from '../types';
import { DataTable, Column } from '../components/shared/DataTable';
import { Button } from '../components/ui/Button';
import { RefreshCw, CheckCircle2, Terminal, Shield, Copy, Check } from 'lucide-react';

export function Settings() {
  const [admins] = useState<AdminUser[]>([
    {
      username: 'admin',
      email: 'admin@axiom.local',
      createdAt: '2026-09-27',
    },
    {
      username: 'devops_lead',
      email: 'devops@axiom.local',
      createdAt: '2026-09-29',
    },
  ]);

  const [host, setHost] = useState('0.0.0.0');
  const [port, setPort] = useState(4500);
  const [workers, setWorkers] = useState('auto');
  const [bodyLimit, setBodyLimit] = useState('10MB');
  const [mcpStatus, setMcpStatus] = useState('enabled');
  const [statementTimeout, setStatementTimeout] = useState(30);
  const [saveNotice, setSaveNotice] = useState(false);
  const [snapshotNotice, setSnapshotNotice] = useState(false);
  const [copiedCli, setCopiedCli] = useState(false);

  function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    setSaveNotice(true);
    setTimeout(() => {
      setSaveNotice(false);
    }, 2500);
  }

  function handleReloadSnapshot() {
    setSnapshotNotice(true);
    setTimeout(() => {
      setSnapshotNotice(false);
    }, 2500);
  }

  // Exactly 3 Columns: Username, Email, Created Date (No UI Add/Remove)
  const adminColumns: Column<AdminUser>[] = [
    {
      id: 'username',
      header: 'Username',
      accessorKey: 'username',
      width: 220,
      cell: (row) => (
        <div className="flex items-center gap-2.5">
          <Shield className="w-4 h-4 text-[#8c8c8c] shrink-0" />
          <span className="font-medium text-white text-[14px]">{row.username}</span>
        </div>
      ),
    },
    {
      id: 'email',
      header: 'Email',
      accessorKey: 'email',
      isFlex: true,
      className: 'px-3',
      cell: (row) => <span className="text-[14px] text-[#8c8c8c] font-normal">{row.email}</span>,
    },
    {
      id: 'createdAt',
      header: 'Created Date',
      accessorKey: 'createdAt',
      width: 180,
      className: 'px-3',
      cell: (row) => <span className="tabular-nums text-[14px] text-[#8c8c8c] font-normal">{row.createdAt}</span>,
    },
  ];

  return (
    <div className="space-y-6 max-w-[1200px]">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#222222] pb-4">
        <div>
          <h1 className="text-[16px] font-semibold text-white tracking-tight">Settings</h1>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleReloadSnapshot}
        >
          <RefreshCw className="w-3.5 h-3.5 mr-1 text-[#8c8c8c]" />
          Reload Metadata Snapshot
        </Button>
      </div>

      {/* Snapshot Feedback Toast */}
      {snapshotNotice && (
        <div className="rounded-lg border border-[#30a46c]/30 bg-[#30a46c]/10 p-3 text-[12px] text-[#30a46c] font-medium flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          ArcSwap metadata snapshot reloaded. Worker caches updated from axiom.db.
        </div>
      )}

      {/* Section 1: Human Administrator Accounts */}
      <div className="space-y-3">
        <div>
          <h2 className="text-[15px] font-semibold text-white tracking-tight">Administrator Accounts</h2>
          <p className="text-[12px] text-[#8c8c8c] mt-0.5">
            Human operators authorized to access this dashboard. Accounts are managed exclusively via host CLI.
          </p>
        </div>

        {/* 3 Columns Table: Username, Email, Created Date */}
        <DataTable
          columns={adminColumns}
          data={admins}
          ariaLabel="Admin Users Table"
        />

        {/* CLI Management Callout Note Banner */}
        <div className="rounded-lg border border-[#222222] bg-[#0c0c0c] p-4 text-[12px] text-[#8c8c8c] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <span className="text-white font-medium block flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-[#3b82f6]" />
              Host CLI Zero-Trust Policy
            </span>
            <p className="text-[#8c8c8c]">
              To prevent web backdoors, administrator accounts cannot be created or deleted via the UI.
            </p>
            <code className="text-[#3b82f6] font-mono text-[11px] block mt-1">
              axiom user add &lt;username&gt; --email &lt;email&gt;
            </code>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              navigator.clipboard.writeText('axiom user add <username> --email <email>');
              setCopiedCli(true);
              setTimeout(() => setCopiedCli(false), 2000);
            }}
          >
            {copiedCli ? <Check className="w-3.5 h-3.5 text-[#30a46c]" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedCli ? 'Copied' : 'Copy CLI'}</span>
          </Button>
        </div>
      </div>

      {/* Section 2: Gateway Runtime Configuration */}
      <form onSubmit={handleSaveSettings} className="rounded-lg border border-[#222222] bg-[#0e0e0e] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#222222] flex items-center justify-between">
          <div>
            <h2 className="text-[14px] font-semibold text-white">Runtime Daemon Configuration</h2>
            <p className="text-[12px] text-[#8c8c8c] mt-0.5">
              Network listener interface, concurrency limits, and protocol behavior.
            </p>
          </div>
          {saveNotice && (
            <span className="text-[12px] text-[#30a46c] font-medium flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Settings saved
            </span>
          )}
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[12px] font-medium text-[#cccccc] mb-1.5">Listener Host</label>
              <input
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                className="h-9 w-full rounded-md border border-[#262626] bg-[#000000] px-3 font-mono text-[12px] text-white focus:outline-none focus:border-[#3b82f6]"
              />
            </div>

            <div>
              <label className="block text-[12px] font-medium text-[#cccccc] mb-1.5">Listener Port</label>
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                className="h-9 w-full rounded-md border border-[#262626] bg-[#000000] px-3 font-mono text-[12px] text-white focus:outline-none focus:border-[#3b82f6]"
              />
            </div>

            <div>
              <label className="block text-[12px] font-medium text-[#cccccc] mb-1.5">Tokio Worker Threads</label>
              <select
                value={workers}
                onChange={(e) => setWorkers(e.target.value)}
                className="h-9 w-full rounded-md border border-[#262626] bg-[#000000] px-3 text-[12px] text-white focus:outline-none focus:border-[#3b82f6]"
              >
                <option value="auto">Auto (Matches CPU Cores)</option>
                <option value="1">1 Worker (cPanel / current_thread)</option>
                <option value="4">4 Workers (Standard VPS)</option>
                <option value="8">8 Workers (High Throughput)</option>
              </select>
            </div>

            <div>
              <label className="block text-[12px] font-medium text-[#cccccc] mb-1.5">Max Request Body Limit</label>
              <select
                value={bodyLimit}
                onChange={(e) => setBodyLimit(e.target.value)}
                className="h-9 w-full rounded-md border border-[#262626] bg-[#000000] px-3 text-[12px] text-white focus:outline-none focus:border-[#3b82f6]"
              >
                <option value="5MB">5 MB (Conservative)</option>
                <option value="10MB">10 MB (Default WAF Hard Cap)</option>
                <option value="25MB">25 MB (Large Ingestions)</option>
              </select>
            </div>

            <div>
              <label className="block text-[12px] font-medium text-[#cccccc] mb-1.5">Statement Timeout (seconds)</label>
              <input
                type="number"
                value={statementTimeout}
                onChange={(e) => setStatementTimeout(Number(e.target.value))}
                className="h-9 w-full rounded-md border border-[#262626] bg-[#000000] px-3 text-[12px] text-white focus:outline-none focus:border-[#3b82f6] tabular-nums"
              />
            </div>

            <div>
              <label className="block text-[12px] font-medium text-[#cccccc] mb-1.5">MCP Protocol Gateway</label>
              <select
                value={mcpStatus}
                onChange={(e) => setMcpStatus(e.target.value)}
                className="h-9 w-full rounded-md border border-[#262626] bg-[#000000] px-3 text-[12px] text-white focus:outline-none focus:border-[#3b82f6]"
              >
                <option value="enabled">Enabled (POST /mcp/v1)</option>
                <option value="disabled">Disabled (404 Not Found)</option>
              </select>
            </div>
          </div>
        </div>

        <div className="border-t border-[#222222] px-5 py-3.5 bg-[#000000] flex items-center justify-end">
          <Button variant="primary" size="sm" type="submit">
            Save Changes
          </Button>
        </div>
      </form>
    </div>
  );
}
