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
  Settings,
  AlertTriangle,
  Download,
  Trash2,
  ArrowRight,
  FolderUp,
  Files,
  CheckSquare,
  Copy,
} from 'lucide-react';
import { api } from '../../api/client';
import { BlobEntry, BlobStats, NamespaceInfo } from '../../types';
import { StorageItem, StorageViewMode, ClipboardState, StorageTierFilter, UploadFileEntry } from './types';
import { formatBytes, QUOTA_OPTIONS } from './format';
import { sanitizeFolder, parentOf, joinKey, validateName } from './paths';
import { MoveDialog } from './MoveDialog';
import { ContextMenu, ContextMenuPosition } from './ContextMenu';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Button } from '../../components/ui/Button';
import { Switch } from '../../components/ui/Switch';
import { CustomSelect } from '../../components/shared/CustomSelect';
import { UploadProgressDrawer, UploadTask } from './UploadProgressDrawer';
import { StorageSidebar } from './StorageSidebar';
import { StorageToolbar } from './StorageToolbar';
import { StorageGridView } from './StorageGridView';
import { StorageListView } from './StorageListView';
import { StorageDetailsPanel } from './StorageDetailsPanel';
import { StorageEmptyState } from './StorageEmptyState';
import { ShareTicketModal } from './ShareTicketModal';
import { CreateUploadLinkModal } from './CreateUploadLinkModal';
import { FileConflictModal, ConflictingFile, ConflictResolution } from './FileConflictModal';

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

/**
 * Recursively extracts files and directory hierarchies from drag-and-drop DataTransfer items.
 * Preserves subfolder paths relative to dropped root, critical for hosting static sites/assets.
 */
async function scanFilesFromDataTransfer(items: DataTransferItemList): Promise<UploadFileEntry[]> {
  const entries: UploadFileEntry[] = [];

  async function traverseEntry(entry: any, path = ''): Promise<void> {
    if (!entry) return;
    if (entry.isFile) {
      await new Promise<void>((resolve) => {
        entry.file(
          (file: File) => {
            entries.push({
              file,
              relativePath: path ? `${path}/${file.name}` : file.name,
            });
            resolve();
          },
          () => resolve()
        );
      });
    } else if (entry.isDirectory) {
      const dirReader = entry.createReader();
      const readAllEntries = async (): Promise<any[]> => {
        let all: any[] = [];
        while (true) {
          const batch: any[] = await new Promise((resolve) => {
            dirReader.readEntries(
              (results: any[]) => resolve(results || []),
              () => resolve([])
            );
          });
          if (!batch || batch.length === 0) break;
          all = all.concat(batch);
        }
        return all;
      };

      const childEntries = await readAllEntries();
      const newPath = path ? `${path}/${entry.name}` : entry.name;
      for (const child of childEntries) {
        await traverseEntry(child, newPath);
      }
    }
  }

  const promises: Promise<void>[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
    if (entry) {
      promises.push(traverseEntry(entry, ''));
    } else {
      const file = item.getAsFile();
      if (file) {
        entries.push({ file, relativePath: file.name });
      }
    }
  }
  await Promise.all(promises);
  return entries;
}

export function StoragePage() {
  const initialStorage = useMemo(() => getInitialStorageState(), []);

  // Telemetry & Core Subsystem Data
  const [stats, setStats] = useState<BlobStats | null>(null);
  const [namespaces, setNamespaces] = useState<NamespaceInfo[]>([]);
  const [activeNamespace, setActiveNamespace] = useState<string>(initialStorage.ns);
  const [blobs, setBlobs] = useState<BlobEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
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
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const lastFocusedKeyRef = useRef<string | null>(null);

  // Resizable Sidebar & Inspector dimensions (saved to localStorage)
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('axiom_storage_sidebar_width');
      return saved ? Math.max(180, Math.min(600, parseInt(saved, 10))) : 260;
    } catch {
      return 260;
    }
  });

  const [detailsWidth, setDetailsWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('axiom_storage_details_width');
      return saved ? Math.max(240, Math.min(700, parseInt(saved, 10))) : 320;
    } catch {
      return 320;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('axiom_storage_sidebar_width', sidebarWidth.toString());
    } catch {}
  }, [sidebarWidth]);

  useEffect(() => {
    try {
      localStorage.setItem('axiom_storage_details_width', detailsWidth.toString());
    } catch {}
  }, [detailsWidth]);

  // Left Sidebar Drag-to-Resize Handler
  const handleSidebarResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = sidebarWidth;

      const handleMouseMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX;
        const newWidth = Math.max(180, Math.min(600, startW + delta));
        setSidebarWidth(newWidth);
      };

      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [sidebarWidth]
  );

  // Right Inspector Drag-to-Resize Handler
  const handleDetailsResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = detailsWidth;

      const handleMouseMove = (ev: MouseEvent) => {
        const delta = startX - ev.clientX; // dragging leftwards widens the right panel
        const newWidth = Math.max(240, Math.min(700, startW + delta));
        setDetailsWidth(newWidth);
      };

      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [detailsWidth]
  );

  // Batch Operations State
  const [isBatchDeleteOpen, setIsBatchDeleteOpen] = useState(false);
  const [isBatchDeleting, setIsBatchDeleting] = useState(false);
  const [isBatchMoveOpen, setIsBatchMoveOpen] = useState(false);

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

  const [isCopyOpen, setIsCopyOpen] = useState(false);
  const [isBatchCopyOpen, setIsBatchCopyOpen] = useState(false);
  const [itemToCopy, setItemToCopy] = useState<StorageItem | null>(null);

  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [itemToRename, setItemToRename] = useState<StorageItem | null>(null);
  const [renameInput, setRenameInput] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const [itemToDelete, setItemToDelete] = useState<StorageItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [isShareOpen, setIsShareOpen] = useState(false);
  const [itemToShare, setItemToShare] = useState<StorageItem | null>(null);

  // Dedicated Pre-signed Upload Link Modal
  const [isUploadLinkOpen, setIsUploadLinkOpen] = useState(false);

  // File Upload Collision & Conflict Protection
  const [conflicts, setConflicts] = useState<ConflictingFile[]>([]);
  const [pendingUploadEntries, setPendingUploadEntries] = useState<UploadFileEntry[]>([]);
  const [pendingTargetPrefix, setPendingTargetPrefix] = useState<string>('');
  const [isConflictModalOpen, setIsConflictModalOpen] = useState(false);

  // Namespace Management Modals
  const [isNewNsOpen, setIsNewNsOpen] = useState(false);
  const [newNsName, setNewNsName] = useState('');
  const [newNsQuotaPreset, setNewNsQuotaPreset] = useState('unlimited');
  const [newNsCustomBytes, setNewNsCustomBytes] = useState('');
  const [newNsIsPublic, setNewNsIsPublic] = useState(false);
  const [newNsCors, setNewNsCors] = useState('');
  const [isCreatingNs, setIsCreatingNs] = useState(false);

  const [isManageNsOpen, setIsManageNsOpen] = useState(false);
  const [manageNsTab, setManageNsTab] = useState<'settings' | 'danger'>('settings');
  const [editNsName, setEditNsName] = useState('');
  const [editNsQuotaPreset, setEditNsQuotaPreset] = useState('unlimited');
  const [editNsCustomBytes, setEditNsCustomBytes] = useState('');
  const [editNsIsPublic, setEditNsIsPublic] = useState(false);
  const [editNsCors, setEditNsCors] = useState('');
  const [isSavingNs, setIsSavingNs] = useState(false);
  const [nsToDelete, setNsToDelete] = useState<NamespaceInfo | null>(null);
  const [isDeletingNs, setIsDeletingNs] = useState(false);

  // Verification & Copy Feedback Map
  const [verifyMap, setVerifyMap] = useState<Record<string, 'verifying' | 'valid' | 'invalid'>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Race condition guard for concurrent data loads
  const fetchGenRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
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
        setSelectedKeys(new Set(keepItem ? [keepItem.fullKey] : []));
        lastFocusedKeyRef.current = keepItem ? keepItem.fullKey : null;
      } else {
        setSelectedItem(null);
        setSelectedKeys(new Set());
        lastFocusedKeyRef.current = null;
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
            .listBlobs(urlNs, undefined, undefined, 100)
            .then((res) => {
              setBlobs(res.items || []);
              setNextCursor(res.next_cursor || null);
            })
            .catch(() => {
              setBlobs([]);
              setNextCursor(null);
            });
        }
        setCurrentPrefix(urlPrefix);
        setSelectedItem(null);
        setSelectedKeys(new Set());
        lastFocusedKeyRef.current = null;
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
          const listRes = await api.listBlobs(activeNs, undefined, undefined, 100);
          if (curGen === fetchGenRef.current) {
            const items = listRes.items || [];
            setBlobs(items);
            setNextCursor(listRes.next_cursor || null);
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
            setNextCursor(null);
          }
        }
      } else {
        if (curGen === fetchGenRef.current) {
          setBlobs([]);
          setNextCursor(null);
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
    setNextCursor(null);
    try {
      const res = await api.listBlobs(ns, undefined, undefined, 100);
      setBlobs(res.items || []);
      setNextCursor(res.next_cursor || null);
    } catch {
      setBlobs([]);
      setNextCursor(null);
    } finally {
      setIsLoading(false);
    }
  };

  // Cursor-paginated lazy loader: appends next batch of blobs when scrolling near bottom
  const handleLoadMore = useCallback(async () => {
    if (!nextCursor || isLoadingMore || isLoading || !activeNamespace) return;
    setIsLoadingMore(true);
    try {
      const res = await api.listBlobs(activeNamespace, undefined, nextCursor, 100);
      const newItems = res.items || [];
      if (newItems.length > 0) {
        setBlobs((prev) => {
          const existingKeys = new Set(prev.map((b) => b.key));
          const uniqueNew = newItems.filter((b) => !existingKeys.has(b.key));
          return [...prev, ...uniqueNew];
        });
      }
      setNextCursor(res.next_cursor || null);
    } catch (err: unknown) {
      console.error('Failed to load next page of blobs:', err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [nextCursor, isLoadingMore, isLoading, activeNamespace]);

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

  // Flattened list of all items currently rendered in explorer
  const allVisibleItems = useMemo(() => [...folderItems, ...fileItems], [folderItems, fileItems]);

  // List of full StorageItems corresponding to selectedKeys
  const selectedItemsList = useMemo(() => {
    return allVisibleItems.filter((it) => selectedKeys.has(it.fullKey));
  }, [allVisibleItems, selectedKeys]);

  // Multi-selection handlers with shift-range and ctrl/meta toggle support
  const handleToggleSelectItem = useCallback(
    (item: StorageItem, e: React.MouseEvent) => {
      const isShift = Boolean(e.shiftKey);
      const isCtrlOrMeta = Boolean(e.ctrlKey || e.metaKey);

      // Determine current item index in visible items list
      const curIdx = allVisibleItems.findIndex((it) => it.fullKey === item.fullKey);
      if (curIdx === -1) return;

      if (isShift) {
        // Resolve anchor key: prefer lastFocusedKeyRef, then selectedItem, then first selected key
        const anchorKey =
          lastFocusedKeyRef.current &&
          allVisibleItems.some((it) => it.fullKey === lastFocusedKeyRef.current)
            ? lastFocusedKeyRef.current
            : selectedItem && allVisibleItems.some((it) => it.fullKey === selectedItem.fullKey)
            ? selectedItem.fullKey
            : selectedKeys.size > 0
            ? Array.from(selectedKeys).find((k) => allVisibleItems.some((it) => it.fullKey === k)) || null
            : null;

        const anchorIdx = anchorKey
          ? allVisibleItems.findIndex((it) => it.fullKey === anchorKey)
          : 0;

        const validAnchorIdx = anchorIdx !== -1 ? anchorIdx : 0;
        const [start, end] =
          validAnchorIdx < curIdx
            ? [validAnchorIdx, curIdx]
            : [curIdx, validAnchorIdx];

        // If Ctrl/Cmd is also held, preserve existing selections and union with range; else replace with range
        const rangeKeys = new Set(isCtrlOrMeta ? selectedKeys : []);
        for (let i = start; i <= end; i++) {
          rangeKeys.add(allVisibleItems[i].fullKey);
        }

        setSelectedKeys(rangeKeys);
        setSelectedItem(item);

        // Keep the original anchor key so subsequent Shift-clicks adjust from the same anchor point
        if (!lastFocusedKeyRef.current || !allVisibleItems.some((it) => it.fullKey === lastFocusedKeyRef.current)) {
          lastFocusedKeyRef.current = allVisibleItems[validAnchorIdx].fullKey;
        }
        return;
      }

      // Normal toggle or Ctrl/Cmd toggle
      const nextKeys = new Set(selectedKeys);
      if (nextKeys.has(item.fullKey)) {
        nextKeys.delete(item.fullKey);
        if (selectedItem?.fullKey === item.fullKey) {
          const remainingKey = Array.from(nextKeys)[0];
          const remainingItem = remainingKey
            ? allVisibleItems.find((it) => it.fullKey === remainingKey) || null
            : null;
          setSelectedItem(remainingItem);
        }
      } else {
        nextKeys.add(item.fullKey);
        setSelectedItem(item);
      }
      setSelectedKeys(nextKeys);
      lastFocusedKeyRef.current = item.fullKey;
    },
    [allVisibleItems, selectedItem, selectedKeys]
  );

  const handleSelectItem = useCallback((item: StorageItem) => {
    setSelectedKeys(new Set([item.fullKey]));
    setSelectedItem(item);
    lastFocusedKeyRef.current = item.fullKey;
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedKeys((prev) => {
      if (allVisibleItems.length === 0) return new Set();
      const isAllSelected = allVisibleItems.every((it) => prev.has(it.fullKey));
      if (isAllSelected) {
        setSelectedItem(null);
        lastFocusedKeyRef.current = null;
        return new Set();
      } else {
        const next = new Set(allVisibleItems.map((it) => it.fullKey));
        if (!selectedItem && allVisibleItems.length > 0) {
          setSelectedItem(allVisibleItems[0]);
          lastFocusedKeyRef.current = allVisibleItems[0].fullKey;
        }
        return next;
      }
    });
  }, [allVisibleItems, selectedItem]);

  const handleClearSelection = useCallback(() => {
    setSelectedKeys(new Set());
    setSelectedItem(null);
    lastFocusedKeyRef.current = null;
  }, []);

  // Global keyboard shortcuts (Escape to deselect/dismiss, Ctrl+A to select all, Delete to batch delete)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isNewFolderOpen) setIsNewFolderOpen(false);
        else if (isRenameOpen) setIsRenameOpen(false);
        else if (isNewNsOpen) setIsNewNsOpen(false);
        else if (isManageNsOpen) setIsManageNsOpen(false);
        else if (isMoveOpen) setIsMoveOpen(false);
        else if (isBatchMoveOpen) setIsBatchMoveOpen(false);
        else if (isCopyOpen) setIsCopyOpen(false);
        else if (isBatchCopyOpen) setIsBatchCopyOpen(false);
        else if (isBatchDeleteOpen) setIsBatchDeleteOpen(false);
        else if (isShareOpen) setIsShareOpen(false);
        else if (itemToDelete) setItemToDelete(null);
        else if (nsToDelete) setNsToDelete(null);
        else if (contextMenu) setContextMenu(null);
        else if (selectedKeys.size > 0 || selectedItem) {
          handleClearSelection();
        }
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        const target = e.target as HTMLElement;
        if (
          target.tagName !== 'INPUT' &&
          target.tagName !== 'TEXTAREA' &&
          !target.isContentEditable
        ) {
          e.preventDefault();
          handleSelectAll();
        }
      } else if (e.key === 'Delete') {
        const target = e.target as HTMLElement;
        if (
          target.tagName !== 'INPUT' &&
          target.tagName !== 'TEXTAREA' &&
          !target.isContentEditable &&
          selectedKeys.size > 0
        ) {
          e.preventDefault();
          setIsBatchDeleteOpen(true);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isNewFolderOpen,
    isRenameOpen,
    isNewNsOpen,
    isManageNsOpen,
    isMoveOpen,
    isBatchMoveOpen,
    isCopyOpen,
    isBatchCopyOpen,
    isBatchDeleteOpen,
    isShareOpen,
    itemToDelete,
    nsToDelete,
    contextMenu,
    selectedItem,
    selectedKeys.size,
    handleClearSelection,
    handleSelectAll,
  ]);

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

  // Helper: Enqueues and starts upload tasks sequentially
  const enqueueAndStartUploads = async (
    entriesToUpload: Array<{ file: File; key: string }>,
  ) => {
    if (entriesToUpload.length === 0 || !activeNamespace) return;

    const newTasks: UploadTask[] = entriesToUpload.map((item, idx) => ({
      id: `task-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
      name: item.file.name,
      size: item.file.size,
      key: item.key,
      namespace: activeNamespace,
      status: 'pending' as const,
      abortController: new AbortController(),
    }));

    setUploadTasks((prev) => [...prev, ...newTasks]);
    setIsUploadDrawerVisible(true);

    for (let i = 0; i < newTasks.length; i++) {
      const task = newTasks[i];
      const entry = entriesToUpload[i];

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
          entry.file,
          entry.file.type || 'application/octet-stream',
          task.abortController?.signal,
          (uploadedBytes) => {
            setUploadTasks((prev) =>
              prev.map((t) => (t.id === task.id ? { ...t, uploadedBytes } : t))
            );
          }
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

  // Direct upload handler supporting collision detection, multi-files, and directories
  const handleUploadFiles = async (
    files: FileList | File[] | UploadFileEntry[],
    destinationPrefix?: string
  ) => {
    if (!files || (Array.isArray(files) ? files.length === 0 : files.length === 0) || !activeNamespace) return;

    const targetPrefix = destinationPrefix !== undefined ? sanitizeFolder(destinationPrefix) : currentPrefix;

    // Normalize input to UploadFileEntry with preserved relative paths
    const rawList = Array.from(files as any[]);
    const entries: UploadFileEntry[] = rawList.map((item) => {
      if (item && 'file' in item && item.file instanceof File) {
        return item as UploadFileEntry;
      }
      const file = item as File;
      return {
        file,
        relativePath: (file as any).webkitRelativePath || file.name,
      };
    });

    // Detect file collisions against existing items in current folder
    const existingKeyMap = new Map<string, StorageItem>();
    for (const it of fileItems) {
      existingKeyMap.set(it.fullKey, it);
    }

    const detectedConflicts: ConflictingFile[] = [];
    for (const entry of entries) {
      const cleanRel = (entry.relativePath || entry.file.name).replace(/^[/\\]+/, '');
      const fullKey = `${targetPrefix}${cleanRel}`;
      const existing = existingKeyMap.get(fullKey);
      if (existing) {
        detectedConflicts.push({
          entry,
          name: entry.file.name,
          incomingSize: entry.file.size,
          existingSize: existing.size,
          existingModified: existing.created_at,
        });
      }
    }

    if (detectedConflicts.length > 0) {
      setConflicts(detectedConflicts);
      setPendingUploadEntries(entries);
      setPendingTargetPrefix(targetPrefix);
      setIsConflictModalOpen(true);
      return;
    }

    // No collisions: proceed directly
    const uploadList = entries.map((e) => {
      const cleanRel = (e.relativePath || e.file.name).replace(/^[/\\]+/, '');
      return { file: e.file, key: `${targetPrefix}${cleanRel}` };
    });
    await enqueueAndStartUploads(uploadList);
  };

  // Conflict resolution handler
  const handleResolveConflicts = async (resolutions: Map<string, ConflictResolution>) => {
    setIsConflictModalOpen(false);

    const existingKeySet = new Set<string>(fileItems.map((f) => f.fullKey));
    const finalUploadList: Array<{ file: File; key: string }> = [];

    for (const entry of pendingUploadEntries) {
      const decision = resolutions.get(entry.file.name) || 'replace';
      if (decision === 'skip') {
        continue;
      }

      const cleanRel = (entry.relativePath || entry.file.name).replace(/^[/\\]+/, '');
      let destKey = `${pendingTargetPrefix}${cleanRel}`;

      if (decision === 'keep_both') {
        const dotIdx = cleanRel.lastIndexOf('.');
        const base = dotIdx !== -1 ? cleanRel.slice(0, dotIdx) : cleanRel;
        const ext = dotIdx !== -1 ? cleanRel.slice(dotIdx) : '';
        let counter = 1;
        let candidate = `${pendingTargetPrefix}${base} (${counter})${ext}`;
        while (existingKeySet.has(candidate)) {
          counter++;
          candidate = `${pendingTargetPrefix}${base} (${counter})${ext}`;
        }
        destKey = candidate;
        existingKeySet.add(candidate);
      }

      finalUploadList.push({ file: entry.file, key: destKey });
    }

    setConflicts([]);
    setPendingUploadEntries([]);
    await enqueueAndStartUploads(finalUploadList);
  };

  // Check if an item (or batch of items) can legally be dropped onto target folder
  const canDropOnFolder = useCallback(
    (dragged: StorageItem | null, targetFolderKey: string): boolean => {
      if (!dragged) return false;

      const normTarget = targetFolderKey ? sanitizeFolder(targetFolderKey) : '';

      // If dragged item is in multi-selection, validate the entire batch
      const itemsToCheck =
        selectedKeys.has(dragged.fullKey) && selectedItemsList.length > 0
          ? selectedItemsList
          : [dragged];

      for (const it of itemsToCheck) {
        const normSrc = it.type === 'folder' ? sanitizeFolder(it.fullKey) : it.fullKey;

        if (it.fullKey === targetFolderKey || (it.type === 'folder' && normSrc === normTarget)) {
          return false;
        }

        if (it.type === 'folder' && normTarget.startsWith(normSrc)) {
          return false;
        }
      }

      // At least one item in the batch must not already reside in target directory
      const hasMoveableItem = itemsToCheck.some((it) => {
        const parentOfSrc = parentOf(it.fullKey);
        return parentOfSrc !== normTarget && parentOfSrc !== targetFolderKey;
      });

      return hasMoveableItem;
    },
    [selectedKeys, selectedItemsList]
  );

  // Drop item(s) directly into target folder (internal move)
  const handleDropOnFolder = async (targetFolderKey: string, droppedItem?: StorageItem) => {
    const item = droppedItem || draggedItemRef.current;
    if (!item || !activeNamespace) return;

    if (!canDropOnFolder(item, targetFolderKey)) {
      return;
    }

    const normTarget = targetFolderKey ? sanitizeFolder(targetFolderKey) : '';
    const itemsToMove =
      selectedKeys.has(item.fullKey) && selectedItemsList.length > 0
        ? selectedItemsList
        : [item];

    try {
      for (const it of itemsToMove) {
        const parentOfSrc = parentOf(it.fullKey);
        if (parentOfSrc === normTarget || parentOfSrc === targetFolderKey) {
          continue;
        }

        const isFolder = it.type === 'folder';
        const destKey = joinKey(normTarget, it.name, isFolder);
        await api.moveBlob(activeNamespace, it.fullKey, destKey, activeNamespace, isFolder);
      }

      handleClearSelection();
      await loadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to move items into folder');
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

    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      const scanned = await scanFilesFromDataTransfer(e.dataTransfer.items);
      if (scanned.length > 0) {
        await handleUploadFiles(scanned);
        return;
      }
    }

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await handleUploadFiles(e.dataTransfer.files);
    }
  };

  // Internal item drag handlers
  const handleItemDragStart = (e: React.DragEvent, item: StorageItem) => {
    if (!selectedKeys.has(item.fullKey)) {
      setSelectedKeys(new Set([item.fullKey]));
      setSelectedItem(item);
      lastFocusedKeyRef.current = item.fullKey;
    }
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
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      next.delete(itemToMove.fullKey);
      return next;
    });
    setItemToMove(null);
    if (selectedItem?.fullKey === itemToMove.fullKey) {
      setSelectedItem(null);
    }
    await loadData();
  };

  // Batch Move handler
  const handleBatchMove = async (destNs: string, targetFolder: string, items: StorageItem[]) => {
    if (!activeNamespace || items.length === 0) return;
    const cleanDir = sanitizeFolder(targetFolder);
    for (const it of items) {
      const isFolder = it.type === 'folder';
      const destKey = joinKey(cleanDir, it.name, isFolder);
      await api.moveBlob(activeNamespace, it.fullKey, destKey, destNs, isFolder);
    }
    handleClearSelection();
    await loadData();
  };

  // Copy single item handler
  const handleCopy = async (destNs: string, destKey: string) => {
    if (!itemToCopy) return;
    const isFolder = itemToCopy.type === 'folder';
    await api.copyBlob(activeNamespace, itemToCopy.fullKey, destKey, destNs, isFolder);
    setItemToCopy(null);
    await loadData();
  };

  // Batch Copy handler
  const handleBatchCopy = async (destNs: string, targetFolder: string, items: StorageItem[]) => {
    if (!activeNamespace || items.length === 0) return;
    const cleanDir = sanitizeFolder(targetFolder);
    for (const it of items) {
      const isFolder = it.type === 'folder';
      const destKey = joinKey(cleanDir, it.name, isFolder);
      await api.copyBlob(activeNamespace, it.fullKey, destKey, destNs, isFolder);
    }
    handleClearSelection();
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
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        if (next.has(itemToRename.fullKey)) {
          next.delete(itemToRename.fullKey);
          next.add(destKey);
        }
        return next;
      });
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

      setSelectedKeys((prev) => {
        const next = new Set(prev);
        if (deleted.type === 'folder') {
          for (const k of prev) {
            if (k.startsWith(deleted.fullKey)) next.delete(k);
          }
        } else {
          next.delete(deleted.fullKey);
        }
        return next;
      });

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

  // Batch Delete handler
  const handleConfirmBatchDelete = async () => {
    if (!activeNamespace || selectedKeys.size === 0) return;
    setIsBatchDeleting(true);
    try {
      const folderItemsToDelete = selectedItemsList.filter((it) => it.type === 'folder');
      const fileItemsToDelete = selectedItemsList.filter((it) => it.type === 'file');

      // 1. Delete folders by prefix
      for (const f of folderItemsToDelete) {
        await api.deleteBlobPrefix(activeNamespace, f.fullKey);
      }

      // 2. Batch delete files using the high-performance deleteBlobsBatch endpoint
      if (fileItemsToDelete.length > 0) {
        const fileKeys = fileItemsToDelete.map((it) => it.fullKey);
        await api.deleteBlobsBatch(activeNamespace, fileKeys);
      }

      // Optimistically remove deleted items from local state
      const deletedPrefixes = folderItemsToDelete.map((f) => f.fullKey);
      const deletedKeySet = new Set(fileItemsToDelete.map((f) => f.fullKey));

      setBlobs((prev) =>
        prev.filter((b) => {
          if (deletedKeySet.has(b.key)) return false;
          for (const p of deletedPrefixes) {
            if (b.key.startsWith(p)) return false;
          }
          return true;
        })
      );

      handleClearSelection();
      setIsBatchDeleteOpen(false);
      await loadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to delete selected items');
    } finally {
      setIsBatchDeleting(false);
    }
  };

  // Batch Download handler for all selected files
  const handleBatchDownload = async () => {
    const selectedFiles = selectedItemsList.filter((it) => it.type === 'file');
    if (selectedFiles.length === 0) return;
    for (const f of selectedFiles) {
      await handleDownload(f.fullKey);
      await new Promise((r) => setTimeout(r, 200));
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

  // Open Capability Link Share modal
  const handleOpenShare = useCallback((item: StorageItem) => {
    setItemToShare(item);
    setIsShareOpen(true);
  }, []);

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

  // Copy direct CDN / public URL for web integration
  const handleCopyPublicUrl = useCallback((item: StorageItem) => {
    const publicUrl = `${window.location.origin}/api/v1/blobs/public/${activeNamespace}/${item.fullKey}`;
    navigator.clipboard.writeText(publicUrl);
    setCopiedKey('public-url');
    setTimeout(() => setCopiedKey(null), 2000);
  }, [activeNamespace]);

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
      const corsList = newNsCors
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      await api.createBlobNamespace(name, maxBytes, newNsIsPublic, corsList);
      setIsNewNsOpen(false);
      setNewNsName('');
      setNewNsIsPublic(false);
      setNewNsCors('');
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
      const corsList = editNsCors
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      await api.updateBlobNamespace(currentNsInfo.name, {
        new_name: name,
        max_bytes: maxBytes,
        is_public: editNsIsPublic,
        cors_origins: corsList,
      });
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
      {/* Hidden File Input for Native Multi-File Upload Trigger */}
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

      {/* Hidden Folder Input for Recursive Directory Upload (Static Sites / Assets Hosting) */}
      <input
        ref={folderInputRef}
        type="file"
        className="hidden"
        {...({ webkitdirectory: '', directory: '' } as any)}
        multiple
        onChange={(e) => {
          if (e.target.files) {
            handleUploadFiles(e.target.files);
            e.target.value = '';
          }
        }}
      />

      {/* ─── Pane 1: Drive Sidebar (Namespaces & FileTree) ─────────────── */}
      <StorageSidebar
        width={sidebarWidth}
        onResizeStart={handleSidebarResizeStart}
        namespaces={namespaces}
        activeNamespace={activeNamespace}
        onSelectNamespace={handleNamespaceChange}
        onOpenNewNamespace={() => {
          setNewNsName('');
          setNewNsQuotaPreset('unlimited');
          setNewNsCustomBytes('');
          setNewNsIsPublic(false);
          setNewNsCors('');
          setIsNewNsOpen(true);
        }}
        onOpenManageNamespace={() => {
          const ns = namespaces.find((n) => n.name === activeNamespace);
          if (ns) {
            setEditNsName(ns.name);
            setEditNsIsPublic(Boolean(ns.is_public));
            setEditNsCors((ns.cors_origins || []).join(', '));
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
        hasMore={Boolean(nextCursor)}
        blobs={blobs}
        currentPrefix={currentPrefix}
        selectedItem={selectedItem}
        selectedKeys={selectedKeys}
        onToggleSelectItem={handleToggleSelectItem}
        onSelectFolder={(path) => {
          if (searchQuery) setSearchQuery('');
          navigateToPrefix(path, true);
        }}
        onSelectFile={(fileItem) => {
          if (searchQuery) setSearchQuery('');
          const slashIndex = fileItem.fullKey.lastIndexOf('/');
          const parentFolder = slashIndex !== -1 ? fileItem.fullKey.slice(0, slashIndex + 1) : '';
          if (parentFolder !== currentPrefix) {
            navigateToPrefix(parentFolder, true, fileItem);
          } else {
            setSelectedItem(fileItem);
            setSelectedKeys(new Set([fileItem.fullKey]));
            lastFocusedKeyRef.current = fileItem.fullKey;
          }
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
        onClearSelection={handleClearSelection}
      />

      {/* ─── Pane 2: File Explorer Main Center Canvas ─────────────── */}
      <section
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className="flex-1 flex flex-col bg-[#0c0c0c] min-w-0 overflow-hidden relative z-10"
      >
        {/* Drag and Drop Active Overlay */}
        {isDraggingOver && (
          <div className="absolute inset-0 z-30 pointer-events-none select-none bg-black/85 backdrop-blur-xs border-2 border-dashed border-[#555555] rounded-lg flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-100 font-sans">
            <Upload className="w-8 h-8 text-white mb-2 animate-bounce" />
            <h3 className="text-sm font-medium text-white">Drop files to upload</h3>
            <p className="text-xs text-[#8c8c8c] mt-1">
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
          onUploadFolderClick={() => folderInputRef.current?.click()}
          isDetailsOpen={isDetailsOpen}
          onToggleDetails={handleToggleDetails}
          canDropOnFolder={canDropOnFolder}
          draggedItemRef={draggedItemRef}
          onDropOnFolder={handleDropOnFolder}
          selectedFileItem={selectedItem && selectedItem.type === 'file' ? selectedItem : null}
          onShareClick={handleOpenShare}
          onCreateUploadLink={() => setIsUploadLinkOpen(true)}
          isPublic={Boolean(currentNsInfo?.is_public)}
        />

        {/* Main Files/Folders View Area */}
        <div
          onClick={(e) => {
            const target = e.target as HTMLElement;
            if (!target.closest('[data-storage-item="true"]') && !target.closest('button') && !target.closest('input')) {
              handleClearSelection();
            }
          }}
          onContextMenu={(e) => {
            if (e.target === e.currentTarget) {
              handleContextMenu(e, null);
            }
          }}
          onScroll={(e) => {
            if (viewMode === 'grid' && nextCursor && !isLoadingMore) {
              const el = e.currentTarget;
              if (el.scrollHeight - el.scrollTop - el.clientHeight < 250) {
                handleLoadMore();
              }
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
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="h-28 rounded-lg bg-[#141414] border border-[#222222] animate-pulse" />
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
                selectedKeys={selectedKeys}
                onSelectItem={handleSelectItem}
                onToggleSelectItem={handleToggleSelectItem}
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
                onClearSelection={handleClearSelection}
                hasMore={Boolean(nextCursor)}
                isLoadingMore={isLoadingMore}
                onLoadMore={handleLoadMore}
              />
            ) : (
              <StorageListView
                folderItems={folderItems}
                fileItems={fileItems}
                selectedItem={selectedItem}
                selectedKeys={selectedKeys}
                onSelectItem={handleSelectItem}
                onToggleSelectItem={handleToggleSelectItem}
                onSelectAll={handleSelectAll}
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
                onUploadFiles={handleUploadFiles}
                canDropOnFolder={canDropOnFolder}
                onClearSelection={handleClearSelection}
                hasMore={Boolean(nextCursor)}
                isLoadingMore={isLoadingMore}
                onLoadMore={handleLoadMore}
              />
            )
          )}
        </div>

        {/* Floating Bulk Action Bar */}
        {selectedItemsList.length > 0 && (
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-30 bg-[#0c0c0c] border border-[#262626] shadow-2xl rounded-[8px] px-2.5 py-1.5 flex items-center gap-2 font-sans text-[13px] animate-in slide-in-from-bottom-2 duration-150">
            <div className="flex items-center gap-2 pr-2 border-r border-[#222222]">
              <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-[4px] bg-[#161616] text-[#cccccc] border border-[#2a2a2a] font-medium tabular-nums text-[12px] font-sans">
                {selectedItemsList.length} selected
              </span>
              {selectedKeys.size < allVisibleItems.length && (
                <button
                  type="button"
                  onClick={handleSelectAll}
                  className="text-[#8c8c8c] hover:text-white transition-colors cursor-pointer text-[12px] font-sans"
                >
                  Select all ({allVisibleItems.length})
                </button>
              )}
            </div>

            {/* Action: Download (only active if at least 1 file selected) */}
            <button
              type="button"
              onClick={handleBatchDownload}
              disabled={selectedItemsList.every((it) => it.type === 'folder')}
              title="Download selected files"
              className="flex items-center gap-1.5 h-7 px-2.5 rounded-[6px] text-[13px] font-sans font-medium text-[#cccccc] hover:text-white bg-[#141414] hover:bg-[#1a1a1a] border border-[#242424] hover:border-[#333333] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download className="w-3.5 h-3.5 text-[#8c8c8c]" />
              <span>Download</span>
            </button>

            {/* Action: Move */}
            <button
              type="button"
              onClick={() => setIsBatchMoveOpen(true)}
              title="Move selected items"
              className="flex items-center gap-1.5 h-7 px-2.5 rounded-[6px] text-[13px] font-sans font-medium text-[#cccccc] hover:text-white bg-[#141414] hover:bg-[#1a1a1a] border border-[#242424] hover:border-[#333333] transition-colors cursor-pointer"
            >
              <ArrowRight className="w-3.5 h-3.5 text-[#8c8c8c]" />
              <span>Move</span>
            </button>

            {/* Action: Copy */}
            <button
              type="button"
              onClick={() => setIsBatchCopyOpen(true)}
              title="Copy selected items"
              className="flex items-center gap-1.5 h-7 px-2.5 rounded-[6px] text-[13px] font-sans font-medium text-[#cccccc] hover:text-white bg-[#141414] hover:bg-[#1a1a1a] border border-[#242424] hover:border-[#333333] transition-colors cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5 text-[#8c8c8c]" />
              <span>Copy</span>
            </button>

            {/* Action: Delete */}
            <button
              type="button"
              onClick={() => setIsBatchDeleteOpen(true)}
              title="Delete selected items"
              className="flex items-center gap-1.5 h-7 px-2.5 rounded-[6px] text-[13px] font-sans font-medium text-[#e5484d] hover:text-white bg-red-950/20 hover:bg-red-900/40 border border-red-900/40 hover:border-red-700/60 transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete</span>
            </button>

            {/* Clear Selection */}
            <button
              type="button"
              onClick={handleClearSelection}
              title="Clear selection (Esc)"
              className="h-7 w-7 rounded-[6px] text-[#8c8c8c] hover:text-white hover:bg-[#181818] border border-transparent hover:border-[#262626] transition-colors cursor-pointer flex items-center justify-center ml-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </section>

      {/* ─── Pane 3: Right Inspector / Details Panel ─────────────── */}
      <StorageDetailsPanel
        width={detailsWidth}
        onResizeStart={handleDetailsResizeStart}
        isOpen={isDetailsOpen}
        onClose={() => setIsDetailsOpen(false)}
        selectedItem={inspectorItem}
        activeNamespace={activeNamespace}
        currentNsInfo={currentNsInfo}
        onDownload={handleDownload}
        onShare={handleOpenShare}
        onCopyPublicUrl={handleCopyPublicUrl}
        onOpenMove={(item) => {
          setItemToMove(item);
          setIsMoveOpen(true);
        }}
        onOpenCopy={(item) => {
          setItemToCopy(item);
          setIsCopyOpen(true);
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
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs font-sans select-none"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isCreatingFolder) {
              setIsNewFolderOpen(false);
            }
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-[10px] bg-[#0e0e0e] border border-[#262626] p-5 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-medium text-white tracking-tight">New Folder</h3>
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
                <label className="block text-[13px] text-[#8c8c8c] font-medium mb-1.5">
                  Folder Name
                </label>
                <input
                  type="text"
                  autoFocus
                  required
                  placeholder="e.g. assets"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  className="w-full h-9 px-3 rounded-[8px] bg-[#141414] border border-[#262626] focus:border-[#383838] text-white text-[14px] outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <Button
                  variant="secondary"
                  size="md"
                  type="button"
                  onClick={() => setIsNewFolderOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  type="submit"
                  disabled={isCreatingFolder || !newFolderName.trim()}
                  isLoading={isCreatingFolder}
                >
                  {isCreatingFolder ? 'Creating...' : 'Create Folder'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rename Modal */}
      {isRenameOpen && itemToRename && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs font-sans select-none"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isRenaming) {
              setIsRenameOpen(false);
            }
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-[10px] bg-[#0e0e0e] border border-[#262626] p-5 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-medium text-white tracking-tight">Rename Item</h3>
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
                <label className="block text-[13px] text-[#8c8c8c] font-medium mb-1.5">
                  New Name
                </label>
                <input
                  type="text"
                  autoFocus
                  required
                  value={renameInput}
                  onChange={(e) => setRenameInput(e.target.value)}
                  className="w-full h-9 px-3 rounded-[8px] bg-[#141414] border border-[#262626] focus:border-[#383838] text-white text-[14px] outline-none"
                />
                {renameError && (
                  <p className="text-xs text-rose-400 mt-1">{renameError}</p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <Button
                  variant="secondary"
                  size="md"
                  type="button"
                  onClick={() => setIsRenameOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  type="submit"
                  disabled={isRenaming || !renameInput.trim()}
                  isLoading={isRenaming}
                >
                  {isRenaming ? 'Renaming...' : 'Rename'}
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

      {/* Batch Move Dialog Modal */}
      <MoveDialog
        isOpen={isBatchMoveOpen}
        onClose={() => {
          setIsBatchMoveOpen(false);
        }}
        items={selectedItemsList}
        namespaces={namespaces}
        currentNamespace={activeNamespace}
        availableFolders={availableFolders}
        onBatchMove={handleBatchMove}
      />

      {/* Copy Dialog Modal */}
      <MoveDialog
        isOpen={isCopyOpen}
        mode="copy"
        onClose={() => {
          setIsCopyOpen(false);
          setItemToCopy(null);
        }}
        item={itemToCopy}
        namespaces={namespaces}
        currentNamespace={activeNamespace}
        availableFolders={availableFolders}
        onMove={handleCopy}
      />

      {/* Batch Copy Dialog Modal */}
      <MoveDialog
        isOpen={isBatchCopyOpen}
        mode="copy"
        onClose={() => {
          setIsBatchCopyOpen(false);
        }}
        items={selectedItemsList}
        namespaces={namespaces}
        currentNamespace={activeNamespace}
        availableFolders={availableFolders}
        onBatchMove={handleBatchCopy}
      />

      {/* Batch Delete Confirmation Modal */}
      <ConfirmDialog
        isOpen={isBatchDeleteOpen}
        onClose={() => setIsBatchDeleteOpen(false)}
        onConfirm={handleConfirmBatchDelete}
        title={`Delete ${selectedItemsList.length} Selected Items`}
        description={
          <span>
            Are you sure you want to permanently delete{' '}
            <strong className="text-white">{selectedItemsList.length} items</strong>
            {selectedItemsList.some((it) => it.type === 'folder')
              ? ' including all directories and their contents'
              : ''}
            ? This action cannot be undone.
          </span>
        }
        confirmLabel={isBatchDeleting ? 'Deleting...' : `Delete ${selectedItemsList.length} Items`}
        variant="danger"
      />

      {/* New Namespace Modal */}
      {isNewNsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs font-sans select-none"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isCreatingNs) {
              setIsNewNsOpen(false);
            }
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-[10px] bg-[#0e0e0e] border border-[#262626] p-5 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-medium text-white tracking-tight">Create Namespace</h3>
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
                <label className="block text-[13px] text-[#8c8c8c] font-medium mb-1.5">
                  Namespace Name
                </label>
                <input
                  type="text"
                  autoFocus
                  required
                  placeholder="e.g. avatars, invoices"
                  value={newNsName}
                  onChange={(e) => setNewNsName(e.target.value)}
                  className="w-full h-9 px-3 rounded-[8px] bg-[#141414] border border-[#262626] focus:border-[#383838] text-white text-[14px] outline-none"
                />
              </div>

              <div>
                <label className="block text-[13px] text-[#8c8c8c] font-medium mb-1.5">
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
                  <label className="block text-[13px] text-[#8c8c8c] font-medium mb-1.5">
                    Limit in Bytes
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={newNsCustomBytes}
                    onChange={(e) => setNewNsCustomBytes(e.target.value)}
                    placeholder="e.g. 104857600"
                    className="w-full h-9 px-3 rounded-[8px] bg-[#141414] border border-[#262626] focus:border-[#383838] text-white text-[14px] outline-none"
                  />
                </div>
              )}

              <div className="pt-2 border-t border-[#1e1e1e] space-y-3">
                <div className="flex items-start gap-3">
                  <Switch
                    checked={newNsIsPublic}
                    onCheckedChange={setNewNsIsPublic}
                    id="new-ns-public-switch"
                    className="mt-0.5"
                  />
                  <div>
                    <label htmlFor="new-ns-public-switch" className="text-[13px] font-medium text-white block cursor-pointer">
                      Enable Public Read Access
                    </label>
                    <span className="text-[12.5px] text-[#777777] leading-relaxed block mt-0.5">
                      Direct static URLs (<code className="text-[#a3a3a3]">/api/v1/blobs/public/:namespace/*key</code>) with HTTP 304 browser caching for websites. Writes remain strictly authenticated.
                    </span>
                  </div>
                </div>

                {newNsIsPublic && (
                  <div>
                    <label className="block text-[13px] text-[#8c8c8c] font-medium mb-1.5">
                      Allowed CORS Origins (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. *, https://example.com"
                      value={newNsCors}
                      onChange={(e) => setNewNsCors(e.target.value)}
                      className="w-full h-9 px-3 rounded-[8px] bg-[#141414] border border-[#262626] focus:border-[#383838] text-white text-[14px] outline-none"
                    />
                    <span className="text-[12px] text-[#666666] block mt-1">
                      Comma-separated list of origins. Leave empty to allow any origin when public.
                    </span>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <Button
                  variant="secondary"
                  size="md"
                  type="button"
                  onClick={() => setIsNewNsOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  type="submit"
                  disabled={isCreatingNs || !newNsName.trim()}
                  isLoading={isCreatingNs}
                >
                  {isCreatingNs ? 'Creating...' : 'Create Namespace'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manage Namespace Modal */}
      {isManageNsOpen && currentNsInfo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs font-sans select-none"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isSavingNs) {
              setIsManageNsOpen(false);
            }
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-[10px] bg-[#0e0e0e] border border-[#262626] p-5 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between pb-0.5">
              <div className="flex items-center gap-2">
                <h3 className="text-[15px] font-medium text-white tracking-tight">Manage Namespace</h3>
                <span className="px-1.5 py-0.5 rounded bg-[#161616] border border-[#262626] text-xs font-mono text-[#8c8c8c]">
                  {currentNsInfo.name}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsManageNsOpen(false)}
                className="w-7 h-7 flex items-center justify-center rounded-md text-[#777777] hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Tab bar (Segmented control matching dashboard) */}
            <div className="-mx-5 px-5 py-2.5 border-b border-[#222222] bg-[#0e0e0e]">
              <div className="inline-flex items-center p-0.5 rounded-lg bg-transparent border border-[#262626]">
                <button
                  type="button"
                  onClick={() => setManageNsTab('settings')}
                  className={`flex items-center gap-1.5 h-8 px-3.5 rounded-[6px] text-[13px] font-medium transition-colors duration-75 cursor-pointer font-sans outline-none focus:outline-none border ${
                    manageNsTab === 'settings'
                      ? 'bg-[#161616] text-white border-[#333333]'
                      : 'text-[#8c8c8c] hover:text-white hover:bg-[#141414] border-transparent'
                  }`}
                >
                  <span>Settings</span>
                </button>
                <button
                  type="button"
                  onClick={() => setManageNsTab('danger')}
                  className={`flex items-center gap-1.5 h-8 px-3.5 rounded-[6px] text-[13px] font-medium transition-colors duration-75 cursor-pointer font-sans outline-none focus:outline-none border ${
                    manageNsTab === 'danger'
                      ? 'bg-[#161616] text-white border-[#333333]'
                      : 'text-[#8c8c8c] hover:text-white hover:bg-[#141414] border-transparent'
                  }`}
                >
                  <span>Danger</span>
                </button>
              </div>
            </div>

            {manageNsTab === 'settings' ? (
              <form onSubmit={handleUpdateNamespace} className="space-y-4">
                <div>
                  <label className="block text-[13px] text-[#8c8c8c] font-medium mb-1.5">
                    Identifier
                  </label>
                  <input
                    type="text"
                    required
                    value={editNsName}
                    onChange={(e) => setEditNsName(e.target.value)}
                    className="w-full h-9 px-3 rounded-[8px] bg-[#141414] border border-[#262626] focus:border-[#383838] text-white text-[14px] outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[13px] text-[#8c8c8c] font-medium mb-1.5">
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
                    <label className="block text-[13px] text-[#8c8c8c] font-medium mb-1.5">
                      Limit in Bytes
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={editNsCustomBytes}
                      onChange={(e) => setEditNsCustomBytes(e.target.value)}
                      className="w-full h-9 px-3 rounded-[8px] bg-[#141414] border border-[#262626] focus:border-[#383838] text-white text-[14px] outline-none"
                    />
                  </div>
                )}

                <div className="pt-2 border-t border-[#1e1e1e] space-y-3">
                  <div className="flex items-start gap-3">
                    <Switch
                      checked={editNsIsPublic}
                      onCheckedChange={setEditNsIsPublic}
                      id="edit-ns-public-switch"
                      className="mt-0.5"
                    />
                    <div>
                      <label htmlFor="edit-ns-public-switch" className="text-[13px] font-medium text-white block cursor-pointer">
                        Enable Public Read Access
                      </label>
                      <span className="text-[12.5px] text-[#777777] leading-relaxed block mt-0.5">
                        Direct static URLs (<code className="text-[#a3a3a3]">/api/v1/blobs/public/:namespace/*key</code>) with HTTP 304 browser caching for websites.
                      </span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[13px] text-[#8c8c8c] font-medium mb-1.5">
                      Allowed CORS Origins
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. *, https://example.com"
                      value={editNsCors}
                      onChange={(e) => setEditNsCors(e.target.value)}
                      className="w-full h-9 px-3 rounded-[8px] bg-[#141414] border border-[#262626] focus:border-[#383838] text-white text-[14px] outline-none"
                    />
                    <span className="text-[12px] text-[#666666] block mt-1">
                      Comma-separated origins. Leave empty to allow any origin when public.
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <Button
                    variant="secondary"
                    size="md"
                    type="button"
                    onClick={() => setIsManageNsOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    size="md"
                    type="submit"
                    disabled={isSavingNs || !editNsName.trim()}
                    isLoading={isSavingNs}
                  >
                    {isSavingNs ? 'Saving...' : 'Save Changes'}
                  </Button>
                </div>
              </form>
            ) : (
              <div className="space-y-4">
                <div className="p-3.5 rounded-md bg-[#2a1113] border border-[#5c1d24] text-xs text-[#f87171] leading-relaxed flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-[#e5484d] shrink-0 mt-0.5" />
                  <div>
                    Permanently delete namespace <strong className="text-white">{currentNsInfo.name}</strong> and all{' '}
                    <strong className="text-white">{currentNsInfo.total_objects} stored objects</strong> inside it. This action cannot be undone.
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <Button
                    variant="secondary"
                    size="md"
                    type="button"
                    onClick={() => setIsManageNsOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    size="md"
                    type="button"
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
        onShare={handleOpenShare}
        onCopyPublicUrl={handleCopyPublicUrl}
        isPublicNamespace={Boolean(currentNsInfo?.is_public)}
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
          if (selectedKeys.has(item.fullKey) && selectedItemsList.length > 1) {
            setIsBatchCopyOpen(true);
          } else {
            setItemToCopy(item);
            setIsCopyOpen(true);
          }
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

      {/* Capability Ticket / Share Link Modal */}
      <ShareTicketModal
        isOpen={isShareOpen}
        onClose={() => {
          setIsShareOpen(false);
          setItemToShare(null);
        }}
        item={itemToShare}
        namespace={activeNamespace}
        isPublicNamespace={Boolean(currentNsInfo?.is_public)}
      />

      {/* Pre-signed Upload Link Modal */}
      <CreateUploadLinkModal
        isOpen={isUploadLinkOpen}
        onClose={() => setIsUploadLinkOpen(false)}
        namespace={activeNamespace}
        currentPrefix={currentPrefix}
      />

      {/* File Upload Collision / Conflict Modal */}
      <FileConflictModal
        isOpen={isConflictModalOpen}
        conflicts={conflicts}
        onResolve={handleResolveConflicts}
        onCancel={() => {
          setIsConflictModalOpen(false);
          setConflicts([]);
          setPendingUploadEntries([]);
        }}
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
