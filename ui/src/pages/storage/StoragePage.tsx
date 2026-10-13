/*
 * Modern Drive/Dropbox-style cloud filesystem explorer for Axiom blob storage.
 * Owned by: ui/pages/storage
 * Key deps: ../../api/client, ../../types, ./types, ./paths, ./format, ./fileIcon, ./MoveDialog
 * Invariants: Content-addressed blobs; virtual directory paths end in '/'; single source of truth for namespace.
 * Last structural change: Complete redesign into modular Vercel/Linear dark dashboard architecture.
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Upload,
  X,
  HardDrive,
  FolderPlus,
  Plus,
} from 'lucide-react';
import { api } from '../../api/client';
import { BlobEntry, BlobStats, NamespaceInfo } from '../../types';
import { StorageItem, StorageViewMode, ClipboardState, StorageTierFilter } from './types';
import { formatBytes, QUOTA_OPTIONS } from './format';
import { sanitizeFolder, parentOf, joinKey, validateName } from './paths';
import { MoveDialog } from './MoveDialog';
import { ContextMenu, ContextMenuPosition } from './ContextMenu';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { CustomSelect } from '../../components/shared/CustomSelect';
import { UploadProgressDrawer, UploadTask } from './UploadProgressDrawer';
import { StorageSidebar } from './StorageSidebar';
import { StorageToolbar } from './StorageToolbar';
import { StorageGridView } from './StorageGridView';
import { StorageListView } from './StorageListView';
import { StorageDetailsPanel } from './StorageDetailsPanel';
import { StorageEmptyState } from './StorageEmptyState';

/**
 * Recovers persisted storage navigation parameters from URL or localStorage.
 */
function getInitialStorageState(): {
  ns: string;
  prefix: string;
  view: StorageViewMode;
} {
  try {
    const params = new URLSearchParams(window.location.search);
    const urlNs = params.get('ns');
    const urlPrefix = params.get('prefix');
    const urlView = params.get('view') as StorageViewMode | null;

    const savedNs = localStorage.getItem('axiom_storage_namespace') || '';
    const savedPrefix = localStorage.getItem('axiom_storage_prefix') || '';
    const savedView = (localStorage.getItem('axiom_storage_view_mode') as StorageViewMode) || 'grid';

    return {
      ns: urlNs !== null ? urlNs : savedNs,
      prefix: urlPrefix !== null ? urlPrefix : savedPrefix,
      view: urlView === 'grid' || urlView === 'list' ? urlView : savedView,
    };
  } catch {
    return { ns: '', prefix: '', view: 'grid' };
  }
}

export function StoragePage() {
  const initialStorage = useMemo(() => getInitialStorageState(), []);

  // Telemetry & Core Subsystem Data
  const [stats, setStats] = useState<BlobStats | null>(null);
  const [namespaces, setNamespaces] = useState<NamespaceInfo[]>([]);
  const [activeNamespace, setActiveNamespace] = useState<string>(initialStorage.ns);
  const [blobs, setBlobs] = useState<BlobEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Drive Navigation & Layout State
  const [currentPrefix, setCurrentPrefix] = useState<string>(initialStorage.prefix);
  const [viewMode, setViewMode] = useState<StorageViewMode>(initialStorage.view);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [tierFilter, setTierFilter] = useState<StorageTierFilter>('all');
  const [selectedItem, setSelectedItem] = useState<StorageItem | null>(null);

  // Context Menu (Right Click) State
  const [contextMenu, setContextMenu] = useState<{ position: ContextMenuPosition; item: StorageItem | null } | null>(null);

  // Drag and Drop & Upload Progress State
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [uploadTasks, setUploadTasks] = useState<UploadTask[]>([]);
  const [isUploadDrawerVisible, setIsUploadDrawerVisible] = useState(false);

  // Internal Object Drag & Drop Moving State
  const [draggedItem, setDraggedItem] = useState<StorageItem | null>(null);
  const draggedItemRef = useRef<StorageItem | null>(null);

  // Clipboard Buffer
  const [clipboard, setClipboard] = useState<ClipboardState | null>(null);
  const [isPasting, setIsPasting] = useState(false);

  // Dialog Modals State
  const [isNewFolderOpen, setIsNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  const [isMoveOpen, setIsMoveOpen] = useState(false);
  const [itemToMove, setItemToMove] = useState<StorageItem | null>(null);

  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [itemToRename, setItemToRename] = useState<StorageItem | null>(null);
  const [renameInput, setRenameInput] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const [itemToDelete, setItemToDelete] = useState<StorageItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Namespace Management Modals
  const [isNewNsOpen, setIsNewNsOpen] = useState(false);
  const [newNsName, setNewNsName] = useState('');
  const [newNsQuotaPreset, setNewNsQuotaPreset] = useState('unlimited');
  const [newNsCustomBytes, setNewNsCustomBytes] = useState('');
  const [isCreatingNs, setIsCreatingNs] = useState(false);

  const [isManageNsOpen, setIsManageNsOpen] = useState(false);
  const [manageNsTab, setManageNsTab] = useState<'settings' | 'danger'>('settings');
  const [editNsName, setEditNsName] = useState('');
  const [editNsQuotaPreset, setEditNsQuotaPreset] = useState('unlimited');
  const [editNsCustomBytes, setEditNsCustomBytes] = useState('');
  const [isSavingNs, setIsSavingNs] = useState(false);
  const [nsToDelete, setNsToDelete] = useState<NamespaceInfo | null>(null);
  const [isDeletingNs, setIsDeletingNs] = useState(false);

  // Verification & Copy Feedback Map
  const [verifyMap, setVerifyMap] = useState<Record<string, 'verifying' | 'valid' | 'invalid'>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Race condition guard for concurrent data loads
  const fetchGenRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  // Mutable reference for active path to avoid dependency cycle in loadData
  const currentPrefixRef = useRef(currentPrefix);
  useEffect(() => {
    currentPrefixRef.current = currentPrefix;
  }, [currentPrefix]);

  const activeNsRef = useRef(activeNamespace);
  useEffect(() => {
    activeNsRef.current = activeNamespace;
  }, [activeNamespace]);

  // Keep URL search parameters and localStorage synchronized with active navigation state
  const syncLocation = useCallback((ns: string, prefix: string, pushHistory = false) => {
    try {
      if (ns) {
        localStorage.setItem('axiom_storage_namespace', ns);
      }
      localStorage.setItem('axiom_storage_prefix', prefix);

      const params = new URLSearchParams(window.location.search);
      if (ns) {
        params.set('ns', ns);
      } else {
        params.delete('ns');
      }
      if (prefix) {
        params.set('prefix', prefix);
      } else {
        params.delete('prefix');
      }

      const queryStr = params.toString();
      const currentSearch = window.location.search ? window.location.search.slice(1) : '';
      if (queryStr !== currentSearch) {
        const newUrl = queryStr ? `${window.location.pathname}?${queryStr}` : window.location.pathname;
        if (pushHistory) {
          window.history.pushState(null, '', newUrl);
        } else {
          window.history.replaceState(null, '', newUrl);
        }
      }
    } catch {
      // Ignore storage/history errors in restricted environments
    }
  }, []);

  // Navigate directly into a directory prefix with browser history push support
  const navigateToPrefix = useCallback(
    (newPrefix: string, pushHistory = true, keepItem?: StorageItem | null) => {
      setCurrentPrefix(newPrefix);
      if (keepItem !== undefined) {
        setSelectedItem(keepItem);
      } else {
        setSelectedItem(null);
      }
      syncLocation(activeNsRef.current, newPrefix, pushHistory);
    },
    [syncLocation]
  );

  // Listen for browser Back and Forward navigation (popstate)
  useEffect(() => {
    const handlePopState = () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const urlNs = params.get('ns') || localStorage.getItem('axiom_storage_namespace') || '';
        const urlPrefix = params.get('prefix') || '';
        if (urlNs && urlNs !== activeNsRef.current) {
          setActiveNamespace(urlNs);
          api
            .listBlobs(urlNs)
            .then((res) => setBlobs(res.items || []))
            .catch(() => setBlobs([]));
        }
        setCurrentPrefix(urlPrefix);
        setSelectedItem(null);
      } catch {
        // Ignore popstate errors
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  // View mode switcher with persistence
  const handleViewModeChange = (mode: StorageViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem('axiom_storage_view_mode', mode);
      const url = new URL(window.location.href);
      url.searchParams.set('view', mode);
      window.history.replaceState(null, '', url.toString());
    } catch {
      // Ignore
    }
  };

  // Toggle details inspector panel (always collapses on reload)
  const handleToggleDetails = () => {
    setIsDetailsOpen((prev) => !prev);
  };

  // Master telemetry and namespace catalog loader
  const loadData = useCallback(async (targetNs?: string) => {
    const curGen = ++fetchGenRef.current;
    setLoadError(null);
    setIsRefreshing(true);

    try {
      const [statsRes, nsListRes] = await Promise.allSettled([
        api.getBlobStats(),
        api.listBlobNamespaces(),
      ]);

      if (curGen !== fetchGenRef.current) return;

      if (statsRes.status === 'fulfilled') {
        setStats(statsRes.value);
      }

      let activeNs = targetNs !== undefined ? targetNs : activeNsRef.current;

      if (nsListRes.status === 'fulfilled') {
        const nsList: NamespaceInfo[] = Array.isArray(nsListRes.value) ? nsListRes.value : [];
        setNamespaces(nsList);

        if (!activeNs && nsList.length > 0) {
          activeNs = nsList[0].name;
          setActiveNamespace(activeNs);
          syncLocation(activeNs, currentPrefixRef.current, false);
        } else if (activeNs && !nsList.some((n: NamespaceInfo) => n.name === activeNs)) {
          if (nsList.length > 0) {
            activeNs = nsList[0].name;
            setActiveNamespace(activeNs);
            syncLocation(activeNs, '', false);
          } else {
            activeNs = '';
            setActiveNamespace('');
            syncLocation('', '', false);
          }
        }
      }

      if (activeNs) {
        try {
          const listRes = await api.listBlobs(activeNs);
          if (curGen === fetchGenRef.current) {
            const items = listRes.items || [];
            setBlobs(items);
            if (
              currentPrefixRef.current &&
              items.length > 0 &&
              !items.some((b) => b.key.startsWith(currentPrefixRef.current))
            ) {
              const parent = parentOf(currentPrefixRef.current);
              setCurrentPrefix(parent);
              syncLocation(activeNs, parent, false);
            }
          }
        } catch {
          if (curGen === fetchGenRef.current) {
            setBlobs([]);
          }
        }
      } else {
        if (curGen === fetchGenRef.current) {
          setBlobs([]);
        }
      }
    } catch (err: unknown) {
      if (curGen === fetchGenRef.current) {
        setLoadError(err instanceof Error ? err.message : 'Failed to connect to Blob Storage Subsystem');
      }
    } finally {
      if (curGen === fetchGenRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [syncLocation]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle active namespace switch
  const handleNamespaceChange = async (ns: string) => {
    setActiveNamespace(ns);
    setCurrentPrefix('');
    setSelectedItem(null);
    syncLocation(ns, '', true);
    setIsLoading(true);
    try {
      const res = await api.listBlobs(ns);
      setBlobs(res.items || []);
    } catch {
      setBlobs([]);
    } finally {
      setIsLoading(false);
    }
  };

  const currentNsInfo = useMemo(() => {
    return namespaces.find((n) => n.name === activeNamespace) || null;
  }, [namespaces, activeNamespace]);

  // Derive interactive breadcrumbs
  const breadcrumbSegments = useMemo(() => {
    if (!currentPrefix) return [];
    const parts = currentPrefix.split('/').filter(Boolean);
    let accumulated = '';
    return parts.map((part) => {
      accumulated += `${part}/`;
      return {
        name: part,
        prefix: accumulated,
      };
    });
  }, [currentPrefix]);

  // Derive all folders and files under current prefix
  const { folderItems, fileItems } = useMemo(() => {
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      const matched = blobs
        .filter((item) => {
          const matchesSearch = item.key.toLowerCase().includes(q);
          const matchesTier =
            tierFilter === 'all' ||
            (tierFilter === 'inline' && item.inline) ||
            (tierFilter === 'disk' && !item.inline);
          return matchesSearch && matchesTier && !item.key.endsWith('/.axiom_dir');
        })
        .map((item) => ({
          id: `file-${item.key}`,
          type: 'file' as const,
          name: item.key.split('/').pop() || item.key,
          fullKey: item.key,
          size: item.size,
          inline: item.inline,
          content_type: item.content_type,
          hash: item.hash,
          created_at: item.created_at,
          rawBlob: item,
        }));
      return { folderItems: [], fileItems: matched };
    }

    const folderMap = new Map<string, { itemCount: number; totalBytes: number }>();
    const files: StorageItem[] = [];

    for (const b of blobs) {
      if (!b.key.startsWith(currentPrefix)) continue;
      const rel = b.key.slice(currentPrefix.length);
      if (!rel || rel === '.axiom_dir') continue;

      const slashIndex = rel.indexOf('/');
      if (slashIndex !== -1) {
        const folderName = rel.slice(0, slashIndex);
        const entry = folderMap.get(folderName) || { itemCount: 0, totalBytes: 0 };
        if (!b.key.endsWith('/.axiom_dir')) {
          entry.itemCount += 1;
          entry.totalBytes += b.size;
        }
        folderMap.set(folderName, entry);
      } else {
        if (!b.key.endsWith('/.axiom_dir')) {
          const matchesTier =
            tierFilter === 'all' ||
            (tierFilter === 'inline' && b.inline) ||
            (tierFilter === 'disk' && !b.inline);

          if (matchesTier) {
            files.push({
              id: `file-${b.key}`,
              type: 'file',
              name: rel,
              fullKey: b.key,
              size: b.size,
              inline: b.inline,
              content_type: b.content_type,
              hash: b.hash,
              created_at: b.created_at,
              rawBlob: b,
            });
          }
        }
      }
    }

    const folders: StorageItem[] = Array.from(folderMap.entries())
      .map(([name, data]) => ({
        id: `folder-${currentPrefix}${name}/`,
        type: 'folder' as const,
        name,
        fullKey: `${currentPrefix}${name}/`,
        itemCount: data.itemCount,
        totalBytes: data.totalBytes,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    files.sort((a, b) => a.name.localeCompare(b.name));

    return { folderItems: folders, fileItems: files };
  }, [blobs, currentPrefix, searchQuery, tierFilter]);

  // Inspector item: use selectedItem if explicitly selected; otherwise, if user is inside a folder, derive folder item
  const inspectorItem = useMemo<StorageItem | null>(() => {
    if (selectedItem) return selectedItem;
    if (currentPrefix) {
      const folderName = currentPrefix.replace(/\/$/, '').split('/').pop() || currentPrefix;
      return {
        id: `folder-${currentPrefix}`,
        type: 'folder',
        name: folderName,
        fullKey: currentPrefix,
        itemCount: folderItems.length + fileItems.length,
        totalBytes: fileItems.reduce((acc, f) => acc + (f.size || 0), 0),
      };
    }
    return null;
  }, [selectedItem, currentPrefix, folderItems.length, fileItems]);

  // Live object count excluding internal directory markers
  const realObjectsCount = useMemo(() => {
    return blobs.filter((b) => !b.key.endsWith('/.axiom_dir') && b.key !== '.axiom_dir').length;
  }, [blobs]);

  // Available directories for MoveDialog destination picker
  const availableFolders = useMemo(() => {
    const dirs = new Set<string>();
    for (const b of blobs) {
      const parts = b.key.split('/');
      let prefix = '';
      for (let i = 0; i < parts.length - 1; i++) {
        prefix += `${parts[i]}/`;
        dirs.add(prefix);
      }
    }
    return Array.from(dirs).sort();
  }, [blobs]);

  // Cancel all upload tasks
  const handleCancelAllUploads = useCallback(() => {
    setUploadTasks((prev) => {
      prev.forEach((t) => {
        if (t.status === 'uploading' || t.status === 'pending') {
          t.abortController?.abort();
        }
      });
      return prev.map((t) =>
        t.status === 'uploading' || t.status === 'pending'
          ? { ...t, status: 'cancelled' as const, error: 'Cancelled by user' }
          : t
      );
    });
  }, []);

  // Cancel single upload task by ID
  const handleCancelUploadTask = useCallback((id: string) => {
    setUploadTasks((prev) =>
      prev.map((t) => {
        if (t.id === id) {
          t.abortController?.abort();
          return { ...t, status: 'cancelled' as const, error: 'Cancelled' };
        }
        return t;
      })
    );
  }, []);

  // Direct upload handler
  const handleUploadFiles = async (files: FileList | File[], destinationPrefix?: string) => {
    if (!files || files.length === 0 || !activeNamespace) return;

    const targetPrefix = destinationPrefix !== undefined ? sanitizeFolder(destinationPrefix) : currentPrefix;
    const fileList = Array.from(files);
    const newTasks: UploadTask[] = fileList.map((file, idx) => ({
      id: `task-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
      name: file.name,
      size: file.size,
      key: `${targetPrefix}${file.name}`,
      namespace: activeNamespace,
      status: 'pending' as const,
      abortController: new AbortController(),
    }));

    setUploadTasks((prev) => [...prev, ...newTasks]);
    setIsUploadDrawerVisible(true);

    for (let i = 0; i < newTasks.length; i++) {
      const task = newTasks[i];
      const file = fileList[i];

      if (task.abortController?.signal.aborted) {
        continue;
      }

      setUploadTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, status: 'uploading' as const } : t))
      );

      try {
        await api.uploadBlob(
          task.namespace,
          task.key,
          file,
          file.type || 'application/octet-stream',
          task.abortController?.signal
        );

        setUploadTasks((prev) =>
          prev.map((t) => (t.id === task.id ? { ...t, status: 'completed' as const } : t))
        );

        await loadData();
      } catch (err: unknown) {
        const isAborted = task.abortController?.signal.aborted;
        setUploadTasks((prev) =>
          prev.map((t) =>
            t.id === task.id
              ? {
                  ...t,
                  status: isAborted ? ('cancelled' as const) : ('failed' as const),
                  error: isAborted ? 'Cancelled' : err instanceof Error ? err.message : 'Upload failed',
                }
              : t
          )
        );
      }
    }
  };

  // Check if an item can legally be dropped onto target folder
  const canDropOnFolder = useCallback((dragged: StorageItem | null, targetFolderKey: string): boolean => {
    if (!dragged) return false;

    const normTarget = targetFolderKey ? sanitizeFolder(targetFolderKey) : '';
    const normSrc = dragged.type === 'folder' ? sanitizeFolder(dragged.fullKey) : dragged.fullKey;

    if (dragged.fullKey === targetFolderKey || (dragged.type === 'folder' && normSrc === normTarget)) {
      return false;
    }

    if (dragged.type === 'folder' && normTarget.startsWith(normSrc)) {
      return false;
    }

    const parentOfSrc = parentOf(dragged.fullKey);
    if (parentOfSrc === normTarget || parentOfSrc === targetFolderKey) {
      return false;
    }

    return true;
  }, []);

  // Drop item directly into target folder (internal move)
  const handleDropOnFolder = async (targetFolderKey: string, droppedItem?: StorageItem) => {
    const item = droppedItem || draggedItemRef.current;
    if (!item || !activeNamespace) return;

    if (!canDropOnFolder(item, targetFolderKey)) {
      return;
    }

    const isFolder = item.type === 'folder';
    const normTarget = targetFolderKey ? sanitizeFolder(targetFolderKey) : '';
    const destKey = joinKey(normTarget, item.name, isFolder);

    try {
      await api.moveBlob(activeNamespace, item.fullKey, destKey, activeNamespace, isFolder);
      if (selectedItem?.fullKey === item.fullKey) {
        setSelectedItem(null);
      }
      await loadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to move item into folder');
    }
  };

  // Drag over desktop upload triggers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggedItemRef.current) return;
    dragCounterRef.current += 1;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDraggingOver(true);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggedItemRef.current) return;
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggedItemRef.current) return;
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      setIsDraggingOver(false);
      dragCounterRef.current = 0;
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    dragCounterRef.current = 0;

    if (draggedItemRef.current) {
      return;
    }

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await handleUploadFiles(e.dataTransfer.files);
    }
  };

  // Internal item drag handlers
  const handleItemDragStart = (e: React.DragEvent, item: StorageItem) => {
    setDraggedItem(item);
    draggedItemRef.current = item;
    e.dataTransfer.setData('text/plain', item.fullKey);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleItemDragEnd = () => {
    setDraggedItem(null);
    draggedItemRef.current = null;
  };

  // Context menu open handler
  const handleContextMenu = (e: React.MouseEvent, item: StorageItem | null) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      position: { x: e.clientX, y: e.clientY },
      item,
    });
  };

  // Create new folder
  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validateName(newFolderName);
    if (err) {
      alert(err);
      return;
    }
    setIsCreatingFolder(true);
    try {
      const folderKey = `${currentPrefix}${newFolderName.trim()}/.axiom_dir`;
      await api.uploadBlob(activeNamespace, folderKey, new Blob([]), 'application/x-directory');
      setIsNewFolderOpen(false);
      setNewFolderName('');
      await loadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to create folder');
    } finally {
      setIsCreatingFolder(false);
    }
  };

  // Move item handler
  const handleMove = async (destNs: string, destKey: string) => {
    if (!itemToMove) return;
    const isFolder = itemToMove.type === 'folder';
    await api.moveBlob(activeNamespace, itemToMove.fullKey, destKey, destNs, isFolder);
    setItemToMove(null);
    if (selectedItem?.fullKey === itemToMove.fullKey) {
      setSelectedItem(null);
    }
    await loadData();
  };

  // Rename item handler
  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemToRename) return;
    const err = validateName(renameInput);
    if (err) {
      setRenameError(err);
      return;
    }
    if (renameInput.trim() === itemToRename.name) {
      setIsRenameOpen(false);
      return;
    }

    const isFolder = itemToRename.type === 'folder';
    const parentDir = parentOf(itemToRename.fullKey);
    const destKey = joinKey(parentDir, renameInput.trim(), isFolder);

    setIsRenaming(true);
    setRenameError(null);
    try {
      await api.moveBlob(activeNamespace, itemToRename.fullKey, destKey, activeNamespace, isFolder);
      setIsRenameOpen(false);
      setItemToRename(null);
      if (selectedItem?.fullKey === itemToRename.fullKey) {
        setSelectedItem((prev) => (prev ? { ...prev, name: renameInput.trim(), fullKey: destKey } : null));
      }
      await loadData();
    } catch (err: unknown) {
      setRenameError(err instanceof Error ? err.message : 'Failed to rename item');
    } finally {
      setIsRenaming(false);
    }
  };

  // Delete item handler
  const handleDeleteItem = async () => {
    if (!itemToDelete) return;
    const deleted = itemToDelete;
    setIsDeleting(true);
    try {
      if (deleted.type === 'folder') {
        await api.deleteBlobPrefix(activeNamespace, deleted.fullKey);
      } else {
        await api.deleteBlob(activeNamespace, deleted.fullKey);
      }

      // Optimistically remove deleted items from local state
      setBlobs((prev) =>
        deleted.type === 'folder'
          ? prev.filter((b) => !b.key.startsWith(deleted.fullKey))
          : prev.filter((b) => b.key !== deleted.fullKey)
      );

      // Deselect if currently selected item was deleted or was inside deleted folder
      if (
        selectedItem &&
        (selectedItem.fullKey === deleted.fullKey ||
          (deleted.type === 'folder' && selectedItem.fullKey.startsWith(deleted.fullKey)))
      ) {
        setSelectedItem(null);
      }

      // If deleted item is a folder and currentPrefix is inside or equal to the deleted folder,
      // navigate back to the parent of the deleted folder so newly created folders don't nest under it
      if (deleted.type === 'folder' && currentPrefix.startsWith(deleted.fullKey)) {
        const parent = parentOf(deleted.fullKey);
        navigateToPrefix(parent, true);
      }

      setItemToDelete(null);
      await loadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to delete item');
    } finally {
      setIsDeleting(false);
    }
  };

  // Download file handler
  const handleDownload = async (key: string) => {
    try {
      const blob = await api.downloadBlob(activeNamespace, key);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = key.split('/').pop() || 'blob.bin';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Download failed');
    }
  };

  // Verify blob cryptographic hash integrity
  const handleVerifyBlob = async (key: string) => {
    const id = `${activeNamespace}/${key}`;
    setVerifyMap((prev) => ({ ...prev, [id]: 'verifying' }));
    try {
      const res = await api.verifyBlob(activeNamespace, key);
      setVerifyMap((prev) => ({ ...prev, [id]: res.valid ? 'valid' : 'invalid' }));
    } catch {
      setVerifyMap((prev) => ({ ...prev, [id]: 'invalid' }));
    }
  };

  // Copy text utility
  const handleCopyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // Paste item from clipboard
  const handlePaste = async () => {
    if (!clipboard) return;
    setIsPasting(true);
    try {
      const destKey = joinKey(currentPrefix, clipboard.name, clipboard.isFolder);
      if (clipboard.mode === 'copy') {
        await api.copyBlob(clipboard.namespace, clipboard.key, destKey, activeNamespace, clipboard.isFolder);
      } else {
        await api.moveBlob(clipboard.namespace, clipboard.key, destKey, activeNamespace, clipboard.isFolder);
        setClipboard(null);
      }
      await loadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to paste item');
    } finally {
      setIsPasting(false);
    }
  };

  // Create namespace handler
  const handleCreateNamespace = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newNsName.trim();
    if (!name) return;
    setIsCreatingNs(true);
    try {
      let maxBytes: number | undefined;
      if (newNsQuotaPreset === 'custom') {
        const val = parseInt(newNsCustomBytes, 10);
        if (!isNaN(val) && val > 0) maxBytes = val;
      } else if (newNsQuotaPreset !== 'unlimited') {
        maxBytes = parseInt(newNsQuotaPreset, 10);
      }
      await api.createBlobNamespace(name, maxBytes);
      setIsNewNsOpen(false);
      setNewNsName('');
      setActiveNamespace(name);
      setCurrentPrefix('');
      syncLocation(name, '', true);
      await loadData(name);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to create namespace');
    } finally {
      setIsCreatingNs(false);
    }
  };

  // Update namespace handler
  const handleUpdateNamespace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentNsInfo) return;
    const name = editNsName.trim();
    if (!name) return;
    setIsSavingNs(true);
    try {
      let maxBytes: number | null = null;
      if (editNsQuotaPreset === 'custom') {
        const val = parseInt(editNsCustomBytes, 10);
        if (!isNaN(val) && val > 0) maxBytes = val;
      } else if (editNsQuotaPreset !== 'unlimited') {
        maxBytes = parseInt(editNsQuotaPreset, 10);
      }
      await api.updateBlobNamespace(currentNsInfo.name, { new_name: name, max_bytes: maxBytes });
      setIsManageNsOpen(false);
      if (currentNsInfo.name === activeNamespace) {
        setActiveNamespace(name);
        syncLocation(name, currentPrefixRef.current, false);
      }
      await loadData(name);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to update namespace');
    } finally {
      setIsSavingNs(false);
    }
  };

  // Delete namespace handler
  const handleDeleteNamespace = async () => {
    if (!nsToDelete) return;
    setIsDeletingNs(true);
    try {
      await api.deleteBlobNamespace(nsToDelete.name);
      setNsToDelete(null);
      setIsManageNsOpen(false);
      setActiveNamespace('');
      setCurrentPrefix('');
      syncLocation('', '', false);
      await loadData('');
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to delete namespace');
    } finally {
      setIsDeletingNs(false);
    }
  };

  // Capacity calculation
  const quotaUsedPercent = useMemo(() => {
    if (!currentNsInfo || !currentNsInfo.max_bytes || currentNsInfo.max_bytes === 0) return null;
    return Math.min(100, Math.round((currentNsInfo.total_bytes / currentNsInfo.max_bytes) * 100));
  }, [currentNsInfo]);

  return (
    <div className="flex flex-col lg:flex-row w-full h-full min-h-0 select-none font-sans overflow-hidden bg-[#0c0c0c]">
      {/* Hidden File Input for Native Upload Trigger */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) {
            handleUploadFiles(e.target.files);
            e.target.value = '';
          }
        }}
      />

      {/* ─── Pane 1: Drive Sidebar (Namespaces & FileTree) ─────────────── */}
      <StorageSidebar
        namespaces={namespaces}
        activeNamespace={activeNamespace}
        onSelectNamespace={handleNamespaceChange}
        onOpenNewNamespace={() => {
          setNewNsName('');
          setNewNsQuotaPreset('unlimited');
          setNewNsCustomBytes('');
          setIsNewNsOpen(true);
        }}
        onOpenManageNamespace={() => {
          const ns = namespaces.find((n) => n.name === activeNamespace);
          if (ns) {
            setEditNsName(ns.name);
            if (!ns.max_bytes) {
              setEditNsQuotaPreset('unlimited');
              setEditNsCustomBytes('');
            } else {
              const match = QUOTA_OPTIONS.find((opt) => opt.value === ns.max_bytes?.toString());
              if (match) {
                setEditNsQuotaPreset(match.value);
                setEditNsCustomBytes('');
              } else {
                setEditNsQuotaPreset('custom');
                setEditNsCustomBytes(ns.max_bytes.toString());
              }
            }
            setManageNsTab('settings');
            setIsManageNsOpen(true);
          }
        }}
        onRefresh={() => loadData()}
        isLoading={isLoading}
        currentNsInfo={currentNsInfo}
        quotaUsedPercent={quotaUsedPercent}
        realObjectsCount={realObjectsCount}
        blobs={blobs}
        currentPrefix={currentPrefix}
        selectedItem={selectedItem}
        onSelectFolder={(path, item) => {
          navigateToPrefix(path, true, item);
        }}
        onSelectFile={(fileItem) => {
          setSelectedItem(fileItem);
        }}
        onContextMenu={handleContextMenu}
        onNewFolder={() => {
          setNewFolderName('');
          setIsNewFolderOpen(true);
        }}
        onUpload={() => fileInputRef.current?.click()}
        draggedItem={draggedItem}
        onItemDragStart={handleItemDragStart}
        onItemDragEnd={handleItemDragEnd}
        onDropOnFolder={handleDropOnFolder}
        canDropOnFolder={canDropOnFolder}
      />

      {/* ─── Pane 2: File Explorer Main Center Canvas ─────────────── */}
      <section
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className="flex-1 flex flex-col bg-[#0c0c0c] min-w-0 overflow-hidden relative"
      >
        {/* Drag and Drop Active Overlay */}
        {isDraggingOver && (
          <div className="absolute inset-0 z-30 pointer-events-none select-none bg-black/85 backdrop-blur-xs border-2 border-dashed border-[#555555] rounded-[10px] flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-100 font-sans">
            <Upload className="w-8 h-8 text-white mb-2 animate-bounce" />
            <h3 className="text-[15px] font-medium text-white">Drop files to upload</h3>
            <p className="text-[12px] text-[#777777] mt-1">
              Uploading directly into {activeNamespace} / {currentPrefix || 'root'}
            </p>
          </div>
        )}

        {/* Top Drive Explorer Toolbar */}
        <StorageToolbar
          activeNamespace={activeNamespace}
          currentPrefix={currentPrefix}
          breadcrumbSegments={breadcrumbSegments}
          onNavigateToPrefix={(p) => navigateToPrefix(p, true)}
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
          tierFilter={tierFilter}
          onTierFilterChange={setTierFilter}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onUploadClick={() => fileInputRef.current?.click()}
          isDetailsOpen={isDetailsOpen}
          onToggleDetails={handleToggleDetails}
          canDropOnFolder={canDropOnFolder}
          draggedItemRef={draggedItemRef}
          onDropOnFolder={handleDropOnFolder}
        />

        {/* Main Files/Folders View Area */}
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setSelectedItem(null);
            }
          }}
          onContextMenu={(e) => {
            if (e.target === e.currentTarget) {
              handleContextMenu(e, null);
            }
          }}
          className={`flex-1 min-h-0 flex flex-col ${
            !isLoading && activeNamespace && (folderItems.length > 0 || fileItems.length > 0) && viewMode === 'list'
              ? 'p-0 overflow-hidden'
              : 'p-4 overflow-y-auto'
          }`}
        >
          {/* Loading Skeleton */}
          {isLoading && (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="h-28 rounded-[6px] bg-[#141414] border border-[#222222] animate-pulse" />
              ))}
            </div>
          )}

          {/* Empty State: No namespaces */}
          {!isLoading && namespaces.length === 0 && (
            <StorageEmptyState
              type="no-namespaces"
              onCreateNamespace={() => {
                setNewNsName('');
                setNewNsQuotaPreset('unlimited');
                setNewNsCustomBytes('');
                setIsNewNsOpen(true);
              }}
            />
          )}

          {/* Empty State: Namespaces exist but none selected */}
          {!isLoading && namespaces.length > 0 && !activeNamespace && (
            <StorageEmptyState type="no-namespace-selected" />
          )}

          {/* Empty State: Active namespace/folder has no search matches */}
          {!isLoading && activeNamespace && searchQuery.trim() !== '' && fileItems.length === 0 && (
            <StorageEmptyState
              type="no-search-results"
              searchQuery={searchQuery}
              onClearSearch={() => setSearchQuery('')}
            />
          )}

          {/* Empty State: Active folder is empty */}
          {!isLoading &&
            activeNamespace &&
            searchQuery.trim() === '' &&
            folderItems.length === 0 &&
            fileItems.length === 0 && (
              <StorageEmptyState
                type="empty-folder"
                onUpload={() => fileInputRef.current?.click()}
              />
            )}

          {/* Real Content View */}
          {!isLoading && activeNamespace && (folderItems.length > 0 || fileItems.length > 0) && (
            viewMode === 'grid' ? (
              <StorageGridView
                folderItems={folderItems}
                fileItems={fileItems}
                selectedItem={selectedItem}
                onSelectItem={(item) => setSelectedItem(item)}
                onNavigateToPrefix={(p) => navigateToPrefix(p, true)}
                onContextMenu={handleContextMenu}
                onOpenMove={(item) => {
                  setItemToMove(item);
                  setIsMoveOpen(true);
                }}
                onDownload={handleDownload}
                onDelete={(item) => setItemToDelete(item)}
                draggedItem={draggedItem}
                draggedItemRef={draggedItemRef}
                onItemDragStart={handleItemDragStart}
                onItemDragEnd={handleItemDragEnd}
                onDropOnFolder={handleDropOnFolder}
                onUploadFiles={handleUploadFiles}
                canDropOnFolder={canDropOnFolder}
              />
            ) : (
              <StorageListView
                folderItems={folderItems}
                fileItems={fileItems}
                selectedItem={selectedItem}
                onSelectItem={(item) => setSelectedItem(item)}
                onNavigateToPrefix={(p) => navigateToPrefix(p, true)}
                onContextMenu={handleContextMenu}
                onDownload={handleDownload}
                onOpenMove={(item) => {
                  setItemToMove(item);
                  setIsMoveOpen(true);
                }}
                onDelete={(item) => setItemToDelete(item)}
                draggedItem={draggedItem}
                draggedItemRef={draggedItemRef}
                onItemDragStart={handleItemDragStart}
                onItemDragEnd={handleItemDragEnd}
                onDropOnFolder={handleDropOnFolder}
                canDropOnFolder={canDropOnFolder}
              />
            )
          )}
        </div>
      </section>

      {/* ─── Pane 3: Right Inspector / Details Panel ─────────────── */}
      <StorageDetailsPanel
        isOpen={isDetailsOpen}
        onClose={() => setIsDetailsOpen(false)}
        selectedItem={inspectorItem}
        activeNamespace={activeNamespace}
        currentNsInfo={currentNsInfo}
        onDownload={handleDownload}
        onOpenMove={(item) => {
          setItemToMove(item);
          setIsMoveOpen(true);
        }}
        onDelete={(item) => setItemToDelete(item)}
        onVerifyBlob={handleVerifyBlob}
        verifyStatus={inspectorItem ? verifyMap[`${activeNamespace}/${inspectorItem.fullKey}`] : undefined}
        onCopyText={handleCopyText}
        copiedKey={copiedKey}
      />

      {/* ─── Dialogs & Modals ─────────────── */}

      {/* New Folder Modal */}
      {isNewFolderOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs font-sans">
          <div className="w-full max-w-sm rounded-[8px] bg-[#0e0e0e] border border-[#262626] p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[14px] font-medium text-white">New Folder</h3>
              <button
                type="button"
                onClick={() => setIsNewFolderOpen(false)}
                className="text-[#777777] hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateFolder} className="space-y-4">
              <div>
                <label className="block text-[13px] text-[#999999] font-medium mb-1.5">
                  Folder Name
                </label>
                <input
                  type="text"
                  autoFocus
                  required
                  placeholder="e.g. assets"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  className="w-full h-9 px-3 rounded-[6px] bg-[#141414] border border-[#262626] focus:border-[#383838] text-white text-[13.5px] sm:text-[14px] outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsNewFolderOpen(false)}
                  className="h-9 px-3.5 rounded-[6px] text-[13.5px] sm:text-[14px] font-medium text-[#cccccc] hover:text-white bg-transparent hover:bg-[#161616] border border-[#262626] transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreatingFolder || !newFolderName.trim()}
                  className="h-9 px-4 rounded-[6px] text-[13.5px] sm:text-[14px] font-medium text-white bg-blue-600 hover:bg-blue-500 border border-blue-500/80 transition-colors cursor-pointer disabled:opacity-40"
                >
                  {isCreatingFolder ? 'Creating...' : 'Create Folder'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rename Modal */}
      {isRenameOpen && itemToRename && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs font-sans">
          <div className="w-full max-w-sm rounded-[8px] bg-[#0e0e0e] border border-[#262626] p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[14.5px] sm:text-[15px] font-semibold text-white">Rename Item</h3>
              <button
                type="button"
                onClick={() => setIsRenameOpen(false)}
                className="text-[#777777] hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleRename} className="space-y-4">
              <div>
                <label className="block text-[13px] text-[#999999] font-medium mb-1.5">
                  New Name
                </label>
                <input
                  type="text"
                  autoFocus
                  required
                  value={renameInput}
                  onChange={(e) => setRenameInput(e.target.value)}
                  className="w-full h-9 px-3 rounded-[6px] bg-[#141414] border border-[#262626] focus:border-[#383838] text-white text-[13.5px] sm:text-[14px] outline-none"
                />
                {renameError && (
                  <p className="text-[12px] text-rose-400 mt-1">{renameError}</p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsRenameOpen(false)}
                  className="h-9 px-3.5 rounded-[6px] text-[13.5px] sm:text-[14px] font-medium text-[#cccccc] hover:text-white bg-transparent hover:bg-[#161616] border border-[#262626] transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isRenaming || !renameInput.trim()}
                  className="h-9 px-4 rounded-[6px] text-[13.5px] sm:text-[14px] font-medium text-white bg-blue-600 hover:bg-blue-500 border border-blue-500/80 transition-colors cursor-pointer disabled:opacity-40"
                >
                  {isRenaming ? 'Renaming...' : 'Rename'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Item Confirm Dialog */}
      <ConfirmDialog
        isOpen={itemToDelete !== null}
        onClose={() => setItemToDelete(null)}
        onConfirm={handleDeleteItem}
        title={`Delete ${itemToDelete?.type === 'folder' ? 'Folder' : 'File'}`}
        description={
          itemToDelete ? (
            <span>
              Are you sure you want to permanently delete{' '}
              <strong className="text-white">{itemToDelete.name}</strong>
              {itemToDelete.type === 'folder' ? ' and all objects inside it?' : '?'}
            </span>
          ) : (
            'Are you sure you want to delete this item?'
          )
        }
        confirmLabel={isDeleting ? 'Deleting...' : 'Delete'}
        variant="danger"
      />

      {/* Move Dialog Modal */}
      <MoveDialog
        isOpen={isMoveOpen}
        onClose={() => {
          setIsMoveOpen(false);
          setItemToMove(null);
        }}
        item={itemToMove}
        namespaces={namespaces}
        currentNamespace={activeNamespace}
        availableFolders={availableFolders}
        onMove={handleMove}
      />

      {/* New Namespace Modal */}
      {isNewNsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs font-sans">
          <div className="w-full max-w-sm rounded-[8px] bg-[#0e0e0e] border border-[#262626] p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[14.5px] sm:text-[15px] font-semibold text-white">Create Namespace</h3>
              <button
                type="button"
                onClick={() => setIsNewNsOpen(false)}
                className="text-[#777777] hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateNamespace} className="space-y-4">
              <div>
                <label className="block text-[13px] text-[#999999] font-medium mb-1.5">
                  Namespace Name
                </label>
                <input
                  type="text"
                  autoFocus
                  required
                  placeholder="e.g. avatars, invoices"
                  value={newNsName}
                  onChange={(e) => setNewNsName(e.target.value)}
                  className="w-full h-9 px-3 rounded-[6px] bg-[#141414] border border-[#262626] focus:border-[#383838] text-white text-[13.5px] sm:text-[14px] outline-none"
                />
              </div>

              <div>
                <label className="block text-[13px] text-[#999999] font-medium mb-1.5">
                  Storage Quota Limit
                </label>
                <CustomSelect
                  value={newNsQuotaPreset}
                  options={QUOTA_OPTIONS}
                  onChange={(val) => setNewNsQuotaPreset(val)}
                  size="sm"
                />
              </div>

              {newNsQuotaPreset === 'custom' && (
                <div>
                  <label className="block text-[13px] text-[#999999] font-medium mb-1.5">
                    Limit in Bytes
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={newNsCustomBytes}
                    onChange={(e) => setNewNsCustomBytes(e.target.value)}
                    placeholder="e.g. 104857600"
                    className="w-full h-9 px-3 rounded-[6px] bg-[#141414] border border-[#262626] focus:border-[#383838] text-white text-[13.5px] sm:text-[14px] outline-none"
                  />
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsNewNsOpen(false)}
                  className="h-9 px-3.5 rounded-[6px] text-[13.5px] sm:text-[14px] font-medium text-[#cccccc] hover:text-white bg-transparent hover:bg-[#161616] border border-[#262626] transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreatingNs || !newNsName.trim()}
                  className="h-9 px-4 rounded-[6px] text-[13.5px] sm:text-[14px] font-medium text-white bg-blue-600 hover:bg-blue-500 border border-blue-500/80 transition-colors cursor-pointer disabled:opacity-40"
                >
                  {isCreatingNs ? 'Creating...' : 'Create Namespace'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manage Namespace Modal */}
      {isManageNsOpen && currentNsInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs font-sans">
          <div className="w-full max-w-md rounded-[8px] bg-[#0e0e0e] border border-[#262626] p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[14px] font-medium text-white">Manage Namespace</h3>
              <button
                type="button"
                onClick={() => setIsManageNsOpen(false)}
                className="text-[#777777] hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex gap-2 -mx-5 px-5 border-b border-[#222222] pb-2.5 text-[13px]">
              <button
                type="button"
                onClick={() => setManageNsTab('settings')}
                className={`px-2.5 py-1 rounded-[5px] font-medium transition-colors cursor-pointer ${
                  manageNsTab === 'settings'
                    ? 'bg-[#1e1e1e] text-white'
                    : 'text-[#8c8c8c] hover:text-white'
                }`}
              >
                Settings
              </button>
              <button
                type="button"
                onClick={() => setManageNsTab('danger')}
                className={`px-2.5 py-1 rounded-[5px] font-medium transition-colors cursor-pointer ${
                  manageNsTab === 'danger'
                    ? 'bg-rose-950/40 text-rose-400'
                    : 'text-[#8c8c8c] hover:text-white'
                }`}
              >
                Danger
              </button>
            </div>

            {manageNsTab === 'settings' ? (
              <form onSubmit={handleUpdateNamespace} className="space-y-4">
                <div>
                  <label className="block text-[13px] text-[#999999] font-medium mb-1.5">
                    Identifier
                  </label>
                  <input
                    type="text"
                    required
                    value={editNsName}
                    onChange={(e) => setEditNsName(e.target.value)}
                    className="w-full h-9 px-3 rounded-[6px] bg-[#141414] border border-[#262626] focus:border-[#383838] text-white text-[13.5px] sm:text-[14px] outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[13px] text-[#999999] font-medium mb-1.5">
                    Quota Limit
                  </label>
                  <CustomSelect
                    value={editNsQuotaPreset}
                    options={QUOTA_OPTIONS}
                    onChange={(val) => setEditNsQuotaPreset(val)}
                    size="sm"
                  />
                </div>

                {editNsQuotaPreset === 'custom' && (
                  <div>
                    <label className="block text-[13px] text-[#999999] font-medium mb-1.5">
                      Limit in Bytes
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={editNsCustomBytes}
                      onChange={(e) => setEditNsCustomBytes(e.target.value)}
                      className="w-full h-9 px-3 rounded-[6px] bg-[#141414] border border-[#262626] focus:border-[#383838] text-white text-[13.5px] sm:text-[14px] outline-none"
                    />
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsManageNsOpen(false)}
                    className="h-9 px-3.5 rounded-[6px] text-[13.5px] sm:text-[14px] font-medium text-[#cccccc] hover:text-white bg-transparent hover:bg-[#161616] border border-[#262626] transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingNs || !editNsName.trim()}
                    className="h-9 px-4 rounded-[6px] text-[13.5px] sm:text-[14px] font-medium text-white bg-blue-600 hover:bg-blue-500 border border-blue-500/80 transition-colors cursor-pointer disabled:opacity-40"
                  >
                    {isSavingNs ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-4">
                <div className="p-3.5 rounded-[6px] bg-rose-950/20 border border-rose-900/40 text-[13px] text-rose-300 leading-relaxed">
                  Permanently delete namespace <strong className="text-white">{currentNsInfo.name}</strong> and all{' '}
                  <strong className="text-white">{currentNsInfo.total_objects} stored objects</strong> inside it. This action cannot be undone.
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setIsManageNsOpen(false)}
                    className="h-9 px-3.5 rounded-[6px] text-[13.5px] sm:text-[14px] font-medium text-[#cccccc] hover:text-white bg-transparent hover:bg-[#161616] border border-[#262626] transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => setNsToDelete(currentNsInfo)}
                    className="h-9 px-4 rounded-[6px] text-[13.5px] sm:text-[14px] font-medium text-rose-400 hover:text-rose-300 bg-rose-950/30 hover:bg-rose-950/50 border border-rose-900/50 transition-colors cursor-pointer"
                  >
                    Delete Namespace
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delete Namespace Confirm Dialog */}
      <ConfirmDialog
        isOpen={nsToDelete !== null}
        onClose={() => setNsToDelete(null)}
        onConfirm={handleDeleteNamespace}
        title="Delete Namespace"
        description={
          nsToDelete ? (
            <span>
              Are you sure you want to permanently delete namespace{' '}
              <strong className="text-white">{nsToDelete.name}</strong> and all{' '}
              <strong className="text-white">{nsToDelete.total_objects} objects</strong> inside it?
            </span>
          ) : (
            'Are you sure you want to delete this namespace?'
          )
        }
        confirmLabel={isDeletingNs ? 'Deleting...' : 'Delete Namespace'}
        variant="danger"
      />

      {/* Right-Click Context Menu for Items & Canvas Explorer */}
      <ContextMenu
        position={contextMenu?.position ?? null}
        item={contextMenu?.item ?? null}
        clipboard={clipboard}
        onClose={() => setContextMenu(null)}
        onOpenFolder={(item) => {
          navigateToPrefix(item.fullKey, true);
        }}
        onDownload={(item) => handleDownload(item.fullKey)}
        onMove={(item) => {
          setItemToMove(item);
          setIsMoveOpen(true);
        }}
        onRename={(item) => {
          setItemToRename(item);
          setRenameInput(item.name);
          setRenameError(null);
          setIsRenameOpen(true);
        }}
        onCopy={(item) => {
          setClipboard({
            mode: 'copy',
            namespace: activeNamespace,
            key: item.fullKey,
            name: item.name,
            isFolder: item.type === 'folder',
          });
        }}
        onDelete={(item) => setItemToDelete(item)}
        onViewDetails={(item) => {
          setSelectedItem(item);
          setIsDetailsOpen(true);
        }}
        onNewFolder={() => {
          setNewFolderName('');
          setIsNewFolderOpen(true);
        }}
        onUpload={() => fileInputRef.current?.click()}
        onPaste={handlePaste}
        onRefresh={loadData}
      />

      {/* Floating Asynchronous Upload Progress Drawer */}
      {isUploadDrawerVisible && uploadTasks.length > 0 && (
        <UploadProgressDrawer
          tasks={uploadTasks}
          onCancelAll={handleCancelAllUploads}
          onCancelTask={handleCancelUploadTask}
          onDismiss={() => setIsUploadDrawerVisible(false)}
        />
      )}
    </div>
  );
}
