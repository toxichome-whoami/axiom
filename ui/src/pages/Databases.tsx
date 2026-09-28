import React, { useState, useEffect } from 'react';
import { api, type DatabaseRecord } from '../api';
import { toast } from '../components/ui/Toast';
import { confirmAction } from '../components/ui/ConfirmDialog';
import { Database, Plus, Search, Trash2, CheckCircle2, AlertCircle, X } from 'lucide-react';

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
        <button
          onClick={() => setIsModalOpen(true)}
          className="h-8 px-3.5 rounded text-xs font-semibold bg-[#f38020] hover:bg-[#fa8c16] text-black transition-colors flex items-center gap-1.5 self-start sm:self-auto"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Connect Database</span>
        </button>
      </div>

      {/* Filter / Search Bar */}
      <div className="flex items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="w-3.5 h-3.5 text-[#666666] absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search databases..."
            className="w-full h-8 pl-8 pr-3 rounded bg-[#0e0e0e] border border-[#222222] text-xs text-white placeholder-[#666666] focus:border-[#f38020] focus:outline-none"
          />
        </div>
        <span className="text-xs text-[#666666] font-mono">
          {databases.length} configured pool{databases.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Databases DataTable */}
      <div className="rounded-lg border border-[#222222] bg-[#0c0c0c] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#141414] text-[#8c8c8c] border-b border-[#222222]">
              <tr>
                <th className="px-4 py-3 font-medium">Database Alias</th>
                <th className="px-4 py-3 font-medium">Engine</th>
                <th className="px-4 py-3 font-medium">Connection URL</th>
                <th className="px-4 py-3 font-medium">Pool Min/Max</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e1e1e]">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-[#666666]">
                    Loading database pools...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-[#666666]">
                    {search ? `No databases match "${search}".` : 'No databases configured yet. Click "Connect Database" to add one.'}
                  </td>
                </tr>
              ) : (
                filtered.map((db) => (
                  <tr key={db.alias} className="hover:bg-[#141414] transition-colors">
                    <td className="px-4 py-3 font-mono font-medium text-white">
                      <div className="flex items-center gap-2">
                        <Database className="w-3.5 h-3.5 text-[#f38020]" />
                        <span>{db.alias}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono bg-[#141414] border border-[#262626] text-[#3b82f6]">
                        {db.engine.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-[#8c8c8c]">
                      {db.url || '●●●●●●●● (masked)'}
                    </td>
                    <td className="px-4 py-3 font-mono text-[#8c8c8c]">
                      {db.pool_min} / {db.pool_max} conn
                    </td>
                    <td className="px-4 py-3 font-mono text-[#8c8c8c]">
                      {new Date(db.created_at * 1000).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1.5 justify-end">
                        <button
                          onClick={() => handleTest(db.alias)}
                          disabled={testingAlias === db.alias}
                          className="h-7 px-2 rounded bg-[#141414] hover:bg-[#1a1a1a] border border-[#262626] text-[11px] font-medium text-[#cccccc] hover:text-white transition-colors flex items-center gap-1"
                          title="Test live connection"
                        >
                          <CheckCircle2 className={`w-3 h-3 text-emerald-400 ${testingAlias === db.alias ? 'animate-spin' : ''}`} />
                          <span>Test</span>
                        </button>
                        <button
                          onClick={() => handleDelete(db.alias)}
                          className="h-7 w-7 rounded bg-[#141414] hover:bg-rose-500/20 border border-[#262626] hover:border-rose-500/30 text-[#8c8c8c] hover:text-rose-400 transition-colors flex items-center justify-center"
                          title="Disconnect database"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Connect Database Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-[500px] rounded-lg border border-[#262626] bg-[#0c0c0c] p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-[#f38020]" />
                <h3 className="text-sm font-semibold text-white">Connect New Database</h3>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-[#666666] hover:text-white p-1 rounded transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

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
                <input
                  type="text"
                  required
                  placeholder="e.g. main_db, analytics, warehouse"
                  value={alias}
                  onChange={(e) => setAlias(e.target.value)}
                  className="w-full h-8 px-3 rounded bg-[#141414] border border-[#262626] text-xs text-white placeholder-[#555555] focus:border-[#f38020] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#cccccc] mb-1">
                  Database Engine
                </label>
                <select
                  value={engine}
                  onChange={(e) => setEngine(e.target.value)}
                  className="w-full h-8 px-2.5 rounded bg-[#141414] border border-[#262626] text-xs text-white focus:border-[#f38020] focus:outline-none"
                >
                  <option value="postgres">PostgreSQL</option>
                  <option value="mysql">MySQL / MariaDB</option>
                  <option value="mssql">Microsoft SQL Server</option>
                  <option value="libsql">SQLite / LibSQL</option>
                  <option value="clickhouse">ClickHouse</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#cccccc] mb-1">
                  Connection URL <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. postgres://user:password@localhost:5432/dbname"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="w-full h-8 px-3 rounded bg-[#141414] border border-[#262626] text-xs text-white placeholder-[#555555] focus:border-[#f38020] focus:outline-none font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#cccccc] mb-1">
                    Min Pool Connections
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={poolMin}
                    onChange={(e) => setPoolMin(parseInt(e.target.value, 10) || 2)}
                    className="w-full h-8 px-3 rounded bg-[#141414] border border-[#262626] text-xs text-white focus:border-[#f38020] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#cccccc] mb-1">
                    Max Pool Connections
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="200"
                    value={poolMax}
                    onChange={(e) => setPoolMax(parseInt(e.target.value, 10) || 10)}
                    className="w-full h-8 px-3 rounded bg-[#141414] border border-[#262626] text-xs text-white focus:border-[#f38020] focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#222222]">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="h-8 px-3.5 rounded text-xs font-medium text-[#cccccc] hover:text-white bg-[#141414] hover:bg-[#1a1a1a] border border-[#262626] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="h-8 px-3.5 rounded text-xs font-semibold bg-[#f38020] hover:bg-[#fa8c16] text-black transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  {submitting && <span className="animate-spin w-3 h-3 border-2 border-black border-t-transparent rounded-full" />}
                  <span>Save Connection</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
