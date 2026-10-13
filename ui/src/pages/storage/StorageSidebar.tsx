/*
 * Storage Navigator / Namespaces & Directory Sidebar.
 * Owned by: ui/pages/storage
 * Design reference: TableSidebar in TableEditor (exact design tokens & sizing)
 */

import React, { useRef, useState, useEffect } from 'react';
import {
  HardDrive,
  ChevronDown,
  Check,
  Plus,
  RefreshCw,
  Settings,
  FolderPlus,
  Upload,
} from 'lucide-react';
import { NamespaceInfo, BlobEntry } from '../../types';
import { StorageItem } from './types';
import { FileTree } from './FileTree';
import { formatBytes } from './format';
import { Skeleton } from '../../components/ui/Skeleton';

export interface StorageSidebarProps {
  namespaces: NamespaceInfo[];
  activeNamespace: string;
  onSelectNamespace: (ns: string) => void;
  onOpenNewNamespace: () => void;
  onOpenManageNamespace: () => void;
  onRefresh: () => void;
  isLoading: boolean;
  currentNsInfo: NamespaceInfo | null;
  quotaUsedPercent: number | null;
  realObjectsCount: number;

  // FileTree Props
  blobs: BlobEntry[];
  currentPrefix: string;
  selectedItem: StorageItem | null;
  onSelectFolder: (path: string) => void;
  onSelectFile: (fileItem: StorageItem) => void;
  onContextMenu: (e: React.MouseEvent, item: StorageItem | null) => void;
  onNewFolder: () => void;
  onUpload: () => void;
  draggedItem: StorageItem | null;
  onItemDragStart: (e: React.DragEvent, item: StorageItem) => void;
  onItemDragEnd: () => void;
  onDropOnFolder: (targetFolderKey: string) => void;
  canDropOnFolder: (dragged: StorageItem | null, targetFolderKey: string) => boolean;
}

export function StorageSidebar({
  namespaces,
  activeNamespace,
  onSelectNamespace,
  onOpenNewNamespace,
  onOpenManageNamespace,
  onRefresh,
  isLoading,
  currentNsInfo,
  quotaUsedPercent,
  realObjectsCount,
  blobs,
  currentPrefix,
  selectedItem,
  onSelectFolder,
  onSelectFile,
  onContextMenu,
  onNewFolder,
  onUpload,
  draggedItem,
  onItemDragStart,
  onItemDragEnd,
  onDropOnFolder,
  canDropOnFolder,
}: StorageSidebarProps) {
  const [isNsDropdownOpen, setIsNsDropdownOpen] = useState(false);
  const nsDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (nsDropdownRef.current && !nsDropdownRef.current.contains(e.target as Node)) {
        setIsNsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  return (
    <aside className="w-full lg:w-64 shrink-0 flex flex-col bg-[#0a0a0a] border-b lg:border-b-0 lg:border-r border-[#222222] overflow-hidden font-sans select-none">
      {/* ─── Header: Namespace Selector (h-[54px] matches TableSidebar) ─────────────── */}
      <div className="h-[54px] shrink-0 px-3 border-b border-[#222222] flex items-center justify-between gap-2 relative">
        <div className="relative flex-1 min-w-0" ref={nsDropdownRef}>
          <button
            type="button"
            onClick={() => setIsNsDropdownOpen(!isNsDropdownOpen)}
            className="w-full h-8 px-2.5 rounded-[6px] bg-[#141414] hover:bg-[#1a1a1a] border border-[#242424] hover:border-[#383838] flex items-center justify-between gap-2 text-left transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2 truncate min-w-0">
              <HardDrive className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              {isLoading && !activeNamespace ? (
                <Skeleton className="w-24 h-3.5" />
              ) : (
                <span className="text-[13px] font-medium text-white truncate">
                  {activeNamespace || 'Select Namespace'}
                </span>
              )}
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-[#777777] shrink-0" />
          </button>

          {/* Namespace Dropdown Popup */}
          {isNsDropdownOpen && (
            <div className="absolute left-0 top-full mt-1.5 w-60 bg-[#111111] border border-[#262626] rounded-[8px] shadow-2xl p-1 z-50 animate-in fade-in zoom-in-95 duration-100 font-sans">
              <div className="px-2.5 py-1.5 text-[12px] font-medium text-[#888888]">
                Storage Namespaces
              </div>

              <div className="max-h-52 overflow-y-auto space-y-0.5 py-0.5">
                {namespaces.length === 0 ? (
                  <div className="px-2.5 py-2 text-[12px] text-[#777777]">
                    No namespaces created yet.
                  </div>
                ) : (
                  namespaces.map((ns) => {
                    const isActive = ns.name === activeNamespace;
                    return (
                      <button
                        key={ns.name}
                        type="button"
                        onClick={() => {
                          onSelectNamespace(ns.name);
                          setIsNsDropdownOpen(false);
                        }}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-[6px] text-[13px] transition-colors cursor-pointer text-left ${
                          isActive
                            ? 'bg-[#1c1c1c] text-white font-medium'
                            : 'text-[#d4d4d4] hover:text-white hover:bg-[#161616]'
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate min-w-0">
                          <HardDrive className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-blue-400' : 'text-[#777777]'}`} />
                          <span className="truncate">{ns.name}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 text-[11px] text-[#777777]">
                          <span className="tabular-nums font-mono">{isActive && blobs.length > 0 ? realObjectsCount : ns.total_objects}</span>
                          {isActive && <Check className="w-3.5 h-3.5 text-white shrink-0" />}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              <div className="h-px bg-[#222222] my-1 -mx-1" />

              <button
                type="button"
                onClick={() => {
                  setIsNsDropdownOpen(false);
                  onOpenNewNamespace();
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[6px] text-[13px] text-white hover:bg-[#1a1a1a] transition-colors cursor-pointer text-left font-medium"
              >
                <Plus className="w-3.5 h-3.5 text-blue-400" />
                <span>New Namespace</span>
              </button>
            </div>
          )}
        </div>

        {/* Action icons: Settings & Refresh */}
        <div className="flex items-center gap-1 shrink-0">
          {activeNamespace && (
            <button
              type="button"
              onClick={onOpenManageNamespace}
              title="Manage Namespace Quota & Settings"
              className="w-8 h-8 flex items-center justify-center rounded-[6px] text-[#8c8c8c] hover:text-white hover:bg-[#161616] transition-colors cursor-pointer shrink-0"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            title="Refresh namespace & files"
            className="w-8 h-8 flex items-center justify-center rounded-[6px] text-[#8c8c8c] hover:text-white hover:bg-[#161616] transition-colors cursor-pointer shrink-0 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* ─── Actions Bar: New Folder & Upload Triggers ─────────────── */}
      <div className="p-2.5 flex items-center gap-1.5 border-b border-[#1c1c1c]">
        <button
          type="button"
          onClick={onNewFolder}
          disabled={!activeNamespace}
          title="Create virtual directory"
          className="flex-1 h-8 px-2.5 rounded-[6px] bg-[#141414] hover:bg-[#1a1a1a] border border-[#242424] hover:border-[#383838] flex items-center justify-center gap-1.5 text-[12px] font-medium text-[#cccccc] hover:text-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <FolderPlus className="w-3.5 h-3.5 text-[#8c8c8c]" />
          <span>New Folder</span>
        </button>

        <button
          type="button"
          onClick={onUpload}
          disabled={!activeNamespace}
          title="Upload file into current folder"
          className="h-8 px-3 rounded-[6px] bg-[#141414] hover:bg-[#1a1a1a] border border-[#242424] hover:border-[#383838] flex items-center justify-center gap-1.5 text-[12px] font-medium text-[#cccccc] hover:text-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Upload className="w-3.5 h-3.5 text-[#8c8c8c]" />
          <span>Upload</span>
        </button>
      </div>

      {/* ─── Directory & File Tree ─────────────── */}
      <div className="flex-1 overflow-hidden min-h-0 flex flex-col">
        <FileTree
          blobs={blobs}
          currentPrefix={currentPrefix}
          selectedItem={selectedItem}
          activeNamespace={activeNamespace}
          onSelectFolder={onSelectFolder}
          onSelectFile={onSelectFile}
          onContextMenu={onContextMenu}
          onNewFolder={onNewFolder}
          onUpload={onUpload}
          onRefresh={onRefresh}
          draggedItem={draggedItem}
          onItemDragStart={onItemDragStart}
          onItemDragEnd={onItemDragEnd}
          onDropOnFolder={onDropOnFolder}
          canDropOnFolder={canDropOnFolder}
          isLoading={isLoading}
        />
      </div>

      {/* ─── Footer: Storage Statistics & Quota ─────────────── */}
      <div className="h-12 shrink-0 px-3.5 border-t border-[#222222] flex items-center justify-between text-[12px] text-[#8c8c8c] select-none font-sans">
        <span className="tabular-nums font-mono">
          {realObjectsCount} {realObjectsCount === 1 ? 'object' : 'objects'}
        </span>

        {currentNsInfo && (
          <div className="flex items-center gap-2">
            <span className="tabular-nums font-mono text-[11px] text-[#777777]">
              {formatBytes(currentNsInfo.total_bytes)}
              {currentNsInfo.max_bytes ? ` / ${formatBytes(currentNsInfo.max_bytes)}` : ''}
            </span>
            {quotaUsedPercent !== null && (
              <span
                className={`text-[11px] tabular-nums font-medium ${
                  quotaUsedPercent > 90 ? 'text-rose-400' : 'text-[#8c8c8c]'
                }`}
              >
                ({quotaUsedPercent}%)
              </span>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
