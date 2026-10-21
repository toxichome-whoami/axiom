/*
 * Cluster Mesh management dashboard for zero-database peer-to-peer distributed coordination.
 * Owned by: ui/pages
 * Key deps: api/client, lucide-react, DataTable, SlideOver, Button, ConfirmDialog
 * Invariants: Monikers and secrets conform to cryptographic pairing specifications; peer removal requires confirmation.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  api,
  ClusterStatusData,
  PeerNodeRecordApi,
} from '../api/client';
import { DataTable, Column } from '../components/shared/DataTable';
import { SlideOver } from '../components/ui/SlideOver';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { validateCleanName } from './Databases';
import {
  Plus,
  RefreshCw,
  Copy,
  Check,
  Eye,
  EyeOff,
  Edit2,
  AlertTriangle,
  Search,
  Network,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

function formatLastSeen(timestampSecs: number) {
  if (!timestampSecs) return 'Never';
  const nowSecs = Math.floor(Date.now() / 1000);
  const diff = nowSecs - timestampSecs;
  if (diff < 5) return 'Just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

export function Cluster() {
  const [status, setStatus] = useState<ClusterStatusData | null>(null);
  const [peers, setPeers] = useState<PeerNodeRecordApi[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Pagination state (matches Databases.tsx & Keys.tsx)
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Search & Display options toolbar state
  const [searchQuery, setSearchQuery] = useState('');
  const [showDisplayOptions, setShowDisplayOptions] = useState(false);
  const displayOptionsRef = useRef<HTMLDivElement | null>(null);

  // Visible columns map
  const [visibleCols, setVisibleCols] = useState<Record<string, boolean>>({
    status: true,
    moniker: true,
    latency: true,
    lastSeen: true,
    nodeId: true,
    url: true,
  });

  // Local node identity state
  const [showSecret, setShowSecret] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [copiedNodeId, setCopiedNodeId] = useState(false);

  const [isEditingMoniker, setIsEditingMoniker] = useState(false);
  const [editMonikerValue, setEditMonikerValue] = useState('');
  const [isSavingMoniker, setIsSavingMoniker] = useState(false);

  // Connect Peer SlideOver state
  const [isConnectOpen, setIsConnectOpen] = useState(false);
  const [peerUrl, setPeerUrl] = useState('');
  const [peerSecret, setPeerSecret] = useState('');
  const [peerMoniker, setPeerMoniker] = useState('');
  const [showPeerSecret, setShowPeerSecret] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [confirmDiscardConnectOpen, setConfirmDiscardConnectOpen] = useState(false);
  const [confirmDiscardManagePeerOpen, setConfirmDiscardManagePeerOpen] = useState(false);

  // Deletion confirmation state
  const [peerToDelete, setPeerToDelete] = useState<PeerNodeRecordApi | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Manage Peer SlideOver state (matches Databases.tsx & Keys.tsx manage panel)
  const [selectedPeer, setSelectedPeer] = useState<PeerNodeRecordApi | null>(null);
  const [isPeerPanelOpen, setIsPeerPanelOpen] = useState(false);
  const [peerTab, setPeerTab] = useState<'connection' | 'danger'>('connection');
  const [peerEditMoniker, setPeerEditMoniker] = useState('');
  const [peerEditUrl, setPeerEditUrl] = useState('');
  const [peerEditSecret, setPeerEditSecret] = useState('');
  const [showPeerEditSecret, setShowPeerEditSecret] = useState(false);
  const [isSavingPeer, setIsSavingPeer] = useState(false);
  const [isPingingPeer, setIsPingingPeer] = useState(false);
  const [peerPanelError, setPeerPanelError] = useState<string | null>(null);
  const [peerPanelSuccess, setPeerPanelSuccess] = useState<string | null>(null);
  const [copiedPeerNodeId, setCopiedPeerNodeId] = useState(false);

  // Click-outside listener for display options dropdown
  useEffect(() => {
    if (!showDisplayOptions) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (displayOptionsRef.current && !displayOptionsRef.current.contains(target)) {
        setShowDisplayOptions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDisplayOptions]);

  // Reset pagination on search query change
  useEffect(() => {
    setPage(1);
  }, [searchQuery]);

  const fetchClusterData = useCallback(async () => {
    try {
      setErrorMessage(null);
      const [statusRes, peersRes] = await Promise.all([
        api.getClusterStatus(),
        api.listClusterPeers(),
      ]);
      setStatus(statusRes);
      setPeers(peersRes.peers || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to query cluster status';
      setErrorMessage(msg);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchClusterData();
    const interval = setInterval(fetchClusterData, 15000);
    return () => clearInterval(interval);
  }, [fetchClusterData]);

  const handleManualRefresh = () => {
    setIsRefreshing(true);
    fetchClusterData();
  };

  const handleCopySecret = () => {
    if (!status?.cluster_secret) return;
    navigator.clipboard.writeText(status.cluster_secret);
    setCopiedSecret(true);
    setTimeout(() => setCopiedSecret(false), 2000);
  };

  const handleCopyNodeId = () => {
    if (!status?.node_id) return;
    navigator.clipboard.writeText(status.node_id);
    setCopiedNodeId(true);
    setTimeout(() => setCopiedNodeId(false), 2000);
  };

  const editMonikerValidation = validateCleanName(editMonikerValue);
  const peerMonikerValidation = peerMoniker.trim().length > 0 ? validateCleanName(peerMoniker) : { valid: true };
  const peerEditMonikerValidation = validateCleanName(peerEditMoniker);

  const isPeerChanged = Boolean(
    selectedPeer &&
      (peerEditMoniker.trim() !== selectedPeer.moniker ||
        peerEditUrl.trim() !== selectedPeer.url ||
        peerEditSecret.trim().length > 0)
  );

  const isPeerEditUrlValid = Boolean(
    peerEditUrl.trim().length > 0 &&
      (peerEditUrl.trim().startsWith('http://') || peerEditUrl.trim().startsWith('https://'))
  );

  const canSavePeer = Boolean(
    isPeerChanged &&
      peerEditMoniker.trim().length > 0 &&
      peerEditMonikerValidation.valid &&
      isPeerEditUrlValid &&
      !isSavingPeer
  );

  const isPeerUrlValid = Boolean(
    peerUrl.trim().length > 0 &&
      (peerUrl.trim().startsWith('http://') || peerUrl.trim().startsWith('https://'))
  );

  const isConnectDirty = Boolean(
    peerUrl.trim().length > 0 ||
    peerSecret.trim().length > 0 ||
    peerMoniker.trim().length > 0
  );

  const canConnectPeer = Boolean(
    !isConnecting &&
    peerUrl.trim().length > 0 &&
    isPeerUrlValid &&
    peerSecret.trim().length > 0 &&
    (peerMoniker.trim().length === 0 || peerMonikerValidation.valid)
  );

  function requestCloseConnect() {
    if (isConnectDirty) {
      setConfirmDiscardConnectOpen(true);
    } else {
      forceCloseConnect();
    }
  }

  function forceCloseConnect() {
    setConfirmDiscardConnectOpen(false);
    setIsConnectOpen(false);
    setPeerUrl('');
    setPeerSecret('');
    setPeerMoniker('');
    setConnectError(null);
  }

  function requestCloseManagePeer() {
    if (peerTab === 'connection' && isPeerChanged) {
      setConfirmDiscardManagePeerOpen(true);
    } else {
      forceCloseManagePeer();
    }
  }

  function forceCloseManagePeer() {
    setConfirmDiscardManagePeerOpen(false);
    setIsPeerPanelOpen(false);
    setPeerTab('connection');
    setPeerPanelError(null);
    setPeerPanelSuccess(null);
  }

  const handleSaveMoniker = async () => {
    const trimmed = editMonikerValue.trim();
    if (!trimmed || !editMonikerValidation.valid) return;
    try {
      setIsSavingMoniker(true);
      await api.updateClusterMoniker(trimmed);
      setStatus((prev) => (prev ? { ...prev, moniker: trimmed } : null));
      setIsEditingMoniker(false);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to update moniker');
    } finally {
      setIsSavingMoniker(false);
    }
  };

  const handleConnectPeerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setConnectError(null);

    const trimmedUrl = peerUrl.trim();
    const trimmedSecret = peerSecret.trim();

    if (!trimmedUrl) {
      setConnectError('Peer advertise URL is required.');
      return;
    }
    if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
      setConnectError('URL must start with http:// or https://');
      return;
    }
    if (!trimmedSecret) {
      setConnectError('Cluster secret or pairing token is required.');
      return;
    }
    if (peerMoniker.trim().length > 0 && !peerMonikerValidation.valid) {
      setConnectError(peerMonikerValidation.error || 'Invalid moniker format.');
      return;
    }

    try {
      setIsConnecting(true);
      await api.connectClusterPeer({
        url: trimmedUrl,
        cluster_secret: trimmedSecret,
        moniker: peerMoniker.trim() || undefined,
      });
      setIsConnectOpen(false);
      setPeerUrl('');
      setPeerSecret('');
      setPeerMoniker('');
      fetchClusterData();
    } catch (err: unknown) {
      setConnectError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleConfirmRemovePeer = async () => {
    if (!peerToDelete) return;
    try {
      setIsDeleting(true);
      await api.removeClusterPeer(peerToDelete.node_id);
      setPeerToDelete(null);
      setIsPeerPanelOpen(false);
      fetchClusterData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to remove peer');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleOpenPeerPanel = (peer: PeerNodeRecordApi) => {
    setSelectedPeer(peer);
    setPeerEditMoniker(peer.moniker);
    setPeerEditUrl(peer.url);
    setPeerEditSecret('');
    setShowPeerEditSecret(false);
    setPeerPanelError(null);
    setPeerPanelSuccess(null);
    setCopiedPeerNodeId(false);
    setPeerTab('connection');
    setIsPeerPanelOpen(true);
  };

  const handleCopyPeerNodeId = () => {
    if (!selectedPeer?.node_id) return;
    navigator.clipboard.writeText(selectedPeer.node_id);
    setCopiedPeerNodeId(true);
    setTimeout(() => setCopiedPeerNodeId(false), 2000);
  };

  const handleSavePeerUpdates = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPeer || !canSavePeer) return;
    const trimmedMoniker = peerEditMoniker.trim();
    const trimmedUrl = peerEditUrl.trim();

    if (!trimmedMoniker || !peerEditMonikerValidation.valid) {
      setPeerPanelError(peerEditMonikerValidation.error || 'Invalid moniker format.');
      return;
    }
    if (!trimmedUrl) {
      setPeerPanelError('Advertise URL cannot be empty.');
      return;
    }
    if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
      setPeerPanelError('URL must start with http:// or https://');
      return;
    }

    try {
      setIsSavingPeer(true);
      setPeerPanelError(null);
      setPeerPanelSuccess(null);
      const payload: { moniker: string; url: string; cluster_secret?: string } = {
        moniker: trimmedMoniker,
        url: trimmedUrl,
      };
      if (peerEditSecret.trim()) {
        payload.cluster_secret = peerEditSecret.trim();
      }
      const updated = await api.updateClusterPeer(selectedPeer.node_id, payload);
      setPeers((prev) =>
        prev.map((p) => (p.node_id === updated.node_id ? updated : p))
      );
      setPeerEditSecret('');
      setShowPeerEditSecret(false);
      setIsPeerPanelOpen(false);
      setSelectedPeer(null);
      fetchClusterData();
    } catch (err: unknown) {
      setPeerPanelError(err instanceof Error ? err.message : 'Failed to update peer');
    } finally {
      setIsSavingPeer(false);
    }
  };

  const handlePingPeer = async () => {
    if (!selectedPeer) return;
    try {
      setIsPingingPeer(true);
      setPeerPanelError(null);
      setPeerPanelSuccess(null);
      const updated = await api.pingClusterPeer(selectedPeer.node_id);
      setSelectedPeer(updated);
      setPeers((prev) =>
        prev.map((p) => (p.node_id === updated.node_id ? updated : p))
      );
      if (updated.status === 'connected') {
        setPeerPanelSuccess(`Ping responded in ${updated.last_ping_ms} ms`);
      } else {
        setPeerPanelError(`Peer unreachable (${updated.last_ping_ms} ms)`);
      }
      setTimeout(() => {
        setPeerPanelSuccess(null);
      }, 3500);
    } catch (err: unknown) {
      setPeerPanelError(err instanceof Error ? err.message : 'Ping failed');
    } finally {
      setIsPingingPeer(false);
    }
  };

  const displayColumnOptions = [
    { id: 'status', label: 'Status' },
    { id: 'moniker', label: 'Moniker' },
    { id: 'latency', label: 'Ping Latency' },
    { id: 'lastSeen', label: 'Last Seen' },
    { id: 'nodeId', label: 'Node ID' },
    { id: 'url', label: 'Advertise URL' },
  ];

  const toggleColVisibility = (colId: string) => {
    setVisibleCols((prev) => ({ ...prev, [colId]: !prev[colId] }));
  };

  const handleResetColumns = () => {
    setVisibleCols({
      status: true,
      moniker: true,
      latency: true,
      lastSeen: true,
      nodeId: true,
      url: true,
    });
  };

  // Filter peers by search term
  const filteredPeers = useMemo(() => {
    let list = peers;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (p) =>
          p.moniker.toLowerCase().includes(q) ||
          p.url.toLowerCase().includes(q) ||
          p.node_id.toLowerCase().includes(q) ||
          p.status.toLowerCase().includes(q)
      );
    }
    return list;
  }, [peers, searchQuery]);

  // Standardized left-aligned data columns with Ping Latency & Last Seen placed on left side
  const columns: Column<PeerNodeRecordApi>[] = useMemo(
    () => [
      {
        id: 'status',
        header: 'Status',
        accessorKey: 'status',
        width: 125,
        isResizable: true,
        className: 'pl-4 pr-3',
        cell: (peer) => {
          const label =
            peer.status === 'connected'
              ? 'Connected'
              : peer.status === 'unreachable'
              ? 'Unreachable'
              : 'Pending';
          const dot =
            peer.status === 'connected'
              ? 'bg-[#30a46c]'
              : peer.status === 'unreachable'
              ? 'bg-[#e5484d]'
              : 'bg-[#f59e0b]';
          return (
            <div className="flex items-center gap-2 text-[14px] text-white font-normal truncate whitespace-nowrap" title={label}>
              <span className={`size-1.5 rounded-full shrink-0 ${dot}`} />
              <span className="truncate whitespace-nowrap">{label}</span>
            </div>
          );
        },
      },
      {
        id: 'moniker',
        header: 'Moniker',
        accessorKey: 'moniker',
        isSortable: true,
        isResizable: true,
        width: 190,
        className: 'px-3',
        cell: (peer) => (
          <div className="flex items-center gap-2.5 min-w-0">
            <Network className="w-4 h-4 text-[#8c8c8c] shrink-0" />
            <span
              className="font-medium text-white text-[14px] truncate whitespace-nowrap"
              title={peer.moniker}
            >
              {peer.moniker}
            </span>
          </div>
        ),
      },
      {
        id: 'latency',
        header: 'Ping Latency',
        accessorKey: 'last_ping_ms',
        width: 125,
        isResizable: true,
        className: 'px-3',
        cell: (peer) =>
          peer.status === 'connected' ? (
            <span
              className={`tabular-nums text-[13px] font-normal truncate whitespace-nowrap block ${
                peer.last_ping_ms < 50 ? 'text-[#30a46c]' : 'text-[#f59e0b]'
              }`}
              title={`${peer.last_ping_ms} ms`}
            >
              {peer.last_ping_ms} ms
            </span>
          ) : (
            <span className="text-[13px] text-[#666666] font-normal truncate whitespace-nowrap block">—</span>
          ),
      },
      {
        id: 'lastSeen',
        header: 'Last Seen',
        accessorKey: 'last_seen_at',
        width: 125,
        isResizable: true,
        className: 'px-3',
        cell: (peer) => (
          <span
            className="tabular-nums text-[13px] text-[#8c8c8c] font-normal truncate whitespace-nowrap block"
            title={formatLastSeen(peer.last_seen_at)}
          >
            {formatLastSeen(peer.last_seen_at)}
          </span>
        ),
      },
      {
        id: 'nodeId',
        header: 'Node ID',
        accessorKey: 'node_id',
        width: 190,
        isResizable: true,
        className: 'px-3',
        cell: (peer) => (
          <span
            className="text-[13px] text-[#cccccc] truncate whitespace-nowrap block font-sans"
            title={peer.node_id}
          >
            {peer.node_id}
          </span>
        ),
      },
      {
        id: 'url',
        header: 'Advertise URL',
        accessorKey: 'url',
        width: 250,
        isResizable: true,
        className: 'px-3',
        cell: (peer) => (
          <span
            className="text-[13px] text-[#8c8c8c] truncate whitespace-nowrap block font-sans"
            title={peer.url}
          >
            {peer.url}
          </span>
        ),
      },
      {
        id: 'actions',
        header: <span className="sr-only">Actions</span>,
        isFlex: true,
        headerClassName: 'justify-end pr-4 text-right',
        className: 'pl-3 pr-4 justify-end',
        cell: (peer) => (
          <div className="flex items-center justify-end w-full">
            <button
              type="button"
              onClick={() => handleOpenPeerPanel(peer)}
              className="inline-flex items-center justify-center h-7 px-3 rounded-[6px] text-[13px] font-medium leading-none text-[#8c8c8c] hover:text-white bg-transparent hover:bg-[#1a1a1a] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer shrink-0"
            >
              Manage
            </button>
          </div>
        ),
      },
    ],
    []
  );

  const activeColumns = useMemo(() => {
    const visible = columns.filter((col) => col.id === 'actions' || visibleCols[col.id] !== false);
    const lastDataId = [...visible].reverse().find((c) => c.id !== 'actions')?.id;
    return visible.map((col) => ({
      ...col,
      isResizable: col.id !== 'actions' && col.id !== lastDataId && Boolean(col.isResizable),
    }));
  }, [columns, visibleCols]);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-[16px] font-medium text-white tracking-tight">Cluster Mesh</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            title="Refresh cluster status"
            aria-label="Refresh cluster status"
            className="flex items-center justify-center h-8 w-8 text-[#8c8c8c] hover:text-white rounded-[8px] bg-[#0c0c0c] hover:bg-[#141414] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin opacity-50' : ''}`} />
          </button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setConnectError(null);
              setIsConnectOpen(true);
            }}
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            Connect Peer
          </Button>
        </div>
      </div>

      {errorMessage && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-[#2a1113] border border-[#5c1d24] text-[#f87171] text-[13px]">
          <AlertTriangle className="w-4 h-4 shrink-0 text-[#ef4444]" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Local Node Identity & Cluster Credentials */}
      <div className="rounded-lg border border-[#262626] bg-[#0e0e0e]">
        <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[#222222]">
          <div className="px-4 py-3.5 min-w-0">
            <span className="block text-[12px] text-[#8c8c8c] font-medium mb-1.5">Node Moniker</span>
            {isEditingMoniker ? (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={editMonikerValue}
                    onChange={(e) => setEditMonikerValue(e.target.value.toLowerCase().replace(/\s+/g, '_'))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && editMonikerValidation.valid && !isSavingMoniker) {
                        handleSaveMoniker();
                      }
                    }}
                    placeholder="e.g. axiom_node_01"
                    className={`h-8 min-w-0 flex-1 rounded-[6px] border px-2.5 text-[13px] text-white focus:outline-none lowercase transition-colors font-sans ${
                      editMonikerValue.trim().length > 0 && !editMonikerValidation.valid
                        ? 'border-[#e5484d] bg-[#1a0f0f] focus:border-[#e5484d] focus:ring-1 focus:ring-[#e5484d]/40'
                        : 'border-[#262626] bg-[#121212] focus:border-[#3b82f6]'
                    }`}
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={handleSaveMoniker}
                    disabled={
                      isSavingMoniker ||
                      !editMonikerValue.trim() ||
                      !editMonikerValidation.valid ||
                      editMonikerValue.trim() === status?.moniker
                    }
                    className="h-8 px-2.5 rounded-[6px] bg-[#2563eb] text-[12px] font-medium text-white hover:bg-[#1d4ed8] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsEditingMoniker(false)}
                    className="h-8 px-2.5 rounded-[6px] border border-[#262626] text-[12px] text-[#cccccc] hover:text-white hover:border-[#383838] transition-colors cursor-pointer shrink-0"
                  >
                    Cancel
                  </button>
                </div>
                {editMonikerValue.trim().length > 0 && !editMonikerValidation.valid && (
                  <div className="flex items-center gap-1.5 text-[11px] text-[#e5484d]">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{editMonikerValidation.error}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className="text-[14px] font-medium text-white truncate"
                  title={status?.moniker || undefined}
                >
                  {status?.moniker || '—'}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setEditMonikerValue(status?.moniker || '');
                    setIsEditingMoniker(true);
                  }}
                  className="flex items-center justify-center h-6 w-6 rounded-[6px] text-[#8c8c8c] hover:text-white hover:bg-[#1a1a1a] transition-colors cursor-pointer shrink-0"
                  title="Edit node moniker"
                  aria-label="Edit node moniker"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          <div className="px-4 py-3.5 min-w-0">
            <span className="block text-[12px] text-[#8c8c8c] font-medium mb-1.5">Node ID</span>
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className="text-[13px] text-[#cccccc] truncate font-sans"
                title={status?.node_id || undefined}
              >
                {status?.node_id || '—'}
              </span>
              <button
                type="button"
                onClick={handleCopyNodeId}
                className="flex items-center justify-center h-6 w-6 rounded-[6px] text-[#8c8c8c] hover:text-white hover:bg-[#1a1a1a] transition-colors cursor-pointer shrink-0"
                title="Copy Node ID"
                aria-label="Copy Node ID"
              >
                {copiedNodeId ? (
                  <Check className="w-3.5 h-3.5 text-[#30a46c]" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>

          <div className="px-4 py-3.5 min-w-0">
            <span className="block text-[12px] text-[#8c8c8c] font-medium mb-1.5">Connected Peers</span>
            <div className="flex items-baseline gap-1.5">
              <span className="tabular-nums text-[14px] font-medium text-white">
                {status?.connected_peers ?? 0}
              </span>
              <span className="text-[12px] text-[#8c8c8c]">
                of {status?.total_peers ?? 0} known
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 border-t border-[#222222] px-4 py-3">
          <div className="sm:w-[200px] shrink-0">
            <span className="block text-[12px] text-[#8c8c8c] font-medium">Cluster Secret</span>
            <span className="block text-[12px] text-[#666666]">Required to pair a remote node</span>
          </div>
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="flex items-center h-8 flex-1 min-w-0 rounded-[6px] border border-[#262626] bg-[#121212] px-2.5 font-mono text-[12px] text-[#cccccc] truncate select-all">
              {showSecret
                ? status?.cluster_secret || '—'
                : '••••••••••••••••••••••••••••••••••••••••'}
            </div>
            <button
              type="button"
              onClick={() => setShowSecret(!showSecret)}
              className="flex items-center justify-center h-8 w-8 rounded-[6px] border border-[#262626] bg-[#0c0c0c] text-[#8c8c8c] hover:text-white hover:border-[#383838] transition-colors cursor-pointer shrink-0"
              title={showSecret ? 'Hide secret' : 'Show secret'}
              aria-label={showSecret ? 'Hide cluster secret' : 'Show cluster secret'}
            >
              {showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
            <button
              type="button"
              onClick={handleCopySecret}
              className="flex items-center justify-center h-8 w-8 rounded-[6px] border border-[#262626] bg-[#0c0c0c] text-[#8c8c8c] hover:text-white hover:border-[#383838] transition-colors cursor-pointer shrink-0"
              title="Copy cluster secret"
              aria-label="Copy cluster secret"
            >
              {copiedSecret ? (
                <Check className="w-3.5 h-3.5 text-[#30a46c]" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Toolbar: Search & Display Options (Identical to Databases.tsx / Keys.tsx) */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8c8c8c]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search peers by moniker, node ID, or URL..."
            className="h-9 w-full rounded-[8px] border border-[#262626] bg-[#141414] pl-9 pr-3 text-[14px] text-white placeholder-[#555555] focus:outline-none focus:border-[#383838] transition-colors font-sans"
          />
        </div>

        <div className="flex items-center gap-2">
          {/* Display options dropdown */}
          <div className="relative" ref={displayOptionsRef}>
            <button
              type="button"
              onClick={() => setShowDisplayOptions((prev) => !prev)}
              className={`flex items-center gap-1.5 h-9 px-3 rounded-[8px] bg-transparent border text-[14px] font-medium transition-colors cursor-pointer shrink-0 font-sans ${
                showDisplayOptions
                  ? 'border-[#444444] text-white bg-[#141414]'
                  : 'border-[#262626] text-white hover:bg-[#141414] hover:border-[#383838]'
              }`}
              title="Toggle visible table columns"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 256 256" className="text-[#8c8c8c] shrink-0">
                <path d="M222.87,74.56,134.87,23.75a16,16,0,0,0-15.74,0L31.13,74.56A16,16,0,0,0,23.26,88.4v101.6a16,16,0,0,0,7.87,13.84l88,50.81a16,16,0,0,0,15.74,0l88-50.81a16,16,0,0,0,7.87-13.84V88.4A16,16,0,0,0,222.87,74.56ZM127,160a32,32,0,1,1,32-32A32,32,0,0,1,127,160Z" />
              </svg>
              <span>Display options</span>
            </button>

            {showDisplayOptions && (
              <div className="absolute right-0 top-[calc(100%+4px)] w-52 rounded-[8px] bg-[#0c0c0c] border border-[#262626] shadow-2xl p-1 z-50 select-none font-sans animate-in fade-in duration-100">
                {displayColumnOptions.map((col) => {
                  const isVisible = visibleCols[col.id] !== false;
                  return (
                    <button
                      key={col.id}
                      type="button"
                      onClick={() => toggleColVisibility(col.id)}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-[6px] text-[14px] text-[#cccccc] hover:text-white hover:bg-[#141414] transition-colors cursor-pointer font-sans"
                    >
                      <span className={isVisible ? 'text-white font-medium' : 'text-[#8c8c8c]'}>
                        {col.label}
                      </span>
                      {isVisible && (
                        <Check className="w-3.5 h-3.5 text-[#3b82f6] shrink-0" />
                      )}
                    </button>
                  );
                })}
                <div className="-mx-1 my-1 border-t border-[#222222]" />
                <button
                  type="button"
                  onClick={handleResetColumns}
                  className="w-full text-left px-3 py-2 rounded-[6px] text-[13px] text-[#8c8c8c] hover:text-white hover:bg-[#141414] transition-colors cursor-pointer font-sans"
                >
                  Reset columns
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Peers DataTable with Standard Pagination */}
      <DataTable
        columns={activeColumns}
        data={filteredPeers}
        keyExtractor={(peer) => peer.node_id}
        isLoading={isLoading}
        ariaLabel="Cluster Peers Table"
        emptyMessage="No cluster peers connected. Connect a peer to join the mesh."
        pagination={{
          page,
          pageSize,
          totalCount: filteredPeers.length,
          onPageChange: setPage,
          onPageSizeChange: (newSize) => {
            setPageSize(newSize);
            setPage(1);
          },
          pageSizeOptions: [10, 25, 50, 100],
        }}
      />

      {/* Connect Peer SlideOver (Matches Databases.tsx Attach Database style) */}
      <SlideOver
        isOpen={isConnectOpen}
        onClose={requestCloseConnect}
        title="Connect Peer"
        subtitle="Pair with another Axiom node using its advertise URL and cluster secret"
      >
        <form onSubmit={handleConnectPeerSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 p-5 overflow-y-auto space-y-4">
            <div>
              <h3 className="text-[16px] font-medium text-white tracking-tight">Peer Configuration</h3>
              <p className="text-[13px] text-[#8c8c8c] mt-0.5">
                Provide the remote endpoint URL, secret key, and optional moniker.
              </p>
            </div>

            {connectError && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-[#2a1113] border border-[#5c1d24] text-[#f87171] text-[13px]">
                <AlertTriangle className="w-4 h-4 shrink-0 text-[#ef4444]" />
                <span>{connectError}</span>
              </div>
            )}

            <div>
              <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                Remote Peer URL <span className="text-[#e5484d]">*</span>
              </label>
              <input
                type="text"
                placeholder="https://peer.example.com:4500"
                value={peerUrl}
                onChange={(e) => setPeerUrl(e.target.value)}
                className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white placeholder-[#555555] focus:outline-none focus:border-[#3b82f6] font-sans transition-colors"
                required
              />
              <span className="block text-[12px] text-[#666666] mt-1">
                Reachable HTTP or HTTPS base address of the remote Axiom instance.
              </span>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-[13px] font-medium text-[#cccccc]">
                  Cluster Secret <span className="text-[#e5484d]">*</span>
                </label>
              </div>
              <div className="relative">
                <input
                  type={showPeerSecret ? 'text' : 'password'}
                  placeholder="Paste the remote node's cluster secret"
                  value={peerSecret}
                  onChange={(e) => setPeerSecret(e.target.value)}
                  className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] pl-3 pr-10 text-[14px] text-white placeholder-[#555555] focus:outline-none focus:border-[#3b82f6] font-sans transition-colors"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPeerSecret(!showPeerSecret)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#777777] hover:text-[#cccccc] transition-colors cursor-pointer"
                  tabIndex={-1}
                  aria-label={showPeerSecret ? 'Hide secret' : 'Show secret'}
                >
                  {showPeerSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              <span className="block text-[12px] text-[#666666] mt-1">
                Copied from the remote node&apos;s cluster mesh dashboard.
              </span>
            </div>

            <div>
              <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                Custom Moniker <span className="text-[#666666] font-normal">(optional)</span>
              </label>
              <input
                type="text"
                placeholder="e.g. london_edge_01"
                value={peerMoniker}
                onChange={(e) => setPeerMoniker(e.target.value.toLowerCase().replace(/\s+/g, '_'))}
                className={`h-9 w-full rounded-[6px] border px-3 text-[14px] text-white placeholder-[#555555] focus:outline-none font-sans lowercase transition-colors ${
                  peerMoniker.trim().length > 0 && !peerMonikerValidation.valid
                    ? 'border-[#e5484d] bg-[#1a0f0f] focus:border-[#e5484d] focus:ring-1 focus:ring-[#e5484d]/40'
                    : 'border-[#262626] bg-[#121212] focus:border-[#3b82f6]'
                }`}
              />
              {peerMoniker.trim().length > 0 && !peerMonikerValidation.valid ? (
                <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-[#e5484d]">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{peerMonikerValidation.error}</span>
                </div>
              ) : (
                <span className="block text-[12px] text-[#666666] mt-1">
                  Leave blank to automatically inherit the peer&apos;s advertised node name.
                </span>
              )}
            </div>
          </div>

          <div className="p-4 border-t border-[#222222] bg-[#0e0e0e] flex items-center justify-end gap-2.5 font-sans">
            <button
              type="button"
              onClick={requestCloseConnect}
              className="inline-flex items-center justify-center h-9 px-4 rounded-[8px] text-[14px] font-medium text-[#cccccc] hover:text-white bg-transparent hover:bg-[#161616] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer font-sans"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canConnectPeer}
              className="group relative flex shrink-0 items-center justify-center h-9 px-4 rounded-[8px] font-medium text-white shadow-xs outline-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed overflow-hidden ring-1 ring-[#1d4ed8] bg-[#2563eb] font-sans text-[14px]"
            >
              <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-[#3b82f6] to-[#2563eb] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]" />
              <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black opacity-0 group-hover:opacity-15 transition-opacity duration-200" />
              <span className="relative flex items-center gap-1.5 font-sans">
                {isConnecting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Pairing Node...</span>
                  </>
                ) : (
                  <span>Connect Peer</span>
                )}
              </span>
            </button>
          </div>
        </form>
      </SlideOver>

      {/* Manage Peer SlideOver (Matches Databases.tsx & Keys.tsx manage panel) */}
      <SlideOver
        isOpen={isPeerPanelOpen}
        onClose={requestCloseManagePeer}
        title={selectedPeer?.moniker ?? 'Peer Node'}
        subtitle={selectedPeer ? `${selectedPeer.url} · ${selectedPeer.status}` : ''}
      >
        {/* Tab bar (Segmented control matching Databases & Keys dashboard) */}
        <div className="px-5 py-3 border-b border-[#222222] bg-[#0e0e0e]">
          <div className="inline-flex items-center p-0.5 rounded-[8px] bg-transparent border border-[#262626]">
            <button
              type="button"
              onClick={() => setPeerTab('connection')}
              className={`flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[14px] font-medium transition-colors duration-75 cursor-pointer font-sans outline-none focus:outline-none border ${
                peerTab === 'connection'
                  ? 'bg-[#161616] text-white border-[#333333]'
                  : 'text-[#8c8c8c] hover:text-white hover:bg-[#141414] border-transparent'
              }`}
            >
              <span>Connection</span>
            </button>
            <button
              type="button"
              onClick={() => setPeerTab('danger')}
              className={`flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[14px] font-medium transition-colors duration-75 cursor-pointer font-sans outline-none focus:outline-none border ${
                peerTab === 'danger'
                  ? 'bg-[#161616] text-white border-[#333333]'
                  : 'text-[#8c8c8c] hover:text-white hover:bg-[#141414] border-transparent'
              }`}
            >
              <span>Danger</span>
            </button>
          </div>
        </div>

        {selectedPeer && peerTab === 'connection' && (
          <form onSubmit={handleSavePeerUpdates} className="flex flex-col flex-1 min-h-0">
            <div className="flex-1 p-5 overflow-y-auto space-y-5">
              {/* Header Description */}
              <div>
                <h3 className="text-[16px] font-medium text-white tracking-tight">Peer Configuration</h3>
                <p className="text-[13px] text-[#8c8c8c] mt-0.5">
                  Manage node moniker, advertise endpoint, and live connection health.
                </p>
              </div>

              {/* Feedback banners */}
              {peerPanelError && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-[#2a1113] border border-[#5c1d24] text-[#f87171] text-[13px]">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-[#ef4444]" />
                  <span>{peerPanelError}</span>
                </div>
              )}
              {peerPanelSuccess && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-[#0e2a1b] border border-[#1b5e36] text-[#4ade80] text-[13px]">
                  <Check className="w-4 h-4 shrink-0 text-[#30a46c]" />
                  <span>{peerPanelSuccess}</span>
                </div>
              )}

              {/* Live Connection & Health Telemetry Card with edge-to-edge dividing line and normal text transform */}
              <div className="rounded-[6px] border border-[#262626] bg-[#141414] divide-y divide-[#222222]">
                <div className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`size-2 rounded-full shrink-0 ${
                        selectedPeer.status === 'connected'
                          ? 'bg-[#30a46c]'
                          : selectedPeer.status === 'unreachable'
                          ? 'bg-[#e5484d]'
                          : 'bg-[#f59e0b]'
                      }`}
                    />
                    <span className="text-[13px] font-medium text-white">
                      {selectedPeer.status === 'connected'
                        ? 'Connected'
                        : selectedPeer.status === 'unreachable'
                        ? 'Unreachable'
                        : 'Pending'}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={handlePingPeer}
                    disabled={isPingingPeer}
                    className="h-8 px-3 rounded-[6px] text-[13px] font-medium border border-[#262626] bg-[#161616] text-[#cccccc] hover:text-white hover:border-[#383838] transition-colors inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 font-sans"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isPingingPeer ? 'animate-spin text-[#3b82f6]' : ''}`} />
                    <span>{isPingingPeer ? 'Testing Ping...' : 'Test Connection Ping'}</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3 p-4">
                  <div>
                    <span className="block text-[12px] text-[#8c8c8c] font-medium mb-1">
                      Latency
                    </span>
                    <span
                      className={`tabular-nums text-[13px] font-medium ${
                        selectedPeer.status === 'connected'
                          ? selectedPeer.last_ping_ms < 50
                            ? 'text-[#30a46c]'
                            : selectedPeer.last_ping_ms < 200
                            ? 'text-[#f59e0b]'
                            : 'text-[#ef4444]'
                          : 'text-[#666666]'
                      }`}
                    >
                      {selectedPeer.status === 'connected' ? `${selectedPeer.last_ping_ms} ms` : '—'}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[12px] text-[#8c8c8c] font-medium mb-1">
                      Last Seen
                    </span>
                    <span className="tabular-nums text-[13px] text-[#8c8c8c]">
                      {formatLastSeen(selectedPeer.last_seen_at)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Technical Node Identity Card */}
              <div className="space-y-2">
                <span className="block text-[12px] font-medium text-[#cccccc]">
                  Node Identity
                </span>
                <div className="rounded-[6px] border border-[#262626] bg-[#121212] divide-y divide-[#1e1e1e]">
                  <div className="flex items-center justify-between p-3">
                    <span className="text-[13px] text-[#8c8c8c]">Node ID</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] text-white select-all font-sans">
                        {selectedPeer.node_id}
                      </span>
                      <button
                        type="button"
                        onClick={handleCopyPeerNodeId}
                        className="flex items-center justify-center h-6 w-6 rounded text-[#8c8c8c] hover:text-white hover:bg-[#1a1a1a] transition-colors cursor-pointer"
                        title="Copy Node ID"
                        aria-label="Copy Node ID"
                      >
                        {copiedPeerNodeId ? (
                          <Check className="w-3.5 h-3.5 text-[#30a46c]" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between p-3">
                    <span className="text-[13px] text-[#8c8c8c]">Pairing Date</span>
                    <span className="text-[13px] text-[#cccccc] tabular-nums font-sans">
                      {selectedPeer.created_at ? new Date(selectedPeer.created_at * 1000).toLocaleString() : '—'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Configuration Inputs */}
              <div className="space-y-3.5">
                <div>
                  <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                    Peer Moniker (Alias) <span className="text-[#e5484d]">*</span>
                  </label>
                  <input
                    type="text"
                    value={peerEditMoniker}
                    onChange={(e) => setPeerEditMoniker(e.target.value.toLowerCase().replace(/\s+/g, '_'))}
                    placeholder="e.g. london_edge_01"
                    className={`h-9 w-full rounded-[6px] border px-3 text-[14px] text-white focus:outline-none font-sans lowercase transition-colors ${
                      peerEditMoniker.trim().length > 0 && !peerEditMonikerValidation.valid
                        ? 'border-[#e5484d] bg-[#1a0f0f] focus:border-[#e5484d] focus:ring-1 focus:ring-[#e5484d]/40'
                        : 'border-[#262626] bg-[#121212] focus:border-[#3b82f6]'
                    }`}
                    required
                  />
                  {peerEditMoniker.trim().length > 0 && !peerEditMonikerValidation.valid ? (
                    <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-[#e5484d]">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>{peerEditMonikerValidation.error}</span>
                    </div>
                  ) : (
                    <p className="mt-1.5 text-[12px] text-[#737373]">
                      Lowercase alphanumeric with hyphens or underscores (e.g. <span className="text-[#a3a3a3]">london_edge_01</span>).
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                    Advertise URL <span className="text-[#e5484d]">*</span>
                  </label>
                  <input
                    type="text"
                    value={peerEditUrl}
                    onChange={(e) => setPeerEditUrl(e.target.value)}
                    className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6] font-sans transition-colors"
                    required
                  />
                  <p className="mt-1.5 text-[12px] text-[#737373]">
                    Direct HTTP/HTTPS address used by other nodes to dispatch heartbeats and security events.
                  </p>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-[13px] font-medium text-[#cccccc]">
                      Cluster Secret <span className="text-[11px] font-normal text-[#888888]">(Authentication)</span>
                    </label>
                    <span className="text-[11px] text-[#666666]">Optional</span>
                  </div>
                  <div className="relative">
                    <input
                      type={showPeerEditSecret ? 'text' : 'password'}
                      placeholder="Leave blank to keep existing secret"
                      value={peerEditSecret}
                      onChange={(e) => setPeerEditSecret(e.target.value)}
                      className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] pl-3 pr-10 text-[14px] text-white placeholder-[#555555] focus:outline-none focus:border-[#3b82f6] font-sans transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPeerEditSecret(!showPeerEditSecret)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#777777] hover:text-[#cccccc] transition-colors cursor-pointer"
                      tabIndex={-1}
                      aria-label={showPeerEditSecret ? 'Hide secret' : 'Show secret'}
                    >
                      {showPeerEditSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <p className="mt-1.5 text-[12px] text-[#737373]">
                    Leave blank to keep existing paired credentials. Enter a new secret if the remote node was re-keyed or rotated.
                  </p>
                </div>
              </div>
            </div>

            {/* Footer matching Databases & Keys */}
            <div className="p-4 border-t border-[#222222] bg-[#0e0e0e] flex items-center justify-end gap-2.5 font-sans">
              <button
                type="button"
                onClick={requestCloseManagePeer}
                className="inline-flex items-center justify-center h-9 px-4 rounded-[8px] text-[14px] font-medium text-[#cccccc] hover:text-white bg-transparent hover:bg-[#161616] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer font-sans"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSavePeer || isSavingPeer}
                className="group relative flex shrink-0 items-center justify-center h-9 px-4 rounded-[8px] font-medium text-white shadow-xs outline-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed overflow-hidden ring-1 ring-[#1d4ed8] bg-[#2563eb] font-sans text-[14px]"
              >
                <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-[#3b82f6] to-[#2563eb] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]" />
                <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black opacity-0 group-hover:opacity-15 transition-opacity duration-200" />
                <span className="relative flex items-center gap-1.5 font-sans">
                  {isSavingPeer ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <span>Save Changes</span>
                  )}
                </span>
              </button>
            </div>
          </form>
        )}

        {selectedPeer && peerTab === 'danger' && (
          <div className="flex-1 p-5 overflow-y-auto">
            <div className="rounded-[8px] border border-[#3a1515] bg-[#0e0404] p-4">
              <h3 className="text-[16px] font-medium text-[#e5484d] mb-1">Disconnect Peer</h3>
              <p className="text-[13px] text-[#8c8c8c] mb-4">
                Permanently remove <span className="text-white font-medium text-[13px]">{selectedPeer.moniker}</span> from the cluster mesh. All cross-node synchronizations and heartbeats will be terminated.
              </p>
              <button
                type="button"
                onClick={() => {
                  setPeerToDelete(selectedPeer);
                }}
                className="group relative flex shrink-0 items-center justify-center h-8 px-3.5 rounded-[8px] font-medium text-white shadow-xs outline-none cursor-pointer overflow-hidden ring-1 ring-[#be123c] bg-[#e11d48] font-sans text-[13px]"
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-[#f43f5e] to-[#e11d48] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]"
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black opacity-0 group-hover:opacity-15 transition-opacity duration-200"
                />
                <span className="relative flex items-center gap-1.5 font-sans">
                  Disconnect Peer
                </span>
              </button>
            </div>
          </div>
        )}
      </SlideOver>

      {/* Remove Peer Confirmation Dialog */}
      <ConfirmDialog
        isOpen={Boolean(peerToDelete)}
        onClose={() => setPeerToDelete(null)}
        onConfirm={handleConfirmRemovePeer}
        title="Disconnect Peer Node"
        description={
          <>
            Permanently remove peer node{' '}
            <span className="text-white font-medium">{peerToDelete?.moniker}</span>{' '}
            from this cluster mesh? All cross-node synchronizations and heartbeats will be terminated.
          </>
        }
        confirmLabel={isDeleting ? 'Disconnecting…' : 'Disconnect Peer'}
        cancelLabel="Cancel"
        variant="danger"
      />
      {/* Discard Connect Peer Confirmation Dialog */}
      <ConfirmDialog
        isOpen={confirmDiscardConnectOpen}
        onClose={() => setConfirmDiscardConnectOpen(false)}
        onConfirm={forceCloseConnect}
        title="Discard Peer Connection"
        description="You have unsaved peer connection details. Are you sure you want to discard your changes?"
        confirmLabel="Discard Changes"
        cancelLabel="Keep Editing"
        variant="warning"
      />

      {/* Discard Manage Peer Confirmation Dialog */}
      <ConfirmDialog
        isOpen={confirmDiscardManagePeerOpen}
        onClose={() => setConfirmDiscardManagePeerOpen(false)}
        onConfirm={forceCloseManagePeer}
        title="Discard Unsaved Changes"
        description="You have unsaved changes to this peer connection. Are you sure you want to discard them?"
        confirmLabel="Discard Changes"
        cancelLabel="Keep Editing"
        variant="warning"
      />
    </div>
  );
}

export default Cluster;
