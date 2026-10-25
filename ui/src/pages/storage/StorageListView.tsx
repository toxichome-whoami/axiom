/*
 * Dense data table list view subcomponent for Storage objects and folders.
 * Owned by: ui/pages/storage
 * Design reference: TableGridView in TableEditor (exact row height, border colors, tabular fonts, custom checkbox buttons)
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  Folder,
  ArrowRight,
  Download,
  Trash2,
  MoreVertical,
  Check,
  Minus,
  Loader2,
} from 'lucide-react';
import { StorageItem } from './types';
import { getFileIcon } from './fileIcon';
import { formatBytes } from './format';

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
}: StorageListViewProps) {
  const [dragOverTargetKey, setDragOverTargetKey] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

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

  const allItems = [...folderItems, ...fileItems];
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
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="sticky top-0 z-10 h-9 bg-[#0a0a0a] border-b border-[#1f1f1f] text-[12px] font-medium text-[#737373] tracking-wide">
            <th
              className="w-12 px-3 py-2 text-center select-none cursor-pointer"
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
            <th className="px-3 font-medium">Name</th>
            <th className="px-3 font-medium w-36">Storage Tier</th>
            <th className="px-3 font-medium w-36 text-right">Size</th>
            <th className="px-4 font-medium w-44 text-right hidden sm:table-cell">Uploaded</th>
            <th className="px-3 w-20 text-right"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#1a1a1a]">
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
                className={`group transition-colors cursor-pointer select-none h-10 ${
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
                  className="w-12 px-3 py-2 text-center select-none cursor-pointer"
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
                <td className="px-3 min-w-0 max-w-[280px] sm:max-w-md">
                  <div className="flex items-center gap-2 truncate">
                    <div className="w-4 h-4 flex items-center justify-center shrink-0">
                      {isFolder ? (
                        <Folder className="w-4 h-4 text-[#8c8c8c]" />
                      ) : (
                        getFileIcon(item.name, 'w-4 h-4')
                      )}
                    </div>
                    <span className="truncate font-medium text-sm text-white">{item.name}</span>
                  </div>
                </td>

                {/* Column 2: Storage Tier */}
                <td className="px-3">
                  {isFolder ? (
                    <span className="text-xs text-[#888888] font-mono">dir</span>
                  ) : (
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 rounded-[4px] text-[11px] font-medium font-mono ${
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
                <td className="px-3 text-right tabular-nums text-xs text-[#888888] font-mono">
                  {isFolder
                    ? `${item.itemCount || 0} items`
                    : formatBytes(item.size || 0)}
                </td>

                {/* Column 4: Uploaded / Created Date */}
                <td className="px-4 text-right tabular-nums text-xs text-[#888888] font-mono hidden sm:table-cell">
                  {item.created_at
                    ? new Date(item.created_at * 1000).toLocaleDateString()
                    : '—'}
                </td>

                {/* Column 5: Actions */}
                <td
                  className="px-3 text-right"
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
