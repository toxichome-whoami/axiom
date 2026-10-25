/*
 * Modal for creating and managing pre-signed WRITE upload capability tickets for external users/clients.
 * Owned by: ui/pages/storage
 * Key deps: ../../types, ../../api/client, ../../components/ui/Button
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Upload,
  Copy,
  Check,
  Clock,
  AlertTriangle,
  Code2,
  RefreshCw,
  Trash2,
  Ban,
} from 'lucide-react';
import { BlobTicket, CreateBlobTicketResponse } from '../../types';
import { api } from '../../api/client';
import { Button } from '../../components/ui/Button';

export interface CreateUploadLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  namespace: string;
  currentPrefix: string;
}

const TTL_PRESETS = [
  { label: '1 hour', seconds: 3600 },
  { label: '6 hours', seconds: 21600 },
  { label: '24 hours', seconds: 86400 },
  { label: '7 days', seconds: 604800 },
  { label: 'Custom', seconds: 0 },
];

function formatTimeRemaining(expiresAtSeconds?: number | null): { text: string; isExpired: boolean } {
  if (!expiresAtSeconds || isNaN(expiresAtSeconds) || expiresAtSeconds <= 0) {
    return { text: 'Unknown', isExpired: false };
  }
  const now = Math.floor(Date.now() / 1000);
  const diff = expiresAtSeconds - now;
  if (diff <= 0) {
    return { text: 'Expired', isExpired: true };
  }
  const hours = Math.floor(diff / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) {
    const remHours = hours % 24;
    return { text: `${days}d ${remHours}h left`, isExpired: false };
  }
  if (hours > 0) {
    return { text: `${hours}h ${minutes}m left`, isExpired: false };
  }
  return { text: `${minutes}m left`, isExpired: false };
}

export function CreateUploadLinkModal({
  isOpen,
  onClose,
  namespace,
  currentPrefix,
}: CreateUploadLinkModalProps) {
  const [activeTab, setActiveTab] = useState<'create' | 'manage'>('create');
  const [fileName, setFileName] = useState('');
  const [selectedTtl, setSelectedTtl] = useState<number>(3600);
  const [customHours, setCustomHours] = useState<string>('12');

  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [generatedTicket, setGeneratedTicket] = useState<CreateBlobTicketResponse | null>(null);

  const [tickets, setTickets] = useState<BlobTicket[]>([]);
  const [isLoadingTickets, setIsLoadingTickets] = useState(false);
  const [manageError, setManageError] = useState<string | null>(null);
  const [revokingSigs, setRevokingSigs] = useState<Set<string>>(new Set());
  const [deletingSigs, setDeletingSigs] = useState<Set<string>>(new Set());

  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const loadTickets = useCallback(async () => {
    if (!namespace) return;
    setIsLoadingTickets(true);
    setManageError(null);
    try {
      const resp = await api.listBlobTickets(namespace, undefined, true);
      const allTickets: BlobTicket[] = Array.isArray(resp) ? resp : (resp as unknown as { tickets?: BlobTicket[] }).tickets || [];
      // Filter strictly for WRITE operation capability links
      setTickets(allTickets.filter((t) => t.operation === 'WRITE'));
    } catch (err: unknown) {
      setManageError(err instanceof Error ? err.message : 'Failed to load upload links');
    } finally {
      setIsLoadingTickets(false);
    }
  }, [namespace]);

  useEffect(() => {
    if (isOpen) {
      setFileName('');
      setCreateError(null);
      setGeneratedTicket(null);
      setSelectedTtl(3600);
      setCustomHours('12');
      setActiveTab('create');
      loadTickets();
    }
  }, [isOpen, loadTickets]);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => {
      setCopiedKey((prev) => (prev === id ? null : prev));
    }, 2000);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = fileName.trim().replace(/^[/\\]+/, '');
    if (!cleanName) {
      setCreateError('Please enter a destination file name');
      return;
    }

    let ttl = selectedTtl;
    if (ttl === 0) {
      const parsed = parseFloat(customHours);
      if (isNaN(parsed) || parsed <= 0) {
        setCreateError('Please enter a valid duration in hours');
        return;
      }
      ttl = Math.round(parsed * 3600);
    }

    if (ttl < 60 || ttl > 86400 * 30) {
      setCreateError('Duration must be between 1 minute and 30 days');
      return;
    }

    const fullKey = `${currentPrefix}${cleanName}`;

    setIsCreating(true);
    setCreateError(null);

    try {
      const res = await api.createBlobTicket(namespace, fullKey, 'WRITE', ttl);
      setGeneratedTicket(res);
      loadTickets();
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Failed to generate upload link');
    } finally {
      setIsCreating(false);
    }
  };

  const handleRevoke = async (signature: string) => {
    setRevokingSigs((prev) => new Set(prev).add(signature));
    try {
      await api.revokeBlobTicket(namespace, signature);
      await loadTickets();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to revoke upload link');
    } finally {
      setRevokingSigs((prev) => {
        const next = new Set(prev);
        next.delete(signature);
        return next;
      });
    }
  };

  const handleDelete = async (signature: string) => {
    if (
      !window.confirm(
        'Are you sure you want to delete this upload link? Once deleted, any client attempting to upload with it will be rejected.'
      )
    ) {
      return;
    }
    setDeletingSigs((prev) => new Set(prev).add(signature));
    try {
      await api.deleteBlobTicket(namespace, signature);
      await loadTickets();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to delete upload link');
    } finally {
      setDeletingSigs((prev) => {
        const next = new Set(prev);
        next.delete(signature);
        return next;
      });
    }
  };

  if (!isOpen) return null;

  const fullUploadUrl = generatedTicket
    ? `${window.location.origin}${generatedTicket.url || ''}`
    : '';

  const cleanTargetName = fileName.trim().replace(/^[/\\]+/, '') || 'my-file.bin';
  const curlUploadSnippet = fullUploadUrl
    ? `curl -X PUT --upload-file "${cleanTargetName}" "${fullUploadUrl}"`
    : '';

  const activeTickets = tickets.filter((t) => !t.revoked && !formatTimeRemaining(t.expires_at).isExpired);
  const activeTicketCount = activeTickets.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[540px] rounded-[8px] bg-[#0c0c0c] border border-[#262626] shadow-2xl overflow-hidden font-sans flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1f1f1f]">
          <div className="flex items-center gap-2">
            <Upload className="w-4 h-4 text-blue-400" />
            <h3 className="text-[15px] font-sans font-medium text-white tracking-tight">
              Pre-Signed Upload Links
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[#8c8c8c] hover:text-white transition-colors cursor-pointer p-1 rounded-[6px] hover:bg-[#1a1a1a]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Segmented Tabs Toolbar */}
        <div className="px-5 py-3 border-b border-[#222222]">
          <div className="inline-flex items-center p-0.5 rounded-[8px] bg-transparent border border-[#262626]">
            <button
              type="button"
              onClick={() => setActiveTab('create')}
              className={`flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[13px] font-sans font-medium transition-colors cursor-pointer outline-none border ${
                activeTab === 'create'
                  ? 'bg-[#161616] text-white border-[#333333]'
                  : 'text-[#8c8c8c] hover:text-white hover:bg-[#141414] border-transparent'
              }`}
            >
              <Upload className="w-3.5 h-3.5 shrink-0" />
              <span>Create Link</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('manage');
                loadTickets();
              }}
              className={`flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[13px] font-sans font-medium transition-colors cursor-pointer outline-none border ${
                activeTab === 'manage'
                  ? 'bg-[#161616] text-white border-[#333333]'
                  : 'text-[#8c8c8c] hover:text-white hover:bg-[#141414] border-transparent'
              }`}
            >
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span>Active Links</span>
              {activeTicketCount > 0 && (
                <span className="px-2 py-0.5 rounded-[4px] bg-[#222222] border border-[#333333] text-[#cccccc] text-[12px] font-sans font-medium leading-none">
                  {activeTicketCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {activeTab === 'create' ? (
            <>
              {generatedTicket ? (
                /* ─── Success Generated View ───────────────────────────────── */
                <div className="space-y-4 animate-in fade-in duration-100">
                  <div>
                    <label className="block text-[13px] font-sans font-medium text-[#8c8c8c] mb-1.5">
                      Pre-Signed Upload URL (HTTP PUT)
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={fullUploadUrl}
                        className="flex-1 h-8 px-3 rounded-[6px] bg-[#141414] border border-[#262626] text-white font-mono text-[12px] select-all outline-none"
                      />
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={() => copyToClipboard(fullUploadUrl, 'upload-url')}
                        className="h-8 px-3"
                      >
                        {copiedKey === 'upload-url' ? (
                          <>
                            <Check className="w-3.5 h-3.5" />
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
                    <p className="text-[12px] font-sans text-[#666666] mt-1.5">
                      External clients or scripts can upload this file directly via HTTP PUT without an API key.
                    </p>
                  </div>

                  {/* cURL Snippet Card */}
                  <div className="p-3 rounded-[6px] bg-[#121212] border border-[#222222] space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-[12px] font-sans font-medium text-[#cccccc]">
                        <Code2 className="w-3.5 h-3.5 text-blue-400" />
                        <span>cURL Upload Snippet</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(curlUploadSnippet, 'curl-upload')}
                        className="h-6 px-2 rounded-[4px] bg-[#181818] hover:bg-[#222222] border border-[#2a2a2a] text-[11px] font-sans font-medium text-[#cccccc] hover:text-white transition-colors cursor-pointer"
                      >
                        {copiedKey === 'curl-upload' ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <pre className="p-2 rounded-[4px] bg-[#0a0a0a] border border-[#1e1e1e] text-[11px] font-mono text-[#a3a3a3] overflow-x-auto whitespace-pre-wrap break-all select-all">
                      {curlUploadSnippet}
                    </pre>
                  </div>

                  <div className="-mx-5 px-5 pt-3.5 border-t border-[#1f1f1f] flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setGeneratedTicket(null)}
                      className="text-[13px] font-sans text-[#8c8c8c] hover:text-white transition-colors cursor-pointer"
                    >
                      ← Create another link
                    </button>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('manage');
                          setGeneratedTicket(null);
                        }}
                        className="text-[13px] font-sans text-blue-400 hover:text-blue-300 transition-colors cursor-pointer flex items-center gap-1"
                      >
                        <Clock className="w-3.5 h-3.5" />
                        <span>View Active Links</span>
                      </button>
                      <Button type="button" variant="secondary" size="sm" onClick={onClose} className="h-8 px-3">
                        Done
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                /* ─── Form ─────────────────────────────────────────────────── */
                <form onSubmit={handleCreate} className="space-y-4">
                  {createError && (
                    <div className="p-2.5 rounded-[6px] bg-[#ef4444]/10 border border-[#ef4444]/30 text-[13px] font-sans text-[#ef4444] flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>{createError}</span>
                    </div>
                  )}

                  {/* Destination File Name */}
                  <div>
                    <label className="block text-[13px] font-sans font-medium text-[#8c8c8c] mb-1.5">
                      Destination File Name
                    </label>
                    <div className="flex items-center rounded-[6px] bg-[#141414] border border-[#262626] focus-within:border-[#3b82f6] overflow-hidden">
                      {currentPrefix && (
                        <span className="px-2.5 py-1.5 text-[12px] font-mono text-[#666666] bg-[#101010] border-r border-[#222222] shrink-0">
                          {currentPrefix}
                        </span>
                      )}
                      <input
                        type="text"
                        value={fileName}
                        onChange={(e) => setFileName(e.target.value)}
                        placeholder="e.g. video_v1.mp4"
                        autoFocus
                        className="flex-1 h-8 px-2.5 bg-transparent text-white text-[13px] font-sans outline-none placeholder:text-[#555555]"
                      />
                    </div>
                    <p className="text-[12px] font-sans text-[#666666] mt-1.5">
                      The upload link will be cryptographically locked to this exact file name in{' '}
                      <span className="font-mono text-[#8c8c8c]">{namespace}</span>.
                    </p>
                  </div>

                  {/* Expiration Segmented Control */}
                  <div>
                    <label className="block text-[13px] font-sans font-medium text-[#8c8c8c] mb-1.5">
                      Link Expiration
                    </label>
                    <div className="grid grid-cols-5 gap-1 p-1 bg-[#141414] border border-[#262626] rounded-[6px]">
                      {TTL_PRESETS.map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => setSelectedTtl(preset.seconds)}
                          className={`h-8 rounded-[5px] text-[13px] font-sans font-medium transition-colors cursor-pointer flex items-center justify-center ${
                            selectedTtl === preset.seconds
                              ? 'bg-[#222222] text-white shadow-xs'
                              : 'text-[#8c8c8c] hover:text-white'
                          }`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                    {selectedTtl === 0 && (
                      <div className="mt-2.5 flex items-center gap-2">
                        <input
                          type="number"
                          min="0.5"
                          step="0.5"
                          value={customHours}
                          onChange={(e) => setCustomHours(e.target.value)}
                          placeholder="12"
                          className="w-24 h-8 px-2.5 rounded-[6px] bg-[#141414] border border-[#262626] focus:border-[#3b82f6] text-white text-[13px] font-sans outline-none"
                        />
                        <span className="text-[13px] font-sans text-[#8c8c8c]">hours</span>
                      </div>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="-mx-5 px-5 pt-3.5 border-t border-[#1f1f1f] flex items-center justify-end gap-2">
                    <Button type="button" variant="secondary" size="sm" onClick={onClose} className="h-8 px-3">
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      variant="primary"
                      size="sm"
                      isLoading={isCreating}
                      disabled={isCreating}
                      className="h-8 px-4"
                    >
                      Generate Upload Link
                    </Button>
                  </div>
                </form>
              )}
            </>
          ) : (
            /* ─── Active Upload Links Management Tab ────────────────────── */
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-sans font-medium text-[#8c8c8c]">
                  Active Upload Capability Links ({tickets.length})
                </span>
                <button
                  type="button"
                  onClick={loadTickets}
                  disabled={isLoadingTickets}
                  className="flex items-center gap-1 text-[12px] font-sans text-[#8c8c8c] hover:text-white transition-colors cursor-pointer disabled:opacity-40"
                >
                  <RefreshCw className={`w-3 h-3 ${isLoadingTickets ? 'animate-spin' : ''}`} />
                  <span>Refresh</span>
                </button>
              </div>

              {manageError && (
                <div className="p-2.5 rounded-[6px] bg-[#ef4444]/10 border border-[#ef4444]/30 text-[13px] font-sans text-[#ef4444] flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{manageError}</span>
                </div>
              )}

              {isLoadingTickets && tickets.length === 0 ? (
                <div className="py-8 text-center text-[13px] font-sans text-[#8c8c8c]">
                  Loading upload links...
                </div>
              ) : tickets.length === 0 ? (
                <div className="py-8 text-center rounded-[6px] bg-[#111111] border border-[#222222] p-4 text-[13px] font-sans text-[#8c8c8c]">
                  No active upload links found in this namespace.
                </div>
              ) : (
                <div className="max-h-64 overflow-y-auto rounded-[6px] border border-[#222222] divide-y divide-[#1e1e1e] bg-[#0e0e0e]">
                  {tickets.map((t) => {
                    const timeRem = formatTimeRemaining(t.expires_at);
                    const isRevoking = revokingSigs.has(t.signature);
                    const isDeleting = deletingSigs.has(t.signature);
                    const fullUrl = `${window.location.origin}${t.url || ''}`;
                    const targetFile = t.key.split('/').pop() || 'file';
                    const curlCmd = `curl -X PUT --upload-file "${targetFile}" "${fullUrl}"`;

                    return (
                      <div
                        key={t.signature}
                        className="p-3 flex items-center justify-between gap-3 font-sans hover:bg-[#121212] transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-[12px] font-medium text-white truncate max-w-[200px]" title={t.key}>
                              {t.key}
                            </span>

                            {t.revoked ? (
                              <span className="px-2 py-0.5 rounded-[4px] bg-[#ef4444]/15 border border-[#ef4444]/30 text-[#ef4444] text-[12px] font-sans font-medium">
                                Revoked
                              </span>
                            ) : timeRem.isExpired ? (
                              <span className="px-2 py-0.5 rounded-[4px] bg-[#f59e0b]/15 border border-[#f59e0b]/30 text-[#f59e0b] text-[12px] font-sans font-medium">
                                Expired
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-[4px] bg-[#30a46c]/15 border border-[#30a46c]/30 text-[#30a46c] text-[12px] font-sans font-medium">
                                Active
                              </span>
                            )}

                            <span className="text-[12px] font-sans text-[#8c8c8c]">
                              {timeRem.text}
                            </span>
                          </div>

                          <div className="mt-1 font-mono text-[11px] text-[#666666] truncate">
                            sig: {t.signature.slice(0, 16)}...
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => copyToClipboard(fullUrl, `url-${t.signature}`)}
                            title="Copy upload URL"
                            className="flex items-center gap-1 h-7 px-2.5 rounded-[6px] text-[12px] font-sans font-medium text-[#cccccc] hover:text-white bg-[#141414] hover:bg-[#1c1c1c] border border-[#262626] transition-colors cursor-pointer"
                          >
                            {copiedKey === `url-${t.signature}` ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5 text-[#8c8c8c]" />
                            )}
                            <span className="hidden sm:inline">URL</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => copyToClipboard(curlCmd, `curl-${t.signature}`)}
                            title="Copy cURL snippet"
                            className="flex items-center gap-1 h-7 px-2 rounded-[6px] text-[12px] font-sans font-medium text-[#cccccc] hover:text-white bg-[#141414] hover:bg-[#1c1c1c] border border-[#262626] transition-colors cursor-pointer"
                          >
                            {copiedKey === `curl-${t.signature}` ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Code2 className="w-3.5 h-3.5 text-[#8c8c8c]" />
                            )}
                            <span className="hidden sm:inline">cURL</span>
                          </button>

                          {!t.revoked && !timeRem.isExpired && (
                            <button
                              type="button"
                              onClick={() => handleRevoke(t.signature)}
                              disabled={isRevoking}
                              title="Revoke upload capability immediately"
                              className="flex items-center gap-1 h-7 px-2.5 rounded-[6px] text-[12px] font-sans font-medium text-[#f5a623] hover:text-[#f7b955] bg-[#2a1b0a] hover:bg-[#3d270f] border border-[#593814] transition-colors cursor-pointer disabled:opacity-40"
                            >
                              <Ban className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">Revoke</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => handleDelete(t.signature)}
                            disabled={isDeleting}
                            title="Delete ticket record"
                            className="flex items-center justify-center h-7 w-7 rounded-[6px] text-[#8c8c8c] hover:text-rose-400 bg-[#141414] hover:bg-[#1c1c1c] border border-[#262626] hover:border-rose-900/40 transition-colors cursor-pointer disabled:opacity-40"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="-mx-5 px-5 pt-3.5 border-t border-[#1f1f1f] flex items-center justify-end">
                <Button type="button" variant="secondary" size="sm" onClick={onClose} className="h-8 px-4 text-[13px]">
                  Close
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
