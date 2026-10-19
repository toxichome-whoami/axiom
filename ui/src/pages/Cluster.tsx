/*
 * Cluster Mesh management dashboard for zero-database peer-to-peer distributed coordination.
 * Owned by: ui/pages
 * Key deps: api/client, lucide-react, components/ui/SlideOver, components/ui/Button, components/ui/ConfirmDialog
 * Invariants: Monikers and secrets conform to cryptographic pairing specifications; peer removal requires confirmation.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  api,
  ClusterStatusData,
  PeerNodeRecordApi,
} from '../api/client';
import { SlideOver } from '../components/ui/SlideOver';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import {
  Network,
  Plus,
  RefreshCw,
  Copy,
  Check,
  Eye,
  EyeOff,
  Trash2,
  Server,
  ShieldCheck,
  Zap,
  Activity,
  Edit2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from 'lucide-react';

export function Cluster() {
  const [status, setStatus] = useState<ClusterStatusData | null>(null);
  const [peers, setPeers] = useState<PeerNodeRecordApi[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Secret visibility & copy state
  const [showSecret, setShowSecret] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [copiedNodeId, setCopiedNodeId] = useState(false);

  // Edit moniker modal/inline state
  const [isEditingMoniker, setIsEditingMoniker] = useState(false);
  const [editMonikerValue, setEditMonikerValue] = useState('');
  const [isSavingMoniker, setIsSavingMoniker] = useState(false);

  // Connect Peer SlideOver state
  const [isConnectOpen, setIsConnectOpen] = useState(false);
  const [peerUrl, setPeerUrl] = useState('');
  const [peerSecret, setPeerSecret] = useState('');
  const [peerMoniker, setPeerMoniker] = useState('');
  const [connectError, setConnectError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  // Remove peer confirmation state
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
    // Auto-poll peer health every 15 seconds
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

  const formatLastSeen = (timestampSecs: number) => {
    if (!timestampSecs) return 'Never';
    const nowSecs = Math.floor(Date.now() / 1000);
    const diff = nowSecs - timestampSecs;
    if (diff < 5) return 'Just now';
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-[#000000] text-[#f3f4f6] px-4 md:px-8 py-6 space-y-6">
      {/* ─── Header & Primary Controls ───────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#222222] pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <Network className="w-5 h-5 text-[#30a46c]" />
            <h1 className="text-xl font-semibold tracking-tight text-[#f3f4f6]">Cluster Mesh</h1>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-[#13231b] text-[#30a46c] border border-[#1b3d2b]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#30a46c] animate-pulse" />
              P2P Active
            </span>
          </div>
          <p className="text-xs text-[#8c8c8c] mt-1 max-w-2xl">
            Zero-database peer-to-peer synchronization mesh. Nodes broadcast security events, share API keys & catalogs,
            and reject attackers on arrival in sub-50ms.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            className="border-[#262626] hover:bg-[#141416] text-[#d4d4d4] text-xs h-8 px-3"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setConnectError(null);
              setIsConnectOpen(true);
            }}
            className="bg-[#30a46c] hover:bg-[#288f5d] text-white text-xs h-8 px-3.5 font-medium"
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Connect Peer
          </Button>
        </div>
      </div>

      {errorMessage && (
        <div className="flex items-center gap-2.5 p-3 rounded-lg bg-[#261214] border border-[#4a1c20] text-xs text-[#f87171]">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* ─── Local Node Identity Card ────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Node Information Card */}
        <div className="lg:col-span-2 bg-[#0c0c0e] border border-[#222222] rounded-lg p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-[#1c1c1f]">
              <div className="flex items-center gap-2">
                <Server className="w-4 h-4 text-[#8c8c8c]" />
                <span className="text-xs uppercase tracking-wider text-[#8c8c8c] font-medium">Local Node Identity</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-[#30a46c] font-mono">
                <span className="w-2 h-2 rounded-full bg-[#30a46c]" />
                Healthy
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              {/* Moniker */}
              <div>
                <label className="text-[11px] uppercase tracking-wider text-[#666666] font-semibold block mb-1">
                  Node Moniker
                </label>
                {isEditingMoniker ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={editMonikerValue}
                      onChange={(e) => setEditMonikerValue(e.target.value)}
                      className="bg-[#141416] border border-[#333333] rounded px-2.5 py-1 text-xs text-[#f3f4f6] font-medium focus:outline-none focus:border-[#30a46c] w-full"
                      autoFocus
                    />
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={handleSaveMoniker}
                      disabled={isSavingMoniker}
                      className="h-7 px-2.5 bg-[#30a46c] text-white text-[11px]"
                    >
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setIsEditingMoniker(false)}
                      className="h-7 px-2 border-[#333333] text-[11px]"
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[#f3f4f6]">{status?.moniker || '---'}</span>
                    <button
                      onClick={() => {
                        setEditMonikerValue(status?.moniker || '');
                        setIsEditingMoniker(true);
                      }}
                      className="text-[#666666] hover:text-[#f3f4f6] transition-colors p-1"
                      title="Edit node moniker"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {/* Node ID */}
              <div>
                <label className="text-[11px] uppercase tracking-wider text-[#666666] font-semibold block mb-1">
                  Node Identifier
                </label>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-[#a3a3a3] bg-[#141416] px-2 py-0.5 rounded border border-[#222222]">
                    {status?.node_id || '---'}
                  </span>
                  <button
                    onClick={handleCopyNodeId}
                    className="text-[#666666] hover:text-[#f3f4f6] transition-colors p-1"
                    title="Copy Node ID"
                  >
                    {copiedNodeId ? <Check className="w-3.5 h-3.5 text-[#30a46c]" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Cluster Shared Secret */}
            <div className="mt-4 pt-3 border-t border-[#1c1c1f]">
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] uppercase tracking-wider text-[#666666] font-semibold">
                  Cluster Secret (Pairing Token)
                </label>
                <span className="text-[10px] text-[#8c8c8c]">Required on remote node to pair</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-[#141416] border border-[#222222] rounded px-3 py-1.5 font-mono text-xs text-[#a3a3a3] truncate select-all">
                  {showSecret ? status?.cluster_secret : '••••••••••••••••••••••••••••••••••••••••••••••••'}
                </div>
                <button
                  type="button"
                  onClick={() => setShowSecret(!showSecret)}
                  className="p-1.5 bg-[#141416] border border-[#222222] hover:bg-[#1c1c1f] rounded text-[#8c8c8c] hover:text-[#f3f4f6]"
                  title={showSecret ? 'Hide secret' : 'Show secret'}
                >
                  {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
                <button
                  type="button"
                  onClick={handleCopySecret}
                  className="p-1.5 bg-[#141416] border border-[#222222] hover:bg-[#1c1c1f] rounded text-[#8c8c8c] hover:text-[#f3f4f6]"
                  title="Copy Pairing Secret"
                >
                  {copiedSecret ? <Check className="w-4 h-4 text-[#30a46c]" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Mesh Metrics Summary */}
        <div className="bg-[#0c0c0e] border border-[#222222] rounded-lg p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 pb-3 border-b border-[#1c1c1f]">
              <Activity className="w-4 h-4 text-[#8c8c8c]" />
              <span className="text-xs uppercase tracking-wider text-[#8c8c8c] font-medium">Mesh Topology</span>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-4">
              <div className="bg-[#141416] border border-[#222222] rounded p-3">
                <span className="text-[11px] text-[#8c8c8c] block">Connected Peers</span>
                <span className="text-2xl font-semibold text-[#30a46c] mt-1 block">
                  {status?.connected_peers ?? 0}
                </span>
              </div>
              <div className="bg-[#141416] border border-[#222222] rounded p-3">
                <span className="text-[11px] text-[#8c8c8c] block">Total Known Peers</span>
                <span className="text-2xl font-semibold text-[#f3f4f6] mt-1 block">
                  {status?.total_peers ?? 0}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-[#1c1c1f] text-[11px] text-[#8c8c8c] space-y-1">
            <div className="flex items-center justify-between">
              <span>Security Broadcast:</span>
              <span className="text-[#30a46c] font-mono">Active (sub-50ms)</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Coordination Engine:</span>
              <span className="text-[#d4d4d4] font-mono">P2P BLAKE3-MAC</span>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Real-time Threat Defense Invariant Card ──────────────────────── */}
      <div className="bg-[#0c0c0e] border border-[#1b3d2b] rounded-lg p-4 flex items-center gap-4">
        <div className="w-10 h-10 rounded-full bg-[#13231b] border border-[#1b3d2b] flex items-center justify-center shrink-0">
          <Zap className="w-5 h-5 text-[#30a46c]" />
        </div>
        <div className="flex-1">
          <h4 className="text-xs font-semibold text-[#f3f4f6]">Active Threat Fanout Engine</h4>
          <p className="text-[11px] text-[#8c8c8c] mt-0.5">
            If an attacker brute-forces Server 1, their IP is immediately banned across all paired nodes in this mesh.
            Subsequent attacks against Server 2 or Server 3 are refused instantly on arrival without touching your databases.
          </p>
        </div>
      </div>

      {/* ─── Peers Data Table ────────────────────────────────────────────── */}
      <div className="bg-[#0c0c0e] border border-[#222222] rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#222222] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-[#8c8c8c]" />
            <span className="text-xs font-semibold text-[#f3f4f6]">Registered Cluster Peers</span>
            <span className="text-[11px] text-[#666666] font-mono">({peers.length})</span>
          </div>
        </div>

        {peers.length === 0 ? (
          <div className="py-12 px-4 text-center">
            <Network className="w-8 h-8 text-[#444444] mx-auto mb-3" />
            <h3 className="text-sm font-medium text-[#f3f4f6]">No Connected Cluster Peers</h3>
            <p className="text-xs text-[#8c8c8c] mt-1 max-w-sm mx-auto">
              This node is operating in standalone mode. Click &quot;Connect Peer&quot; to establish an encrypted mesh
              pairing with another Axiom server.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIsConnectOpen(true)}
              className="mt-4 border-[#333333] text-xs h-8"
            >
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              Connect First Peer
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#222222] text-[#8c8c8c] bg-[#08080a] select-none">
                  <th className="py-2.5 px-4 font-medium uppercase text-[10px] tracking-wider">Status</th>
                  <th className="py-2.5 px-4 font-medium uppercase text-[10px] tracking-wider">Moniker</th>
                  <th className="py-2.5 px-4 font-medium uppercase text-[10px] tracking-wider">Node ID</th>
                  <th className="py-2.5 px-4 font-medium uppercase text-[10px] tracking-wider">Advertise URL</th>
                  <th className="py-2.5 px-4 font-medium uppercase text-[10px] tracking-wider">Latency</th>
                  <th className="py-2.5 px-4 font-medium uppercase text-[10px] tracking-wider">Last Seen</th>
                  <th className="py-2.5 px-4 font-medium uppercase text-[10px] tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1c1c1f]">
                {peers.map((peer) => {
                  const isConnected = peer.status === 'connected';
                  return (
                    <tr key={peer.node_id} className="hover:bg-[#141416]/50 transition-colors">
                      {/* Status */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-medium border ${
                            isConnected
                              ? 'bg-[#13231b] text-[#30a46c] border-[#1b3d2b]'
                              : 'bg-[#261214] text-[#f87171] border-[#4a1c20]'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              isConnected ? 'bg-[#30a46c]' : 'bg-[#f87171]'
                            }`}
                          />
                          {isConnected ? 'Connected' : 'Unreachable'}
                        </span>
                      </td>

                      {/* Moniker */}
                      <td className="py-3 px-4 font-medium text-[#f3f4f6] whitespace-nowrap">
                        {peer.moniker}
                      </td>

                      {/* Node ID */}
                      <td className="py-3 px-4 font-mono text-[11px] text-[#8c8c8c] whitespace-nowrap">
                        {peer.node_id}
                      </td>

                      {/* URL */}
                      <td className="py-3 px-4 font-mono text-[11px] text-[#a3a3a3] whitespace-nowrap">
                        {peer.url}
                      </td>

                      {/* Latency */}
                      <td className="py-3 px-4 whitespace-nowrap font-mono text-[11px]">
                        {isConnected ? (
                          <span className={peer.last_ping_ms < 50 ? 'text-[#30a46c]' : 'text-[#f59e0b]'}>
                            {peer.last_ping_ms} ms
                          </span>
                        ) : (
                          <span className="text-[#666666]">---</span>
                        )}
                      </td>

                      {/* Last Seen */}
                      <td className="py-3 px-4 text-[#8c8c8c] whitespace-nowrap">
                        {formatLastSeen(peer.last_seen_at)}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 whitespace-nowrap text-right">
                        <button
                          onClick={() => setPeerToDelete(peer)}
                          className="p-1 text-[#666666] hover:text-[#f87171] transition-colors rounded hover:bg-[#261214]"
                          title="Remove peer from mesh"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── Connect Peer SlideOver ──────────────────────────────────────── */}
      <SlideOver
        isOpen={isConnectOpen}
        onClose={() => setIsConnectOpen(false)}
        title="Connect Cluster Peer"
      >
        <form onSubmit={handleConnectPeerSubmit} className="space-y-4">
          <p className="text-xs text-[#8c8c8c]">
            Enter the remote Axiom instance endpoint and its cluster secret. Both nodes will perform an authenticated
            mutual handshake and register each other symmetrically.
          </p>

          {connectError && (
            <div className="p-3 rounded bg-[#261214] border border-[#4a1c20] text-xs text-[#f87171]">
              {connectError}
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-[#d4d4d4] block mb-1.5">
              Remote Peer URL <span className="text-[#f87171]">*</span>
            </label>
            <input
              type="text"
              placeholder="https://peer.example.com:4500"
              value={peerUrl}
              onChange={(e) => setPeerUrl(e.target.value)}
              className="w-full bg-[#141416] border border-[#333333] rounded px-3 py-2 text-xs text-[#f3f4f6] font-mono focus:outline-none focus:border-[#30a46c]"
              required
            />
            <span className="text-[10px] text-[#666666] mt-1 block">
              The internal or public reachable HTTP/HTTPS base URL of the remote node.
            </span>
          </div>

          <div>
            <label className="text-xs font-medium text-[#d4d4d4] block mb-1.5">
              Cluster Secret / Pairing Token <span className="text-[#f87171]">*</span>
            </label>
            <input
              type="password"
              placeholder="Paste remote node's cluster secret"
              value={peerSecret}
              onChange={(e) => setPeerSecret(e.target.value)}
              className="w-full bg-[#141416] border border-[#333333] rounded px-3 py-2 text-xs text-[#f3f4f6] font-mono focus:outline-none focus:border-[#30a46c]"
              required
            />
            <span className="text-[10px] text-[#666666] mt-1 block">
              Copied from the remote node&apos;s Cluster Dashboard.
            </span>
          </div>

          <div>
            <label className="text-xs font-medium text-[#d4d4d4] block mb-1.5">
              Custom Moniker (Optional)
            </label>
            <input
              type="text"
              placeholder="e.g. London-Edge-01"
              value={peerMoniker}
              onChange={(e) => setPeerMoniker(e.target.value)}
              className="w-full bg-[#141416] border border-[#333333] rounded px-3 py-2 text-xs text-[#f3f4f6] focus:outline-none focus:border-[#30a46c]"
            />
            <span className="text-[10px] text-[#666666] mt-1 block">
              Leave blank to adopt the peer&apos;s advertised node name.
            </span>
          </div>

          <div className="pt-4 flex items-center justify-end gap-2 border-t border-[#222222]">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsConnectOpen(false)}
              className="border-[#333333] text-xs h-8"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={isConnecting}
              className="bg-[#30a46c] hover:bg-[#288f5d] text-white text-xs h-8 px-4"
            >
              {isConnecting ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  Pairing...
                </>
              ) : (
                'Establish Pairing'
              )}
            </Button>
          </div>
        </form>
      </SlideOver>

      {/* ─── Remove Peer Confirmation Dialog ────────────────────────────── */}
      <ConfirmDialog
        isOpen={Boolean(peerToDelete)}
        onClose={() => setPeerToDelete(null)}
        onConfirm={handleConfirmRemovePeer}
        title="Remove Peer Node"
        description={`Are you sure you want to remove peer "${peerToDelete?.moniker}" (${peerToDelete?.node_id}) from the cluster mesh? Security events will no longer be broadcast to or received from this node.`}
        confirmLabel="Remove Peer"
        variant="danger"
      />
    </div>
  );
}
export default Cluster;
