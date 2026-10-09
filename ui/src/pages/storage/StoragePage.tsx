/*
 * Modern Drive/Dropbox-style cloud filesystem explorer for Axiom blob storage.
 * Owned by: ui/pages/storage
 * Key deps: ../../api/client, ../../types, ./types, ./paths, ./format, ./fileIcon, ./MoveDialog
 * Invariants: Content-addressed blobs; virtual directory paths end in '/'; single source of truth for namespace.
 * Last structural change: Complete redesign into Drive-style multi-pane file manager.
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  HardDrive,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Download,
  CheckCircle2,
  AlertTriangle,
  Folder,
  FolderPlus,
  SlidersHorizontal,
  X,
  Settings,
  Scissors,
  Edit3,
  Clipboard,
  ChevronRight,
  ChevronDown,
  ArrowRight,
  Info,
  LayoutGrid,
  List as ListIcon,
  Upload,
  Check,
  ShieldCheck,
  MoreVertical,
  Layers,
} from 'lucide-react';
import { api } from '../../api/client';
import { BlobEntry, BlobStats, NamespaceInfo } from '../../types';
import { StorageItem, StorageViewMode, ClipboardState, StorageTierFilter } from './types';
import { formatBytes, QUOTA_OPTIONS } from './format';
import { sanitizeFolder, parentOf, joinKey, isSelfOrDescendant, validateName } from './paths';
import { getFileIcon, getFileExtension } from './fileIcon';
import { MoveDialog } from './MoveDialog';
import { ContextMenu, ContextMenuPosition } from './ContextMenu';
import { FileTree } from './FileTree';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { CustomSelect } from '../../components/shared/CustomSelect';
import { UploadProgressDrawer, UploadTask } from './UploadProgressDrawer';

/**
 * Recovers persisted storage navigation parameters from URL or localStorage.
 */
function getInitialStorageState(): {
  ns: string;
  prefix: string;
  view: StorageViewMode;
  detailsOpen: boolean;
} {
  try {
    const params = new URLSearchParams(window.location.search);
    const urlNs = params.get('ns');
    const urlPrefix = params.get('prefix');
    const urlView = params.get('view') as StorageViewMode | null;

    const savedNs = localStorage.getItem('axiom_storage_namespace') || '';
    const savedPrefix = localStorage.getItem('axiom_storage_prefix') || '';
    const savedView = (localStorage.getItem('axiom_storage_view_mode') as StorageViewMode) || 'grid';
    const savedDetails = localStorage.getItem('axiom_storage_details_open');

    return {
      ns: urlNs !== null ? urlNs : savedNs,
      prefix: urlPrefix !== null ? urlPrefix : savedPrefix,
      view: urlView === 'grid' || urlView === 'list' ? urlView : savedView,
      detailsOpen: savedDetails !== null ? savedDetails === 'true' : true,
    };
  } catch {
    return { ns: '', prefix: '', view: 'grid', detailsOpen: true };
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
  const [isDetailsOpen, setIsDetailsOpen] = useState(initialStorage.detailsOpen);
  const [searchQuery, setSearchQuery] = useState('');
  const [tierFilter, setTierFilter] = useState<StorageTierFilter>('all');
  const [selectedItem, setSelectedItem] = useState<StorageItem | null>(null);
  const [isChecksumExpanded, setIsChecksumExpanded] = useState(false);

  // Context Menu (Right Click) State
  const [contextMenu, setContextMenu] = useState<{ position: ContextMenuPosition; item: StorageItem | null } | null>(null);

  // Drag and Drop & Google Drive-style Upload Progress State
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [uploadTasks, setUploadTasks] = useState<UploadTask[]>([]);
  const [isUploadDrawerVisible, setIsUploadDrawerVisible] = useState(false);

  // Internal Object Drag & Drop Moving State
  const [draggedItem, setDraggedItem] = useState<StorageItem | null>(null);
  const draggedItemRef = useRef<StorageItem | null>(null);
  const [dragOverTargetKey, setDragOverTargetKey] = useState<string | null>(null);

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
    (newPrefix: string, pushHistory = true) => {
      setCurrentPrefix(newPrefix);
      setSelectedItem(null);
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
      const params = new URLSearchParams(window.location.search);
      if (mode !== 'grid') {
        params.set('view', mode);
      } else {
        params.delete('view');
      }
      const queryStr = params.toString();
      const newUrl = queryStr ? `${window.location.pathname}?${queryStr}` : window.location.pathname;
      window.history.replaceState(null, '', newUrl);
    } catch {
      // Ignore storage errors
    }
  };

  // Details inspector drawer toggle with persistence
  const toggleDetailsOpen = () => {
    setIsDetailsOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('axiom_storage_details_open', String(next));
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  };

  // Namespace Top Dropdown State & Click-outside listener
  const [isNsDropdownOpen, setIsNsDropdownOpen] = useState(false);
  const nsDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (nsDropdownRef.current && !nsDropdownRef.current.contains(event.target as Node)) {
        setIsNsDropdownOpen(false);
      }
    }
    if (isNsDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isNsDropdownOpen]);

  // Load telemetry and namespace catalog
  const loadData = useCallback(async (targetNs?: string) => {
    const curGen = ++fetchGenRef.current;
    setLoadError(null);
    setIsRefreshing(true);
    try {
      const [statsRes, nsRes] = await Promise.allSettled([
        api.getBlobStats(),
        api.listBlobNamespaces(),
      ]);

      if (curGen !== fetchGenRef.current) return;

      if (statsRes.status === 'fulfilled') {
        setStats(statsRes.value);
      }

      let currentNs = targetNs || activeNsRef.current;
      if (nsRes.status === 'fulfilled' && Array.isArray(nsRes.value)) {
        const list = nsRes.value;
        setNamespaces(list);
        if (list.length > 0) {
          const savedNs = localStorage.getItem('axiom_storage_namespace') || '';
          if (currentNs && list.some((n) => n.name === currentNs)) {
            // Keep currentNs as is
          } else if (savedNs && list.some((n) => n.name === savedNs)) {
            currentNs = savedNs;
            setActiveNamespace(currentNs);
          } else {
            currentNs = list[0].name;
            setActiveNamespace(currentNs);
          }
          syncLocation(currentNs, currentPrefixRef.current, false);
        } else {
          currentNs = '';
          setActiveNamespace('');
          setCurrentPrefix('');
          setBlobs([]);
          syncLocation('', '', false);
        }
      } else {
        setNamespaces([]);
        currentNs = '';
        setActiveNamespace('');
        setCurrentPrefix('');
        setBlobs([]);
        syncLocation('', '', false);
      }

      if (currentNs) {
        try {
          const listRes = await api.listBlobs(currentNs);
          if (curGen === fetchGenRef.current) {
            setBlobs(listRes.items || []);
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
        const existing = folderMap.get(folderName) || { itemCount: 0, totalBytes: 0 };
        if (!rel.endsWith('/.axiom_dir')) {
          existing.itemCount += 1;
          existing.totalBytes += b.size;
        }
        folderMap.set(folderName, existing);
      } else {
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

    const folders: StorageItem[] = Array.from(folderMap.entries())
      .map(([name, s]) => ({
        id: `folder-${currentPrefix}${name}/`,
        type: 'folder' as const,
        name,
        fullKey: `${currentPrefix}${name}/`,
        itemCount: s.itemCount,
        totalBytes: s.totalBytes,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    files.sort((a, b) => a.name.localeCompare(b.name));

    return { folderItems: folders, fileItems: files };
  }, [blobs, currentPrefix, searchQuery, tierFilter]);

  // Available directories for Move picker
  const availableDirectories = useMemo(() => {
    const dirs = new Set<string>();
    dirs.add('');
    for (const b of blobs) {
      const parts = b.key.split('/').filter(Boolean);
      parts.pop(); // drop file
      let acc = '';
      for (const p of parts) {
        acc += `${p}/`;
        dirs.add(acc);
      }
    }
    return Array.from(dirs).sort();
  }, [blobs]);

  // Live object count excluding internal zero-byte directory markers
  const realObjectsCount = useMemo(() => {
    return blobs.filter((b) => !b.key.endsWith('/.axiom_dir') && b.key !== '.axiom_dir').length;
  }, [blobs]);

  // Cancel all pending or active upload tasks
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

  // Dismiss / close upload progress drawer
  const handleDismissUploadDrawer = useCallback(() => {
    setIsUploadDrawerVisible(false);
  }, []);

  // Direct upload handler using background queue with optional destination prefix override
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

    // Process uploads sequentially in the background
    for (let i = 0; i < newTasks.length; i++) {
      const task = newTasks[i];
      const file = fileList[i];

      // Check if task was cancelled before starting
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

        // Immediate background refresh so new blob appears in current view
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

    // 1. Cannot drop into self
    if (dragged.fullKey === targetFolderKey || (dragged.type === 'folder' && normSrc === normTarget)) {
      return false;
    }

    // 2. Cannot drop a folder into its own descendant
    if (dragged.type === 'folder' && normTarget.startsWith(normSrc)) {
      return false;
    }

    // 3. Cannot drop into the folder it already resides in
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
    const destKey = joinKey(targetFolderKey, item.name, isFolder);

    try {
      await api.moveBlob(activeNamespace, item.fullKey, destKey, activeNamespace, isFolder);
      if (selectedItem?.fullKey === item.fullKey) {
        setSelectedItem(null);
      }
      await loadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to move item');
    } finally {
      setDraggedItem(null);
      draggedItemRef.current = null;
      setDragOverTargetKey(null);
    }
  };

  // Item drag start/end listeners
  const handleItemDragStart = (e: React.DragEvent, item: StorageItem) => {
    setDraggedItem(item);
    draggedItemRef.current = item;
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('application/x-axiom-item', JSON.stringify(item));
      e.dataTransfer.setData('text/plain', item.fullKey);
    } catch {
      // Fallback for restricted browsers
    }
  };

  const handleItemDragEnd = () => {
    setDraggedItem(null);
    draggedItemRef.current = null;
    setDragOverTargetKey(null);
  };

  // Drag and drop event listeners for external file area with flicker prevention
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Do not show external file upload overlay if dragging an internal item
    if (draggedItemRef.current || e.dataTransfer.types.includes('application/x-axiom-item')) {
      return;
    }
    dragCounterRef.current += 1;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDraggingOver(true);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggedItemRef.current || e.dataTransfer.types.includes('application/x-axiom-item')) {
      e.dataTransfer.dropEffect = 'none';
      return;
    }
    e.dataTransfer.dropEffect = 'copy';
    if (!isDraggingOver) {
      setIsDraggingOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggedItemRef.current || e.dataTransfer.types.includes('application/x-axiom-item')) {
      return;
    }
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDraggingOver(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggedItemRef.current || e.dataTransfer.types.includes('application/x-axiom-item')) {
      return;
    }
    dragCounterRef.current = 0;
    setIsDraggingOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await handleUploadFiles(e.dataTransfer.files);
    }
  };

  // Open context menu (right-click) on item or canvas
  const handleContextMenu = (e: React.MouseEvent, item: StorageItem | null) => {
    e.preventDefault();
    e.stopPropagation();
    if (item) {
      setSelectedItem(item);
    }
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
    setIsDeleting(true);
    try {
      if (itemToDelete.type === 'folder') {
        await api.deleteBlobPrefix(activeNamespace, itemToDelete.fullKey);
      } else {
        await api.deleteBlob(activeNamespace, itemToDelete.fullKey);
      }
      if (selectedItem?.fullKey === itemToDelete.fullKey) {
        setSelectedItem(null);
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

  // Copy hash utility
  const handleCopyHash = (text: string, id: string) => {
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
      {/* ─── Pane 1: Drive Sidebar (Namespaces & Storage Quota) ─────────────── */}
      <aside className="w-full lg:w-64 shrink-0 flex flex-col bg-[#0a0a0a] border-b lg:border-b-0 lg:border-r border-[#222222] overflow-hidden">
        {/* Namespace Dropdown Selector Header */}
        <div className="h-[54px] shrink-0 px-3 border-b border-[#222222] flex items-center justify-between gap-2 relative">
          {/* Namespace Dropdown Menu */}
          <div className="relative flex-1 min-w-0" ref={nsDropdownRef}>
            <button
              type="button"
              onClick={() => setIsNsDropdownOpen(!isNsDropdownOpen)}
              className="w-full h-8 px-2.5 rounded-[6px] bg-[#141414] hover:bg-[#1a1a1a] border border-[#242424] hover:border-[#383838] flex items-center justify-between gap-2 text-left transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2 truncate min-w-0">
                <HardDrive className="w-3.5 h-3.5 text-white shrink-0" />
                <span className="text-[13px] font-medium text-white truncate">
                  {activeNamespace || 'Select Namespace'}
                </span>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-[#777777] shrink-0" />
            </button>

            {/* Dropdown Menu Popup */}
            {isNsDropdownOpen && (
              <div className="absolute left-0 top-full mt-1.5 w-60 bg-[#111111] border border-[#262626] rounded-[8px] shadow-2xl p-1 z-50 animate-in fade-in zoom-in-95 duration-100 font-sans">
                <div className="px-2.5 py-1.5 text-[11px] font-medium text-[#777777] uppercase tracking-wider">
                  Storage Namespaces
                </div>

                <div className="max-h-52 overflow-y-auto space-y-0.5 py-0.5">
                  {namespaces.length === 0 ? (
                    <div className="px-2.5 py-2 text-[12px] text-[#777777]">
                      No namespaces created yet.
                    </div>
                  ) : (
                    namespaces.map((ns) => {
                      const isActive = ns.name === activeNamespace;
                      return (
                        <button
                          key={ns.name}
                          type="button"
                          onClick={() => {
                            handleNamespaceChange(ns.name);
                            setIsNsDropdownOpen(false);
                          }}
                          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-[6px] text-[13px] transition-colors cursor-pointer text-left ${
                            isActive
                              ? 'bg-[#1c1c1c] text-white font-medium'
                              : 'text-[#d4d4d4] hover:text-white hover:bg-[#161616]'
                          }`}
                        >
                          <div className="flex items-center gap-2 truncate min-w-0">
                            <HardDrive className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-white' : 'text-[#777777]'}`} />
                            <span className="truncate">{ns.name}</span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0 text-[11px] text-[#777777]">
                            <span>{isActive && blobs.length > 0 ? realObjectsCount : ns.total_objects}</span>
                            {isActive && <Check className="w-3.5 h-3.5 text-white shrink-0" />}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>

                <div className="h-px bg-[#222222] my-1 -mx-1" />

                <button
                  type="button"
                  onClick={() => {
                    setIsNsDropdownOpen(false);
                    setNewNsName('');
                    setNewNsQuotaPreset('unlimited');
                    setNewNsCustomBytes('');
                    setIsNewNsOpen(true);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[6px] text-[13px] text-white hover:bg-[#1a1a1a] transition-colors cursor-pointer text-left font-medium"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>New Namespace</span>
                </button>
              </div>
            )}
          </div>

          {/* Quick Settings & Plus Icon */}
          <div className="flex items-center gap-1 shrink-0">
            {activeNamespace && (
              <button
                type="button"
                onClick={() => {
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
                title="Manage Namespace Settings"
                className="w-8 h-8 flex items-center justify-center rounded-[6px] text-[#8c8c8c] hover:text-white hover:bg-[#161616] transition-colors cursor-pointer"
              >
                <Settings className="w-4 h-4" />
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setNewNsName('');
                setNewNsQuotaPreset('unlimited');
                setNewNsCustomBytes('');
                setIsNewNsOpen(true);
              }}
              title="New Namespace"
              className="w-8 h-8 flex items-center justify-center rounded-[6px] text-[#8c8c8c] hover:text-white hover:bg-[#161616] transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          <input
            type="file"
            multiple
            ref={fileInputRef}
            onChange={(e) => {
              if (e.target.files) handleUploadFiles(e.target.files);
              e.target.value = '';
            }}
            className="hidden"
          />
        </div>

        {/* In-place Folder & File Tree System */}
        <div className="flex-1 overflow-hidden min-h-0 flex flex-col">
          <FileTree
            blobs={blobs}
            currentPrefix={currentPrefix}
            selectedItem={selectedItem}
            activeNamespace={activeNamespace}
            onSelectFolder={(path) => navigateToPrefix(path, true)}
            onSelectFile={(fileItem) => {
              setSelectedItem(fileItem);
              setIsDetailsOpen(true);
            }}
            onContextMenu={handleContextMenu}
            onNewFolder={() => {
              setNewFolderName('');
              setIsNewFolderOpen(true);
            }}
            onUpload={() => fileInputRef.current?.click()}
            onRefresh={loadData}
            draggedItem={draggedItem}
            onItemDragStart={handleItemDragStart}
            onItemDragEnd={handleItemDragEnd}
            onDropOnFolder={handleDropOnFolder}
            canDropOnFolder={canDropOnFolder}
          />
        </div>
      </aside>

      {/* ─── Pane 2: Drive File Explorer Area ─────────────────────────────── */}
      <section
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className="flex-1 flex flex-col bg-[#0c0c0c] min-w-0 overflow-hidden relative"
      >
        {/* Drag and Drop Active Overlay */}
        {isDraggingOver && (
          <div className="absolute inset-0 z-30 pointer-events-none select-none bg-black/85 backdrop-blur-xs border-2 border-dashed border-[#555555] rounded-[10px] flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-100">
            <Upload className="w-10 h-10 text-white mb-2 animate-bounce" />
            <h3 className="text-[16px] font-semibold text-white">Drop files to upload</h3>
            <p className="text-[13px] text-[#8c8c8c] mt-1">
              Uploading directly into {activeNamespace} / {currentPrefix || 'root'}
            </p>
          </div>
        )}

        {/* Top Drive Explorer Toolbar */}
        <div className="h-[54px] shrink-0 px-4 border-b border-[#222222] flex items-center justify-between gap-3 bg-[#0a0a0a]">
          {/* Breadcrumb Path Navigator */}
          <div className="flex items-center gap-1.5 text-[13px] overflow-x-auto scrollbar-none min-w-0 py-0.5">
            <button
              type="button"
              onClick={() => navigateToPrefix('', true)}
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
                  await handleDropOnFolder('', draggedItemRef.current);
                }
              }}
              className={`hover:text-white transition-all cursor-pointer font-medium shrink-0 ${
                dragOverTargetKey === ''
                  ? 'bg-blue-600/30 text-blue-300 ring-1 ring-blue-500/60 px-1.5 py-0.5 rounded'
                  : currentPrefix === ''
                  ? 'text-white'
                  : 'text-[#8c8c8c]'
              }`}
            >
              {activeNamespace || 'Select Namespace'}
            </button>

            {breadcrumbSegments.map((seg, idx) => {
              const isLast = idx === breadcrumbSegments.length - 1;
              const isDropTarget = dragOverTargetKey === seg.prefix;
              return (
                <React.Fragment key={seg.prefix}>
                  <ChevronRight className="w-3.5 h-3.5 text-[#555555] shrink-0" />
                  <button
                    type="button"
                    onClick={() => navigateToPrefix(seg.prefix, true)}
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
                        await handleDropOnFolder(seg.prefix, draggedItemRef.current);
                      }
                    }}
                    className={`hover:text-white transition-all cursor-pointer font-medium truncate max-w-[140px] shrink-0 ${
                      isDropTarget
                        ? 'bg-blue-600/30 text-blue-300 ring-1 ring-blue-500/60 px-1.5 py-0.5 rounded'
                        : isLast
                        ? 'text-white'
                        : 'text-[#8c8c8c]'
                    }`}
                  >
                    {seg.name}
                  </button>
                </React.Fragment>
              );
            })}
          </div>

          {/* Right Toolbar Controls: Upload, Search, View Mode, Filter, Details Toggle */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Direct Upload Button */}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              className="h-8 text-[12px] px-3 font-medium cursor-pointer shrink-0"
            >
              <Upload className="w-3.5 h-3.5 mr-1.5 text-[#8c8c8c]" />
              <span>Upload</span>
            </Button>

            {/* Live Search */}
            <div className="relative w-44 sm:w-56">
              <Search className="w-3.5 h-3.5 text-[#666666] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search files..."
                className="w-full h-8 pl-8 pr-3 rounded-[6px] bg-[#141414] border border-[#262626] focus:border-[#383838] text-[12px] text-white outline-none transition-colors"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[#777777] hover:text-white"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* View Mode Toggle: Grid vs List */}
            <div className="flex items-center p-0.5 rounded-[6px] bg-[#141414] border border-[#262626]">
              <button
                type="button"
                onClick={() => handleViewModeChange('grid')}
                title="Grid view"
                className={`p-1 rounded-[4px] transition-colors cursor-pointer ${
                  viewMode === 'grid' ? 'bg-[#222222] text-white' : 'text-[#777777] hover:text-white'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => handleViewModeChange('list')}
                title="List view"
                className={`p-1 rounded-[4px] transition-colors cursor-pointer ${
                  viewMode === 'list' ? 'bg-[#222222] text-white' : 'text-[#777777] hover:text-white'
                }`}
              >
                <ListIcon className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Storage Tier Filter */}
            <div className="hidden sm:block">
              <CustomSelect
                value={tierFilter}
                options={[
                  { value: 'all', label: 'All Tiers' },
                  { value: 'disk', label: 'Disk Shards' },
                  { value: 'inline', label: 'LSM Inline' },
                ]}
                onChange={(val) => setTierFilter(val as StorageTierFilter)}
                size="sm"
              />
            </div>

            {/* Inspector Toggle */}
            <button
              type="button"
              onClick={toggleDetailsOpen}
              title={isDetailsOpen ? 'Hide Details' : 'Show Details'}
              className={`p-1.5 rounded-[6px] border transition-colors cursor-pointer ${
                isDetailsOpen
                  ? 'bg-[#1a1a1a] text-white border-[#333333]'
                  : 'bg-[#141414] text-[#8c8c8c] hover:text-white border-[#262626]'
              }`}
            >
              <Info className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Edge-to-Edge List View Column Headers */}
        {viewMode === 'list' && (folderItems.length > 0 || fileItems.length > 0) && (
          <div className="h-[38px] shrink-0 px-4 border-b border-[#222222] bg-[#0c0c0c] flex items-center text-[12px] font-medium text-[#777777] select-none z-10 w-full font-sans">
            <div className="flex-1 min-w-0 pr-4 truncate">Name</div>
            <div className="w-28 shrink-0 text-left whitespace-nowrap">Storage Tier</div>
            <div className="w-24 shrink-0 text-right pr-4 whitespace-nowrap">Size</div>
            <div className="w-28 shrink-0 text-right pr-4 hidden sm:block whitespace-nowrap">Modified</div>
            <div className="w-20 shrink-0 text-right whitespace-nowrap">Actions</div>
          </div>
        )}

        {/* Edge-to-Edge Clipboard Banner if active */}
        {clipboard && (
          <div className="h-10 shrink-0 px-4 bg-[#141414] border-b border-[#222222] flex items-center justify-between text-[12px] w-full z-10 font-sans select-none">
            <div className="flex items-center gap-2">
              <Scissors className="w-3.5 h-3.5 text-[#eab308]" />
              <span className="text-[#8c8c8c]">Clipboard:</span>
              <span className="text-white font-medium">{clipboard.name}</span>
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-[#222222] text-[#cccccc] font-mono">
                {clipboard.mode}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handlePaste}
                disabled={isPasting}
                className="text-white hover:underline font-medium cursor-pointer"
              >
                {isPasting ? 'Pasting...' : 'Paste here'}
              </button>
              <button
                type="button"
                onClick={() => setClipboard(null)}
                className="text-[#777777] hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Drive Explorer Body Canvas */}
        <div
          className={`flex-1 overflow-y-auto ${viewMode === 'list' ? 'p-0' : 'p-4 space-y-6'}`}
          onContextMenu={(e) => handleContextMenu(e, null)}
        >

          {/* Empty State when no namespaces exist */}
          {!isLoading && namespaces.length === 0 && (
            <div className="flex flex-col items-center justify-center py-24 px-4 text-center">
              <HardDrive className="w-12 h-12 text-[#444444] mb-3" />
              <h4 className="text-[16px] font-medium text-white">No Namespaces Initialized</h4>
              <p className="text-[13px] text-[#8c8c8c] max-w-sm mt-1.5 mb-5">
                Namespaces are container boundaries with dedicated quotas. Create your first namespace to start storing objects.
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setNewNsName('');
                  setNewNsQuotaPreset('unlimited');
                  setNewNsCustomBytes('');
                  setIsNewNsOpen(true);
                }}
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                Create Namespace
              </Button>
            </div>
          )}

          {/* Empty State when namespaces exist but none selected */}
          {!isLoading && namespaces.length > 0 && !activeNamespace && (
            <div className="flex flex-col items-center justify-center py-24 px-4 text-center">
              <HardDrive className="w-12 h-12 text-[#444444] mb-3" />
              <h4 className="text-[16px] font-medium text-white">Select a Namespace</h4>
              <p className="text-[13px] text-[#8c8c8c] max-w-sm mt-1.5">
                Choose a storage namespace from the left sidebar to explore and manage files.
              </p>
            </div>
          )}

          {/* Empty State when active namespace/folder has no items */}
          {!isLoading && activeNamespace && folderItems.length === 0 && fileItems.length === 0 && (
            <div className="flex flex-col items-center justify-center py-24 px-4 text-center">
              <HardDrive className="w-12 h-12 text-[#444444] mb-3" />
              <h4 className="text-[16px] font-medium text-white">This folder is empty</h4>
              <p className="text-[13px] text-[#8c8c8c] max-w-sm mt-1.5 mb-5">
                Drag and drop files here, or use the Upload button in the sidebar to add files.
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="w-3.5 h-3.5 mr-1" />
                Upload File
              </Button>
            </div>
          )}

          {/* Section 1: Folders */}
          {folderItems.length > 0 && (
            <div className={viewMode === 'list' ? '' : 'space-y-2.5'}>
              {viewMode === 'grid' && (
                <div className="flex items-center justify-between px-1">
                  <h4 className="text-[12px] font-medium text-[#8c8c8c]">Folders</h4>
                  <span className="text-[11px] font-medium tabular-nums text-[#666666]">{folderItems.length}</span>
                </div>
              )}
              <div
                className={
                  viewMode === 'grid'
                    ? 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3'
                    : 'flex flex-col'
                }
              >
                {folderItems.map((f) => {
                  const isSelected = selectedItem?.id === f.id;
                  const isDropTarget = dragOverTargetKey === f.fullKey;
                  const isSelfDragged = draggedItem?.id === f.id;

                  if (viewMode === 'grid') {
                    return (
                      <div
                        key={f.id}
                        draggable={true}
                        onDragStart={(e) => handleItemDragStart(e, f)}
                        onDragEnd={handleItemDragEnd}
                        onDragOver={(e) => {
                          if (draggedItemRef.current) {
                            if (canDropOnFolder(draggedItemRef.current, f.fullKey)) {
                              e.preventDefault();
                              e.stopPropagation();
                              e.dataTransfer.dropEffect = 'move';
                              if (dragOverTargetKey !== f.fullKey) {
                                setDragOverTargetKey(f.fullKey);
                              }
                            }
                          } else if (e.dataTransfer.types.includes('Files')) {
                            e.preventDefault();
                            e.stopPropagation();
                            e.dataTransfer.dropEffect = 'copy';
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
                            await handleDropOnFolder(f.fullKey, draggedItemRef.current);
                          } else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                            await handleUploadFiles(e.dataTransfer.files, f.fullKey);
                          }
                        }}
                        onClick={() => setSelectedItem(f)}
                        onDoubleClick={() => navigateToPrefix(f.fullKey, true)}
                        onContextMenu={(e) => handleContextMenu(e, f)}
                        className={`group p-3 rounded-[8px] border transition-all cursor-default select-none flex items-center justify-between gap-3 shadow-xs ${
                          isSelfDragged ? 'opacity-40 border-dashed border-[#555555]' : ''
                        } ${
                          isDropTarget
                            ? 'bg-blue-600/20 border-blue-500 ring-2 ring-blue-500/60 shadow-lg scale-[1.02]'
                            : isSelected
                            ? 'bg-[#1a1a1a] border-[#383838] shadow-sm ring-1 ring-[#383838]'
                            : 'bg-[#111111] hover:bg-[#151515] border-[#202020] hover:border-[#303030]'
                        }`}
                      >
                        <div className="flex items-center gap-3 truncate min-w-0">
                          <div className="w-9 h-9 rounded-[7px] bg-[#1a1a1a] border border-[#262626] flex items-center justify-center shrink-0">
                            <Folder className={`w-4.5 h-4.5 ${isDropTarget ? 'text-blue-400 animate-pulse' : 'text-[#eab308]'}`} />
                          </div>
                          <div className="truncate min-w-0">
                            <div className="text-[13px] font-medium text-white truncate" title={f.name}>
                              {f.name}
                            </div>
                            <div className="text-[11px] text-[#777777] tabular-nums truncate mt-0.5">
                              {isDropTarget ? (
                                <span className="text-blue-400 font-medium">Drop to move</span>
                              ) : (
                                `${f.itemCount} ${f.itemCount === 1 ? 'item' : 'items'}${f.totalBytes ? ` · ${formatBytes(f.totalBytes)}` : ''}`
                              )}
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setItemToMove(f);
                            setIsMoveOpen(true);
                          }}
                          title="Move folder"
                          className="opacity-0 group-hover:opacity-100 text-[#777777] hover:text-white p-1.5 rounded-[5px] hover:bg-[#222222] transition-all shrink-0 cursor-pointer"
                        >
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  }

                  // List Row
                  return (
                    <div
                      key={f.id}
                      draggable={true}
                      onDragStart={(e) => handleItemDragStart(e, f)}
                      onDragEnd={handleItemDragEnd}
                      onDragOver={(e) => {
                        if (draggedItemRef.current) {
                          if (canDropOnFolder(draggedItemRef.current, f.fullKey)) {
                            e.preventDefault();
                            e.stopPropagation();
                            e.dataTransfer.dropEffect = 'move';
                            if (dragOverTargetKey !== f.fullKey) {
                              setDragOverTargetKey(f.fullKey);
                            }
                          }
                        } else if (e.dataTransfer.types.includes('Files')) {
                          e.preventDefault();
                          e.stopPropagation();
                          e.dataTransfer.dropEffect = 'copy';
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
                          await handleDropOnFolder(f.fullKey, draggedItemRef.current);
                        } else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                          await handleUploadFiles(e.dataTransfer.files, f.fullKey);
                        }
                      }}
                      onClick={() => setSelectedItem(f)}
                      onDoubleClick={() => navigateToPrefix(f.fullKey, true)}
                      onContextMenu={(e) => handleContextMenu(e, f)}
                      className={`group flex items-center px-4 py-2.5 border-b border-[#1c1c1c] text-[13px] transition-colors cursor-default select-none ${
                        isSelfDragged ? 'opacity-40 border-dashed border-[#555555]' : ''
                      } ${
                        isDropTarget
                          ? 'bg-blue-600/20 ring-1 ring-inset ring-blue-500/60'
                          : isSelected
                          ? 'bg-[#1a1a1a]'
                          : 'bg-transparent hover:bg-[#141414]'
                      }`}
                    >
                      <div className="flex-1 min-w-0 flex items-center gap-2.5 pr-4 truncate">
                        <Folder className={`w-4 h-4 shrink-0 ${isDropTarget ? 'text-blue-400' : 'text-[#eab308]'}`} />
                        <span className="font-medium text-white truncate">{f.name}</span>
                      </div>
                      <div className="w-28 shrink-0 text-left">
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded-[4px] bg-[#1a1a1a] text-[#8c8c8c] border border-[#262626]">
                          Folder
                        </span>
                      </div>
                      <div className="w-24 shrink-0 text-right pr-4 text-[#8c8c8c] tabular-nums text-[12px]">
                        {formatBytes(f.totalBytes || 0)}
                      </div>
                      <div className="w-28 shrink-0 text-right pr-4 text-[#666666] tabular-nums text-[12px] hidden sm:block whitespace-nowrap">
                        {f.itemCount} {f.itemCount === 1 ? 'item' : 'items'}
                      </div>
                      <div className="w-20 shrink-0 flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setItemToMove(f);
                            setIsMoveOpen(true);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 text-[#777777] hover:text-white rounded hover:bg-[#202020] transition-opacity cursor-pointer"
                          title="Move folder"
                        >
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Section 2: Files */}
          {fileItems.length > 0 && (
            <div className={viewMode === 'list' ? '' : 'space-y-2.5'}>
              {viewMode === 'grid' && (
                <div className="flex items-center justify-between px-1">
                  <h4 className="text-[12px] font-medium text-[#8c8c8c]">Files</h4>
                  <span className="text-[11px] font-medium tabular-nums text-[#666666]">{fileItems.length}</span>
                </div>
              )}
              <div
                className={
                  viewMode === 'grid'
                    ? 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-3'
                    : 'flex flex-col'
                }
              >
                {fileItems.map((file) => {
                  const isSelected = selectedItem?.id === file.id;
                  const isSelfDragged = draggedItem?.id === file.id;
                  const ext = getFileExtension(file.name);

                  if (viewMode === 'grid') {
                    return (
                      <div
                        key={file.id}
                        draggable={true}
                        onDragStart={(e) => handleItemDragStart(e, file)}
                        onDragEnd={handleItemDragEnd}
                        onClick={() => setSelectedItem(file)}
                        onContextMenu={(e) => handleContextMenu(e, file)}
                        className={`group p-3 rounded-[8px] border transition-all cursor-default select-none flex flex-col justify-between h-42 shadow-xs ${
                          isSelfDragged ? 'opacity-40 border-dashed border-[#555555]' : ''
                        } ${
                          isSelected
                            ? 'bg-[#1a1a1a] border-[#383838] shadow-sm ring-1 ring-[#383838]'
                            : 'bg-[#111111] hover:bg-[#151515] border-[#202020] hover:border-[#303030]'
                        }`}
                      >
                        {/* Top row: Extension tag badge and Storage Tier badge */}
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[10px] font-medium tracking-wider px-1.5 py-0.5 rounded-[4px] bg-[#1a1a1a] text-[#a3a3a3] border border-[#262626] uppercase">
                            {ext}
                          </span>
                          <span
                            className={`text-[10px] font-medium tracking-wide px-1.5 py-0.5 rounded-[4px] ${
                              file.inline
                                ? 'bg-[#10b981]/10 text-[#30a46c] border border-[#10b981]/20'
                                : 'bg-[#1a1a1a] text-[#8c8c8c] border border-[#262626]'
                            }`}
                          >
                            {file.inline ? 'LSM' : 'Shard'}
                          </span>
                        </div>

                        {/* Center Preview Frame */}
                        <div className="flex-1 flex items-center justify-center py-2">
                          <div className="w-12 h-12 rounded-[8px] bg-[#161616] border border-[#222222] flex items-center justify-center transition-transform group-hover:scale-105">
                            {getFileIcon(file.name, 'w-6 h-6')}
                          </div>
                        </div>

                        {/* Bottom Information */}
                        <div className="truncate -mx-3 -mb-3 px-3 py-2 border-t border-[#1e1e1e] bg-[#0c0c0c]/60 rounded-b-[7px] mt-auto">
                          <div className="text-[13px] font-medium text-white truncate" title={file.name}>
                            {file.name}
                          </div>
                          <div className="flex items-center justify-between text-[11px] text-[#777777] tabular-nums mt-0.5">
                            <span>{formatBytes(file.size || 0)}</span>
                            {file.created_at && (
                              <span>{new Date(file.created_at * 1000).toLocaleDateString()}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  }

                  // List View Row
                  return (
                    <div
                      key={file.id}
                      draggable={true}
                      onDragStart={(e) => handleItemDragStart(e, file)}
                      onDragEnd={handleItemDragEnd}
                      onClick={() => setSelectedItem(file)}
                      onContextMenu={(e) => handleContextMenu(e, file)}
                      className={`group flex items-center px-4 py-2.5 border-b border-[#1c1c1c] text-[13px] transition-colors cursor-default select-none ${
                        isSelfDragged ? 'opacity-40 border-dashed border-[#555555]' : ''
                      } ${
                        isSelected
                          ? 'bg-[#1a1a1a]'
                          : 'bg-transparent hover:bg-[#141414]'
                      }`}
                    >
                      <div className="flex-1 min-w-0 flex items-center gap-2.5 pr-4 truncate">
                        {getFileIcon(file.name, 'w-4 h-4 shrink-0')}
                        <span className="font-medium text-white truncate">{file.name}</span>
                      </div>
                      <div className="w-28 shrink-0 text-left">
                        <span
                          className={`text-[11px] font-medium px-2 py-0.5 rounded-[4px] ${
                            file.inline
                              ? 'bg-[#10b981]/10 text-[#30a46c] border border-[#10b981]/20'
                              : 'bg-[#1a1a1a] text-[#8c8c8c] border border-[#262626]'
                          }`}
                        >
                          {file.inline ? 'LSM Inline' : 'Disk Shard'}
                        </span>
                      </div>
                      <div className="w-24 shrink-0 text-right pr-4 text-[#8c8c8c] tabular-nums text-[12px]">
                        {formatBytes(file.size || 0)}
                      </div>
                      <div className="w-28 shrink-0 text-right pr-4 text-[#666666] tabular-nums text-[12px] hidden sm:block whitespace-nowrap">
                        {file.created_at ? new Date(file.created_at * 1000).toLocaleDateString() : '—'}
                      </div>
                      <div className="w-20 shrink-0 flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownload(file.fullKey);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 text-[#777777] hover:text-white rounded hover:bg-[#202020] transition-opacity cursor-pointer"
                          title="Download"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setItemToMove(file);
                            setIsMoveOpen(true);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 text-[#777777] hover:text-white rounded hover:bg-[#202020] transition-opacity cursor-pointer"
                          title="Move"
                        >
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ─── Pane 3: Drive Inspector / Details Panel ────────────────────────── */}
      {isDetailsOpen && (
        <aside className="w-full lg:w-80 shrink-0 flex flex-col bg-[#0a0a0a] border-t lg:border-t-0 lg:border-l border-[#222222] overflow-hidden">
          <div className="h-[54px] shrink-0 px-4 border-b border-[#222222] flex items-center justify-between">
            <h3 className="text-[13px] font-medium text-white flex items-center gap-2">
              <Info className="w-4 h-4 text-[#8c8c8c]" />
              <span>{selectedItem ? 'Details' : 'Namespace Overview'}</span>
            </h3>
            <button
              type="button"
              onClick={() => setIsDetailsOpen(false)}
              className="text-[#777777] hover:text-white p-1 rounded hover:bg-[#1a1a1a] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-5">
            {selectedItem ? (
              <>
                {/* Hero Preview Card */}
                <div className="p-4 rounded-[8px] bg-[#111111] border border-[#202020] flex flex-col items-center text-center">
                  <div className="w-16 h-16 rounded-[10px] bg-[#161616] border border-[#262626] flex items-center justify-center mb-3 shadow-inner">
                    {selectedItem.type === 'folder' ? (
                      <Folder className="w-8 h-8 text-[#eab308]" />
                    ) : (
                      getFileIcon(selectedItem.name, 'w-8 h-8')
                    )}
                  </div>
                  <h4 className="text-[14px] font-semibold text-white break-all max-w-full" title={selectedItem.name}>
                    {selectedItem.name}
                  </h4>
                  <p className="text-[12px] text-[#777777] mt-1">
                    {selectedItem.type === 'folder'
                      ? 'Virtual Directory'
                      : selectedItem.content_type || 'application/octet-stream'}
                  </p>

                  {/* Action Buttons Row */}
                  <div className="flex items-center justify-center gap-2 mt-4 -mx-4 -mb-4 px-4 py-3 border-t border-[#1e1e1e] bg-[#0c0c0c]/60 rounded-b-[7px] w-[calc(100%+2rem)]">
                    {selectedItem.type === 'file' && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleDownload(selectedItem.fullKey)}
                        className="h-7 text-[12px] px-2.5 flex items-center gap-1.5 cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5 text-[#8c8c8c]" />
                        <span>Download</span>
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setItemToMove(selectedItem);
                        setIsMoveOpen(true);
                      }}
                      className="h-7 text-[12px] px-2.5 flex items-center gap-1.5 cursor-pointer"
                    >
                      <ArrowRight className="w-3.5 h-3.5 text-[#8c8c8c]" />
                      <span>Move</span>
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setItemToDelete(selectedItem)}
                      className="h-7 text-[12px] px-2.5 flex items-center gap-1.5 hover:text-[#ef4444] hover:border-[#ef4444]/40 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-[#8c8c8c]" />
                      <span>Delete</span>
                    </Button>
                  </div>
                </div>

                {/* Metadata Properties */}
                <div className="space-y-2 text-[12px]">
                  <span className="text-[#8c8c8c] font-medium block">Properties</span>
                  <div className="rounded-[8px] bg-[#111111] border border-[#202020] divide-y divide-[#1a1a1a]">
                    <div className="flex items-center justify-between p-2.5">
                      <span className="text-[#777777]">Namespace</span>
                      <span className="text-white font-medium">{activeNamespace}</span>
                    </div>
                    <div className="flex items-center justify-between p-2.5">
                      <span className="text-[#777777]">Canonical Key</span>
                      <span className="text-white text-[12px] truncate max-w-[180px]" title={selectedItem.fullKey}>
                        {selectedItem.fullKey}
                      </span>
                    </div>
                    <div className="flex items-center justify-between p-2.5">
                      <span className="text-[#777777]">
                        {selectedItem.type === 'folder' ? 'Contents' : 'Payload Size'}
                      </span>
                      <span className="text-white tabular-nums font-medium">
                        {selectedItem.type === 'folder'
                          ? `${selectedItem.itemCount || 0} objects (${formatBytes(selectedItem.totalBytes || 0)})`
                          : formatBytes(selectedItem.size || 0)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between p-2.5">
                      <span className="text-[#777777]">Storage Tier</span>
                      <span className="text-white font-medium">
                        {selectedItem.type === 'folder'
                          ? 'Virtual Hierarchy'
                          : selectedItem.inline
                          ? 'Fjall LSM Inline (<64KB)'
                          : 'Disk Shard'}
                      </span>
                    </div>
                    {selectedItem.type === 'file' && selectedItem.created_at && (
                      <div className="flex items-center justify-between p-2.5">
                        <span className="text-[#777777]">Uploaded</span>
                        <span className="text-white tabular-nums text-[12px]">
                          {new Date(selectedItem.created_at * 1000).toLocaleString()}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Collapsible Cryptographic Integrity & Checksum Accordion (Files Only) */}
                {selectedItem.type === 'file' && selectedItem.hash && (
                  <div className="rounded-[8px] border border-[#202020] bg-[#111111] overflow-hidden text-[12px]">
                    <button
                      type="button"
                      onClick={() => setIsChecksumExpanded(!isChecksumExpanded)}
                      className="w-full flex items-center justify-between p-2.5 text-left text-[#8c8c8c] hover:text-white hover:bg-[#151515] transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <ShieldCheck className="w-3.5 h-3.5 text-[#777777]" />
                        <span className="font-medium">Checksum & Integrity</span>
                      </div>
                      {isChecksumExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5 text-[#777777]" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-[#777777]" />
                      )}
                    </button>

                    {isChecksumExpanded && (
                      <div className="p-3 border-t border-[#1a1a1a] bg-[#0c0c0c] space-y-2.5 animate-in fade-in duration-100">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-[#777777] font-medium uppercase tracking-wider">
                            BLAKE3 Digest
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopyHash(selectedItem.hash!, 'inspector-hash')}
                            className="text-[11px] text-[#8c8c8c] hover:text-white cursor-pointer"
                          >
                            {copiedKey === 'inspector-hash' ? 'Copied!' : 'Copy Hash'}
                          </button>
                        </div>

                        <div className="p-2 rounded-[4px] bg-[#080808] border border-[#1f1f1f] font-sans text-[11px] text-[#a3a3a3] break-all select-all tabular-nums">
                          {selectedItem.hash}
                        </div>

                        <button
                          type="button"
                          onClick={() => handleVerifyBlob(selectedItem.fullKey)}
                          disabled={verifyMap[`${activeNamespace}/${selectedItem.fullKey}`] === 'verifying'}
                          className={`w-full py-1.5 px-2.5 rounded-[5px] border text-[11.5px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                            verifyMap[`${activeNamespace}/${selectedItem.fullKey}`] === 'valid'
                              ? 'border-[#10b981]/40 bg-[#10b981]/10 text-[#30a46c]'
                              : verifyMap[`${activeNamespace}/${selectedItem.fullKey}`] === 'invalid'
                              ? 'border-[#ef4444]/40 bg-[#ef4444]/10 text-[#f87171]'
                              : 'border-[#262626] bg-[#141414] text-[#cccccc] hover:text-white hover:border-[#383838]'
                          }`}
                        >
                          {verifyMap[`${activeNamespace}/${selectedItem.fullKey}`] === 'verifying' ? (
                            <>
                              <RefreshCw className="w-3 h-3 animate-spin text-[#8c8c8c]" />
                              <span>Verifying checksum...</span>
                            </>
                          ) : verifyMap[`${activeNamespace}/${selectedItem.fullKey}`] === 'valid' ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5 text-[#10b981]" />
                              <span>Digest Verified Valid</span>
                            </>
                          ) : (
                            <>
                              <ShieldCheck className="w-3.5 h-3.5 text-[#8c8c8c]" />
                              <span>Verify BLAKE3 Integrity</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              /* Namespace General Overview when no single item is selected */
              <div className="space-y-4 text-[12px]">
                <div className="p-3.5 rounded-[8px] bg-[#111111] border border-[#202020] space-y-1">
                  <div className="text-[14px] font-medium text-white flex items-center gap-2">
                    <HardDrive className="w-4 h-4 text-[#8c8c8c]" />
                    <span>{activeNamespace || 'No namespace'}</span>
                  </div>
                  <div className="text-[#777777] text-[12px]">
                    Logical partition containing {blobs.length > 0 ? realObjectsCount : currentNsInfo?.total_objects || 0} {realObjectsCount === 1 ? 'object' : 'objects'}
                  </div>
                </div>

                {/* Storage Capacity Gauge (matches Skycrate reference image) */}
                <div className="p-3.5 rounded-[8px] bg-[#111111] border border-[#202020] space-y-2.5">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-[#8c8c8c] font-medium">Storage Quota</span>
                    <span className="text-white tabular-nums font-medium">
                      {quotaUsedPercent !== null ? `${quotaUsedPercent}% used` : 'Unlimited'}
                    </span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-[#1e1e1e] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${quotaUsedPercent !== null ? Math.min(100, Math.max(3, quotaUsedPercent)) : 100}%`,
                        backgroundColor:
                          quotaUsedPercent === null
                            ? '#2f80ed'
                            : quotaUsedPercent > 90
                            ? '#ef4444'
                            : quotaUsedPercent > 75
                            ? '#f59e0b'
                            : '#30a46c',
                      }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-[#777777] tabular-nums">
                    <span>{formatBytes(currentNsInfo?.total_bytes || 0)} used</span>
                    <span>{currentNsInfo?.max_bytes ? formatBytes(currentNsInfo.max_bytes) : 'Unlimited'}</span>
                  </div>
                </div>

                {/* Namespace Telemetry */}
                <div className="space-y-2">
                  <span className="text-[#8c8c8c] font-medium block">Namespace Telemetry</span>
                  <div className="rounded-[8px] bg-[#111111] border border-[#202020] divide-y divide-[#1a1a1a]">
                    <div className="flex items-center justify-between p-2.5">
                      <span className="text-[#777777]">Total Objects</span>
                      <span className="text-white tabular-nums font-medium">
                        {blobs.length > 0 ? realObjectsCount : currentNsInfo?.total_objects || 0}
                      </span>
                    </div>
                    <div className="flex items-center justify-between p-2.5">
                      <span className="text-[#777777]">Physical Stored Size</span>
                      <span className="text-white tabular-nums font-medium">
                        {formatBytes(currentNsInfo?.total_bytes || 0)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between p-2.5">
                      <span className="text-[#777777]">Quota Limit</span>
                      <span className="text-white tabular-nums font-medium">
                        {currentNsInfo?.max_bytes
                          ? `${formatBytes(currentNsInfo.max_bytes)} (${quotaUsedPercent}% used)`
                          : 'Unlimited'}
                      </span>
                    </div>
                    {stats && stats.dedup_saved_bytes > 0 && (
                      <div className="flex items-center justify-between p-2.5 text-[#30a46c]">
                        <span className="text-[#30a46c]">Deduplication Saved</span>
                        <span className="tabular-nums font-medium">
                          {formatBytes(stats.dedup_saved_bytes)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <p className="text-[11px] text-[#666666] leading-relaxed">
                  Select any file or directory in the explorer to view individual properties, cryptographic hashes, and management actions.
                </p>
              </div>
            )}
          </div>
        </aside>
      )}

      {/* ─── Modals: Move to, New Folder, Rename, Delete, Namespace ────────── */}
      <MoveDialog
        isOpen={isMoveOpen}
        item={itemToMove}
        currentNamespace={activeNamespace}
        namespaces={namespaces}
        availableFolders={availableDirectories}
        onClose={() => {
          setIsMoveOpen(false);
          setItemToMove(null);
        }}
        onMove={handleMove}
      />

      {/* New Folder Modal */}
      {isNewFolderOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs font-sans">
          <div className="w-full max-w-sm rounded-[10px] bg-[#0e0e0e] border border-[#262626] p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FolderPlus className="w-4 h-4 text-[#eab308]" />
                <h3 className="text-[14px] font-medium text-white">New Folder</h3>
              </div>
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
                <label className="block text-[12px] text-[#8c8c8c] font-medium mb-1.5">
                  Folder Name
                </label>
                <input
                  type="text"
                  autoFocus
                  required
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="e.g. documents, archive"
                  className="w-full h-8 px-3 rounded-[6px] bg-[#141414] border border-[#262626] focus:border-[#383838] text-white text-[13px] outline-none"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setIsNewFolderOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={isCreatingFolder || !newFolderName.trim()}
                >
                  {isCreatingFolder ? 'Creating...' : 'Create'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rename Modal */}
      {isRenameOpen && itemToRename && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs font-sans">
          <div className="w-full max-w-sm rounded-[10px] bg-[#0e0e0e] border border-[#262626] p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-[#8c8c8c]" />
                <h3 className="text-[14px] font-medium text-white">Rename</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsRenameOpen(false)}
                className="text-[#777777] hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {renameError && (
              <div className="p-2 rounded bg-[#ef4444]/10 border border-[#ef4444]/30 text-[12px] text-[#ef4444]">
                {renameError}
              </div>
            )}

            <form onSubmit={handleRename} className="space-y-4">
              <div>
                <label className="block text-[12px] text-[#8c8c8c] font-medium mb-1.5">
                  Name
                </label>
                <input
                  type="text"
                  autoFocus
                  required
                  value={renameInput}
                  onChange={(e) => {
                    setRenameInput(e.target.value);
                    setRenameError(null);
                  }}
                  className="w-full h-8 px-3 rounded-[6px] bg-[#141414] border border-[#262626] focus:border-[#383838] text-white text-[13px] outline-none"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setIsRenameOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={isRenaming || !renameInput.trim()}
                >
                  {isRenaming ? 'Renaming...' : 'Save'}
                </Button>
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
        title={itemToDelete?.type === 'folder' ? 'Delete Folder' : 'Delete Object'}
        description={
          itemToDelete?.type === 'folder' ? (
            <span>
              Are you sure you want to permanently delete directory{' '}
              <strong className="text-white">{itemToDelete.fullKey}</strong> and all contained objects in namespace{' '}
              <strong className="text-white">{activeNamespace}</strong>? This action cannot be reversed.
            </span>
          ) : (
            <span>
              Are you sure you want to permanently delete{' '}
              <strong className="text-white">{itemToDelete?.name}</strong> from namespace{' '}
              <strong className="text-white">{activeNamespace}</strong>? Unreferenced disk shards will be removed.
            </span>
          )
        }
        confirmLabel={isDeleting ? 'Deleting...' : 'Delete'}
        variant="danger"
      />

      {/* Create Namespace Modal */}
      {isNewNsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs font-sans">
          <div className="w-full max-w-sm rounded-[10px] bg-[#0e0e0e] border border-[#262626] p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[14px] font-medium text-white">Create Namespace</h3>
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
                <label className="block text-[12px] text-[#8c8c8c] font-medium mb-1.5">
                  Namespace Name
                </label>
                <input
                  type="text"
                  autoFocus
                  required
                  value={newNsName}
                  onChange={(e) => setNewNsName(e.target.value)}
                  placeholder="e.g. media, backups"
                  className="w-full h-8 px-3 rounded-[6px] bg-[#141414] border border-[#262626] focus:border-[#383838] text-white text-[13px] outline-none"
                />
              </div>

              <div>
                <label className="block text-[12px] text-[#8c8c8c] font-medium mb-1.5">
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
                  <label className="block text-[12px] text-[#8c8c8c] font-medium mb-1.5">
                    Limit in Bytes
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={newNsCustomBytes}
                    onChange={(e) => setNewNsCustomBytes(e.target.value)}
                    placeholder="e.g. 104857600"
                    className="w-full h-8 px-3 rounded-[6px] bg-[#141414] border border-[#262626] focus:border-[#383838] text-white text-[13px] outline-none"
                  />
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setIsNewNsOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={isCreatingNs || !newNsName.trim()}
                >
                  {isCreatingNs ? 'Creating...' : 'Create'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manage Namespace Modal */}
      {isManageNsOpen && currentNsInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs font-sans">
          <div className="w-full max-w-md rounded-[10px] bg-[#0e0e0e] border border-[#262626] p-5 shadow-2xl space-y-4">
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
                className={`px-2.5 py-1 rounded-[5px] font-medium transition-colors ${
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
                className={`px-2.5 py-1 rounded-[5px] font-medium transition-colors ${
                  manageNsTab === 'danger'
                    ? 'bg-[#ef4444]/15 text-[#f87171]'
                    : 'text-[#8c8c8c] hover:text-white'
                }`}
              >
                Danger
              </button>
            </div>

            {manageNsTab === 'settings' ? (
              <form onSubmit={handleUpdateNamespace} className="space-y-4">
                <div>
                  <label className="block text-[12px] text-[#8c8c8c] font-medium mb-1.5">
                    Identifier
                  </label>
                  <input
                    type="text"
                    required
                    value={editNsName}
                    onChange={(e) => setEditNsName(e.target.value)}
                    className="w-full h-8 px-3 rounded-[6px] bg-[#141414] border border-[#262626] focus:border-[#383838] text-white text-[13px] outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[12px] text-[#8c8c8c] font-medium mb-1.5">
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
                    <label className="block text-[12px] text-[#8c8c8c] font-medium mb-1.5">
                      Limit in Bytes
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={editNsCustomBytes}
                      onChange={(e) => setEditNsCustomBytes(e.target.value)}
                      className="w-full h-8 px-3 rounded-[6px] bg-[#141414] border border-[#262626] focus:border-[#383838] text-white text-[13px] outline-none"
                    />
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setIsManageNsOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    disabled={isSavingNs || !editNsName.trim()}
                  >
                    {isSavingNs ? 'Saving...' : 'Save Changes'}
                  </Button>
                </div>
              </form>
            ) : (
              <div className="space-y-4">
                <div className="p-3 rounded-[6px] bg-[#2a1010] border border-[#ef4444]/30 text-[12px] text-[#f87171] leading-relaxed">
                  Permanently delete namespace <strong className="text-white">{currentNsInfo.name}</strong> and all{' '}
                  <strong className="text-white">{currentNsInfo.total_objects} stored objects</strong> inside it. This action cannot be undone.
                </div>
                <div className="flex items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setIsManageNsOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    onClick={() => setNsToDelete(currentNsInfo)}
                  >
                    Delete Namespace
                  </Button>
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

      {/* Google Drive-style Floating Asynchronous Upload Progress Drawer */}
      {isUploadDrawerVisible && uploadTasks.length > 0 && (
        <UploadProgressDrawer
          tasks={uploadTasks}
          onCancelAll={handleCancelAllUploads}
          onCancelTask={handleCancelUploadTask}
          onDismiss={handleDismissUploadDrawer}
        />
      )}
    </div>
  );
}
