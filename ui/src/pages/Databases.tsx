/*
 * Databases page managed via Shadcn UI primitives.
 * Owned by: ui/pages
 * Key deps: ../components/ui, ../api
 * Invariants: Unboxed safe array iteration, real-time testing, modal creation dialog.
 */

import React, { useState, useEffect } from 'react';
import { api, type DatabaseRecord } from '../api';
import {
  Button,
  Badge,
  Input,
  Dialog,
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  toast,
  confirmAction,
} from '../components/ui';
import { Database, Plus, Search, Trash2, CheckCircle2, AlertCircle } from 'lucide-react';

export const Databases: React.FC = () => {
  const [databases, setDatabases] = useState<DatabaseRecord[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [testingAlias, setTestingAlias] = useState<string | null>(null);

  // Form states
  const [alias, setAlias] = useState('');
  const [url, setUrl] = useState('');
  const [engine, setEngine] = useState('postgres');
  const [poolMin, setPoolMin] = useState(2);
  const [poolMax, setPoolMax] = useState(10);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const loadDatabases = async () => {
    try {
      setLoading(true);
      const res = await api.getDatabases();
      setDatabases(res);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to load databases');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDatabases();
  }, []);

  const handleTest = async (dbAlias: string) => {
    try {
      setTestingAlias(dbAlias);
      const res = await api.testDatabase(dbAlias);
      if (res.status === 'healthy' || res.status === 'ok') {
        toast.success(`Connected to '${dbAlias}' (${res.dialect})`);
      } else {
        toast.warn(`Database '${dbAlias}': ${res.message}`);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Database probe failed');
    } finally {
      setTestingAlias(null);
    }
  };

  const handleDelete = (dbAlias: string) => {
    confirmAction({
      title: `Delete Database '${dbAlias}'`,
      message: `Are you sure you want to disconnect '${dbAlias}'? Any applications or keys bound to this alias will no longer be able to run queries against it.`,
      confirmText: 'Disconnect Database',
      danger: true,
      onConfirm: async () => {
        try {
          await api.deleteDatabase(dbAlias);
          toast.success(`Database '${dbAlias}' disconnected`);
          loadDatabases();
        } catch (err: unknown) {
          toast.error(err instanceof Error ? err.message : 'Failed to delete database');
        }
      },
    });
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!alias.trim() || !url.trim()) {
      setFormError('Alias and Connection URL are required.');
      return;
    }

    try {
      setSubmitting(true);
      await api.addDatabase({
        alias: alias.trim(),
        url: url.trim(),
        engine,
        pool_min: poolMin,
        pool_max: poolMax,
      });
      toast.success(`Database '${alias}' connected successfully`);
      setIsModalOpen(false);
      setAlias('');
      setUrl('');
      loadDatabases();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to connect database');
    } finally {
      setSubmitting(false);
    }
  };

  const safeDatabases = Array.isArray(databases) ? databases : [];
  const filtered = safeDatabases.filter(
    (d) =>
      (d.alias && d.alias.toLowerCase().includes(search.toLowerCase())) ||
      (d.engine && d.engine.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#222222] pb-5">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Database Pools</h1>
          <p className="text-xs text-[#8c8c8c] mt-1">
            Manage attached upstream SQL databases, dialect connection pools, and health probes.
          </p>
        </div>
        <Button
          onClick={() => setIsModalOpen(true)}
          className="bg-[#f38020] hover:bg-[#fa8c16] text-black font-semibold border-none self-start sm:self-auto"
          size="sm"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Connect Database</span>
        </Button>
      </div>

      {/* Filter / Search Bar */}
      <div className="flex items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="w-3.5 h-3.5 text-[#666666] absolute left-3 top-2.5" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search databases..."
            className="pl-8"
          />
        </div>
        <span className="text-xs text-[#666666] ">
          {databases.length} configured pool{databases.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Databases DataTable */}
      <div className="rounded-lg border border-[#222222] bg-[#0c0c0c] overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Database Alias</TableHead>
              <TableHead>Engine</TableHead>
              <TableHead>Connection URL</TableHead>
              <TableHead>Pool Min/Max</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-[#666666]">
                  Loading database pools...
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-[#666666]">
                  {search ? `No databases match "${search}".` : 'No databases configured yet. Click "Connect Database" to add one.'}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((db) => (
                <TableRow key={db.alias}>
                  <TableCell className=" font-medium text-white">
                    <div className="flex items-center gap-2">
                      <Database className="w-3.5 h-3.5 text-[#f38020]" />
                      <span>{db.alias}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="default">
                      {db.engine.toUpperCase()}
                    </Badge>
                  </TableCell>
                  <TableCell className=" text-[#8c8c8c]">
                    {db.url || '●●●●●●●● (masked)'}
                  </TableCell>
                  <TableCell className=" text-[#8c8c8c]">
                    {db.pool_min} / {db.pool_max} conn
                  </TableCell>
                  <TableCell className=" text-[#8c8c8c]">
                    {db.created_at ? new Date(db.created_at * 1000).toLocaleDateString() : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-1.5 justify-end">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleTest(db.alias)}
                        disabled={testingAlias === db.alias}
                        title="Test live connection"
                      >
                        <CheckCircle2 className={`w-3 h-3 text-emerald-400 ${testingAlias === db.alias ? 'animate-spin' : ''}`} />
                        <span>Test</span>
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => handleDelete(db.alias)}
                        className="hover:border-rose-500/40 hover:bg-rose-950/20 hover:text-rose-400"
                        title="Disconnect database"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Connect Database Dialog */}
      <Dialog
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Connect New Database"
        description="Attach an upstream SQL database pool to the Axiom gateway."
      >
        {formError && (
          <div className="mb-4 p-2.5 rounded bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400 flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[#cccccc] mb-1">
              Database Alias <span className="text-rose-400">*</span>
            </label>
            <Input
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder="e.g. analytics_db"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#cccccc] mb-1">Engine</label>
              <select
                value={engine}
                onChange={(e) => setEngine(e.target.value)}
                className="w-full h-9 px-3 rounded-md bg-[#0c0c0c] border border-[#262626] text-xs text-white focus:border-[#3b82f6] focus:outline-none"
              >
                <option value="postgres">PostgreSQL</option>
                <option value="mysql">MySQL</option>
                <option value="sqlite">SQLite / LibSQL</option>
                <option value="mssql">MSSQL / SQL Server</option>
                <option value="clickhouse">ClickHouse</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#cccccc] mb-1">Pool Min / Max</label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={poolMin}
                  onChange={(e) => setPoolMin(parseInt(e.target.value) || 2)}
                />
                <span className="text-[#666666]">/</span>
                <Input
                  type="number"
                  min={1}
                  max={200}
                  value={poolMax}
                  onChange={(e) => setPoolMax(parseInt(e.target.value) || 10)}
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#cccccc] mb-1">
              Connection URL <span className="text-rose-400">*</span>
            </label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="postgres://user:pass@localhost:5432/dbname"
              required
            />
            <p className="text-[11px] text-[#666666] mt-1">
              Credentials are encrypted and safely isolated in metadata storage.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#1e1e1e]">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              isLoading={submitting}
            >
              Connect Pool
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
};
