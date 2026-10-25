/*
 * Dense data table list view subcomponent for Storage objects and folders.
 * Owned by: ui/pages/storage
 * Design reference: TableGridView in TableEditor (exact row height, border colors, tabular fonts, custom checkbox buttons)
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Folder,
  ArrowRight,
  Download,
  Trash2,
  MoreVertical,
  Check,
  Minus,
  Loader2,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
} from 'lucide-react';
import { StorageItem } from './types';
import { getFileIcon } from './fileIcon';
import { formatBytes } from './format';

export type StorageSortField = 'name' | 'tier' | 'size' | 'updated';
export type StorageSortDirection = 'asc' | 'desc';

export interface StorageListViewProps {
  folderItems: StorageItem[];
  fileItems: StorageItem[];
  selectedItem: StorageItem | null;
  selectedKeys?: Set<string>;
  onSelectItem: (item: StorageItem) => void;
  onToggleSelectItem?: (item: StorageItem, e: React.MouseEvent) => void;
  onSelectAll?: () => void;
  onNavigateToPrefix: (prefix: string) => void;
  onContextMenu: (e: React.MouseEvent, item: StorageItem) => void;
  onDownload: (key: string) => void;
  onPreviewItem?: (item: StorageItem) => void;
  onOpenMove: (item: StorageItem) => void;
  onDelete: (item: StorageItem) => void;

  // Drag and drop
  draggedItem: StorageItem | null;
  draggedItemRef: React.MutableRefObject<StorageItem | null>;
  onItemDragStart: (e: React.DragEvent, item: StorageItem) => void;
  onItemDragEnd: () => void;
  onDropOnFolder: (targetFolderKey: string, droppedItem?: StorageItem) => void;
  onUploadFiles?: (files: FileList | File[], destinationPrefix?: string) => void;
  canDropOnFolder: (dragged: StorageItem | null, targetFolderKey: string) => boolean;
  onClearSelection?: () => void;

  // Pagination & Lazy loading
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  activeTicketCounts?: Record<string, number>;
  onOpenShare?: (item: StorageItem, initialTab?: 'public' | 'create' | 'manage') => void;
}

export function StorageListView({
  folderItems,
  fileItems,
  selectedItem,
  selectedKeys,
  onSelectItem,
  onToggleSelectItem,
  onSelectAll,
  onNavigateToPrefix,
  onContextMenu,
  onDownload,
  onPreviewItem,
  onOpenMove,
  onDelete,
  draggedItem,
  draggedItemRef,
  onItemDragStart,
  onItemDragEnd,
  onDropOnFolder,
  onUploadFiles,
  canDropOnFolder,
  onClearSelection,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
  activeTicketCounts,
  onOpenShare,
}: StorageListViewProps) {
  const [dragOverTargetKey, setDragOverTargetKey] = useState<string | null>(null);
  const [sortField, setSortField] = useState<StorageSortField>('name');
  const [sortDirection, setSortDirection] = useState<StorageSortDirection>('asc');
  const sentinelRef = useRef<HTMLDivElement>(null);

  const handleSort = (field: StorageSortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection(field === 'size' || field === 'updated' ? 'desc' : 'asc');
    }
  };

  useEffect(() => {
    if (!hasMore || isLoadingMore || !onLoadMore) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          onLoadMore();
        }
      },
      { rootMargin: '250px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, onLoadMore]);

  const sortedFolderItems = useMemo(() => {
    return [...folderItems].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') {
        cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      } else if (sortField === 'size') {
        cmp = (a.size || a.itemCount || 0) - (b.size || b.itemCount || 0);
      } else if (sortField === 'updated') {
        const aTime = a.created_at ? a.created_at * 1000 : 0;
        const bTime = b.created_at ? b.created_at * 1000 : 0;
        cmp = aTime - bTime;
      } else {
        cmp = a.name.localeCompare(b.name);
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });
  }, [folderItems, sortField, sortDirection]);

  const sortedFileItems = useMemo(() => {
    return [...fileItems].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') {
        cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      } else if (sortField === 'tier') {
        const tierA = a.inline ? 'LSM' : 'Disk';
        const tierB = b.inline ? 'LSM' : 'Disk';
        cmp = tierA.localeCompare(tierB);
      } else if (sortField === 'size') {
        cmp = (a.size || 0) - (b.size || 0);
      } else if (sortField === 'updated') {
        const aTime = a.created_at ? a.created_at * 1000 : 0;
        const bTime = b.created_at ? b.created_at * 1000 : 0;
        cmp = aTime - bTime;
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });
  }, [fileItems, sortField, sortDirection]);

  const allItems = [...sortedFolderItems, ...sortedFileItems];
  const allSelected = allItems.length > 0 && allItems.every((it) => selectedKeys?.has(it.fullKey));
  const someSelected = allItems.some((it) => selectedKeys?.has(it.fullKey));

  return (
    <div
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('[data-storage-item="true"]')) {
          onClearSelection?.();
        }
      }}
      onScroll={(e) => {
        if (!hasMore || isLoadingMore || !onLoadMore) return;
        const target = e.currentTarget;
        if (target.scrollHeight - target.scrollTop - target.clientHeight < 250) {
          onLoadMore();
        }
      }}
      className="flex-1 w-full overflow-auto select-none font-sans bg-[#0a0a0a]"
    >
      <table className="w-full text-left border-separate border-spacing-0">
        <thead>
          <tr className="sticky top-0 z-10 h-[44px] bg-[#0a0a0a] text-[13.5px] font-medium text-[#8c8c8c]">
            <th
              className="w-12 h-[44px] px-3 py-2 text-center select-none cursor-pointer border-b border-[#222222] border-r border-[#1f1f1f] bg-[#0a0a0a]"
              onClick={(e) => {
                e.stopPropagation();
                onSelectAll?.();
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
              }}
            >
              <div className="flex items-center justify-center pointer-events-none">
                <button
                  type="button"
                  tabIndex={-1}
                  title={allSelected ? 'Deselect all' : 'Select all'}
                  aria-label={allSelected ? 'Deselect all rows' : 'Select all rows'}
                  aria-checked={allSelected ? 'true' : someSelected ? 'mixed' : 'false'}
                  className={`peer h-4 w-4 shrink-0 rounded-[4px] border border-[#383838] shadow-xs transition-all flex items-center justify-center ${
                    allSelected
                      ? 'bg-white border-white text-black'
                      : someSelected
                      ? 'bg-white border-white text-black'
                      : 'bg-transparent hover:border-[#666666] hover:bg-white/[0.04]'
                  }`}
                >
                  {allSelected ? (
                    <Check className="h-3 w-3 stroke-[3]" />
                  ) : someSelected ? (
                    <Minus className="h-3 w-3 stroke-[3]" />
                  ) : null}
                </button>
              </div>
            </th>
            {/* Column: Name */}
            <th
              onClick={() => handleSort('name')}
              className="h-[44px] px-3.5 py-2 font-sans font-semibold border-b border-[#222222] border-r border-[#1f1f1f] text-[14px] text-[#cccccc] text-left bg-[#0a0a0a] cursor-pointer hover:bg-[#141414] transition-colors select-none group"
            >
              <div className="flex items-center justify-between gap-2">
                <span>Name</span>
                <span className={`transition-colors shrink-0 ${sortField === 'name' ? 'text-white' : 'text-[#555555] group-hover:text-[#aaaaaa]'}`}>
                  {sortField === 'name' ? (
                    sortDirection === 'asc' ? <ArrowUp className="w-3.5 h-3.5 stroke-[2.5]" /> : <ArrowDown className="w-3.5 h-3.5 stroke-[2.5]" />
                  ) : (
                    <ArrowUpDown className="w-3.5 h-3.5" />
                  )}
                </span>
              </div>
            </th>

            {/* Column: Storage Tier */}
            <th
              onClick={() => handleSort('tier')}
              className="h-[44px] px-3.5 py-2 font-sans font-semibold w-36 border-b border-[#222222] border-r border-[#1f1f1f] text-[14px] text-[#cccccc] text-left bg-[#0a0a0a] cursor-pointer hover:bg-[#141414] transition-colors select-none group"
            >
              <div className="flex items-center justify-between gap-2">
                <span>Storage Tier</span>
                <span className={`transition-colors shrink-0 ${sortField === 'tier' ? 'text-white' : 'text-[#555555] group-hover:text-[#aaaaaa]'}`}>
                  {sortField === 'tier' ? (
                    sortDirection === 'asc' ? <ArrowUp className="w-3.5 h-3.5 stroke-[2.5]" /> : <ArrowDown className="w-3.5 h-3.5 stroke-[2.5]" />
                  ) : (
                    <ArrowUpDown className="w-3.5 h-3.5" />
                  )}
                </span>
              </div>
            </th>

            {/* Column: Size */}
            <th
              onClick={() => handleSort('size')}
              className="h-[44px] px-3.5 py-2 font-sans font-semibold w-36 text-right border-b border-[#222222] border-r border-[#1f1f1f] text-[14px] text-[#cccccc] bg-[#0a0a0a] cursor-pointer hover:bg-[#141414] transition-colors select-none group"
            >
              <div className="flex items-center justify-between gap-2">
                <span>Size</span>
                <span className={`transition-colors shrink-0 ${sortField === 'size' ? 'text-white' : 'text-[#555555] group-hover:text-[#aaaaaa]'}`}>
                  {sortField === 'size' ? (
                    sortDirection === 'asc' ? <ArrowUp className="w-3.5 h-3.5 stroke-[2.5]" /> : <ArrowDown className="w-3.5 h-3.5 stroke-[2.5]" />
                  ) : (
                    <ArrowUpDown className="w-3.5 h-3.5" />
                  )}
                </span>
              </div>
            </th>

            {/* Column: Uploaded */}
            <th
              onClick={() => handleSort('updated')}
              className="h-[44px] px-4 py-2 font-sans font-semibold w-44 text-right hidden sm:table-cell text-[14px] text-[#cccccc] border-b border-[#222222] border-r border-[#1f1f1f] bg-[#0a0a0a] cursor-pointer hover:bg-[#141414] transition-colors select-none group"
            >
              <div className="flex items-center justify-between gap-2">
                <span>Uploaded</span>
                <span className={`transition-colors shrink-0 ${sortField === 'updated' ? 'text-white' : 'text-[#555555] group-hover:text-[#aaaaaa]'}`}>
                  {sortField === 'updated' ? (
                    sortDirection === 'asc' ? <ArrowUp className="w-3.5 h-3.5 stroke-[2.5]" /> : <ArrowDown className="w-3.5 h-3.5 stroke-[2.5]" />
                  ) : (
                    <ArrowUpDown className="w-3.5 h-3.5" />
                  )}
                </span>
              </div>
            </th>
            <th className="h-[44px] px-3 py-2 w-16 text-right border-b border-[#222222] bg-[#0a0a0a]"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {allItems.map((item) => {
            const isFolder = item.type === 'folder';
            const isSelected = selectedKeys
              ? selectedKeys.has(item.fullKey)
              : Boolean(selectedItem && (selectedItem.fullKey === item.fullKey || selectedItem.id === item.id));
            const isDropTarget = isFolder && dragOverTargetKey === item.fullKey;
            const isSelfDragged = draggedItem?.id === item.id;

            return (
              <tr
                key={item.id}
                data-storage-item="true"
                draggable={true}
                onDragStart={(e) => onItemDragStart(e, item)}
                onDragEnd={onItemDragEnd}
                onDragOver={(e) => {
                  if (isFolder && draggedItemRef.current && canDropOnFolder(draggedItemRef.current, item.fullKey)) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = 'move';
                    if (dragOverTargetKey !== item.fullKey) {
                      setDragOverTargetKey(item.fullKey);
                    }
                  }
                }}
                onDragLeave={(e) => {
                  if (isFolder) {
                    e.stopPropagation();
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      if (dragOverTargetKey === item.fullKey) {
                        setDragOverTargetKey(null);
                      }
                    }
                  }
                }}
                onDrop={async (e) => {
                  if (isFolder) {
                    e.preventDefault();
                    e.stopPropagation();
                    setDragOverTargetKey(null);
                    if (draggedItemRef.current) {
                      await onDropOnFolder(item.fullKey, draggedItemRef.current);
                    } else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                      await onUploadFiles?.(e.dataTransfer.files, item.fullKey);
                    }
                  }
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (e.ctrlKey || e.metaKey || e.shiftKey) {
                    onToggleSelectItem ? onToggleSelectItem(item, e) : onSelectItem(item);
                  } else {
                    onSelectItem(item);
                  }
                }}
                onDoubleClick={(e) => {
                  // Guard: Ignore double clicks originating from interactive controls or checkbox column
                  const target = e.target as HTMLElement;
                  if (target.closest('button, input, [role="button"], td:first-child')) {
                    return;
                  }
                  if (isFolder) {
                    onNavigateToPrefix(item.fullKey);
                  } else if (onPreviewItem) {
                    onPreviewItem(item);
                  } else {
                    onDownload(item.fullKey);
                  }
                }}
                onContextMenu={(e) => onContextMenu(e, item)}
                className={`group transition-colors cursor-pointer select-none h-11 ${
                  isSelfDragged ? 'opacity-40' : ''
                } ${
                  isDropTarget
                    ? 'bg-blue-950/40 text-blue-300'
                    : isSelected
                    ? 'bg-[#181818] text-white'
                    : 'text-[#cccccc] hover:bg-[#141414] hover:text-white'
                }`}
              >
                {/* Custom Checkbox Button (Matching TableGridView.tsx) */}
                <td
                  className="w-12 px-3 py-2 text-center select-none cursor-pointer border-b border-[#1a1a1a] border-r border-[#151515]"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onToggleSelectItem) {
                      onToggleSelectItem(item, e);
                    } else {
                      onSelectItem(item);
                    }
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                  }}
                >
                  <div className="flex items-center justify-center pointer-events-none">
                    <button
                      type="button"
                      tabIndex={-1}
                      title={isSelected ? `Deselect ${item.name}` : `Select ${item.name}`}
                      aria-label={isSelected ? `Deselect ${item.name}` : `Select ${item.name}`}
                      aria-checked={isSelected ? 'true' : 'false'}
                      className={`peer h-4 w-4 shrink-0 rounded-[4px] border border-[#383838] shadow-xs transition-all flex items-center justify-center ${
                        isSelected
                          ? 'bg-white border-white text-black'
                          : 'bg-transparent group-hover:border-[#666666] hover:bg-white/[0.04]'
                      }`}
                    >
                      {isSelected && <Check className="h-3 w-3 stroke-[3]" />}
                    </button>
                  </div>
                </td>

                {/* Column 1: Icon and Name */}
                <td className="px-3.5 py-2 min-w-[200px] border-b border-[#1a1a1a] border-r border-[#151515]">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="relative w-4 h-4 flex items-center justify-center shrink-0">
                      {isFolder ? (
                        <Folder className="w-4 h-4 text-[#8c8c8c]" />
                      ) : (
                        getFileIcon(item.name, 'w-4 h-4')
                      )}
                      {!isFolder && activeTicketCounts && (activeTicketCounts[item.fullKey] || 0) > 0 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenShare?.(item, 'manage');
                          }}
                          title={`${activeTicketCounts[item.fullKey]} active capability share link${
                            activeTicketCounts[item.fullKey] > 1 ? 's' : ''
                          }. Click to manage.`}
                          className="absolute -top-2 -right-2.5 min-w-[16px] h-[16px] px-0.5 rounded-full bg-red-600 text-white text-[10px] font-semibold font-sans flex items-center justify-center border border-[#0c0c0c] shadow-xs cursor-pointer leading-none z-10 select-none"
                        >
                          {activeTicketCounts[item.fullKey]}
                        </button>
                      )}
                    </div>
                    <span className="truncate font-medium text-[14px] text-white font-sans">{item.name}</span>
                  </div>
                </td>

                {/* Column 2: Storage Tier */}
                <td className="px-3.5 py-2 border-b border-[#1a1a1a] border-r border-[#151515]">
                  {isFolder ? (
                    <span className="text-[14px] text-[#8c8c8c] font-sans font-normal">dir</span>
                  ) : (
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-[4px] text-[12.5px] font-medium font-sans ${
                        item.inline
                          ? 'bg-amber-950/30 text-amber-400 border border-amber-900/40'
                          : 'bg-zinc-900 text-zinc-400 border border-zinc-800'
                      }`}
                    >
                      {item.inline ? 'LSM' : 'Disk'}
                    </span>
                  )}
                </td>

                {/* Column 3: Payload Size */}
                <td className="px-3.5 py-2 text-right tabular-nums text-[14px] text-[#8c8c8c] font-sans font-normal border-b border-[#1a1a1a] border-r border-[#151515]">
                  {isFolder
                    ? `${item.itemCount || 0} items`
                    : formatBytes(item.size || 0)}
                </td>

                {/* Column 4: Uploaded / Created Date */}
                <td className="px-4 py-2 text-right tabular-nums text-[14px] text-[#8c8c8c] font-sans font-normal hidden sm:table-cell border-b border-[#1a1a1a] border-r border-[#151515]">
                  {item.created_at
                    ? new Date(item.created_at * 1000).toLocaleDateString()
                    : '—'}
                </td>

                {/* Column 5: Actions */}
                <td
                  className="px-3 text-right border-b border-[#1a1a1a]"
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                  }}
                >
                  <div
                    className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                    }}
                  >
                    {!isFolder && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDownload(item.fullKey);
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                        }}
                        title="Download object"
                        className="p-1 rounded text-[#8c8c8c] hover:text-white hover:bg-[#222222] transition-colors cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onContextMenu(e, item);
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                      }}
                      title="More actions"
                      className="p-1 rounded text-[#8c8c8c] hover:text-white hover:bg-[#222222] transition-colors cursor-pointer"
                    >
                      <MoreVertical className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Sentinel & Lazy Load Indicator */}
      {hasMore && (
        <div ref={sentinelRef} className="py-4 flex items-center justify-center gap-2 text-[13px] text-[#888888] font-sans">
          {isLoadingMore ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
              <span>Loading more files...</span>
            </>
          ) : (
            <span className="opacity-0 pointer-events-none">Load more</span>
          )}
        </div>
      )}
    </div>
  );
}
