/*
 * Context menu (right-click) for storage items and canvas explorer.
 * Owned by: ui/pages/storage
 * Dependencies: lucide-react, ./types
 * Invariants: Clamped inside viewport bounds; dismisses on outside-click, scroll, or Escape.
 */

import React, { useEffect, useRef } from 'react';
import {
  Folder,
  Download,
  ArrowRight,
  Edit3,
  Clipboard,
  Trash2,
  Info,
  FolderPlus,
  Upload,
  RefreshCw,
  Copy,
} from 'lucide-react';
import { StorageItem, ClipboardState } from './types';

export interface ContextMenuPosition {
  x: number;
  y: number;
}

export interface ContextMenuProps {
  position: ContextMenuPosition | null;
  item: StorageItem | null;
  clipboard: ClipboardState | null;
  onClose: () => void;
  onOpenFolder?: (item: StorageItem) => void;
  onDownload?: (item: StorageItem) => void;
  onMove?: (item: StorageItem) => void;
  onRename?: (item: StorageItem) => void;
  onCopy?: (item: StorageItem) => void;
  onDelete?: (item: StorageItem) => void;
  onViewDetails?: (item: StorageItem) => void;
  onNewFolder?: () => void;
  onUpload?: () => void;
  onPaste?: () => void;
  onRefresh?: () => void;
}

export function ContextMenu({
  position,
  item,
  clipboard,
  onClose,
  onOpenFolder,
  onDownload,
  onMove,
  onRename,
  onCopy,
  onDelete,
  onViewDetails,
  onNewFolder,
  onUpload,
  onPaste,
  onRefresh,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }
    function handleScrollOrResize() {
      onClose();
    }

    if (position) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
      window.addEventListener('resize', handleScrollOrResize);
      window.addEventListener('scroll', handleScrollOrResize, true);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('scroll', handleScrollOrResize, true);
    };
  }, [position, onClose]);

  if (!position) return null;

  // Viewport clamping to prevent overflow offscreen
  const menuWidth = 200;
  const menuHeight = item ? 260 : 160;
  const clampedX = Math.min(position.x, window.innerWidth - menuWidth - 10);
  const clampedY = Math.min(position.y, window.innerHeight - menuHeight - 10);

  return (
    <div
      ref={menuRef}
      style={{ top: `${Math.max(10, clampedY)}px`, left: `${Math.max(10, clampedX)}px` }}
      className="fixed z-50 w-[200px] bg-[#111111] border border-[#262626] rounded-[8px] shadow-2xl p-1 font-sans select-none animate-in fade-in zoom-in-95 duration-100"
      onClick={(e) => e.stopPropagation()}
    >
      {item ? (
        <>
          {/* Header indicator */}
          <div className="px-2.5 py-1 text-[11px] font-medium text-[#777777] truncate border-b border-[#1f1f1f] mb-1">
            {item.name}
          </div>

          {item.type === 'folder' && onOpenFolder && (
            <button
              type="button"
              onClick={() => {
                onOpenFolder(item);
                onClose();
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-[13px] text-[#d4d4d4] hover:text-white hover:bg-[#1a1a1a] rounded-[6px] transition-colors cursor-pointer text-left"
            >
              <Folder className="w-4 h-4 text-[#eab308] shrink-0" />
              <span>Open Folder</span>
            </button>
          )}

          {item.type === 'file' && onDownload && (
            <button
              type="button"
              onClick={() => {
                onDownload(item);
                onClose();
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-[13px] text-[#d4d4d4] hover:text-white hover:bg-[#1a1a1a] rounded-[6px] transition-colors cursor-pointer text-left"
            >
              <Download className="w-4 h-4 text-[#8c8c8c] shrink-0" />
              <span>Download</span>
            </button>
          )}

          {onRename && (
            <button
              type="button"
              onClick={() => {
                onRename(item);
                onClose();
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-[13px] text-[#d4d4d4] hover:text-white hover:bg-[#1a1a1a] rounded-[6px] transition-colors cursor-pointer text-left"
            >
              <Edit3 className="w-4 h-4 text-[#8c8c8c] shrink-0" />
              <span>Rename</span>
            </button>
          )}

          {onMove && (
            <button
              type="button"
              onClick={() => {
                onMove(item);
                onClose();
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-[13px] text-[#d4d4d4] hover:text-white hover:bg-[#1a1a1a] rounded-[6px] transition-colors cursor-pointer text-left"
            >
              <ArrowRight className="w-4 h-4 text-[#8c8c8c] shrink-0" />
              <span>Move to...</span>
            </button>
          )}

          {onCopy && (
            <button
              type="button"
              onClick={() => {
                onCopy(item);
                onClose();
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-[13px] text-[#d4d4d4] hover:text-white hover:bg-[#1a1a1a] rounded-[6px] transition-colors cursor-pointer text-left"
            >
              <Copy className="w-4 h-4 text-[#8c8c8c] shrink-0" />
              <span>Copy</span>
            </button>
          )}

          <div className="h-px bg-[#222222] my-1" />

          {onViewDetails && (
            <button
              type="button"
              onClick={() => {
                onViewDetails(item);
                onClose();
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-[13px] text-[#d4d4d4] hover:text-white hover:bg-[#1a1a1a] rounded-[6px] transition-colors cursor-pointer text-left"
            >
              <Info className="w-4 h-4 text-[#8c8c8c] shrink-0" />
              <span>View Details</span>
            </button>
          )}

          <div className="h-px bg-[#222222] my-1" />

          {onDelete && (
            <button
              type="button"
              onClick={() => {
                onDelete(item);
                onClose();
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-[13px] text-[#f87171] hover:text-[#ef4444] hover:bg-[#ef4444]/10 rounded-[6px] transition-colors cursor-pointer text-left"
            >
              <Trash2 className="w-4 h-4 text-[#ef4444] shrink-0" />
              <span>Delete</span>
            </button>
          )}
        </>
      ) : (
        <>
          {onNewFolder && (
            <button
              type="button"
              onClick={() => {
                onNewFolder();
                onClose();
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-[13px] text-[#d4d4d4] hover:text-white hover:bg-[#1a1a1a] rounded-[6px] transition-colors cursor-pointer text-left"
            >
              <FolderPlus className="w-4 h-4 text-[#eab308] shrink-0" />
              <span>New Folder</span>
            </button>
          )}

          {onUpload && (
            <button
              type="button"
              onClick={() => {
                onUpload();
                onClose();
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-[13px] text-[#d4d4d4] hover:text-white hover:bg-[#1a1a1a] rounded-[6px] transition-colors cursor-pointer text-left"
            >
              <Upload className="w-4 h-4 text-white shrink-0" />
              <span>Upload Files</span>
            </button>
          )}

          {clipboard && onPaste && (
            <button
              type="button"
              onClick={() => {
                onPaste();
                onClose();
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-[13px] text-white hover:bg-[#1a1a1a] rounded-[6px] transition-colors cursor-pointer text-left"
            >
              <Clipboard className="w-4 h-4 text-white shrink-0" />
              <span>Paste ({clipboard.name})</span>
            </button>
          )}

          <div className="h-px bg-[#222222] my-1" />

          {onRefresh && (
            <button
              type="button"
              onClick={() => {
                onRefresh();
                onClose();
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-[13px] text-[#8c8c8c] hover:text-white hover:bg-[#1a1a1a] rounded-[6px] transition-colors cursor-pointer text-left"
            >
              <RefreshCw className="w-4 h-4 text-[#8c8c8c] shrink-0" />
              <span>Refresh</span>
            </button>
          )}
        </>
      )}
    </div>
  );
}
