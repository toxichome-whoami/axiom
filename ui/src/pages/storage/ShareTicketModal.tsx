/*
 * Modal for creating, sharing, and revoking Blob capability tickets (signed links).
 * Owned by: ui/pages/storage
 * Key deps: ../../types, ../../api/client, ../../components/ui/Button
 * Invariants: Revoking instantly invalidates capability signatures in both L1 RAM cache and SQLite.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Share2,
  Copy,
  Check,
  Clock,
  RefreshCw,
  AlertTriangle,
  Download,
  Upload,
  Trash2,
  Ban,
  Link as LinkIcon,
  Globe,
} from 'lucide-react';
import { StorageItem } from './types';
import { BlobTicket, CreateBlobTicketResponse } from '../../types';
import { api } from '../../api/client';
import { Button } from '../../components/ui/Button';

export interface ShareTicketModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: StorageItem | null;
  namespace: string;
  isPublicNamespace?: boolean;
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

export function ShareTicketModal({
  isOpen,
  onClose,
  item,
  namespace,
  isPublicNamespace,
}: ShareTicketModalProps) {
  const [activeTab, setActiveTab] = useState<'create' | 'manage'>('create');
  const [operation, setOperation] = useState<'READ' | 'WRITE'>('READ');
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

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => {
      setCopiedKey((prev) => (prev === id ? null : prev));
    }, 2000);
  };

  const loadTickets = useCallback(async () => {
    if (!item || !namespace) return;
    setIsLoadingTickets(true);
    setManageError(null);
    try {
      const data = await api.listBlobTickets(namespace, item.fullKey, true);
      setTickets(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setManageError(err instanceof Error ? err.message : 'Failed to fetch tickets');
    } finally {
      setIsLoadingTickets(false);
    }
  }, [item, namespace]);

  useEffect(() => {
    if (isOpen && item) {
      loadTickets();
      setGeneratedTicket(null);
      setCreateError(null);
    }
  }, [isOpen, item, loadTickets]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !item) return null;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setIsCreating(true);

    let ttlSeconds = selectedTtl;
    if (selectedTtl === 0) {
      const hoursNum = parseFloat(customHours);
      if (isNaN(hoursNum) || hoursNum <= 0) {
        setCreateError('Please specify a positive number of hours for custom lifetime.');
        setIsCreating(false);
        return;
      }
      ttlSeconds = Math.round(hoursNum * 3600);
    }

    try {
      const resp = await api.createBlobTicket(namespace, item.fullKey, operation, ttlSeconds);
      setGeneratedTicket(resp);
      loadTickets();
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create share link');
    } finally {
      setIsCreating(false);
    }
  };

  const handleRevoke = async (signature: string) => {
    setRevokingSigs((prev) => new Set(prev).add(signature));
    try {
      await api.revokeBlobTicket(signature);
      setTickets((prev) =>
        prev.map((t) => (t.signature === signature ? { ...t, revoked: true } : t))
      );
    } catch (err: unknown) {
      setManageError(err instanceof Error ? err.message : 'Failed to revoke ticket');
    } finally {
      setRevokingSigs((prev) => {
        const next = new Set(prev);
        next.delete(signature);
        return next;
      });
    }
  };

  const handleDelete = async (signature: string) => {
    setDeletingSigs((prev) => new Set(prev).add(signature));
    try {
      await api.deleteBlobTicket(signature);
      setTickets((prev) => prev.filter((t) => t.signature !== signature && t.id !== signature));
    } catch (err: unknown) {
      setManageError(err instanceof Error ? err.message : 'Failed to delete ticket');
    } finally {
      setDeletingSigs((prev) => {
        const next = new Set(prev);
        next.delete(signature);
        return next;
      });
    }
  };

  const activeTicketCount = tickets.filter(
    (t) => Boolean(t && !t.revoked && typeof t.expires_at === 'number' && t.expires_at > Math.floor(Date.now() / 1000))
  ).length;

  const ticketExp =
    generatedTicket?.expires_at ||
    (typeof generatedTicket?.ticket === 'object' && generatedTicket?.ticket ? generatedTicket.ticket.expires_at : 0) ||
    0;
  const ticketOp =
    generatedTicket?.operation ||
    (typeof generatedTicket?.ticket === 'object' && generatedTicket?.ticket ? generatedTicket.ticket.operation : operation) ||
    operation;
  const rawTicketUrl = generatedTicket?.url || '';
  const fullTicketUrl = rawTicketUrl
    ? rawTicketUrl.startsWith('http')
      ? rawTicketUrl
      : `${window.location.origin}${rawTicketUrl}`
    : '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs font-sans select-none"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[520px] rounded-[8px] bg-[#0c0c0c] border border-[#262626] shadow-2xl overflow-hidden font-sans flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1f1f1f]">
          <div className="min-w-0 pr-3">
            <div className="flex items-center gap-2">
              <Share2 className="w-4 h-4 text-white" />
              <h3 className="text-[15px] font-sans font-medium text-white tracking-tight">Share Object</h3>
            </div>
            <p className="text-[13px] text-[#8c8c8c] font-mono truncate mt-0.5" title={`${namespace}/${item.fullKey}`}>
              {item.name}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[#8c8c8c] hover:text-white transition-colors cursor-pointer p-1 rounded-[6px] hover:bg-[#1a1a1a]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {isPublicNamespace && (
          <div className="mx-5 mt-3.5 p-3.5 rounded-[8px] bg-[#30a46c]/10 border border-[#30a46c]/30 text-[13px] text-[#30a46c] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Globe className="w-4 h-4 text-[#30a46c] shrink-0" />
              <div className="truncate">
                <span className="font-sans font-medium text-[#30a46c]">Public Namespace:</span>
                <span className="text-[#a3a3a3] ml-1">Direct static CDN URLs work without expiration.</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                const url = `${window.location.origin}/api/v1/blobs/public/${namespace}/${item.fullKey}`;
                copyToClipboard(url, 'public-cdn-url');
              }}
              className="px-2.5 py-1 rounded-[6px] bg-[#30a46c]/20 hover:bg-[#30a46c]/30 border border-[#30a46c]/40 text-[12px] font-sans font-medium text-[#30a46c] transition-colors shrink-0 cursor-pointer"
            >
              {copiedKey === 'public-cdn-url' ? 'Copied!' : 'Copy CDN Link'}
            </button>
          </div>
        )}

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
              <LinkIcon className="w-3.5 h-3.5 shrink-0" />
              <span>Create link</span>
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
              <span>Active links</span>
              {activeTicketCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-[4px] bg-[#222222] border border-[#333333] text-[#cccccc] text-[11px] font-mono leading-none">
                  {activeTicketCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Body Content */}
        <div className="p-5 space-y-4">
          {activeTab === 'create' ? (
            <>
              {generatedTicket ? (
                /* Link Created View */
                <div className="space-y-4">
                  <div>
                    <label className="block text-[13px] font-sans font-medium text-[#8c8c8c] mb-1.5">
                      Capability Link
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={fullTicketUrl}
                        className="flex-1 h-9 px-3 rounded-[6px] bg-[#141414] border border-[#262626] text-white font-mono text-[13px] select-all outline-none"
                      />
                      <Button
                        type="button"
                        variant="primary"
                        size="md"
                        onClick={() => copyToClipboard(fullTicketUrl, 'generated-url')}
                      >
                        {copiedKey === 'generated-url' ? (
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
                  </div>

                  {/* Summary row */}
                  <div className="flex items-center justify-between p-3 rounded-[6px] bg-[#121212] border border-[#222222] text-[13px] font-sans">
                    <div className="flex items-center gap-2">
                      <span className="text-[#8c8c8c]">Access:</span>
                      <span className="font-mono text-[#cccccc] text-[11px] font-medium px-2 py-0.5 rounded-[4px] bg-[#1a1a1a] border border-[#2a2a2a]">
                        {ticketOp}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[#8c8c8c] text-[12px]">
                      <Clock className="w-3.5 h-3.5 text-[#666666]" />
                      <span>Expires in {formatTimeRemaining(ticketExp).text}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <button
                      type="button"
                      onClick={() => setGeneratedTicket(null)}
                      className="text-[13px] font-sans text-[#8c8c8c] hover:text-white transition-colors cursor-pointer"
                    >
                      ← Create another link
                    </button>
                    <Button type="button" variant="secondary" size="md" onClick={onClose}>
                      Done
                    </Button>
                  </div>
                </div>
              ) : (
                /* Create Form */
                <form id="share-create-form" onSubmit={handleCreate} className="space-y-4">
                  {createError && (
                    <div className="p-2.5 rounded-[6px] bg-[#ef4444]/10 border border-[#ef4444]/30 text-[13px] font-sans text-[#ef4444] flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>{createError}</span>
                    </div>
                  )}

                  {/* Permission Segmented Toggle */}
                  <div>
                    <label className="block text-[13px] font-sans font-medium text-[#8c8c8c] mb-1.5">
                      Permission
                    </label>
                    <div className="grid grid-cols-2 gap-1 p-1 bg-[#141414] border border-[#262626] rounded-[6px]">
                      <button
                        type="button"
                        onClick={() => setOperation('READ')}
                        className={`h-8 rounded-[5px] text-[13px] font-sans font-medium transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
                          operation === 'READ'
                            ? 'bg-[#222222] text-white shadow-sm'
                            : 'text-[#8c8c8c] hover:text-white'
                        }`}
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Read (Download)</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setOperation('WRITE')}
                        className={`h-8 rounded-[5px] text-[13px] font-sans font-medium transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
                          operation === 'WRITE'
                            ? 'bg-[#222222] text-white shadow-sm'
                            : 'text-[#8c8c8c] hover:text-white'
                        }`}
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>Write (Upload)</span>
                      </button>
                    </div>
                  </div>

                  {/* Expiration Segmented Control */}
                  <div>
                    <label className="block text-[13px] font-sans font-medium text-[#8c8c8c] mb-1.5">
                      Expiration
                    </label>
                    <div className="grid grid-cols-5 gap-1 p-1 bg-[#141414] border border-[#262626] rounded-[6px]">
                      {TTL_PRESETS.map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => setSelectedTtl(preset.seconds)}
                          className={`h-8 rounded-[5px] text-[13px] font-sans font-medium transition-colors cursor-pointer flex items-center justify-center ${
                            selectedTtl === preset.seconds
                              ? 'bg-[#222222] text-white shadow-sm'
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
                </form>
              )}
            </>
          ) : (
            /* Manage Links Tab */
            <div className="space-y-3 max-h-72 overflow-y-auto">
              <div className="flex items-center justify-between pb-1">
                <span className="text-[13px] font-sans font-medium text-[#8c8c8c]">
                  Existing Links ({tickets.length})
                </span>
                <button
                  type="button"
                  onClick={loadTickets}
                  disabled={isLoadingTickets}
                  className="flex items-center gap-1.5 h-7 px-2 rounded-[6px] text-[12px] font-sans text-[#8c8c8c] hover:text-white hover:bg-[#141414] border border-transparent hover:border-[#262626] transition-colors cursor-pointer"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${isLoadingTickets ? 'animate-spin' : ''}`}
                  />
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
                <div className="py-8 text-center text-[#8c8c8c] text-[13px] font-sans">
                  Loading links...
                </div>
              ) : tickets.length === 0 ? (
                <div className="py-8 rounded-[8px] bg-[#0c0c0c] border border-[#222222] text-center space-y-2">
                  <LinkIcon className="w-5 h-5 text-[#555555] mx-auto" />
                  <p className="text-[13px] font-sans text-[#8c8c8c]">
                    No capability links created yet.
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('create')}
                    className="text-[13px] font-sans text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
                  >
                    Create a share link
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-[#1e1e1e] border border-[#222222] rounded-[8px] bg-[#0c0c0c] overflow-hidden">
                  {tickets.map((t) => {
                    const sig = t?.signature || '';
                    const exp = t?.expires_at || 0;
                    const remaining = formatTimeRemaining(exp);
                    const isRevoking = sig ? revokingSigs.has(sig) : false;
                    const isDeleting = sig ? deletingSigs.has(sig) : false;
                    const isRevoked = Boolean(t?.revoked);
                    const isActive = !isRevoked && !remaining.isExpired;
                    const rawUrl = t?.url || '';
                    const fullUrl = rawUrl
                      ? rawUrl.startsWith('http')
                        ? rawUrl
                        : `${window.location.origin}${rawUrl}`
                      : '';

                    return (
                      <div
                        key={t.id || sig}
                        className={`p-3.5 space-y-2 transition-colors ${
                          isRevoked ? 'opacity-50' : 'hover:bg-[#111111]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded-[4px] text-[11px] font-mono font-medium text-[#cccccc] bg-[#161616] border border-[#262626]">
                              {t.operation || 'READ'}
                            </span>

                            {isRevoked ? (
                              <span className="text-[12px] font-sans text-[#e5484d] font-medium flex items-center gap-1.5">
                                <Ban className="w-3.5 h-3.5" />
                                <span>Revoked</span>
                              </span>
                            ) : remaining.isExpired ? (
                              <span className="text-[12px] font-sans text-[#8c8c8c] flex items-center gap-1.5">
                                <Clock className="w-3.5 h-3.5 text-[#666666]" />
                                <span>Expired</span>
                              </span>
                            ) : (
                              <span className="text-[12px] font-sans text-emerald-400 font-medium flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                <span>{remaining.text}</span>
                              </span>
                            )}
                          </div>

                          {/* Actions with proper standard button size h-7 */}
                          <div className="flex items-center gap-1.5">
                            {isActive && fullUrl && (
                              <button
                                type="button"
                                onClick={() => copyToClipboard(fullUrl, `url-${sig}`)}
                                className="h-7 px-2.5 rounded-[6px] text-[12px] font-sans font-medium text-[#cccccc] hover:text-white bg-[#141414] hover:bg-[#1a1a1a] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer flex items-center gap-1.5"
                                title="Copy link"
                              >
                                {copiedKey === `url-${sig}` ? (
                                  <>
                                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                                    <span className="text-emerald-400">Copied</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3.5 h-3.5 text-[#8c8c8c]" />
                                    <span>Copy</span>
                                  </>
                                )}
                              </button>
                            )}
                            {isActive && sig && (
                              <button
                                type="button"
                                onClick={() => handleRevoke(sig)}
                                disabled={isRevoking}
                                className="h-7 px-2.5 rounded-[6px] text-[12px] font-sans font-medium text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                                title="Revoke link immediately"
                              >
                                <Ban className="w-3.5 h-3.5" />
                                <span>{isRevoking ? 'Revoking...' : 'Revoke'}</span>
                              </button>
                            )}
                            {sig && (
                              <button
                                type="button"
                                onClick={() => handleDelete(sig)}
                                disabled={isDeleting}
                                className="h-7 w-7 rounded-[6px] text-[#8c8c8c] hover:text-[#e5484d] hover:bg-red-950/20 border border-transparent hover:border-red-900/40 transition-colors cursor-pointer flex items-center justify-center disabled:opacity-50"
                                title="Delete link record"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Direct link text */}
                        {fullUrl && (
                          <div className="p-2 rounded-[6px] bg-[#070707] border border-[#1f1f1f] text-[12px] text-[#8c8c8c] font-mono truncate select-all">
                            {fullUrl}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Dedicated Fixed Footer (only shown on Create tab when link not yet generated) */}
        {activeTab === 'create' && !generatedTicket && (
          <div className="px-5 py-3.5 bg-[#0e0e0e] border-t border-[#1f1f1f] flex items-center justify-end gap-2 shrink-0">
            <Button type="button" variant="secondary" size="md" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="share-create-form"
              variant="primary"
              size="md"
              isLoading={isCreating}
            >
              Generate link
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
