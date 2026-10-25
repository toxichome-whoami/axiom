/*
 * Top Explorer Toolbar subcomponent for Storage page.
 * Owned by: ui/pages/storage
 * Design reference: TableToolbar in TableEditor (exact h-[54px] height, pill switcher, and clean dark borders)
 */

import React, { useState, useRef, useEffect } from 'react';
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
  Link as LinkIcon,
  Filter,
} from 'lucide-react';
import { StorageViewMode, StorageTierFilter, StorageTypeFilter, StorageItem } from './types';
import { NamespaceUsage } from '../../types';
import { formatBytes } from './format';
import { CustomSelect } from '../../components/shared/CustomSelect';

export interface StorageToolbarProps {
  activeNamespace: string;
  currentPrefix: string;
  breadcrumbSegments: Array<{ name: string; prefix: string }>;
  onNavigateToPrefix: (prefix: string) => void;
  viewMode: StorageViewMode;
  onViewModeChange: (mode: StorageViewMode) => void;
  tierFilter: StorageTierFilter;
  onTierFilterChange: (tier: StorageTierFilter) => void;
  typeFilter?: StorageTypeFilter;
  onTypeFilterChange?: (type: StorageTypeFilter) => void;
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
  onCreateUploadLink?: () => void;
  isPublic?: boolean;
  namespaceUsage?: NamespaceUsage | null;
  totalActiveTickets?: number;
  filterActiveLinksOnly?: boolean;
  onToggleFilterActiveLinks?: () => void;
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
  typeFilter = 'all',
  onTypeFilterChange,
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
  onCreateUploadLink,
  isPublic,
  namespaceUsage,
  totalActiveTickets,
  filterActiveLinksOnly,
  onToggleFilterActiveLinks,
}: StorageToolbarProps) {
  const [dragOverTargetKey, setDragOverTargetKey] = useState<string | null>(null);
  const [isUploadMenuOpen, setIsUploadMenuOpen] = useState(false);
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);
  const [draftType, setDraftType] = useState<StorageTypeFilter>(typeFilter || 'all');
  const [draftTier, setDraftTier] = useState<StorageTierFilter>(tierFilter);
  const uploadMenuRef = useRef<HTMLDivElement>(null);
  const filterMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isFilterMenuOpen) {
      setDraftType(typeFilter || 'all');
      setDraftTier(tierFilter);
    }
  }, [isFilterMenuOpen, typeFilter, tierFilter]);

  const activeFilterCount = (typeFilter && typeFilter !== 'all' ? 1 : 0) + (tierFilter !== 'all' ? 1 : 0);

  const handleApplyFilters = () => {
    onTypeFilterChange?.(draftType);
    onTierFilterChange(draftTier);
    setIsFilterMenuOpen(false);
  };

  const handleClearFilters = () => {
    setDraftType('all');
    setDraftTier('all');
    onTypeFilterChange?.('all');
    onTierFilterChange('all');
    setIsFilterMenuOpen(false);
  };

  useEffect(() => {
    if (!isFilterMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (filterMenuRef.current && !filterMenuRef.current.contains(e.target as Node)) {
        setIsFilterMenuOpen(false);
      }
    };
    const handleClose = () => setIsFilterMenuOpen(false);
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('resize', handleClose);
    window.addEventListener('scroll', handleClose, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('resize', handleClose);
      window.removeEventListener('scroll', handleClose, true);
    };
  }, [isFilterMenuOpen]);

  useEffect(() => {
    if (!isUploadMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (uploadMenuRef.current && !uploadMenuRef.current.contains(e.target as Node)) {
        setIsUploadMenuOpen(false);
      }
    };
    const handleClose = () => setIsUploadMenuOpen(false);
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('resize', handleClose);
    window.addEventListener('scroll', handleClose, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('resize', handleClose);
      window.removeEventListener('scroll', handleClose, true);
    };
  }, [isUploadMenuOpen]);

  return (
    <div className="h-[54px] shrink-0 px-3.5 border-b border-[#222222] bg-[#0c0c0c] flex items-center justify-between gap-3 select-none font-sans relative z-30 overflow-x-auto scrollbar-none whitespace-nowrap">
      {/* ─── Left: Interactive Breadcrumbs Navigator ─────────────── */}
      <div className="flex items-center gap-1.5 text-[13.5px] overflow-x-auto scrollbar-none min-w-0 shrink-0">
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
          className={`hover:text-white transition-colors cursor-pointer font-medium shrink-0 h-8 px-2.5 flex items-center gap-2 rounded-[6px] text-[13px] border ${
            dragOverTargetKey === ''
              ? 'bg-blue-600/30 text-blue-300 ring-1 ring-blue-500/60'
              : currentPrefix === ''
              ? 'text-white bg-[#141414] border-[#262626]'
              : 'text-[#8c8c8c]'
          }`}
        >
          <span>{activeNamespace || 'Root'}</span>
          {activeNamespace && (
            <span
              className={`px-2 py-0.5 rounded-[4px] text-[12px] font-sans font-medium leading-none ${
                isPublic
                  ? 'bg-[#161616] border border-[#2e2e2e] text-[#cccccc]'
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
                className={`hover:text-white transition-colors cursor-pointer font-medium truncate max-w-[220px] shrink-0 h-8 px-2.5 flex items-center rounded-[6px] text-[13px] border ${
                  isDropTarget
                    ? 'bg-blue-600/30 text-blue-300 ring-1 ring-blue-500/60'
                    : isLast
                    ? 'text-white bg-[#141414] border-[#262626]'
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
        <div className="relative w-36 sm:w-64 md:w-80">
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

        {/* Filters dropdown button & popover (Matches tools container design & edge-to-edge layout) */}
        {onTypeFilterChange && (
          <div className="relative" ref={filterMenuRef}>
            <button
              type="button"
              onClick={() => setIsFilterMenuOpen((prev) => !prev)}
              className={`flex items-center gap-1.5 h-8 px-2.5 rounded-[6px] border text-[13px] font-medium transition-colors cursor-pointer shrink-0 font-sans ${
                isFilterMenuOpen || activeFilterCount > 0
                  ? 'bg-[#1c1c1c] text-white border-[#383838]'
                  : 'bg-[#141414] text-[#cccccc] hover:text-white hover:bg-[#1c1c1c] border-[#262626] hover:border-[#383838]'
              }`}
              title="Filter storage files"
            >
              <Filter className={`w-3.5 h-3.5 ${activeFilterCount > 0 ? 'text-blue-400' : 'text-[#8c8c8c]'}`} />
              <span>Filters</span>
              {activeFilterCount > 0 && (
                <span className="text-[12px] text-blue-400 font-medium">
                  ({activeFilterCount})
                </span>
              )}
            </button>

            {isFilterMenuOpen && (() => {
              const rect = filterMenuRef.current?.getBoundingClientRect();
              const popoverWidth = Math.min(340, window.innerWidth - 24);
              const top = (rect?.bottom ?? 0) + 6;
              const left = Math.max(12, Math.min(window.innerWidth - popoverWidth - 12, (rect?.right ?? 0) - popoverWidth));
              return (
                <div
                  style={{ top: `${top}px`, left: `${left}px`, width: `${popoverWidth}px` }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleApplyFilters();
                  }}
                  className="fixed rounded-[8px] bg-[#0c0c0c] border border-[#262626] shadow-2xl p-4 z-50 select-none animate-in fade-in font-sans"
                >
                  {/* Header (Edge-to-edge dividing line) */}
                  <div className="flex items-center justify-between pb-3 -mx-4 px-4 -mt-1 border-b border-[#1f1f1f]">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-medium text-white font-sans">Storage Filters</span>
                      {activeFilterCount > 0 && (
                        <span className="text-[12px] text-[#8c8c8c] font-normal">
                          ({activeFilterCount} active)
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsFilterMenuOpen(false)}
                      className="text-[#888888] hover:text-white transition-colors cursor-pointer text-[14px] p-1 leading-none"
                      title="Close filters"
                    >
                      ✕
                    </button>
                  </div>

                  {/* Filter Fields (Edge-to-edge dividing line) */}
                  <div className="py-3.5 space-y-3.5 -mx-4 px-4 border-b border-[#1f1f1f]">
                    <div>
                      <label className="block text-[12px] font-medium text-[#8c8c8c] mb-1.5 font-sans">
                        File Type
                      </label>
                      <CustomSelect
                        size="sm"
                        value={draftType}
                        onChange={(val) => setDraftType(val as StorageTypeFilter)}
                        options={[
                          { value: 'all', label: 'All Files' },
                          { value: 'image', label: 'Images (PNG, JPG, WebP, SVG...)' },
                          { value: 'video', label: 'Videos (MP4, WebM, MOV...)' },
                          { value: 'audio', label: 'Audio (MP3, WAV, FLAC...)' },
                          { value: 'document', label: 'Documents (PDF, Office...)' },
                          { value: 'code', label: 'Code & Text (TS, Rust, JSON, SQL...)' },
                        ]}
                        menuWidth="w-full"
                      />
                    </div>

                    <div>
                      <label className="block text-[12px] font-medium text-[#8c8c8c] mb-1.5 font-sans">
                        Storage Tier
                      </label>
                      <CustomSelect
                        size="sm"
                        value={draftTier}
                        onChange={(val) => setDraftTier(val as StorageTierFilter)}
                        options={[
                          { value: 'all', label: 'All Storage Tiers' },
                          { value: 'inline', label: 'LSM Tree (Inline Blobs)' },
                          { value: 'disk', label: 'Disk Storage' },
                        ]}
                        menuWidth="w-full"
                      />
                    </div>
                  </div>

                  {/* Footer Controls */}
                  <div className="flex items-center justify-between pt-3 -mb-1 font-sans">
                    <div>
                      {(draftType !== 'all' || draftTier !== 'all' || (typeFilter && typeFilter !== 'all') || tierFilter !== 'all') && (
                        <button
                          type="button"
                          onClick={handleClearFilters}
                          className="text-[13px] text-[#888888] hover:text-white transition-colors cursor-pointer font-sans"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setIsFilterMenuOpen(false)}
                        className="h-8 px-3 rounded-[6px] text-[13px] text-[#8c8c8c] hover:text-white hover:bg-[#141414] transition-colors cursor-pointer font-sans"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleApplyFilters}
                        className="group relative flex shrink-0 items-center justify-center h-8 px-3.5 rounded-[6px] font-medium text-white shadow-xs outline-none cursor-pointer disabled:opacity-50 overflow-hidden ring-1 ring-[#1d4ed8] bg-[#2563eb] font-sans"
                      >
                        <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-[#3b82f6] to-[#2563eb] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]" />
                        <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black opacity-0 group-hover:opacity-15 transition-opacity duration-200" />
                        <span className="relative flex items-center gap-1.5 text-[13px] font-sans">
                          Apply filters
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* Storage Tier Filter Pill */}
        <div className="hidden md:flex items-center p-1 rounded-[7px] bg-[#141414] border border-[#262626] h-[35.99px]">
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

        {/* View Mode Switcher Pills */}
        <div className="flex items-center p-1 rounded-[7px] bg-[#141414] border border-[#262626] h-[35.99px]">
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
          <PanelRight className="w-4 h-4" />
        </button>

        {/* Active Capability Links Notification / Filter Pill */}
        {totalActiveTickets !== undefined && totalActiveTickets > 0 && onToggleFilterActiveLinks && (
          <button
            type="button"
            onClick={onToggleFilterActiveLinks}
            title={
              filterActiveLinksOnly
                ? 'Showing only objects with active share links. Click to show all.'
                : 'Filter to show objects with active capability share links'
            }
            className={`flex items-center gap-1.5 h-8 px-2.5 rounded-[6px] text-[12.5px] font-sans font-medium transition-colors cursor-pointer shrink-0 border ${
              filterActiveLinksOnly
                ? 'bg-blue-600 text-white border-blue-500 shadow-xs'
                : 'bg-blue-500/15 hover:bg-blue-500/25 text-blue-400 hover:text-blue-300 border-blue-500/30'
            }`}
          >
            <LinkIcon className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">
              {totalActiveTickets} Active {totalActiveTickets === 1 ? 'Link' : 'Links'}
            </span>
            <span className="sm:hidden font-mono text-[12px]">{totalActiveTickets}</span>
            {filterActiveLinksOnly && <X className="w-3.5 h-3.5 ml-0.5 shrink-0" />}
          </button>
        )}

        {/* Quick Share Link CTA Button */}
        {selectedFileItem && selectedFileItem.type === 'file' && onShareClick && (
          <button
            type="button"
            onClick={() => onShareClick(selectedFileItem)}
            title={`Share link for ${selectedFileItem.name}`}
            className="flex items-center gap-1.5 h-8 px-2.5 rounded-[6px] text-[13px] font-medium text-white bg-[#141414] hover:bg-[#1c1c1c] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer shrink-0"
          >
            <Share2 className="w-4 h-4 text-white" />
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
            <Upload className="w-4 h-4" />
            <span className="hidden sm:inline">Upload</span>
          </button>
          <button
            type="button"
            onClick={() => setIsUploadMenuOpen((prev) => !prev)}
            disabled={!activeNamespace}
            title="Upload options (files, folders for hosting)"
            aria-label="Upload options"
            className="flex items-center justify-center h-8 px-2 rounded-r-[6px] text-white bg-blue-600 hover:bg-blue-500 border-t border-b border-r border-l border-blue-500/80 border-l-blue-700/70 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed select-none"
          >
            <ChevronDown className="w-4 h-4" />
          </button>

          {/* Upload Dropdown Menu */}
          {isUploadMenuOpen && (() => {
            const rect = uploadMenuRef.current?.getBoundingClientRect();
            const top = (rect?.bottom ?? 0) + 4;
            const left = Math.max(8, Math.min(window.innerWidth - 176 - 8, (rect?.right ?? 0) - 176));
            return (
              <div
                style={{ top: `${top}px`, left: `${left}px` }}
                className="fixed w-44 bg-[#111111] border border-[#262626] rounded-[8px] shadow-2xl p-1 z-50 animate-in fade-in zoom-in-95 duration-100 font-sans"
              >
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
                  <FolderPlus className="w-3.5 h-3.5 text-[#8c8c8c] shrink-0" />
                  <span>Upload folder</span>
                </button>

                {onCreateUploadLink && (
                  <>
                    <div className="my-1 border-t border-[#1f1f1f]" />
                    <button
                      type="button"
                      onClick={() => {
                        setIsUploadMenuOpen(false);
                        onCreateUploadLink();
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[6px] text-[13px] text-[#cccccc] hover:text-white hover:bg-[#1a1a1a] transition-colors cursor-pointer text-left"
                    >
                      <LinkIcon className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span>Create upload link</span>
                    </button>
                  </>
                )}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
