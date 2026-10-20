/*
 * Cluster Mesh management dashboard for zero-database peer-to-peer distributed coordination.
 * Owned by: ui/pages
 * Key deps: api/client, lucide-react, DataTable, SlideOver, Button, ConfirmDialog
 * Invariants: Monikers and secrets conform to cryptographic pairing specifications; peer removal requires confirmation.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  api,
  ClusterStatusData,
  PeerNodeRecordApi,
} from '../api/client';
import { DataTable, Column } from '../components/shared/DataTable';
import { SlideOver } from '../components/ui/SlideOver';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import {
  Plus,
  RefreshCw,
  Copy,
  Check,
  Eye,
  EyeOff,
  Trash2,
  Edit2,
  AlertTriangle,
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

  const [showSecret, setShowSecret] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [copiedNodeId, setCopiedNodeId] = useState(false);

  const [isEditingMoniker, setIsEditingMoniker] = useState(false);
  const [editMonikerValue, setEditMonikerValue] = useState('');
  const [isSavingMoniker, setIsSavingMoniker] = useState(false);

  const [isConnectOpen, setIsConnectOpen] = useState(false);
  const [peerUrl, setPeerUrl] = useState('');
  const [peerSecret, setPeerSecret] = useState('');
  const [peerMoniker, setPeerMoniker] = useState('');
  const [connectError, setConnectError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const [peerToDelete, setPeerToDelete] = useState<PeerNodeRecordApi | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

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

  const handleSaveMoniker = async () => {
    const trimmed = editMonikerValue.trim();
    if (!trimmed) return;
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
      fetchClusterData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to remove peer');
    } finally {
      setIsDeleting(false);
    }
  };

  const columns = useMemo<Column<PeerNodeRecordApi>[]>(
    () => [
      {
        id: 'status',
        header: 'Status',
        accessorKey: 'status',
        width: 120,
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
            <div className="flex items-center gap-2 text-[13px] text-[#cccccc] truncate whitespace-nowrap">
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
        width: 170,
        isResizable: true,
        className: 'px-3',
        cell: (peer) => (
          <span
            className="text-[14px] font-medium text-white truncate whitespace-nowrap block"
            title={peer.moniker}
          >
            {peer.moniker}
          </span>
        ),
      },
      {
        id: 'nodeId',
        header: 'Node ID',
        accessorKey: 'node_id',
        width: 220,
        isResizable: true,
        className: 'px-3',
        cell: (peer) => (
          <span
            className="font-mono text-[12px] text-[#8c8c8c] truncate whitespace-nowrap block"
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
        isFlex: true,
        className: 'px-3',
        cell: (peer) => (
          <span
            className="font-mono text-[12px] text-[#8c8c8c] truncate whitespace-nowrap block"
            title={peer.url}
          >
            {peer.url}
          </span>
        ),
      },
      {
        id: 'latency',
        header: 'Latency',
        accessorKey: 'last_ping_ms',
        width: 110,
        isResizable: true,
        className: 'px-3',
        cell: (peer) =>
          peer.status === 'connected' ? (
            <span
              className={`tabular-nums text-[13px] ${
                peer.last_ping_ms < 50 ? 'text-[#30a46c]' : 'text-[#f59e0b]'
              }`}
            >
              {peer.last_ping_ms} ms
            </span>
          ) : (
            <span className="text-[13px] text-[#666666]">—</span>
          ),
      },
      {
        id: 'lastSeen',
        header: 'Last Seen',
        accessorKey: 'last_seen_at',
        width: 120,
        isResizable: true,
        className: 'px-3',
        cell: (peer) => (
          <span className="tabular-nums text-[13px] text-[#8c8c8c] truncate whitespace-nowrap block">
            {formatLastSeen(peer.last_seen_at)}
          </span>
        ),
      },
      {
        id: 'actions',
        header: <span className="sr-only">Actions</span>,
        width: 72,
        headerClassName: 'justify-end pr-4',
        className: 'pl-3 pr-4 justify-end',
        cell: (peer) => (
          <div className="flex items-center justify-end w-full">
            <button
              type="button"
              onClick={() => setPeerToDelete(peer)}
              className="flex items-center justify-center h-7 w-7 rounded-[6px] text-[#8c8c8c] hover:text-[#f87171] hover:bg-[#2a1113] transition-colors cursor-pointer"
              title="Remove peer from mesh"
              aria-label={`Remove ${peer.moniker} from mesh`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ),
      },
    ],
    []
  );

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

      {/* Local Node */}
      <div className="rounded-lg border border-[#262626] bg-[#0e0e0e]">
        <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[#222222]">
          <div className="px-4 py-3.5 min-w-0">
            <span className="block text-[12px] text-[#8c8c8c] font-medium mb-1.5">Node Moniker</span>
            {isEditingMoniker ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={editMonikerValue}
                  onChange={(e) => setEditMonikerValue(e.target.value)}
                  className="h-8 min-w-0 flex-1 rounded-[6px] border border-[#262626] bg-[#121212] px-2.5 text-[13px] text-white placeholder-[#555555] focus:outline-none focus:border-[#3b82f6]"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={handleSaveMoniker}
                  disabled={isSavingMoniker}
                  className="h-7 px-2.5 rounded-[6px] bg-[#2563eb] text-[12px] font-medium text-white hover:bg-[#1d4ed8] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingMoniker(false)}
                  className="h-7 px-2.5 rounded-[6px] border border-[#262626] text-[12px] text-[#cccccc] hover:text-white hover:border-[#383838] transition-colors cursor-pointer shrink-0"
                >
                  Cancel
                </button>
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
                className="font-mono text-[13px] text-[#cccccc] truncate"
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

      {/* Peers Table */}
      <DataTable
        columns={columns}
        data={peers}
        keyExtractor={(peer) => peer.node_id}
        isLoading={isLoading}
        ariaLabel="Cluster Peers Table"
        emptyMessage="No cluster peers connected. Connect a peer to join the mesh."
      />

      {/* Connect Peer SlideOver */}
      <SlideOver
        isOpen={isConnectOpen}
        onClose={() => setIsConnectOpen(false)}
        title="Connect Peer"
        subtitle="Pair with another Axiom node using its URL and cluster secret"
      >
        <form onSubmit={handleConnectPeerSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 p-5 overflow-y-auto space-y-4">
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
                className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white placeholder-[#555555] focus:outline-none focus:border-[#3b82f6] font-mono"
                required
              />
              <span className="block text-[12px] text-[#666666] mt-1">
                Reachable HTTP or HTTPS base URL of the remote node.
              </span>
            </div>

            <div>
              <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                Cluster Secret <span className="text-[#e5484d]">*</span>
              </label>
              <input
                type="password"
                placeholder="Paste the remote node's cluster secret"
                value={peerSecret}
                onChange={(e) => setPeerSecret(e.target.value)}
                className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white placeholder-[#555555] focus:outline-none focus:border-[#3b82f6] font-mono"
                required
              />
              <span className="block text-[12px] text-[#666666] mt-1">
                Copied from the remote node&apos;s cluster page.
              </span>
            </div>

            <div>
              <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                Custom Moniker <span className="text-[#666666] font-normal">(optional)</span>
              </label>
              <input
                type="text"
                placeholder="e.g. London-Edge-01"
                value={peerMoniker}
                onChange={(e) => setPeerMoniker(e.target.value)}
                className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white placeholder-[#555555] focus:outline-none focus:border-[#3b82f6]"
              />
              <span className="block text-[12px] text-[#666666] mt-1">
                Leave blank to use the peer&apos;s advertised node name.
              </span>
            </div>
          </div>

          <div className="p-4 border-t border-[#222222] bg-[#0e0e0e] flex items-center justify-end gap-2.5">
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={() => setIsConnectOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="md" disabled={isConnecting}>
              {isConnecting ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Pairing
                </>
              ) : (
                'Connect Peer'
              )}
            </Button>
          </div>
        </form>
      </SlideOver>

      {/* Remove Peer Confirmation */}
      <ConfirmDialog
        isOpen={Boolean(peerToDelete)}
        onClose={() => setPeerToDelete(null)}
        onConfirm={handleConfirmRemovePeer}
        title="Remove Peer"
        description={`Remove "${peerToDelete?.moniker}" from this cluster mesh? Security events will no longer sync with this node.`}
        confirmLabel={isDeleting ? 'Removing…' : 'Remove Peer'}
        variant="danger"
      />
    </div>
  );
}
export default Cluster;
