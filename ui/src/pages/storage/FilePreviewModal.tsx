/*
 * In-App Full-Page File Preview with Integrated Edge-to-Edge Right Inspector.
 * Covers full viewport with edge-to-edge grid lines, responsive across all devices.
 * Center media canvas with zero-ticket stream, right-side inspector matching StorageDetailsPanel.
 * Owned by: ui/pages/storage
 * Dependencies: lucide-react, ./MediaPlayer, ./format, ./fileIcon
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  X,
  Download,
  Share2,
  ExternalLink,
  Copy,
  Check,
  Globe,
  PanelRight,
  HardDrive,
  Hash,
  Calendar,
  Layers,
  FileText,
} from "lucide-react";
import { StorageItem } from "./types";
import { MediaPlayer } from "./MediaPlayer";
import { formatBytes } from "./format";
import { getFileIcon, getFileExtension } from "./fileIcon";

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
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(true);

  // Auto-adapt details visibility based on screen width on initial open
  useEffect(() => {
    if (isOpen) {
      setShowDetails(window.innerWidth >= 1024);
    }
  }, [isOpen]);

  // Build stream URL when item or namespace changes
  useEffect(() => {
    if (!isOpen || !item || item.type !== "file") {
      setStreamUrl(null);
      setStreamError(null);
      setIsLoadingStream(false);
      return;
    }

    const sanitizedKeyPath = item.fullKey
      .split("/")
      .map(encodeURIComponent)
      .join("/");

    const cacheBuster = item.hash
      ? `&v=${encodeURIComponent(item.hash)}`
      : `&_t=${item.created_at || Date.now()}`;

    const url = isPublic
      ? `/api/v1/blobs/public/${encodeURIComponent(namespace)}/${sanitizedKeyPath}?inline=1${cacheBuster}`
      : `/api/v1/blobs/${encodeURIComponent(namespace)}/${sanitizedKeyPath}?inline=1${cacheBuster}`;

    setStreamUrl(url);
    setStreamError(null);
    setIsLoadingStream(false);
  }, [isOpen, item, namespace, isPublic]);

  // Handle Escape key: close mobile details drawer if open, else close modal
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (window.innerWidth < 1024 && showDetails) {
          setShowDetails(false);
        } else {
          onClose();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, showDetails, onClose]);

  const handleCopyText = useCallback((text: string, id: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 2000);
  }, []);

  if (!isOpen || !item) return null;

  const sanitizedKeyPath = item.fullKey
    .split("/")
    .map(encodeURIComponent)
    .join("/");

  const previewShareUrl = isPublic
    ? `${window.location.origin}/system/preview?ns=${encodeURIComponent(namespace)}&key=${encodeURIComponent(item.fullKey)}`
    : "";

  const publicCdnUrl = isPublic
    ? `${window.location.origin}/api/v1/blobs/public/${encodeURIComponent(namespace)}/${sanitizedKeyPath}`
    : "";

  // Right-hand Inspector Panel Content (matching RowInspectorSlideOver in Table)
  const detailsPanelContent = (
    <div className="flex flex-col h-full font-sans select-none bg-[#0e0e0e]">
      {/* Panel Top Header Bar matching SlideOver & RowInspector */}
      <div className="flex items-center justify-between px-4 sm:px-5 py-3.5 bg-[#0e0e0e] border-b border-[#222222] shrink-0 font-sans">
        <div className="min-w-0 pr-3 flex-1">
          <h2 className="text-[16px] font-medium text-white tracking-[-0.015em] leading-snug font-sans truncate">
            {item.name}
          </h2>
          <div className="mt-0.5 text-[13px] text-[#8c8c8c] font-sans truncate">
            {namespace} · {formatBytes(item.size || 0)}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowDetails(false)}
          title="Close details"
          className="w-9 h-9 -mr-1 flex items-center justify-center text-[#888888] hover:text-white rounded-[8px] hover:bg-[#1a1a1a] transition-colors cursor-pointer shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Panel Scrollable Body */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5 font-sans bg-[#0e0e0e]">
        {/* Hero Card */}
        <div className="p-4 rounded-[8px] bg-[#141414] border border-[#222222] flex flex-col items-center text-center font-sans">
          <div className="w-12 h-12 rounded-[10px] bg-[#181818] border border-[#262626] flex items-center justify-center mb-2.5 shadow-inner">
            {getFileIcon(item.name, "w-6 h-6")}
          </div>

          <h4
            className="text-[14px] font-medium text-white break-all max-w-full leading-snug font-sans"
            title={item.name}
          >
            {item.name}
          </h4>
          <p className="text-[12.5px] text-[#8c8c8c] mt-0.5 truncate max-w-full font-mono">
            {item.content_type || "application/octet-stream"}
          </p>

          {/* Quick Action Grid */}
          <div className="-mx-4 px-4 w-[calc(100%+2rem)] mt-3.5 pt-3.5 border-t border-[#1f1f1f] grid grid-cols-2 gap-2 font-sans">
            <button
              type="button"
              onClick={() => onDownload(item.fullKey)}
              className="inline-flex items-center justify-center gap-1.5 h-8 px-2.5 rounded-[6px] text-[13px] font-sans font-medium text-white bg-[#1a1a1a] hover:bg-[#222222] border border-[#282828] hover:border-[#383838] transition-colors cursor-pointer min-w-0"
            >
              <Download className="w-3.5 h-3.5 text-[#8c8c8c] shrink-0" />
              <span className="truncate">Download</span>
            </button>

            {onShare && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onShare(item);
                }}
                className="inline-flex items-center justify-center gap-1.5 h-8 px-2.5 rounded-[6px] text-[13px] font-sans font-medium text-[#cccccc] hover:text-white bg-[#141414] hover:bg-[#1c1c1c] border border-[#242424] hover:border-[#383838] transition-colors cursor-pointer min-w-0"
              >
                <Share2 className="w-3.5 h-3.5 text-[#8c8c8c] shrink-0" />
                <span className="truncate">Share</span>
              </button>
            )}
          </div>
        </div>

        {/* Properties Card */}
        <div className="space-y-2">
          <span className="text-[13.5px] font-medium text-white block px-0.5 font-sans">
            Properties
          </span>

          <div className="rounded-[8px] bg-[#141414] border border-[#222222] divide-y divide-[#1f1f1f] text-[13px] font-sans">
            {/* Namespace */}
            <div className="flex items-center justify-between px-3.5 py-2.5">
              <span className="text-[#8c8c8c] flex items-center gap-1.5">
                <HardDrive className="w-3.5 h-3.5 text-[#666666]" />
                Namespace
              </span>
              <div className="flex items-center gap-1.5">
                <span className="text-white font-medium">{namespace}</span>
                {isPublic && (
                  <span className="px-1.5 py-0.5 rounded-[4px] text-[11px] bg-[#1a1a1a] border border-[#2e2e2e] text-[#cccccc] leading-none">
                    Public
                  </span>
                )}
              </div>
            </div>

            {/* Path Key */}
            <div className="flex items-center justify-between px-3.5 py-2.5">
              <span className="text-[#8c8c8c]">Path</span>
              <button
                type="button"
                onClick={() => handleCopyText(item.fullKey, "full-key")}
                className="flex items-center gap-1 text-white hover:text-blue-400 transition-colors font-mono text-[12px] max-w-[170px] truncate cursor-pointer"
                title={`Copy path: ${item.fullKey}`}
              >
                <span className="truncate">{item.fullKey}</span>
                {copiedKey === "full-key" ? (
                  <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                ) : (
                  <Copy className="w-3 h-3 text-[#666666] shrink-0" />
                )}
              </button>
            </div>

            {/* Size */}
            <div className="flex items-center justify-between px-3.5 py-2.5">
              <span className="text-[#8c8c8c]">Size</span>
              <span className="text-white font-medium tabular-nums">
                {formatBytes(item.size || 0)}{" "}
                <span className="text-[11px] text-[#777777] font-normal">
                  ({(item.size || 0).toLocaleString()} B)
                </span>
              </span>
            </div>

            {/* Storage Tier */}
            <div className="flex items-center justify-between px-3.5 py-2.5">
              <span className="text-[#8c8c8c] flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-[#666666]" />
                Storage Tier
              </span>
              <span className="text-white text-[12.5px] font-medium">
                {item.inline ? "Inline SQLite" : "Local Disk Content"}
              </span>
            </div>

            {/* Content Type */}
            <div className="flex items-center justify-between px-3.5 py-2.5">
              <span className="text-[#8c8c8c] flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-[#666666]" />
                Type
              </span>
              <span
                className="text-[#cccccc] text-[12px] font-mono truncate max-w-[160px]"
                title={item.content_type}
              >
                {item.content_type || "application/octet-stream"}
              </span>
            </div>

            {/* Created Timestamp */}
            {item.created_at && item.created_at > 0 && (
              <div className="flex items-center justify-between px-3.5 py-2.5">
                <span className="text-[#8c8c8c] flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-[#666666]" />
                  Uploaded
                </span>
                <span className="text-[#cccccc] text-[12px] tabular-nums">
                  {new Date(item.created_at * 1000).toLocaleString()}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Cryptographic Integrity Card */}
        {item.hash && (
          <div className="space-y-2">
            <div className="flex items-center justify-between px-0.5">
              <span className="text-[13.5px] font-medium text-white flex items-center gap-1.5 font-sans">
                <Hash className="w-3.5 h-3.5 text-[#666666]" />
                BLAKE3 Hash
              </span>
              <button
                type="button"
                onClick={() => handleCopyText(item.hash!, "hash")}
                className="text-[12.5px] text-[#8c8c8c] hover:text-white cursor-pointer inline-flex items-center gap-1 font-sans"
              >
                {copiedKey === "hash" ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-400" />
                    <span className="text-emerald-400 font-medium">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>

            <div className="rounded-[8px] bg-[#141414] border border-[#222222] p-3">
              <div className="p-2.5 rounded-[6px] bg-[#0c0c0c] border border-[#1f1f1f] text-[11.5px] text-[#a1a1aa] break-all select-all leading-relaxed font-mono">
                {item.hash}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/80 backdrop-blur-md font-sans select-none overflow-hidden animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${item.name}`}
    >
      {/* ─── Top Header Bar: 54px Edge-to-Edge ───────────────────────── */}
      <header className="h-[54px] w-full px-3 sm:px-5 bg-[#0e0e0e]/95 backdrop-blur-md border-b border-[#222222] flex items-center justify-between shrink-0 font-sans z-20">
        {/* Left: Icon, Filename, Ext pill, Public badge, Size */}
        <div className="flex items-center gap-2.5 min-w-0 pr-2">
          <div className="w-8 h-8 rounded-[7px] bg-[#141414] border border-[#242424] flex items-center justify-center shrink-0 shadow-inner">
            {getFileIcon(item.name, "w-4 h-4")}
          </div>

          <div className="min-w-0 flex items-center gap-2">
            <h2
              className="text-[14px] sm:text-[15px] font-sans font-medium text-white tracking-tight truncate max-w-[140px] sm:max-w-xs md:max-w-md"
              title={item.name}
            >
              {item.name}
            </h2>
            <span className="text-[11px] sm:text-[12px] font-sans font-medium px-1.5 py-0.5 rounded-[4px] bg-[#141414] border border-[#262626] text-[#8c8c8c] shrink-0">
              {getFileExtension(item.name)}
            </span>
            {isPublic && (
              <span className="px-1.5 py-0.5 rounded-[4px] text-[11px] sm:text-[12px] font-sans font-medium bg-[#161616] border border-[#2e2e2e] text-[#cccccc] shrink-0 leading-none">
                Public
              </span>
            )}
            <span className="text-[12px] sm:text-[13px] text-[#8c8c8c] font-sans font-normal shrink-0 hidden md:inline">
              &bull; {formatBytes(item.size || 0)}
            </span>
          </div>
        </div>

        {/* Right Toolbar Actions */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {previewShareUrl && (
            <a
              href={previewShareUrl}
              target="_blank"
              rel="noreferrer"
              title="Open viewer in new window"
              className="hidden sm:inline-flex items-center gap-1.5 h-8 px-2.5 sm:px-3 rounded-[6px] text-[12.5px] font-sans font-medium text-[#cccccc] hover:text-white bg-[#141414] hover:bg-[#1c1c1c] border border-[#262626] transition-colors cursor-pointer"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Open in Tab</span>
            </a>
          )}

          {previewShareUrl && (
            <button
              type="button"
              onClick={() => handleCopyText(previewShareUrl, "share-link")}
              title="Copy shareable link"
              className="hidden sm:inline-flex items-center gap-1.5 h-8 px-2.5 sm:px-3 rounded-[6px] text-[12.5px] font-sans font-medium text-[#cccccc] hover:text-white bg-[#141414] hover:bg-[#1c1c1c] border border-[#262626] transition-colors cursor-pointer"
            >
              {copiedKey === "share-link" ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span className="hidden md:inline">
                {copiedKey === "share-link" ? "Copied" : "Copy Link"}
              </span>
            </button>
          )}

          {onShare && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onShare(item);
              }}
              title={
                isPublic ? "Share public object" : "Create capability ticket"
              }
              className="inline-flex items-center gap-1.5 h-8 px-2 sm:px-2.5 rounded-[6px] text-[12.5px] font-sans font-medium text-[#cccccc] hover:text-white bg-[#141414] hover:bg-[#1c1c1c] border border-[#262626] transition-colors cursor-pointer"
            >
              {isPublic ? (
                <Globe className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Share2 className="w-3.5 h-3.5" />
              )}
              <span className="hidden sm:inline">Share</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => onDownload(item.fullKey)}
            title="Download object"
            className="inline-flex items-center gap-1.5 h-8 px-2.5 sm:px-3 rounded-[6px] text-[12.5px] font-sans font-medium text-black bg-white hover:bg-[#e0e0e0] transition-colors cursor-pointer shadow-xs"
          >
            <Download className="w-3.5 h-3.5 stroke-[2.5]" />
            <span className="hidden sm:inline">Download</span>
          </button>

          {/* Toggle Details Inspector */}
          <button
            type="button"
            onClick={() => setShowDetails((prev) => !prev)}
            title={showDetails ? "Hide object details" : "Show object details"}
            aria-label="Toggle details panel"
            className={`inline-flex items-center gap-1.5 h-8 px-2 sm:px-2.5 rounded-[6px] text-[12.5px] font-sans font-medium border transition-colors cursor-pointer ${
              showDetails
                ? "bg-[#1f1f1f] text-white border-[#383838]"
                : "bg-[#141414] text-[#8c8c8c] hover:text-white border-[#262626] hover:bg-[#1a1a1a]"
            }`}
          >
            <PanelRight className="w-3.5 h-3.5" />
            <span className="hidden xl:inline">Details</span>
          </button>

          <div className="w-px h-5 bg-[#262626] mx-0.5" />

          {/* Close Window */}
          <button
            type="button"
            onClick={onClose}
            title="Close preview (Esc)"
            aria-label="Close preview"
            className="w-8 h-8 rounded-[6px] flex items-center justify-center text-[#777777] hover:text-white hover:bg-[#1a1a1a] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* ─── Main Two-Pane Canvas: Edge-to-Edge ───────────────────────── */}
      <div className="flex-1 flex flex-row min-h-0 w-full overflow-hidden relative">
        {/* Center Media Viewport - click anywhere on backdrop to close */}
        <main
          className="flex-1 min-h-0 w-full flex items-center justify-center p-3 sm:p-6 bg-transparent overflow-auto relative cursor-pointer"
          onClick={onClose}
        >
          {isLoadingStream ? (
            <div
              className="flex items-center gap-3 text-[#8c8c8c] text-[13px] py-16 font-sans cursor-default"
              onClick={(e) => e.stopPropagation()}
            >
              <svg
                className="animate-spin h-5 w-5 text-white"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8v8H4z"
                />
              </svg>
              <span>Loading media stream...</span>
            </div>
          ) : streamError ? (
            <div
              className="text-center p-8 max-w-sm space-y-3 font-sans cursor-default bg-[#0c0c0c] border border-[#222222] rounded-[8px]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-[#e5484d] text-[13px]">{streamError}</div>
              <button
                type="button"
                onClick={() => onDownload(item.fullKey)}
                className="px-3.5 py-1.5 rounded-[6px] bg-white text-black text-[13px] font-sans font-medium hover:bg-[#e0e0e0] transition-colors cursor-pointer shadow-xs"
              >
                Download Object Directly
              </button>
            </div>
          ) : streamUrl ? (
            <div
              className="w-full max-w-5xl my-auto cursor-default shrink-0 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
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
        </main>

        {/* Desktop Inline Right Inspector (>= lg) */}
        {showDetails && (
          <aside
            className="hidden lg:flex w-96 xl:w-[420px] shrink-0 flex-col border-l border-[#222222] bg-[#0e0e0e] h-full overflow-hidden select-text font-sans shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {detailsPanelContent}
          </aside>
        )}

        {/* Mobile & Tablet Slide-Over Drawer (< lg) */}
        {showDetails && (
          <div className="lg:hidden fixed inset-0 z-50 flex justify-end">
            <div
              className="fixed inset-0 bg-black/70 backdrop-blur-xs transition-opacity animate-in fade-in duration-150"
              onClick={() => setShowDetails(false)}
            />
            <div className="relative w-full h-full sm:max-w-md z-10 animate-in slide-in-from-right duration-200">
              {detailsPanelContent}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
