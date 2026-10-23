/*
 * Top Explorer Toolbar subcomponent for Storage page.
 * Owned by: ui/pages/storage
 * Design reference: TableToolbar in TableEditor (exact h-[54px] height, pill switcher, and clean dark borders)
 */

import React, { useState } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Upload,
  Search,
  LayoutGrid,
  List as ListIcon,
  PanelRight,
  X,
  Share2,
  FolderPlus,
  Files,
} from 'lucide-react';
import { StorageViewMode, StorageTierFilter, StorageItem } from './types';

export interface StorageToolbarProps {
  activeNamespace: string;
  currentPrefix: string;
  breadcrumbSegments: Array<{ name: string; prefix: string }>;
  onNavigateToPrefix: (prefix: string) => void;
  viewMode: StorageViewMode;
  onViewModeChange: (mode: StorageViewMode) => void;
  tierFilter: StorageTierFilter;
  onTierFilterChange: (tier: StorageTierFilter) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onUploadClick: () => void;
  onUploadFolderClick?: () => void;
  isDetailsOpen: boolean;
  onToggleDetails: () => void;
  canDropOnFolder: (dragged: StorageItem | null, targetFolderKey: string) => boolean;
  draggedItemRef: React.MutableRefObject<StorageItem | null>;
  onDropOnFolder: (targetFolderKey: string, item?: StorageItem) => void;
  selectedFileItem?: StorageItem | null;
  onShareClick?: (item: StorageItem) => void;
  isPublic?: boolean;
}

export function StorageToolbar({
  activeNamespace,
  currentPrefix,
  breadcrumbSegments,
  onNavigateToPrefix,
  viewMode,
  onViewModeChange,
  tierFilter,
  onTierFilterChange,
  searchQuery,
  onSearchChange,
  onUploadClick,
  onUploadFolderClick,
  isDetailsOpen,
  onToggleDetails,
  canDropOnFolder,
  draggedItemRef,
  onDropOnFolder,
  selectedFileItem,
  onShareClick,
  isPublic,
}: StorageToolbarProps) {
  const [dragOverTargetKey, setDragOverTargetKey] = useState<string | null>(null);
  const [isUploadMenuOpen, setIsUploadMenuOpen] = useState(false);
  const uploadMenuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!isUploadMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (uploadMenuRef.current && !uploadMenuRef.current.contains(e.target as Node)) {
        setIsUploadMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isUploadMenuOpen]);

  return (
    <div className="h-[54px] shrink-0 px-4 border-b border-[#222222] bg-[#0c0c0c] flex items-center justify-between gap-3 select-none font-sans relative z-30">
      {/* ─── Left: Interactive Breadcrumbs Navigator ─────────────── */}
      <div className="flex items-center gap-1.5 text-sm overflow-x-auto scrollbar-none min-w-0 py-0.5">
        <button
          type="button"
          onClick={() => onNavigateToPrefix('')}
          onDragOver={(e) => {
            if (draggedItemRef.current && canDropOnFolder(draggedItemRef.current, '')) {
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = 'move';
              if (dragOverTargetKey !== '') {
                setDragOverTargetKey('');
              }
            }
          }}
          onDragLeave={(e) => {
            e.stopPropagation();
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              if (dragOverTargetKey === '') {
                setDragOverTargetKey(null);
              }
            }
          }}
          onDrop={async (e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOverTargetKey(null);
            if (draggedItemRef.current) {
              await onDropOnFolder('', draggedItemRef.current);
            }
          }}
          className={`hover:text-white transition-colors cursor-pointer font-medium shrink-0 h-8 px-2.5 flex items-center gap-2 rounded-[6px] text-[13px] ${
            dragOverTargetKey === ''
              ? 'bg-blue-600/30 text-blue-300 ring-1 ring-blue-500/60'
              : currentPrefix === ''
              ? 'text-white bg-[#1a1a1a]'
              : 'text-[#8c8c8c]'
          }`}
        >
          <span>{activeNamespace || 'Root'}</span>
          {activeNamespace && (
            <span
              className={`px-1.5 py-0.5 rounded-[4px] text-[11px] font-medium ${
                isPublic
                  ? 'bg-[#30a46c]/15 border border-[#30a46c]/30 text-[#30a46c]'
                  : 'bg-[#161616] border border-[#262626] text-[#8c8c8c]'
              }`}
            >
              {isPublic ? 'Public' : 'Private'}
            </span>
          )}
        </button>

        {breadcrumbSegments.map((seg, idx) => {
          const isLast = idx === breadcrumbSegments.length - 1;
          const isDropTarget = dragOverTargetKey === seg.prefix;
          return (
            <React.Fragment key={seg.prefix}>
              <ChevronRight className="w-3.5 h-3.5 text-[#555555] shrink-0" />
              <button
                type="button"
                onClick={() => onNavigateToPrefix(seg.prefix)}
                onDragOver={(e) => {
                  if (draggedItemRef.current && canDropOnFolder(draggedItemRef.current, seg.prefix)) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = 'move';
                    if (dragOverTargetKey !== seg.prefix) {
                      setDragOverTargetKey(seg.prefix);
                    }
                  }
                }}
                onDragLeave={(e) => {
                  e.stopPropagation();
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    if (dragOverTargetKey === seg.prefix) {
                      setDragOverTargetKey(null);
                    }
                  }
                }}
                onDrop={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragOverTargetKey(null);
                  if (draggedItemRef.current) {
                    await onDropOnFolder(seg.prefix, draggedItemRef.current);
                  }
                }}
                className={`hover:text-white transition-colors cursor-pointer font-medium truncate max-w-[180px] shrink-0 h-8 px-2.5 flex items-center rounded-[6px] text-[13px] ${
                  isDropTarget
                    ? 'bg-blue-600/30 text-blue-300 ring-1 ring-blue-500/60'
                    : isLast
                    ? 'text-white bg-[#1a1a1a]'
                    : 'text-[#8c8c8c]'
                }`}
              >
                {seg.name}
              </button>
            </React.Fragment>
          );
        })}
      </div>

      {/* ─── Right: Search, Filter, View Mode, Details Toggle, Upload ─────────────── */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {/* Live Search Input */}
        <div className="relative w-28 sm:w-44 md:w-56">
          <Search className="w-3.5 h-3.5 text-[#8c8c8c] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search..."
            className="w-full h-8 pl-8 pr-7 rounded-[6px] bg-[#141414] border border-[#262626] focus:border-[#383838] text-[13px] text-white placeholder-[#8c8c8c] outline-none transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8c8c8c] hover:text-white p-0.5 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Storage Tier Filter Pill (Hidden on narrow screens to prevent overflow) */}
        <div className="hidden md:flex items-center p-1 rounded-[7px] bg-[#141414] border border-[#262626] h-9">
          <button
            type="button"
            onClick={() => onTierFilterChange('all')}
            className={`px-3 py-1 rounded-[5px] text-[13px] font-medium transition-colors cursor-pointer ${
              tierFilter === 'all'
                ? 'bg-[#222222] text-white shadow-sm'
                : 'text-[#8c8c8c] hover:text-white'
            }`}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => onTierFilterChange('inline')}
            className={`px-3 py-1 rounded-[5px] text-[13px] font-medium transition-colors cursor-pointer ${
              tierFilter === 'inline'
                ? 'bg-[#222222] text-white shadow-sm'
                : 'text-[#8c8c8c] hover:text-white'
            }`}
          >
            LSM
          </button>
          <button
            type="button"
            onClick={() => onTierFilterChange('disk')}
            className={`px-3 py-1 rounded-[5px] text-[13px] font-medium transition-colors cursor-pointer ${
              tierFilter === 'disk'
                ? 'bg-[#222222] text-white shadow-sm'
                : 'text-[#8c8c8c] hover:text-white'
            }`}
          >
            Disk
          </button>
        </div>

        {/* View Mode Switcher Pills (Matching TableToolbar design system, h-9 tabs, 13px font) */}
        <div className="flex items-center p-1 rounded-[7px] bg-[#141414] border border-[#262626] h-9">
          <button
            type="button"
            onClick={() => onViewModeChange('grid')}
            title="Grid View"
            className={`flex items-center gap-1.5 px-3 py-1 rounded-[5px] text-[13px] font-medium transition-colors cursor-pointer ${
              viewMode === 'grid'
                ? 'bg-[#222222] text-white shadow-sm'
                : 'text-[#8c8c8c] hover:text-white'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Grid</span>
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange('list')}
            title="Table View"
            className={`flex items-center gap-1.5 px-3 py-1 rounded-[5px] text-[13px] font-medium transition-colors cursor-pointer ${
              viewMode === 'list'
                ? 'bg-[#222222] text-white shadow-sm'
                : 'text-[#8c8c8c] hover:text-white'
            }`}
          >
            <ListIcon className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Table</span>
          </button>
        </div>

        {/* Inspector Panel Toggle Button */}
        <button
          type="button"
          onClick={onToggleDetails}
          title={isDetailsOpen ? 'Hide Details Panel' : 'Show Details Panel'}
          className={`flex items-center justify-center w-8 h-8 rounded-[6px] border transition-colors cursor-pointer ${
            isDetailsOpen
              ? 'bg-[#1c1c1c] text-white border-[#383838]'
              : 'bg-[#141414] text-[#8c8c8c] hover:text-white border-[#262626] hover:border-[#383838]'
          }`}
        >
          <PanelRight className="w-3.5 h-3.5" />
        </button>

        {/* Quick Share Link CTA Button */}
        {selectedFileItem && selectedFileItem.type === 'file' && onShareClick && (
          <button
            type="button"
            onClick={() => onShareClick(selectedFileItem)}
            title={`Share link for ${selectedFileItem.name}`}
            className="flex items-center gap-1.5 h-8 px-2.5 rounded-[6px] text-[13px] font-medium text-white bg-[#141414] hover:bg-[#1c1c1c] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer shrink-0"
          >
            <Share2 className="w-3.5 h-3.5 text-white" />
            <span className="hidden sm:inline">Share</span>
          </button>
        )}

        {/* Direct Upload CTA Button with Dropdown for Folder & Multi-file Upload */}
        <div className="relative inline-flex items-center shrink-0" ref={uploadMenuRef}>
          <button
            type="button"
            onClick={onUploadClick}
            disabled={!activeNamespace}
            title="Upload files into current directory"
            className="flex items-center gap-1.5 h-8 px-3 rounded-l-[6px] text-[13px] font-medium text-white bg-blue-600 hover:bg-blue-500 border border-blue-500/80 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Upload className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Upload</span>
          </button>
          <button
            type="button"
            onClick={() => setIsUploadMenuOpen((prev) => !prev)}
            disabled={!activeNamespace}
            title="Upload options (files, folders for hosting)"
            aria-label="Upload options"
            className="flex items-center justify-center h-8 px-2.5 rounded-r-[6px] text-white bg-blue-600 hover:bg-blue-500 border-t border-b border-r border-l border-blue-500/80 border-l-blue-700/70 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed select-none"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>

          {/* Upload Dropdown Menu */}
          {isUploadMenuOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-44 bg-[#111111] border border-[#262626] rounded-[8px] shadow-2xl p-1 z-50 animate-in fade-in zoom-in-95 duration-100 font-sans">
              <button
                type="button"
                onClick={() => {
                  setIsUploadMenuOpen(false);
                  onUploadClick();
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[6px] text-[13px] text-[#cccccc] hover:text-white hover:bg-[#1a1a1a] transition-colors cursor-pointer text-left"
              >
                <Files className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                <span>Upload files</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsUploadMenuOpen(false);
                  onUploadFolderClick ? onUploadFolderClick() : onUploadClick();
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[6px] text-[13px] text-[#cccccc] hover:text-white hover:bg-[#1a1a1a] transition-colors cursor-pointer text-left"
              >
                <FolderPlus className="w-3.5 h-3.5 text-[#eab308] shrink-0" />
                <span>Upload folder</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
