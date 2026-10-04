/*
 * Native embedded blob storage management interface for Axiom.
 * Owned by: ui/pages
 * Key deps: ../api/client, ../types, ../components/shared/DataTable, ../components/ui/SlideOver, ../components/ui/Button, ../components/ui/ConfirmDialog
 * Invariants: Content-addressed objects identified by BLAKE3 hash; zero external S3 daemon overhead.
 * Last structural change: Native embedded blob engine UI implementation.
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
  File,
  FileText,
  Image as ImageIcon,
  FileCode,
  Archive,
  Copy,
  Check,
  ShieldCheck,
  Layers,
  Folder,
  SlidersHorizontal,
  X,
  ExternalLink,
} from 'lucide-react';
import { api } from '../api/client';
import { BlobEntry, BlobStats } from '../types';
import { DataTable, Column } from '../components/shared/DataTable';
import { SlideOver } from '../components/ui/SlideOver';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { CustomSelect } from '../components/shared/CustomSelect';

/**
 * Formats raw byte count into human-readable engineering units (B, KB, MB, GB).
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Returns a category icon based on file extension for visual identification.
 */
function getFileIcon(key: string) {
  const ext = key.split('.').pop()?.toLowerCase() || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'].includes(ext)) {
    return <ImageIcon className="w-4 h-4 text-[#38bdf8] shrink-0" />;
  }
  if (['pdf', 'txt', 'md', 'doc', 'docx', 'rtf'].includes(ext)) {
    return <FileText className="w-4 h-4 text-[#fb7185] shrink-0" />;
  }
  if (['json', 'js', 'ts', 'tsx', 'jsx', 'rs', 'py', 'go', 'html', 'css', 'sql', 'toml', 'yaml', 'yml'].includes(ext)) {
    return <FileCode className="w-4 h-4 text-[#fbbf24] shrink-0" />;
  }
  if (['zip', 'tar', 'gz', 'tgz', '7z', 'rar', 'bz2'].includes(ext)) {
    return <Archive className="w-4 h-4 text-[#c084fc] shrink-0" />;
  }
  return <File className="w-4 h-4 text-[#8c8c8c] shrink-0" />;
}

export function Storage() {
  const [stats, setStats] = useState<BlobStats | null>(null);
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [activeNamespace, setActiveNamespace] = useState<string>('default');
  const [blobs, setBlobs] = useState<BlobEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [tierFilter, setTierFilter] = useState<'all' | 'inline' | 'disk'>('all');

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Modals & Panels
  const [selectedBlob, setSelectedBlob] = useState<BlobEntry | null>(null);
  const [isInspectOpen, setIsInspectOpen] = useState(false);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isNewNsOpen, setIsNewNsOpen] = useState(false);
  const [newNsName, setNewNsName] = useState('');

  // Delete State
  const [blobToDelete, setBlobToDelete] = useState<BlobEntry | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Verification state (namespace/key -> status)
  const [verifyMap, setVerifyMap] = useState<Record<string, 'verifying' | 'valid' | 'invalid'>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Upload Form State
  const [uploadNs, setUploadNs] = useState('');
  const [uploadKey, setUploadKey] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadContentType, setUploadContentType] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const fetchGenRef = useRef(0);

  const loadData = useCallback(async () => {
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

      let currentNs = activeNamespace;
      if (nsRes.status === 'fulfilled' && Array.isArray(nsRes.value)) {
        const list = nsRes.value;
        const merged = Array.from(new Set(['default', ...list]));
        setNamespaces(merged);
        if (!merged.includes(currentNs)) {
          currentNs = merged[0] || 'default';
          setActiveNamespace(currentNs);
        }
      } else {
        setNamespaces(['default']);
      }

      // Load objects for the active namespace
      try {
        const listRes = await api.listBlobs(currentNs);
        if (curGen === fetchGenRef.current) {
          setBlobs(listRes.items || []);
        }
      } catch (err: unknown) {
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
  }, [activeNamespace]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle Namespace Change
  const handleNamespaceChange = async (ns: string) => {
    setActiveNamespace(ns);
    setPage(1);
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

  // Filtered Objects
  const filteredBlobs = useMemo(() => {
    return blobs.filter((item) => {
      const matchesSearch = searchQuery.trim() === '' || item.key.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesTier =
        tierFilter === 'all' ||
        (tierFilter === 'inline' && item.inline) ||
        (tierFilter === 'disk' && !item.inline);
      return matchesSearch && matchesTier;
    });
  }, [blobs, searchQuery, tierFilter]);

  // Paginated Objects
  const paginatedBlobs = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredBlobs.slice(start, start + pageSize);
  }, [filteredBlobs, page, pageSize]);

  // Handle Copy Hash
  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // Verify Blob Integrity
  const handleVerifyBlob = async (namespace: string, key: string) => {
    const id = `${namespace}/${key}`;
    setVerifyMap((prev) => ({ ...prev, [id]: 'verifying' }));
    try {
      const res = await api.verifyBlob(namespace, key);
      setVerifyMap((prev) => ({ ...prev, [id]: res.valid ? 'valid' : 'invalid' }));
    } catch {
      setVerifyMap((prev) => ({ ...prev, [id]: 'invalid' }));
    }
  };

  // Delete Blob
  const handleDeleteBlob = async () => {
    if (!blobToDelete) return;
    setIsDeleting(true);
    try {
      await api.deleteBlob(blobToDelete.namespace, blobToDelete.key);
      setBlobs((prev) => prev.filter((b) => !(b.namespace === blobToDelete.namespace && b.key === blobToDelete.key)));
      if (selectedBlob && selectedBlob.namespace === blobToDelete.namespace && selectedBlob.key === blobToDelete.key) {
        setIsInspectOpen(false);
        setSelectedBlob(null);
      }
      setBlobToDelete(null);
      // Reload stats
      const statsRes = await api.getBlobStats().catch(() => null);
      if (statsRes) setStats(statsRes);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to delete blob');
    } finally {
      setIsDeleting(false);
    }
  };

  // Download Blob
  const handleDownloadBlob = async (namespace: string, key: string) => {
    try {
      const blob = await api.downloadBlob(namespace, key);
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

  // Handle File Selected for Upload
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setUploadFile(file);
      if (!uploadKey) {
        setUploadKey(file.name);
      }
      setUploadContentType(file.type || 'application/octet-stream');
    }
  };

  // Handle Submit Upload
  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) {
      setUploadError('Please select a file to upload.');
      return;
    }
    const targetNs = uploadNs.trim() || activeNamespace;
    const targetKey = uploadKey.trim();
    if (!targetKey) {
      setUploadError('Object key / path is required.');
      return;
    }

    setIsUploading(true);
    setUploadError(null);
    try {
      await api.uploadBlob(targetNs, targetKey, uploadFile, uploadContentType);
      setIsUploadOpen(false);
      setUploadFile(null);
      setUploadKey('');
      setUploadContentType('');
      // Refresh current view
      if (targetNs !== activeNamespace) {
        setActiveNamespace(targetNs);
      }
      await loadData();
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  // Handle Create Namespace
  const handleCreateNamespace = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newNsName.trim().toLowerCase();
    if (!trimmed) return;
    if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
      alert('Namespace must consist of alphanumeric characters, dots, underscores, or hyphens.');
      return;
    }
    if (!namespaces.includes(trimmed)) {
      setNamespaces((prev) => [...prev, trimmed]);
    }
    setActiveNamespace(trimmed);
    setNewNsName('');
    setIsNewNsOpen(false);
  };

  // Columns definition for DataTable
  const columns: Column<BlobEntry>[] = [
    {
      id: 'key',
      header: 'Object Key',
      isFlex: true,
      minWidth: 240,
      className: 'pl-4 pr-3',
      cell: (row) => (
        <div
          onClick={() => {
            setSelectedBlob(row);
            setIsInspectOpen(true);
          }}
          className="flex items-center gap-2.5 min-w-0 cursor-pointer group"
        >
          {getFileIcon(row.key)}
          <span className="font-medium text-white text-[14px] truncate whitespace-nowrap group-hover:text-[#3b82f6] transition-colors" title={row.key}>
            {row.key}
          </span>
        </div>
      ),
    },
    {
      id: 'size',
      header: 'Size',
      width: 120,
      className: 'px-3',
      cell: (row) => (
        <span className="tabular-nums text-[14px] text-[#d4d4d4] font-mono truncate whitespace-nowrap block">
          {formatBytes(row.size)}
        </span>
      ),
    },
    {
      id: 'tier',
      header: 'Storage Tier',
      width: 140,
      className: 'px-3',
      cell: (row) => (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-[4px] text-[12px] font-mono font-medium ${
            row.inline
              ? 'bg-[#10b981]/10 text-[#34d399] border border-[#10b981]/25'
              : 'bg-[#3b82f6]/10 text-[#60a5fa] border border-[#3b82f6]/25'
          }`}
        >
          {row.inline ? 'LSM Inline' : 'Disk Shard'}
        </span>
      ),
    },
    {
      id: 'content_type',
      header: 'MIME Type',
      width: 180,
      className: 'px-3',
      cell: (row) => (
        <span className="text-[13px] text-[#8c8c8c] font-mono truncate whitespace-nowrap block" title={row.content_type}>
          {row.content_type}
        </span>
      ),
    },
    {
      id: 'hash',
      header: 'BLAKE3 Hash',
      width: 170,
      className: 'px-3',
      cell: (row) => {
        const id = `hash-${row.key}`;
        const isCopied = copiedKey === id;
        return (
          <div className="flex items-center gap-1.5 font-mono text-[12px] text-[#8c8c8c]">
            <span title={row.hash}>{row.hash.slice(0, 10)}…{row.hash.slice(-4)}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleCopy(row.hash, id);
              }}
              title="Copy full BLAKE3 hash"
              className="p-1 hover:text-white text-[#777777] rounded transition-colors cursor-pointer"
            >
              {isCopied ? <Check className="w-3 h-3 text-[#10b981]" /> : <Copy className="w-3 h-3" />}
            </button>
          </div>
        );
      },
    },
    {
      id: 'created_at',
      header: 'Created',
      width: 140,
      className: 'px-3',
      cell: (row) => {
        const d = new Date(row.created_at * 1000);
        return (
          <span className="text-[13px] text-[#8c8c8c] whitespace-nowrap block">
            {d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
        );
      },
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      isFlex: false,
      width: 130,
      headerClassName: 'justify-end pr-4 text-right',
      className: 'pl-2 pr-4 justify-end',
      cell: (row) => {
        const verifyId = `${row.namespace}/${row.key}`;
        const vState = verifyMap[verifyId];
        return (
          <div className="flex items-center justify-end gap-1.5 w-full">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleVerifyBlob(row.namespace, row.key);
              }}
              disabled={vState === 'verifying'}
              title="Verify BLAKE3 cryptographic integrity"
              className={`p-1.5 rounded-[6px] border text-[12px] transition-colors cursor-pointer ${
                vState === 'valid'
                  ? 'border-[#10b981]/40 bg-[#10b981]/10 text-[#34d399]'
                  : vState === 'invalid'
                  ? 'border-[#ef4444]/40 bg-[#ef4444]/10 text-[#f87171]'
                  : 'border-[#262626] text-[#8c8c8c] hover:text-white hover:border-[#383838]'
              }`}
            >
              {vState === 'verifying' ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#3b82f6]" />
              ) : vState === 'valid' ? (
                <CheckCircle2 className="w-3.5 h-3.5" />
              ) : vState === 'invalid' ? (
                <AlertTriangle className="w-3.5 h-3.5" />
              ) : (
                <ShieldCheck className="w-3.5 h-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleDownloadBlob(row.namespace, row.key);
              }}
              title="Download blob"
              className="p-1.5 rounded-[6px] border border-[#262626] text-[#8c8c8c] hover:text-white hover:border-[#383838] transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setBlobToDelete(row);
              }}
              title="Delete blob"
              className="p-1.5 rounded-[6px] border border-[#262626] text-[#8c8c8c] hover:text-[#ef4444] hover:border-[#ef4444]/40 transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      },
    },
  ];

  // Telemetry Calculations
  const dedupRatio = stats && stats.total_physical_bytes > 0
    ? (stats.total_logical_bytes / stats.total_physical_bytes)
    : 1.0;
  const dedupPercent = stats && stats.total_logical_bytes > 0
    ? Math.max(0, Math.round(((stats.dedup_saved_bytes) / stats.total_logical_bytes) * 100))
    : 0;

  return (
    <div className="space-y-6 w-full max-w-[1600px] mx-auto pb-12 select-none font-sans">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-[16px] font-medium text-white tracking-tight">
            Native Blob Storage
          </h1>
          <p className="text-[13px] text-[#8c8c8c] mt-0.5">
            Embedded LSM engine with automatic content deduplication, BLAKE3 checksums, and zero daemon overhead.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadData}
            title="Refresh storage"
            className="flex items-center justify-center h-8 w-8 text-[#8c8c8c] hover:text-white rounded-[8px] bg-[#0c0c0c] hover:bg-[#141414] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin opacity-50' : ''}`} />
          </button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setIsNewNsOpen(true)}
          >
            <Folder className="w-3.5 h-3.5 mr-1" />
            New Namespace
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setUploadNs(activeNamespace);
              setUploadKey('');
              setUploadFile(null);
              setUploadContentType('');
              setUploadError(null);
              setIsUploadOpen(true);
            }}
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            Upload Object
          </Button>
        </div>
      </div>

      {/* Load Error Banner */}
      {loadError && (
        <div className="rounded-[8px] border border-[#ef4444]/30 bg-[#ef4444]/10 p-3 text-[13px] text-[#ef4444] font-medium flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      {/* 4 Storage Telemetry Analytics Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 w-full font-sans">
        {/* Card 1: Total Objects */}
        <div className="rounded-[10px] bg-[#0c0c0c] border border-[#222222] p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#8c8c8c] text-[13px] font-medium">
            <span>Total Objects</span>
            <Layers className="w-4 h-4 text-[#3b82f6]" />
          </div>
          <div className="mt-2.5">
            <div className="text-[24px] font-semibold text-white tracking-tight tabular-nums">
              {(stats?.total_objects ?? blobs.length).toLocaleString()}
            </div>
            <div className="text-[12px] text-[#8c8c8c] mt-1 flex items-center gap-2">
              <span>{stats?.inline_objects ?? 0} inline</span>
              <span>·</span>
              <span>{stats?.file_objects ?? 0} disk shards</span>
            </div>
          </div>
        </div>

        {/* Card 2: Unique Blobs */}
        <div className="rounded-[10px] bg-[#0c0c0c] border border-[#222222] p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#8c8c8c] text-[13px] font-medium">
            <span>Unique Blobs</span>
            <ShieldCheck className="w-4 h-4 text-[#10b981]" />
          </div>
          <div className="mt-2.5">
            <div className="text-[24px] font-semibold text-white tracking-tight tabular-nums">
              {(stats?.unique_blobs ?? 0).toLocaleString()}
            </div>
            <div className="text-[12px] text-[#8c8c8c] mt-1">
              Content-addressed BLAKE3 references
            </div>
          </div>
        </div>

        {/* Card 3: Storage Volume */}
        <div className="rounded-[10px] bg-[#0c0c0c] border border-[#222222] p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#8c8c8c] text-[13px] font-medium">
            <span>Physical Volume</span>
            <HardDrive className="w-4 h-4 text-[#f59e0b]" />
          </div>
          <div className="mt-2.5">
            <div className="text-[24px] font-semibold text-white tracking-tight tabular-nums">
              {formatBytes(stats?.total_physical_bytes ?? 0)}
            </div>
            <div className="text-[12px] text-[#8c8c8c] mt-1">
              Logical: {formatBytes(stats?.total_logical_bytes ?? 0)}
            </div>
          </div>
        </div>

        {/* Card 4: Deduplication Savings */}
        <div className="rounded-[10px] bg-[#0c0c0c] border border-[#222222] p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#8c8c8c] text-[13px] font-medium">
            <span>Deduplication Ratio</span>
            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[#10b981]/15 text-[#34d399] border border-[#10b981]/30">
              {dedupPercent}% saved
            </span>
          </div>
          <div className="mt-2.5">
            <div className="text-[24px] font-semibold text-white tracking-tight tabular-nums">
              {dedupRatio.toFixed(2)}x
            </div>
            <div className="text-[12px] text-[#8c8c8c] mt-1">
              {formatBytes(stats?.dedup_saved_bytes ?? 0)} redundant data saved
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Workspace: Filter Bar & Table */}
      <div className="space-y-3">
        {/* Toolbar Row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 font-sans">
          {/* Namespace Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
            {namespaces.map((ns) => (
              <button
                key={ns}
                type="button"
                onClick={() => handleNamespaceChange(ns)}
                className={`px-3 py-1.5 rounded-[6px] text-[13px] font-medium transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                  activeNamespace === ns
                    ? 'bg-[#1e293b] text-white border border-[#3b82f6]/50'
                    : 'bg-[#0c0c0c] text-[#8c8c8c] hover:text-white border border-[#222222]'
                }`}
              >
                <Folder className="w-3.5 h-3.5 text-[#3b82f6]" />
                <span>{ns}</span>
                {activeNamespace === ns && (
                  <span className="text-[11px] font-mono px-1.5 py-0.2 rounded-full bg-[#3b82f6]/20 text-[#60a5fa]">
                    {blobs.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Search and Tier Filter */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Search Input */}
            <div className="relative w-full sm:w-[260px]">
              <Search className="w-3.5 h-3.5 text-[#777777] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search object key..."
                className="h-8 w-full rounded-[6px] border border-[#262626] bg-[#0c0c0c] pl-9 pr-8 text-[13px] text-white focus:outline-none focus:border-[#3b82f6]"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#777777] hover:text-white"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Storage Tier Filter */}
            <CustomSelect
              value={tierFilter}
              options={[
                { value: 'all', label: 'All Tiers' },
                { value: 'inline', label: 'LSM Inline' },
                { value: 'disk', label: 'Disk Shard' },
              ]}
              onChange={(val) => setTierFilter(val as 'all' | 'inline' | 'disk')}
              size="sm"
              menuWidth="w-[130px]"
            />
          </div>
        </div>

        {/* Objects Table */}
        <DataTable
          columns={columns}
          data={paginatedBlobs}
          keyExtractor={(item) => `${item.namespace}/${item.key}`}
          isLoading={isLoading}
          emptyMessage={
            <div className="text-center py-12">
              <HardDrive className="w-8 h-8 text-[#555555] mx-auto mb-3" />
              <div className="text-[14px] font-medium text-white">No objects found</div>
              <p className="text-[13px] text-[#8c8c8c] mt-1 max-w-sm mx-auto">
                {searchQuery
                  ? `No objects match "${searchQuery}" in namespace "${activeNamespace}".`
                  : `Namespace "${activeNamespace}" is empty. Upload your first blob to get started.`}
              </p>
              {!searchQuery && (
                <div className="mt-4">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      setUploadNs(activeNamespace);
                      setIsUploadOpen(true);
                    }}
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    Upload Object
                  </Button>
                </div>
              )}
            </div>
          }
          pagination={{
            page,
            pageSize,
            totalCount: filteredBlobs.length,
            onPageChange: (p) => setPage(p),
            onPageSizeChange: (s) => {
              setPageSize(s);
              setPage(1);
            },
            pageSizeOptions: [10, 25, 50, 100],
          }}
        />
      </div>

      {/* Right Side Panel: Object Inspector Drawer */}
      <SlideOver
        isOpen={isInspectOpen && selectedBlob !== null}
        onClose={() => {
          setIsInspectOpen(false);
          setSelectedBlob(null);
        }}
        title="Object Details"
        subtitle={selectedBlob ? `${selectedBlob.namespace} / ${selectedBlob.key}` : ''}
        width="w-[520px] max-w-full"
      >
        {selectedBlob && (
          <div className="flex flex-col h-full text-sans">
            <div className="flex-1 p-5 overflow-y-auto space-y-6">
              {/* Header Identity Card */}
            <div className="rounded-[8px] bg-[#141415] border border-[#262626] p-4 space-y-3">
              <div className="flex items-center gap-3">
                {getFileIcon(selectedBlob.key)}
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-medium text-white truncate" title={selectedBlob.key}>
                    {selectedBlob.key}
                  </div>
                  <div className="text-[12px] text-[#8c8c8c] flex items-center gap-2 mt-0.5">
                    <span>Namespace: <strong className="text-[#cccccc]">{selectedBlob.namespace}</strong></span>
                    <span>·</span>
                    <span>{formatBytes(selectedBlob.size)}</span>
                  </div>
                </div>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-[4px] text-[11px] font-mono font-medium shrink-0 ${
                    selectedBlob.inline
                      ? 'bg-[#10b981]/10 text-[#34d399] border border-[#10b981]/25'
                      : 'bg-[#3b82f6]/10 text-[#60a5fa] border border-[#3b82f6]/25'
                  }`}
                >
                  {selectedBlob.inline ? 'LSM Inline' : 'Disk Shard'}
                </span>
              </div>
            </div>

            {/* Metadata Grid */}
            <div className="space-y-3">
              <h3 className="text-[13px] font-medium text-[#8c8c8c] uppercase tracking-wider">
                Object Attributes
              </h3>
              <div className="rounded-[8px] bg-[#141415] border border-[#262626] divide-y divide-[#262626]">
                <div className="flex items-center justify-between p-3 text-[13px]">
                  <span className="text-[#8c8c8c]">Exact Size</span>
                  <span className="text-white font-mono">{selectedBlob.size.toLocaleString()} bytes</span>
                </div>
                <div className="flex items-center justify-between p-3 text-[13px]">
                  <span className="text-[#8c8c8c]">Content-Type</span>
                  <span className="text-white font-mono">{selectedBlob.content_type}</span>
                </div>
                <div className="flex items-center justify-between p-3 text-[13px]">
                  <span className="text-[#8c8c8c]">Storage Mechanism</span>
                  <span className="text-white">
                    {selectedBlob.inline ? 'Fjall LSM keyspace (<64KB threshold)' : 'Content-addressed disk shard'}
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 text-[13px]">
                  <span className="text-[#8c8c8c]">Uploaded At</span>
                  <span className="text-white">
                    {new Date(selectedBlob.created_at * 1000).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            {/* BLAKE3 Cryptographic Checksum Card */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-[13px] font-medium text-[#8c8c8c] uppercase tracking-wider">
                  BLAKE3 Cryptographic Digest
                </h3>
                <button
                  type="button"
                  onClick={() => handleCopy(selectedBlob.hash, 'drawer-hash')}
                  className="text-[12px] text-[#3b82f6] hover:text-[#60a5fa] flex items-center gap-1 cursor-pointer"
                >
                  {copiedKey === 'drawer-hash' ? (
                    <>
                      <Check className="w-3 h-3 text-[#10b981]" />
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Copy Full Hash</span>
                    </>
                  )}
                </button>
              </div>
              <div className="p-3 rounded-[6px] bg-[#0c0c0c] border border-[#262626] font-mono text-[12px] text-[#d4d4d4] break-all select-all">
                {selectedBlob.hash}
              </div>

              {/* Integrity status button */}
              <div>
                <button
                  type="button"
                  onClick={() => handleVerifyBlob(selectedBlob.namespace, selectedBlob.key)}
                  disabled={verifyMap[`${selectedBlob.namespace}/${selectedBlob.key}`] === 'verifying'}
                  className={`w-full py-2 px-3 rounded-[6px] border text-[13px] font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer ${
                    verifyMap[`${selectedBlob.namespace}/${selectedBlob.key}`] === 'valid'
                      ? 'border-[#10b981]/40 bg-[#10b981]/10 text-[#34d399]'
                      : verifyMap[`${selectedBlob.namespace}/${selectedBlob.key}`] === 'invalid'
                      ? 'border-[#ef4444]/40 bg-[#ef4444]/10 text-[#f87171]'
                      : 'border-[#262626] bg-[#141415] text-[#cccccc] hover:text-white hover:border-[#383838]'
                  }`}
                >
                  {verifyMap[`${selectedBlob.namespace}/${selectedBlob.key}`] === 'verifying' ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#3b82f6]" />
                      <span>Verifying disk shard checksum...</span>
                    </>
                  ) : verifyMap[`${selectedBlob.namespace}/${selectedBlob.key}`] === 'valid' ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-[#10b981]" />
                      <span>Checksum Verified: Payload Matches BLAKE3 Hash</span>
                    </>
                  ) : verifyMap[`${selectedBlob.namespace}/${selectedBlob.key}`] === 'invalid' ? (
                    <>
                      <AlertTriangle className="w-4 h-4 text-[#ef4444]" />
                      <span>Integrity Verification Failed</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4 text-[#3b82f6]" />
                      <span>Verify Cryptographic Integrity</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Quick API / CLI Access */}
            <div className="space-y-2">
              <h3 className="text-[13px] font-medium text-[#8c8c8c] uppercase tracking-wider">
                HTTP Streaming Access
              </h3>
              <div className="p-3 rounded-[6px] bg-[#0c0c0c] border border-[#262626] font-mono text-[11px] text-[#a3a3a3] break-all select-all">
                curl -X GET "http://localhost:4500/api/v1/blobs/{selectedBlob.namespace}/{selectedBlob.key}" \<br />
                &nbsp;&nbsp;-H "X-Axiom-Key: &lt;API_KEY&gt;"
              </div>
            </div>
            </div>

            {/* Action Buttons Panel */}
            <div className="p-4 border-t border-[#222222] bg-[#0e0e0e] flex items-center justify-between gap-3">
              <Button
                variant="danger"
                size="md"
                onClick={() => setBlobToDelete(selectedBlob)}
              >
                <Trash2 className="w-4 h-4 mr-1.5" />
                Delete Blob
              </Button>
              <Button
                variant="primary"
                size="md"
                onClick={() => handleDownloadBlob(selectedBlob.namespace, selectedBlob.key)}
              >
                <Download className="w-4 h-4 mr-1.5" />
                Download Payload
              </Button>
            </div>
          </div>
        )}
      </SlideOver>

      {/* Upload SlideOver Modal */}
      <SlideOver
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        title="Upload Object"
        subtitle="Store a new content-addressed file in Axiom Native Blob Engine"
        width="w-[520px] max-w-full"
      >
        <form onSubmit={handleUploadSubmit} className="flex flex-col h-full text-sans">
          <div className="flex-1 p-5 overflow-y-auto space-y-5">
          {uploadError && (
            <div className="rounded-[6px] border border-[#ef4444]/30 bg-[#ef4444]/10 p-3 text-[13px] text-[#ef4444] font-medium flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{uploadError}</span>
            </div>
          )}

          {/* Target Namespace */}
          <div>
            <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
              Target Namespace
            </label>
            <input
              type="text"
              value={uploadNs}
              onChange={(e) => setUploadNs(e.target.value)}
              placeholder="e.g. default, media, backups"
              className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6]"
            />
            <span className="text-[12px] text-[#777777] mt-1 block">
              Namespaces logically partition access policies and object keys.
            </span>
          </div>

          {/* File Picker Drag Drop Zone */}
          <div>
            <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
              Source File
            </label>
            <label className="border-2 border-dashed border-[#262626] hover:border-[#3b82f6] rounded-[8px] bg-[#121212] p-6 flex flex-col items-center justify-center cursor-pointer transition-colors">
              <input
                type="file"
                onChange={handleFileChange}
                className="hidden"
              />
              <HardDrive className="w-8 h-8 text-[#8c8c8c] mb-2" />
              <span className="text-[14px] font-medium text-white">
                {uploadFile ? uploadFile.name : 'Click to select a file'}
              </span>
              <span className="text-[12px] text-[#777777] mt-1">
                {uploadFile ? `${formatBytes(uploadFile.size)} · ${uploadFile.type || 'binary'}` : 'Supports any file format up to 5 GB'}
              </span>
            </label>
          </div>

          {/* Key Path */}
          <div>
            <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
              Object Key / Path
            </label>
            <input
              type="text"
              value={uploadKey}
              onChange={(e) => setUploadKey(e.target.value)}
              placeholder="e.g. documents/reports/annual_2026.pdf"
              className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6] font-mono"
            />
          </div>

          {/* MIME Content Type */}
          <div>
            <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
              MIME Media Type
            </label>
            <input
              type="text"
              value={uploadContentType}
              onChange={(e) => setUploadContentType(e.target.value)}
              placeholder="application/octet-stream"
              className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6] font-mono"
            />
          </div>
          </div>

          {/* Form Actions */}
          <div className="p-4 border-t border-[#222222] bg-[#0e0e0e] flex items-center justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={() => setIsUploadOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              isLoading={isUploading}
            >
              Upload Blob
            </Button>
          </div>
        </form>
      </SlideOver>

      {/* Create Namespace Modal */}
      <SlideOver
        isOpen={isNewNsOpen}
        onClose={() => setIsNewNsOpen(false)}
        title="Create Namespace"
        subtitle="Initialize a partition for segregating blob storage objects"
        width="w-[440px] max-w-full"
      >
        <form onSubmit={handleCreateNamespace} className="flex flex-col h-full text-sans">
          <div className="flex-1 p-5 overflow-y-auto space-y-4">
            <div>
            <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
              Namespace Identifier
            </label>
            <input
              type="text"
              value={newNsName}
              onChange={(e) => setNewNsName(e.target.value)}
              placeholder="e.g. media, telemetry, public_assets"
              className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6]"
            />
            <span className="text-[12px] text-[#777777] mt-1 block">
              1-64 characters. Allowed: alphanumeric, '.', '_', '-'.
            </span>
          </div>
          </div>

          <div className="p-4 border-t border-[#222222] bg-[#0e0e0e] flex items-center justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={() => setIsNewNsOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={!newNsName.trim()}
            >
              Create
            </Button>
          </div>
        </form>
      </SlideOver>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={blobToDelete !== null}
        onClose={() => setBlobToDelete(null)}
        onConfirm={handleDeleteBlob}
        title="Delete Stored Object"
        description={
          blobToDelete ? (
            <span>
              Are you sure you want to permanently delete{' '}
              <strong className="text-white font-mono">{blobToDelete.key}</strong> from namespace{' '}
              <strong className="text-white">{blobToDelete.namespace}</strong>? If this is the last reference
              to this content hash, its underlying physical disk shard will be garbage collected.
            </span>
          ) : (
            'Are you sure you want to delete this blob?'
          )
        }
        confirmLabel={isDeleting ? 'Deleting...' : 'Delete Object'}
        variant="danger"
      />
    </div>
  );
}
