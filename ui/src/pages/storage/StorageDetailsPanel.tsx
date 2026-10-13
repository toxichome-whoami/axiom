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
} from 'lucide-react';
import { StorageItem } from './types';
import { NamespaceInfo } from '../../types';
import { getFileIcon } from './fileIcon';
import { formatBytes } from './format';

export interface StorageDetailsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  selectedItem: StorageItem | null;
  activeNamespace: string;
  currentNsInfo: NamespaceInfo | null;
  onDownload: (key: string) => void;
  onOpenMove: (item: StorageItem) => void;
  onDelete: (item: StorageItem) => void;
  onVerifyBlob: (key: string) => Promise<void>;
  verifyStatus: 'verifying' | 'valid' | 'invalid' | undefined;
  onCopyText: (text: string, id: string) => void;
  copiedKey: string | null;
}

export function StorageDetailsPanel({
  isOpen,
  onClose,
  selectedItem,
  activeNamespace,
  currentNsInfo,
  onDownload,
  onOpenMove,
  onDelete,
  onVerifyBlob,
  verifyStatus,
  onCopyText,
  copiedKey,
}: StorageDetailsPanelProps) {
  const [isChecksumExpanded, setIsChecksumExpanded] = useState(true);

  if (!isOpen) return null;

  return (
    <aside className="w-80 lg:w-84 shrink-0 flex flex-col bg-[#0a0a0a] border-l border-[#222222] font-sans select-none overflow-hidden">
      {/* ─── Header: Fixed h-[54px] matching toolbar ─────────────── */}
      <div className="h-[54px] shrink-0 px-4 border-b border-[#222222] flex items-center justify-between">
        <h3 className="text-[13px] font-medium text-white truncate">
          {selectedItem ? 'Object Details' : 'Namespace Overview'}
        </h3>
        <button
          type="button"
          onClick={onClose}
          title="Close details inspector"
          className="p-1 rounded-[4px] text-[#777777] hover:text-white hover:bg-[#1a1a1a] transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ─── Content Area ─────────────── */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {selectedItem ? (
          <>
            {/* Hero Card */}
            <div className="p-4 rounded-[6px] bg-[#111111] border border-[#222222] flex flex-col items-center text-center">
              <div className="w-14 h-14 rounded-[8px] bg-[#161616] border border-[#262626] flex items-center justify-center mb-3">
                {selectedItem.type === 'folder' ? (
                  <Folder className="w-7 h-7 text-[#eab308]" />
                ) : (
                  getFileIcon(selectedItem.name, 'w-7 h-7')
                )}
              </div>

              <h4 className="text-[13px] font-medium text-white break-all max-w-full leading-snug">
                {selectedItem.name}
              </h4>
              <p className="text-[11px] text-[#777777] mt-1 font-mono truncate max-w-full">
                {selectedItem.type === 'folder'
                  ? 'Virtual Directory'
                  : selectedItem.content_type || 'application/octet-stream'}
              </p>

              {/* Quick Action Buttons */}
              <div className="flex items-center justify-center gap-1.5 mt-3 pt-3 border-t border-[#1c1c1c] w-full">
                {selectedItem.type === 'file' && (
                  <button
                    type="button"
                    onClick={() => onDownload(selectedItem.fullKey)}
                    className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[5px] text-[12px] font-medium text-[#cccccc] hover:text-white bg-[#161616] hover:bg-[#202020] border border-[#262626] transition-colors cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 text-[#8c8c8c]" />
                    <span>Download</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => onOpenMove(selectedItem)}
                  className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[5px] text-[12px] font-medium text-[#cccccc] hover:text-white bg-[#161616] hover:bg-[#202020] border border-[#262626] transition-colors cursor-pointer"
                >
                  <ArrowRight className="w-3.5 h-3.5 text-[#8c8c8c]" />
                  <span>Move</span>
                </button>

                <button
                  type="button"
                  onClick={() => onDelete(selectedItem)}
                  className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[5px] text-[12px] font-medium text-rose-400 hover:text-rose-300 bg-rose-950/20 hover:bg-rose-950/40 border border-rose-900/30 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete</span>
                </button>
              </div>
            </div>

            {/* Properties Group */}
            <div className="space-y-1.5 text-[13px]">
              <span className="text-[12px] font-medium text-[#888888] block px-0.5">
                Properties
              </span>

              <div className="rounded-[6px] bg-[#111111] border border-[#222222] divide-y divide-[#1a1a1a]">
                <div className="flex items-center justify-between p-2.5">
                  <span className="text-[#888888]">Namespace</span>
                  <span className="text-white font-medium">{activeNamespace}</span>
                </div>

                <div className="flex items-center justify-between p-2.5 gap-2">
                  <span className="text-[#777777] shrink-0">Path Key</span>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-white text-[11px] font-mono truncate max-w-[150px]" title={selectedItem.fullKey}>
                      {selectedItem.fullKey}
                    </span>
                    <button
                      type="button"
                      onClick={() => onCopyText(selectedItem.fullKey, 'path-key')}
                      title="Copy path key"
                      className="text-[#777777] hover:text-white p-0.5 cursor-pointer shrink-0"
                    >
                      {copiedKey === 'path-key' ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between p-2.5">
                  <span className="text-[#777777]">
                    {selectedItem.type === 'folder' ? 'Contents' : 'Payload Size'}
                  </span>
                  <span className="text-white tabular-nums font-mono">
                    {selectedItem.type === 'folder'
                      ? `${selectedItem.itemCount || 0} objects (${formatBytes(selectedItem.totalBytes || 0)})`
                      : formatBytes(selectedItem.size || 0)}
                  </span>
                </div>

                <div className="flex items-center justify-between p-2.5">
                  <span className="text-[#777777]">Storage Tier</span>
                  <span className="text-white font-medium">
                    {selectedItem.type === 'folder'
                      ? 'Virtual Directory'
                      : selectedItem.inline
                      ? 'Fjall LSM Inline (<64KB)'
                      : 'Disk Content Shard'}
                  </span>
                </div>

                {selectedItem.type === 'file' && selectedItem.created_at && (
                  <div className="flex items-center justify-between p-2.5">
                    <span className="text-[#777777]">Uploaded</span>
                    <span className="text-white tabular-nums font-mono text-[11px]">
                      {new Date(selectedItem.created_at * 1000).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Checksum & Cryptographic Integrity Card (Files Only) */}
            {selectedItem.type === 'file' && selectedItem.hash && (
              <div className="space-y-1.5 text-[13px]">
                <div className="flex items-center justify-between px-0.5">
                  <span className="text-[12px] font-medium text-[#888888]">
                    BLAKE3 Integrity
                  </span>
                  <button
                    type="button"
                    onClick={() => onCopyText(selectedItem.hash!, 'blake3-hash')}
                    className="text-[11px] text-[#8c8c8c] hover:text-white cursor-pointer inline-flex items-center gap-1"
                  >
                    {copiedKey === 'blake3-hash' ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span className="text-emerald-400">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy Hash</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="rounded-[6px] bg-[#111111] border border-[#222222] p-2.5 space-y-2.5">
                  <div className="p-2 rounded-[4px] bg-[#0c0c0c] border border-[#1f1f1f] font-mono text-[10.5px] text-[#a1a1aa] break-all select-all leading-relaxed">
                    {selectedItem.hash}
                  </div>

                  <button
                    type="button"
                    onClick={() => onVerifyBlob(selectedItem.fullKey)}
                    disabled={verifyStatus === 'verifying'}
                    className={`w-full py-1.5 px-2.5 rounded-[5px] border text-[12px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
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
          <div className="space-y-4 text-[12px]">
            <div className="p-4 rounded-[6px] bg-[#111111] border border-[#222222] space-y-2">
              <div className="flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-blue-400" />
                <h4 className="text-[13px] font-medium text-white truncate">
                  {currentNsInfo ? currentNsInfo.name : activeNamespace || 'None'}
                </h4>
              </div>
              <p className="text-[11px] text-[#777777] leading-relaxed">
                Dedicated container boundary backed by content-addressed storage.
              </p>
            </div>

            {currentNsInfo && (
              <div className="rounded-[6px] bg-[#111111] border border-[#222222] divide-y divide-[#1a1a1a]">
                <div className="flex items-center justify-between p-2.5">
                  <span className="text-[#777777]">Total Objects</span>
                  <span className="text-white font-mono tabular-nums">{currentNsInfo.total_objects}</span>
                </div>
                <div className="flex items-center justify-between p-2.5">
                  <span className="text-[#777777]">Consumed Bytes</span>
                  <span className="text-white font-mono tabular-nums">{formatBytes(currentNsInfo.total_bytes)}</span>
                </div>
                <div className="flex items-center justify-between p-2.5">
                  <span className="text-[#777777]">Allocated Quota</span>
                  <span className="text-white font-mono tabular-nums">
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
}
