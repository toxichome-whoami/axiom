/*
 * Dense data table list view subcomponent for Storage objects and folders.
 * Owned by: ui/pages/storage
 * Design reference: TableGridView in TableEditor (exact row height, border colors, tabular fonts)
 */

import React, { useState } from 'react';
import {
  Folder,
  ArrowRight,
  Download,
  Trash2,
  MoreVertical,
} from 'lucide-react';
import { StorageItem } from './types';
import { getFileIcon } from './fileIcon';
import { formatBytes } from './format';

export interface StorageListViewProps {
  folderItems: StorageItem[];
  fileItems: StorageItem[];
  selectedItem: StorageItem | null;
  onSelectItem: (item: StorageItem) => void;
  onNavigateToPrefix: (prefix: string) => void;
  onContextMenu: (e: React.MouseEvent, item: StorageItem) => void;
  onDownload: (key: string) => void;
  onOpenMove: (item: StorageItem) => void;
  onDelete: (item: StorageItem) => void;

  // Drag and drop
  draggedItem: StorageItem | null;
  draggedItemRef: React.MutableRefObject<StorageItem | null>;
  onItemDragStart: (e: React.DragEvent, item: StorageItem) => void;
  onItemDragEnd: () => void;
  onDropOnFolder: (targetFolderKey: string, droppedItem?: StorageItem) => void;
  canDropOnFolder: (dragged: StorageItem | null, targetFolderKey: string) => boolean;
}

export function StorageListView({
  folderItems,
  fileItems,
  selectedItem,
  onSelectItem,
  onNavigateToPrefix,
  onContextMenu,
  onDownload,
  onOpenMove,
  onDelete,
  draggedItem,
  draggedItemRef,
  onItemDragStart,
  onItemDragEnd,
  onDropOnFolder,
  canDropOnFolder,
}: StorageListViewProps) {
  const [dragOverTargetKey, setDragOverTargetKey] = useState<string | null>(null);

  const allItems = [...folderItems, ...fileItems];

  return (
    <div className="flex-1 w-full overflow-auto select-none font-sans bg-[#0a0a0a]">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="sticky top-0 z-10 h-9 bg-[#0a0a0a] border-b border-[#222222] text-[12.5px] font-medium text-[#888888]">
            <th className="px-4 font-medium">Name</th>
            <th className="px-3 font-medium w-36">Storage Tier</th>
            <th className="px-3 font-medium w-32 text-right">Size</th>
            <th className="px-4 font-medium w-44 text-right hidden sm:table-cell">Uploaded</th>
            <th className="px-3 w-16 text-right"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#1a1a1a]">
          {allItems.map((item) => {
            const isFolder = item.type === 'folder';
            const isSelected = selectedItem?.id === item.id;
            const isDropTarget = dragOverTargetKey === item.fullKey;
            const isSelfDragged = draggedItem?.id === item.id;

            return (
              <tr
                key={item.id}
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
                    }
                  }
                }}
                onClick={() => onSelectItem(item)}
                onDoubleClick={() => {
                  if (isFolder) {
                    onNavigateToPrefix(item.fullKey);
                  }
                }}
                onContextMenu={(e) => onContextMenu(e, item)}
                className={`group h-[36px] transition-colors cursor-pointer text-[13px] ${
                  isSelfDragged ? 'opacity-40' : ''
                } ${
                  isDropTarget
                    ? 'bg-blue-950/40 text-blue-300'
                    : isSelected
                    ? 'bg-[#1a1a1a] text-white'
                    : 'text-[#cccccc] hover:bg-[#141414] hover:text-white'
                }`}
              >
                {/* Column 1: Icon and Name */}
                <td className="px-4 min-w-0 max-w-[280px] sm:max-w-md">
                  <div className="flex items-center gap-2 truncate">
                    <div className="w-4 h-4 flex items-center justify-center shrink-0">
                      {isFolder ? (
                        <Folder className="w-3.5 h-3.5 text-[#eab308]" />
                      ) : (
                        getFileIcon(item.name, 'w-3.5 h-3.5')
                      )}
                    </div>
                    <span className="truncate font-medium text-[13px] text-white">{item.name}</span>
                  </div>
                </td>

                {/* Column 2: Storage Tier */}
                <td className="px-3">
                  {isFolder ? (
                    <span className="text-[12px] text-[#777777]">Directory</span>
                  ) : (
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-[4px] text-[11px] font-medium ${
                        item.inline
                          ? 'bg-amber-950/30 text-amber-400 border border-amber-900/40'
                          : 'bg-zinc-900 text-zinc-400 border border-zinc-800'
                      }`}
                    >
                      {item.inline ? 'Fjall LSM' : 'Disk Shard'}
                    </span>
                  )}
                </td>

                {/* Column 3: Payload Size */}
                <td className="px-3 text-right tabular-nums text-[12.5px] text-[#999999]">
                  {isFolder
                    ? `${item.itemCount || 0} items`
                    : formatBytes(item.size || 0)}
                </td>

                {/* Column 4: Uploaded / Created Date */}
                <td className="px-4 text-right tabular-nums text-[12px] text-[#777777] hidden sm:table-cell">
                  {item.created_at
                    ? new Date(item.created_at * 1000).toLocaleDateString()
                    : '—'}
                </td>

                {/* Column 5: Actions */}
                <td className="px-3 text-right">
                  <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {!isFolder && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDownload(item.fullKey);
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
    </div>
  );
}
