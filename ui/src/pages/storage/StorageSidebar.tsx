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
  Settings,
} from 'lucide-react';
import { NamespaceInfo, BlobEntry } from '../../types';
import { StorageItem } from './types';
import { FileTree } from './FileTree';
import { formatBytes } from './format';
import { Skeleton } from '../../components/ui/Skeleton';

export interface StorageSidebarProps {
  width?: number;
  onResizeStart?: (e: React.MouseEvent) => void;
  namespaces: NamespaceInfo[];
  activeNamespace: string;
  onSelectNamespace: (ns: string) => void;
  onOpenNewNamespace?: () => void;
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
  selectedKeys?: Set<string>;
  onToggleSelectItem?: (item: StorageItem, e: React.MouseEvent) => void;
  onSelectFolder: (path: string, item?: StorageItem | null) => void;
  onSelectFile: (fileItem: StorageItem) => void;
  onContextMenu: (e: React.MouseEvent, item: StorageItem | null) => void;
  onNewFolder: () => void;
  onUpload: () => void;
  draggedItem: StorageItem | null;
  onItemDragStart: (e: React.DragEvent, item: StorageItem) => void;
  onItemDragEnd: () => void;
  onDropOnFolder: (targetFolderKey: string) => void;
  canDropOnFolder: (dragged: StorageItem | null, targetFolderKey: string) => boolean;
  onClearSelection?: () => void;
}

export function StorageSidebar({
  width,
  onResizeStart,
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
  selectedKeys,
  onToggleSelectItem,
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
  onClearSelection,
}: StorageSidebarProps) {
  const [isNsDropdownOpen, setIsNsDropdownOpen] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
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
    <aside
      style={{ width: isMobileOpen ? '100%' : width ? `${width}px` : undefined }}
      className="w-full lg:w-64 shrink-0 flex flex-col bg-[#0a0a0a] border-b lg:border-b-0 lg:border-r border-[#222222] overflow-hidden font-sans select-none relative"
    >
      {/* Draggable Resize Handle on Right Border */}
      {onResizeStart && (
        <div
          onMouseDown={onResizeStart}
          title="Drag to resize sidebar"
          className="hidden lg:block absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-500/50 active:bg-blue-500 transition-colors z-30 select-none group"
        >
          <div className="w-full h-full" />
        </div>
      )}
      {/* ─── Header: Namespace Selector (h-[54px] aligned with StorageToolbar & TableSidebar) ─────────────── */}
      <div className="h-[54px] shrink-0 px-3 border-b border-[#222222] flex items-center justify-between gap-2 relative">
        <div className="relative flex-1 min-w-0" ref={nsDropdownRef}>
          <button
            type="button"
            onClick={() => setIsNsDropdownOpen(!isNsDropdownOpen)}
            className="w-full h-9 px-2.5 rounded-[7px] bg-[#141414] hover:bg-[#1a1a1a] border border-[#242424] hover:border-[#383838] flex items-center justify-between gap-2 text-left transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-1.5 truncate min-w-0">
              <HardDrive className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              {isLoading && !activeNamespace ? (
                <Skeleton className="w-24 h-3.5" />
              ) : (
                <>
                  <span className="text-sm font-medium text-white truncate">
                    {activeNamespace || 'Select Namespace'}
                  </span>
                  {currentNsInfo?.is_public && (
                    <span className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-[#30a46c]/15 border border-[#30a46c]/30 text-[#30a46c] shrink-0">
                      Public
                    </span>
                  )}
                </>
              )}
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-[#777777] shrink-0" />
          </button>

          {/* Namespace Dropdown Popup */}
          {isNsDropdownOpen && (
            <div className="absolute left-0 top-full mt-1.5 w-60 bg-[#111111] border border-[#262626] rounded-[8px] shadow-2xl p-1 z-50 animate-in fade-in zoom-in-95 duration-100 font-sans">
              <div className="px-2.5 py-1.5 text-xs font-medium text-[#888888] select-none flex items-center justify-between">
                <span>Storage Namespaces</span>
                <span className="text-[11px] font-mono text-[#666666]">{namespaces.length}</span>
              </div>

              <div className="max-h-52 overflow-y-auto space-y-0.5 py-0.5">
                {namespaces.length === 0 ? (
                  <div className="px-2.5 py-2 text-xs text-[#777777]">No namespaces found</div>
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
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-[6px] text-xs transition-colors cursor-pointer text-left ${
                          isActive
                            ? 'bg-[#1a1a1a] text-white font-medium'
                            : 'text-[#cccccc] hover:bg-[#161616] hover:text-white'
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate min-w-0">
                          <HardDrive className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-blue-400' : 'text-[#777777]'}`} />
                          <span className="truncate">{ns.name}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 ml-2">
                          {ns.is_public && (
                            <span className="px-1 py-0.2 rounded text-[10px] bg-[#30a46c]/15 text-[#30a46c]">
                              pub
                            </span>
                          )}
                          {isActive && <Check className="w-3.5 h-3.5 text-white shrink-0" />}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* Action icons: Settings & Create Namespace + Mobile Collapse Toggle */}
        <div className="flex items-center gap-1 shrink-0">
          {activeNamespace && (
            <button
              type="button"
              onClick={onOpenManageNamespace}
              title="Manage Namespace Quota & Settings"
              className="w-9 h-9 flex items-center justify-center rounded-[7px] text-[#8c8c8c] hover:text-white hover:bg-[#161616] transition-colors cursor-pointer shrink-0"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={onOpenNewNamespace}
            title="Create new namespace"
            className="w-9 h-9 flex items-center justify-center rounded-[7px] text-[#8c8c8c] hover:text-white hover:bg-[#161616] transition-colors cursor-pointer shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>

          {/* Mobile expand/collapse toggle for tree view */}
          <button
            type="button"
            onClick={() => setIsMobileOpen(!isMobileOpen)}
            title={isMobileOpen ? 'Collapse Explorer Tree' : 'Expand Explorer Tree'}
            aria-label={isMobileOpen ? 'Collapse Explorer Tree' : 'Expand Explorer Tree'}
            className="w-9 h-9 flex items-center justify-center rounded-[7px] text-[#8c8c8c] hover:text-white hover:bg-[#161616] lg:hidden transition-colors cursor-pointer shrink-0"
          >
            <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isMobileOpen ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {/* ─── Directory & File Tree (collapsible on mobile, always visible on lg+) ─────────────── */}
      <div className={`flex-1 overflow-hidden min-h-0 flex-col ${isMobileOpen ? 'flex' : 'hidden lg:flex'}`}>
        <FileTree
          blobs={blobs}
          currentPrefix={currentPrefix}
          selectedItem={selectedItem}
          selectedKeys={selectedKeys}
          activeNamespace={activeNamespace}
          onSelectFolder={(path, item) => {
            onSelectFolder(path, item);
            setIsMobileOpen(false);
          }}
          onSelectFile={(fileItem) => {
            onSelectFile(fileItem);
            setIsMobileOpen(false);
          }}
          onToggleSelectItem={onToggleSelectItem}
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
          onClearSelection={onClearSelection}
        />
      </div>

      {/* ─── Footer: Storage Statistics & Quota ─────────────── */}
      <div className={`h-10 shrink-0 px-3.5 border-t border-[#222222] items-center justify-between text-xs text-[#cccccc] select-none font-sans ${isMobileOpen ? 'flex' : 'hidden lg:flex'}`}>
        <span className="tabular-nums">
          {realObjectsCount} {realObjectsCount === 1 ? 'object' : 'objects'}
        </span>

        {currentNsInfo && (
          <div className="flex items-center gap-1.5">
            <span className="tabular-nums text-xs text-[#888888]">
              {formatBytes(currentNsInfo.total_bytes)}
              {currentNsInfo.max_bytes ? ` / ${formatBytes(currentNsInfo.max_bytes)}` : ''}
            </span>
            {quotaUsedPercent !== null && (
              <span
                className={`text-xs tabular-nums font-medium ${
                  quotaUsedPercent > 90 ? 'text-rose-400' : 'text-[#888888]'
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
