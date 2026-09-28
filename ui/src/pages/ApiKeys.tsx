/*
 * API Keys and Tokens management page built with Shadcn UI primitives.
 * Owned by: ui/pages
 * Key deps: ../components/ui, ../api
 * Invariants: Secure token generation, BLAKE3 hash storage display, secret rotation confirmation.
 */

import React, { useState, useEffect } from 'react';
import { api, type ApiKeyRecord, type RoleRecord } from '../api';
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
import { Key, Plus, Search, RotateCw, Trash2, Copy, Check, AlertCircle, ShieldAlert } from 'lucide-react';

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

  const safeKeys = Array.isArray(keys) ? keys : [];
  const filtered = safeKeys.filter(
    (k) =>
      (k.name && k.name.toLowerCase().includes(search.toLowerCase())) ||
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
        <Button
          onClick={() => setIsCreateOpen(true)}
          className="bg-[#f38020] hover:bg-[#fa8c16] text-black font-semibold border-none self-start sm:self-auto"
          size="sm"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Create API Key</span>
        </Button>
      </div>

      {/* Filter / Search Bar */}
      <div className="flex items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="w-3.5 h-3.5 text-[#666666] absolute left-3 top-2.5" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search API keys..."
            className="pl-8"
          />
        </div>
        <span className="text-xs text-[#666666] font-mono">
          {keys.length} active key{keys.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Keys DataTable */}
      <div className="rounded-lg border border-[#222222] bg-[#0c0c0c] overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Key Identifier</TableHead>
              <TableHead>Assigned Role</TableHead>
              <TableHead>Rate Limit</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-[#666666]">
                  Loading API keys...
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-[#666666]">
                  {search ? `No keys match "${search}".` : 'No API keys registered yet. Click "Create API Key" to issue one.'}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((k) => (
                <TableRow key={k.name}>
                  <TableCell className="font-mono font-medium text-white">
                    <div className="flex items-center gap-2">
                      <Key className="w-3.5 h-3.5 text-[#f38020]" />
                      <span>{k.name}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {k.role_name ? (
                      <Badge variant="orange">
                        {k.role_name}
                      </Badge>
                    ) : (
                      <Badge variant="outline">
                        superadmin
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-[#8c8c8c]">
                    {k.rate_limit > 0 ? `${k.rate_limit} req/min` : 'global'}
                  </TableCell>
                  <TableCell className="font-mono text-[#8c8c8c]">
                    {k.expires_at ? new Date(k.expires_at * 1000).toLocaleDateString() : 'never'}
                  </TableCell>
                  <TableCell className="font-mono text-[#8c8c8c]">
                    {new Date(k.created_at * 1000).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-1.5 justify-end">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleRotate(k.name)}
                        title="Rotate secret key"
                      >
                        <RotateCw className="w-3 h-3 text-[#f38020]" />
                        <span>Rotate</span>
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => handleDelete(k.name)}
                        className="hover:border-rose-500/40 hover:bg-rose-950/20 hover:text-rose-400"
                        title="Revoke key"
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

      {/* Create Key Dialog */}
      <Dialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Create Machine API Key"
        description="Issue an authentication token for applications connecting to the Data API."
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
              Key Name <span className="text-rose-400">*</span>
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. backend_service"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#cccccc] mb-1">Attached Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full h-9 px-3 rounded-md bg-[#0c0c0c] border border-[#262626] text-xs text-white focus:border-[#3b82f6] focus:outline-none"
              >
                <option value="">No Role (Admin)</option>
                {roles.map((r) => (
                  <option key={r.name} value={r.name}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#cccccc] mb-1">Rate Limit (req/min)</label>
              <Input
                type="number"
                min={0}
                value={rateLimit}
                onChange={(e) => setRateLimit(parseInt(e.target.value) || 0)}
                placeholder="0 = inherit global"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#cccccc] mb-1">
              Custom Secret (Optional)
            </label>
            <Input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="Leave blank to auto-generate secure secret"
            />
            <p className="text-[11px] text-[#666666] mt-1">
              If omitted, a cryptographically secure 64-character token is generated.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#1e1e1e]">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsCreateOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              isLoading={submitting}
            >
              Generate Key
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Token Reveal Dialog */}
      <Dialog
        isOpen={!!revealedToken}
        onClose={() => setRevealedToken(null)}
        title="Token Generated Successfully"
        description="Store this token securely now. It will never be displayed in plaintext again."
      >
        <div className="p-3 rounded-md bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 flex items-start gap-2 mb-4">
          <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Axiom stores only the one-way BLAKE3 hash of this secret. If you lose this token, you must rotate it.
          </span>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-[11px] uppercase tracking-wider font-mono text-[#8c8c8c] mb-1">
              X-Axiom-Key Header Value
            </label>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={revealedToken || ''}
                className="font-mono text-xs select-all text-emerald-400 bg-[#080808]"
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={copyToken}
                className="shrink-0"
              >
                {hasCopied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end pt-4 border-t border-[#1e1e1e] mt-4">
          <Button
            size="sm"
            onClick={() => setRevealedToken(null)}
          >
            I Have Saved My Token
          </Button>
        </div>
      </Dialog>
    </div>
  );
};
