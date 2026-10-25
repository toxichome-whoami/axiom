/*
 * In-App File Preview Modal for Native Blob Storage.
 * Provides rich instant playback and inspection for Video, Audio, Image, PDF, and Code.
 * Owned by: ui/pages/storage
 * Dependencies: lucide-react, ./MediaPlayer, ./format, ./fileIcon, ../../api/client
 */

import React, { useState, useEffect } from 'react';
import {
  X,
  Download,
  Share2,
  ExternalLink,
  HardDrive,
  Copy,
  Check,
} from 'lucide-react';
import { StorageItem } from './types';
import { MediaPlayer } from './MediaPlayer';
import { formatBytes } from './format';
import { getFileIcon, getFileExtension } from './fileIcon';
import { api } from '../../api/client';

export interface FilePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: StorageItem | null;
  namespace: string;
  onDownload: (key: string) => void;
  onShare?: (item: StorageItem) => void;
}

export function FilePreviewModal({
  isOpen,
  onClose,
  item,
  namespace,
  onDownload,
  onShare,
}: FilePreviewModalProps) {
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [ticketSig, setTicketSig] = useState<string | null>(null);
  const [ticketExp, setTicketExp] = useState<number | null>(null);
  const [isLoadingTicket, setIsLoadingTicket] = useState(false);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // When modal opens with a file item, generate a temporary capability ticket for streaming
  useEffect(() => {
    if (!isOpen || !item || item.type !== 'file') {
      setStreamUrl(null);
      setTicketSig(null);
      setTicketExp(null);
      setTicketError(null);
      return;
    }

    let isSubscribed = true;
    setIsLoadingTicket(true);
    setTicketError(null);

    // Request a 1-hour read ticket for media playback and streaming
    api
      .createBlobTicket(namespace, item.fullKey, 'READ', 3600)
      .then((res) => {
        if (!isSubscribed) return;
        const rawUrl = res.url || '';
        const inlineUrl = `${rawUrl}&inline=1`;
        setStreamUrl(inlineUrl);
        setTicketSig(res.signature || null);
        setTicketExp(res.expires_at ?? null);
      })
      .catch((err) => {
        if (!isSubscribed) return;
        setTicketError(err instanceof Error ? err.message : 'Failed to authorize media stream');
      })
      .finally(() => {
        if (isSubscribed) setIsLoadingTicket(false);
      });

    return () => {
      isSubscribed = false;
    };
  }, [isOpen, item, namespace]);

  // Handle Escape key to close modal
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

  const publicPreviewUrl =
    ticketSig && ticketExp
      ? `${window.location.origin}/system/preview?ns=${encodeURIComponent(namespace)}&key=${encodeURIComponent(item.fullKey)}&ticket_sig=${encodeURIComponent(ticketSig)}&ticket_exp=${encodeURIComponent(ticketExp)}`
      : '';

  const handleCopyLink = () => {
    if (!publicPreviewUrl) return;
    navigator.clipboard.writeText(publicPreviewUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-xs animate-in fade-in duration-150 font-sans"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="relative w-full max-w-5xl max-h-[92vh] flex flex-col bg-[#0a0a0a] border border-[#222222] rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
        {/* ─── Modal Header Bar ─────────────── */}
        <div className="h-14 px-4 sm:px-6 bg-[#0f0f0f] border-b border-[#202020] flex items-center justify-between shrink-0">
          {/* File Name & Format Badge */}
          <div className="flex items-center gap-3 min-w-0 pr-4">
            <div className="w-8 h-8 rounded-lg bg-[#161616] border border-[#262626] flex items-center justify-center shrink-0">
              {getFileIcon(item.name, 'w-4 h-4')}
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-[14px] font-medium text-white truncate leading-snug" title={item.name}>
                  {item.name}
                </h3>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-[#181818] border border-[#262626] text-[#8c8c8c] shrink-0">
                  {getFileExtension(item.name)}
                </span>
              </div>
              <p className="text-[12px] text-[#777777] font-mono truncate">
                {formatBytes(item.size || 0)} &bull; {item.content_type || 'binary'}
              </p>
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="flex items-center gap-2">
            {publicPreviewUrl && (
              <a
                href={publicPreviewUrl}
                target="_blank"
                rel="noreferrer"
                title="Open viewer in new window"
                className="hidden sm:inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[12px] text-[#cccccc] hover:text-white bg-[#161616] hover:bg-[#202020] border border-[#262626] transition-colors cursor-pointer"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Open in Tab</span>
              </a>
            )}

            {publicPreviewUrl && (
              <button
                type="button"
                onClick={handleCopyLink}
                title="Copy capability link"
                className="hidden md:inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[12px] text-[#cccccc] hover:text-white bg-[#161616] hover:bg-[#202020] border border-[#262626] transition-colors cursor-pointer"
              >
                {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedLink ? 'Copied' : 'Copy Link'}</span>
              </button>
            )}

            {onShare && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onShare(item);
                }}
                title="Create capability share link"
                className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[12px] text-[#cccccc] hover:text-white bg-[#161616] hover:bg-[#202020] border border-[#262626] transition-colors cursor-pointer"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Share</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => onDownload(item.fullKey)}
              title="Download object"
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-medium text-black bg-white hover:bg-[#e0e0e0] transition-colors cursor-pointer shadow-sm"
            >
              <Download className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>Download</span>
            </button>

            <div className="w-px h-5 bg-[#262626] mx-1" />

            <button
              type="button"
              onClick={onClose}
              title="Close (Esc)"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-[#777777] hover:text-white hover:bg-[#1f1f1f] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ─── Modal Viewport Body ─────────────── */}
        <div className="flex-1 overflow-auto p-4 sm:p-6 bg-[#070707] flex items-center justify-center">
          {isLoadingTicket ? (
            <div className="flex items-center gap-3 text-[#8c8c8c] text-[13px] py-16">
              <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <span>Initializing secure media stream...</span>
            </div>
          ) : ticketError ? (
            <div className="text-center p-8 max-w-sm space-y-3">
              <div className="text-red-400 text-[14px]">{ticketError}</div>
              <button
                type="button"
                onClick={() => onDownload(item.fullKey)}
                className="px-4 py-2 rounded-lg bg-white text-black text-[13px] font-medium cursor-pointer"
              >
                Download Object Directly
              </button>
            </div>
          ) : streamUrl ? (
            <div className="w-full flex items-center justify-center">
              <MediaPlayer
                url={streamUrl}
                name={item.name}
                contentType={item.content_type}
                size={item.size}
                onDownload={() => onDownload(item.fullKey)}
                autoPlay={false}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
