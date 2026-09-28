import React, { useState, useEffect } from 'react';
import { api, type ApiKeyRecord, type RoleRecord } from '../api';
import { toast } from '../components/ui/Toast';
import { confirmAction } from '../components/ui/ConfirmDialog';
import { Key, Plus, Search, RotateCw, Trash2, Copy, Check, AlertCircle, X, ShieldAlert } from 'lucide-react';

export const ApiKeys: React.FC = () => {
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // Create Modal states
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [rateLimit, setRateLimit] = useState(0);
  const [secret, setSecret] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // Token Reveal Modal states
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [hasCopied, setHasCopied] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      const [k, r] = await Promise.all([api.getKeys(), api.getRoles()]);
      setKeys(k);
      setRoles(r);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to load API keys');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!name.trim()) {
      setFormError('Key name is required.');
      return;
    }

    try {
      setSubmitting(true);
      const res = await api.createKey({
        name: name.trim(),
        role: role || undefined,
        rate_limit: rateLimit > 0 ? rateLimit : undefined,
        secret: secret.trim() || undefined,
      });
      toast.success(`Key '${name}' created successfully`);
      setIsCreateOpen(false);
      setName('');
      setSecret('');
      setRole('');
      setRateLimit(0);
      setRevealedToken(res.token_header);
      loadData();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to generate key');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRotate = (keyName: string) => {
    confirmAction({
      title: `Rotate Secret for '${keyName}'`,
      message: `Rotating the secret invalidates the existing token immediately. External applications using the current token will receive 401 Unauthorized until updated.`,
      confirmText: 'Rotate Secret',
      danger: true,
      onConfirm: async () => {
        try {
          const res = await api.rotateKey(keyName);
          toast.success(`Key '${keyName}' secret rotated`);
          setRevealedToken(res.token);
          loadData();
        } catch (err: unknown) {
          toast.error(err instanceof Error ? err.message : 'Rotation failed');
        }
      },
    });
  };

  const handleDelete = (keyName: string) => {
    confirmAction({
      title: `Revoke API Key '${keyName}'`,
      message: `Are you sure you want to permanently revoke this key? Any requests authenticated with this token will immediately fail.`,
      confirmText: 'Revoke Key',
      danger: true,
      onConfirm: async () => {
        try {
          await api.deleteKey(keyName);
          toast.success(`Key '${keyName}' revoked`);
          loadData();
        } catch (err: unknown) {
          toast.error(err instanceof Error ? err.message : 'Revocation failed');
        }
      },
    });
  };

  const copyToken = async () => {
    if (!revealedToken) return;
    try {
      await navigator.clipboard.writeText(revealedToken);
      setHasCopied(true);
      setTimeout(() => setHasCopied(false), 2000);
      toast.info('Token copied to clipboard');
    } catch {
      toast.error('Failed to copy token to clipboard');
    }
  };

  const filtered = keys.filter(
    (k) =>
      k.name.toLowerCase().includes(search.toLowerCase()) ||
      (k.role_name && k.role_name.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#222222] pb-5">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">API Keys & Tokens</h1>
          <p className="text-xs text-[#8c8c8c] mt-1">
            Manage BLAKE3-hashed machine credentials, per-key rate limits, and RBAC role bindings.
          </p>
        </div>
        <button
          onClick={() => setIsCreateOpen(true)}
          className="h-8 px-3.5 rounded text-xs font-semibold bg-[#f38020] hover:bg-[#fa8c16] text-black transition-colors flex items-center gap-1.5 self-start sm:self-auto"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Create API Key</span>
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
            placeholder="Search API keys..."
            className="w-full h-8 pl-8 pr-3 rounded bg-[#0e0e0e] border border-[#222222] text-xs text-white placeholder-[#666666] focus:border-[#f38020] focus:outline-none"
          />
        </div>
        <span className="text-xs text-[#666666] font-mono">
          {keys.length} active key{keys.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Keys DataTable */}
      <div className="rounded-lg border border-[#222222] bg-[#0c0c0c] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#141414] text-[#8c8c8c] border-b border-[#222222]">
              <tr>
                <th className="px-4 py-3 font-medium">Key Identifier</th>
                <th className="px-4 py-3 font-medium">Assigned Role</th>
                <th className="px-4 py-3 font-medium">Rate Limit</th>
                <th className="px-4 py-3 font-medium">Expires</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e1e1e]">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-[#666666]">
                    Loading API keys...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-[#666666]">
                    {search ? `No keys match "${search}".` : 'No API keys registered yet. Click "Create API Key" to issue one.'}
                  </td>
                </tr>
              ) : (
                filtered.map((k) => (
                  <tr key={k.name} className="hover:bg-[#141414] transition-colors">
                    <td className="px-4 py-3 font-mono font-medium text-white">
                      <div className="flex items-center gap-2">
                        <Key className="w-3.5 h-3.5 text-[#f38020]" />
                        <span>{k.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {k.role_name ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono bg-[#141414] border border-[#262626] text-[#f38020]">
                          {k.role_name}
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono bg-[#141414] border border-[#262626] text-[#8c8c8c]">
                          superadmin
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-[#8c8c8c]">
                      {k.rate_limit > 0 ? `${k.rate_limit} req/min` : 'global'}
                    </td>
                    <td className="px-4 py-3 font-mono text-[#8c8c8c]">
                      {k.expires_at ? new Date(k.expires_at * 1000).toLocaleDateString() : 'never'}
                    </td>
                    <td className="px-4 py-3 font-mono text-[#8c8c8c]">
                      {new Date(k.created_at * 1000).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1.5 justify-end">
                        <button
                          onClick={() => handleRotate(k.name)}
                          className="h-7 px-2.5 rounded bg-[#141414] hover:bg-[#1a1a1a] border border-[#262626] text-[11px] font-medium text-[#cccccc] hover:text-white transition-colors flex items-center gap-1"
                          title="Rotate secret key"
                        >
                          <RotateCw className="w-3 h-3 text-[#f38020]" />
                          <span>Rotate</span>
                        </button>
                        <button
                          onClick={() => handleDelete(k.name)}
                          className="h-7 w-7 rounded bg-[#141414] hover:bg-rose-500/20 border border-[#262626] hover:border-rose-500/30 text-[#8c8c8c] hover:text-rose-400 transition-colors flex items-center justify-center"
                          title="Revoke key"
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

      {/* Create Key Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-[480px] rounded-lg border border-[#262626] bg-[#0c0c0c] p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4 text-[#f38020]" />
                <h3 className="text-sm font-semibold text-white">Generate New API Key</h3>
              </div>
              <button
                onClick={() => setIsCreateOpen(false)}
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
                  Key Name <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. backend-app, analytics-service, mobile-client"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full h-8 px-3 rounded bg-[#141414] border border-[#262626] text-xs text-white placeholder-[#555555] focus:border-[#f38020] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#cccccc] mb-1">
                  Assigned Role
                </label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full h-8 px-2.5 rounded bg-[#141414] border border-[#262626] text-xs text-white focus:border-[#f38020] focus:outline-none"
                >
                  <option value="">Full Admin (Unrestricted)</option>
                  {roles.map((r) => (
                    <option key={r.name} value={r.name}>
                      {r.name} {r.description ? `— ${r.description}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#cccccc] mb-1">
                  Rate Limit (req/min, 0 for default)
                </label>
                <input
                  type="number"
                  min="0"
                  max="100000"
                  value={rateLimit}
                  onChange={(e) => setRateLimit(parseInt(e.target.value, 10) || 0)}
                  className="w-full h-8 px-3 rounded bg-[#141414] border border-[#262626] text-xs text-white focus:border-[#f38020] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#cccccc] mb-1">
                  Custom Secret (Optional, auto-generated if left empty)
                </label>
                <input
                  type="password"
                  placeholder="Leave empty for 32-byte cryptographically secure secret"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  className="w-full h-8 px-3 rounded bg-[#141414] border border-[#262626] text-xs text-white placeholder-[#555555] focus:border-[#f38020] focus:outline-none font-mono"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#222222]">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
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
                  <span>Generate Key</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Secret Token Reveal Modal */}
      {revealedToken && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-[540px] rounded-lg border border-[#262626] bg-[#0c0c0c] p-6 shadow-2xl text-left">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-emerald-400">
                <Check className="w-4 h-4" />
                <h3 className="text-sm font-semibold text-white">API Token Ready</h3>
              </div>
              <button
                onClick={() => setRevealedToken(null)}
                className="text-[#666666] hover:text-white p-1 rounded transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 rounded bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 flex items-start gap-2.5 mb-4">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">Copy this token now.</span> For security, Axiom stores only the BLAKE3 hash of this secret and cannot reveal it again.
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-mono text-[#8c8c8c] mb-1">
                  X-Axiom-Key Header Token:
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={revealedToken}
                    className="w-full h-9 px-3 rounded bg-[#141414] border border-[#262626] text-xs font-mono text-white select-all focus:outline-none"
                  />
                  <button
                    onClick={copyToken}
                    className="h-9 px-3 rounded bg-[#1c1c1c] hover:bg-[#252525] border border-[#2c2c2c] text-xs font-medium text-white transition-colors flex items-center gap-1.5 shrink-0"
                  >
                    {hasCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{hasCopied ? 'Copied!' : 'Copy'}</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-mono text-[#8c8c8c] mb-1">
                  Example Curl Request:
                </label>
                <pre className="p-3 rounded bg-[#101010] border border-[#222222] text-[11px] font-mono text-[#a1a1a1] overflow-x-auto">
{`curl -X POST http://localhost:4500/api/v1/db/main_db/query \\
  -H "X-Axiom-Key: ${revealedToken}" \\
  -H "Content-Type: application/json" \\
  -d '{"sql": "SELECT 1;"}'`}
                </pre>
              </div>
            </div>

            <div className="flex justify-end pt-4 border-t border-[#222222] mt-5">
              <button
                onClick={() => setRevealedToken(null)}
                className="h-8 px-4 rounded text-xs font-semibold bg-[#f38020] hover:bg-[#fa8c16] text-black transition-colors"
              >
                I Have Saved This Secret
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
