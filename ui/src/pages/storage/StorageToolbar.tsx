/*
 * Top Explorer Toolbar subcomponent for Storage page.
 * Owned by: ui/pages/storage
 * Design reference: TableToolbar in TableEditor (exact h-[54px] height, pill switcher, and clean dark borders)
 */

import React, { useState } from 'react';
import {
  ChevronRight,
  Upload,
  Search,
  LayoutGrid,
  List as ListIcon,
  PanelRight,
  SlidersHorizontal,
  X,
  Share2,
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
  isDetailsOpen: boolean;
  onToggleDetails: () => void;
  canDropOnFolder: (dragged: StorageItem | null, targetFolderKey: string) => boolean;
  draggedItemRef: React.MutableRefObject<StorageItem | null>;
  onDropOnFolder: (targetFolderKey: string, item?: StorageItem) => void;
  selectedFileItem?: StorageItem | null;
  onShareClick?: (item: StorageItem) => void;
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
  isDetailsOpen,
  onToggleDetails,
  canDropOnFolder,
  draggedItemRef,
  onDropOnFolder,
  selectedFileItem,
  onShareClick,
}: StorageToolbarProps) {
  const [dragOverTargetKey, setDragOverTargetKey] = useState<string | null>(null);

  return (
    <div className="h-[54px] shrink-0 px-4 border-b border-[#222222] bg-[#0c0c0c] flex items-center justify-between gap-3 select-none font-sans">
      {/* ─── Left: Interactive Breadcrumbs Navigator ─────────────── */}
      <div className="flex items-center gap-1 text-[13px] overflow-x-auto scrollbar-none min-w-0 py-0.5">
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
          className={`hover:text-white transition-colors cursor-pointer font-medium shrink-0 h-7 px-2 flex items-center rounded-[5px] ${
            dragOverTargetKey === ''
              ? 'bg-blue-600/30 text-blue-300 ring-1 ring-blue-500/60'
              : currentPrefix === ''
              ? 'text-white bg-[#1a1a1a]'
              : 'text-[#8c8c8c]'
          }`}
        >
          {activeNamespace || 'Root'}
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
                className={`hover:text-white transition-colors cursor-pointer font-medium truncate max-w-[160px] shrink-0 h-7 px-2 flex items-center rounded-[5px] ${
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
      <div className="flex items-center gap-2 shrink-0">
        {/* Live Search Input (32px / h-8 matching Table page) */}
        <div className="relative w-40 sm:w-52">
          <Search className="w-3.5 h-3.5 text-[#666666] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search files..."
            className="w-full h-8 pl-8 pr-6 rounded-[6px] bg-[#141414] border border-[#242424] focus:border-[#383838] text-[13px] text-white placeholder-[#666666] outline-none transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#777777] hover:text-white p-0.5 cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Storage Tier Filter Pill (32px / h-8) */}
        <div className="flex items-center p-0.5 rounded-[6px] bg-[#141414] border border-[#262626] h-8">
          <button
            type="button"
            onClick={() => onTierFilterChange('all')}
            className={`px-2.5 py-0.5 rounded-[4px] text-[12px] font-medium transition-colors cursor-pointer ${
              tierFilter === 'all'
                ? 'bg-[#222222] text-white shadow-xs'
                : 'text-[#8c8c8c] hover:text-white'
            }`}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => onTierFilterChange('inline')}
            className={`px-2.5 py-0.5 rounded-[4px] text-[12px] font-medium transition-colors cursor-pointer ${
              tierFilter === 'inline'
                ? 'bg-[#222222] text-white shadow-xs'
                : 'text-[#8c8c8c] hover:text-white'
            }`}
          >
            LSM
          </button>
          <button
            type="button"
            onClick={() => onTierFilterChange('disk')}
            className={`px-2.5 py-0.5 rounded-[4px] text-[12px] font-medium transition-colors cursor-pointer ${
              tierFilter === 'disk'
                ? 'bg-[#222222] text-white shadow-xs'
                : 'text-[#8c8c8c] hover:text-white'
            }`}
          >
            Disk
          </button>
        </div>

        {/* View Mode Switcher Pills (32px / h-8) */}
        <div className="flex items-center p-0.5 rounded-[6px] bg-[#141414] border border-[#262626] h-8">
          <button
            type="button"
            onClick={() => onViewModeChange('grid')}
            title="Grid View"
            className={`flex items-center justify-center w-7 h-7 rounded-[4px] transition-colors cursor-pointer ${
              viewMode === 'grid'
                ? 'bg-[#222222] text-white shadow-xs'
                : 'text-[#8c8c8c] hover:text-white'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange('list')}
            title="Table View"
            className={`flex items-center justify-center w-7 h-7 rounded-[4px] transition-colors cursor-pointer ${
              viewMode === 'list'
                ? 'bg-[#222222] text-white shadow-xs'
                : 'text-[#8c8c8c] hover:text-white'
            }`}
          >
            <ListIcon className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Inspector Panel Toggle Button (32px / w-8 h-8 matching Table page) */}
        <button
          type="button"
          onClick={onToggleDetails}
          title={isDetailsOpen ? 'Hide Details Panel' : 'Show Details Panel'}
          className={`flex items-center justify-center w-8 h-8 rounded-[6px] border transition-colors cursor-pointer ${
            isDetailsOpen
              ? 'bg-[#1c1c1c] text-white border-[#383838]'
              : 'bg-[#141414] text-[#8c8c8c] hover:text-white border-[#242424] hover:border-[#383838]'
          }`}
        >
          <PanelRight className="w-3.5 h-3.5" />
        </button>

        {/* Quick Share Link CTA Button (active when single file is selected) */}
        {selectedFileItem && selectedFileItem.type === 'file' && onShareClick && (
          <button
            type="button"
            onClick={() => onShareClick(selectedFileItem)}
            title={`Share link for ${selectedFileItem.name}`}
            className="flex items-center gap-1.5 h-8 px-2.5 rounded-[6px] text-[13px] font-medium text-white bg-[#F6821F] hover:bg-[#e0751b] border border-[#F6821F]/80 transition-colors cursor-pointer shrink-0 shadow-xs"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Share</span>
          </button>
        )}

        {/* Direct Upload CTA Button (32px / h-8 matching Table page Insert/Run buttons) */}
        <button
          type="button"
          onClick={onUploadClick}
          disabled={!activeNamespace}
          title="Upload file into current directory"
          className="flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[13px] font-medium text-white bg-blue-600 hover:bg-blue-500 border border-blue-500/80 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0 shadow-xs"
        >
          <Upload className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Upload</span>
        </button>
      </div>
    </div>
  );
}
