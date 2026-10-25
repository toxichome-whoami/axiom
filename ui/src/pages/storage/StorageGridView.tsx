/*
 * Grid card view subcomponent for Storage objects and virtual folders.
 * Owned by: ui/pages/storage
 * Design reference: Vercel / Linear card aesthetic (minimal borders, quiet hover, typography contrast, custom checkbox button)
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  Folder,
  ArrowRight,
  Download,
  Trash2,
  MoreVertical,
  Layers,
  HardDrive,
  Check,
  Loader2,
} from 'lucide-react';
import { StorageItem } from './types';
import { getFileIcon } from './fileIcon';
import { formatBytes } from './format';

export interface StorageGridViewProps {
  folderItems: StorageItem[];
  fileItems: StorageItem[];
  selectedItem: StorageItem | null;
  selectedKeys?: Set<string>;
  onSelectItem: (item: StorageItem) => void;
  onToggleSelectItem?: (item: StorageItem, e: React.MouseEvent) => void;
  onNavigateToPrefix: (prefix: string) => void;
  onContextMenu: (e: React.MouseEvent, item: StorageItem) => void;
  onOpenMove: (item: StorageItem) => void;
  onDownload: (key: string) => void;
  onPreviewItem?: (item: StorageItem) => void;
  onDelete: (item: StorageItem) => void;

  // Drag and drop
  draggedItem: StorageItem | null;
  draggedItemRef: React.MutableRefObject<StorageItem | null>;
  onItemDragStart: (e: React.DragEvent, item: StorageItem) => void;
  onItemDragEnd: () => void;
  onDropOnFolder: (targetFolderKey: string, droppedItem?: StorageItem) => void;
  onUploadFiles: (files: FileList | File[], destinationPrefix?: string) => void;
  canDropOnFolder: (dragged: StorageItem | null, targetFolderKey: string) => boolean;
  onClearSelection?: () => void;

  // Pagination & Lazy loading
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
}

export function StorageGridView({
  folderItems,
  fileItems,
  selectedItem,
  selectedKeys,
  onSelectItem,
  onToggleSelectItem,
  onNavigateToPrefix,
  onContextMenu,
  onOpenMove,
  onDownload,
  onPreviewItem,
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
}: StorageGridViewProps) {
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

  return (
    <div
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('[data-storage-item="true"]')) {
          onClearSelection?.();
        }
      }}
      className="space-y-6 font-sans select-none min-h-full"
    >
      {/* ─── Folders Section ─────────────── */}
      {folderItems.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-0.5">
            <span className="text-[14px] font-medium text-white font-sans">
              Folders
            </span>
            <span className="text-[12px] font-sans px-2 py-0.5 rounded-[4px] bg-[#141414] border border-[#242424] text-[#8c8c8c] tabular-nums font-normal">
              {folderItems.length}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 sm:gap-3">
            {folderItems.map((f) => {
              const isSelected = selectedKeys
                ? selectedKeys.has(f.fullKey)
                : Boolean(selectedItem && (selectedItem.fullKey === f.fullKey || selectedItem.id === f.id));
              const isDropTarget = dragOverTargetKey === f.fullKey;
              const isSelfDragged = draggedItem?.id === f.id;

              return (
                <div
                  key={f.id}
                  data-storage-item="true"
                  draggable={true}
                  onDragStart={(e) => onItemDragStart(e, f)}
                  onDragEnd={onItemDragEnd}
                  onDragOver={(e) => {
                    if (draggedItemRef.current && canDropOnFolder(draggedItemRef.current, f.fullKey)) {
                      e.preventDefault();
                      e.stopPropagation();
                      e.dataTransfer.dropEffect = 'move';
                      if (dragOverTargetKey !== f.fullKey) {
                        setDragOverTargetKey(f.fullKey);
                      }
                    }
                  }}
                  onDragLeave={(e) => {
                    e.stopPropagation();
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      if (dragOverTargetKey === f.fullKey) {
                        setDragOverTargetKey(null);
                      }
                    }
                  }}
                  onDrop={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDragOverTargetKey(null);
                    if (draggedItemRef.current) {
                      await onDropOnFolder(f.fullKey, draggedItemRef.current);
                    } else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                      await onUploadFiles(e.dataTransfer.files, f.fullKey);
                    }
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (e.ctrlKey || e.metaKey || e.shiftKey) {
                      onToggleSelectItem ? onToggleSelectItem(f, e) : onSelectItem(f);
                    } else {
                      onSelectItem(f);
                    }
                  }}
                  onDoubleClick={(e) => {
                    const target = e.target as HTMLElement;
                    if (target.closest('button, input, [role="button"]')) {
                      return;
                    }
                    onNavigateToPrefix(f.fullKey);
                  }}
                  onContextMenu={(e) => onContextMenu(e, f)}
                  className={`group p-3 rounded-[8px] border transition-colors cursor-pointer flex items-center justify-between gap-3 min-h-[52px] relative ${
                    isSelfDragged ? 'opacity-40 border-dashed border-[#555555]' : ''
                  } ${
                    isDropTarget
                      ? 'bg-blue-950/40 border-blue-500/80 ring-1 ring-blue-500/50'
                      : isSelected
                      ? 'bg-[#181818] border-blue-500/70 ring-1 ring-blue-500/30'
                      : 'bg-[#0d0d0d] hover:bg-[#141414] border-[#1f1f1f] hover:border-[#2a2a2a]'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleSelectItem ? onToggleSelectItem(f, e) : onSelectItem(f);
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                      }}
                      className={`w-4 h-4 shrink-0 flex items-center justify-center cursor-pointer transition-opacity ${
                        isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                      }`}
                    >
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-label={`Select ${f.name}`}
                        aria-checked={isSelected ? 'true' : 'false'}
                        className={`peer h-4 w-4 shrink-0 rounded-[4px] border border-[#383838] shadow-xs transition-all pointer-events-none flex items-center justify-center ${
                          isSelected
                            ? 'bg-white border-white text-black'
                            : 'bg-transparent hover:border-[#666666] hover:bg-white/[0.04]'
                        }`}
                      >
                        {isSelected && <Check className="h-3 w-3 stroke-[3]" />}
                      </button>
                    </div>
                    <div className="w-9 h-9 rounded-[8px] bg-[#161616] border border-[#262626] flex items-center justify-center shrink-0">
                      <Folder className={`w-4 h-4 ${isDropTarget ? 'text-blue-400 animate-pulse' : 'text-[#a3a3a3]'}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-medium text-white truncate font-sans" title={f.name}>
                        {f.name}
                      </div>
                      <div className="text-[12px] text-[#8c8c8c] tabular-nums truncate font-sans font-normal">
                        {isDropTarget ? (
                          <span className="text-blue-400 font-medium">Drop here</span>
                        ) : (
                          `${f.itemCount || 0} ${f.itemCount === 1 ? 'item' : 'items'}`
                        )}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenMove(f);
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                    }}
                    title="Move folder"
                    className="opacity-0 group-hover:opacity-100 text-[#8c8c8c] hover:text-white w-7 h-7 flex items-center justify-center rounded-md hover:bg-[#242424] transition-all cursor-pointer shrink-0"
                  >
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── Edge-to-Edge Section Divider Between Folders & Files ─────────────── */}
      {folderItems.length > 0 && fileItems.length > 0 && (
        <div className="-mx-4 sm:-mx-5 border-t border-[#1c1c1c]" />
      )}

      {/* ─── Files Section ─────────────── */}
      {fileItems.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-0.5">
            <span className="text-[14px] font-medium text-white font-sans">
              Files
            </span>
            <span className="text-[12px] font-sans px-2 py-0.5 rounded-[4px] bg-[#141414] border border-[#242424] text-[#8c8c8c] tabular-nums font-normal">
              {fileItems.length}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 sm:gap-3">
            {fileItems.map((item) => {
              const isSelected = selectedKeys
                ? selectedKeys.has(item.fullKey)
                : Boolean(selectedItem && (selectedItem.fullKey === item.fullKey || selectedItem.id === item.id));
              const isSelfDragged = draggedItem?.id === item.id;

              return (
                <div
                  key={item.id}
                  data-storage-item="true"
                  draggable={true}
                  onDragStart={(e) => onItemDragStart(e, item)}
                  onDragEnd={onItemDragEnd}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (e.ctrlKey || e.metaKey || e.shiftKey) {
                      onToggleSelectItem ? onToggleSelectItem(item, e) : onSelectItem(item);
                    } else {
                      onSelectItem(item);
                    }
                  }}
                  onDoubleClick={(e) => {
                    const target = e.target as HTMLElement;
                    if (target.closest('button, input, [role="button"]')) {
                      return;
                    }
                    if (onPreviewItem) {
                      onPreviewItem(item);
                    }
                  }}
                  onContextMenu={(e) => onContextMenu(e, item)}
                  className={`group p-3 rounded-[8px] border transition-colors cursor-pointer flex flex-col justify-between min-h-[124px] relative ${
                    isSelfDragged ? 'opacity-40 border-dashed border-[#555555]' : ''
                  } ${
                    isSelected
                      ? 'bg-[#181818] border-blue-500/70 ring-1 ring-blue-500/30'
                      : 'bg-[#0d0d0d] hover:bg-[#141414] border-[#1f1f1f] hover:border-[#2a2a2a]'
                  }`}
                >
                  {/* Checkbox overlay matching TableGridView button checkbox */}
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleSelectItem ? onToggleSelectItem(item, e) : onSelectItem(item);
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                    }}
                    className={`absolute top-2.5 left-2.5 z-10 w-4 h-4 rounded-[4px] flex items-center justify-center transition-opacity cursor-pointer ${
                      isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    }`}
                  >
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={`Select ${item.name}`}
                      aria-checked={isSelected ? 'true' : 'false'}
                      className={`peer h-4 w-4 shrink-0 rounded-[4px] border border-[#383838] shadow-xs transition-all pointer-events-none flex items-center justify-center ${
                        isSelected
                          ? 'bg-white border-white text-black'
                          : 'bg-transparent hover:border-[#666666] hover:bg-white/[0.04]'
                      }`}
                    >
                      {isSelected && <Check className="h-3 w-3 stroke-[3]" />}
                    </button>
                  </div>

                  {/* Top row: Icon, Name, and Actions */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="w-9 h-9 rounded-[8px] bg-[#181818] border border-[#262626] flex items-center justify-center shrink-0">
                      {getFileIcon(item.name, 'w-4 h-4')}
                    </div>

                    <div className="min-w-0 flex-1 pt-0.5">
                      <div className="text-[14px] font-medium text-white truncate leading-snug font-sans" title={item.name}>
                        {item.name}
                      </div>
                      <div className="text-[12px] text-[#8c8c8c] truncate font-sans font-normal" title={item.content_type || 'application/octet-stream'}>
                        {item.content_type?.split('/')[1] || 'binary'}
                      </div>
                    </div>

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
                      title="File actions"
                      className="opacity-0 group-hover:opacity-100 text-[#8c8c8c] hover:text-white w-7 h-7 flex items-center justify-center rounded-md hover:bg-[#242424] transition-all cursor-pointer shrink-0"
                    >
                      <MoreVertical className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Bottom row: Size & Storage Tier pill (edge-to-edge card line) */}
                  <div className="-mx-3.5 px-3.5 pt-2.5 border-t border-[#1e1e1e] flex items-center justify-between text-[12px] text-[#8c8c8c] tabular-nums font-sans font-normal">
                    <span>{formatBytes(item.size || 0)}</span>

                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 rounded-[4px] text-[11px] font-medium font-sans ${
                        item.inline
                          ? 'bg-amber-950/30 text-amber-400 border border-amber-900/40'
                          : 'bg-zinc-900 text-zinc-400 border border-zinc-800'
                      }`}
                    >
                      {item.inline ? 'LSM' : 'Disk'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Sentinel & Lazy Load Indicator */}
      {hasMore && (
        <div ref={sentinelRef} className="py-6 flex items-center justify-center gap-2 text-[13px] text-[#8c8c8c] font-sans">
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
