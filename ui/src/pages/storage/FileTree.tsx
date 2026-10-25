/*
 * In-place folder and file tree view component for Axiom blob explorer.
 * Owned by: ui/pages/storage
 * Dependencies: lucide-react, ./types, ./fileIcon, ./format
 * Invariants: Recursively renders virtual folders and blobs with collapsible hierarchy.
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FolderPlus,
  Upload,
  RefreshCw,
  FolderTree as TreeIcon,
} from 'lucide-react';
import { BlobEntry } from '../../types';
import { StorageItem } from './types';
import { getFileIcon } from './fileIcon';

export interface FileTreeNode {
  id: string;
  name: string;
  path: string; // for folders: ends with '/', for files: fullKey
  type: 'folder' | 'file';
  size?: number;
  inline?: boolean;
  content_type?: string;
  hash?: string;
  created_at?: number;
  rawBlob?: BlobEntry;
  children: FileTreeNode[];
}

/**
 * Builds a hierarchical tree structure from a flat array of content-addressed blobs.
 */
export function buildFileTree(blobs: BlobEntry[]): FileTreeNode[] {
  interface MutableNode {
    id: string;
    name: string;
    path: string;
    type: 'folder' | 'file';
    size?: number;
    inline?: boolean;
    content_type?: string;
    hash?: string;
    created_at?: number;
    rawBlob?: BlobEntry;
    children: Map<string, MutableNode>;
  }

  const rootFolders: Map<string, MutableNode> = new Map();
  const rootFiles: MutableNode[] = [];

  for (const blob of blobs) {
    if (blob.key === '.axiom_dir') continue;

    // Detect virtual folder placeholder: e.g. "components/ui/.axiom_dir"
    const isFolderMarker = blob.key.endsWith('/.axiom_dir');
    const cleanKey = isFolderMarker
      ? blob.key.slice(0, -'.axiom_dir'.length)
      : blob.key;

    const parts = cleanKey.split('/').filter(Boolean);
    if (parts.length === 0) continue;

    if (isFolderMarker) {
      let currentMap = rootFolders;
      let accPath = '';
      for (let i = 0; i < parts.length; i++) {
        const seg = parts[i];
        accPath += `${seg}/`;
        let folderNode = currentMap.get(seg);
        if (!folderNode) {
          folderNode = {
            id: accPath,
            name: seg,
            path: accPath,
            type: 'folder',
            children: new Map(),
          };
          currentMap.set(seg, folderNode);
        }
        currentMap = folderNode.children;
      }
    } else {
      if (parts.length === 1) {
        rootFiles.push({
          id: blob.key,
          name: parts[0],
          path: blob.key,
          type: 'file',
          size: blob.size,
          inline: blob.inline,
          content_type: blob.content_type,
          hash: blob.hash,
          created_at: blob.created_at,
          rawBlob: blob,
          children: new Map(),
        });
      } else {
        let currentMap = rootFolders;
        let accPath = '';
        for (let i = 0; i < parts.length - 1; i++) {
          const seg = parts[i];
          accPath += `${seg}/`;
          let folderNode = currentMap.get(seg);
          if (!folderNode) {
            folderNode = {
              id: accPath,
              name: seg,
              path: accPath,
              type: 'folder',
              children: new Map(),
            };
            currentMap.set(seg, folderNode);
          }
          currentMap = folderNode.children;
        }

        const fileName = parts[parts.length - 1];
        currentMap.set(fileName, {
          id: blob.key,
          name: fileName,
          path: blob.key,
          type: 'file',
          size: blob.size,
          inline: blob.inline,
          content_type: blob.content_type,
          hash: blob.hash,
          created_at: blob.created_at,
          rawBlob: blob,
          children: new Map(),
        });
      }
    }
  }

  function convertMap(folderMap: Map<string, MutableNode>): FileTreeNode[] {
    const list: FileTreeNode[] = [];
    const entries = Array.from(folderMap.values());

    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (const item of entries) {
      list.push({
        id: item.id,
        name: item.name,
        path: item.path,
        type: item.type,
        size: item.size,
        inline: item.inline,
        content_type: item.content_type,
        hash: item.hash,
        created_at: item.created_at,
        rawBlob: item.rawBlob,
        children: convertMap(item.children),
      });
    }

    return list;
  }

  const result: FileTreeNode[] = convertMap(rootFolders);
  rootFiles.sort((a, b) => a.name.localeCompare(b.name));
  for (const f of rootFiles) {
    result.push({
      id: f.id,
      name: f.name,
      path: f.path,
      type: 'file',
      size: f.size,
      inline: f.inline,
      content_type: f.content_type,
      hash: f.hash,
      created_at: f.created_at,
      rawBlob: f.rawBlob,
      children: [],
    });
  }

  return result;
}

export interface FileTreeProps {
  blobs: BlobEntry[];
  currentPrefix: string;
  selectedItem: StorageItem | null;
  selectedKeys?: Set<string>;
  activeNamespace?: string;
  onSelectFolder: (path: string, item?: StorageItem | null) => void;
  onSelectFile: (fileItem: StorageItem) => void;
  onToggleSelectItem?: (item: StorageItem, e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent, item: StorageItem | null) => void;
  onNewFolder: () => void;
  onUpload: () => void;
  onRefresh?: () => void;
  // Drag and drop moving props
  draggedItem?: StorageItem | null;
  onItemDragStart?: (e: React.DragEvent, item: StorageItem) => void;
  onItemDragEnd?: (e: React.DragEvent) => void;
  onDropOnFolder?: (targetFolderPath: string, droppedItem?: StorageItem) => void;
  canDropOnFolder?: (dragged: StorageItem | null, targetFolderKey: string) => boolean;
  isLoading?: boolean;
  onClearSelection?: () => void;
}

export function FileTree({
  blobs,
  currentPrefix,
  selectedItem,
  selectedKeys,
  activeNamespace,
  onSelectFolder,
  onSelectFile,
  onToggleSelectItem,
  onContextMenu,
  onNewFolder,
  onUpload,
  onRefresh,
  draggedItem,
  onItemDragStart,
  onItemDragEnd,
  onDropOnFolder,
  canDropOnFolder,
  isLoading = false,
  onClearSelection,
}: FileTreeProps) {
  const treeNodes = useMemo(() => buildFileTree(blobs), [blobs]);

  // Drop target highlighted node in tree
  const [treeDragTarget, setTreeDragTarget] = useState<string | null>(null);

  // Set of expanded folder paths restored from session storage
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => {
    try {
      const key = activeNamespace ? `axiom_tree_expanded_${activeNamespace}` : 'axiom_tree_expanded';
      const saved = sessionStorage.getItem(key);
      if (saved) {
        const arr = JSON.parse(saved);
        if (Array.isArray(arr)) {
          return new Set<string>(arr);
        }
      }
    } catch {
      // Ignore storage errors
    }
    return new Set<string>();
  });

  // Persist expanded folder paths whenever they change
  useEffect(() => {
    try {
      const key = activeNamespace ? `axiom_tree_expanded_${activeNamespace}` : 'axiom_tree_expanded';
      sessionStorage.setItem(key, JSON.stringify(Array.from(expandedPaths)));
    } catch {
      // Ignore storage errors
    }
  }, [expandedPaths, activeNamespace]);

  // Automatically expand parent path when currentPrefix changes
  useEffect(() => {
    if (currentPrefix) {
      const parts = currentPrefix.split('/').filter(Boolean);
      let acc = '';
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        for (const p of parts) {
          acc += `${p}/`;
          next.add(acc);
        }
        return next;
      });
    }
  }, [currentPrefix]);

  const toggleExpand = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const toStorageItem = (node: FileTreeNode): StorageItem => {
    if (node.type === 'folder') {
      return {
        id: `folder-${node.path}`,
        type: 'folder',
        name: node.name,
        fullKey: node.path,
        itemCount: node.children.length,
      };
    }
    return {
      id: `file-${node.path}`,
      type: 'file',
      name: node.name,
      fullKey: node.path,
      size: node.size,
      inline: node.inline,
      content_type: node.content_type,
      hash: node.hash,
      created_at: node.created_at,
      rawBlob: node.rawBlob,
    };
  };

  const renderNode = (node: FileTreeNode, depth = 0) => {
    const isFolder = node.type === 'folder';
    const isExpanded = expandedPaths.has(node.path);
    const isCurrentFolder = isFolder && currentPrefix === node.path;
    const isSelected = Boolean(
      (selectedKeys && (
        selectedKeys.has(node.path) ||
        selectedKeys.has(node.id) ||
        (isFolder && selectedKeys.has(node.path.endsWith('/') ? node.path.slice(0, -1) : `${node.path}/`))
      )) ||
      (selectedItem &&
        (selectedItem.fullKey === node.path ||
          selectedItem.id === node.id ||
          selectedItem.id === `file-${node.path}` ||
          selectedItem.id === `folder-${node.path}`))
    );

    const isTreeDropTarget = isFolder && treeDragTarget === node.path;
    const isSelfDragged = draggedItem?.id === node.id;

    return (
      <div key={node.id} className="select-none">
        <div
          data-storage-item="true"
          draggable={true}
          onDragStart={(e) => onItemDragStart?.(e, toStorageItem(node))}
          onDragEnd={(e) => {
            setTreeDragTarget(null);
            onItemDragEnd?.(e);
          }}
          onDragOver={(e) => {
            if (isFolder && canDropOnFolder && canDropOnFolder(draggedItem || null, node.path)) {
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = 'move';
              if (treeDragTarget !== node.path) {
                setTreeDragTarget(node.path);
              }
            }
          }}
          onDragLeave={(e) => {
            e.stopPropagation();
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              if (treeDragTarget === node.path) {
                setTreeDragTarget(null);
              }
            }
          }}
          onDrop={(e) => {
            if (isFolder) {
              e.preventDefault();
              e.stopPropagation();
              setTreeDragTarget(null);
              onDropOnFolder?.(node.path, draggedItem || undefined);
            }
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (isFolder) {
              const item = toStorageItem(node);
              if ((e.ctrlKey || e.metaKey || e.shiftKey) && onToggleSelectItem) {
                onToggleSelectItem(item, e);
              } else {
                onSelectFolder(node.path, item);
                if (!isExpanded) {
                  setExpandedPaths((prev) => new Set(prev).add(node.path));
                }
              }
            } else {
              const item = toStorageItem(node);
              if ((e.ctrlKey || e.metaKey || e.shiftKey) && onToggleSelectItem) {
                onToggleSelectItem(item, e);
              } else {
                onSelectFile(item);
              }
            }
          }}
          onContextMenu={(e) => onContextMenu(e, toStorageItem(node))}
          style={{ paddingLeft: `${depth * 18 + 12}px` }}
          className={`group flex items-center gap-2.5 py-2 pr-4 w-full text-[13.5px] transition-colors cursor-pointer whitespace-nowrap border-b border-[#141414] select-none ${
            isSelfDragged ? 'opacity-40' : ''
          } ${
            isTreeDropTarget
              ? 'bg-blue-600/20 text-white font-medium'
              : isSelected
              ? 'bg-[#1e1e1e] text-white font-medium'
              : isCurrentFolder
              ? 'bg-[#141414] text-white font-medium'
              : 'text-[#a1a1aa] hover:text-white hover:bg-[#101010]'
          }`}
        >
          {isFolder ? (
            <>
              <button
                type="button"
                onClick={(e) => toggleExpand(node.path, e)}
                className="w-4 h-4 flex items-center justify-center text-[#777777] hover:text-white rounded shrink-0 cursor-default"
              >
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
              </button>
              {isExpanded ? (
                <FolderOpen className="w-4 h-4 text-[#8c8c8c] shrink-0" />
              ) : (
                <Folder className="w-4 h-4 text-[#8c8c8c] shrink-0" />
              )}
            </>
          ) : (
            <>
              <span className="w-4 h-4 shrink-0" />
              {getFileIcon(node.name, 'w-4 h-4 shrink-0')}
            </>
          )}

          <span className={`whitespace-nowrap pr-2 font-normal ${isSelected ? 'text-white font-medium' : ''}`} title={node.name}>
            {node.name}
          </span>
        </div>

        {/* Child Nodes with vertical connector guide */}
        {isFolder && isExpanded && node.children.length > 0 && (
          <div className="relative">
            <div
              style={{ left: `${depth * 18 + 19}px` }}
              className="absolute top-0 bottom-0 w-px bg-[#1f1f1f] pointer-events-none"
            />
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full overflow-hidden font-sans">
      {/* Explorer Tree Header Bar (h-9 matches StorageListView table header) */}
      <div className="h-10 shrink-0 px-3 border-b border-[#222222] flex items-center justify-between text-[13px] font-medium text-[#888888] bg-[#0a0a0a]">
        <div
          onClick={() => onSelectFolder('', null)}
          onDragOver={(e) => {
            if (canDropOnFolder && canDropOnFolder(draggedItem || null, '')) {
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = 'move';
              if (treeDragTarget !== '__root__') {
                setTreeDragTarget('__root__');
              }
            }
          }}
          onDragLeave={(e) => {
            e.stopPropagation();
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              if (treeDragTarget === '__root__') {
                setTreeDragTarget(null);
              }
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setTreeDragTarget(null);
            onDropOnFolder?.('', draggedItem || undefined);
          }}
          className={`flex items-center gap-1.5 cursor-default transition-colors px-1.5 py-0.5 rounded ${
            treeDragTarget === '__root__'
              ? 'bg-blue-600/30 text-blue-300 ring-1 ring-blue-500/60'
              : currentPrefix === ''
              ? 'text-white bg-[#1a1a1a]'
              : 'hover:text-white'
          }`}
          title="Root directory"
        >
          <TreeIcon className="w-4 h-4 text-[#888888]" />
          <span>Files</span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onNewFolder}
            title="New Folder"
            className="p-1.5 rounded-[6px] text-[#8c8c8c] hover:text-white hover:bg-[#1a1a1a] transition-colors cursor-pointer"
          >
            <FolderPlus className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onUpload}
            title="Upload Files"
            className="p-1.5 rounded-[6px] text-[#8c8c8c] hover:text-white hover:bg-[#1a1a1a] transition-colors cursor-pointer"
          >
            <Upload className="w-4 h-4" />
          </button>
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              title="Refresh"
              className="p-1.5 rounded-[6px] text-[#8c8c8c] hover:text-white hover:bg-[#1a1a1a] transition-colors cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Tree View Scrolling List with Horizontal & Vertical Scroll, Edge-to-Edge Grid Style */}
      <div
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest('[data-storage-item="true"]')) {
            onClearSelection?.();
          }
        }}
        className="flex-1 overflow-auto divide-y divide-[#141414] select-none font-sans scrollbar-thin scrollbar-thumb-[#262626] scrollbar-track-transparent"
      >
        <div className="min-w-full inline-block align-top">
          {isLoading ? (
            <div className="divide-y divide-[#141414] animate-pulse">
              <div className="flex items-center gap-2 py-2 px-3">
                <div className="w-4 h-4 rounded-[3px] bg-[#1a1a1a]" />
                <div className="h-3.5 w-24 rounded-[4px] bg-[#1a1a1a]" />
              </div>
              <div className="flex items-center gap-2 py-2 px-3 pl-7">
                <div className="w-4 h-4 rounded-[3px] bg-[#1a1a1a]" />
                <div className="h-3.5 w-28 rounded-[4px] bg-[#1a1a1a]" />
              </div>
              <div className="flex items-center gap-2 py-2 px-3 pl-7">
                <div className="w-4 h-4 rounded-[3px] bg-[#1a1a1a]" />
                <div className="h-3.5 w-20 rounded-[4px] bg-[#1a1a1a]" />
              </div>
              <div className="flex items-center gap-2 py-2 px-3 pl-11">
                <div className="w-4 h-4 rounded-[3px] bg-[#1a1a1a]" />
                <div className="h-3.5 w-24 rounded-[4px] bg-[#1a1a1a]" />
              </div>
            </div>
          ) : treeNodes.length === 0 ? (
            <div className="p-4 text-center text-[12px] text-[#666666]">
              No files or folders yet.
            </div>
          ) : (
            treeNodes.map((node) => renderNode(node, 0))
          )}
        </div>
      </div>
    </div>
  );
}
