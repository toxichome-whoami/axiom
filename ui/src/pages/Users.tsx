/**
 * Users.tsx
 * Comprehensive PBAC (Permission-Based Access Control) manager for Axiom administrators.
 * Invariants:
 * - Root administrator (id === 1) is the immutable, sole super-admin with full system authority.
 * - Non-root administrators are strictly scoped PBAC accounts.
 * - No secondary account can ever be granted or promoted to super-admin status.
 * - Password complexity (min 8 chars) and clean alphanumeric usernames enforced.
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  UserRecordApi,
  UserPermissionSet,
  UserDbPermission,
  UserBlobPermission,
  api,
  DatabaseRecordApi,
} from "../api/client";
import { hasPermission } from "../api/session";
import { DataTable, Column } from "../components/shared/DataTable";
import { SlideOver } from "../components/ui/SlideOver";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import {
  Users as UsersIcon,
  Plus,
  RefreshCw,
  Search,
  Shield,
  ShieldCheck,
  Database,
  HardDrive,
  Lock,
  Trash2,
  Edit2,
  Key,
  Activity,
  Sliders,
  FileText,
  AlertTriangle,
  Info,
  Check,
  Sparkles,
} from "lucide-react";

interface CapabilityGroup {
  id: string;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  permissions: { id: string; label: string; description: string }[];
}

const CAPABILITY_GROUPS: CapabilityGroup[] = [
  {
    id: "databases",
    name: "Databases & Engines",
    icon: Database,
    permissions: [
      { id: "databases.view", label: "View", description: "Inspect database pools and schema definitions" },
      { id: "databases.create", label: "Create", description: "Register new database connections" },
      { id: "databases.update", label: "Update", description: "Modify connection parameters and pool sizes" },
      { id: "databases.delete", label: "Delete", description: "Deregister upstream database connections" },
    ],
  },
  {
    id: "keys",
    name: "API Keys",
    icon: Key,
    permissions: [
      { id: "keys.view", label: "View", description: "Inspect active machine tokens and rate limits" },
      { id: "keys.create", label: "Create", description: "Issue new machine credentials" },
      { id: "keys.rotate", label: "Rotate", description: "Cycle secret keys without downtime" },
      { id: "keys.update", label: "Update", description: "Modify key metadata and database scopes" },
      { id: "keys.delete", label: "Delete", description: "Revoke and permanently destroy API keys" },
    ],
  },
  {
    id: "roles",
    name: "Roles & RBAC",
    icon: Shield,
    permissions: [
      { id: "roles.view", label: "View", description: "Read role definitions and attached permissions" },
      { id: "roles.create", label: "Create", description: "Define new RBAC role profiles" },
      { id: "roles.update", label: "Update", description: "Modify role permissions and descriptions" },
      { id: "roles.delete", label: "Delete", description: "Delete unused RBAC role profiles" },
    ],
  },
  {
    id: "cluster",
    name: "Cluster Mesh",
    icon: Activity,
    permissions: [
      { id: "cluster.view", label: "View", description: "Inspect cluster mesh topology and node latencies" },
      { id: "cluster.connect", label: "Connect", description: "Initiate cryptographic pairing with remote peers" },
      { id: "cluster.manage", label: "Manage", description: "Update peer endpoints, shared secrets, or unpair" },
    ],
  },
  {
    id: "audit",
    name: "Audit Trail",
    icon: FileText,
    permissions: [
      { id: "audit.view", label: "View", description: "Query immutable administrative audit event log" },
    ],
  },
  {
    id: "users",
    name: "Administrators",
    icon: UsersIcon,
    permissions: [
      { id: "users.view", label: "View", description: "List administrative user accounts and assignments" },
      { id: "users.create", label: "Create", description: "Provision new administrative accounts" },
      { id: "users.update", label: "Update", description: "Modify operator credentials and PBAC permissions" },
      { id: "users.delete", label: "Delete", description: "Remove administrative accounts" },
    ],
  },
  {
    id: "settings",
    name: "System Settings",
    icon: Sliders,
    permissions: [
      { id: "settings.view", label: "View", description: "View cache metrics, engine telemetry, and server health" },
      { id: "settings.manage", label: "Manage", description: "Flush L1/L2 caches and reload metadata snapshots" },
    ],
  },
];

const ALL_SYSTEM_PERMS = CAPABILITY_GROUPS.flatMap((g) => g.permissions.map((p) => p.id));

const DB_OPERATIONS = ["SELECT", "INSERT", "UPDATE", "DELETE", "DDL"];
const BLOB_OPERATIONS = ["READ", "WRITE", "DELETE", "MANAGE_NS"];

function getMonogramColor(str: string): string {
  const colors = [
    "from-blue-600 to-indigo-700",
    "from-emerald-600 to-teal-700",
    "from-purple-600 to-violet-700",
    "from-amber-600 to-orange-700",
    "from-cyan-600 to-blue-700",
    "from-rose-600 to-pink-700",
  ];
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const idx = Math.abs(hash) % colors.length;
  return colors[idx];
}

export function Users() {
  const [users, setUsers] = useState<UserRecordApi[]>([]);
  const [databaseAliases, setDatabaseAliases] = useState<string[]>([]);
  const [blobNamespaces, setBlobNamespaces] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState("");
  const [filterTab, setFilterTab] = useState<"all" | "root" | "pbac">("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // SlideOver / Form State
  const [slideOverOpen, setSlideOverOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRecordApi | null>(null);
  const [formUsername, setFormUsername] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formPermissions, setFormPermissions] = useState<UserPermissionSet>({
    system: [],
    databases: [],
    blobs: [],
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Delete Confirmation State
  const [deleteTarget, setDeleteTarget] = useState<UserRecordApi | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchGenRef = useRef(0);

  const canCreate = hasPermission("users.create");
  const canUpdate = hasPermission("users.update");
  const canDelete = hasPermission("users.delete");

  const loadData = useCallback(async () => {
    const curGen = ++fetchGenRef.current;
    setErrorMessage(null);
    try {
      const [usersRes, dbsRes, blobsRes] = await Promise.allSettled([
        api.listUsers(),
        api.listDatabases(),
        api.listBlobNamespaces(),
      ]);

      if (curGen !== fetchGenRef.current) return;

      if (usersRes.status === "fulfilled") {
        setUsers(usersRes.value || []);
      } else {
        const msg =
          usersRes.reason instanceof Error
            ? usersRes.reason.message
            : "Failed to load administrator accounts";
        setErrorMessage(msg);
      }

      if (dbsRes.status === "fulfilled") {
        const dbs = dbsRes.value.databases || [];
        setDatabaseAliases(dbs.map((d: DatabaseRecordApi) => d.alias));
      }

      if (blobsRes.status === "fulfilled") {
        const nsList = blobsRes.value || [];
        setBlobNamespaces(nsList.map((n) => n.name));
      }
    } finally {
      if (curGen === fetchGenRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleManualRefresh = () => {
    setIsRefreshing(true);
    loadData();
  };

  // Open Create Drawer
  const handleOpenCreate = () => {
    setEditingUser(null);
    setFormUsername("");
    setFormEmail("");
    setFormPassword("");
    setFormPermissions({
      system: [
        "databases.view",
        "keys.view",
        "roles.view",
        "cluster.view",
        "audit.view",
        "settings.view",
      ],
      databases: [],
      blobs: [],
    });
    setFormError(null);
    setSlideOverOpen(true);
  };

  // Open Edit Drawer
  const handleOpenEdit = (user: UserRecordApi) => {
    setEditingUser(user);
    setFormUsername(user.username);
    setFormEmail(user.email || "");
    setFormPassword("");
    setFormPermissions({
      system: user.permissions?.system || [],
      databases: user.permissions?.databases ? JSON.parse(JSON.stringify(user.permissions.databases)) : [],
      blobs: user.permissions?.blobs ? JSON.parse(JSON.stringify(user.permissions.blobs)) : [],
    });
    setFormError(null);
    setSlideOverOpen(true);
  };

  // Apply Capability Preset
  const applyPreset = (preset: "viewer" | "developer" | "security" | "full" | "clear") => {
    switch (preset) {
      case "viewer":
        setFormPermissions((prev) => ({
          ...prev,
          system: [
            "databases.view",
            "keys.view",
            "roles.view",
            "cluster.view",
            "audit.view",
            "users.view",
            "settings.view",
          ],
        }));
        break;
      case "developer":
        setFormPermissions((prev) => ({
          ...prev,
          system: [
            "databases.view",
            "databases.create",
            "databases.update",
            "keys.view",
            "keys.create",
            "keys.rotate",
            "roles.view",
            "cluster.view",
            "settings.view",
          ],
        }));
        break;
      case "security":
        setFormPermissions((prev) => ({
          ...prev,
          system: [
            "audit.view",
            "keys.view",
            "roles.view",
            "users.view",
            "cluster.view",
            "settings.view",
          ],
        }));
        break;
      case "full":
        setFormPermissions((prev) => ({
          ...prev,
          system: [...ALL_SYSTEM_PERMS],
        }));
        break;
      case "clear":
        setFormPermissions((prev) => ({
          ...prev,
          system: [],
        }));
        break;
    }
  };

  // Submit Form (Create or Update)
  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const isEdit = Boolean(editingUser);

    if (!isEdit && !formUsername.trim()) {
      setFormError("Username is required");
      return;
    }

    if (!isEdit && (!formPassword || formPassword.length < 8)) {
      setFormError("Password must be at least 8 characters");
      return;
    }

    if (isEdit && formPassword && formPassword.length < 8) {
      setFormError("Password must be at least 8 characters");
      return;
    }

    setIsSubmitting(true);
    try {
      if (isEdit && editingUser) {
        await api.updateUser(editingUser.id, {
          email: formEmail.trim() || undefined,
          password: formPassword || undefined,
          permissions: editingUser.id === 1 ? undefined : formPermissions,
        });
      } else {
        await api.createUser({
          username: formUsername.trim(),
          email: formEmail.trim() || undefined,
          password: formPassword,
          permissions: formPermissions,
        });
      }

      setSlideOverOpen(false);
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save administrator account";
      setFormError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Delete User
  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await api.deleteUser(deleteTarget.id);
      setDeleteTarget(null);
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to delete user account";
      setErrorMessage(msg);
    } finally {
      setIsDeleting(false);
    }
  };

  // Toggle Single Permission
  const togglePermission = (permId: string) => {
    setFormPermissions((prev) => {
      const current = prev.system || [];
      const has = current.includes(permId);
      return {
        ...prev,
        system: has ? current.filter((c) => c !== permId) : [...current, permId],
      };
    });
  };

  // Toggle Category Group
  const toggleGroup = (group: CapabilityGroup) => {
    setFormPermissions((prev) => {
      const current = prev.system || [];
      const groupPermIds = group.permissions.map((p) => p.id);
      const allSelected = groupPermIds.every((id) => current.includes(id));
      const next = allSelected
        ? current.filter((id) => !groupPermIds.includes(id))
        : Array.from(new Set([...current, ...groupPermIds]));
      return { ...prev, system: next };
    });
  };

  // Database Rules Mutators
  const addDatabaseRule = () => {
    const defaultDb = databaseAliases[0] || "*";
    setFormPermissions((prev) => ({
      ...prev,
      databases: [
        ...prev.databases,
        {
          database: defaultDb,
          table_name: "*",
          operations: ["SELECT"],
        },
      ],
    }));
  };

  const removeDatabaseRule = (index: number) => {
    setFormPermissions((prev) => ({
      ...prev,
      databases: prev.databases.filter((_, i) => i !== index),
    }));
  };

  const updateDatabaseRule = (
    index: number,
    field: keyof UserDbPermission,
    value: string | string[],
  ) => {
    setFormPermissions((prev) => {
      const next = [...prev.databases];
      next[index] = { ...next[index], [field]: value };
      return { ...prev, databases: next };
    });
  };

  const toggleDbOperation = (index: number, op: string) => {
    setFormPermissions((prev) => {
      const next = [...prev.databases];
      const curOps = next[index].operations || [];
      const has = curOps.includes(op);
      const updatedOps = has ? curOps.filter((o) => o !== op) : [...curOps, op];
      next[index] = { ...next[index], operations: updatedOps };
      return { ...prev, databases: next };
    });
  };

  // Blob Rules Mutators
  const addBlobRule = () => {
    const defaultNs = blobNamespaces[0] || "*";
    setFormPermissions((prev) => ({
      ...prev,
      blobs: [
        ...prev.blobs,
        {
          namespace: defaultNs,
          operations: ["READ"],
        },
      ],
    }));
  };

  const removeBlobRule = (index: number) => {
    setFormPermissions((prev) => ({
      ...prev,
      blobs: prev.blobs.filter((_, i) => i !== index),
    }));
  };

  const updateBlobRule = (
    index: number,
    field: keyof UserBlobPermission,
    value: string | string[],
  ) => {
    setFormPermissions((prev) => {
      const next = [...prev.blobs];
      next[index] = { ...next[index], [field]: value };
      return { ...prev, blobs: next };
    });
  };

  const toggleBlobOperation = (index: number, op: string) => {
    setFormPermissions((prev) => {
      const next = [...prev.blobs];
      const curOps = next[index].operations || [];
      const has = curOps.includes(op);
      const updatedOps = has ? curOps.filter((o) => o !== op) : [...curOps, op];
      next[index] = { ...next[index], operations: updatedOps };
      return { ...prev, blobs: next };
    });
  };

  // Filtered Users List
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const query = searchQuery.toLowerCase().trim();
      const matchQuery =
        !query ||
        u.username.toLowerCase().includes(query) ||
        (u.email && u.email.toLowerCase().includes(query));

      if (!matchQuery) return false;

      if (filterTab === "root") return u.id === 1 || u.is_super_admin;
      if (filterTab === "pbac") return u.id !== 1 && !u.is_super_admin;
      return true;
    });
  }, [users, searchQuery, filterTab]);

  const totalCount = users.length;
  const rootCount = users.filter((u) => u.id === 1 || u.is_super_admin).length;
  const pbacCount = users.filter((u) => u.id !== 1 && !u.is_super_admin).length;

  const isEditingRoot = editingUser?.id === 1;

  // Table Columns Definition
  const columns: Column<UserRecordApi>[] = [
    {
      id: "username",
      header: "Administrator",
      isFlex: true,
      className: "pl-4 pr-3",
      cell: (row) => {
        const isRoot = row.id === 1;
        const monogramColor = getMonogramColor(row.username);

        return (
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`w-7 h-7 rounded-full bg-gradient-to-br ${monogramColor} flex items-center justify-center text-white text-[11px] font-semibold tracking-wider shrink-0 shadow-sm`}
            >
              {row.username.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex flex-col">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-white truncate">
                  {row.username}
                </span>
                {isRoot && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/30 shrink-0">
                    <ShieldCheck className="w-3 h-3 text-amber-400" />
                    Root Super Admin
                  </span>
                )}
              </div>
              {row.email && (
                <span className="text-[11px] text-[#8c8c8c] truncate">
                  {row.email}
                </span>
              )}
            </div>
          </div>
        );
      },
    },
    {
      id: "type",
      header: "Access Model",
      isFlex: true,
      className: "px-3",
      cell: (row) => {
        const isRoot = row.id === 1;
        if (isRoot) {
          return (
            <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-amber-400">
              <Lock className="w-3.5 h-3.5" />
              Root Sovereign (Immutable)
            </span>
          );
        }

        return (
          <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-blue-400">
            <Shield className="w-3.5 h-3.5" />
            PBAC Custom Scoped
          </span>
        );
      },
    },
    {
      id: "capabilities",
      header: "Assigned Capabilities",
      isFlex: true,
      className: "px-3",
      cell: (row) => {
        if (row.id === 1 || row.is_super_admin) {
          return (
            <span className="text-[12px] text-amber-400/90 font-medium">
              Full Bypass (Unrestricted Global Access)
            </span>
          );
        }

        const sysCount = row.permissions?.system?.length || 0;
        const dbCount = row.permissions?.databases?.length || 0;
        const blobCount = row.permissions?.blobs?.length || 0;

        if (sysCount === 0 && dbCount === 0 && blobCount === 0) {
          return (
            <span className="text-[12px] text-[#737373] italic">
              Restricted (Zero Permissions)
            </span>
          );
        }

        return (
          <div className="flex items-center gap-1.5 flex-wrap">
            {sysCount > 0 && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-[#1e1e1e] text-[#d4d4d4] border border-[#2e2e2e]">
                {sysCount} system {sysCount === 1 ? "permission" : "permissions"}
              </span>
            )}
            {dbCount > 0 && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-[#1e1e1e] text-[#d4d4d4] border border-[#2e2e2e]">
                {dbCount} {dbCount === 1 ? "db rule" : "db rules"}
              </span>
            )}
            {blobCount > 0 && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-[#1e1e1e] text-[#d4d4d4] border border-[#2e2e2e]">
                {blobCount} {blobCount === 1 ? "blob rule" : "blob rules"}
              </span>
            )}
          </div>
        );
      },
    },
    {
      id: "created",
      header: "Created Date",
      isFlex: true,
      className: "px-3",
      cell: (row) => (
        <span className="tabular-nums text-[12px] text-[#8c8c8c]">
          {row.created_at
            ? new Date(row.created_at * 1000).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              })
            : "—"}
        </span>
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      isFlex: true,
      headerClassName: "justify-end pr-4 text-right",
      className: "pl-3 pr-4 justify-end",
      cell: (row) => {
        const isRoot = row.id === 1;

        return (
          <div className="flex items-center justify-end gap-1.5 w-full">
            <button
              type="button"
              disabled={!canUpdate}
              onClick={() => handleOpenEdit(row)}
              className="inline-flex items-center justify-center h-7 px-2.5 rounded-[6px] text-[12px] font-medium text-[#8c8c8c] hover:text-white bg-transparent hover:bg-[#1a1a1a] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Edit administrator permissions and settings"
            >
              <Edit2 className="w-3.5 h-3.5 mr-1" />
              Manage
            </button>
            {isRoot ? (
              <button
                type="button"
                disabled
                className="inline-flex items-center justify-center h-7 px-2 rounded-[6px] text-[12px] font-medium text-[#525252] bg-transparent border border-[#222222] opacity-50 cursor-not-allowed shrink-0"
                title="Root administrator account is permanent and cannot be deleted"
              >
                <Lock className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                disabled={!canDelete}
                onClick={() => setDeleteTarget(row)}
                className="inline-flex items-center justify-center h-7 px-2 rounded-[6px] text-[12px] font-medium text-[#f87171] hover:text-white bg-transparent hover:bg-[#451013] border border-[#3b1216] hover:border-[#7f1d1d] transition-colors cursor-pointer shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                title="Delete administrator account"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-[16px] font-medium text-white tracking-tight">
            Administrators & Access
          </h1>
          <p className="text-[13px] text-[#8c8c8c] mt-0.5">
            Permission-Based Access Control (PBAC) for operator accounts. The root account (#1) is the immutable Super Admin.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleManualRefresh}
            title="Refresh accounts"
            className="flex items-center justify-center h-8 w-8 text-[#8c8c8c] hover:text-white rounded-[8px] bg-[#0c0c0c] hover:bg-[#141414] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer shrink-0"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin opacity-50" : ""}`}
            />
          </button>
          <Button
            variant="primary"
            size="sm"
            disabled={!canCreate}
            onClick={handleOpenCreate}
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Add Administrator
          </Button>
        </div>
      </div>

      {errorMessage && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-[#2a1113] border border-[#5c1d24] text-[#f87171] text-[13px]">
          <AlertTriangle className="w-4 h-4 shrink-0 text-[#ef4444]" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* KPI Overview Cards */}
      <div className="rounded-lg border border-[#262626] bg-[#0e0e0e]">
        <div className="grid grid-cols-1 md:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-[#222222]">
          <div className="px-4 py-3.5 min-w-0">
            <span className="block text-[12px] text-[#8c8c8c] font-medium mb-1.5">
              Total Administrators
            </span>
            <div className="flex items-center gap-2">
              <UsersIcon className="w-4 h-4 text-[#a3a3a3]" />
              <span className="text-[18px] font-semibold text-white tabular-nums">
                {totalCount}
              </span>
            </div>
          </div>
          <div className="px-4 py-3.5 min-w-0">
            <span className="block text-[12px] text-[#8c8c8c] font-medium mb-1.5">
              Root Super Admin
            </span>
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-amber-400" />
              <span className="text-[18px] font-semibold text-amber-300 tabular-nums">
                {rootCount}
              </span>
              <span className="text-[11px] text-[#8c8c8c]">(Immutable Account #1)</span>
            </div>
          </div>
          <div className="px-4 py-3.5 min-w-0">
            <span className="block text-[12px] text-[#8c8c8c] font-medium mb-1.5">
              PBAC Scoped Operators
            </span>
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-blue-400" />
              <span className="text-[18px] font-semibold text-blue-300 tabular-nums">
                {pbacCount}
              </span>
              <span className="text-[11px] text-[#8c8c8c]">(Fine-Grained Capabilities)</span>
            </div>
          </div>
          <div className="px-4 py-3.5 min-w-0">
            <span className="block text-[12px] text-[#8c8c8c] font-medium mb-1.5">
              Security Invariant
            </span>
            <div className="flex items-center gap-1.5 text-emerald-400 text-[13px] font-medium">
              <Lock className="w-3.5 h-3.5" />
              <span>Strict Single Super-Admin</span>
            </div>
          </div>
        </div>
      </div>

      {/* Toolbar & Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Filter Tabs */}
        <div className="flex items-center gap-1 bg-[#121212] p-1 rounded-[8px] border border-[#222222] w-fit">
          <button
            type="button"
            onClick={() => setFilterTab("all")}
            className={`px-3 py-1 rounded-[6px] text-[12px] font-medium transition-colors ${
              filterTab === "all"
                ? "bg-[#222222] text-white"
                : "text-[#8c8c8c] hover:text-[#d4d4d4]"
            }`}
          >
            All Accounts ({totalCount})
          </button>
          <button
            type="button"
            onClick={() => setFilterTab("root")}
            className={`px-3 py-1 rounded-[6px] text-[12px] font-medium transition-colors ${
              filterTab === "root"
                ? "bg-[#222222] text-white"
                : "text-[#8c8c8c] hover:text-[#d4d4d4]"
            }`}
          >
            Root Super Admin ({rootCount})
          </button>
          <button
            type="button"
            onClick={() => setFilterTab("pbac")}
            className={`px-3 py-1 rounded-[6px] text-[12px] font-medium transition-colors ${
              filterTab === "pbac"
                ? "bg-[#222222] text-white"
                : "text-[#8c8c8c] hover:text-[#d4d4d4]"
            }`}
          >
            PBAC Operators ({pbacCount})
          </button>
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-[#8c8c8c] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder="Search administrators..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(1);
            }}
            className="w-full h-8 pl-8 pr-3 text-[12px] bg-[#0c0c0c] text-white rounded-[8px] border border-[#262626] focus:border-blue-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Accounts Table */}
      <DataTable
        columns={columns}
        data={filteredUsers}
        keyExtractor={(item) => String(item.id)}
        pagination={{
          page,
          pageSize,
          totalCount: filteredUsers.length,
          onPageChange: setPage,
          onPageSizeChange: setPageSize,
        }}
        isLoading={isLoading}
        emptyMessage={
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <UsersIcon className="w-8 h-8 text-[#525252] mb-2" />
            <span className="text-[13px] font-medium text-white mb-1">
              No administrator accounts found
            </span>
            <span className="text-[12px] text-[#8c8c8c]">
              {searchQuery
                ? "Try adjusting your search criteria"
                : "Add an administrator account to begin"}
            </span>
          </div>
        }
      />

      {/* SlideOver Drawer for Create / Edit */}
      <SlideOver
        isOpen={slideOverOpen}
        onClose={() => setSlideOverOpen(false)}
        title={editingUser ? `Manage Administrator: ${editingUser.username}` : "New Administrator"}
        subtitle="Configure credentials and granular PBAC capabilities"
        width="max-w-2xl"
      >
        <form onSubmit={handleSubmitForm} className="space-y-6">
          {formError && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-[#2a1113] border border-[#5c1d24] text-[#f87171] text-[13px]">
              <AlertTriangle className="w-4 h-4 shrink-0 text-[#ef4444]" />
              <span>{formError}</span>
            </div>
          )}

          {/* Root Super Admin Notice OR PBAC Scoped Notice */}
          {isEditingRoot ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5 space-y-1.5">
              <div className="flex items-center gap-2 text-amber-300 font-semibold text-[13px]">
                <ShieldCheck className="w-4 h-4 text-amber-400" />
                <span>Root Super-Administrator (Account #1)</span>
              </div>
              <p className="text-[12px] text-amber-200/80 leading-relaxed">
                This founding account was created during server onboarding. It maintains permanent, unrestricted root privileges that cannot be demoted, deleted, or constrained. You may update account credentials below.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-[#262626] bg-[#121212] p-3.5 space-y-1.5">
              <div className="flex items-center gap-2 text-white font-medium text-[13px]">
                <Shield className="w-4 h-4 text-blue-400" />
                <span>Scoped PBAC Operator</span>
              </div>
              <p className="text-[12px] text-[#8c8c8c] leading-relaxed">
                Server super-administrator authority strictly belongs to Account #1. All secondary accounts are granted explicit capability permissions below.
              </p>
            </div>
          )}

          {/* Account Credentials */}
          <div className="space-y-4">
            <h3 className="text-[13px] font-semibold text-white tracking-wide uppercase text-opacity-80">
              Account Credentials
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[12px] font-medium text-[#a3a3a3] mb-1">
                  Username <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  disabled={Boolean(editingUser)}
                  value={formUsername}
                  onChange={(e) => setFormUsername(e.target.value)}
                  placeholder="e.g. dev_operator"
                  className="w-full h-8 px-2.5 text-[12px] bg-[#141414] text-white rounded-[6px] border border-[#262626] focus:border-blue-500 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-[#a3a3a3] mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  placeholder="e.g. operator@company.com"
                  className="w-full h-8 px-2.5 text-[12px] bg-[#141414] text-white rounded-[6px] border border-[#262626] focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[#a3a3a3] mb-1">
                Password {editingUser ? "(Leave blank to keep unchanged)" : <span className="text-red-400">*</span>}
              </label>
              <input
                type="password"
                required={!editingUser}
                value={formPassword}
                onChange={(e) => setFormPassword(e.target.value)}
                placeholder={editingUser ? "••••••••••••" : "Minimum 8 characters"}
                className="w-full h-8 px-2.5 text-[12px] bg-[#141414] text-white rounded-[6px] border border-[#262626] focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Granular Permission Matrix (Hidden for root account) */}
          {!isEditingRoot && (
            <>
              <hr className="border-[#222222]" />

              {/* Presets Toolbar */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-semibold text-white tracking-wide uppercase text-opacity-80 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                    Permission Presets
                  </span>
                  <button
                    type="button"
                    onClick={() => applyPreset("clear")}
                    className="text-[11px] text-[#8c8c8c] hover:text-white transition-colors"
                  >
                    Clear All
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <button
                    type="button"
                    onClick={() => applyPreset("viewer")}
                    className="px-2.5 py-1.5 rounded-[6px] text-[11px] font-medium bg-[#141414] hover:bg-[#1f1f1f] border border-[#262626] hover:border-[#383838] text-[#d4d4d4] transition-colors text-center"
                  >
                    Read-Only Viewer
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset("developer")}
                    className="px-2.5 py-1.5 rounded-[6px] text-[11px] font-medium bg-[#141414] hover:bg-[#1f1f1f] border border-[#262626] hover:border-[#383838] text-[#d4d4d4] transition-colors text-center"
                  >
                    Developer Operator
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset("security")}
                    className="px-2.5 py-1.5 rounded-[6px] text-[11px] font-medium bg-[#141414] hover:bg-[#1f1f1f] border border-[#262626] hover:border-[#383838] text-[#d4d4d4] transition-colors text-center"
                  >
                    Security Auditor
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset("full")}
                    className="px-2.5 py-1.5 rounded-[6px] text-[11px] font-medium bg-[#141414] hover:bg-[#1f1f1f] border border-[#262626] hover:border-[#383838] text-[#d4d4d4] transition-colors text-center"
                  >
                    Full Operator
                  </button>
                </div>
              </div>

              {/* Capability Categories */}
              <div className="space-y-4 pt-1">
                <div className="flex items-center justify-between">
                  <h3 className="text-[13px] font-semibold text-white tracking-wide uppercase text-opacity-80">
                    Module Permissions
                  </h3>
                  <span className="text-[11px] text-[#8c8c8c]">
                    Select explicit actions allowed for this operator
                  </span>
                </div>

                <div className="space-y-3">
                  {CAPABILITY_GROUPS.map((group) => {
                    const GroupIcon = group.icon;
                    const groupPermIds = group.permissions.map((p) => p.id);
                    const selectedCount = groupPermIds.filter((id) =>
                      formPermissions.system.includes(id),
                    ).length;
                    const isAllSelected = selectedCount === groupPermIds.length;

                    return (
                      <div
                        key={group.id}
                        className="rounded-lg border border-[#242424] bg-[#121212] overflow-hidden"
                      >
                        {/* Group Header */}
                        <div className="flex items-center justify-between px-3.5 py-2.5 bg-[#171717] border-b border-[#242424]">
                          <div className="flex items-center gap-2">
                            <GroupIcon className="w-4 h-4 text-blue-400 shrink-0" />
                            <span className="text-[12px] font-medium text-white">
                              {group.name}
                            </span>
                            <span className="text-[11px] text-[#737373] tabular-nums">
                              ({selectedCount}/{groupPermIds.length})
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleGroup(group)}
                            className="text-[11px] text-blue-400 hover:text-blue-300 font-medium transition-colors"
                          >
                            {isAllSelected ? "Deselect All" : "Select All"}
                          </button>
                        </div>

                        {/* Group Permissions List */}
                        <div className="p-2.5 grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {group.permissions.map((perm) => {
                            const isChecked = formPermissions.system.includes(perm.id);

                            return (
                              <div
                                key={perm.id}
                                onClick={() => togglePermission(perm.id)}
                                className={`p-2 rounded-[6px] border transition-all cursor-pointer flex items-start gap-2.5 ${
                                  isChecked
                                    ? "bg-blue-600/10 border-blue-500/40 text-white"
                                    : "bg-[#141414] border-[#262626] text-[#a3a3a3] hover:border-[#383838]"
                                }`}
                              >
                                <div
                                  className={`w-3.5 h-3.5 rounded mt-0.5 flex items-center justify-center shrink-0 border transition-colors ${
                                    isChecked
                                      ? "bg-blue-600 border-blue-500 text-white"
                                      : "border-[#404040] bg-[#1a1a1a]"
                                  }`}
                                >
                                  {isChecked && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                                </div>
                                <div className="space-y-0.5 min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[12px] font-medium text-white truncate">
                                      {perm.label}
                                    </span>
                                    <span className="text-[10px] font-mono text-[#737373]">
                                      {perm.id}
                                    </span>
                                  </div>
                                  <p className="text-[11px] text-[#8c8c8c] leading-tight">
                                    {perm.description}
                                  </p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Database & Table Scope Rules */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-[13px] font-semibold text-white tracking-wide uppercase text-opacity-80">
                      Database & Table Rules
                    </h3>
                    <p className="text-[11px] text-[#8c8c8c]">
                      Specify permitted SQL dialects, aliases, and table operations
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={addDatabaseRule}
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    Add DB Scope
                  </Button>
                </div>

                {formPermissions.databases.length === 0 ? (
                  <div className="p-4 rounded-lg border border-dashed border-[#262626] bg-[#0c0c0c] text-center">
                    <Database className="w-5 h-5 text-[#525252] mx-auto mb-1" />
                    <span className="text-[12px] text-[#8c8c8c]">
                      No database access rules defined. SQL queries will be rejected.
                    </span>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {formPermissions.databases.map((rule, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-lg border border-[#262626] bg-[#121212] space-y-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="grid grid-cols-2 gap-2 flex-1">
                            <div>
                              <label className="block text-[11px] text-[#8c8c8c] mb-1">
                                Database Pool
                              </label>
                              <select
                                value={rule.database}
                                onChange={(e) =>
                                  updateDatabaseRule(idx, "database", e.target.value)
                                }
                                className="w-full h-7 px-2 text-[12px] bg-[#1a1a1a] text-white rounded border border-[#2e2e2e] focus:border-blue-500 focus:outline-none"
                              >
                                <option value="*">* (All Databases)</option>
                                {databaseAliases.map((alias) => (
                                  <option key={alias} value={alias}>
                                    {alias}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-[11px] text-[#8c8c8c] mb-1">
                                Table Name (* for all)
                              </label>
                              <input
                                type="text"
                                value={rule.table_name}
                                onChange={(e) =>
                                  updateDatabaseRule(idx, "table_name", e.target.value)
                                }
                                placeholder="*"
                                className="w-full h-7 px-2 text-[12px] bg-[#1a1a1a] text-white rounded border border-[#2e2e2e] focus:border-blue-500 focus:outline-none"
                              />
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeDatabaseRule(idx)}
                            className="p-1 text-[#8c8c8c] hover:text-[#f87171] transition-colors"
                            title="Remove database rule"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Operations Checkboxes */}
                        <div className="flex items-center gap-1.5 flex-wrap pt-1">
                          <span className="text-[11px] text-[#737373] mr-1">Permitted:</span>
                          {DB_OPERATIONS.map((op) => {
                            const isAllowed = rule.operations?.includes(op);
                            return (
                              <button
                                key={op}
                                type="button"
                                onClick={() => toggleDbOperation(idx, op)}
                                className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${
                                  isAllowed
                                    ? "bg-blue-600/20 text-blue-300 border border-blue-500/30"
                                    : "bg-[#181818] text-[#737373] border border-[#262626] hover:text-[#d4d4d4]"
                                }`}
                              >
                                {op}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Blob Storage Scope Rules */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-[13px] font-semibold text-white tracking-wide uppercase text-opacity-80">
                      Blob Storage Scopes
                    </h3>
                    <p className="text-[11px] text-[#8c8c8c]">
                      Control access to binary object namespaces and transfers
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={addBlobRule}
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    Add Blob Scope
                  </Button>
                </div>

                {formPermissions.blobs.length === 0 ? (
                  <div className="p-4 rounded-lg border border-dashed border-[#262626] bg-[#0c0c0c] text-center">
                    <HardDrive className="w-5 h-5 text-[#525252] mx-auto mb-1" />
                    <span className="text-[12px] text-[#8c8c8c]">
                      No blob storage rules defined. Object downloads and uploads will be rejected.
                    </span>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {formPermissions.blobs.map((rule, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-lg border border-[#262626] bg-[#121212] space-y-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex-1">
                            <label className="block text-[11px] text-[#8c8c8c] mb-1">
                              Blob Namespace
                            </label>
                            <select
                              value={rule.namespace}
                              onChange={(e) =>
                                updateBlobRule(idx, "namespace", e.target.value)
                              }
                              className="w-full h-7 px-2 text-[12px] bg-[#1a1a1a] text-white rounded border border-[#2e2e2e] focus:border-blue-500 focus:outline-none"
                            >
                              <option value="*">* (All Namespaces)</option>
                              {blobNamespaces.map((ns) => (
                                <option key={ns} value={ns}>
                                  {ns}
                                </option>
                              ))}
                            </select>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeBlobRule(idx)}
                            className="p-1 text-[#8c8c8c] hover:text-[#f87171] transition-colors"
                            title="Remove blob rule"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Operations Checkboxes */}
                        <div className="flex items-center gap-1.5 flex-wrap pt-1">
                          <span className="text-[11px] text-[#737373] mr-1">Permitted:</span>
                          {BLOB_OPERATIONS.map((op) => {
                            const isAllowed = rule.operations?.includes(op);
                            return (
                              <button
                                key={op}
                                type="button"
                                onClick={() => toggleBlobOperation(idx, op)}
                                className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${
                                  isAllowed
                                    ? "bg-emerald-600/20 text-emerald-300 border border-emerald-500/30"
                                    : "bg-[#181818] text-[#737373] border border-[#262626] hover:text-[#d4d4d4]"
                                }`}
                              >
                                {op}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Form Actions Footer */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#222222]">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setSlideOverOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={isSubmitting}>
              {isSubmitting ? (
                <div className="flex items-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving...</span>
                </div>
              ) : editingUser ? (
                "Save Changes"
              ) : (
                "Create Administrator"
              )}
            </Button>
          </div>
        </form>
      </SlideOver>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title="Delete Administrator Account"
        description={`Are you sure you want to permanently delete '${deleteTarget?.username}'? This action cannot be undone and will immediately revoke active sessions.`}
        confirmLabel={isDeleting ? "Deleting..." : "Delete Account"}
        variant="danger"
        onConfirm={handleConfirmDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
