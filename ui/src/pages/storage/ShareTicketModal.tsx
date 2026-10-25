/*
 * Modal for creating, sharing, and revoking Blob capability download/stream tickets (signed links).
 * Owned by: ui/pages/storage
 * Key deps: ../../types, ../../api/client, ../../components/ui/Button
 * Invariants: Single-item Share is strictly scoped to READ capability links (streaming & downloading).
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
  Link as LinkIcon,
  Globe,
  Play,
  Code2,
  ExternalLink,
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
  const [selectedTtl, setSelectedTtl] = useState<number>(3600);
  const [customHours, setCustomHours] = useState<string>('12');
  const [linkMode, setLinkMode] = useState<'stream' | 'download'>('stream');

  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [generatedTicket, setGeneratedTicket] = useState<CreateBlobTicketResponse | null>(null);

  const [tickets, setTickets] = useState<BlobTicket[]>([]);
  const [isLoadingTickets, setIsLoadingTickets] = useState(false);
  const [manageError, setManageError] = useState<string | null>(null);
  const [revokingSigs, setRevokingSigs] = useState<Set<string>>(new Set());
  const [deletingSigs, setDeletingSigs] = useState<Set<string>>(new Set());

  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const isVideo = item ? /\.(mp4|webm|mov|m4v|mkv)$/i.test(item.name) : false;
  const isAudio = item ? /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(item.name) : false;
  const isImage = item ? /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(item.name) : false;
  const isMedia = isVideo || isAudio || isImage;

  // Default link mode: stream/preview for media, download for other documents
  useEffect(() => {
    setLinkMode(isMedia ? 'stream' : 'download');
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
      setTickets(Array.isArray(resp) ? resp : (resp as any).tickets || []);
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
      setActiveTab('create');
      loadTickets();
    }
  }, [isOpen, loadTickets]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item || !namespace) return;

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
      // Single-file share is strictly READ (capability download or stream)
      const res = await api.createBlobTicket(namespace, item.fullKey, 'READ', ttl);
      setGeneratedTicket(res);
      await loadTickets();
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Failed to generate capability ticket');
    } finally {
      setIsCreating(false);
    }
  };

  const handleRevoke = async (signature: string) => {
    setRevokingSigs((prev) => new Set(prev).add(signature));
    try {
      await api.revokeBlobTicket(signature);
      await loadTickets();
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

  const handleDelete = async (signature: string) => {
    if (!confirm('Permanently delete this capability ticket record?')) return;
    setDeletingSigs((prev) => new Set(prev).add(signature));
    try {
      await api.deleteBlobTicket(signature);
      await loadTickets();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to delete ticket');
    } finally {
      setDeletingSigs((prev) => {
        const next = new Set(prev);
        next.delete(signature);
        return next;
      });
    }
  };

  if (!isOpen || !item) return null;

  // Build effective capability URLs
  const rawTicketUrl = generatedTicket
    ? `${window.location.origin}${generatedTicket.url || ''}`
    : '';
  const directStreamUrl = rawTicketUrl ? `${rawTicketUrl}&inline=1` : '';
  const viewerUrl = generatedTicket
    ? `${window.location.origin}/system/preview?ns=${encodeURIComponent(namespace)}&key=${encodeURIComponent(item.fullKey)}&ticket_sig=${encodeURIComponent(generatedTicket.signature || '')}&ticket_exp=${encodeURIComponent(String(generatedTicket.expires_at || 0))}`
    : '';

  // In stream mode, use the branded Axiom Viewer Link as the primary link
  const primaryShareUrl = linkMode === 'stream' ? viewerUrl : rawTicketUrl;

  const ticketExp = generatedTicket?.expires_at || 0;

  // Embed Snippets (using direct API stream URL)
  const videoSnippet = directStreamUrl
    ? `<video controls preload="metadata" src="${directStreamUrl}"></video>`
    : '';
  const audioSnippet = directStreamUrl
    ? `<audio controls preload="metadata" src="${directStreamUrl}"></audio>`
    : '';
  const imageSnippet = directStreamUrl
    ? `<img src="${directStreamUrl}" alt="${item.name}" />`
    : '';
  const curlSnippet = directStreamUrl ? `curl -O "${directStreamUrl}"` : '';

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

        {/* Public Namespace Banner */}
        {isPublicNamespace && (
          <div className="mx-5 mt-3.5 p-3 rounded-[8px] bg-[#30a46c]/10 border border-[#30a46c]/30 text-[13px] text-[#30a46c] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Globe className="w-4 h-4 text-[#30a46c] shrink-0" />
              <div className="truncate">
                <span className="font-sans font-medium text-[#30a46c]">Public CDN:</span>
                <span className="text-[#a3a3a3] ml-1">Permanent static URL (never expires).</span>
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
              {copiedKey === 'public-cdn-url' ? 'Copied' : 'Copy CDN Link'}
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
                /* ─── Link Generated Success View ────────────────────────────── */
                <div className="space-y-4 animate-in fade-in duration-100">
                  {/* Primary Link: Interactive Branded Viewer (or Direct Download) */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-[13px] font-sans font-medium text-white">
                        {linkMode === 'stream' ? 'Interactive Web Viewer Link' : 'Direct Download Link'}
                      </label>
                      <a
                        href={primaryShareUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 text-[12px] font-sans text-blue-400 hover:text-blue-300 transition-colors"
                      >
                        <span>{linkMode === 'stream' ? 'Open Viewer' : 'Test Download'}</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={primaryShareUrl}
                        className="flex-1 h-8 px-3 rounded-[6px] bg-[#141414] border border-[#262626] text-white font-mono text-[12px] select-all outline-none"
                      />
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={() => copyToClipboard(primaryShareUrl, 'primary-url')}
                        className="h-8 px-3"
                      >
                        {copiedKey === 'primary-url' ? (
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
                    <p className="text-[11px] text-[#777777] mt-1">
                      {linkMode === 'stream'
                        ? 'Recipient opens a branded, responsive media player with playback controls and download option.'
                        : 'Link prompts browser to download the file directly.'}
                    </p>
                  </div>

                  {/* Secondary Link: Direct API Stream URL */}
                  {linkMode === 'stream' && directStreamUrl && (
                    <div className="p-2.5 rounded-[6px] bg-[#121212] border border-[#222222] space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="block text-[12px] font-sans text-[#8c8c8c]">
                          Direct API Stream URL
                        </label>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(directStreamUrl, 'direct-stream-url')}
                          className="text-[11px] font-sans text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
                        >
                          {copiedKey === 'direct-stream-url' ? 'Copied' : 'Copy Direct URL'}
                        </button>
                      </div>
                      <input
                        type="text"
                        readOnly
                        value={directStreamUrl}
                        className="w-full h-7 px-2.5 rounded-[4px] bg-[#161616] border border-[#262626] text-[#aaaaaa] font-mono text-[11px] select-all outline-none"
                      />
                    </div>
                  )}

                  {/* Summary row */}
                  <div className="flex items-center justify-between p-3 rounded-[6px] bg-[#121212] border border-[#222222] text-[13px] font-sans">
                    <div className="flex items-center gap-2">
                      <span className="text-[#8c8c8c]">Mode:</span>
                      <span className="font-sans text-[#cccccc] text-[12px] font-medium px-2 py-0.5 rounded-[4px] bg-[#1a1a1a] border border-[#2a2a2a]">
                        {linkMode === 'stream' ? 'Browser Stream & Preview' : 'Force Download'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[#8c8c8c] text-[12px]">
                      <Clock className="w-3.5 h-3.5 text-[#666666]" />
                      <span>Expires in {formatTimeRemaining(ticketExp).text}</span>
                    </div>
                  </div>

                  {/* Quick Embed Snippets */}
                  <div className="space-y-2 pt-1">
                    <span className="text-[12px] font-sans font-medium text-[#8c8c8c] block">
                      Quick Snippets
                    </span>

                    {isVideo && (
                      <div className="flex items-center justify-between p-2.5 rounded-[6px] bg-[#121212] border border-[#222222]">
                        <div className="flex items-center gap-2 min-w-0 pr-2">
                          <Code2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                          <span className="text-[12px] font-sans text-[#cccccc]">HTML Video Embed</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(videoSnippet, 'video-embed')}
                          className="h-6.5 px-2 rounded-[4px] bg-[#181818] hover:bg-[#222222] border border-[#2a2a2a] text-[11px] font-sans font-medium text-[#cccccc] hover:text-white transition-colors cursor-pointer shrink-0"
                        >
                          {copiedKey === 'video-embed' ? 'Copied' : 'Copy HTML'}
                        </button>
                      </div>
                    )}

                    {isAudio && (
                      <div className="flex items-center justify-between p-2.5 rounded-[6px] bg-[#121212] border border-[#222222]">
                        <div className="flex items-center gap-2 min-w-0 pr-2">
                          <Code2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                          <span className="text-[12px] font-sans text-[#cccccc]">HTML Audio Embed</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(audioSnippet, 'audio-embed')}
                          className="h-6.5 px-2 rounded-[4px] bg-[#181818] hover:bg-[#222222] border border-[#2a2a2a] text-[11px] font-sans font-medium text-[#cccccc] hover:text-white transition-colors cursor-pointer shrink-0"
                        >
                          {copiedKey === 'audio-embed' ? 'Copied' : 'Copy HTML'}
                        </button>
                      </div>
                    )}

                    {isImage && (
                      <div className="flex items-center justify-between p-2.5 rounded-[6px] bg-[#121212] border border-[#222222]">
                        <div className="flex items-center gap-2 min-w-0 pr-2">
                          <Code2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <span className="text-[12px] font-sans text-[#cccccc]">HTML Image Tag</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(imageSnippet, 'img-embed')}
                          className="h-6.5 px-2 rounded-[4px] bg-[#181818] hover:bg-[#222222] border border-[#2a2a2a] text-[11px] font-sans font-medium text-[#cccccc] hover:text-white transition-colors cursor-pointer shrink-0"
                        >
                          {copiedKey === 'img-embed' ? 'Copied' : 'Copy HTML'}
                        </button>
                      </div>
                    )}

                    <div className="flex items-center justify-between p-2.5 rounded-[6px] bg-[#121212] border border-[#222222]">
                      <div className="flex items-center gap-2 min-w-0 pr-2">
                        <Download className="w-3.5 h-3.5 text-[#8c8c8c] shrink-0" />
                        <span className="text-[12px] font-sans text-[#cccccc]">cURL Download Command</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(curlSnippet, 'curl-cmd')}
                        className="h-6.5 px-2 rounded-[4px] bg-[#181818] hover:bg-[#222222] border border-[#2a2a2a] text-[11px] font-sans font-medium text-[#cccccc] hover:text-white transition-colors cursor-pointer shrink-0"
                      >
                        {copiedKey === 'curl-cmd' ? 'Copied' : 'Copy cURL'}
                      </button>
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
                    <Button type="button" variant="secondary" size="sm" onClick={onClose} className="h-8 px-3">
                      Done
                    </Button>
                  </div>
                </div>
              ) : (
                /* ─── Create Form ────────────────────────────────────────────── */
                <form id="share-create-form" onSubmit={handleCreate} className="space-y-4">
                  {createError && (
                    <div className="p-2.5 rounded-[6px] bg-[#ef4444]/10 border border-[#ef4444]/30 text-[13px] font-sans text-[#ef4444] flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>{createError}</span>
                    </div>
                  )}

                  {/* Link Mode: Stream / Preview vs Force Download */}
                  <div>
                    <label className="block text-[13px] font-sans font-medium text-[#8c8c8c] mb-1.5">
                      Link Behavior
                    </label>
                    <div className="grid grid-cols-2 gap-1 p-1 bg-[#141414] border border-[#262626] rounded-[6px]">
                      <button
                        type="button"
                        onClick={() => setLinkMode('stream')}
                        className={`h-8 rounded-[5px] text-[13px] font-sans font-medium transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
                          linkMode === 'stream'
                            ? 'bg-[#222222] text-white shadow-xs'
                            : 'text-[#8c8c8c] hover:text-white'
                        }`}
                      >
                        <Play className="w-3.5 h-3.5" />
                        <span>Stream & Preview</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setLinkMode('download')}
                        className={`h-8 rounded-[5px] text-[13px] font-sans font-medium transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
                          linkMode === 'download'
                            ? 'bg-[#222222] text-white shadow-xs'
                            : 'text-[#8c8c8c] hover:text-white'
                        }`}
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Force Download</span>
                      </button>
                    </div>
                    <p className="text-[12px] font-sans text-[#666666] mt-1.5">
                      {linkMode === 'stream'
                        ? 'Recipients stream videos, audio, or preview files directly in their browser tab.'
                        : 'Recipients immediately receive a file download prompt to save the object.'}
                    </p>
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
                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#1a1a1a]">
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
                      Generate Link
                    </Button>
                  </div>
                </form>
              )}
            </>
          ) : (
            /* ─── Active Tickets Management Tab ─────────────────────────── */
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-sans font-medium text-[#8c8c8c]">
                  Active Capability Links ({tickets.length})
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
                  Loading links...
                </div>
              ) : tickets.length === 0 ? (
                <div className="py-8 text-center rounded-[6px] bg-[#111111] border border-[#222222] p-4 text-[13px] font-sans text-[#8c8c8c]">
                  No active capability links found for this object.
                </div>
              ) : (
                <div className="max-h-64 overflow-y-auto rounded-[6px] border border-[#222222] divide-y divide-[#1e1e1e] bg-[#0e0e0e]">
                  {tickets.map((t) => {
                    const timeRem = formatTimeRemaining(t.expires_at);
                    const isRevoking = revokingSigs.has(t.signature);
                    const isDeleting = deletingSigs.has(t.signature);
                    const fullUrl = `${window.location.origin}${t.url || ''}`;

                    return (
                      <div
                        key={t.signature}
                        className="p-3 flex items-center justify-between gap-3 font-sans hover:bg-[#121212] transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-sans text-[12px] font-medium text-white">
                              Download Link
                            </span>

                            {t.revoked ? (
                              <span className="px-1.5 py-0.5 rounded-[4px] bg-[#ef4444]/15 border border-[#ef4444]/30 text-[#ef4444] text-[11px] font-sans font-medium">
                                Revoked
                              </span>
                            ) : timeRem.isExpired ? (
                              <span className="px-1.5 py-0.5 rounded-[4px] bg-[#f59e0b]/15 border border-[#f59e0b]/30 text-[#f59e0b] text-[11px] font-sans font-medium">
                                Expired
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded-[4px] bg-[#30a46c]/15 border border-[#30a46c]/30 text-[#30a46c] text-[11px] font-sans font-medium">
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
                            onClick={() => copyToClipboard(fullUrl, `copy-${t.signature}`)}
                            title="Copy link"
                            className="flex items-center gap-1 h-7 px-2.5 rounded-[6px] text-[12px] font-sans font-medium text-[#cccccc] hover:text-white bg-[#141414] hover:bg-[#1c1c1c] border border-[#262626] transition-colors cursor-pointer"
                          >
                            {copiedKey === `copy-${t.signature}` ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5 text-[#8c8c8c]" />
                            )}
                            <span className="hidden sm:inline">Copy</span>
                          </button>

                          {!t.revoked && !timeRem.isExpired && (
                            <button
                              type="button"
                              onClick={() => handleRevoke(t.signature)}
                              disabled={isRevoking}
                              title="Revoke access immediately"
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
