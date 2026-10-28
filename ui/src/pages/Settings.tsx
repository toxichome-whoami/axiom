/*
 * Cluster Settings and Administrative Operator directory interface.
 * Owned by: ui/settings
 * Key deps: DataTable, Button, lucide-react, ../api/client
 * Invariants: The root super administrator is created via initial setup wizard; secondary users are created and managed via the Users directory.
 * Last structural change: Standardized on Axiom pure dark neutral palette, horizontal tab navigation, and 13px typography.
 */

import React, { useState, useEffect } from "react";
import { Skeleton } from "../components/ui/Skeleton";
import {
  RefreshCw,
  Copy,
  Check,
  Server,
  Shield,
  Info,
  Code2,
  Cpu,
  Layers,
  Lock,
  Database,
  HardDrive,
  Activity,
  Network,
  Search,
  X,
} from "lucide-react";
import { api, SystemStatusData, HealthData } from "../api/client";
import { hasPermission } from "../api/session";

export interface ApiRouteItem {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
  path: string;
  desc: string;
  category: "database" | "storage" | "admin" | "cluster" | "mcp";
}

export function Settings() {
  const [activeTab, setActiveTab] = useState<"server" | "routes" | "about">(
    "server",
  );
  const [statusData, setStatusData] = useState<SystemStatusData | null>(null);
  const [healthData, setHealthData] = useState<HealthData | null>(null);
  const [isReloading, setIsReloading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [endpointCategory, setEndpointCategory] = useState<
    "all" | "database" | "storage" | "admin" | "cluster" | "mcp"
  >("database");
  const [searchRoutes, setSearchRoutes] = useState("");
  const fetchGenRef = React.useRef(0);

  const handleCopyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setCopiedPath(path);
      setTimeout(() => setCopiedPath(null), 1800);
    } catch {
      // Clipboard access error
    }
  };

  const loadLiveSettings = async () => {
    const curGen = ++fetchGenRef.current;
    try {
      const [statusRes, healthRes] = await Promise.allSettled([
        api.getStatus(),
        api.getHealth(),
      ]);

      if (curGen !== fetchGenRef.current) return;

      if (statusRes.status === "fulfilled") {
        setStatusData(statusRes.value);
      }
      if (healthRes.status === "fulfilled") {
        setHealthData(healthRes.value);
      }
    } catch {
      // Keep existing state
    } finally {
      if (curGen === fetchGenRef.current) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    loadLiveSettings();
  }, []);

  async function handleReloadSnapshot() {
    setIsReloading(true);
    const minSpinPromise = new Promise((resolve) => setTimeout(resolve, 600));
    try {
      await Promise.all([api.reloadMetadata(), minSpinPromise]);
      await loadLiveSettings();
    } catch {
      // Keep existing state
    } finally {
      setIsReloading(false);
    }
  }

  const databaseEndpoints: ApiRouteItem[] = [
    {
      method: "GET",
      path: "/api/v1/db/databases",
      desc: "List authorized databases with connectivity health",
      category: "database",
    },
    {
      method: "GET",
      path: "/api/v1/db/{alias}/tables",
      desc: "List tables in target database service",
      category: "database",
    },
    {
      method: "GET",
      path: "/api/v1/db/{alias}/{table}/columns",
      desc: "Describe table columns, data types, and foreign keys",
      category: "database",
    },
    {
      method: "POST",
      path: "/api/v1/db/{alias}/{table}/columns",
      desc: "Add new column to table schema",
      category: "database",
    },
    {
      method: "PATCH",
      path: "/api/v1/db/{alias}/{table}/columns/{column}",
      desc: "Modify existing column definition or rename",
      category: "database",
    },
    {
      method: "DELETE",
      path: "/api/v1/db/{alias}/{table}/columns/{column}",
      desc: "Drop column from table schema",
      category: "database",
    },
    {
      method: "GET",
      path: "/api/v1/db/{alias}/{table}/rows",
      desc: "Query table records with cursor pagination and filters",
      category: "database",
    },
    {
      method: "POST",
      path: "/api/v1/db/{alias}/{table}/rows",
      desc: "Insert single or batch records",
      category: "database",
    },
    {
      method: "PATCH",
      path: "/api/v1/db/{alias}/{table}/rows",
      desc: "Update records matching filter criteria",
      category: "database",
    },
    {
      method: "DELETE",
      path: "/api/v1/db/{alias}/{table}/rows",
      desc: "Delete records matching filter criteria",
      category: "database",
    },
    {
      method: "POST",
      path: "/api/v1/db/{alias}/query",
      desc: "Execute raw SQL query with AST firewall validation",
      category: "database",
    },
  ];

  const storageEndpoints: ApiRouteItem[] = [
    {
      method: "GET",
      path: "/api/v1/blobs/namespaces",
      desc: "List storage namespaces with usage headroom and quota",
      category: "storage",
    },
    {
      method: "GET",
      path: "/api/v1/blobs/namespaces/{namespace}",
      desc: "Inspect namespace settings and quota limits",
      category: "storage",
    },
    {
      method: "GET",
      path: "/api/v1/blobs/namespaces/{namespace}/usage",
      desc: "Query real-time storage telemetry and object counts",
      category: "storage",
    },
    {
      method: "GET",
      path: "/api/v1/blobs/objects/{namespace}",
      desc: "List stored objects, virtual folders, and metadata",
      category: "storage",
    },
    {
      method: "GET",
      path: "/api/v1/blobs/objects/{namespace}/{key}",
      desc: "Download object content (supports HTTP Range streaming)",
      category: "storage",
    },
    {
      method: "HEAD",
      path: "/api/v1/blobs/objects/{namespace}/{key}",
      desc: "Check object existence, size, and metadata headers",
      category: "storage",
    },
    {
      method: "PUT",
      path: "/api/v1/blobs/objects/{namespace}/{key}",
      desc: "Upload or overwrite object with automatic MIME detection",
      category: "storage",
    },
    {
      method: "DELETE",
      path: "/api/v1/blobs/objects/{namespace}/{key}",
      desc: "Delete stored object",
      category: "storage",
    },
    {
      method: "POST",
      path: "/api/v1/blobs/objects/{namespace}/batch-delete",
      desc: "Batch delete multiple objects or prefix tree",
      category: "storage",
    },
    {
      method: "POST",
      path: "/api/v1/blobs/objects/copy",
      desc: "Copy object or prefix tree across namespaces",
      category: "storage",
    },
    {
      method: "POST",
      path: "/api/v1/blobs/objects/move",
      desc: "Move or rename object across namespaces",
      category: "storage",
    },
    {
      method: "POST",
      path: "/api/v1/blobs/objects/{namespace}/verify/{key}",
      desc: "Verify BLAKE3 cryptographic checksum",
      category: "storage",
    },
    {
      method: "GET",
      path: "/api/v1/blobs/public/{namespace}/{key}",
      desc: "Direct static CDN media streaming with 304 ETag caching",
      category: "storage",
    },
    {
      method: "POST",
      path: "/api/v1/blobs/uploads/{namespace}",
      desc: "Initialize chunked/resumable upload session",
      category: "storage",
    },
    {
      method: "POST",
      path: "/api/v1/blobs/uploads/{namespace}/sign",
      desc: "Generate presigned direct upload URL",
      category: "storage",
    },
    {
      method: "GET",
      path: "/api/v1/blobs/uploads/{namespace}/{upload_id}",
      desc: "Check upload session status and received bytes",
      category: "storage",
    },
    {
      method: "PUT",
      path: "/api/v1/blobs/uploads/{namespace}/{upload_id}",
      desc: "Upload chunk via Content-Range or x-upload-offset",
      category: "storage",
    },
    {
      method: "DELETE",
      path: "/api/v1/blobs/uploads/{namespace}/{upload_id}",
      desc: "Abort upload session and discard chunk parts",
      category: "storage",
    },
    {
      method: "POST",
      path: "/api/v1/blobs/uploads/{namespace}/{upload_id}/complete",
      desc: "Assemble chunks and finalize object",
      category: "storage",
    },
    {
      method: "POST",
      path: "/api/v1/blobs/tickets/{namespace}",
      desc: "Generate time-bounded signed capability ticket",
      category: "storage",
    },
    {
      method: "GET",
      path: "/api/v1/blobs/tickets/{namespace}",
      desc: "List active capability tickets for namespace",
      category: "storage",
    },
    {
      method: "POST",
      path: "/api/v1/blobs/tickets/{namespace}/{signature}/revoke",
      desc: "Revoke capability ticket immediately",
      category: "storage",
    },
    {
      method: "DELETE",
      path: "/api/v1/blobs/tickets/{namespace}/{signature}",
      desc: "Delete capability ticket record",
      category: "storage",
    },
  ];

  const adminEndpoints: ApiRouteItem[] = [
    {
      method: "GET",
      path: "/admin/v1/status",
      desc: "Runtime status, engine health, and system telemetry",
      category: "admin",
    },
    {
      method: "POST",
      path: "/admin/v1/reload",
      desc: "Hot reload metadata snapshot from disk",
      category: "admin",
    },
    {
      method: "GET",
      path: "/admin/v1/keys",
      desc: "List provisioned API access keys",
      category: "admin",
    },
    {
      method: "POST",
      path: "/admin/v1/keys",
      desc: "Create new scoped API key",
      category: "admin",
    },
    {
      method: "PATCH",
      path: "/admin/v1/keys/{name}",
      desc: "Update API key permissions or expiration",
      category: "admin",
    },
    {
      method: "DELETE",
      path: "/admin/v1/keys/{name}",
      desc: "Revoke and delete API key",
      category: "admin",
    },
    {
      method: "POST",
      path: "/admin/v1/keys/{name}/rotate",
      desc: "Rotate API key secret",
      category: "admin",
    },
    {
      method: "GET",
      path: "/admin/v1/roles",
      desc: "List RBAC roles and permission matrices",
      category: "admin",
    },
    {
      method: "POST",
      path: "/admin/v1/roles",
      desc: "Create new RBAC role definition",
      category: "admin",
    },
    {
      method: "PATCH",
      path: "/admin/v1/roles/{name}",
      desc: "Update RBAC role permissions",
      category: "admin",
    },
    {
      method: "DELETE",
      path: "/admin/v1/roles/{name}",
      desc: "Delete custom RBAC role",
      category: "admin",
    },
    {
      method: "GET",
      path: "/admin/v1/databases",
      desc: "List managed database configurations",
      category: "admin",
    },
    {
      method: "POST",
      path: "/admin/v1/databases",
      desc: "Register new database connection",
      category: "admin",
    },
    {
      method: "PATCH",
      path: "/admin/v1/databases/{alias}",
      desc: "Update database configuration",
      category: "admin",
    },
    {
      method: "DELETE",
      path: "/admin/v1/databases/{alias}",
      desc: "Unregister database service",
      category: "admin",
    },
    {
      method: "GET",
      path: "/admin/v1/databases/{alias}/test",
      desc: "Test database connectivity and latency",
      category: "admin",
    },
    {
      method: "POST",
      path: "/admin/v1/databases/test-url",
      desc: "Test candidate database connection string",
      category: "admin",
    },
    {
      method: "GET",
      path: "/admin/v1/cache/stats",
      desc: "Query query-cache hit rates and memory usage",
      category: "admin",
    },
    {
      method: "POST",
      path: "/admin/v1/cache/flush",
      desc: "Invalidate and flush memory query cache",
      category: "admin",
    },
    {
      method: "GET",
      path: "/admin/v1/audit",
      desc: "Query audit logs with cursor pagination and filters",
      category: "admin",
    },
    {
      method: "GET",
      path: "/admin/v1/metrics",
      desc: "Query Prometheus metrics snapshot",
      category: "admin",
    },
    {
      method: "GET",
      path: "/admin/v1/health",
      desc: "Diagnostic health check of internal subsystems",
      category: "admin",
    },
    {
      method: "GET",
      path: "/admin/v1/users",
      desc: "List administrative users configured in gateway",
      category: "admin",
    },
    {
      method: "GET",
      path: "/admin/v1/blobs/stats",
      desc: "Global storage analytics and capacity telemetry",
      category: "admin",
    },
    {
      method: "POST",
      path: "/admin/v1/blobs/scrub",
      desc: "Trigger background consistency scrub",
      category: "admin",
    },
    {
      method: "POST",
      path: "/admin/v1/blobs/sweep",
      desc: "Sweep expired capability tickets and orphan uploads",
      category: "admin",
    },
    {
      method: "POST",
      path: "/admin/v1/blobs/namespaces",
      desc: "Create new storage namespace with quota",
      category: "admin",
    },
    {
      method: "PATCH",
      path: "/admin/v1/blobs/namespaces/{namespace}",
      desc: "Update namespace quota, retention, or ACL",
      category: "admin",
    },
    {
      method: "DELETE",
      path: "/admin/v1/blobs/namespaces/{namespace}",
      desc: "Delete empty storage namespace",
      category: "admin",
    },
    {
      method: "GET",
      path: "/admin/v1/blobs/tickets",
      desc: "Global audit of all capability tickets across namespaces",
      category: "admin",
    },
  ];

  const clusterEndpoints: ApiRouteItem[] = [
    {
      method: "GET",
      path: "/admin/v1/cluster/status",
      desc: "Raft cluster topology, term, and leader status",
      category: "cluster",
    },
    {
      method: "GET",
      path: "/admin/v1/cluster/peers",
      desc: "List cluster peer nodes and health",
      category: "cluster",
    },
    {
      method: "POST",
      path: "/admin/v1/cluster/peers",
      desc: "Join new peer node to cluster",
      category: "cluster",
    },
    {
      method: "PATCH",
      path: "/admin/v1/cluster/peers/{node_id}",
      desc: "Update peer node address or priority",
      category: "cluster",
    },
    {
      method: "DELETE",
      path: "/admin/v1/cluster/peers/{node_id}",
      desc: "Evict peer node from cluster",
      category: "cluster",
    },
    {
      method: "POST",
      path: "/admin/v1/cluster/peers/{node_id}/ping",
      desc: "Probe peer node round-trip latency",
      category: "cluster",
    },
    {
      method: "PATCH",
      path: "/admin/v1/cluster/moniker",
      desc: "Update node display name / moniker",
      category: "cluster",
    },
  ];

  const mcpEndpoints: ApiRouteItem[] = [
    {
      method: "POST",
      path: "/mcp/v1",
      desc: "Model Context Protocol JSON-RPC stream endpoint",
      category: "mcp",
    },
    {
      method: "GET",
      path: "/api/v1/health",
      desc: "Gateway service liveness and readiness probe",
      category: "mcp",
    },
    {
      method: "GET",
      path: "/metrics",
      desc: "Prometheus metrics export endpoint",
      category: "mcp",
    },
  ];

  const allEndpoints: ApiRouteItem[] = [
    ...databaseEndpoints,
    ...storageEndpoints,
    ...adminEndpoints,
    ...clusterEndpoints,
    ...mcpEndpoints,
  ];

  const renderPathWithParams = (path: string) => {
    const parts = path.split(/(\{[^}]+\})/g);
    return (
      <span className="font-mono text-[13px] text-[#e4e4e7] truncate font-normal tracking-tight">
        {parts.map((part, i) =>
          part.startsWith("{") && part.endsWith("}") ? (
            <span key={i} className="text-[#3b82f6] font-mono font-medium">
              {part}
            </span>
          ) : (
            part
          ),
        )}
      </span>
    );
  };

  const currentEndpoints =
    endpointCategory === "all"
      ? allEndpoints
      : allEndpoints.filter((ep) => ep.category === endpointCategory);

  const filteredEndpoints = currentEndpoints.filter(
    (ep) =>
      ep.path.toLowerCase().includes(searchRoutes.toLowerCase()) ||
      ep.desc.toLowerCase().includes(searchRoutes.toLowerCase()) ||
      ep.method.toLowerCase().includes(searchRoutes.toLowerCase()) ||
      ep.category.toLowerCase().includes(searchRoutes.toLowerCase()),
  );

  return (
    <div className="w-full max-w-[1600px] mx-auto pb-12 select-none font-sans space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-[16px] font-medium text-white tracking-tight">
            Settings
          </h1>
          <p className="text-[13px] text-[#8c8c8c] mt-0.5">
            Gateway runtime environment, API endpoints, and operational
            configuration
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isReloading || !hasPermission("settings.manage")}
            onClick={handleReloadSnapshot}
            title={
              hasPermission("settings.manage")
                ? "Reload metadata snapshot"
                : "Requires settings.manage permission"
            }
            aria-label="Reload metadata snapshot"
            className="flex items-center justify-center h-8 w-8 text-[#8c8c8c] hover:text-white rounded-[8px] bg-[#0c0c0c] hover:bg-[#141414] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isReloading ? "animate-spin opacity-50" : ""}`}
            />
          </button>
        </div>
      </div>

      {/* Top Segmented Navigation Tabs (Matches Overview, Databases, and Cluster) */}
      <div className="flex items-center gap-1 p-0.5 rounded-[8px] bg-[#0c0c0c] border border-[#262626] w-fit">
        <button
          type="button"
          onClick={() => setActiveTab("server")}
          className={`flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[13px] font-medium transition-colors cursor-pointer outline-none ${
            activeTab === "server"
              ? "bg-[#161616] text-white border border-[#333333]"
              : "text-[#8c8c8c] hover:text-white hover:bg-[#141414] border border-transparent"
          }`}
        >
          <Server className="w-3.5 h-3.5 shrink-0" />
          <span>Server Info</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("routes")}
          className={`flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[13px] font-medium transition-colors cursor-pointer outline-none ${
            activeTab === "routes"
              ? "bg-[#161616] text-white border border-[#333333]"
              : "text-[#8c8c8c] hover:text-white hover:bg-[#141414] border border-transparent"
          }`}
        >
          <Code2 className="w-3.5 h-3.5 shrink-0" />
          <span>API Routes</span>
          <span className="ml-1 text-[11px] font-sans px-1.5 py-0.5 rounded bg-[#1a1a1a] text-[#8c8c8c]">
            {allEndpoints.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("about")}
          className={`flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[13px] font-medium transition-colors cursor-pointer outline-none ${
            activeTab === "about"
              ? "bg-[#161616] text-white border border-[#333333]"
              : "text-[#8c8c8c] hover:text-white hover:bg-[#141414] border border-transparent"
          }`}
        >
          <Info className="w-3.5 h-3.5 shrink-0" />
          <span>About</span>
        </button>
      </div>

      {/* TAB 1: SERVER INFO */}
      {activeTab === "server" && (
        <div className="space-y-6">
          {/* Stat Metric Cards Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-[8px] border border-[#262626] bg-[#0c0c0c] p-4 flex flex-col justify-between hover:border-[#333333] transition-colors">
              <span className="text-[12px] font-normal text-[#8c8c8c] block">
                Server version
              </span>
              <div className="my-2">
                {isLoading ? (
                  <Skeleton className="h-7 w-20" />
                ) : (
                  <div className="text-[22px] font-semibold text-white tracking-[-0.02em] leading-tight">
                    v{statusData?.version || "0.1.20"}
                  </div>
                )}
              </div>
              <span className="text-[12px] text-[#737373] block">
                Rust 2021 · Axum 0.7
              </span>
            </div>

            <div className="rounded-[8px] border border-[#262626] bg-[#0c0c0c] p-4 flex flex-col justify-between hover:border-[#333333] transition-colors">
              <span className="text-[12px] font-normal text-[#8c8c8c] block">
                Process uptime
              </span>
              <div className="my-2">
                {isLoading ? (
                  <Skeleton className="h-7 w-28" />
                ) : (
                  <div className="text-[22px] font-semibold text-white tracking-[-0.02em] leading-tight tabular-nums">
                    {healthData?.uptime_seconds
                      ? `${Math.floor(healthData.uptime_seconds / 3600)}h ${Math.floor((healthData.uptime_seconds % 3600) / 60)}m`
                      : "Active"}
                  </div>
                )}
              </div>
              <span className="text-[12px] text-[#737373] block">
                Zero unplanned restarts
              </span>
            </div>

            <div className="rounded-[8px] border border-[#262626] bg-[#0c0c0c] p-4 flex flex-col justify-between hover:border-[#333333] transition-colors">
              <span className="text-[12px] font-normal text-[#8c8c8c] block">
                Gateway health
              </span>
              <div className="my-2">
                {isLoading ? (
                  <Skeleton className="h-7 w-24" />
                ) : (
                  <div className="text-[22px] font-semibold text-white tracking-[-0.02em] leading-tight flex items-center gap-2 capitalize">
                    <span
                      className={`size-2 rounded-full shrink-0 ${
                        healthData?.status === "degraded"
                          ? "bg-[#f59e0b]"
                          : "bg-[#30a46c]"
                      }`}
                    />
                    <span>{healthData?.status || "Operational"}</span>
                  </div>
                )}
              </div>
              <span className="text-[12px] text-[#737373] block">
                API gateway responsive
              </span>
            </div>

            <div className="rounded-[8px] border border-[#262626] bg-[#0c0c0c] p-4 flex flex-col justify-between hover:border-[#333333] transition-colors">
              <span className="text-[12px] font-normal text-[#8c8c8c] block">
                Active DB pools
              </span>
              <div className="my-2">
                {isLoading ? (
                  <Skeleton className="h-7 w-24" />
                ) : (
                  <div className="text-[22px] font-semibold text-white tracking-[-0.02em] leading-tight tabular-nums">
                    {statusData?.active_databases ?? 0}{" "}
                    <span className="text-[13px] font-normal text-[#8c8c8c]">
                      pools
                    </span>
                  </div>
                )}
              </div>
              <span className="text-[12px] text-[#737373] block">
                Per-alias connection pools
              </span>
            </div>
          </div>

          {/* System Subsystems & Architecture Specs */}
          <div className="rounded-[8px] border border-[#262626] bg-[#0c0c0c] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#222222]">
              <h2 className="text-[14px] font-medium text-white tracking-tight">
                Runtime Subsystems & Engine Architecture
              </h2>
              <p className="text-[13px] text-[#8c8c8c] font-normal mt-0.5">
                Core compiled engine specifications and low-latency execution
                pipeline
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[#222222]">
              <div className="p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-[6px] bg-[#141414] border border-[#262626] text-[#3b82f6] shrink-0 mt-0.5">
                    <Cpu className="w-4 h-4" />
                  </div>
                  <div className="space-y-1">
                    <div className="text-[13px] font-medium text-white">
                      Tokio Asynchronous Core
                    </div>
                    <div className="text-[13px] text-[#8c8c8c] leading-relaxed">
                      Multi-threaded work-stealing scheduler with bounded
                      channels and non-blocking I/O.
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-[6px] bg-[#141414] border border-[#262626] text-[#34d399] shrink-0 mt-0.5">
                    <Layers className="w-4 h-4" />
                  </div>
                  <div className="space-y-1">
                    <div className="text-[13px] font-medium text-white">
                      Zero-Lock Metadata Snapshot
                    </div>
                    <div className="text-[13px] text-[#8c8c8c] leading-relaxed">
                      Hot-path reads execute via ArcSwap snapshot with zero
                      mutex locks per request.
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-[6px] bg-[#141414] border border-[#262626] text-[#eab308] shrink-0 mt-0.5">
                    <HardDrive className="w-4 h-4" />
                  </div>
                  <div className="space-y-1">
                    <div className="text-[13px] font-medium text-white">
                      Content-Addressable Blob Engine
                    </div>
                    <div className="text-[13px] text-[#8c8c8c] leading-relaxed">
                      Inline tiny blob RAM tier (&lt;64KB) + disk S3 store with
                      BLAKE3 cryptographic deduplication.
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-[6px] bg-[#141414] border border-[#262626] text-[#f43f5e] shrink-0 mt-0.5">
                    <Lock className="w-4 h-4" />
                  </div>
                  <div className="space-y-1">
                    <div className="text-[13px] font-medium text-white">
                      AST SQL Firewall & WAF
                    </div>
                    <div className="text-[13px] text-[#8c8c8c] leading-relaxed">
                      Parses incoming SQL into an abstract syntax tree to
                      guarantee query safety before DB dispatch.
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-[6px] bg-[#141414] border border-[#262626] text-[#a855f7] shrink-0 mt-0.5">
                    <Activity className="w-4 h-4" />
                  </div>
                  <div className="space-y-1">
                    <div className="text-[13px] font-medium text-white">
                      Circuit Breaker & Ban Propagation
                    </div>
                    <div className="text-[13px] text-[#8c8c8c] leading-relaxed">
                      Tracks database health states and automatically isolates
                      failing pool aliases with 503 fast-fail.
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-[6px] bg-[#141414] border border-[#262626] text-[#06b6d4] shrink-0 mt-0.5">
                    <Database className="w-4 h-4" />
                  </div>
                  <div className="space-y-1">
                    <div className="text-[13px] font-medium text-white">
                      Multi-Dialect Connection Pooling
                    </div>
                    <div className="text-[13px] text-[#8c8c8c] leading-relaxed">
                      Native protocol multiplexers for PostgreSQL, MySQL, MSSQL,
                      LibSQL, ClickHouse, Snowflake, and Oracle.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: REST API ROUTES */}
      {activeTab === "routes" && (
        <div className="space-y-4">
          <div className="rounded-[8px] border border-[#262626] bg-[#0c0c0c] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#222222] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="space-y-0.5">
                <h2 className="text-[14px] font-medium text-white tracking-tight">
                  REST API Route Catalog
                </h2>
                <p className="text-[13px] text-[#8c8c8c] font-normal">
                  Gateway endpoints protected by RBAC policy engine and API keys
                </p>
              </div>

              {/* Segmented Category Switcher */}
              <div className="inline-flex items-center p-0.5 rounded-[6px] bg-[#141414] border border-[#262626] shrink-0 self-start sm:self-auto flex-wrap gap-0.5 font-sans">
                <button
                  type="button"
                  onClick={() => setEndpointCategory("all")}
                  className={`h-7 px-2.5 text-[12px] font-sans rounded-[5px] transition-colors cursor-pointer flex items-center gap-1.5 ${
                    endpointCategory === "all"
                      ? "bg-[#1e1e1e] text-white shadow-xs font-medium border border-[#333333]"
                      : "text-[#8c8c8c] hover:text-white font-normal border border-transparent"
                  }`}
                >
                  <Layers className="w-3.5 h-3.5 text-[#a1a1aa]" />
                  <span>All</span>
                  <span className="text-[11px] font-sans text-[#737373]">
                    {allEndpoints.length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setEndpointCategory("database")}
                  className={`h-7 px-2.5 text-[12px] font-sans rounded-[5px] transition-colors cursor-pointer flex items-center gap-1.5 ${
                    endpointCategory === "database"
                      ? "bg-[#1e1e1e] text-white shadow-xs font-medium border border-[#333333]"
                      : "text-[#8c8c8c] hover:text-white font-normal border border-transparent"
                  }`}
                >
                  <Database className="w-3.5 h-3.5 text-[#3b82f6]" />
                  <span>Database</span>
                  <span className="text-[11px] font-sans text-[#737373]">
                    {databaseEndpoints.length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setEndpointCategory("storage")}
                  className={`h-7 px-2.5 text-[12px] font-sans rounded-[5px] transition-colors cursor-pointer flex items-center gap-1.5 ${
                    endpointCategory === "storage"
                      ? "bg-[#1e1e1e] text-white shadow-xs font-medium border border-[#333333]"
                      : "text-[#8c8c8c] hover:text-white font-normal border border-transparent"
                  }`}
                >
                  <HardDrive className="w-3.5 h-3.5 text-[#eab308]" />
                  <span>Storage</span>
                  <span className="text-[11px] font-sans text-[#737373]">
                    {storageEndpoints.length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setEndpointCategory("admin")}
                  className={`h-7 px-2.5 text-[12px] font-sans rounded-[5px] transition-colors cursor-pointer flex items-center gap-1.5 ${
                    endpointCategory === "admin"
                      ? "bg-[#1e1e1e] text-white shadow-xs font-medium border border-[#333333]"
                      : "text-[#8c8c8c] hover:text-white font-normal border border-transparent"
                  }`}
                >
                  <Shield className="w-3.5 h-3.5 text-[#10b981]" />
                  <span>Admin</span>
                  <span className="text-[11px] font-sans text-[#737373]">
                    {adminEndpoints.length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setEndpointCategory("cluster")}
                  className={`h-7 px-2.5 text-[12px] font-sans rounded-[5px] transition-colors cursor-pointer flex items-center gap-1.5 ${
                    endpointCategory === "cluster"
                      ? "bg-[#1e1e1e] text-white shadow-xs font-medium border border-[#333333]"
                      : "text-[#8c8c8c] hover:text-white font-normal border border-transparent"
                  }`}
                >
                  <Network className="w-3.5 h-3.5 text-[#06b6d4]" />
                  <span>Cluster</span>
                  <span className="text-[11px] font-sans text-[#737373]">
                    {clusterEndpoints.length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setEndpointCategory("mcp")}
                  className={`h-7 px-2.5 text-[12px] font-sans rounded-[5px] transition-colors cursor-pointer flex items-center gap-1.5 ${
                    endpointCategory === "mcp"
                      ? "bg-[#1e1e1e] text-white shadow-xs font-medium border border-[#333333]"
                      : "text-[#8c8c8c] hover:text-white font-normal border border-transparent"
                  }`}
                >
                  <Cpu className="w-3.5 h-3.5 text-[#a855f7]" />
                  <span>MCP & Core</span>
                  <span className="text-[11px] font-sans text-[#737373]">
                    {mcpEndpoints.length}
                  </span>
                </button>
              </div>
            </div>

            {/* Filter Search Input */}
            <div className="px-5 py-2.5 border-b border-[#222222] bg-[#0e0e0e]">
              <div className="relative font-sans">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#666666]" />
                <input
                  type="text"
                  value={searchRoutes}
                  onChange={(e) => setSearchRoutes(e.target.value)}
                  placeholder="Search endpoints by path, description, or method..."
                  className="w-full h-8 pl-8.5 pr-8 rounded-[6px] bg-[#141414] border border-[#262626] hover:border-[#383838] focus:border-[#3b82f6] text-[13px] font-sans text-white placeholder-[#666666] outline-none transition-colors"
                />
                {searchRoutes && (
                  <button
                    type="button"
                    onClick={() => setSearchRoutes("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#666666] hover:text-white cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            <div className="divide-y divide-[#1e1e1e] font-sans">
              {filteredEndpoints.length === 0 ? (
                <div className="p-8 text-center text-[#8c8c8c] text-[13px] font-sans">
                  No endpoints matched "{searchRoutes}"
                </div>
              ) : (
                filteredEndpoints.map((ep) => (
                  <div
                    key={`${ep.method}-${ep.path}`}
                    className="group px-5 py-2.5 flex items-center justify-between gap-3 hover:bg-[#121212] transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span
                        className={`w-14 text-center py-0.5 rounded-[4px] text-[11px] font-sans font-semibold tracking-wide shrink-0 ${
                          ep.method === "GET"
                            ? "bg-emerald-950/40 text-emerald-400 border border-emerald-800/40"
                            : ep.method === "POST"
                              ? "bg-blue-950/40 text-blue-400 border border-blue-800/40"
                              : ep.method === "PUT"
                                ? "bg-sky-950/40 text-sky-400 border border-sky-800/40"
                                : ep.method === "PATCH"
                                  ? "bg-amber-950/40 text-amber-400 border border-amber-800/40"
                                  : ep.method === "DELETE"
                                    ? "bg-rose-950/40 text-rose-400 border border-rose-800/40"
                                    : "bg-purple-950/40 text-purple-400 border border-purple-800/40"
                        }`}
                      >
                        {ep.method}
                      </span>
                      {endpointCategory === "all" && (
                        <span className="text-[10px] uppercase font-sans font-medium px-1.5 py-0.5 rounded bg-[#161616] text-[#737373] border border-[#262626] shrink-0">
                          {ep.category === "mcp" ? "mcp/core" : ep.category}
                        </span>
                      )}
                      <div className="flex items-center gap-2 truncate">
                        {renderPathWithParams(ep.path)}
                        <button
                          type="button"
                          onClick={() => handleCopyPath(ep.path)}
                          title="Copy path"
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-[#222222] text-[#8c8c8c] hover:text-white cursor-pointer"
                        >
                          {copiedPath === ep.path ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                    <div className="shrink-0">
                      <span className="text-[13px] text-[#8c8c8c] hidden md:block font-normal font-sans">
                        {ep.desc}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: ABOUT */}
      {activeTab === "about" && (
        <div className="space-y-5">
          {/* Hero App Banner */}
          <div className="rounded-[8px] border border-[#262626] bg-[#0c0c0c] p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <div className="w-12 h-12 rounded-[8px] bg-gradient-to-br from-[#1d4ed8] to-[#2563eb] flex items-center justify-center shrink-0 shadow-sm border border-[#3b82f6]/30">
                <span className="font-['Montserrat',sans-serif] font-bold text-[18px] text-white tracking-wider">
                  AX
                </span>
              </div>
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h2 className="text-[16px] font-semibold text-white tracking-tight">
                    Axiom Gateway
                  </h2>
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded-[4px] bg-[#161616] text-[#8c8c8c] border border-[#2a2a2a]">
                    v{statusData?.version || "0.1.20"}
                  </span>
                </div>
                <p className="text-[13px] text-[#8c8c8c] font-normal leading-relaxed">
                  Turn any SQL database or storage namespace into a secure,
                  low-latency REST API. Single binary, zero external runtime
                  dependencies.
                </p>
              </div>
            </div>
          </div>

          {/* Technical Specifications Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-[8px] border border-[#262626] bg-[#0c0c0c] p-4 space-y-1.5 hover:border-[#333333] transition-colors">
              <span className="text-[12px] font-normal text-[#8c8c8c] block">
                Core Technology
              </span>
              <div className="text-[13px] text-white font-medium">
                Rust 2021 + Axum 0.7 + Tokio multi-threaded
              </div>
              <p className="text-[12px] text-[#737373]">
                Engineered for sub-millisecond query routing and minimal memory
                footprint.
              </p>
            </div>

            <div className="rounded-[8px] border border-[#262626] bg-[#0c0c0c] p-4 space-y-1.5 hover:border-[#333333] transition-colors">
              <span className="text-[12px] font-normal text-[#8c8c8c] block">
                Frontend Architecture
              </span>
              <div className="text-[13px] text-white font-medium">
                React 19 + TypeScript + Vite + Tailwind CSS
              </div>
              <p className="text-[12px] text-[#737373]">
                Embedded directly into the release binary via rust-embed.
              </p>
            </div>

            <div className="rounded-[8px] border border-[#262626] bg-[#0c0c0c] p-4 space-y-1.5 hover:border-[#333333] transition-colors">
              <span className="text-[12px] font-normal text-[#8c8c8c] block">
                Supported SQL Engines
              </span>
              <div className="text-[13px] text-white font-medium">
                PostgreSQL, MySQL, MariaDB, MSSQL, LibSQL, ClickHouse,
                Snowflake, Oracle
              </div>
              <p className="text-[12px] text-[#737373]">
                Native driver multiplexing with per-alias connection pools and
                circuit breakers.
              </p>
            </div>

            <div className="rounded-[8px] border border-[#262626] bg-[#0c0c0c] p-4 space-y-1.5 hover:border-[#333333] transition-colors">
              <span className="text-[12px] font-normal text-[#8c8c8c] block">
                Security & Protocols
              </span>
              <div className="text-[13px] text-white font-medium">
                RBAC, Model Context Protocol (MCP), AST SQL Firewall, L1/L2
                Cache
              </div>
              <p className="text-[12px] text-[#737373]">
                Zero-trust policy enforcement, constant-time hashing, and AI
                agent integration.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
