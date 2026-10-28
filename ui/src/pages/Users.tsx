/**
 * Users.tsx
 * Comprehensive PBAC (Permission-Based Access Control) manager for Axiom administrators.
 * Invariants:
 * - Root administrator (id === 1) is the immutable, sole super-admin with full system authority.
 * - Non-root administrators are strictly scoped PBAC accounts.
 * - No secondary account can ever be granted or promoted to super-admin status.
 * - Password complexity (min 8 chars) and clean alphanumeric usernames enforced.
 */

import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
} from "react";
import { createPortal } from "react-dom";
import {
  UserRecordApi,
  UserPermissionSet,
  UserDbPermission,
  UserBlobPermission,
  api,
  DatabaseRecordApi,
} from "../api/client";
import {
  hasPermission,
  getCurrentUser,
  setCurrentUser,
  setSession,
  getSessionToken,
} from "../api/session";
import { DataTable, Column } from "../components/shared/DataTable";
import { SlideOver } from "../components/ui/SlideOver";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Skeleton } from "../components/ui/Skeleton";
import { CustomSelect } from "../components/shared/CustomSelect";
import { FilterRule, matchesRule } from "../utils/filters";
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
  Key,
  Activity,
  Sliders,
  FileText,
  AlertTriangle,
  Info,
  Check,
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
      {
        id: "databases.view",
        label: "View",
        description: "Inspect database pools and schema definitions",
      },
      {
        id: "databases.create",
        label: "Create",
        description: "Register new database connections",
      },
      {
        id: "databases.update",
        label: "Update",
        description: "Modify connection parameters and pool sizes",
      },
      {
        id: "databases.delete",
        label: "Delete",
        description: "Deregister upstream database connections",
      },
    ],
  },
  {
    id: "blobs",
    name: "Native Blob Storage",
    icon: HardDrive,
    permissions: [
      {
        id: "blobs.view",
        label: "View",
        description: "Inspect blob namespaces and storage usage",
      },
      {
        id: "blobs.create",
        label: "Create",
        description: "Provision new storage namespaces",
      },
      {
        id: "blobs.update",
        label: "Update",
        description: "Modify namespace quotas and settings",
      },
      {
        id: "blobs.delete",
        label: "Delete",
        description: "Remove namespaces and permanently delete data",
      },
    ],
  },
  {
    id: "keys",
    name: "API Keys",
    icon: Key,
    permissions: [
      {
        id: "keys.view",
        label: "View",
        description: "Inspect active machine tokens and rate limits",
      },
      {
        id: "keys.create",
        label: "Create",
        description: "Issue new machine credentials",
      },
      {
        id: "keys.rotate",
        label: "Rotate",
        description: "Cycle secret keys without downtime",
      },
      {
        id: "keys.update",
        label: "Update",
        description: "Modify key metadata and database scopes",
      },
      {
        id: "keys.delete",
        label: "Delete",
        description: "Revoke and permanently destroy API keys",
      },
    ],
  },
  {
    id: "roles",
    name: "Roles & RBAC",
    icon: Shield,
    permissions: [
      {
        id: "roles.view",
        label: "View",
        description: "Read role definitions and attached permissions",
      },
      {
        id: "roles.create",
        label: "Create",
        description: "Define new RBAC role profiles",
      },
      {
        id: "roles.update",
        label: "Update",
        description: "Modify role permissions and descriptions",
      },
      {
        id: "roles.delete",
        label: "Delete",
        description: "Delete unused RBAC role profiles",
      },
    ],
  },
  {
    id: "cluster",
    name: "Cluster Mesh",
    icon: Activity,
    permissions: [
      {
        id: "cluster.view",
        label: "View",
        description: "Inspect cluster mesh topology and node latencies",
      },
      {
        id: "cluster.connect",
        label: "Connect",
        description: "Initiate cryptographic pairing with remote peers",
      },
      {
        id: "cluster.manage",
        label: "Manage",
        description: "Update peer endpoints, shared secrets, or unpair",
      },
    ],
  },
  {
    id: "audit",
    name: "Audit Trail",
    icon: FileText,
    permissions: [
      {
        id: "audit.view",
        label: "View",
        description: "Query immutable administrative audit event log",
      },
    ],
  },
  {
    id: "users",
    name: "Users",
    icon: UsersIcon,
    permissions: [
      {
        id: "users.view",
        label: "View",
        description: "List user accounts and assignments",
      },
      {
        id: "users.create",
        label: "Create",
        description: "Provision new user accounts",
      },
      {
        id: "users.update",
        label: "Update",
        description: "Modify operator credentials and PBAC permissions",
      },
      {
        id: "users.delete",
        label: "Delete",
        description: "Remove user accounts",
      },
    ],
  },
  {
    id: "settings",
    name: "System Settings",
    icon: Sliders,
    permissions: [
      {
        id: "settings.view",
        label: "View",
        description: "View cache metrics, engine telemetry, and server health",
      },
      {
        id: "settings.manage",
        label: "Manage",
        description: "Flush L1/L2 caches and reload metadata snapshots",
      },
    ],
  },
];

const ALL_SYSTEM_PERMS = CAPABILITY_GROUPS.flatMap((g) =>
  g.permissions.map((p) => p.id),
);

const DB_OPERATIONS = ["SELECT", "INSERT", "UPDATE", "DELETE"];
const BLOB_OPERATIONS = ["READ", "WRITE", "DELETE", "MANAGE_NS"];

const filterFieldOptions = [
  { value: "username", label: "Username" },
  { value: "email", label: "Email" },
  { value: "role", label: "Access Level" },
];

const displayColumnOptions = [
  { id: "username", label: "Username" },
  { id: "email", label: "Email" },
  { id: "permissions", label: "Permissions" },
  { id: "createdAt", label: "Creation Date" },
  { id: "updatedAt", label: "Last Update Date" },
];

function formatDate(epochSec?: number): string {
  if (!epochSec || epochSec <= 0) return "—";
  return new Date(epochSec * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function resolveDependencies(perms: UserPermissionSet): UserPermissionSet {
  const sys = new Set(perms.system || []);

  // Database dependencies: any db rule or mutation requires databases.view
  const hasDbRules = Boolean(perms.databases && perms.databases.length > 0);
  const hasDbOps =
    sys.has("databases.create") ||
    sys.has("databases.update") ||
    sys.has("databases.delete") ||
    sys.has("db.create") ||
    sys.has("db.update") ||
    sys.has("db.delete") ||
    hasDbRules;
  if (hasDbOps) {
    sys.add("databases.view");
  }

  // Blob dependencies: any blob rule or mutation requires blobs.view
  const hasBlobRules = Boolean(perms.blobs && perms.blobs.length > 0);
  const hasBlobOps =
    sys.has("blobs.create") ||
    sys.has("blobs.update") ||
    sys.has("blobs.delete") ||
    sys.has("blob.create") ||
    sys.has("blob.delete") ||
    hasBlobRules;
  if (hasBlobOps) {
    sys.add("blobs.view");
  }

  // Users module dependencies
  if (
    sys.has("users.create") ||
    sys.has("users.update") ||
    sys.has("users.delete")
  ) {
    sys.add("users.view");
  }

  // Roles module dependencies
  if (
    sys.has("roles.create") ||
    sys.has("roles.update") ||
    sys.has("roles.delete")
  ) {
    sys.add("roles.view");
  }

  // Keys module dependencies
  if (
    sys.has("keys.create") ||
    sys.has("keys.update") ||
    sys.has("keys.delete") ||
    sys.has("keys.rotate")
  ) {
    sys.add("keys.view");
  }

  // Cluster module dependencies
  if (sys.has("cluster.manage") || sys.has("cluster.connect")) {
    sys.add("cluster.view");
  }

  // Settings module dependencies
  if (sys.has("settings.manage")) {
    sys.add("settings.view");
  }

  return {
    ...perms,
    system: Array.from(sys),
  };
}

interface InitialUserFormState {
  username: string;
  email: string;
  permissions: UserPermissionSet;
}

function arePermsEqual(
  a?: UserPermissionSet | null,
  b?: UserPermissionSet | null,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;

  const aSys = [...(a.system || [])].sort();
  const bSys = [...(b.system || [])].sort();
  if (aSys.length !== bSys.length || !aSys.every((v, i) => v === bSys[i])) {
    return false;
  }

  const aDbs = [...(a.databases || [])]
    .map((d) => ({
      database: d.database || "",
      table_name: d.table_name || "",
      operations: [...(d.operations || [])].sort(),
    }))
    .sort((x, y) =>
      (x.database + ":" + x.table_name).localeCompare(
        y.database + ":" + y.table_name,
      ),
    );

  const bDbs = [...(b.databases || [])]
    .map((d) => ({
      database: d.database || "",
      table_name: d.table_name || "",
      operations: [...(d.operations || [])].sort(),
    }))
    .sort((x, y) =>
      (x.database + ":" + x.table_name).localeCompare(
        y.database + ":" + y.table_name,
      ),
    );

  if (JSON.stringify(aDbs) !== JSON.stringify(bDbs)) {
    return false;
  }

  const aBlobs = [...(a.blobs || [])]
    .map((b) => ({
      namespace: b.namespace || "",
      operations: [...(b.operations || [])].sort(),
    }))
    .sort((x, y) => x.namespace.localeCompare(y.namespace));

  const bBlobs = [...(b.blobs || [])]
    .map((b) => ({
      namespace: b.namespace || "",
      operations: [...(b.operations || [])].sort(),
    }))
    .sort((x, y) => x.namespace.localeCompare(y.namespace));

  return JSON.stringify(aBlobs) === JSON.stringify(bBlobs);
}

export function Users() {
  const [users, setUsers] = useState<UserRecordApi[]>([]);
  const [databaseAliases, setDatabaseAliases] = useState<string[]>([]);
  const [blobNamespaces, setBlobNamespaces] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Search, Filters & Display Options State
  const [searchQuery, setSearchQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const filtersRef = useRef<HTMLDivElement | null>(null);

  const [showDisplayOptions, setShowDisplayOptions] = useState(false);
  const displayOptionsRef = useRef<HTMLDivElement | null>(null);

  const [matchMode, setMatchMode] = useState<"all" | "any">("all");
  const [filterRules, setFilterRules] = useState<FilterRule[]>([]);
  const [appliedFilterRules, setAppliedFilterRules] = useState<FilterRule[]>(
    [],
  );

  // Visible columns map
  const [visibleCols, setVisibleCols] = useState<Record<string, boolean>>({
    username: true,
    email: true,
    permissions: true,
    createdAt: true,
    updatedAt: true,
  });

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    if (!showFilters && !showDisplayOptions) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        showFilters &&
        filtersRef.current &&
        !filtersRef.current.contains(target)
      ) {
        setShowFilters(false);
      }
      if (
        showDisplayOptions &&
        displayOptionsRef.current &&
        !displayOptionsRef.current.contains(target)
      ) {
        setShowDisplayOptions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showFilters, showDisplayOptions]);

  // Reset pagination on query or filter changes
  useEffect(() => {
    setPage(1);
  }, [searchQuery, appliedFilterRules, matchMode]);

  // Hover Popover State for Permissions Badge
  const [hoveredPerms, setHoveredPerms] = useState<{
    user: UserRecordApi;
    rect: DOMRect;
  } | null>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handlePermBadgeMouseEnter = (
    user: UserRecordApi,
    e: React.MouseEvent<HTMLElement>,
  ) => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setHoveredPerms({ user, rect });
  };

  const handlePermBadgeMouseLeave = () => {
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredPerms(null);
    }, 120);
  };

  const handlePopoverMouseEnter = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
  };

  const handlePopoverMouseLeave = () => {
    setHoveredPerms(null);
  };

  // SlideOver / Form State
  const [slideOverOpen, setSlideOverOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRecordApi | null>(null);
  const [drawerTab, setDrawerTab] = useState<"edit" | "danger">("edit");

  // Protection & Permissions Evaluation
  const currentUser = getCurrentUser();
  const isEditingRoot = Boolean(
    editingUser && (editingUser.id === 1 || editingUser.is_super_admin),
  );
  const isCurrentOperatorRoot = Boolean(
    currentUser?.is_super_admin || currentUser?.id === 1,
  );
  // Non-root operators cannot modify the Root Super-Administrator
  const isTargetRootProtected = isEditingRoot && !isCurrentOperatorRoot;

  // Active operator cannot delete their own account
  const isEditingSelf = Boolean(
    currentUser &&
    editingUser &&
    (currentUser.id === editingUser.id ||
      currentUser.username.toLowerCase() ===
        editingUser.username.toLowerCase()),
  );

  // Anti-Privilege-Escalation Guards: Operators can only delegate privileges they personally hold
  const isHeldByCurrentOperator = useCallback(
    (permId: string) => {
      if (isCurrentOperatorRoot) return true;
      if (!currentUser) return false;
      const sys = currentUser.permissions?.system || [];
      if (sys.includes("*")) return true;
      if (sys.includes(permId)) return true;
      const resource = permId.split(".")[0];
      if (resource && sys.includes(`${resource}.*`)) return true;
      return false;
    },
    [isCurrentOperatorRoot, currentUser],
  );

  const isDbOpGrantable = useCallback(
    (dbAlias: string, op: string) => {
      if (isCurrentOperatorRoot) return true;
      if (!currentUser) return false;
      if (currentUser.permissions?.system?.includes("*")) return true;
      return (currentUser.permissions?.databases || []).some((d) => {
        const dbMatch =
          d.database === "*" ||
          d.database.toLowerCase() === dbAlias.toLowerCase();
        const opMatch = d.operations.some(
          (o) => o === "*" || o.toUpperCase() === op.toUpperCase(),
        );
        return dbMatch && opMatch;
      });
    },
    [isCurrentOperatorRoot, currentUser],
  );

  const isBlobOpGrantable = useCallback(
    (ns: string, op: string) => {
      if (isCurrentOperatorRoot) return true;
      if (!currentUser) return false;
      if (currentUser.permissions?.system?.includes("*")) return true;
      return (currentUser.permissions?.blobs || []).some((b) => {
        const nsMatch =
          b.namespace === "*" || b.namespace.toLowerCase() === ns.toLowerCase();
        const opMatch = b.operations.some(
          (o) => o === "*" || o.toUpperCase() === op.toUpperCase(),
        );
        return nsMatch && opMatch;
      });
    },
    [isCurrentOperatorRoot, currentUser],
  );
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

  // Initial State Tracking for Dirty Detection
  const initialFormStateRef = useRef<InitialUserFormState | null>(null);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);

  const isDirty = useMemo(() => {
    if (!initialFormStateRef.current) return false;
    const initial = initialFormStateRef.current;

    const currentCleanUser = formUsername
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_");
    const initCleanUser = initial.username
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_");
    if (currentCleanUser !== initCleanUser) return true;

    if (formEmail.trim() !== initial.email.trim()) return true;

    if (formPassword.length > 0) return true;

    if (!arePermsEqual(formPermissions, initial.permissions)) return true;

    return false;
  }, [formUsername, formEmail, formPassword, formPermissions]);

  const isSaveDisabled = useMemo(() => {
    if (isSubmitting) return true;
    if (isTargetRootProtected) return true;
    const cleanUsername = formUsername
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_");
    if (!cleanUsername) return true;

    if (editingUser) {
      if (!isDirty) return true;
      if (formPassword.length > 0 && formPassword.length < 8) return true;
      return false;
    } else {
      // Create mode requires non-empty username, valid 8+ char password, and is disabled if nothing changed
      if (formPassword.length < 8) return true;
      return false;
    }
  }, [
    isSubmitting,
    isTargetRootProtected,
    formUsername,
    editingUser,
    isDirty,
    formPassword,
  ]);

  const requestCloseDrawer = () => {
    if (isDirty && !isTargetRootProtected) {
      setConfirmDiscardOpen(true);
    } else {
      forceCloseDrawer();
    }
  };

  const forceCloseDrawer = () => {
    setConfirmDiscardOpen(false);
    setSlideOverOpen(false);
    setEditingUser(null);
    setDrawerTab("edit");
    setFormError(null);
    initialFormStateRef.current = null;
  };

  // Options for Dropdown Selectors
  const dbOptions = useMemo(() => {
    return [
      { value: "*", label: "* (All Databases)" },
      ...databaseAliases.map((alias) => ({ value: alias, label: alias })),
    ];
  }, [databaseAliases]);

  const blobOptions = useMemo(() => {
    return [
      { value: "*", label: "* (All Namespaces)" },
      ...blobNamespaces.map((ns) => ({ value: ns, label: ns })),
    ];
  }, [blobNamespaces]);

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
    const defaultPerms: UserPermissionSet = {
      system: [
        "cluster.view",
        "db.view",
        "blob.view",
        "table.view",
        "roles.view",
        "keys.view",
        "users.view",
        "audit.view",
        "settings.view",
      ].filter((p) => isHeldByCurrentOperator(p)),
      databases: [],
      blobs: [],
    };
    setEditingUser(null);
    setDrawerTab("edit");
    setFormUsername("");
    setFormEmail("");
    setFormPassword("");
    setFormPermissions(defaultPerms);
    initialFormStateRef.current = {
      username: "",
      email: "",
      permissions: JSON.parse(JSON.stringify(defaultPerms)),
    };
    setFormError(null);
    setSlideOverOpen(true);
  };

  // Open Edit Drawer
  const handleOpenEdit = (user: UserRecordApi) => {
    const initialPerms = resolveDependencies({
      system: user.permissions?.system || [],
      databases: user.permissions?.databases
        ? JSON.parse(JSON.stringify(user.permissions.databases))
        : [],
      blobs: user.permissions?.blobs
        ? JSON.parse(JSON.stringify(user.permissions.blobs))
        : [],
    });
    setEditingUser(user);
    setDrawerTab("edit");
    setFormUsername(user.username);
    setFormEmail(user.email || "");
    setFormPassword("");
    setFormPermissions(initialPerms);
    initialFormStateRef.current = {
      username: user.username,
      email: user.email || "",
      permissions: JSON.parse(JSON.stringify(initialPerms)),
    };
    setFormError(null);
    setSlideOverOpen(true);
  };

  // Submit Form (Create or Update)
  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (isTargetRootProtected) {
      forceCloseDrawer();
      return;
    }

    const cleanUsername = formUsername
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_");
    if (!cleanUsername) {
      setFormError("Username is required");
      return;
    }

    const isEdit = Boolean(editingUser);

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
      const sanitizedPerms = resolveDependencies(formPermissions);
      if (isEdit && editingUser) {
        const payload: {
          username?: string;
          email?: string;
          password?: string;
          permissions?: UserPermissionSet;
        } = {
          email: formEmail.trim() || undefined,
          password: formPassword || undefined,
          permissions: editingUser.id === 1 ? undefined : sanitizedPerms,
        };
        if (cleanUsername !== editingUser.username) {
          payload.username = cleanUsername;
        }
        const updated = await api.updateUser(editingUser.id, payload);

        // Synchronize local session if operator updated their own profile
        const activeOp = getCurrentUser();
        if (activeOp && activeOp.id === editingUser.id) {
          setCurrentUser(updated);
          setSession(getSessionToken() || "", undefined, updated.username);
        }
      } else {
        await api.createUser({
          username: cleanUsername,
          email: formEmail.trim() || undefined,
          password: formPassword,
          permissions: sanitizedPerms,
        });
      }

      forceCloseDrawer();
      await loadData();
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : "Failed to save administrator account";
      setFormError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Delete User
  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    if (deleteTarget.id === 1 || deleteTarget.is_super_admin) {
      setErrorMessage("Root super admin account cannot be deleted");
      setDeleteTarget(null);
      return;
    }
    if (
      currentUser &&
      (deleteTarget.id === currentUser.id ||
        deleteTarget.username.toLowerCase() ===
          currentUser.username.toLowerCase())
    ) {
      setErrorMessage("Cannot delete your own active administrator account");
      setDeleteTarget(null);
      return;
    }
    setIsDeleting(true);
    try {
      await api.deleteUser(deleteTarget.id);
      setDeleteTarget(null);
      forceCloseDrawer();
      await loadData();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to delete user account";
      setErrorMessage(msg);
    } finally {
      setIsDeleting(false);
    }
  };

  // Toggle Single Permission with Dependency Resolution
  const togglePermission = (permId: string) => {
    if (!isHeldByCurrentOperator(permId)) return;
    setFormPermissions((prev) => {
      const current = prev.system || [];
      const has = current.includes(permId);
      if (has) {
        // Disabling permission
        const nextSystem = current.filter((c) => c !== permId);
        if (permId === "db.view") {
          return {
            ...prev,
            system: nextSystem.filter((p) => !p.startsWith("db.")),
            databases: [], // Revoking db.view removes downstream SQL execution rules
          };
        }
        if (permId === "blob.view") {
          return {
            ...prev,
            system: nextSystem.filter((p) => !p.startsWith("blob.")),
            blobs: [], // Revoking blob.view removes downstream blob storage rules
          };
        }
        if (permId === "users.view") {
          return {
            ...prev,
            system: nextSystem.filter((p) => !p.startsWith("users.")),
          };
        }
        if (permId === "roles.view") {
          return {
            ...prev,
            system: nextSystem.filter((p) => !p.startsWith("roles.")),
          };
        }
        if (permId === "keys.view") {
          return {
            ...prev,
            system: nextSystem.filter((p) => !p.startsWith("keys.")),
          };
        }
        if (permId === "cluster.view") {
          return {
            ...prev,
            system: nextSystem.filter((p) => !p.startsWith("cluster.")),
          };
        }
        return {
          ...prev,
          system: nextSystem,
        };
      } else {
        // Enabling permission (automatically satisfies prerequisites)
        return resolveDependencies({
          ...prev,
          system: [...current, permId],
        });
      }
    });
  };

  // Toggle Category Group
  const toggleGroup = (group: CapabilityGroup) => {
    setFormPermissions((prev) => {
      const current = prev.system || [];
      const grantablePermIds = group.permissions
        .map((p) => p.id)
        .filter((id) => isHeldByCurrentOperator(id));
      if (grantablePermIds.length === 0) return prev;
      const allSelected = grantablePermIds.every((id) => current.includes(id));
      if (allSelected) {
        const nextSystem = current.filter(
          (id) => !grantablePermIds.includes(id),
        );
        if (group.id === "databases") {
          return {
            ...prev,
            system: nextSystem.filter((p) => !p.startsWith("db.")),
            databases: [],
          };
        }
        if (group.id === "blob") {
          return {
            ...prev,
            system: nextSystem.filter((p) => !p.startsWith("blob.")),
            blobs: [],
          };
        }
        return { ...prev, system: nextSystem };
      } else {
        return resolveDependencies({
          ...prev,
          system: Array.from(new Set([...current, ...grantablePermIds])),
        });
      }
    });
  };

  // Database Rules Mutators (Auto-grant db.view prerequisite)
  const addDatabaseRule = () => {
    const defaultDb = databaseAliases[0] || "*";
    setFormPermissions((prev) =>
      resolveDependencies({
        ...prev,
        databases: [
          ...prev.databases,
          {
            database: defaultDb,
            table_name: "*",
            operations: ["SELECT"],
          },
        ],
      }),
    );
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
      return resolveDependencies({ ...prev, databases: next });
    });
  };

  // Blob Rules Mutators (Auto-grant blob.view prerequisite)
  const addBlobRule = () => {
    const defaultNs = blobNamespaces[0] || "*";
    setFormPermissions((prev) =>
      resolveDependencies({
        ...prev,
        blobs: [
          ...prev.blobs,
          {
            namespace: defaultNs,
            operations: ["READ"],
          },
        ],
      }),
    );
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

  const handleAddRule = () => {
    const newId = String(Date.now());
    setFilterRules((prev) => [
      ...prev,
      {
        id: newId,
        field: filterFieldOptions[0].value,
        operator: "contains",
        value: "",
      },
    ]);
  };

  const handleRemoveRule = (id: string) => {
    setFilterRules((prev) => prev.filter((r) => r.id !== id));
  };

  const handleUpdateRule = (id: string, updates: Partial<FilterRule>) => {
    setFilterRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...updates } : r)),
    );
  };

  const handleApplyFilters = () => {
    setAppliedFilterRules(filterRules.filter((r) => r.value.trim() !== ""));
    setShowFilters(false);
  };

  const handleClearFilters = () => {
    setFilterRules([]);
    setAppliedFilterRules([]);
    setShowFilters(false);
  };

  const toggleColVisibility = (colId: string) => {
    setVisibleCols((prev) => ({ ...prev, [colId]: !prev[colId] }));
  };

  const handleResetColumns = () => {
    setVisibleCols({
      username: true,
      email: true,
      permissions: true,
      createdAt: true,
      updatedAt: true,
    });
  };

  // Filtered Users List
  const filteredUsers = useMemo(() => {
    let list = users;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (u) =>
          u.username.toLowerCase().includes(q) ||
          (u.email ? u.email.toLowerCase().includes(q) : false),
      );
    }

    if (appliedFilterRules.length > 0) {
      list = list.filter((u) => {
        const tests = appliedFilterRules.map((rule) => {
          let val = "";
          if (rule.field === "username") val = u.username;
          else if (rule.field === "email") val = u.email || "";
          else if (rule.field === "role")
            val =
              u.id === 1 || u.is_super_admin
                ? "root super admin"
                : "pbac operator";
          return matchesRule(val, rule.operator, rule.value);
        });
        return matchMode === "any" ? tests.some(Boolean) : tests.every(Boolean);
      });
    }

    return list;
  }, [users, searchQuery, appliedFilterRules, matchMode]);

  const totalCount = users.length;
  const rootCount = users.filter((u) => u.id === 1 || u.is_super_admin).length;
  const pbacCount = users.filter((u) => u.id !== 1 && !u.is_super_admin).length;

  const sysAdminCount = useMemo(() => {
    return users.filter(
      (u) =>
        u.id === 1 ||
        u.is_super_admin ||
        (u.permissions?.system &&
          u.permissions.system.some((p) =>
            ["cluster.", "roles.", "keys.", "audit.", "users."].some((prefix) =>
              p.startsWith(prefix),
            ),
          )),
    ).length;
  }, [users]);

  const dbAccessCount = useMemo(() => {
    return users.filter(
      (u) =>
        u.id === 1 ||
        u.is_super_admin ||
        (u.permissions?.databases && u.permissions.databases.length > 0) ||
        (u.permissions?.system &&
          u.permissions.system.some((p) => p.startsWith("db."))),
    ).length;
  }, [users]);

  const blobAccessCount = useMemo(() => {
    return users.filter(
      (u) =>
        u.id === 1 ||
        u.is_super_admin ||
        (u.permissions?.blobs && u.permissions.blobs.length > 0) ||
        (u.permissions?.system &&
          u.permissions.system.some((p) => p.startsWith("blob."))),
    ).length;
  }, [users]);

  // Helper to extract categorized permissions for popover
  const getPopoverCategories = (user: UserRecordApi) => {
    if (user.id === 1 || user.is_super_admin) {
      return {
        isRoot: true,
        groups: [],
        dbRules: [],
        blobRules: [],
        totalCount: 0,
      };
    }

    const userSys = new Set(user.permissions?.system || []);
    const groupsWithGranted = CAPABILITY_GROUPS.map((group) => {
      const granted = group.permissions.filter((p) => userSys.has(p.id));
      return {
        ...group,
        granted,
      };
    }).filter((g) => g.granted.length > 0);

    const dbRules = user.permissions?.databases || [];
    const blobRules = user.permissions?.blobs || [];
    const totalCount = userSys.size + dbRules.length + blobRules.length;

    return {
      isRoot: false,
      groups: groupsWithGranted,
      dbRules,
      blobRules,
      totalCount,
    };
  };

  // Table Columns Definition
  const columns: Column<UserRecordApi>[] = useMemo(
    () => [
      {
        id: "username",
        header: "Username",
        accessorKey: "username",
        width: 220,
        minWidth: 160,
        maxWidth: 360,
        isResizable: true,
        className: "pl-4 pr-3",
        cell: (row) => (
          <span
            className="text-[13px] font-medium text-white truncate"
            title={row.username}
          >
            {row.username}
          </span>
        ),
      },
      {
        id: "email",
        header: "Email",
        accessorKey: "email",
        width: 220,
        minWidth: 160,
        maxWidth: 380,
        isResizable: true,
        className: "px-3",
        cell: (row) => (
          <span
            className="text-[13px] text-[#8c8c8c] font-normal truncate block"
            title={row.email || undefined}
          >
            {row.email || "—"}
          </span>
        ),
      },
      {
        id: "permissions",
        header: "Permissions",
        width: 250,
        minWidth: 190,
        maxWidth: 420,
        isResizable: true,
        className: "px-3",
        cell: (row) => {
          const isRoot = row.id === 1 || row.is_super_admin;
          if (isRoot) {
            return (
              <div
                className="relative inline-flex items-center cursor-pointer select-none"
                onMouseEnter={(e) => handlePermBadgeMouseEnter(row, e)}
                onMouseLeave={handlePermBadgeMouseLeave}
              >
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/30 shrink-0 hover:bg-amber-500/20 transition-colors">
                  <ShieldCheck className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>full</span>
                </span>
              </div>
            );
          }

          const sysCount = row.permissions?.system?.length || 0;
          const dbCount = row.permissions?.databases?.length || 0;
          const blobCount = row.permissions?.blobs?.length || 0;
          const total = sysCount + dbCount + blobCount;

          if (total === 0) {
            return (
              <div
                className="relative inline-flex items-center cursor-pointer select-none"
                onMouseEnter={(e) => handlePermBadgeMouseEnter(row, e)}
                onMouseLeave={handlePermBadgeMouseLeave}
              >
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-[#18181b] text-[#8c8c8c] border border-[#27272a] shrink-0 hover:border-[#383838] transition-colors">
                  <Lock className="w-3.5 h-3.5 text-[#8c8c8c] shrink-0" />
                  <span>0</span>
                </span>
              </div>
            );
          }

          return (
            <div
              className="relative inline-flex items-center cursor-pointer select-none"
              onMouseEnter={(e) => handlePermBadgeMouseEnter(row, e)}
              onMouseLeave={handlePermBadgeMouseLeave}
            >
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-[#18181b] text-[#cccccc] border border-[#27272a] hover:border-[#3f3f46] hover:text-white transition-colors shrink-0">
                <Shield className="w-3.5 h-3.5 text-[#8c8c8c] shrink-0" />
                <span>{total}</span>
              </span>
            </div>
          );
        },
      },
      {
        id: "createdAt",
        header: "Creation Date",
        width: 140,
        minWidth: 120,
        maxWidth: 200,
        isResizable: true,
        className: "px-3",
        cell: (row) => (
          <span className="tabular-nums text-[13px] text-[#8c8c8c] font-normal">
            {formatDate(row.created_at)}
          </span>
        ),
      },
      {
        id: "updatedAt",
        header: "Last Update Date",
        width: 150,
        minWidth: 120,
        maxWidth: 220,
        isResizable: true,
        className: "px-3",
        cell: (row) => (
          <span className="tabular-nums text-[13px] text-[#8c8c8c] font-normal">
            {formatDate(row.updated_at || row.created_at)}
          </span>
        ),
      },
      {
        id: "actions",
        header: <span className="sr-only">Actions</span>,
        isFlex: true,
        headerClassName: "justify-end pr-4 text-right",
        className: "pl-3 pr-4 justify-end",
        cell: (row) => (
          <div className="flex items-center justify-end w-full">
            <button
              type="button"
              disabled={!canUpdate}
              onClick={() => handleOpenEdit(row)}
              className="inline-flex items-center justify-center h-7 px-3 rounded-[6px] text-[13px] font-medium leading-none text-[#8c8c8c] hover:text-white bg-transparent hover:bg-[#1a1a1a] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Manage
            </button>
          </div>
        ),
      },
    ],
    [canUpdate, canDelete],
  );

  const activeColumns = useMemo(() => {
    const visible = columns.filter(
      (col) => col.id === "actions" || visibleCols[col.id] !== false,
    );
    const lastDataId = [...visible]
      .reverse()
      .find((c) => c.id !== "actions")?.id;
    return visible.map((col) => ({
      ...col,
      isResizable:
        col.id !== "actions" &&
        col.id !== lastDataId &&
        Boolean(col.isResizable),
    }));
  }, [columns, visibleCols]);

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-[16px] font-medium text-white tracking-tight">
            Users
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleManualRefresh}
            title="Refresh users"
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
            <Plus className="w-3.5 h-3.5 mr-1" />
            Add User
          </Button>
        </div>
      </div>

      {errorMessage && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-[#2a1113] border border-[#5c1d24] text-[#f87171] text-[13px]">
          <AlertTriangle className="w-4 h-4 shrink-0 text-[#ef4444]" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Metric Stat Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-[8px] border border-[#262626] bg-[#0c0c0c] p-4 flex flex-col justify-between hover:border-[#333333] transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-normal text-[#8c8c8c] block">
              Total users
            </span>
            <div className="p-1.5 rounded-[6px] bg-[#141414] border border-[#222222] text-[#8c8c8c]">
              <UsersIcon className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="my-2">
            {isLoading ? (
              <Skeleton className="h-7 w-16" />
            ) : (
              <div className="text-[22px] font-semibold text-white tracking-[-0.02em] leading-tight tabular-nums">
                {totalCount}
              </div>
            )}
          </div>
          <span className="text-[12px] text-[#737373] block">
            {rootCount} super-admin · {pbacCount} scoped
          </span>
        </div>

        <div className="rounded-[8px] border border-[#262626] bg-[#0c0c0c] p-4 flex flex-col justify-between hover:border-[#333333] transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-normal text-[#8c8c8c] block">
              System operators
            </span>
            <div className="p-1.5 rounded-[6px] bg-[#141414] border border-[#222222] text-[#8c8c8c]">
              <Shield className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="my-2">
            {isLoading ? (
              <Skeleton className="h-7 w-16" />
            ) : (
              <div className="text-[22px] font-semibold text-white tracking-[-0.02em] leading-tight tabular-nums">
                {sysAdminCount}
              </div>
            )}
          </div>
          <span className="text-[12px] text-[#737373] block">
            Cluster, keys, audit & roles
          </span>
        </div>

        <div className="rounded-[8px] border border-[#262626] bg-[#0c0c0c] p-4 flex flex-col justify-between hover:border-[#333333] transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-normal text-[#8c8c8c] block">
              Database access
            </span>
            <div className="p-1.5 rounded-[6px] bg-[#141414] border border-[#222222] text-[#8c8c8c]">
              <Database className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="my-2">
            {isLoading ? (
              <Skeleton className="h-7 w-16" />
            ) : (
              <div className="text-[22px] font-semibold text-white tracking-[-0.02em] leading-tight tabular-nums">
                {dbAccessCount}
              </div>
            )}
          </div>
          <span className="text-[12px] text-[#737373] block">
            SQL queries & table execution
          </span>
        </div>

        <div className="rounded-[8px] border border-[#262626] bg-[#0c0c0c] p-4 flex flex-col justify-between hover:border-[#333333] transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-normal text-[#8c8c8c] block">
              Storage access
            </span>
            <div className="p-1.5 rounded-[6px] bg-[#141414] border border-[#222222] text-[#8c8c8c]">
              <HardDrive className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="my-2">
            {isLoading ? (
              <Skeleton className="h-7 w-16" />
            ) : (
              <div className="text-[22px] font-semibold text-white tracking-[-0.02em] leading-tight tabular-nums">
                {blobAccessCount}
              </div>
            )}
          </div>
          <span className="text-[12px] text-[#737373] block">
            Object buckets & namespaces
          </span>
        </div>
      </div>

      {/* Table Controls Toolbar (Search & Filter Tabs) */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 select-none font-sans">
        <label
          title="Search users..."
          className="relative flex items-center h-9 rounded-[8px] bg-transparent border border-[#262626] focus-within:border-[#2f80ed] transition-colors px-3 gap-2 w-full sm:w-[260px] md:w-[300px]"
        >
          <Search className="w-3.5 h-3.5 text-[#8c8c8c] shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Search users..."
            className="w-full bg-transparent border-0 text-[14px] text-white placeholder-[#8c8c8c] outline-none font-normal font-sans"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setPage(1);
              }}
              className="flex items-center justify-center w-5 h-5 rounded hover:bg-[#222222] text-[#8c8c8c] hover:text-white transition-colors cursor-pointer shrink-0 font-sans"
              title="Clear search"
            >
              ✕
            </button>
          )}
        </label>

        {/* Controls on Right: Filters and Display Options */}
        <div className="flex flex-wrap items-center gap-2 font-sans">
          {/* Filters dropdown button & popover */}
          <div className="relative" ref={filtersRef}>
            <button
              type="button"
              onClick={() => {
                setShowFilters((prev) => {
                  const next = !prev;
                  if (next) {
                    setShowDisplayOptions(false);
                    if (appliedFilterRules.length > 0) {
                      setFilterRules(appliedFilterRules.map((r) => ({ ...r })));
                    } else if (filterRules.length === 0) {
                      setFilterRules([
                        {
                          id: "1",
                          field: filterFieldOptions[0].value,
                          operator: "contains",
                          value: "",
                        },
                      ]);
                    }
                  }
                  return next;
                });
              }}
              className={`flex items-center gap-1.5 h-9 px-3 rounded-[8px] bg-transparent border text-[14px] font-medium transition-colors cursor-pointer shrink-0 font-sans ${
                showFilters || appliedFilterRules.length > 0
                  ? "border-[#444444] text-white bg-[#141414]"
                  : "border-[#262626] text-white hover:bg-[#141414] hover:border-[#383838]"
              }`}
              title="Filter users"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                fill="currentColor"
                viewBox="0 0 256 256"
                className="text-[#8c8c8c] shrink-0"
              >
                <path d="M230.6,49.53A15.81,15.81,0,0,0,216,40H40A16,16,0,0,0,28.19,66.76l.08.09L96,139.17V216a16,16,0,0,0,24.87,13.32l32-21.34A16,16,0,0,0,160,194.66V139.17l67.74-72.32.08-.09A15.8,15.8,0,0,0,230.6,49.53ZM40,56h0Zm106.18,74.58A8,8,0,0,0,144,136v58.66L112,216V136a8,8,0,0,0-2.16-5.47L40,56H216Z" />
              </svg>
              <span>Filters</span>
              {appliedFilterRules.length > 0 && (
                <span className="text-[12px] text-[#8c8c8c] font-normal">
                  ({appliedFilterRules.length})
                </span>
              )}
            </button>

            {showFilters && (
              <div className="absolute right-0 top-10 w-[540px] max-w-[calc(100vw-32px)] rounded-[8px] bg-[#0c0c0c] border border-[#262626] shadow-2xl p-4 z-50 select-none animate-in fade-in font-sans">
                {/* Header */}
                <div className="flex items-center justify-between pb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-medium text-white font-sans">
                      User Filters
                    </span>
                    {filterRules.length >= 2 && (
                      <button
                        type="button"
                        onClick={() =>
                          setMatchMode((prev) =>
                            prev === "any" ? "all" : "any",
                          )
                        }
                        className="px-2.5 py-0.5 rounded text-[13px] text-[#cccccc] hover:text-white bg-[#141414] border border-[#2e2e2e] hover:border-[#444444] transition-colors cursor-pointer font-sans"
                      >
                        Match {matchMode === "any" ? "any (OR)" : "all (AND)"}
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowFilters(false)}
                    className="text-[#888888] hover:text-white transition-colors cursor-pointer text-[14px] p-1 leading-none"
                    title="Close filters"
                  >
                    ✕
                  </button>
                </div>

                {/* Rules List */}
                <div
                  className={`space-y-2.5 ${filterRules.length > 3 ? "max-h-[320px] overflow-y-auto pr-0.5" : ""}`}
                >
                  {filterRules.map((rule) => (
                    <div key={rule.id} className="flex items-center gap-2">
                      <CustomSelect
                        value={rule.field}
                        options={filterFieldOptions}
                        onChange={(val) =>
                          handleUpdateRule(rule.id, { field: val })
                        }
                        className="w-36 shrink-0"
                        menuWidth="w-44"
                      />

                      <CustomSelect
                        value={rule.operator}
                        options={[
                          { value: "contains", label: "contains" },
                          { value: "equals", label: "equals" },
                          { value: "starts_with", label: "starts with" },
                        ]}
                        onChange={(val) =>
                          handleUpdateRule(rule.id, {
                            operator: val as
                              "contains" | "equals" | "starts_with",
                          })
                        }
                        className="w-32 sm:w-36 shrink-0"
                        menuWidth="w-44"
                      />

                      <input
                        type="text"
                        value={rule.value}
                        onChange={(e) =>
                          handleUpdateRule(rule.id, { value: e.target.value })
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleApplyFilters();
                        }}
                        placeholder="Filter value..."
                        className="flex-1 min-w-0 h-9 px-3 rounded-[8px] bg-[#141414] border border-[#262626] hover:border-[#383838] focus:border-[#2f80ed] text-[14px] text-white placeholder-[#555555] outline-none transition-colors font-sans"
                      />

                      <button
                        type="button"
                        onClick={() => handleRemoveRule(rule.id)}
                        className="w-8 h-8 flex items-center justify-center text-[#777777] hover:text-white cursor-pointer transition-colors shrink-0"
                        title="Delete filter rule"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="15"
                          height="15"
                          fill="currentColor"
                          viewBox="0 0 256 256"
                        >
                          <path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>

                {/* Footer Controls */}
                <div className="flex items-center justify-between pt-2.5 mt-1 font-sans">
                  <button
                    type="button"
                    onClick={handleAddRule}
                    className="text-[14px] text-white hover:text-[#2f80ed] font-medium flex items-center gap-1.5 transition-colors cursor-pointer font-sans"
                  >
                    <span>+ Add filter</span>
                  </button>
                  <div className="flex items-center gap-3">
                    <span className="text-[12px] text-[#666666] font-sans">
                      Press Enter to apply
                    </span>
                    {appliedFilterRules.length > 0 && (
                      <button
                        type="button"
                        onClick={handleClearFilters}
                        className="text-[14px] text-[#888888] hover:text-white transition-colors cursor-pointer font-sans"
                      >
                        Clear
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleApplyFilters}
                      className="group relative flex shrink-0 items-center justify-center h-8 px-3.5 rounded-[8px] font-medium text-white shadow-xs outline-none cursor-pointer disabled:opacity-50 overflow-hidden ring-1 ring-[#1d4ed8] bg-[#2563eb] font-sans"
                    >
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-[#3b82f6] to-[#2563eb] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]"
                      />
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black opacity-0 group-hover:opacity-15 transition-opacity duration-200"
                      />
                      <span className="relative flex items-center gap-1.5 text-[14px] font-sans">
                        Apply filters
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Display options dropdown */}
          <div className="relative" ref={displayOptionsRef}>
            <button
              type="button"
              onClick={() => {
                setShowDisplayOptions((prev) => !prev);
                setShowFilters(false);
              }}
              className={`flex items-center gap-1.5 h-9 px-3 rounded-[8px] bg-transparent border text-[14px] font-medium transition-colors cursor-pointer shrink-0 font-sans ${
                showDisplayOptions
                  ? "border-[#444444] text-white bg-[#141414]"
                  : "border-[#262626] text-white hover:bg-[#141414] hover:border-[#383838]"
              }`}
              title="Toggle visible table columns"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                fill="currentColor"
                viewBox="0 0 256 256"
                className="text-[#8c8c8c] shrink-0"
              >
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
                      <span
                        className={
                          isVisible
                            ? "text-white font-medium"
                            : "text-[#8c8c8c]"
                        }
                      >
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
                  Reset to default
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Accounts Table */}
      <DataTable
        columns={activeColumns}
        data={filteredUsers}
        keyExtractor={(item) => String(item.id)}
        pagination={{
          page,
          pageSize,
          totalCount: filteredUsers.length,
          onPageChange: setPage,
          onPageSizeChange: (newSize) => {
            setPageSize(newSize);
            setPage(1);
          },
        }}
        isLoading={isLoading}
        emptyMessage={
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <UsersIcon className="w-8 h-8 text-[#525252] mb-2" />
            <span className="text-[13px] font-medium text-white mb-1">
              No users found
            </span>
            <span className="text-[12px] text-[#8c8c8c]">
              {searchQuery
                ? "Try adjusting your search criteria"
                : "Add a user account to begin"}
            </span>
          </div>
        }
      />

      {/* SlideOver Drawer for Create / Edit */}
      <SlideOver
        isOpen={slideOverOpen}
        onClose={requestCloseDrawer}
        title={
          editingUser ? `Manage User: ${editingUser.username}` : "New User"
        }
        subtitle="Configure credentials and granular PBAC capabilities"
        width="w-[640px] max-w-full"
      >
        {/* Navigation Tabs (Only when editing non-root users) */}
        {editingUser && !isEditingRoot && canDelete && (
          <div className="border-b border-[#222222] px-5 py-2.5 bg-[#0e0e0e] shrink-0 font-sans">
            <div className="inline-flex items-center p-0.5 rounded-[8px] bg-transparent border border-[#262626]">
              <button
                type="button"
                onClick={() => setDrawerTab("edit")}
                className={`flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[13px] font-medium transition-colors duration-75 cursor-pointer font-sans outline-none focus:outline-none border ${
                  drawerTab === "edit"
                    ? "bg-[#161616] text-white border-[#333333]"
                    : "text-[#8c8c8c] hover:text-white hover:bg-[#141414] border-transparent"
                }`}
              >
                <span>Configuration</span>
              </button>
              <button
                type="button"
                onClick={() => setDrawerTab("danger")}
                className={`flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[13px] font-medium transition-colors duration-75 cursor-pointer font-sans outline-none focus:outline-none border ${
                  drawerTab === "danger"
                    ? "bg-[#161616] text-white border-[#333333]"
                    : "text-[#8c8c8c] hover:text-white hover:bg-[#141414] border-transparent"
                }`}
              >
                <span>Danger</span>
              </button>
            </div>
          </div>
        )}

        {/* Danger Tab */}
        {editingUser && !isEditingRoot && drawerTab === "danger" ? (
          <div className="flex-1 p-5 overflow-y-auto font-sans">
            {isEditingSelf ? (
              <div className="rounded-[8px] border border-[#3a2a10] bg-[#141006] p-4">
                <div className="flex items-center gap-2 text-[15px] font-medium text-[#f59e0b] tracking-tight mb-1.5">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-[#f59e0b]" />
                  <span>Cannot Delete Own Account</span>
                </div>
                <div className="text-[13px] text-[#a1a1aa] leading-relaxed mb-4">
                  You cannot delete your own active administrator account while
                  signed in. Another administrator with user deletion privileges
                  must perform this action.
                </div>
                <button
                  type="button"
                  disabled
                  title="Cannot delete your own active account"
                  className="flex shrink-0 items-center justify-center h-8 px-3.5 rounded-[8px] font-medium text-[#737373] bg-[#1e1e1e] border border-[#2a2a2a] cursor-not-allowed opacity-60 font-sans text-[13px]"
                >
                  Delete User (Disabled)
                </button>
              </div>
            ) : (
              <div className="rounded-[8px] border border-[#3a1515] bg-[#0e0404] p-4">
                <div className="text-[16px] font-medium text-[#e5484d] tracking-tight mb-1">
                  Delete User
                </div>
                <div className="text-[13px] text-[#8c8c8c] leading-relaxed mb-4">
                  Permanently delete user{" "}
                  <span className="text-white font-medium">
                    {editingUser.username}
                  </span>
                  . All assigned capabilities and active sessions will be
                  revoked.
                </div>
                <button
                  type="button"
                  disabled={!canDelete}
                  onClick={() => setDeleteTarget(editingUser)}
                  className="group relative flex shrink-0 items-center justify-center h-8 px-3.5 rounded-[8px] font-medium text-white shadow-xs outline-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed overflow-hidden ring-1 ring-[#be123c] bg-[#e11d48] font-sans text-[13px]"
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
                    Delete User
                  </span>
                </button>
              </div>
            )}
          </div>
        ) : (
          /* Configuration Tab Form */
          <form
            onSubmit={handleSubmitForm}
            className="flex-1 flex flex-col min-h-0"
          >
            <div className="flex-1 p-5 overflow-y-auto space-y-5 font-sans">
              {formError && (
                <div className="flex items-center gap-2 p-3 rounded-[8px] bg-[#2a1113] border border-[#5c1d24] text-[#f87171] text-[13px]">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-[#ef4444]" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Warning Banner when non-root attempts to manage Root Super-Admin */}
              {isTargetRootProtected && (
                <div className="flex items-start gap-2.5 p-3.5 rounded-[8px] bg-[#1a1205] border border-[#543b0c] text-[#f59e0b] text-[13px] leading-relaxed">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-[#f59e0b] mt-0.5" />
                  <div>
                    <span className="font-medium text-white block mb-0.5">
                      Root Account Protected
                    </span>
                    <span>
                      Only the Root Super-Administrator can modify this
                      account's credentials, email, or password.
                    </span>
                  </div>
                </div>
              )}

              {/* Account Credentials */}
              <div className="space-y-3.5">
                <div>
                  <h3 className="text-[15px] font-medium text-white tracking-tight">
                    Account Credentials
                  </h3>
                  <p className="text-[13px] text-[#8c8c8c] mt-0.5">
                    Operator identity and authentication credentials
                  </p>
                </div>
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                        Username <span className="text-[#e5484d]">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        disabled={isTargetRootProtected}
                        value={formUsername}
                        onChange={(e) =>
                          setFormUsername(
                            e.target.value.toLowerCase().replace(/\s+/g, "_"),
                          )
                        }
                        placeholder="e.g. dev_operator"
                        className="h-9 w-full rounded-[8px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white placeholder-[#666666] focus:outline-none focus:border-[#2f80ed] hover:border-[#383838] transition-colors font-mono lowercase disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                    </div>
                    <div>
                      <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                        Email Address
                      </label>
                      <input
                        type="email"
                        disabled={isTargetRootProtected}
                        value={formEmail}
                        onChange={(e) => setFormEmail(e.target.value)}
                        placeholder="e.g. operator@company.com"
                        className="h-9 w-full rounded-[8px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white placeholder-[#666666] focus:outline-none focus:border-[#2f80ed] hover:border-[#383838] transition-colors font-sans disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                      Password{" "}
                      {editingUser ? (
                        <span className="text-[12px] text-[#737373] font-normal">
                          (Leave blank to keep current)
                        </span>
                      ) : (
                        <span className="text-[#e5484d]">*</span>
                      )}
                    </label>
                    <input
                      type="password"
                      disabled={isTargetRootProtected}
                      required={!editingUser}
                      value={formPassword}
                      onChange={(e) => setFormPassword(e.target.value)}
                      placeholder={
                        editingUser ? "••••••••••••" : "Minimum 8 characters"
                      }
                      className="h-9 w-full rounded-[8px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white placeholder-[#666666] focus:outline-none focus:border-[#2f80ed] hover:border-[#383838] transition-colors font-sans disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </div>
                </div>
              </div>

              {/* Granular PBAC Capabilities (Scoped non-root only) */}
              {!isEditingRoot && (
                <>
                  <div className="-mx-5 border-t border-[#222222]" />

                  {/* Module Capabilities */}
                  <div className="space-y-3.5">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-[15px] font-medium text-white tracking-tight">
                          Module Capabilities
                        </h4>
                        <p className="text-[13px] text-[#8c8c8c] mt-0.5">
                          Configure administrative and functional module
                          privileges
                        </p>
                      </div>
                      <span className="text-[12px] text-[#8c8c8c] bg-[#141414] border border-[#262626] px-2 py-0.5 rounded-full font-sans tabular-nums">
                        {formPermissions.system.length}/
                        {ALL_SYSTEM_PERMS.length}
                      </span>
                    </div>

                    <div className="space-y-3">
                      {CAPABILITY_GROUPS.map((group) => {
                        const GroupIcon = group.icon;
                        const groupPermIds = group.permissions.map((p) => p.id);
                        const selectedCount = groupPermIds.filter((id) =>
                          formPermissions.system.includes(id),
                        ).length;
                        const isAllSelected =
                          selectedCount === groupPermIds.length;

                        return (
                          <div
                            key={group.id}
                            className="rounded-[8px] border border-[#262626] bg-[#0c0c0c] overflow-hidden"
                          >
                            <div className="flex items-center justify-between px-3.5 py-2.5 bg-[#141414] border-b border-[#222222]">
                              <div className="flex items-center gap-2">
                                <GroupIcon className="w-3.5 h-3.5 text-[#8c8c8c] shrink-0" />
                                <span className="text-[13px] font-medium text-white">
                                  {group.name}
                                </span>
                                <span className="text-[11px] text-[#737373] tabular-nums">
                                  ({selectedCount}/{groupPermIds.length})
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => toggleGroup(group)}
                                className="text-[12px] text-[#8c8c8c] hover:text-white font-medium transition-colors cursor-pointer"
                              >
                                {isAllSelected ? "Deselect All" : "Select All"}
                              </button>
                            </div>

                            <div className="p-2.5 grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {group.permissions.map((perm) => {
                                const isChecked =
                                  formPermissions.system.includes(perm.id);
                                const isLockedDependency =
                                  (perm.id === "db.view" &&
                                    formPermissions.databases.length > 0) ||
                                  (perm.id === "blob.view" &&
                                    formPermissions.blobs.length > 0);
                                const isGrantable = isHeldByCurrentOperator(
                                  perm.id,
                                );

                                return (
                                  <div
                                    key={perm.id}
                                    onClick={() => {
                                      if (isGrantable)
                                        togglePermission(perm.id);
                                    }}
                                    title={
                                      !isGrantable
                                        ? "You cannot grant privileges you do not possess"
                                        : perm.description
                                    }
                                    className={`p-2.5 rounded-[6px] border transition-all flex items-start gap-2.5 select-none ${
                                      !isGrantable
                                        ? "opacity-35 cursor-not-allowed bg-[#101010] border-[#1e1e1e] text-[#666666]"
                                        : isChecked
                                          ? "bg-[#18181b] border-[#444444] text-white cursor-pointer"
                                          : "bg-[#141414] border-[#222222] text-[#8c8c8c] hover:border-[#383838] cursor-pointer"
                                    }`}
                                  >
                                    {isGrantable ? (
                                      <div
                                        className={`w-4 h-4 rounded mt-0.5 flex items-center justify-center shrink-0 border transition-colors ${
                                          isChecked
                                            ? "bg-white border-white text-black"
                                            : "border-[#404040] bg-[#1a1a1a]"
                                        }`}
                                      >
                                        {isChecked && (
                                          <Check className="w-3 h-3 stroke-[3]" />
                                        )}
                                      </div>
                                    ) : (
                                      <div className="w-4 h-4 rounded mt-0.5 flex items-center justify-center shrink-0 text-[#666666]">
                                        <Lock className="w-3 h-3" />
                                      </div>
                                    )}
                                    <div className="space-y-0.5 min-w-0 flex-1">
                                      <div className="flex items-center justify-between gap-1">
                                        <span className="text-[13px] font-medium text-white truncate">
                                          {perm.label}
                                        </span>
                                        {isLockedDependency ? (
                                          <span className="text-[10px] text-[#8c8c8c] bg-[#222222] px-1.5 py-0.2 rounded font-sans">
                                            auto
                                          </span>
                                        ) : !isGrantable ? (
                                          <span className="text-[10px] text-[#71717a] bg-[#18181b] px-1.5 py-0.2 rounded font-sans">
                                            locked
                                          </span>
                                        ) : null}
                                      </div>
                                      <p className="text-[11px] text-[#737373] leading-snug">
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

                  <div className="-mx-5 border-t border-[#222222]" />

                  {/* Database & Table Scopes */}
                  <div className="space-y-3.5">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-[15px] font-medium text-white tracking-tight">
                            Database & Table Scopes
                          </h4>
                          <span className="text-[12px] text-[#8c8c8c] bg-[#141414] border border-[#262626] px-2 py-0.5 rounded-full font-sans tabular-nums">
                            {formPermissions.databases.length}{" "}
                            {formPermissions.databases.length === 1
                              ? "rule"
                              : "rules"}
                          </span>
                        </div>
                        <p className="text-[13px] text-[#8c8c8c] mt-0.5">
                          Configure upstream database aliases, tables, and SQL
                          operation grants
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={addDatabaseRule}
                      >
                        <Plus className="w-3.5 h-3.5 mr-1" />
                        Add DB Scope
                      </Button>
                    </div>

                    {formPermissions.databases.length === 0 ? (
                      <div className="p-6 rounded-[8px] border border-dashed border-[#262626] bg-[#0c0c0c] text-center">
                        <Database className="w-5 h-5 text-[#525252] mx-auto mb-1.5" />
                        <div className="text-[13px] font-medium text-white mb-0.5">
                          No database access rules
                        </div>
                        <p className="text-[12px] text-[#737373]">
                          This operator will have zero SQL query or table
                          privileges.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {formPermissions.databases.map((rule, idx) => (
                          <div
                            key={idx}
                            className="p-3.5 rounded-[8px] border border-[#262626] bg-[#0c0c0c] space-y-3"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1 min-w-0">
                                <div>
                                  <label className="block text-[12px] font-medium text-[#8c8c8c] mb-1.5">
                                    Database Pool
                                  </label>
                                  <CustomSelect
                                    value={rule.database}
                                    options={dbOptions}
                                    onChange={(val) =>
                                      updateDatabaseRule(idx, "database", val)
                                    }
                                    className="w-full"
                                    menuWidth="w-full"
                                  />
                                </div>
                                <div>
                                  <label className="block text-[12px] font-medium text-[#8c8c8c] mb-1.5">
                                    Table Scope
                                  </label>
                                  <input
                                    type="text"
                                    value={rule.table_name}
                                    onChange={(e) =>
                                      updateDatabaseRule(
                                        idx,
                                        "table_name",
                                        e.target.value,
                                      )
                                    }
                                    placeholder="* (All Tables)"
                                    className="h-9 w-full rounded-[8px] border border-[#262626] bg-[#121212] px-3 text-[13px] text-white placeholder-[#666666] focus:outline-none focus:border-[#2f80ed] hover:border-[#383838] transition-colors font-mono"
                                  />
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => removeDatabaseRule(idx)}
                                className="mt-6 w-8 h-8 rounded-[6px] flex items-center justify-center text-[#777777] hover:text-[#f87171] hover:bg-[#1a0f0f] border border-transparent hover:border-[#3b1216] transition-colors cursor-pointer shrink-0"
                                title="Remove database scope"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            <div className="pt-1 flex items-center gap-1.5 flex-wrap">
                              <span className="text-[12px] text-[#737373] mr-1">
                                Permitted:
                              </span>
                              {DB_OPERATIONS.map((op) => {
                                const isAllowed = rule.operations?.includes(op);
                                const isGrantable = isDbOpGrantable(
                                  rule.database,
                                  op,
                                );
                                return (
                                  <button
                                    key={op}
                                    type="button"
                                    disabled={!isGrantable}
                                    title={
                                      !isGrantable
                                        ? "You do not possess permission for this operation"
                                        : undefined
                                    }
                                    onClick={() => {
                                      if (isGrantable)
                                        toggleDbOperation(idx, op);
                                    }}
                                    className={`px-2.5 py-1 rounded-[6px] text-[11px] font-mono transition-colors border ${
                                      !isGrantable
                                        ? "opacity-30 cursor-not-allowed bg-[#141414] text-[#555555] border-[#222222]"
                                        : isAllowed
                                          ? "bg-[#222222] text-white border-[#444444] cursor-pointer"
                                          : "bg-[#141414] text-[#737373] border-[#262626] hover:text-white hover:border-[#383838] cursor-pointer"
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

                  <div className="-mx-5 border-t border-[#222222]" />

                  {/* Blob Storage Scopes */}
                  <div className="space-y-3.5">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-[15px] font-medium text-white tracking-tight">
                            Blob Storage Scopes
                          </h4>
                          <span className="text-[12px] text-[#8c8c8c] bg-[#141414] border border-[#262626] px-2 py-0.5 rounded-full font-sans tabular-nums">
                            {formPermissions.blobs.length}{" "}
                            {formPermissions.blobs.length === 1
                              ? "rule"
                              : "rules"}
                          </span>
                        </div>
                        <p className="text-[13px] text-[#8c8c8c] mt-0.5">
                          Configure binary bucket namespaces and transfer
                          permissions
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={addBlobRule}
                      >
                        <Plus className="w-3.5 h-3.5 mr-1" />
                        Add Blob Scope
                      </Button>
                    </div>

                    {formPermissions.blobs.length === 0 ? (
                      <div className="p-6 rounded-[8px] border border-dashed border-[#262626] bg-[#0c0c0c] text-center">
                        <HardDrive className="w-5 h-5 text-[#525252] mx-auto mb-1.5" />
                        <div className="text-[13px] font-medium text-white mb-0.5">
                          No blob storage rules
                        </div>
                        <p className="text-[12px] text-[#737373]">
                          This operator will have zero object upload or download
                          privileges.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {formPermissions.blobs.map((rule, idx) => (
                          <div
                            key={idx}
                            className="p-3.5 rounded-[8px] border border-[#262626] bg-[#0c0c0c] space-y-3"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <label className="block text-[12px] font-medium text-[#8c8c8c] mb-1.5">
                                  Blob Namespace
                                </label>
                                <CustomSelect
                                  value={rule.namespace}
                                  options={blobOptions}
                                  onChange={(val) =>
                                    updateBlobRule(idx, "namespace", val)
                                  }
                                  className="w-full"
                                  menuWidth="w-full"
                                />
                              </div>
                              <button
                                type="button"
                                onClick={() => removeBlobRule(idx)}
                                className="mt-6 w-8 h-8 rounded-[6px] flex items-center justify-center text-[#777777] hover:text-[#f87171] hover:bg-[#1a0f0f] border border-transparent hover:border-[#3b1216] transition-colors cursor-pointer shrink-0"
                                title="Remove blob scope"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            <div className="pt-1 flex items-center gap-1.5 flex-wrap">
                              <span className="text-[12px] text-[#737373] mr-1">
                                Permitted:
                              </span>
                              {BLOB_OPERATIONS.map((op) => {
                                const isAllowed = rule.operations?.includes(op);
                                const isGrantable = isBlobOpGrantable(
                                  rule.namespace,
                                  op,
                                );
                                return (
                                  <button
                                    key={op}
                                    type="button"
                                    disabled={!isGrantable}
                                    title={
                                      !isGrantable
                                        ? "You do not possess permission for this operation"
                                        : undefined
                                    }
                                    onClick={() => {
                                      if (isGrantable)
                                        toggleBlobOperation(idx, op);
                                    }}
                                    className={`px-2.5 py-1 rounded-[6px] text-[11px] font-mono transition-colors border ${
                                      !isGrantable
                                        ? "opacity-30 cursor-not-allowed bg-[#141414] text-[#555555] border-[#222222]"
                                        : isAllowed
                                          ? "bg-[#222222] text-white border-[#444444] cursor-pointer"
                                          : "bg-[#141414] text-[#737373] border-[#262626] hover:text-white hover:border-[#383838] cursor-pointer"
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
            </div>

            {/* Bottom Sticky Footer */}
            <div className="border-t border-[#222222] px-5 py-3.5 bg-[#0a0a0a] flex items-center justify-end gap-2 shrink-0 font-sans">
              <Button
                type="button"
                variant="secondary"
                onClick={requestCloseDrawer}
              >
                {isTargetRootProtected ? "Close" : "Cancel"}
              </Button>
              {!isTargetRootProtected && (
                <Button
                  type="submit"
                  variant="primary"
                  disabled={isSaveDisabled}
                >
                  {isSubmitting ? (
                    <div className="flex items-center gap-2">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving...</span>
                    </div>
                  ) : editingUser ? (
                    "Save Changes"
                  ) : (
                    "Create User"
                  )}
                </Button>
              )}
            </div>
          </form>
        )}
      </SlideOver>

      {/* Discard Unsaved Changes Confirmation Dialog */}
      <ConfirmDialog
        isOpen={confirmDiscardOpen}
        title="Discard Unsaved Changes"
        description={
          editingUser
            ? "You have unsaved changes to this user account. Are you sure you want to discard them?"
            : "You have unsaved user configuration. Are you sure you want to discard your changes?"
        }
        confirmLabel="Discard Changes"
        cancelLabel="Keep Editing"
        variant="warning"
        onConfirm={forceCloseDrawer}
        onClose={() => setConfirmDiscardOpen(false)}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title="Delete User Account"
        description={`Are you sure you want to permanently delete user '${deleteTarget?.username}'? This action cannot be undone and will immediately revoke active sessions.`}
        confirmLabel={isDeleting ? "Deleting..." : "Delete Account"}
        variant="danger"
        onConfirm={handleConfirmDelete}
        onClose={() => setDeleteTarget(null)}
      />

      {/* Floating Hover Popover for Permissions */}
      {hoveredPerms &&
        createPortal(
          <div
            style={{
              top: `${Math.max(
                12,
                hoveredPerms.rect.bottom + 6 + 320 > window.innerHeight
                  ? hoveredPerms.rect.top - 310
                  : hoveredPerms.rect.bottom + 6,
              )}px`,
              left: `${Math.max(
                16,
                Math.min(window.innerWidth - 340, hoveredPerms.rect.left),
              )}px`,
            }}
            className="fixed z-50 w-80 max-h-[340px] flex flex-col rounded-[10px] bg-[#101012] border border-[#27272a] shadow-2xl font-sans text-left animate-in fade-in duration-150"
            onMouseEnter={handlePopoverMouseEnter}
            onMouseLeave={handlePopoverMouseLeave}
          >
            {/* Popover Header */}
            <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-[#222225] bg-[#141416]/90 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                {hoveredPerms.user.id === 1 ||
                hoveredPerms.user.is_super_admin ? (
                  <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0" />
                ) : (
                  <Shield className="w-4 h-4 text-[#3b82f6] shrink-0" />
                )}
                <span className="text-[12px] font-semibold text-white truncate">
                  {hoveredPerms.user.username}
                </span>
              </div>
              {hoveredPerms.user.id === 1 ||
              hoveredPerms.user.is_super_admin ? (
                <span className="text-[10px] font-medium text-[#d4d4d8] bg-[#1c1c20] border border-[#27272a] px-2 py-0.5 rounded-full shrink-0">
                  Super Admin
                </span>
              ) : (
                <span className="text-[10px] font-medium text-[#a1a1aa] bg-[#1c1c20] px-2 py-0.5 rounded-full border border-[#27272a] shrink-0">
                  {(hoveredPerms.user.permissions?.system?.length || 0) +
                    (hoveredPerms.user.permissions?.databases?.length || 0) +
                    (hoveredPerms.user.permissions?.blobs?.length || 0)}{" "}
                  granted
                </span>
              )}
            </div>

            {/* Popover Content */}
            <div className="p-3 overflow-y-auto space-y-3 max-h-[280px] scrollbar-thin scrollbar-thumb-[#262626]">
              {(() => {
                const data = getPopoverCategories(hoveredPerms.user);

                if (data.isRoot) {
                  return (
                    <div className="space-y-2.5">
                      <p className="text-[11px] text-[#a1a1aa] leading-relaxed">
                        Sovereign root account. Bypasses all PBAC restrictions
                        with unrestricted global system authority.
                      </p>
                      <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                        <div className="flex items-center gap-1.5 text-[#e4e4e7] bg-[#18181b] px-2 py-1 rounded border border-[#27272a]">
                          <Check className="w-3 h-3 text-[#a1a1aa] shrink-0" />{" "}
                          Databases
                        </div>
                        <div className="flex items-center gap-1.5 text-[#e4e4e7] bg-[#18181b] px-2 py-1 rounded border border-[#27272a]">
                          <Check className="w-3 h-3 text-[#a1a1aa] shrink-0" />{" "}
                          SQL Queries
                        </div>
                        <div className="flex items-center gap-1.5 text-[#e4e4e7] bg-[#18181b] px-2 py-1 rounded border border-[#27272a]">
                          <Check className="w-3 h-3 text-[#a1a1aa] shrink-0" />{" "}
                          Blob Storage
                        </div>
                        <div className="flex items-center gap-1.5 text-[#e4e4e7] bg-[#18181b] px-2 py-1 rounded border border-[#27272a]">
                          <Check className="w-3 h-3 text-[#a1a1aa] shrink-0" />{" "}
                          API Keys
                        </div>
                        <div className="flex items-center gap-1.5 text-[#e4e4e7] bg-[#18181b] px-2 py-1 rounded border border-[#27272a]">
                          <Check className="w-3 h-3 text-[#a1a1aa] shrink-0" />{" "}
                          Roles & RBAC
                        </div>
                        <div className="flex items-center gap-1.5 text-[#e4e4e7] bg-[#18181b] px-2 py-1 rounded border border-[#27272a]">
                          <Check className="w-3 h-3 text-[#a1a1aa] shrink-0" />{" "}
                          Cluster Mesh
                        </div>
                      </div>
                    </div>
                  );
                }

                if (data.totalCount === 0) {
                  return (
                    <div className="py-4 text-center">
                      <Lock className="w-4 h-4 text-[#52525b] mx-auto mb-1.5" />
                      <p className="text-[11px] text-[#71717a]">
                        Zero permissions assigned
                      </p>
                      <p className="text-[10px] text-[#52525b]">
                        This operator cannot perform administrative operations
                      </p>
                    </div>
                  );
                }

                return (
                  <>
                    {/* System Capabilities by Category */}
                    {data.groups.map((grp) => {
                      const GrpIcon = grp.icon;
                      return (
                        <div key={grp.id} className="space-y-1.5">
                          <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#d4d4d8]">
                            <GrpIcon className="w-3 h-3 text-[#71717a] shrink-0" />
                            <span>{grp.name}</span>
                          </div>
                          <div className="flex flex-wrap gap-1 pl-4">
                            {grp.granted.map((p) => (
                              <span
                                key={p.id}
                                className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[#18181b] text-[#e4e4e7] border border-[#27272a]"
                              >
                                {p.label}
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })}

                    {/* Database & Table Rules */}
                    {data.dbRules.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#d4d4d8]">
                          <Database className="w-3 h-3 text-[#71717a] shrink-0" />
                          <span>Database & SQL Rules</span>
                        </div>
                        <div className="space-y-1 pl-4">
                          {data.dbRules.map((rule, idx) => (
                            <div
                              key={idx}
                              className="text-[10px] font-mono bg-[#18181b] p-1.5 rounded border border-[#27272a] flex items-center justify-between gap-2"
                            >
                              <span className="text-white truncate">
                                {rule.database}.{rule.table_name || "*"}
                              </span>
                              <span className="text-[#a1a1aa] shrink-0">
                                [{rule.operations.join(", ")}]
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Blob Rules */}
                    {data.blobRules.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#d4d4d8]">
                          <HardDrive className="w-3 h-3 text-[#71717a] shrink-0" />
                          <span>Blob Storage Rules</span>
                        </div>
                        <div className="space-y-1 pl-4">
                          {data.blobRules.map((rule, idx) => (
                            <div
                              key={idx}
                              className="text-[10px] font-mono bg-[#18181b] p-1.5 rounded border border-[#27272a] flex items-center justify-between gap-2"
                            >
                              <span className="text-white truncate">
                                {rule.namespace}
                              </span>
                              <span className="text-[#a1a1aa] shrink-0">
                                [{rule.operations.join(", ")}]
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
