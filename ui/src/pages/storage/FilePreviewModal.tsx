/*
 * In-App File Preview Modal for Native Blob Storage.
 * Provides instant playback and inspection for Video, Audio, Image, PDF, and Code.
 * Zero-ticket direct stream for Public namespaces; capability ticket for Private namespaces.
 * Owned by: ui/pages/storage
 * Dependencies: lucide-react, ./MediaPlayer, ./format, ./fileIcon, ../../api/client
 */

import React, { useState, useEffect } from 'react';
import {
  X,
  Download,
  Share2,
  ExternalLink,
  Copy,
  Check,
  Globe,
} from 'lucide-react';
import { StorageItem } from './types';
import { MediaPlayer } from './MediaPlayer';
import { formatBytes } from './format';
import { getFileIcon, getFileExtension } from './fileIcon';

export interface FilePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: StorageItem | null;
  namespace: string;
  isPublic?: boolean;
  onDownload: (key: string) => void;
  onShare?: (item: StorageItem) => void;
}

export function FilePreviewModal({
  isOpen,
  onClose,
  item,
  namespace,
  isPublic = false,
  onDownload,
  onShare,
}: FilePreviewModalProps) {
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [isLoadingStream, setIsLoadingStream] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    if (!isOpen || !item || item.type !== 'file') {
      setStreamUrl(null);
      setStreamError(null);
      setIsLoadingStream(false);
      return;
    }

    const sanitizedKeyPath = item.fullKey.split('/').map(encodeURIComponent).join('/');

    // Stream directly via ambient authentication (zero tickets created on preview)
    const url = isPublic
      ? `/api/v1/blobs/public/${encodeURIComponent(namespace)}/${sanitizedKeyPath}?inline=1`
      : `/api/v1/blobs/${encodeURIComponent(namespace)}/${sanitizedKeyPath}?inline=1`;

    setStreamUrl(url);
    setStreamError(null);
    setIsLoadingStream(false);
  }, [isOpen, item, namespace, isPublic]);

  // Handle Escape key
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

  const previewShareUrl = isPublic
    ? `${window.location.origin}/system/preview?ns=${encodeURIComponent(namespace)}&key=${encodeURIComponent(item.fullKey)}`
    : '';

  const handleCopyLink = () => {
    if (!previewShareUrl) return;
    navigator.clipboard.writeText(previewShareUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-xs animate-in fade-in duration-150 font-sans"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="relative w-full max-w-5xl max-h-[92vh] flex flex-col bg-[#0c0c0c] border border-[#262626] rounded-[8px] shadow-2xl overflow-hidden font-sans">
        {/* ─── Modal Header Bar ─────────────── */}
        <div className="h-[54px] px-4 sm:px-5 bg-[#0c0c0c] border-b border-[#222222] flex items-center justify-between shrink-0">
          {/* File Name & Format Badge */}
          <div className="flex items-center gap-2.5 min-w-0 pr-4">
            <div className="w-8 h-8 rounded-[7px] bg-[#141414] border border-[#242424] flex items-center justify-center shrink-0">
              {getFileIcon(item.name, 'w-4 h-4')}
            </div>

            <div className="min-w-0 flex items-center gap-2">
              <h3 className="text-[15px] font-sans font-medium text-white tracking-tight truncate" title={item.name}>
                {item.name}
              </h3>
              <span className="text-[12px] font-sans font-medium px-2 py-0.5 rounded-[5px] bg-[#141414] border border-[#262626] text-[#8c8c8c] shrink-0">
                {getFileExtension(item.name)}
              </span>
              {isPublic && (
                <span className="px-2 py-0.5 rounded-[5px] text-[12px] font-sans font-medium bg-[#161616] border border-[#2e2e2e] text-[#cccccc] shrink-0 leading-none">
                  Public
                </span>
              )}
              <span className="text-[13px] text-[#8c8c8c] font-sans font-normal shrink-0 hidden sm:inline">
                &bull; {formatBytes(item.size || 0)}
              </span>
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="flex items-center gap-2 shrink-0">
            {previewShareUrl && (
              <a
                href={previewShareUrl}
                target="_blank"
                rel="noreferrer"
                title="Open viewer in new window"
                className="hidden sm:inline-flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[13px] font-sans font-medium text-[#cccccc] hover:text-white bg-[#141414] hover:bg-[#1c1c1c] border border-[#262626] transition-colors cursor-pointer"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Open in Tab</span>
              </a>
            )}

            {previewShareUrl && (
              <button
                type="button"
                onClick={handleCopyLink}
                title="Copy preview link"
                className="hidden md:inline-flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[13px] font-sans font-medium text-[#cccccc] hover:text-white bg-[#141414] hover:bg-[#1c1c1c] border border-[#262626] transition-colors cursor-pointer"
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
                title={isPublic ? 'Share public object' : 'Create capability share link'}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[13px] font-sans font-medium text-[#cccccc] hover:text-white bg-[#141414] hover:bg-[#1c1c1c] border border-[#262626] transition-colors cursor-pointer"
              >
                {isPublic ? <Globe className="w-3.5 h-3.5 text-emerald-400" /> : <Share2 className="w-3.5 h-3.5" />}
                <span className="hidden sm:inline">Share</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => onDownload(item.fullKey)}
              title="Download object"
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[13px] font-sans font-medium text-black bg-white hover:bg-[#e0e0e0] transition-colors cursor-pointer shadow-xs"
            >
              <Download className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>Download</span>
            </button>

            <div className="w-px h-5 bg-[#262626] mx-0.5" />

            <button
              type="button"
              onClick={onClose}
              title="Close (Esc)"
              className="w-8 h-8 rounded-[6px] flex items-center justify-center text-[#777777] hover:text-white hover:bg-[#1a1a1a] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ─── Modal Viewport Body ─────────────── */}
        <div className="flex-1 overflow-auto p-4 sm:p-5 bg-[#09090b] flex items-center justify-center min-h-[300px]">
          {isLoadingStream ? (
            <div className="flex items-center gap-3 text-[#8c8c8c] text-[13px] py-16">
              <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <span>Loading media stream...</span>
            </div>
          ) : streamError ? (
            <div className="text-center p-8 max-w-sm space-y-3 font-sans">
              <div className="text-[#e5484d] text-[13px]">{streamError}</div>
              <button
                type="button"
                onClick={() => onDownload(item.fullKey)}
                className="px-3 py-1.5 rounded-[6px] bg-white text-black text-[13px] font-sans font-medium hover:bg-[#e0e0e0] transition-colors cursor-pointer"
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
                hideHeader={true}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
