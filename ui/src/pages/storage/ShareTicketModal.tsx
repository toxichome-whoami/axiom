/*
 * Modal for sharing Blob objects: Permanent CDN Links for Public namespaces,
 * and signed capability tickets (download/stream links) for Private namespaces.
 * Owned by: ui/pages/storage
 * Key deps: ../../types, ../../api/client
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
  Trash2,
  Ban,
  CheckCircle2,
  Link as LinkIcon,
  Globe,
  Play,
  Code2,
  ExternalLink,
  Terminal,
} from 'lucide-react';
import { StorageItem } from './types';
import { BlobTicket, CreateBlobTicketResponse } from '../../types';
import { api } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';

export interface ShareTicketModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: StorageItem | null;
  namespace: string;
  isPublicNamespace?: boolean;
  initialTab?: 'public' | 'create' | 'manage';
  onTicketChanged?: () => void;
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
  isPublicNamespace = false,
  initialTab,
  onTicketChanged,
}: ShareTicketModalProps) {
  // If public namespace, default tab is 'public', otherwise initialTab or 'create'
  const [activeTab, setActiveTab] = useState<'public' | 'create' | 'manage'>(
    initialTab || (isPublicNamespace ? 'public' : 'create')
  );
  const [selectedTtl, setSelectedTtl] = useState<number>(3600);
  const [customHours, setCustomHours] = useState<string>('12');
  const [linkMode, setLinkMode] = useState<'stream' | 'download'>('stream');

  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [generatedTicket, setGeneratedTicket] = useState<CreateBlobTicketResponse | null>(null);
  const [resultFormat, setResultFormat] = useState<'viewer' | 'stream' | 'embed' | 'curl'>('viewer');
  const [publicFormat, setPublicFormat] = useState<'url' | 'embed' | 'curl'>('url');

  const [tickets, setTickets] = useState<BlobTicket[]>([]);
  const [isLoadingTickets, setIsLoadingTickets] = useState(false);
  const [manageError, setManageError] = useState<string | null>(null);
  const [revokingSigs, setRevokingSigs] = useState<Set<string>>(new Set());
  const [enablingSigs, setEnablingSigs] = useState<Set<string>>(new Set());
  const [deletingSigs, setDeletingSigs] = useState<Set<string>>(new Set());
  const [ticketToDelete, setTicketToDelete] = useState<BlobTicket | null>(null);

  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const isVideo = item ? /\.(mp4|webm|mov|m4v|mkv)$/i.test(item.name) : false;
  const isAudio = item ? /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(item.name) : false;
  const isImage = item ? /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(item.name) : false;
  const isMedia = isVideo || isAudio || isImage;

  useEffect(() => {
    setLinkMode(isMedia ? 'stream' : 'download');
    setResultFormat('viewer');
  }, [isMedia]);

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
      const resp = await api.listBlobTickets(namespace, item.fullKey, true);
      const allTickets: BlobTicket[] = Array.isArray(resp)
        ? resp
        : (resp as unknown as { items?: BlobTicket[]; tickets?: BlobTicket[] }).items || (resp as any).tickets || [];
      // Filter for READ operation tickets
      setTickets(allTickets.filter((t) => t.operation === 'READ'));
    } catch (err: unknown) {
      setManageError(err instanceof Error ? err.message : 'Failed to load tickets');
    } finally {
      setIsLoadingTickets(false);
    }
  }, [namespace, item]);

  useEffect(() => {
    if (isOpen) {
      setGeneratedTicket(null);
      setCreateError(null);
      setTicketToDelete(null);
      setResultFormat('viewer');
      setPublicFormat('url');
      setActiveTab(initialTab || (isPublicNamespace ? 'public' : 'create'));
      if (!isPublicNamespace) {
        loadTickets();
      }
    }
  }, [isOpen, isPublicNamespace, initialTab, loadTickets]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item || !namespace) return;

    if (isPublicNamespace) {
      setCreateError('Capability tickets cannot be created for a public namespace. Use direct public CDN links.');
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

    setIsCreating(true);
    setCreateError(null);

    try {
      const res = await api.createBlobTicket(namespace, item.fullKey, 'READ', ttl);
      setGeneratedTicket(res);
      setResultFormat('viewer');
      loadTickets();
      onTicketChanged?.();
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create share link');
    } finally {
      setIsCreating(false);
    }
  };

  const handleRevoke = async (signature: string) => {
    setRevokingSigs((prev) => new Set(prev).add(signature));
    try {
      await api.revokeBlobTicket(namespace, signature);
      await loadTickets();
      onTicketChanged?.();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to revoke ticket');
    } finally {
      setRevokingSigs((prev) => {
        const next = new Set(prev);
        next.delete(signature);
        return next;
      });
    }
  };

  const handleEnable = async (signature: string) => {
    setEnablingSigs((prev) => new Set(prev).add(signature));
    try {
      await api.enableBlobTicket(namespace, signature);
      await loadTickets();
      onTicketChanged?.();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to enable ticket');
    } finally {
      setEnablingSigs((prev) => {
        const next = new Set(prev);
        next.delete(signature);
        return next;
      });
    }
  };

  const handleConfirmDelete = async () => {
    if (!ticketToDelete) return;
    const sig = ticketToDelete.signature;
    setDeletingSigs((prev) => new Set(prev).add(sig));
    try {
      await api.deleteBlobTicket(namespace, sig);
      await loadTickets();
      onTicketChanged?.();
      setTicketToDelete(null);
    } catch (err: unknown) {
      setManageError(err instanceof Error ? err.message : 'Failed to delete ticket');
    } finally {
      setDeletingSigs((prev) => {
        const next = new Set(prev);
        next.delete(sig);
        return next;
      });
    }
  };

  if (!isOpen || !item) return null;

  // Public CDN URL constructions
  const sanitizedKeyPath = item.fullKey.split('/').map(encodeURIComponent).join('/');
  const publicCdnUrl = `${window.location.origin}/api/v1/blobs/public/${encodeURIComponent(namespace)}/${sanitizedKeyPath}`;

  // Signed Capability URLs
  const rawTicketUrl = generatedTicket
    ? `${window.location.origin}${generatedTicket.url || ''}`
    : '';
  const directStreamUrl = rawTicketUrl ? `${rawTicketUrl}&inline=1` : '';
  const viewerUrl = generatedTicket
    ? `${window.location.origin}/system/preview?ns=${encodeURIComponent(namespace)}&key=${encodeURIComponent(item.fullKey)}&ticket_sig=${encodeURIComponent(generatedTicket.signature || '')}&ticket_exp=${encodeURIComponent(String(generatedTicket.expires_at || 0))}`
    : '';

  const primaryShareUrl = linkMode === 'stream' ? viewerUrl : rawTicketUrl;

  const signedVideoSnippet = directStreamUrl
    ? `<video controls preload="metadata" src="${directStreamUrl}"></video>`
    : '';
  const signedAudioSnippet = directStreamUrl
    ? `<audio controls preload="metadata" src="${directStreamUrl}"></audio>`
    : '';
  const signedImageSnippet = directStreamUrl
    ? `<img src="${directStreamUrl}" alt="${item.name}" />`
    : '';
  const signedEmbedSnippet = isVideo
    ? signedVideoSnippet
    : isAudio
    ? signedAudioSnippet
    : isImage
    ? signedImageSnippet
    : `curl -O "${directStreamUrl || rawTicketUrl}"`;
  const signedCurlSnippet = directStreamUrl
    ? `curl -O "${directStreamUrl}"`
    : rawTicketUrl
    ? `curl -O "${rawTicketUrl}"`
    : '';

  const publicVideoSnippet = `<video controls preload="metadata" src="${publicCdnUrl}"></video>`;
  const publicAudioSnippet = `<audio controls preload="metadata" src="${publicCdnUrl}"></audio>`;
  const publicImageSnippet = `<img src="${publicCdnUrl}" alt="${item.name}" />`;
  const publicEmbedSnippet = isVideo
    ? publicVideoSnippet
    : isAudio
    ? publicAudioSnippet
    : isImage
    ? publicImageSnippet
    : `curl -O "${publicCdnUrl}"`;
  const publicCurlSnippet = `curl -O "${publicCdnUrl}"`;

  const activeTickets = tickets.filter((t) => !t.revoked && !formatTimeRemaining(t.expires_at).isExpired);
  const activeTicketCount = activeTickets.length;

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-in fade-in duration-150 font-sans"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[500px] rounded-[10px] bg-[#0e0e0e] border border-[#242424] shadow-2xl overflow-hidden font-sans flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#1e1e1e]">
          <div className="flex items-center gap-3 min-w-0 pr-2">
            <div className="w-8 h-8 rounded-[7px] bg-[#161616] border border-[#282828] flex items-center justify-center text-white shrink-0">
              <Share2 className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0">
              <h3 className="text-[15px] font-sans font-semibold text-white tracking-tight leading-tight">
                {isPublicNamespace ? 'Share Public Object' : 'Share Object'}
              </h3>
              <p className="text-[13px] text-[#8c8c8c] font-sans truncate max-w-[360px] mt-0.5" title={`${namespace}/${item.fullKey}`}>
                {item.name}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 rounded-[6px] text-[#777777] hover:text-white hover:bg-[#181818] flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation - Only rendered for private namespaces when no ticket was just generated */}
        {!isPublicNamespace && (
          <div className="px-5 py-2.5 border-b border-[#1c1c1c] bg-[#0c0c0c] flex items-center justify-between">
            <div className="inline-flex items-center p-0.5 rounded-[7px] bg-[#141414] border border-[#222222]">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('create');
                }}
                className={`flex items-center gap-1.5 h-8 px-3.5 rounded-[5px] text-[13px] font-sans font-medium transition-colors cursor-pointer ${
                  activeTab === 'create'
                    ? 'bg-[#222222] text-white shadow-xs'
                    : 'text-[#8c8c8c] hover:text-[#cccccc]'
                }`}
              >
                <LinkIcon className="w-3.5 h-3.5 shrink-0" />
                <span>Create Link</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveTab('manage');
                  loadTickets();
                }}
                className={`flex items-center gap-1.5 h-8 px-3.5 rounded-[5px] text-[13px] font-sans font-medium transition-colors cursor-pointer ${
                  activeTab === 'manage'
                    ? 'bg-[#222222] text-white shadow-xs'
                    : 'text-[#8c8c8c] hover:text-[#cccccc]'
                }`}
              >
                <Clock className="w-3.5 h-3.5 shrink-0" />
                <span>Active Links</span>
                {activeTicketCount > 0 && (
                  <span className="px-2 py-0.5 rounded-[4px] bg-[#2a2a2a] text-[#cccccc] text-[11.5px] font-sans leading-tight">
                    {activeTicketCount}
                  </span>
                )}
              </button>
            </div>

            {/* Quick status indicator */}
            {generatedTicket && activeTab === 'create' && (
              <span className="flex items-center gap-1.5 text-[12px] font-sans text-emerald-400 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Active Link Ready
              </span>
            )}
          </div>
        )}

        {/* Body Content */}
        <div className="p-5 space-y-4">
          {activeTab === 'public' ? (
            /* ─── PUBLIC NAMESPACE CDN VIEW ─────────────────── */
            <div className="space-y-4 animate-in fade-in duration-100">
              {/* Public CDN Notice Badge */}
              <div className="flex items-center justify-between px-3.5 py-2.5 rounded-[7px] bg-[#141414] border border-[#222222]">
                <div className="flex items-center gap-2 min-w-0">
                  <Globe className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span className="text-[13.5px] font-sans font-medium text-white truncate">Permanent CDN URL</span>
                  <span className="text-[12px] text-[#777777]">•</span>
                  <span className="text-[13px] font-sans text-[#888888] truncate">No expiration needed</span>
                </div>
              </div>

              {/* Segmented Format Selector */}
              <div className="flex items-center gap-1 p-0.5 rounded-[7px] bg-[#121212] border border-[#202020]">
                <button
                  type="button"
                  onClick={() => setPublicFormat('url')}
                  className={`flex-1 h-8 rounded-[5px] text-[13px] font-sans font-medium transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
                    publicFormat === 'url' ? 'bg-[#222222] text-white shadow-xs' : 'text-[#888888] hover:text-[#cccccc]'
                  }`}
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span>Public URL</span>
                </button>
                {isMedia && (
                  <button
                    type="button"
                    onClick={() => setPublicFormat('embed')}
                    className={`flex-1 h-8 rounded-[5px] text-[13px] font-sans font-medium transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
                      publicFormat === 'embed' ? 'bg-[#222222] text-white shadow-xs' : 'text-[#888888] hover:text-[#cccccc]'
                    }`}
                  >
                    <Code2 className="w-3.5 h-3.5" />
                    <span>HTML Embed</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setPublicFormat('curl')}
                  className={`flex-1 h-8 rounded-[5px] text-[13px] font-sans font-medium transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
                    publicFormat === 'curl' ? 'bg-[#222222] text-white shadow-xs' : 'text-[#888888] hover:text-[#cccccc]'
                  }`}
                >
                  <Terminal className="w-3.5 h-3.5" />
                  <span>cURL</span>
                </button>
              </div>

              {/* Format Content */}
              {publicFormat === 'url' && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[13px] font-sans text-[#cccccc] font-medium">
                    <span>Direct CDN Endpoint</span>
                    <a
                      href={publicCdnUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 text-[13px] font-sans text-[#8c8c8c] hover:text-white transition-colors"
                    >
                      <span>Open in tab</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                  <div className="flex items-center gap-2.5 h-10 px-3.5 rounded-[7px] bg-[#141414] border border-[#262626] focus-within:border-[#383838]">
                    <Globe className="w-4 h-4 text-[#777777] shrink-0" />
                    <input
                      type="text"
                      readOnly
                      value={publicCdnUrl}
                      className="flex-1 bg-transparent text-white font-mono text-[13px] outline-none truncate select-all"
                    />
                    <button
                      type="button"
                      onClick={() => copyToClipboard(publicCdnUrl, 'public-url')}
                      className="h-7 px-2.5 rounded-[5px] bg-[#222222] hover:bg-[#2c2c2c] text-white border border-[#333333] flex items-center gap-1.5 text-[12px] font-sans font-medium transition-colors cursor-pointer shrink-0"
                    >
                      {copiedKey === 'public-url' ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-emerald-400">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5 text-[#888888]" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {publicFormat === 'embed' && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[13px] font-sans text-[#cccccc] font-medium">
                    <span>HTML Media Tag</span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(publicEmbedSnippet, 'public-embed')}
                      className="flex items-center gap-1 text-[#8c8c8c] hover:text-white transition-colors cursor-pointer text-[12.5px] font-sans"
                    >
                      {copiedKey === 'public-embed' ? (
                        <span className="text-emerald-400 flex items-center gap-1">
                          <Check className="w-3.5 h-3.5" /> Copied snippet
                        </span>
                      ) : (
                        <span className="flex items-center gap-1">
                          <Copy className="w-3.5 h-3.5" /> Copy snippet
                        </span>
                      )}
                    </button>
                  </div>
                  <div className="rounded-[7px] bg-[#141414] border border-[#262626] p-3">
                    <pre className="font-mono text-[12.5px] text-[#cccccc] whitespace-pre-wrap break-all select-all leading-relaxed">
                      {publicEmbedSnippet}
                    </pre>
                  </div>
                </div>
              )}

              {publicFormat === 'curl' && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[13px] font-sans text-[#cccccc] font-medium">
                    <span>cURL Terminal Command</span>
                  </div>
                  <div className="flex items-center gap-2.5 h-10 px-3.5 rounded-[7px] bg-[#141414] border border-[#262626] focus-within:border-[#383838]">
                    <Terminal className="w-4 h-4 text-[#777777] shrink-0" />
                    <input
                      type="text"
                      readOnly
                      value={publicCurlSnippet}
                      className="flex-1 bg-transparent text-white font-mono text-[13px] outline-none truncate select-all"
                    />
                    <button
                      type="button"
                      onClick={() => copyToClipboard(publicCurlSnippet, 'public-curl')}
                      className="h-7 px-2.5 rounded-[5px] bg-[#222222] hover:bg-[#2c2c2c] text-white border border-[#333333] flex items-center gap-1.5 text-[12px] font-sans font-medium transition-colors cursor-pointer shrink-0"
                    >
                      {copiedKey === 'public-curl' ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-emerald-400">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5 text-[#888888]" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Quick Copy Helper Chips */}
              {isMedia && publicFormat === 'url' && (
                <div className="flex items-center gap-2 text-[12.5px] font-sans text-[#777777] pt-1">
                  <span>Quick copy:</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(publicEmbedSnippet, 'quick-pub-embed')}
                    className="px-2.5 py-1 rounded-[5px] bg-[#141414] hover:bg-[#1e1e1e] border border-[#262626] text-[#cccccc] hover:text-white transition-colors cursor-pointer flex items-center gap-1 text-[12px] font-sans font-medium"
                  >
                    {copiedKey === 'quick-pub-embed' ? <Check className="w-3 h-3 text-emerald-400" /> : null}
                    HTML Tag
                  </button>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(publicCurlSnippet, 'quick-pub-curl')}
                    className="px-2.5 py-1 rounded-[5px] bg-[#141414] hover:bg-[#1e1e1e] border border-[#262626] text-[#cccccc] hover:text-white transition-colors cursor-pointer flex items-center gap-1 text-[12px] font-sans font-medium"
                  >
                    {copiedKey === 'quick-pub-curl' ? <Check className="w-3 h-3 text-emerald-400" /> : null}
                    cURL
                  </button>
                </div>
              )}

              {/* Footer */}
              <div className="-mx-5 px-5 pt-3.5 border-t border-[#1e1e1e] flex items-center justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={onClose}
                  className="h-8 px-4 text-[13px]"
                >
                  Close
                </Button>
              </div>
            </div>
          ) : activeTab === 'create' ? (
            /* ─── CAPABILITY LINK CREATION (Private or Expiring) ─────────────────── */
            <>
              {generatedTicket ? (
                /* ─── Compact Sleek Result View (Single Viewport, No Bloat) ─────── */
                <div className="space-y-4 animate-in fade-in duration-100">
                  {/* Expiration & Signature Status Header */}
                  <div className="flex items-center justify-between px-3.5 py-2.5 rounded-[7px] bg-[#141414] border border-[#222222]">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                      <span className="text-[13.5px] font-sans font-medium text-white truncate">Link Ready</span>
                      <span className="text-[12px] text-[#777777]">•</span>
                      <span className="text-[13px] font-sans text-[#888888] flex items-center gap-1.5 truncate">
                        <Clock className="w-3.5 h-3.5 text-[#666666] shrink-0" />
                        {formatTimeRemaining(generatedTicket.expires_at).text}
                      </span>
                    </div>
                    <span className="text-[12px] font-mono text-[#666666] shrink-0">
                      sig:{(generatedTicket.signature || '').slice(0, 8)}
                    </span>
                  </div>

                  {/* Segmented Format Switcher */}
                  <div className="flex items-center gap-1 p-0.5 rounded-[7px] bg-[#121212] border border-[#202020]">
                    {isMedia ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setResultFormat('viewer')}
                          className={`flex-1 h-8 rounded-[5px] text-[13px] font-sans font-medium transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
                            resultFormat === 'viewer'
                              ? 'bg-[#222222] text-white shadow-xs'
                              : 'text-[#888888] hover:text-[#cccccc]'
                          }`}
                        >
                          <Globe className="w-3.5 h-3.5" />
                          <span>Web Viewer</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setResultFormat('stream')}
                          className={`flex-1 h-8 rounded-[5px] text-[13px] font-sans font-medium transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
                            resultFormat === 'stream'
                              ? 'bg-[#222222] text-white shadow-xs'
                              : 'text-[#888888] hover:text-[#cccccc]'
                          }`}
                        >
                          <Play className="w-3.5 h-3.5" />
                          <span>Direct Stream</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setResultFormat('embed')}
                          className={`flex-1 h-8 rounded-[5px] text-[13px] font-sans font-medium transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
                            resultFormat === 'embed'
                              ? 'bg-[#222222] text-white shadow-xs'
                              : 'text-[#888888] hover:text-[#cccccc]'
                          }`}
                        >
                          <Code2 className="w-3.5 h-3.5" />
                          <span>HTML Embed</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setResultFormat('curl')}
                          className={`flex-1 h-8 rounded-[5px] text-[13px] font-sans font-medium transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
                            resultFormat === 'curl'
                              ? 'bg-[#222222] text-white shadow-xs'
                              : 'text-[#888888] hover:text-[#cccccc]'
                          }`}
                        >
                          <Terminal className="w-3.5 h-3.5" />
                          <span>cURL</span>
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => setResultFormat('viewer')}
                          className={`flex-1 h-8 rounded-[5px] text-[13px] font-sans font-medium transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
                            resultFormat === 'viewer'
                              ? 'bg-[#222222] text-white shadow-xs'
                              : 'text-[#888888] hover:text-[#cccccc]'
                          }`}
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Download Link</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setResultFormat('curl')}
                          className={`flex-1 h-8 rounded-[5px] text-[13px] font-sans font-medium transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
                            resultFormat === 'curl'
                              ? 'bg-[#222222] text-white shadow-xs'
                              : 'text-[#888888] hover:text-[#cccccc]'
                          }`}
                        >
                          <Terminal className="w-3.5 h-3.5" />
                          <span>cURL Command</span>
                        </button>
                      </>
                    )}
                  </div>

                  {/* Active Result Format Output */}
                  {resultFormat === 'viewer' && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[13px] font-sans text-[#cccccc] font-medium">
                        <span>{linkMode === 'stream' ? 'Interactive Web Viewer' : 'Direct Download Link'}</span>
                        <a
                          href={primaryShareUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 text-[13px] font-sans text-[#8c8c8c] hover:text-white transition-colors"
                        >
                          <span>{linkMode === 'stream' ? 'Open in tab' : 'Test download'}</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
                      <div className="flex items-center gap-2.5 h-10 px-3.5 rounded-[7px] bg-[#141414] border border-[#262626] focus-within:border-[#383838]">
                        <Globe className="w-4 h-4 text-[#777777] shrink-0" />
                        <input
                          type="text"
                          readOnly
                          value={primaryShareUrl}
                          className="flex-1 bg-transparent text-white font-mono text-[13px] outline-none truncate select-all"
                        />
                        <button
                          type="button"
                          onClick={() => copyToClipboard(primaryShareUrl, 'primary-url')}
                          className="h-7 px-2.5 rounded-[5px] bg-[#222222] hover:bg-[#2c2c2c] text-white border border-[#333333] flex items-center gap-1.5 text-[12px] font-sans font-medium transition-colors cursor-pointer shrink-0"
                        >
                          {copiedKey === 'primary-url' ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                              <span className="text-emerald-400">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5 text-[#888888]" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  {resultFormat === 'stream' && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[13px] font-sans text-[#cccccc] font-medium">
                        <span>Direct Streaming URL (HTTP Range / VLC / curl)</span>
                        <a
                          href={directStreamUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 text-[13px] font-sans text-[#8c8c8c] hover:text-white transition-colors"
                        >
                          <span>Test stream</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
                      <div className="flex items-center gap-2.5 h-10 px-3.5 rounded-[7px] bg-[#141414] border border-[#262626] focus-within:border-[#383838]">
                        <Play className="w-4 h-4 text-[#777777] shrink-0" />
                        <input
                          type="text"
                          readOnly
                          value={directStreamUrl}
                          className="flex-1 bg-transparent text-white font-mono text-[13px] outline-none truncate select-all"
                        />
                        <button
                          type="button"
                          onClick={() => copyToClipboard(directStreamUrl, 'direct-stream')}
                          className="h-7 px-2.5 rounded-[5px] bg-[#222222] hover:bg-[#2c2c2c] text-white border border-[#333333] flex items-center gap-1.5 text-[12px] font-sans font-medium transition-colors cursor-pointer shrink-0"
                        >
                          {copiedKey === 'direct-stream' ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                              <span className="text-emerald-400">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5 text-[#888888]" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  {resultFormat === 'embed' && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[13px] font-sans text-[#cccccc] font-medium">
                        <span>HTML Media Tag</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(signedEmbedSnippet, 'signed-embed')}
                          className="flex items-center gap-1 text-[#8c8c8c] hover:text-white transition-colors cursor-pointer text-[12.5px] font-sans"
                        >
                          {copiedKey === 'signed-embed' ? (
                            <span className="text-emerald-400 flex items-center gap-1">
                              <Check className="w-3.5 h-3.5" /> Copied snippet
                            </span>
                          ) : (
                            <span className="flex items-center gap-1">
                              <Copy className="w-3.5 h-3.5" /> Copy snippet
                            </span>
                          )}
                        </button>
                      </div>
                      <div className="rounded-[7px] bg-[#141414] border border-[#262626] p-3">
                        <pre className="font-mono text-[12.5px] text-[#cccccc] whitespace-pre-wrap break-all select-all leading-relaxed">
                          {signedEmbedSnippet}
                        </pre>
                      </div>
                    </div>
                  )}

                  {resultFormat === 'curl' && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[13px] font-sans text-[#cccccc] font-medium">
                        <span>cURL Terminal Command</span>
                        <span className="text-[12px] font-sans text-[#666666]">Runs in terminal or scripts</span>
                      </div>
                      <div className="flex items-center gap-2.5 h-10 px-3.5 rounded-[7px] bg-[#141414] border border-[#262626] focus-within:border-[#383838]">
                        <Terminal className="w-4 h-4 text-[#777777] shrink-0" />
                        <input
                          type="text"
                          readOnly
                          value={signedCurlSnippet}
                          className="flex-1 bg-transparent text-white font-mono text-[13px] outline-none truncate select-all"
                        />
                        <button
                          type="button"
                          onClick={() => copyToClipboard(signedCurlSnippet, 'signed-curl')}
                          className="h-7 px-2.5 rounded-[5px] bg-[#222222] hover:bg-[#2c2c2c] text-white border border-[#333333] flex items-center gap-1.5 text-[12px] font-sans font-medium transition-colors cursor-pointer shrink-0"
                        >
                          {copiedKey === 'signed-curl' ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                              <span className="text-emerald-400">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5 text-[#888888]" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Quick Copy Helper Chips (one-click copy for other formats without navigating) */}
                  {isMedia && resultFormat === 'viewer' && (
                    <div className="flex items-center gap-2 text-[12.5px] font-sans text-[#777777] pt-1 flex-wrap">
                      <span>Quick copy:</span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(directStreamUrl, 'quick-stream')}
                        className="px-2.5 py-1 rounded-[5px] bg-[#141414] hover:bg-[#1e1e1e] border border-[#262626] text-[#cccccc] hover:text-white transition-colors cursor-pointer flex items-center gap-1 text-[12px] font-sans font-medium"
                      >
                        {copiedKey === 'quick-stream' ? <Check className="w-3 h-3 text-emerald-400" /> : null}
                        Direct Stream URL
                      </button>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(signedEmbedSnippet, 'quick-embed')}
                        className="px-2.5 py-1 rounded-[5px] bg-[#141414] hover:bg-[#1e1e1e] border border-[#262626] text-[#cccccc] hover:text-white transition-colors cursor-pointer flex items-center gap-1 text-[12px] font-sans font-medium"
                      >
                        {copiedKey === 'quick-embed' ? <Check className="w-3 h-3 text-emerald-400" /> : null}
                        HTML Tag
                      </button>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(signedCurlSnippet, 'quick-curl')}
                        className="px-2.5 py-1 rounded-[5px] bg-[#141414] hover:bg-[#1e1e1e] border border-[#262626] text-[#cccccc] hover:text-white transition-colors cursor-pointer flex items-center gap-1 text-[12px] font-sans font-medium"
                      >
                        {copiedKey === 'quick-curl' ? <Check className="w-3 h-3 text-emerald-400" /> : null}
                        cURL
                      </button>
                    </div>
                  )}

                  {/* Clean Footer */}
                  <div className="-mx-5 px-5 pt-3.5 border-t border-[#1e1e1e] flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => {
                        setGeneratedTicket(null);
                        setResultFormat('viewer');
                      }}
                      className="text-[13px] font-sans text-[#8c8c8c] hover:text-white transition-colors cursor-pointer"
                    >
                      ← Create another
                    </button>
                    <div className="flex items-center gap-2">
                      {activeTicketCount > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setActiveTab('manage');
                            setGeneratedTicket(null);
                          }}
                          className="text-[13px] font-sans text-[#8c8c8c] hover:text-white transition-colors cursor-pointer flex items-center gap-1.5 px-2.5 py-1 rounded-[5px] hover:bg-[#161616]"
                        >
                          <Clock className="w-3.5 h-3.5 text-[#666666]" />
                          <span>Active Links ({activeTicketCount})</span>
                        </button>
                      )}
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={onClose}
                        className="h-8 px-4 text-[13px]"
                      >
                        Done
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                /* ─── Compact Creation Form ────────────────────────────────────────── */
                <form onSubmit={handleCreate} className="space-y-4">
                  {createError && (
                    <div className="p-3 rounded-[6px] bg-[#ef4444]/10 border border-[#ef4444]/25 text-[13px] font-sans text-[#ef4444] flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>{createError}</span>
                    </div>
                  )}

                  {/* Link Mode Selector for Media */}
                  {isMedia && (
                    <div className="space-y-1.5">
                      <label className="block text-[13px] font-sans font-medium text-[#cccccc]">
                        Link Behavior
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setLinkMode('stream')}
                          className={`h-14 px-3.5 rounded-[7px] border text-left transition-colors cursor-pointer flex items-center gap-3 ${
                            linkMode === 'stream'
                              ? 'bg-[#181818] border-[#383838] text-white'
                              : 'bg-[#121212] border-[#202020] text-[#888888] hover:text-[#cccccc] hover:border-[#2a2a2a]'
                          }`}
                        >
                          <Play className={`w-4 h-4 shrink-0 ${linkMode === 'stream' ? 'text-blue-400' : 'text-[#666666]'}`} />
                          <div className="min-w-0">
                            <div className="text-[13.5px] font-sans font-medium leading-none">Interactive Player</div>
                            <div className="text-[12px] font-sans text-[#777777] truncate mt-1">Player with scrub & speed</div>
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => setLinkMode('download')}
                          className={`h-14 px-3.5 rounded-[7px] border text-left transition-colors cursor-pointer flex items-center gap-3 ${
                            linkMode === 'download'
                              ? 'bg-[#181818] border-[#383838] text-white'
                              : 'bg-[#121212] border-[#202020] text-[#888888] hover:text-[#cccccc] hover:border-[#2a2a2a]'
                          }`}
                        >
                          <Download className={`w-4 h-4 shrink-0 ${linkMode === 'download' ? 'text-blue-400' : 'text-[#666666]'}`} />
                          <div className="min-w-0">
                            <div className="text-[13.5px] font-sans font-medium leading-none">Direct Download</div>
                            <div className="text-[12px] font-sans text-[#777777] truncate mt-1">Forces file attachment</div>
                          </div>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Expiration Segmented Control */}
                  <div className="space-y-1.5">
                    <label className="block text-[13px] font-sans font-medium text-[#cccccc]">
                      Duration
                    </label>
                    <div className="grid grid-cols-5 gap-1 p-0.5 bg-[#121212] border border-[#202020] rounded-[7px]">
                      {TTL_PRESETS.map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => setSelectedTtl(preset.seconds)}
                          className={`h-8 rounded-[5px] text-[13px] font-sans font-medium transition-colors cursor-pointer flex items-center justify-center ${
                            selectedTtl === preset.seconds
                              ? 'bg-[#222222] text-white shadow-xs'
                              : 'text-[#888888] hover:text-white'
                          }`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                    {selectedTtl === 0 && (
                      <div className="pt-1.5 flex items-center gap-2">
                        <input
                          type="number"
                          min="0.5"
                          step="0.5"
                          value={customHours}
                          onChange={(e) => setCustomHours(e.target.value)}
                          placeholder="12"
                          className="w-24 h-8 px-3 rounded-[6px] bg-[#141414] border border-[#262626] focus:border-[#3b82f6] text-white text-[13px] font-sans outline-none"
                        />
                        <span className="text-[13px] font-sans text-[#888888]">hours (up to 720)</span>
                      </div>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="-mx-5 px-5 pt-3.5 border-t border-[#1e1e1e] flex items-center justify-end gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={onClose}
                      className="h-8 px-3.5"
                    >
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
                      <LinkIcon className="w-3.5 h-3.5" />
                      <span>Generate Link</span>
                    </Button>
                  </div>
                </form>
              )}
            </>
          ) : (
            /* ─── ACTIVE TICKETS MANAGEMENT TAB ─────────────────────────── */
            <div className="space-y-3.5">
              <div className="flex items-center justify-between text-[13px] font-sans text-[#cccccc] font-medium">
                <span>Active Capability Tickets ({tickets.length})</span>
                <button
                  type="button"
                  onClick={loadTickets}
                  disabled={isLoadingTickets}
                  className="flex items-center gap-1.5 text-[12.5px] font-sans text-[#8c8c8c] hover:text-white transition-colors cursor-pointer disabled:opacity-40"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingTickets ? 'animate-spin' : ''}`} />
                  <span>Refresh</span>
                </button>
              </div>

              {manageError && (
                <div className="p-3 rounded-[6px] bg-[#ef4444]/10 border border-[#ef4444]/25 text-[13px] font-sans text-[#ef4444] flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{manageError}</span>
                </div>
              )}

              {isLoadingTickets && tickets.length === 0 ? (
                <div className="py-8 text-center text-[13px] font-sans text-[#888888]">
                  Loading tickets...
                </div>
              ) : tickets.length === 0 ? (
                <div className="py-8 text-center rounded-[7px] bg-[#121212] border border-[#202020] p-4 text-[13px] font-sans text-[#888888]">
                  No active capability links found for this object.
                </div>
              ) : (
                <div className="max-h-64 overflow-y-auto space-y-2 pr-0.5">
                  {tickets.map((t) => {
                    const timeRem = formatTimeRemaining(t.expires_at);
                    const isRevoking = revokingSigs.has(t.signature);
                    const isDeleting = deletingSigs.has(t.signature);
                    const fullUrl = `${window.location.origin}${t.url || ''}`;

                    return (
                      <div
                        key={t.signature}
                        className="p-3 rounded-[7px] bg-[#121212] border border-[#202020] hover:border-[#2a2a2a] flex items-center justify-between gap-3 transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[13px] font-sans font-medium text-white">
                              {t.operation === 'WRITE' ? 'Upload Ticket' : 'Read Ticket'}
                            </span>

                            {t.revoked ? (
                              <span className="px-2 py-0.5 rounded-[4px] bg-[#ef4444]/15 border border-[#ef4444]/30 text-[#ef4444] text-[11.5px] font-sans font-medium leading-normal">
                                Revoked
                              </span>
                            ) : timeRem.isExpired ? (
                              <span className="px-2 py-0.5 rounded-[4px] bg-[#f59e0b]/15 border border-[#f59e0b]/30 text-[#f59e0b] text-[11.5px] font-sans font-medium leading-normal">
                                Expired
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-[4px] bg-[#30a46c]/15 border border-[#30a46c]/30 text-[#30a46c] text-[11.5px] font-sans font-medium leading-normal">
                                Active
                              </span>
                            )}

                            <span className="text-[12.5px] font-sans text-[#8c8c8c]">
                              {timeRem.text}
                            </span>
                          </div>

                          <div className="mt-1 font-mono text-[11.5px] text-[#666666] truncate">
                            sig:{t.signature.slice(0, 16)}...
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => copyToClipboard(fullUrl, `copy-${t.signature}`)}
                            title="Copy link"
                            className="h-7 px-2.5 rounded-[5px] text-[12px] font-sans font-medium text-[#cccccc] hover:text-white bg-[#181818] hover:bg-[#202020] border border-[#282828] flex items-center gap-1 transition-colors cursor-pointer"
                          >
                            {copiedKey === `copy-${t.signature}` ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5 text-[#888888]" />
                            )}
                            <span>Copy</span>
                          </button>

                          {!t.revoked && !timeRem.isExpired && (
                            <button
                              type="button"
                              onClick={() => handleRevoke(t.signature)}
                              disabled={isRevoking}
                              title="Revoke access immediately"
                              className="h-7 px-2.5 rounded-[5px] text-[12px] font-sans font-medium text-amber-300 hover:text-amber-200 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-40"
                            >
                              <Ban className="w-3.5 h-3.5" />
                              <span>Revoke</span>
                            </button>
                          )}

                          {t.revoked && (
                            <button
                              type="button"
                              onClick={() => handleEnable(t.signature)}
                              disabled={enablingSigs.has(t.signature) || timeRem.isExpired}
                              title={
                                timeRem.isExpired
                                  ? 'Cannot re-enable an expired link'
                                  : 'Re-enable capability share link'
                              }
                              className="h-7 px-2.5 rounded-[5px] text-[12px] font-sans font-medium text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>{enablingSigs.has(t.signature) ? 'Enabling...' : 'Enable'}</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => setTicketToDelete(t)}
                            disabled={isDeleting}
                            title="Delete ticket"
                            className="w-7 h-7 rounded-[5px] text-[#888888] hover:text-rose-400 hover:bg-rose-500/10 border border-[#282828] flex items-center justify-center transition-colors cursor-pointer disabled:opacity-40"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="-mx-5 px-5 pt-3.5 border-t border-[#1e1e1e] flex items-center justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={onClose}
                  className="h-8 px-4 text-[13px]"
                >
                  Close
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>

      {/* Delete Ticket Confirmation Dialog */}
      <ConfirmDialog
        isOpen={ticketToDelete !== null}
        onClose={() => setTicketToDelete(null)}
        onConfirm={handleConfirmDelete}
        title="Delete Capability Ticket"
        description={
          ticketToDelete ? (
            <span>
              Are you sure you want to permanently delete this capability ticket? Any link using signature{' '}
              <strong className="text-white font-mono text-[12px] bg-[#1a1a1a] px-1 py-0.5 rounded">
                {ticketToDelete.signature.slice(0, 16)}...
              </strong>{' '}
              will stop working immediately.
            </span>
          ) : (
            'Are you sure you want to delete this capability ticket?'
          )
        }
        confirmLabel={ticketToDelete && deletingSigs.has(ticketToDelete.signature) ? 'Deleting...' : 'Delete'}
        variant="danger"
      />
    </>
  );
}
