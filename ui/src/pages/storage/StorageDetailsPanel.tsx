/*
 * Right-hand Inspector / Details Panel subcomponent for Storage page.
 * Owned by: ui/pages/storage
 * Design reference: Linear Issue Inspector & RowInspectorSlideOver in TableEditor
 */

import React, { useState, useEffect } from "react";
import {
  X,
  Folder,
  Download,
  ArrowRight,
  Trash2,
  ShieldCheck,
  CheckCircle2,
  RefreshCw,
  Copy,
  Check,
  Layers,
  HardDrive,
  Share2,
  Eye,
} from "lucide-react";
import { StorageItem } from "./types";
import { NamespaceInfo, NamespaceUsage } from "../../types";
import { getFileIcon } from "./fileIcon";
import { formatBytes } from "./format";

export interface StorageDetailsPanelProps {
  width?: number;
  onResizeStart?: (e: React.MouseEvent) => void;
  isOpen: boolean;
  onClose: () => void;
  selectedItem: StorageItem | null;
  activeNamespace: string;
  currentNsInfo: NamespaceInfo | null;
  namespaceUsage?: NamespaceUsage | null;
  onPreview?: (item: StorageItem) => void;
  onDownload: (key: string) => void;
  onShare?: (item: StorageItem) => void;
  activeTicketCount?: number;
  onOpenMove?: (item: StorageItem) => void;
  onOpenCopy?: (item: StorageItem) => void;
  onDelete?: (item: StorageItem) => void;
  onVerifyBlob: (key: string) => Promise<void>;
  verifyStatus: "verifying" | "valid" | "invalid" | undefined;
  onCopyText: (text: string, id: string) => void;
  copiedKey: string | null;
  isCurrentFolderOverview?: boolean;
}

export function StorageDetailsPanel({
  width,
  onResizeStart,
  isOpen,
  onClose,
  selectedItem,
  activeNamespace,
  currentNsInfo,
  namespaceUsage,
  onPreview,
  onDownload,
  onShare,
  activeTicketCount,
  onOpenMove,
  onOpenCopy,
  onDelete,
  onVerifyBlob,
  verifyStatus,
  onCopyText,
  copiedKey,
  isCurrentFolderOverview = false,
}: StorageDetailsPanelProps) {
  // Close panel on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const panel = (
    <aside className="w-full flex-1 flex flex-col bg-[#0e0e0e] lg:border-l border-[#222222] font-sans select-none overflow-hidden relative h-full">
      {/* Draggable Resize Handle on Left Border */}
      {onResizeStart && (
        <div
          onMouseDown={onResizeStart}
          title="Drag to resize inspector"
          className="hidden lg:block absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-500/50 active:bg-blue-500 transition-colors z-30 select-none group"
        >
          <div className="w-full h-full" />
        </div>
      )}
      {/* ─── Header: Matching SlideOver & RowInspector ─────────────── */}
      <div className="flex items-center justify-between px-4 sm:px-5 py-3.5 bg-[#0e0e0e] border-b border-[#222222] shrink-0 font-sans">
        <div className="min-w-0 pr-3 flex-1">
          <h2 className="text-[16px] font-medium text-white tracking-[-0.015em] leading-snug font-sans truncate">
            {selectedItem
              ? selectedItem.name
              : currentNsInfo?.name || activeNamespace || "Storage"}
          </h2>
          <div className="mt-0.5 text-[13px] text-[#8c8c8c] font-sans truncate">
            {selectedItem
              ? selectedItem.type === "folder"
                ? `Directory · ${selectedItem.itemCount || 0} objects`
                : `${activeNamespace} · ${formatBytes(selectedItem.size || 0)}`
              : "Namespace Overview"}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Close details inspector"
          className="w-9 h-9 -mr-1 flex items-center justify-center rounded-[8px] text-[#888888] hover:text-white hover:bg-[#1a1a1a] transition-colors cursor-pointer shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ─── Content Area ─────────────── */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5 font-sans bg-[#0e0e0e]">
        {selectedItem ? (
          <>
            {/* Hero Card */}
            <div className="p-4 rounded-[8px] bg-[#141414] border border-[#222222] flex flex-col items-center text-center font-sans">
              <div className="w-12 h-12 rounded-[10px] bg-[#181818] border border-[#262626] flex items-center justify-center mb-2.5 shadow-inner">
                {selectedItem.type === "folder" ? (
                  <Folder className="w-6 h-6 text-[#8c8c8c]" />
                ) : (
                  getFileIcon(selectedItem.name, "w-6 h-6")
                )}
              </div>

              <h4 className="text-[14px] font-medium text-white font-sans break-all max-w-full leading-snug">
                {selectedItem.name}
              </h4>
              <p className="text-[12.5px] text-[#8c8c8c] font-sans mt-0.5 truncate max-w-full">
                {selectedItem.type === "folder"
                  ? "Virtual Directory"
                  : selectedItem.content_type || "application/octet-stream"}
              </p>

              {/* Quick Action Buttons */}
              <div className="-mx-4 px-4 w-[calc(100%+2rem)] mt-3.5 pt-3.5 border-t border-[#1f1f1f] grid grid-cols-2 gap-2 font-sans">
                {selectedItem.type === "file" && onPreview && (
                  <button
                    type="button"
                    onClick={() => onPreview(selectedItem)}
                    className="inline-flex items-center justify-center gap-1.5 h-8 px-2.5 rounded-[6px] text-[13px] font-sans font-medium text-white bg-[#1a1a1a] hover:bg-[#222222] border border-[#282828] hover:border-[#383838] transition-colors cursor-pointer min-w-0"
                  >
                    <Eye className="w-3.5 h-3.5 text-[#a3a3a3] shrink-0" />
                    <span className="truncate">Preview</span>
                  </button>
                )}

                {selectedItem.type === "file" && (
                  <button
                    type="button"
                    onClick={() => onDownload(selectedItem.fullKey)}
                    className="inline-flex items-center justify-center gap-1.5 h-8 px-2.5 rounded-[6px] text-[13px] font-sans font-medium text-[#cccccc] hover:text-white bg-[#141414] hover:bg-[#1c1c1c] border border-[#242424] hover:border-[#383838] transition-colors cursor-pointer min-w-0"
                  >
                    <Download className="w-3.5 h-3.5 text-[#8c8c8c] shrink-0" />
                    <span className="truncate">Download</span>
                  </button>
                )}

                {selectedItem.type === "file" && onShare && (
                  <button
                    type="button"
                    onClick={() => onShare(selectedItem)}
                    className="inline-flex items-center justify-center gap-1.5 h-8 px-2.5 rounded-[6px] text-[13px] font-sans font-medium text-[#cccccc] hover:text-white bg-[#141414] hover:bg-[#1c1c1c] border border-[#242424] hover:border-[#383838] transition-colors cursor-pointer min-w-0"
                  >
                    <Share2 className="w-3.5 h-3.5 text-[#8c8c8c] shrink-0" />
                    <span className="truncate">Share</span>
                  </button>
                )}

                {onOpenMove && (
                  <button
                    type="button"
                    onClick={() => onOpenMove(selectedItem)}
                    className="inline-flex items-center justify-center gap-1.5 h-8 px-2.5 rounded-[6px] text-[13px] font-sans font-medium text-[#cccccc] hover:text-white bg-[#141414] hover:bg-[#1c1c1c] border border-[#242424] hover:border-[#383838] transition-colors cursor-pointer min-w-0"
                  >
                    <ArrowRight className="w-3.5 h-3.5 text-[#8c8c8c] shrink-0" />
                    <span className="truncate">Move</span>
                  </button>
                )}

                {onOpenCopy && (
                  <button
                    type="button"
                    onClick={() => onOpenCopy(selectedItem)}
                    className="inline-flex items-center justify-center gap-1.5 h-8 px-2.5 rounded-[6px] text-[13px] font-sans font-medium text-[#cccccc] hover:text-white bg-[#141414] hover:bg-[#1c1c1c] border border-[#242424] hover:border-[#383838] transition-colors cursor-pointer min-w-0"
                  >
                    <Copy className="w-3.5 h-3.5 text-[#8c8c8c] shrink-0" />
                    <span className="truncate">Copy</span>
                  </button>
                )}

                {onDelete && (
                  <button
                    type="button"
                    onClick={() => onDelete(selectedItem)}
                    className="inline-flex items-center justify-center gap-1.5 h-8 px-2.5 rounded-[6px] text-[13px] font-sans font-medium text-[#f87171] hover:text-white bg-[#1a1213] hover:bg-[#281417] border border-[#3e1a1e] hover:border-[#5c2229] transition-colors cursor-pointer min-w-0"
                  >
                    <Trash2 className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">Delete</span>
                  </button>
                )}
              </div>
            </div>

            {/* Properties Group */}
            <div className="space-y-2">
              <span className="text-[13.5px] font-medium text-white block px-0.5 font-sans">
                Properties
              </span>

              <div className="rounded-[8px] bg-[#141414] border border-[#222222] divide-y divide-[#1f1f1f] text-[13px] font-sans">
                <div className="flex items-center justify-between px-3.5 py-2.5">
                  <span className="text-[#8c8c8c]">Namespace</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-white font-medium">
                      {activeNamespace}
                    </span>
                    {currentNsInfo?.is_public && (
                      <span className="px-1.5 py-0.5 rounded-[4px] text-[11px] bg-[#1a1a1a] border border-[#2e2e2e] font-medium font-sans text-[#cccccc] leading-none">
                        Public
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between px-3.5 py-2.5">
                  <span className="text-[#8c8c8c]">Access Policy</span>
                  <span
                    className={`font-medium ${
                      currentNsInfo?.is_public
                        ? "text-[#cccccc]"
                        : "text-[#8c8c8c]"
                    }`}
                  >
                    {currentNsInfo?.is_public
                      ? "Public Direct (CDN)"
                      : "Private (Signed Ticket Only)"}
                  </span>
                </div>

                {selectedItem.type === "file" && !currentNsInfo?.is_public && (
                  <div className="flex items-center justify-between px-3.5 py-2.5">
                    <span className="text-[#8c8c8c]">Active Share Links</span>
                    <div className="flex items-center gap-2">
                      <span className="text-white font-medium">
                        {activeTicketCount || 0} active
                      </span>
                      {onShare && (
                        <button
                          type="button"
                          onClick={() => onShare(selectedItem)}
                          className="text-[12px] text-sky-400 hover:text-sky-300 font-sans hover:underline cursor-pointer"
                        >
                          {(activeTicketCount || 0) > 0 ? "Manage" : "Create"}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {selectedItem.type === "file" && currentNsInfo?.is_public && (
                  <div className="flex items-center justify-between px-3.5 py-2.5 gap-2">
                    <span className="text-[#8c8c8c] shrink-0">
                      Direct CDN URL
                    </span>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className="text-neutral-300 text-[12px] truncate max-w-[140px] font-mono"
                        title={`${window.location.origin}/api/v1/blobs/public/${activeNamespace}/${selectedItem.fullKey}`}
                      >
                        /api/v1/blobs/public/{activeNamespace}/
                        {selectedItem.fullKey}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          onCopyText(
                            `${window.location.origin}/api/v1/blobs/public/${activeNamespace}/${selectedItem.fullKey}`,
                            "public-url",
                          )
                        }
                        title="Copy direct CDN / Public URL"
                        className="text-[#777777] hover:text-white p-0.5 cursor-pointer shrink-0"
                      >
                        {copiedKey === "public-url" ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between px-3.5 py-2.5 gap-2">
                  <span className="text-[#8c8c8c] shrink-0">Path Key</span>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className="text-white text-[13px] truncate max-w-[150px]"
                      title={selectedItem.fullKey}
                    >
                      {selectedItem.fullKey}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        onCopyText(selectedItem.fullKey, "path-key")
                      }
                      title="Copy path key"
                      className="text-[#777777] hover:text-white p-0.5 cursor-pointer shrink-0"
                    >
                      {copiedKey === "path-key" ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between px-3.5 py-2.5">
                  <span className="text-[#8c8c8c]">
                    {selectedItem.type === "folder"
                      ? "Contents"
                      : "Payload Size"}
                  </span>
                  <span className="text-white tabular-nums">
                    {selectedItem.type === "folder"
                      ? `${selectedItem.itemCount || 0} ${(selectedItem.itemCount || 0) === 1 ? "object" : "objects"} (${formatBytes(selectedItem.totalBytes || 0)})`
                      : `${formatBytes(selectedItem.size || 0)} (${(selectedItem.size || 0).toLocaleString()} bytes)`}
                  </span>
                </div>

                <div className="flex items-center justify-between px-3.5 py-2.5">
                  <span className="text-[#8c8c8c]">Storage Tier</span>
                  <span className="text-white font-medium">
                    {selectedItem.type === "folder"
                      ? "Virtual Directory"
                      : selectedItem.inline
                        ? "LSM Inline (<64KB)"
                        : "Disk Content Shard"}
                  </span>
                </div>

                {selectedItem.type === "file" && selectedItem.created_at && (
                  <div className="flex items-center justify-between px-3.5 py-2.5">
                    <span className="text-[#8c8c8c]">Uploaded</span>
                    <span className="text-white tabular-nums text-[13px]">
                      {new Date(
                        selectedItem.created_at * 1000,
                      ).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Checksum & Cryptographic Integrity Card (Files Only) */}
            {selectedItem.type === "file" && selectedItem.hash && (
              <div className="space-y-2">
                <div className="flex items-center justify-between px-0.5">
                  <span className="text-[13.5px] font-medium text-white flex items-center gap-1.5 font-sans">
                    BLAKE3 Integrity
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      onCopyText(selectedItem.hash!, "blake3-hash")
                    }
                    className="text-[12.5px] text-[#8c8c8c] hover:text-white cursor-pointer inline-flex items-center gap-1 font-sans"
                  >
                    {copiedKey === "blake3-hash" ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span className="text-emerald-400 font-medium">
                          Copied
                        </span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy Hash</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="rounded-[8px] bg-[#141414] border border-[#222222] p-3 space-y-2 font-sans">
                  <div className="p-2.5 rounded-[6px] bg-[#0c0c0c] border border-[#1f1f1f] text-[11.5px] text-[#a1a1aa] break-all select-all leading-relaxed font-mono">
                    {selectedItem.hash}
                  </div>

                  <button
                    type="button"
                    onClick={() => onVerifyBlob(selectedItem.fullKey)}
                    disabled={verifyStatus === "verifying"}
                    className={`w-full h-8 px-3 rounded-[6px] border text-[13px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                      verifyStatus === "valid"
                        ? "border-emerald-900/50 bg-emerald-950/20 text-emerald-400"
                        : verifyStatus === "invalid"
                          ? "border-rose-900/50 bg-rose-950/20 text-rose-400"
                          : "border-[#262626] bg-[#141414] text-[#cccccc] hover:text-white hover:border-[#383838]"
                    }`}
                  >
                    {verifyStatus === "verifying" ? (
                      <>
                        <RefreshCw className="w-3 h-3 animate-spin text-[#8c8c8c]" />
                        <span>Verifying Checksum...</span>
                      </>
                    ) : verifyStatus === "valid" ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Integrity Verified Valid</span>
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="w-3.5 h-3.5 text-[#8c8c8c]" />
                        <span>Verify BLAKE3 Digest</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          /* Namespace Overview when no item is selected */
          <div className="space-y-4">
            <div className="p-4 rounded-[8px] bg-[#141414] border border-[#222222] space-y-1.5 font-sans">
              <div className="flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-blue-400" />
                <h4 className="text-[14px] font-medium text-white truncate">
                  {currentNsInfo
                    ? currentNsInfo.name
                    : activeNamespace || "None"}
                </h4>
              </div>
              <p className="text-[12.5px] text-[#8c8c8c] leading-relaxed">
                Dedicated container boundary backed by content-addressed
                storage.
              </p>
            </div>

            {currentNsInfo && (
              <div className="rounded-[8px] bg-[#141414] border border-[#222222] divide-y divide-[#1f1f1f] text-[13px] font-sans">
                <div className="flex items-center justify-between px-3.5 py-2.5">
                  <span className="text-[#8c8c8c]">Total Objects</span>
                  <span className="text-white tabular-nums">
                    {namespaceUsage
                      ? namespaceUsage.total_objects
                      : currentNsInfo.total_objects}
                  </span>
                </div>
                <div className="flex items-center justify-between px-3.5 py-2.5">
                  <span className="text-[#8c8c8c]">Consumed Space</span>
                  <span className="text-white tabular-nums">
                    {formatBytes(
                      namespaceUsage
                        ? namespaceUsage.used_bytes
                        : currentNsInfo.total_bytes,
                    )}
                  </span>
                </div>
                <div className="flex items-center justify-between px-3.5 py-2.5">
                  <span className="text-[#8c8c8c]">Allocated Quota</span>
                  <span className="text-white tabular-nums">
                    {currentNsInfo.max_bytes
                      ? formatBytes(currentNsInfo.max_bytes)
                      : "Unlimited"}
                  </span>
                </div>
                {namespaceUsage && namespaceUsage.max_bytes !== null && (
                  <>
                    <div className="flex items-center justify-between px-3.5 py-2.5">
                      <span className="text-[#8c8c8c]">Space Remaining</span>
                      <span className="text-emerald-400 font-medium tabular-nums">
                        {formatBytes(namespaceUsage.remaining_bytes ?? 0)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between px-3.5 py-2.5">
                      <span className="text-[#8c8c8c]">Quota Utilized</span>
                      <span
                        className={`font-medium tabular-nums ${
                          (namespaceUsage.percent_used || 0) >= 90
                            ? "text-red-400"
                            : (namespaceUsage.percent_used || 0) >= 75
                              ? "text-amber-400"
                              : "text-[#cccccc]"
                        }`}
                      >
                        {namespaceUsage.percent_used?.toFixed(1)}%
                      </span>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );

  return (
    <>
      {/* Mobile & Tablet Drawer Modal (< lg) */}
      <div className="lg:hidden fixed inset-0 z-50 flex justify-end">
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-xs transition-opacity animate-in fade-in duration-150"
          onClick={onClose}
        />
        <div className="relative w-full h-full sm:max-w-md z-10 animate-in slide-in-from-right duration-200">
          {panel}
        </div>
      </div>

      {/* Desktop Inline Sidebar (>= lg) */}
      <div
        className="hidden lg:flex h-full shrink-0"
        style={{ width: width ? `${width}px` : undefined }}
      >
        {panel}
      </div>
    </>
  );
}
