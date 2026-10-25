/*
 * Right-hand Inspector / Details Panel subcomponent for Storage page.
 * Owned by: ui/pages/storage
 * Design reference: Linear Issue Inspector & RowInspectorSlideOver in TableEditor
 */

import React, { useState } from 'react';
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
  Globe,
  Eye,
} from 'lucide-react';
import { StorageItem } from './types';
import { NamespaceInfo } from '../../types';
import { getFileIcon } from './fileIcon';
import { formatBytes } from './format';

export interface StorageDetailsPanelProps {
  width?: number;
  onResizeStart?: (e: React.MouseEvent) => void;
  isOpen: boolean;
  onClose: () => void;
  selectedItem: StorageItem | null;
  activeNamespace: string;
  currentNsInfo: NamespaceInfo | null;
  onPreview?: (item: StorageItem) => void;
  onDownload: (key: string) => void;
  onShare?: (item: StorageItem) => void;
  onCopyPublicUrl?: (item: StorageItem) => void;
  onOpenMove: (item: StorageItem) => void;
  onOpenCopy?: (item: StorageItem) => void;
  onDelete: (item: StorageItem) => void;
  onVerifyBlob: (key: string) => Promise<void>;
  verifyStatus: 'verifying' | 'valid' | 'invalid' | undefined;
  onCopyText: (text: string, id: string) => void;
  copiedKey: string | null;
}

export function StorageDetailsPanel({
  width,
  onResizeStart,
  isOpen,
  onClose,
  selectedItem,
  activeNamespace,
  currentNsInfo,
  onPreview,
  onDownload,
  onShare,
  onCopyPublicUrl,
  onOpenMove,
  onOpenCopy,
  onDelete,
  onVerifyBlob,
  verifyStatus,
  onCopyText,
  copiedKey,
}: StorageDetailsPanelProps) {
  const [isChecksumExpanded, setIsChecksumExpanded] = useState(true);

  if (!isOpen) return null;

  const panel = (
    <aside
      style={{ width: width ? `${width}px` : undefined }}
      className="w-full lg:w-80 shrink-0 flex flex-col bg-[#0a0a0a] lg:border-l border-[#222222] font-sans select-none overflow-hidden relative h-full"
    >
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
      {/* ─── Header: Fixed h-12 (aligned with StorageToolbar & StorageSidebar) ─────────────── */}
      <div className="h-12 shrink-0 px-4 border-b border-[#222222] bg-[#0c0c0c] flex items-center justify-between">
        <h3 className="text-[15px] font-medium text-white tracking-tight truncate">
          {selectedItem ? (selectedItem.type === 'folder' ? 'Folder Details' : 'Object Details') : 'Namespace Overview'}
        </h3>
        <button
          type="button"
          onClick={onClose}
          title="Close details inspector"
          className="w-8 h-8 flex items-center justify-center rounded-[6px] text-[#777777] hover:text-white hover:bg-[#1a1a1a] transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ─── Content Area ─────────────── */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {selectedItem ? (
          <>
            {/* Hero Card */}
            <div className="p-3.5 rounded-lg bg-[#111111] border border-[#222222] flex flex-col items-center text-center">
              <div className="w-12 h-12 rounded-[10px] bg-[#161616] border border-[#242424] flex items-center justify-center mb-2.5">
                {selectedItem.type === 'folder' ? (
                  <Folder className="w-6 h-6 text-[#8c8c8c]" />
                ) : (
                  getFileIcon(selectedItem.name, 'w-6 h-6')
                )}
              </div>

              <h4 className="text-[15px] font-medium text-white break-all max-w-full leading-snug">
                {selectedItem.name}
              </h4>
              <p className="text-[13px] text-[#8c8c8c] mt-0.5 truncate max-w-full">
                {selectedItem.type === 'folder'
                  ? 'Virtual Directory'
                  : selectedItem.content_type || 'application/octet-stream'}
              </p>

              {/* Quick Action Buttons */}
              <div className="-mx-3.5 px-3.5 w-[calc(100%+1.75rem)] mt-3 pt-3 border-t border-[#1f1f1f] grid grid-cols-3 gap-1.5 font-sans">
                {selectedItem.type === 'file' && onPreview && (
                  <button
                    type="button"
                    onClick={() => onPreview(selectedItem)}
                    className="inline-flex items-center justify-center gap-1.5 h-7 px-2 rounded-[6px] text-[12px] font-sans font-medium text-white bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 transition-colors cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5 text-blue-400" />
                    <span>Preview</span>
                  </button>
                )}

                {selectedItem.type === 'file' && (
                  <button
                    type="button"
                    onClick={() => onDownload(selectedItem.fullKey)}
                    className="inline-flex items-center justify-center gap-1.5 h-7 px-2 rounded-[6px] text-[12px] font-sans font-medium text-[#cccccc] hover:text-white bg-[#141414] hover:bg-[#1a1a1a] border border-[#242424] hover:border-[#333333] transition-colors cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 text-[#8c8c8c]" />
                    <span>Download</span>
                  </button>
                )}

                {selectedItem.type === 'file' && onShare && (
                  <button
                    type="button"
                    onClick={() => onShare(selectedItem)}
                    className="inline-flex items-center justify-center gap-1.5 h-7 px-2 rounded-[6px] text-[12px] font-sans font-medium text-[#cccccc] hover:text-white bg-[#141414] hover:bg-[#1a1a1a] border border-[#242424] hover:border-[#333333] transition-colors cursor-pointer"
                  >
                    <Share2 className="w-3.5 h-3.5 text-[#8c8c8c]" />
                    <span>Share</span>
                  </button>
                )}

                {selectedItem.type === 'file' && currentNsInfo?.is_public && onCopyPublicUrl && (
                  <button
                    type="button"
                    onClick={() => onCopyPublicUrl(selectedItem)}
                    className="inline-flex items-center justify-center gap-1.5 h-7 px-2.5 rounded-[6px] text-[12px] font-sans font-medium text-[#30a46c] hover:text-white bg-[#30a46c]/15 hover:bg-[#30a46c]/25 border border-[#30a46c]/30 transition-colors cursor-pointer"
                  >
                    <Globe className="w-3.5 h-3.5" />
                    <span>Public URL</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => onOpenMove(selectedItem)}
                  className="inline-flex items-center justify-center gap-1.5 h-7 px-2.5 rounded-[6px] text-[12px] font-sans font-medium text-[#cccccc] hover:text-white bg-[#141414] hover:bg-[#1a1a1a] border border-[#242424] hover:border-[#333333] transition-colors cursor-pointer"
                >
                  <ArrowRight className="w-3.5 h-3.5 text-[#8c8c8c]" />
                  <span>Move</span>
                </button>

                {onOpenCopy && (
                  <button
                    type="button"
                    onClick={() => onOpenCopy(selectedItem)}
                    className="inline-flex items-center justify-center gap-1.5 h-7 px-2.5 rounded-[6px] text-[12px] font-sans font-medium text-[#cccccc] hover:text-white bg-[#141414] hover:bg-[#1a1a1a] border border-[#242424] hover:border-[#333333] transition-colors cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5 text-[#8c8c8c]" />
                    <span>Copy</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => onDelete(selectedItem)}
                  className="inline-flex items-center justify-center gap-1.5 h-7 px-2.5 rounded-[6px] text-[12px] font-sans font-medium text-[#e5484d] hover:text-white bg-red-950/20 hover:bg-red-900/40 border border-red-900/40 hover:border-red-700/60 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete</span>
                </button>
              </div>
            </div>

            {/* Properties Group */}
            <div className="space-y-1">
              <span className="text-[13px] font-medium text-[#8c8c8c] block px-0.5">
                Properties
              </span>

              <div className="rounded-lg bg-[#111111] border border-[#222222] divide-y divide-[#1a1a1a] text-[13.5px]">
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-[#8c8c8c]">Namespace</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-white font-medium">{activeNamespace}</span>
                    {currentNsInfo?.is_public && (
                      <span className="px-2 py-0.5 rounded-[4px] text-[12px] bg-[#30a46c]/15 border border-[#30a46c]/30 font-medium text-[#30a46c]">
                        Public
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-[#8c8c8c]">Access Policy</span>
                  <span
                    className={`font-medium ${
                      currentNsInfo?.is_public ? 'text-[#30a46c]' : 'text-[#8c8c8c]'
                    }`}
                  >
                    {currentNsInfo?.is_public ? 'Public Direct (CDN)' : 'Private (Signed Ticket Only)'}
                  </span>
                </div>

                {selectedItem.type === 'file' && currentNsInfo?.is_public && (
                  <div className="flex items-center justify-between px-3 py-2 gap-2">
                    <span className="text-[#8c8c8c] shrink-0">Direct CDN URL</span>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className="text-[#30a46c] text-xs truncate max-w-[140px] font-mono"
                        title={`${window.location.origin}/api/v1/blobs/public/${activeNamespace}/${selectedItem.fullKey}`}
                      >
                        /api/v1/blobs/public/{activeNamespace}/{selectedItem.fullKey}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          onCopyText(
                            `${window.location.origin}/api/v1/blobs/public/${activeNamespace}/${selectedItem.fullKey}`,
                            'public-url'
                          )
                        }
                        title="Copy direct CDN / Public URL"
                        className="text-[#777777] hover:text-white p-0.5 cursor-pointer shrink-0"
                      >
                        {copiedKey === 'public-url' ? (
                          <Check className="w-3.5 h-3.5 text-[#30a46c]" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between px-3 py-2 gap-2">
                  <span className="text-[#8c8c8c] shrink-0">Path Key</span>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-white text-[13px] truncate max-w-[150px]" title={selectedItem.fullKey}>
                      {selectedItem.fullKey}
                    </span>
                    <button
                      type="button"
                      onClick={() => onCopyText(selectedItem.fullKey, 'path-key')}
                      title="Copy path key"
                      className="text-[#777777] hover:text-white p-0.5 cursor-pointer shrink-0"
                    >
                      {copiedKey === 'path-key' ? (
                        <Check className="w-3.5 h-3.5 text-[#30a46c]" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-[#8c8c8c]">
                    {selectedItem.type === 'folder' ? 'Contents' : 'Payload Size'}
                  </span>
                  <span className="text-white tabular-nums">
                    {selectedItem.type === 'folder'
                      ? `${selectedItem.itemCount || 0} ${(selectedItem.itemCount || 0) === 1 ? 'object' : 'objects'} (${formatBytes(selectedItem.totalBytes || 0)})`
                      : formatBytes(selectedItem.size || 0)}
                  </span>
                </div>

                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-[#8c8c8c]">Storage Tier</span>
                  <span className="text-white font-medium">
                    {selectedItem.type === 'folder'
                      ? 'Virtual Directory'
                      : selectedItem.inline
                      ? 'LSM Inline (<64KB)'
                      : 'Disk Content Shard'}
                  </span>
                </div>

                {selectedItem.type === 'file' && selectedItem.created_at && (
                  <div className="flex items-center justify-between px-3 py-2">
                    <span className="text-[#8c8c8c]">Uploaded</span>
                    <span className="text-white tabular-nums text-[13px]">
                      {new Date(selectedItem.created_at * 1000).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Checksum & Cryptographic Integrity Card (Files Only) */}
            {selectedItem.type === 'file' && selectedItem.hash && (
              <div className="space-y-1">
                <div className="flex items-center justify-between px-0.5">
                  <span className="text-[13px] font-medium text-[#8c8c8c]">
                    BLAKE3 Integrity
                  </span>
                  <button
                    type="button"
                    onClick={() => onCopyText(selectedItem.hash!, 'blake3-hash')}
                    className="text-[13px] text-[#8c8c8c] hover:text-white cursor-pointer inline-flex items-center gap-1"
                  >
                    {copiedKey === 'blake3-hash' ? (
                      <>
                        <Check className="w-3 h-3 text-[#30a46c]" />
                        <span className="text-[#30a46c] font-medium">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy Hash</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="rounded-lg bg-[#111111] border border-[#222222] p-2.5 space-y-2">
                  <div className="p-2 rounded bg-[#0c0c0c] border border-[#1f1f1f] text-[12px] text-[#a1a1aa] break-all select-all leading-relaxed font-mono">
                    {selectedItem.hash}
                  </div>

                  <button
                    type="button"
                    onClick={() => onVerifyBlob(selectedItem.fullKey)}
                    disabled={verifyStatus === 'verifying'}
                    className={`w-full h-8 px-3 rounded-[6px] border text-[13px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                      verifyStatus === 'valid'
                        ? 'border-emerald-900/50 bg-emerald-950/20 text-emerald-400'
                        : verifyStatus === 'invalid'
                        ? 'border-rose-900/50 bg-rose-950/20 text-rose-400'
                        : 'border-[#262626] bg-[#141414] text-[#cccccc] hover:text-white hover:border-[#383838]'
                    }`}
                  >
                    {verifyStatus === 'verifying' ? (
                      <>
                        <RefreshCw className="w-3 h-3 animate-spin text-[#8c8c8c]" />
                        <span>Verifying Checksum...</span>
                      </>
                    ) : verifyStatus === 'valid' ? (
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
          <div className="space-y-3">
            <div className="p-3 rounded-lg bg-[#111111] border border-[#222222] space-y-1.5">
              <div className="flex items-center gap-2">
                <HardDrive className="w-3.5 h-3.5 text-blue-400" />
                <h4 className="text-sm font-medium text-white truncate">
                  {currentNsInfo ? currentNsInfo.name : activeNamespace || 'None'}
                </h4>
              </div>
              <p className="text-xs text-[#8c8c8c] leading-relaxed">
                Dedicated container boundary backed by content-addressed storage.
              </p>
            </div>

            {currentNsInfo && (
              <div className="rounded-lg bg-[#111111] border border-[#222222] divide-y divide-[#1a1a1a] text-[13.5px]">
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-[#8c8c8c]">Total Objects</span>
                  <span className="text-white tabular-nums">{currentNsInfo.total_objects}</span>
                </div>
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-[#8c8c8c]">Consumed Bytes</span>
                  <span className="text-white tabular-nums">{formatBytes(currentNsInfo.total_bytes)}</span>
                </div>
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-[#8c8c8c]">Allocated Quota</span>
                  <span className="text-white tabular-nums">
                    {currentNsInfo.max_bytes ? formatBytes(currentNsInfo.max_bytes) : 'Unlimited'}
                  </span>
                </div>
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
        <div className="relative w-full max-w-sm sm:max-w-md h-full z-10 animate-in slide-in-from-right duration-200">
          {panel}
        </div>
      </div>

      {/* Desktop Inline Sidebar (>= lg) */}
      <div className="hidden lg:flex h-full">
        {panel}
      </div>
    </>
  );
}
