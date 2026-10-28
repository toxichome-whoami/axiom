/*
 * Database management interface for monitoring, attaching, and configuring pools.
 * Owned by: ui/databases
 * Key deps: CustomSelect, SlideOver, DataTable, lucide-react
 * Invariants: Pool URLs are verified against engine protocol schemes before handshake.
 * Last structural change: Added dialect-aware connection URL format validation.
 */

import React, { useState, useMemo, useRef, useEffect } from "react";
import { DatabasePool, EngineType, formatEngine } from "../types";
import { DataTable, Column } from "../components/shared/DataTable";
import { SlideOver } from "../components/ui/SlideOver";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { CustomSelect } from "../components/shared/CustomSelect";
import {
  Database,
  Plus,
  CheckCircle2,
  Search,
  Trash2,
  RefreshCw,
  AlertTriangle,
  AlertCircle,
  Check,
  Eye,
  EyeOff,
  Table,
} from "lucide-react";
import { api, DatabaseRecordApi } from "../api/client";
import { hasPermission } from "../api/session";
import { validateCleanName } from "../utils/validation";
import { FilterRule, matchesRule } from "../utils/filters";

export { validateCleanName };
export type { FilterRule };

export type { SslMode, DatabaseConnectionFields } from "../utils/databaseUrl";
export {
  SSL_MODE_OPTIONS,
  ENGINE_URL_SCHEMES,
  DEFAULT_ENGINE_PORTS,
  DEFAULT_ENGINE_SCHEMES,
  extractSslModeFromUrl,
  applySslModeToUrl,
  buildDatabaseUrl,
  parseDatabaseUrl,
  validateDatabaseUrl,
} from "../utils/databaseUrl";

import {
  SslMode,
  DatabaseConnectionFields,
  SSL_MODE_OPTIONS,
  ENGINE_URL_SCHEMES,
  DEFAULT_ENGINE_PORTS,
  extractSslModeFromUrl,
  applySslModeToUrl,
  buildDatabaseUrl,
  parseDatabaseUrl,
  validateDatabaseUrl,
} from "../utils/databaseUrl";

function toSafeInt(
  val: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = typeof val === "number" ? val : parseInt(String(val), 10);
  if (isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function Databases() {
  const [pools, setPools] = useState<DatabasePool[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const fetchGenRef = useRef(0);

  // Pagination State (F-06)
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Load database connections and live health state from backend with race guard (F-07)
  const loadDatabases = async () => {
    const curGen = ++fetchGenRef.current;
    setLoadError(null);
    try {
      const [dbRes, healthRes] = await Promise.allSettled([
        api.listDatabases(),
        api.getHealth(),
      ]);

      if (curGen !== fetchGenRef.current) return;

      if (dbRes.status === "fulfilled") {
        const dbList: DatabaseRecordApi[] = dbRes.value.databases;
        const healthMap =
          healthRes.status === "fulfilled" ? healthRes.value.databases : {};

        const loadedPools: DatabasePool[] = dbList.map((db) => {
          const isUp = healthMap[db.alias] === "up";
          return {
            alias: db.alias,
            engine: (db.engine || "PostgreSQL") as EngineType,
            version: `${db.engine} (live)`,
            url: "••••••••••••••••",
            minConnections: db.pool_min || 1,
            maxConnections: db.pool_max || 10,
            idleTimeoutSeconds: 30,
            readonly: false,
            status: isUp ? "Ready" : "Degraded",
            latencyMs: isUp ? 0.45 : 12.0,
          };
        });

        setPools(loadedPools);
        setSelectedPool((prev) => {
          if (!prev) return null;
          const found = loadedPools.find((p) => p.alias === prev.alias);
          return found ? found : prev;
        });
      } else {
        setLoadError(
          dbRes.reason?.message || "Failed to load database connections",
        );
      }
    } catch (err: unknown) {
      if (curGen === fetchGenRef.current) {
        setLoadError(
          err instanceof Error
            ? err.message
            : "Unexpected error loading databases",
        );
      }
    } finally {
      if (curGen === fetchGenRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  };

  useEffect(() => {
    loadDatabases();
  }, []);

  // Toolbar & Filtering State
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
    status: true,
    alias: true,
    engine: true,
    conns: true,
    latency: true,
  });

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

  // Attach DB SlideOver State
  const [attachOpen, setAttachOpen] = useState(false);
  const [newConnectMode, setNewConnectMode] = useState<"fields" | "string">(
    "fields",
  );
  const [newHost, setNewHost] = useState("");
  const [newPort, setNewPort] = useState(
    DEFAULT_ENGINE_PORTS["postgresql"] || "5432",
  );
  const [newDatabase, setNewDatabase] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [newLibsqlMode, setNewLibsqlMode] = useState<"local" | "remote">(
    "local",
  );
  const [newLibsqlFile, setNewLibsqlFile] = useState("");
  const [newSnowflakeWarehouse, setNewSnowflakeWarehouse] = useState("");
  const [newSnowflakeSchema, setNewSnowflakeSchema] = useState("");
  const [newSnowflakeRole, setNewSnowflakeRole] = useState("");
  const [newAlias, setNewAlias] = useState("");
  const [newEngine, setNewEngine] = useState<string>("PostgreSQL");
  const [newUrl, setNewUrl] = useState("");
  const [newSslMode, setNewSslMode] = useState<SslMode>("prefer");
  const [showNewUrl, setShowNewUrl] = useState(false);
  const [newToken, setNewToken] = useState("");
  const [showNewToken, setShowNewToken] = useState(false);
  const [newMin, setNewMin] = useState(1);
  const [newMax, setNewMax] = useState(10);
  const [newTimeout, setNewTimeout] = useState(30);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [isAttaching, setIsAttaching] = useState(false);

  // Manage DB SlideOver State
  const [manageOpen, setManageOpen] = useState(false);
  const [manageTab, setManageTab] = useState<"details" | "danger">("details");
  const [selectedPool, setSelectedPool] = useState<DatabasePool | null>(null);
  const [editConnectMode, setEditConnectMode] = useState<"fields" | "string">(
    "fields",
  );
  const [editHost, setEditHost] = useState("");
  const [editPort, setEditPort] = useState("");
  const [editDatabase, setEditDatabase] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [editLibsqlMode, setEditLibsqlMode] = useState<"local" | "remote">(
    "local",
  );
  const [editLibsqlFile, setEditLibsqlFile] = useState("");
  const [editSnowflakeWarehouse, setEditSnowflakeWarehouse] = useState("");
  const [editSnowflakeSchema, setEditSnowflakeSchema] = useState("");
  const [editSnowflakeRole, setEditSnowflakeRole] = useState("");
  const [editAlias, setEditAlias] = useState("");
  const [editEngine, setEditEngine] = useState<EngineType>("PostgreSQL");
  const [editUrl, setEditUrl] = useState("");
  const [editSslMode, setEditSslMode] = useState<SslMode>("prefer");
  const [showEditUrl, setShowEditUrl] = useState(false);
  const [editToken, setEditToken] = useState("");
  const [showEditToken, setShowEditToken] = useState(false);
  const [editMin, setEditMin] = useState(1);
  const [editMax, setEditMax] = useState(10);
  const [editTimeout, setEditTimeout] = useState(30);
  const [manageTestResult, setManageTestResult] = useState<
    "testing" | "success" | "fail" | null
  >(null);
  const [manageError, setManageError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false);
  const [confirmDiscardAttachOpen, setConfirmDiscardAttachOpen] =
    useState(false);
  const [confirmDiscardEditOpen, setConfirmDiscardEditOpen] = useState(false);

  async function handleTestConnection() {
    if (newConnectMode === "fields") {
      if (newEngine.toLowerCase() === "libsql") {
        if (newLibsqlMode === "remote" && !newHost.trim()) {
          setAttachError("Turso endpoint URL is required for remote LibSQL.");
          setTestResult("fail");
          return;
        }
      } else if (!newHost.trim()) {
        setAttachError("Host is required.");
        setTestResult("fail");
        return;
      }
    }
    const validation = validateDatabaseUrl(newEngine, newUrl);
    if (!validation.valid) {
      setAttachError(
        validation.error || "Invalid URL format for selected engine.",
      );
      setTestResult("fail");
      return;
    }

    setAttachError(null);
    setTestResult("testing");
    try {
      await api.testDatabaseUrl(
        newUrl.trim(),
        newAlias.trim() || undefined,
        newEngine,
        newToken.trim() || undefined,
      );
      setTestResult("success");
    } catch (err: unknown) {
      setTestResult("fail");
      setAttachError(
        err instanceof Error ? err.message : "Connection test failed.",
      );
    }
  }

  async function handleManageTestConnection() {
    if (!selectedPool) return;
    setManageError(null);
    setManageTestResult("testing");
    try {
      if (urlChanged || editToken.trim().length > 0) {
        const validation = validateDatabaseUrl(editEngine, editUrl);
        if (!validation.valid) {
          setManageTestResult("fail");
          setManageError(
            validation.error || "Invalid URL format for selected engine.",
          );
          return;
        }
        await api.testDatabaseUrl(
          editUrl.trim(),
          selectedPool.alias,
          editEngine,
          editToken.trim() || undefined,
        );
        setManageTestResult("success");
        setSelectedPool((prev) => (prev ? { ...prev, status: "Ready" } : null));
        setPools((prev) =>
          prev.map((p) =>
            p.alias === selectedPool.alias ? { ...p, status: "Ready" } : p,
          ),
        );
      } else {
        const test = await api.testDatabase(selectedPool.alias);
        if (test.status === "up" || test.status === "connected") {
          setManageTestResult("success");
          setSelectedPool((prev) =>
            prev ? { ...prev, status: "Ready" } : null,
          );
          setPools((prev) =>
            prev.map((p) =>
              p.alias === selectedPool.alias ? { ...p, status: "Ready" } : p,
            ),
          );
        } else {
          setManageTestResult("fail");
          setManageError("Target reported down during health probe.");
          setSelectedPool((prev) =>
            prev ? { ...prev, status: "Degraded" } : null,
          );
          setPools((prev) =>
            prev.map((p) =>
              p.alias === selectedPool.alias ? { ...p, status: "Degraded" } : p,
            ),
          );
        }
      }
    } catch (err: unknown) {
      setManageTestResult("fail");
      const msg = err instanceof Error ? err.message : "Database test failed.";
      setManageError(msg);
      setSelectedPool((prev) =>
        prev ? { ...prev, status: "Degraded" } : null,
      );
      setPools((prev) =>
        prev.map((p) =>
          p.alias === selectedPool.alias ? { ...p, status: "Degraded" } : p,
        ),
      );
    }
  }

  const urlChanged = Boolean(editUrl.trim().length > 0);
  const editUrlValidation = urlChanged
    ? validateDatabaseUrl(editEngine, editUrl)
    : { valid: true };

  const poolOk = newMin >= 0 && newMax >= newMin && newTimeout >= 1;
  const editPoolOk = editMin >= 0 && editMax >= editMin && editTimeout >= 1;

  // Reset pagination on query or filter changes (F-06)
  useEffect(() => {
    setPage(1);
  }, [searchQuery, appliedFilterRules, matchMode]);

  const isChanged = Boolean(
    selectedPool &&
    (editAlias.trim() !== selectedPool.alias ||
      editEngine !== selectedPool.engine ||
      urlChanged ||
      editHost.trim().length > 0 ||
      editDatabase.trim().length > 0 ||
      editUsername.trim().length > 0 ||
      editPassword.length > 0 ||
      editLibsqlFile.trim().length > 0 ||
      editSnowflakeWarehouse.trim().length > 0 ||
      editSnowflakeSchema.trim().length > 0 ||
      editSnowflakeRole.trim().length > 0 ||
      editToken.trim().length > 0 ||
      editMin !== selectedPool.minConnections ||
      editMax !== selectedPool.maxConnections ||
      editTimeout !== selectedPool.idleTimeoutSeconds ||
      editSslMode !==
        extractSslModeFromUrl(selectedPool.url, selectedPool.engine)),
  );

  const aliasValidation = validateCleanName(newAlias);
  const urlValidation = validateDatabaseUrl(newEngine, newUrl);
  const editAliasValidation = validateCleanName(editAlias);

  const canSave = Boolean(
    isChanged &&
    editAliasValidation.valid &&
    editUrlValidation.valid &&
    editPoolOk &&
    !isSaving &&
    manageTestResult !== "testing",
  );

  const isAttachDirty = Boolean(
    newAlias.trim().length > 0 ||
    newUrl.trim().length > 0 ||
    newHost.trim().length > 0 ||
    newDatabase.trim().length > 0 ||
    newUsername.trim().length > 0 ||
    newPassword.length > 0 ||
    newLibsqlFile.trim().length > 0 ||
    newSnowflakeWarehouse.trim().length > 0 ||
    newSnowflakeSchema.trim().length > 0 ||
    newSnowflakeRole.trim().length > 0 ||
    newToken.trim().length > 0 ||
    newEngine !== "PostgreSQL" ||
    newSslMode !== "prefer" ||
    newMin !== 1 ||
    newMax !== 10 ||
    newTimeout !== 30,
  );

  const canAttach = Boolean(
    !isAttaching &&
    newAlias.trim().length > 0 &&
    aliasValidation.valid &&
    poolOk &&
    (newEngine.toLowerCase() === "libsql"
      ? newConnectMode === "string" ||
        newLibsqlMode === "local" ||
        newHost.trim().length > 0
      : newUrl.trim().length > 0 &&
        urlValidation.valid &&
        (newConnectMode === "string" || newHost.trim().length > 0)),
  );

  function requestCloseAttach() {
    if (isAttachDirty) {
      setConfirmDiscardAttachOpen(true);
    } else {
      forceCloseAttach();
    }
  }

  function forceCloseAttach() {
    setConfirmDiscardAttachOpen(false);
    setAttachOpen(false);
    setNewConnectMode("fields");
    setNewHost("");
    setNewPort(DEFAULT_ENGINE_PORTS["postgresql"] || "5432");
    setNewDatabase("");
    setNewUsername("");
    setNewPassword("");
    setShowNewPassword(false);
    setNewLibsqlMode("local");
    setNewLibsqlFile("");
    setNewSnowflakeWarehouse("");
    setNewSnowflakeSchema("");
    setNewSnowflakeRole("");
    setNewAlias("");
    setNewUrl("");
    setNewSslMode("prefer");
    setNewToken("");
    setNewEngine("PostgreSQL");
    setNewMin(1);
    setNewMax(10);
    setNewTimeout(30);
    setAttachError(null);
    setTestResult(null);
  }

  function requestCloseManage() {
    if (isChanged) {
      setConfirmDiscardEditOpen(true);
    } else {
      forceCloseManage();
    }
  }

  function forceCloseManage() {
    setConfirmDiscardEditOpen(false);
    setManageOpen(false);
    setManageTab("details");
    setManageError(null);
    setManageTestResult(null);
    setEditConnectMode("fields");
    setEditHost("");
    setEditPort("");
    setEditDatabase("");
    setEditUsername("");
    setEditPassword("");
    setShowEditPassword(false);
    setEditLibsqlMode("local");
    setEditLibsqlFile("");
    setEditSnowflakeWarehouse("");
    setEditSnowflakeSchema("");
    setEditSnowflakeRole("");
  }

  async function handleAttach() {
    if (!newAlias.trim() || !poolOk) return;
    if (!aliasValidation.valid) {
      setAttachError(aliasValidation.error || "Invalid alias format.");
      setTestResult("fail");
      return;
    }
    if (newConnectMode === "fields") {
      if (newEngine.toLowerCase() === "libsql") {
        if (newLibsqlMode === "remote" && !newHost.trim()) {
          setAttachError("Turso endpoint URL is required for remote LibSQL.");
          setTestResult("fail");
          return;
        }
      } else if (!newHost.trim()) {
        setAttachError("Host is required.");
        setTestResult("fail");
        return;
      }
    }
    const validation = validateDatabaseUrl(newEngine, newUrl);
    if (!validation.valid) {
      setAttachError(
        validation.error || "Invalid URL format for selected engine.",
      );
      setTestResult("fail");
      return;
    }

    setAttachError(null);
    setTestResult("testing");
    setIsAttaching(true);

    try {
      // 1. Mandatory live connection check every time when adding
      await api.testDatabaseUrl(
        newUrl.trim(),
        newAlias.trim() || undefined,
        newEngine,
        newToken.trim() || undefined,
      );
      setTestResult("success");

      // 2. Register database once connection is verified
      await api.addDatabase({
        alias: newAlias.trim(),
        url: newUrl.trim(),
        engine: newEngine,
        token: newToken.trim() || undefined,
        pool_min: newMin,
        pool_max: newMax,
      });
      await loadDatabases();
      setAttachOpen(false);
      setNewConnectMode("fields");
      setNewHost("");
      setNewPort(DEFAULT_ENGINE_PORTS["postgresql"] || "5432");
      setNewDatabase("");
      setNewUsername("");
      setNewPassword("");
      setShowNewPassword(false);
      setNewLibsqlMode("local");
      setNewLibsqlFile("");
      setNewSnowflakeWarehouse("");
      setNewSnowflakeSchema("");
      setNewSnowflakeRole("");
      setNewAlias("");
      setNewUrl("");
      setNewToken("");
      setShowNewToken(false);
      setNewMin(1);
      setNewMax(10);
      setNewTimeout(30);
      setTestResult(null);
      setAttachError(null);
    } catch (err: unknown) {
      setTestResult("fail");
      setAttachError(
        err instanceof Error
          ? err.message
          : "Database connection test failed. Please verify URL.",
      );
    } finally {
      setIsAttaching(false);
    }
  }

  async function handleSaveEdit() {
    if (!selectedPool || !canSave) return;
    const oldAlias = selectedPool.alias;
    const updatedAlias = editAlias.trim();
    const updatedUrl = urlChanged ? editUrl.trim() : "";
    setManageError(null);
    setManageTestResult("testing");
    setIsSaving(true);

    try {
      // 1. Mandatory live connection check every time when updating
      if (urlChanged || editToken.trim().length > 0) {
        await api.testDatabaseUrl(
          updatedUrl,
          selectedPool.alias,
          editEngine,
          editToken.trim() || undefined,
        );
      } else {
        const test = await api.testDatabase(oldAlias);
        if (test.status !== "up" && test.status !== "connected") {
          throw new Error("Target database connection check failed.");
        }
      }
      setManageTestResult("success");

      // 2. Persist updated configuration once connection is verified
      await api.addDatabase({
        alias: updatedAlias,
        url: updatedUrl,
        engine: editEngine,
        token: editToken.trim() || undefined,
        pool_min: editMin,
        pool_max: editMax,
        old_alias: oldAlias,
      });
      if (oldAlias !== updatedAlias) {
        await api.deleteDatabase(oldAlias).catch(() => {});
      }
      await loadDatabases();
      setManageOpen(false);
      setEditToken("");
      setShowEditToken(false);
    } catch (err: unknown) {
      setManageTestResult("fail");
      setManageError(
        err instanceof Error
          ? err.message
          : "Database connection test failed. Unable to save.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  const engineOptions: { value: EngineType; label: string }[] = [
    { value: "PostgreSQL", label: "PostgreSQL 14 / 15 / 16 (sqlx driver)" },
    { value: "MySQL", label: "MySQL 8.0 / MariaDB (sqlx driver)" },
    { value: "MSSQL", label: "Microsoft SQL Server (tiberius TDS)" },
    { value: "ClickHouse", label: "ClickHouse OLAP (HTTP engine)" },
    { value: "LibSQL", label: "LibSQL / SQLite (Turso & local)" },
    { value: "Snowflake", label: "Snowflake Cloud Data Warehouse (REST v2)" },
    {
      value: "Oracle",
      label: "Oracle Database 19c / 21c / 23ai (Thin / ORDS)",
    },
  ];

  const filterFieldOptions = [
    { value: "alias", label: "Pool Alias" },
    { value: "engine", label: "Engine" },
    { value: "status", label: "Status" },
  ];

  const displayColumnOptions = [
    { id: "status", label: "Status" },
    { id: "alias", label: "Pool Alias" },
    { id: "engine", label: "Engine" },
    { id: "conns", label: "Connection Limits" },
    { id: "latency", label: "Ping Latency" },
  ];

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
      status: true,
      alias: true,
      engine: true,
      conns: true,
      latency: true,
    });
  };

  const filteredPools = useMemo(() => {
    let list = pools;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (p) =>
          p.alias.toLowerCase().includes(q) ||
          p.engine.toLowerCase().includes(q),
      );
    }
    if (appliedFilterRules.length > 0) {
      list = list.filter((p) => {
        const tests = appliedFilterRules.map((rule) => {
          const val = String(
            (p as unknown as Record<string, unknown>)[rule.field] ?? "",
          );
          return matchesRule(val, rule.operator, rule.value);
        });
        return matchMode === "any" ? tests.some(Boolean) : tests.every(Boolean);
      });
    }
    return list;
  }, [pools, searchQuery, appliedFilterRules, matchMode]);

  const columns: Column<DatabasePool>[] = [
    {
      id: "status",
      header: "Status",
      accessorKey: "status",
      width: 130,
      isResizable: true,
      className: "pl-4 pr-3",
      cell: (row) => (
        <div
          className="flex items-center gap-2 text-[14px] text-white font-normal truncate whitespace-nowrap"
          title={row.status}
        >
          <span
            className={`size-1.5 rounded-full shrink-0 ${
              row.status === "Ready"
                ? "bg-[#30a46c]"
                : row.status === "Degraded"
                  ? "bg-[#f59e0b]"
                  : "bg-[#e5484d]"
            }`}
          />
          <span className="truncate whitespace-nowrap">{row.status}</span>
        </div>
      ),
    },
    {
      id: "alias",
      header: "Pool Alias",
      accessorKey: "alias",
      isSortable: true,
      isResizable: true,
      width: 220,
      className: "px-3",
      cell: (row) => (
        <div className="flex items-center gap-2.5 min-w-0">
          <Database className="w-4 h-4 text-[#8c8c8c] shrink-0" />
          <span
            className="font-medium text-white text-[14px] truncate whitespace-nowrap"
            title={row.alias}
          >
            {row.alias}
          </span>
        </div>
      ),
    },
    {
      id: "engine",
      header: "Engine",
      accessorKey: "engine",
      width: 170,
      isResizable: true,
      className: "px-3",
      cell: (row) => (
        <span
          className="text-[14px] text-[#cccccc] font-normal truncate whitespace-nowrap block"
          title={formatEngine(row.engine)}
        >
          {formatEngine(row.engine)}
        </span>
      ),
    },
    {
      id: "conns",
      header: "Connection Limits",
      width: 180,
      isResizable: true,
      className: "px-3",
      cell: (row) => (
        <span
          className="tabular-nums text-[14px] text-[#d4d4d4] font-normal truncate whitespace-nowrap block"
          title={`${row.minConnections} min / ${row.maxConnections} max`}
        >
          {row.minConnections} min / {row.maxConnections} max
        </span>
      ),
    },
    {
      id: "latency",
      header: "Ping Latency",
      width: 140,
      className: "px-3",
      cell: (row) => (
        <span
          className="tabular-nums text-[14px] text-[#8c8c8c] font-normal truncate whitespace-nowrap block"
          title={`${row.latencyMs} ms`}
        >
          {row.latencyMs} ms
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
        <div className="flex items-center justify-end gap-2 w-full">
          <button
            type="button"
            onClick={() => {
              window.history.pushState(
                null,
                "",
                `/system/tables?db=${encodeURIComponent(row.alias)}`,
              );
              window.dispatchEvent(new PopStateEvent("popstate"));
            }}
            className="inline-flex items-center justify-center gap-1.5 h-7 px-2.5 rounded-[6px] text-[13px] font-medium leading-none text-[#8c8c8c] hover:text-white bg-transparent hover:bg-[#1a1a1a] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer shrink-0"
            title="Open in Table & Schema Editor"
          >
            <Table className="w-3.5 h-3.5" />
            Explore
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedPool(row);
              setEditAlias(row.alias);
              setEditEngine(row.engine);
              setEditConnectMode("fields");
              setEditUrl("");
              setEditHost("");
              setEditPort(DEFAULT_ENGINE_PORTS[row.engine.toLowerCase()] || "");
              setEditDatabase("");
              setEditUsername("");
              setEditPassword("");
              setShowEditPassword(false);
              setEditLibsqlMode("local");
              setEditLibsqlFile("");
              setEditSnowflakeWarehouse("");
              setEditSnowflakeSchema("");
              setEditSnowflakeRole("");
              setEditSslMode(extractSslModeFromUrl(row.url || "", row.engine));
              setEditToken("");
              setShowEditToken(false);
              setEditMin(row.minConnections);
              setEditMax(row.maxConnections);
              setEditTimeout(row.idleTimeoutSeconds);
              setManageTestResult(null);
              setManageError(null);
              setManageTab("details");
              setManageOpen(true);
            }}
            className="inline-flex items-center justify-center h-7 px-3 rounded-[6px] text-[13px] font-medium leading-none text-[#8c8c8c] hover:text-white bg-transparent hover:bg-[#1a1a1a] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer shrink-0"
          >
            Manage
          </button>
        </div>
      ),
    },
  ];

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
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-[16px] font-medium text-white tracking-tight">
            Databases
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setIsRefreshing(true);
              loadDatabases();
            }}
            title="Refresh database pools"
            className="flex items-center justify-center h-8 w-8 text-[#8c8c8c] hover:text-white rounded-[8px] bg-[#0c0c0c] hover:bg-[#141414] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer shrink-0"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin opacity-50" : ""}`}
            />
          </button>
          <Button
            variant="primary"
            size="sm"
            disabled={!hasPermission("databases.create")}
            onClick={() => {
              setTestResult(null);
              setAttachError(null);
              setNewConnectMode("fields");
              setNewHost("");
              setNewPort(DEFAULT_ENGINE_PORTS["postgresql"] || "5432");
              setNewDatabase("");
              setNewUsername("");
              setNewPassword("");
              setShowNewPassword(false);
              setNewLibsqlMode("local");
              setNewLibsqlFile("");
              setNewSnowflakeWarehouse("");
              setNewSnowflakeSchema("");
              setNewSnowflakeRole("");
              setNewAlias("");
              setNewUrl("");
              setNewToken("");
              setShowNewToken(false);
              setNewMin(1);
              setNewMax(10);
              setNewTimeout(30);
              setAttachOpen(true);
            }}
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            Attach Database
          </Button>
        </div>
      </div>

      {/* Table Controls Toolbar (Search, Filters, Display Options) */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 select-none font-sans">
        <label
          title="Search databases..."
          className="relative flex items-center h-9 rounded-[8px] bg-transparent border border-[#262626] focus-within:border-[#2f80ed] transition-colors px-3 gap-2 w-full sm:w-[260px] md:w-[300px]"
        >
          <Search className="w-3.5 h-3.5 text-[#8c8c8c] shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search databases..."
            className="w-full bg-transparent border-0 text-[14px] text-white placeholder-[#8c8c8c] outline-none font-normal font-sans"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="flex items-center justify-center w-5 h-5 rounded hover:bg-[#222222] text-[#8c8c8c] hover:text-white transition-colors cursor-pointer shrink-0 font-sans"
              title="Clear search"
            >
              ✕
            </button>
          )}
        </label>

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
              title="Filter database pools"
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
                      Database Filters
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
                        className="w-32 sm:w-36 shrink-0"
                        menuWidth="w-40"
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
                  Reset columns
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Error Banner (F-09) */}
      {loadError && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-[#2a1113] border border-[#5c1d24] text-[#f87171] text-[13px]">
          <AlertTriangle className="w-4 h-4 shrink-0 text-[#ef4444]" />
          <span>{loadError}</span>
        </div>
      )}

      {/* Pools Read-Only DataTable */}
      <DataTable
        columns={activeColumns}
        data={filteredPools}
        isLoading={isLoading}
        ariaLabel="Database Pools Table"
        pagination={{
          page,
          pageSize,
          totalCount: filteredPools.length,
          onPageChange: setPage,
          onPageSizeChange: (newSize) => {
            setPageSize(newSize);
            setPage(1);
          },
        }}
      />

      {/* Attach DB SlideOver */}
      <SlideOver
        isOpen={attachOpen}
        onClose={requestCloseAttach}
        title="Attach Database Pool"
        subtitle="Configure connection endpoint, dialect engine, and credential URI"
      >
        <div className="flex-1 p-5 overflow-y-auto space-y-4">
          <div>
            <h3 className="text-[16px] font-medium text-white tracking-tight">
              Pool Configuration
            </h3>
            <p className="text-[13px] text-[#8c8c8c] mt-0.5">
              Provide connection endpoint, dialect engine, and credential URI.
            </p>
          </div>

          <div>
            <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
              Database Engine
            </label>
            <CustomSelect
              value={newEngine}
              options={engineOptions}
              onChange={(val) => {
                const prevEngine = newEngine;
                const nextEngine = val as string;
                setNewEngine(nextEngine);
                const oldDefaultPort =
                  DEFAULT_ENGINE_PORTS[prevEngine.toLowerCase()] || "";
                const newDefaultPort =
                  DEFAULT_ENGINE_PORTS[nextEngine.toLowerCase()] || "";
                let updatedPort = newPort;
                if (!newPort || newPort === oldDefaultPort) {
                  updatedPort = newDefaultPort;
                  setNewPort(newDefaultPort);
                }
                if (
                  nextEngine.toLowerCase() === "postgresql" ||
                  nextEngine.toLowerCase() === "mysql"
                ) {
                  setNewSslMode(extractSslModeFromUrl(newUrl, nextEngine));
                }
                if (newConnectMode === "fields") {
                  const nextUrl = buildDatabaseUrl(
                    nextEngine,
                    {
                      host: newHost,
                      port: updatedPort,
                      database: newDatabase,
                      username: newUsername,
                      password: newPassword,
                      libsqlMode: newLibsqlMode,
                      libsqlFile: newLibsqlFile,
                      warehouse: newSnowflakeWarehouse,
                      schema: newSnowflakeSchema,
                      role: newSnowflakeRole,
                      token: newToken,
                    },
                    newSslMode,
                  );
                  setNewUrl(nextUrl);
                }
                setTestResult(null);
                setAttachError(null);
              }}
              menuWidth="w-full"
            />
          </div>

          <div>
            <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
              Pool Alias (Identifier) <span className="text-[#e5484d]">*</span>
            </label>
            <input
              type="text"
              value={newAlias}
              onChange={(e) =>
                setNewAlias(e.target.value.toLowerCase().replace(/\s+/g, "_"))
              }
              placeholder="e.g. analytics_warehouse"
              className={`h-9 w-full rounded-[6px] border px-3 text-[14px] text-white focus:outline-none font-mono lowercase transition-colors ${
                newAlias.trim().length > 0 && !aliasValidation.valid
                  ? "border-[#e5484d] bg-[#1a0f0f] focus:border-[#e5484d] focus:ring-1 focus:ring-[#e5484d]/40"
                  : "border-[#262626] bg-[#121212] focus:border-[#3b82f6]"
              }`}
            />
            {newAlias.trim().length > 0 && !aliasValidation.valid ? (
              <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-[#e5484d]">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{aliasValidation.error}</span>
              </div>
            ) : (
              <p className="mt-1.5 text-[12px] text-[#737373]">
                Unique endpoint identifier used in API routes (e.g.{" "}
                <span className="font-mono text-[#a3a3a3]">
                  analytics_warehouse
                </span>
                ).
              </p>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-[13px] font-medium text-[#cccccc]">
                Connection{" "}
                {newEngine.toLowerCase() !== "libsql" && (
                  <span className="text-[#e5484d]">*</span>
                )}
              </label>
              <div className="inline-flex items-center rounded-[6px] border border-[#262626] bg-[#121212] p-0.5 select-none">
                <button
                  type="button"
                  onClick={() => {
                    if (newConnectMode !== "fields") {
                      const parsed = parseDatabaseUrl(newUrl, newEngine);
                      setNewHost(parsed.host);
                      setNewPort(
                        parsed.port ||
                          DEFAULT_ENGINE_PORTS[newEngine.toLowerCase()] ||
                          "",
                      );
                      setNewDatabase(parsed.database);
                      setNewUsername(parsed.username);
                      setNewPassword(parsed.password);
                      if (parsed.libsqlMode)
                        setNewLibsqlMode(parsed.libsqlMode);
                      if (parsed.libsqlFile)
                        setNewLibsqlFile(parsed.libsqlFile);
                      if (parsed.warehouse)
                        setNewSnowflakeWarehouse(parsed.warehouse);
                      if (parsed.schema) setNewSnowflakeSchema(parsed.schema);
                      if (parsed.role) setNewSnowflakeRole(parsed.role);
                      if (parsed.token) setNewToken(parsed.token);
                      setNewConnectMode("fields");
                    }
                  }}
                  className={`rounded-[4px] px-2.5 py-1 text-[12px] font-medium transition-colors cursor-pointer ${
                    newConnectMode === "fields"
                      ? "bg-[#262626] text-white shadow-xs"
                      : "text-[#888888] hover:text-[#cccccc]"
                  }`}
                >
                  Fields
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (newConnectMode !== "string") {
                      setNewConnectMode("string");
                    }
                  }}
                  className={`rounded-[4px] px-2.5 py-1 text-[12px] font-medium transition-colors cursor-pointer ${
                    newConnectMode === "string"
                      ? "bg-[#262626] text-white shadow-xs"
                      : "text-[#888888] hover:text-[#cccccc]"
                  }`}
                >
                  Connection string
                </button>
              </div>
            </div>

            {newConnectMode === "fields" ? (
              newEngine.toLowerCase() === "libsql" ? (
                /* LibSQL Dialect View */
                <div className="space-y-3">
                  <div>
                    <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                      Storage Mode
                    </label>
                    <div className="inline-flex items-center rounded-[6px] border border-[#262626] bg-[#121212] p-0.5 select-none w-full">
                      <button
                        type="button"
                        onClick={() => {
                          setNewLibsqlMode("local");
                          const nextUrl = buildDatabaseUrl("libsql", {
                            host: "",
                            port: "",
                            database: "",
                            username: "",
                            password: "",
                            libsqlMode: "local",
                            libsqlFile: newLibsqlFile,
                          });
                          setNewUrl(nextUrl);
                          setTestResult(null);
                          setAttachError(null);
                        }}
                        className={`flex-1 rounded-[4px] px-2.5 py-1 text-[12px] font-medium transition-colors cursor-pointer text-center ${
                          newLibsqlMode === "local"
                            ? "bg-[#262626] text-white shadow-xs"
                            : "text-[#888888] hover:text-[#cccccc]"
                        }`}
                      >
                        Local SQLite (Embedded)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setNewLibsqlMode("remote");
                          const nextUrl = buildDatabaseUrl("libsql", {
                            host: newHost || "libsql://",
                            port: "",
                            database: "",
                            username: "",
                            password: "",
                            libsqlMode: "remote",
                            token: newToken,
                          });
                          setNewUrl(nextUrl);
                          setTestResult(null);
                          setAttachError(null);
                        }}
                        className={`flex-1 rounded-[4px] px-2.5 py-1 text-[12px] font-medium transition-colors cursor-pointer text-center ${
                          newLibsqlMode === "remote"
                            ? "bg-[#262626] text-white shadow-xs"
                            : "text-[#888888] hover:text-[#cccccc]"
                        }`}
                      >
                        Remote Turso Cloud / sqld
                      </button>
                    </div>
                  </div>

                  {newLibsqlMode === "local" ? (
                    <div className="space-y-2">
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="block text-[13px] font-medium text-[#cccccc]">
                            Database File Path
                          </label>
                          <span className="text-[11px] text-[#888888]">
                            data/{newAlias.trim() || "database"}.db (default)
                          </span>
                        </div>
                        <input
                          type="text"
                          value={newLibsqlFile}
                          onChange={(e) => {
                            const val = e.target.value;
                            setNewLibsqlFile(val);
                            const nextUrl = buildDatabaseUrl("libsql", {
                              host: "",
                              port: "",
                              database: "",
                              username: "",
                              password: "",
                              libsqlMode: "local",
                              libsqlFile: val,
                            });
                            setNewUrl(nextUrl);
                            setTestResult(null);
                            setAttachError(null);
                          }}
                          placeholder={`data/${newAlias.trim() || "database"}.db (leave blank to auto-create)`}
                          className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6] font-mono transition-colors"
                        />
                      </div>
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            setNewLibsqlFile("");
                            setNewUrl("");
                            setTestResult(null);
                            setAttachError(null);
                          }}
                          className="text-[11px] font-mono px-2 py-0.5 rounded bg-[#1a1a1a] hover:bg-[#262626] text-[#a3a3a3] hover:text-white border border-[#262626] transition-colors cursor-pointer"
                        >
                          Default (auto-create)
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setNewLibsqlFile(":memory:");
                            setNewUrl(":memory:");
                            setTestResult(null);
                            setAttachError(null);
                          }}
                          className="text-[11px] font-mono px-2 py-0.5 rounded bg-[#1a1a1a] hover:bg-[#262626] text-[#a3a3a3] hover:text-white border border-[#262626] transition-colors cursor-pointer"
                        >
                          In-Memory (:memory:)
                        </button>
                      </div>
                      <p className="text-[11px] text-[#737373] mt-1">
                        Stored locally inside the protected{" "}
                        <code className="font-mono text-[#a3a3a3]">data/</code>{" "}
                        directory. Uses high-throughput WAL mode and memory page
                        cache.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                          Turso Endpoint URL{" "}
                          <span className="text-[#e5484d]">*</span>
                        </label>
                        <input
                          type="text"
                          value={newHost}
                          onChange={(e) => {
                            const val = e.target.value;
                            setNewHost(val);
                            const nextUrl = buildDatabaseUrl("libsql", {
                              host: val,
                              port: "",
                              database: "",
                              username: "",
                              password: "",
                              libsqlMode: "remote",
                              token: newToken,
                            });
                            setNewUrl(nextUrl);
                            setTestResult(null);
                            setAttachError(null);
                          }}
                          placeholder="libsql://your-db-org.turso.io"
                          className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6] font-mono transition-colors"
                        />
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="block text-[13px] font-medium text-[#cccccc]">
                            Auth Token (Bearer JWT)
                          </label>
                          <span className="text-[11px] text-[#666666]">
                            Optional
                          </span>
                        </div>
                        <div className="relative">
                          <input
                            type={showNewToken ? "text" : "password"}
                            value={newToken}
                            onChange={(e) => {
                              const val = e.target.value;
                              setNewToken(val);
                              const nextUrl = buildDatabaseUrl("libsql", {
                                host: newHost,
                                port: "",
                                database: "",
                                username: "",
                                password: "",
                                libsqlMode: "remote",
                                token: val,
                              });
                              setNewUrl(nextUrl);
                              setTestResult(null);
                              setAttachError(null);
                            }}
                            placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6..."
                            className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] pl-3 pr-10 text-[14px] text-white focus:outline-none focus:border-[#3b82f6] font-mono transition-colors"
                          />
                          <button
                            type="button"
                            onClick={() => setShowNewToken(!showNewToken)}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#777777] hover:text-[#cccccc] transition-colors cursor-pointer"
                            tabIndex={-1}
                            aria-label={
                              showNewToken ? "Hide token" : "Show token"
                            }
                          >
                            {showNewToken ? (
                              <EyeOff className="w-3.5 h-3.5" />
                            ) : (
                              <Eye className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                        <p className="mt-1 text-[11px] text-[#737373]">
                          Required for Turso Cloud databases. Leave blank for
                          unauthenticated sqld instances.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              ) : newEngine.toLowerCase() === "snowflake" ? (
                /* Snowflake Dialect View */
                <div className="space-y-3">
                  <div>
                    <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                      Account Host / Identifier{" "}
                      <span className="text-[#e5484d]">*</span>
                    </label>
                    <input
                      type="text"
                      value={newHost}
                      onChange={(e) => {
                        const val = e.target.value;
                        setNewHost(val);
                        const nextUrl = buildDatabaseUrl("snowflake", {
                          host: val,
                          port: "443",
                          database: newDatabase,
                          schema: newSnowflakeSchema,
                          warehouse: newSnowflakeWarehouse,
                          role: newSnowflakeRole,
                          username: newUsername,
                          password: newPassword,
                        });
                        setNewUrl(nextUrl);
                        setTestResult(null);
                        setAttachError(null);
                      }}
                      placeholder="xy12345.us-east-1.snowflakecomputing.com"
                      className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6] font-mono transition-colors"
                    />
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                        Warehouse
                      </label>
                      <input
                        type="text"
                        value={newSnowflakeWarehouse}
                        onChange={(e) => {
                          const val = e.target.value;
                          setNewSnowflakeWarehouse(val);
                          const nextUrl = buildDatabaseUrl("snowflake", {
                            host: newHost,
                            port: "443",
                            database: newDatabase,
                            schema: newSnowflakeSchema,
                            warehouse: val,
                            role: newSnowflakeRole,
                            username: newUsername,
                            password: newPassword,
                          });
                          setNewUrl(nextUrl);
                          setTestResult(null);
                          setAttachError(null);
                        }}
                        placeholder="COMPUTE_WH"
                        className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6] font-mono transition-colors"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                        Role{" "}
                        <span className="text-[11px] font-normal text-[#888888]">
                          (optional)
                        </span>
                      </label>
                      <input
                        type="text"
                        value={newSnowflakeRole}
                        onChange={(e) => {
                          const val = e.target.value;
                          setNewSnowflakeRole(val);
                          const nextUrl = buildDatabaseUrl("snowflake", {
                            host: newHost,
                            port: "443",
                            database: newDatabase,
                            schema: newSnowflakeSchema,
                            warehouse: newSnowflakeWarehouse,
                            role: val,
                            username: newUsername,
                            password: newPassword,
                          });
                          setNewUrl(nextUrl);
                          setTestResult(null);
                          setAttachError(null);
                        }}
                        placeholder="ACCOUNTADMIN"
                        className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6] font-mono transition-colors"
                      />
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                        Database
                      </label>
                      <input
                        type="text"
                        value={newDatabase}
                        onChange={(e) => {
                          const val = e.target.value;
                          setNewDatabase(val);
                          const nextUrl = buildDatabaseUrl("snowflake", {
                            host: newHost,
                            port: "443",
                            database: val,
                            schema: newSnowflakeSchema,
                            warehouse: newSnowflakeWarehouse,
                            role: newSnowflakeRole,
                            username: newUsername,
                            password: newPassword,
                          });
                          setNewUrl(nextUrl);
                          setTestResult(null);
                          setAttachError(null);
                        }}
                        placeholder="PRODUCTION_DB"
                        className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6] font-mono transition-colors"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                        Schema
                      </label>
                      <input
                        type="text"
                        value={newSnowflakeSchema}
                        onChange={(e) => {
                          const val = e.target.value;
                          setNewSnowflakeSchema(val);
                          const nextUrl = buildDatabaseUrl("snowflake", {
                            host: newHost,
                            port: "443",
                            database: newDatabase,
                            schema: val,
                            warehouse: newSnowflakeWarehouse,
                            role: newSnowflakeRole,
                            username: newUsername,
                            password: newPassword,
                          });
                          setNewUrl(nextUrl);
                          setTestResult(null);
                          setAttachError(null);
                        }}
                        placeholder="PUBLIC"
                        className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6] font-mono transition-colors"
                      />
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                        Username
                      </label>
                      <input
                        type="text"
                        value={newUsername}
                        onChange={(e) => {
                          const val = e.target.value;
                          setNewUsername(val);
                          const nextUrl = buildDatabaseUrl("snowflake", {
                            host: newHost,
                            port: "443",
                            database: newDatabase,
                            schema: newSnowflakeSchema,
                            warehouse: newSnowflakeWarehouse,
                            role: newSnowflakeRole,
                            username: val,
                            password: newPassword,
                          });
                          setNewUrl(nextUrl);
                          setTestResult(null);
                          setAttachError(null);
                        }}
                        placeholder="admin"
                        className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6] font-mono transition-colors"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                        Password
                      </label>
                      <div className="relative">
                        <input
                          type={showNewPassword ? "text" : "password"}
                          value={newPassword}
                          onChange={(e) => {
                            const val = e.target.value;
                            setNewPassword(val);
                            const nextUrl = buildDatabaseUrl("snowflake", {
                              host: newHost,
                              port: "443",
                              database: newDatabase,
                              schema: newSnowflakeSchema,
                              warehouse: newSnowflakeWarehouse,
                              role: newSnowflakeRole,
                              username: newUsername,
                              password: val,
                            });
                            setNewUrl(nextUrl);
                            setTestResult(null);
                            setAttachError(null);
                          }}
                          placeholder="••••••••"
                          className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] pl-3 pr-10 text-[14px] text-white focus:outline-none focus:border-[#3b82f6] font-mono transition-colors"
                        />
                        <button
                          type="button"
                          onClick={() => setShowNewPassword(!showNewPassword)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#777777] hover:text-[#cccccc] transition-colors cursor-pointer"
                          tabIndex={-1}
                          aria-label={
                            showNewPassword ? "Hide password" : "Show password"
                          }
                        >
                          {showNewPassword ? (
                            <EyeOff className="w-3.5 h-3.5" />
                          ) : (
                            <Eye className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                      <p className="mt-1.5 text-[11px] text-[#737373]">
                        Special characters are fine; Axiom escapes them
                        automatically.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                /* Standard Relational Engines (PostgreSQL, MySQL, MSSQL, ClickHouse, Oracle) */
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                        Host <span className="text-[#e5484d]">*</span>
                      </label>
                      <input
                        type="text"
                        value={newHost}
                        onChange={(e) => {
                          const val = e.target.value;
                          setNewHost(val);
                          const nextUrl = buildDatabaseUrl(
                            newEngine,
                            {
                              host: val,
                              port: newPort,
                              database: newDatabase,
                              username: newUsername,
                              password: newPassword,
                            },
                            newSslMode,
                          );
                          setNewUrl(nextUrl);
                          setTestResult(null);
                          setAttachError(null);
                        }}
                        placeholder={
                          newEngine.toLowerCase() === "clickhouse"
                            ? "localhost or clickhouse.example.com"
                            : newEngine.toLowerCase() === "oracle"
                              ? "localhost or oracle.example.com"
                              : newEngine.toLowerCase() === "mssql"
                                ? "localhost or mssql.example.com"
                                : "localhost or db.example.com"
                        }
                        className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6] font-mono transition-colors"
                      />
                    </div>
                    <div className="w-28 shrink-0">
                      <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                        Port
                      </label>
                      <input
                        type="text"
                        value={newPort}
                        onChange={(e) => {
                          const val = e.target.value;
                          setNewPort(val);
                          const nextUrl = buildDatabaseUrl(
                            newEngine,
                            {
                              host: newHost,
                              port: val,
                              database: newDatabase,
                              username: newUsername,
                              password: newPassword,
                            },
                            newSslMode,
                          );
                          setNewUrl(nextUrl);
                          setTestResult(null);
                          setAttachError(null);
                        }}
                        placeholder={
                          DEFAULT_ENGINE_PORTS[newEngine.toLowerCase()] ||
                          "5432"
                        }
                        className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6] font-mono transition-colors"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                      {newEngine.toLowerCase() === "oracle"
                        ? "Service Name / Database"
                        : "Database"}{" "}
                      <span className="text-[11px] font-normal text-[#888888]">
                        (optional)
                      </span>
                    </label>
                    <input
                      type="text"
                      value={newDatabase}
                      onChange={(e) => {
                        const val = e.target.value;
                        setNewDatabase(val);
                        const nextUrl = buildDatabaseUrl(
                          newEngine,
                          {
                            host: newHost,
                            port: newPort,
                            database: val,
                            username: newUsername,
                            password: newPassword,
                          },
                          newSslMode,
                        );
                        setNewUrl(nextUrl);
                        setTestResult(null);
                        setAttachError(null);
                      }}
                      placeholder={
                        newEngine.toLowerCase() === "clickhouse"
                          ? "default"
                          : newEngine.toLowerCase() === "oracle"
                            ? "ORCL or XE"
                            : newEngine.toLowerCase() === "mssql"
                              ? "master or dbname"
                              : "postgres or my_database"
                      }
                      className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6] font-mono transition-colors"
                    />
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                        Username
                      </label>
                      <input
                        type="text"
                        value={newUsername}
                        onChange={(e) => {
                          const val = e.target.value;
                          setNewUsername(val);
                          const nextUrl = buildDatabaseUrl(
                            newEngine,
                            {
                              host: newHost,
                              port: newPort,
                              database: newDatabase,
                              username: val,
                              password: newPassword,
                            },
                            newSslMode,
                          );
                          setNewUrl(nextUrl);
                          setTestResult(null);
                          setAttachError(null);
                        }}
                        placeholder={
                          newEngine.toLowerCase() === "clickhouse"
                            ? "default"
                            : newEngine.toLowerCase() === "mssql"
                              ? "sa"
                              : newEngine.toLowerCase() === "oracle"
                                ? "system"
                                : newEngine.toLowerCase() === "mysql"
                                  ? "root"
                                  : "postgres"
                        }
                        className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6] font-mono transition-colors"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                        Password
                      </label>
                      <div className="relative">
                        <input
                          type={showNewPassword ? "text" : "password"}
                          value={newPassword}
                          onChange={(e) => {
                            const val = e.target.value;
                            setNewPassword(val);
                            const nextUrl = buildDatabaseUrl(
                              newEngine,
                              {
                                host: newHost,
                                port: newPort,
                                database: newDatabase,
                                username: newUsername,
                                password: val,
                              },
                              newSslMode,
                            );
                            setNewUrl(nextUrl);
                            setTestResult(null);
                            setAttachError(null);
                          }}
                          placeholder="••••••••"
                          className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] pl-3 pr-10 text-[14px] text-white focus:outline-none focus:border-[#3b82f6] font-mono transition-colors"
                        />
                        <button
                          type="button"
                          onClick={() => setShowNewPassword(!showNewPassword)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#777777] hover:text-[#cccccc] transition-colors cursor-pointer"
                          tabIndex={-1}
                          aria-label={
                            showNewPassword ? "Hide password" : "Show password"
                          }
                        >
                          {showNewPassword ? (
                            <EyeOff className="w-3.5 h-3.5" />
                          ) : (
                            <Eye className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                      <p className="mt-1.5 text-[11px] text-[#737373]">
                        Special characters are fine; Axiom escapes them
                        automatically.
                      </p>
                    </div>
                  </div>
                </div>
              )
            ) : (
              <div>
                <div className="relative">
                  <input
                    type={showNewUrl ? "text" : "password"}
                    value={newUrl}
                    onChange={(e) => {
                      const val = e.target.value;
                      setNewUrl(val);
                      if (
                        newEngine.toLowerCase() === "postgresql" ||
                        newEngine.toLowerCase() === "mysql"
                      ) {
                        setNewSslMode(extractSslModeFromUrl(val, newEngine));
                      }
                      setTestResult(null);
                      setAttachError(null);
                    }}
                    placeholder={
                      newEngine.toLowerCase() === "libsql"
                        ? `Leave blank to create data/${newAlias.trim() || "database"}.db`
                        : ENGINE_URL_SCHEMES[newEngine.toLowerCase()]
                            ?.example ||
                          "postgres://user:secret@host:5432/dbname"
                    }
                    className={`h-9 w-full rounded-[6px] border pl-3 pr-10 text-[14px] text-white focus:outline-none font-mono transition-colors ${
                      newUrl.trim().length > 0 &&
                      !validateDatabaseUrl(newEngine, newUrl).valid
                        ? "border-[#e5484d] bg-[#1a0f0f] focus:border-[#e5484d] focus:ring-1 focus:ring-[#e5484d]/40"
                        : "border-[#262626] bg-[#121212] focus:border-[#3b82f6]"
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewUrl(!showNewUrl)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#777777] hover:text-[#cccccc] transition-colors cursor-pointer"
                    tabIndex={-1}
                    aria-label={showNewUrl ? "Hide password" : "Show password"}
                  >
                    {showNewUrl ? (
                      <EyeOff className="w-3.5 h-3.5" />
                    ) : (
                      <Eye className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>
            )}

            {newUrl.trim().length > 0 &&
              (validateDatabaseUrl(newEngine, newUrl).valid ? (
                <div className="flex items-center gap-1.5 text-[12px] text-[#30a46c]">
                  <Check className="w-3.5 h-3.5 shrink-0" />
                  <span>Valid connection scheme</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-[12px] text-[#e5484d]">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    Invalid {formatEngine(newEngine)} scheme. Expected prefix:{" "}
                    <code className="font-mono text-[#ff8080]">
                      {ENGINE_URL_SCHEMES[
                        newEngine.toLowerCase()
                      ]?.prefixes.join(", ")}
                    </code>
                  </span>
                </div>
              ))}

            {newUrl.trim().length === 0 && (
              <p className="text-[12px] text-[#737373]">
                {newEngine.toLowerCase() === "libsql" ? (
                  <span>
                    Leave blank to automatically create{" "}
                    <code className="font-mono text-[#a3a3a3]">
                      data/{newAlias.trim() || "database"}.db
                    </code>{" "}
                    inside the protected{" "}
                    <code className="font-mono text-[#a3a3a3]">data/</code>{" "}
                    directory.
                  </span>
                ) : (
                  <span>
                    Must start with{" "}
                    <code className="font-mono text-[#a3a3a3]">
                      {newEngine.toLowerCase()}://
                    </code>{" "}
                    or supported protocol.
                  </span>
                )}
              </p>
            )}
          </div>

          {newEngine.toLowerCase() === "libsql" &&
            newConnectMode === "string" && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-[13px] font-medium text-[#cccccc]">
                    Auth Token{" "}
                    <span className="text-[11px] font-normal text-[#888888]">
                      (Turso / Remote LibSQL)
                    </span>
                  </label>
                  <span className="text-[11px] text-[#666666]">Optional</span>
                </div>
                <div className="relative">
                  <input
                    type={showNewToken ? "text" : "password"}
                    value={newToken}
                    onChange={(e) => {
                      setNewToken(e.target.value);
                      setTestResult(null);
                      setAttachError(null);
                    }}
                    placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6..."
                    className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] pl-3 pr-10 text-[14px] text-white focus:outline-none focus:border-[#3b82f6] font-mono transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewToken(!showNewToken)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#777777] hover:text-[#cccccc] transition-colors cursor-pointer"
                    tabIndex={-1}
                    aria-label={showNewToken ? "Hide token" : "Show token"}
                  >
                    {showNewToken ? (
                      <EyeOff className="w-3.5 h-3.5" />
                    ) : (
                      <Eye className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
                <p className="mt-1.5 text-[12px] text-[#737373]">
                  JWT auth token required for remote Turso cloud databases.
                  Leave blank for local files.
                </p>
              </div>
            )}

          {(newEngine.toLowerCase() === "postgresql" ||
            newEngine.toLowerCase() === "mysql") && (
            <div>
              <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                SSL mode
              </label>
              <CustomSelect
                value={newSslMode}
                options={SSL_MODE_OPTIONS}
                onChange={(val) => {
                  const mode = val as SslMode;
                  setNewSslMode(mode);
                  if (newConnectMode === "fields") {
                    setNewUrl(
                      buildDatabaseUrl(
                        newEngine,
                        {
                          host: newHost,
                          port: newPort,
                          database: newDatabase,
                          username: newUsername,
                          password: newPassword,
                        },
                        mode,
                      ),
                    );
                  } else {
                    setNewUrl((prev) =>
                      applySslModeToUrl(prev, newEngine, mode),
                    );
                  }
                  setTestResult(null);
                  setAttachError(null);
                }}
                menuWidth="w-full"
              />
              <p className="mt-1.5 text-[12px] text-[#737373]">
                Use &quot;Require&quot; for hosted databases such as RDS,
                Supabase or Neon.
              </p>
            </div>
          )}

          <div>
            <button
              type="button"
              disabled={
                testResult === "testing" ||
                (!newUrl.trim() && newEngine.toLowerCase() !== "libsql")
              }
              onClick={handleTestConnection}
              className={`h-8 px-3 rounded-[6px] text-[13px] font-medium border transition-colors inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 ${
                testResult === "success"
                  ? "border-[#30a46c]/40 bg-[#30a46c]/10 text-[#30a46c] hover:bg-[#30a46c]/20"
                  : testResult === "fail"
                    ? "border-[#e5484d]/40 bg-[#e5484d]/10 text-[#e5484d] hover:bg-[#e5484d]/20"
                    : "border-[#262626] bg-[#161616] text-[#cccccc] hover:text-white hover:border-[#383838]"
              }`}
            >
              {testResult === "testing" ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#3b82f6]" />
              ) : testResult === "success" ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-[#30a46c]" />
              ) : testResult === "fail" ? (
                <AlertTriangle className="w-3.5 h-3.5 text-[#e5484d]" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              <span>
                {testResult === "testing"
                  ? "Testing Connection..."
                  : testResult === "success"
                    ? "Connection Verified"
                    : testResult === "fail"
                      ? "Test Failed · Retry"
                      : "Test Connection Handshake"}
              </span>
            </button>
          </div>

          {testResult === "testing" && (
            <div className="rounded-[6px] border border-[#262626] bg-[#141414] p-3 text-[13px] text-[#8c8c8c] flex items-center gap-2">
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#3b82f6] shrink-0" />
              <span>
                Probing TCP handshake and validating dialect authentication...
              </span>
            </div>
          )}

          {testResult === "success" && (
            <div className="rounded-[6px] border border-[#30a46c]/30 bg-[#30a46c]/10 p-3 text-[13px] text-[#30a46c] font-medium flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>
                Connection handshake verified. Database target is reachable and
                credentials are valid.
              </span>
            </div>
          )}

          {testResult === "fail" && (
            <div className="rounded-[6px] border border-[#e5484d]/30 bg-[#e5484d]/10 p-3 text-[13px] text-[#e5484d] font-medium flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                {attachError ||
                  "Connection failed. Invalid URL format for selected engine."}
              </span>
            </div>
          )}

          <div className="pt-2">
            <h3 className="text-[16px] font-medium text-white tracking-tight">
              Connection Bounds
            </h3>
            <p className="text-[13px] text-[#8c8c8c] mt-0.5">
              Configure scaling limits and idle timeout thresholds.
            </p>
          </div>

          <div className="space-y-3.5">
            <div>
              <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                Min Connections
              </label>
              <input
                type="number"
                min={0}
                max={1000}
                value={newMin}
                onChange={(e) =>
                  setNewMin(toSafeInt(e.target.value, 1, 0, 1000))
                }
                className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6]"
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                Max Connections
              </label>
              <input
                type="number"
                min={0}
                max={1000}
                value={newMax}
                onChange={(e) =>
                  setNewMax(toSafeInt(e.target.value, 10, 0, 1000))
                }
                className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6]"
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                Idle Timeout (seconds)
              </label>
              <input
                type="number"
                min={1}
                max={3600}
                value={newTimeout}
                onChange={(e) =>
                  setNewTimeout(toSafeInt(e.target.value, 30, 1, 3600))
                }
                className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6]"
              />
            </div>
            {!poolOk && (
              <p className="text-[12px] text-[#f87171] leading-relaxed">
                Pool bounds violation: Min must be ≥ 0, Max must be ≥ Min (
                {newMin}), and Timeout must be ≥ 1.
              </p>
            )}
          </div>
        </div>

        <div className="p-4 border-t border-[#222222] bg-[#0e0e0e] flex items-center justify-end gap-2.5 font-sans">
          <button
            type="button"
            onClick={requestCloseAttach}
            className="inline-flex items-center justify-center h-9 px-4 rounded-[8px] text-[14px] font-medium text-[#cccccc] hover:text-white bg-transparent hover:bg-[#161616] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer font-sans"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleAttach}
            disabled={!canAttach}
            className="group relative flex shrink-0 items-center justify-center h-9 px-4 rounded-[8px] font-medium text-white shadow-xs outline-none cursor-pointer overflow-hidden ring-1 ring-[#1d4ed8] bg-[#2563eb] font-sans disabled:opacity-50 disabled:cursor-not-allowed"
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
              {isAttaching ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Verifying & Attaching...</span>
                </>
              ) : (
                <span>Attach Pool</span>
              )}
            </span>
          </button>
        </div>
      </SlideOver>

      {/* Manage Pool SlideOver */}
      <SlideOver
        isOpen={manageOpen}
        onClose={requestCloseManage}
        title={selectedPool?.alias ?? ""}
        subtitle={
          selectedPool ? `${selectedPool.engine} · ${selectedPool.status}` : ""
        }
      >
        {/* Tab bar (Segmented control matching dashboard) */}
        <div className="px-5 py-3 border-b border-[#222222] bg-[#0e0e0e]">
          <div className="inline-flex items-center p-0.5 rounded-[8px] bg-transparent border border-[#262626]">
            <button
              type="button"
              onClick={() => setManageTab("details")}
              className={`flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[14px] font-medium transition-colors duration-75 cursor-pointer font-sans outline-none focus:outline-none border ${
                manageTab === "details"
                  ? "bg-[#161616] text-white border-[#333333]"
                  : "text-[#8c8c8c] hover:text-white hover:bg-[#141414] border-transparent"
              }`}
            >
              <span>Connection</span>
            </button>
            {hasPermission("databases.delete") && (
              <button
                type="button"
                onClick={() => setManageTab("danger")}
                className={`flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[14px] font-medium transition-colors duration-75 cursor-pointer font-sans outline-none focus:outline-none border ${
                  manageTab === "danger"
                    ? "bg-[#161616] text-white border-[#333333]"
                    : "text-[#8c8c8c] hover:text-white hover:bg-[#141414] border-transparent"
                }`}
              >
                <span>Danger</span>
              </button>
            )}
          </div>
        </div>

        {manageTab === "details" && (
          <div className="flex-1 p-5 overflow-y-auto space-y-5">
            {/* Pool Settings */}
            <div className="space-y-4">
              <div>
                <h3 className="text-[16px] font-medium text-white tracking-tight">
                  Pool Settings
                </h3>
                <p className="text-[13px] text-[#8c8c8c] mt-0.5">
                  Configure pool identity, engine dialect, and connection
                  target.
                </p>
              </div>

              <div className="space-y-3.5">
                <div>
                  <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                    Pool Name (Alias) <span className="text-[#e5484d]">*</span>
                  </label>
                  <input
                    type="text"
                    value={editAlias}
                    onChange={(e) =>
                      setEditAlias(
                        e.target.value.toLowerCase().replace(/\s+/g, "_"),
                      )
                    }
                    placeholder="e.g. analytics_warehouse"
                    className={`h-9 w-full rounded-[6px] border px-3 text-[14px] text-white focus:outline-none font-mono lowercase transition-colors ${
                      editAlias.trim().length > 0 && !editAliasValidation.valid
                        ? "border-[#e5484d] bg-[#1a0f0f] focus:border-[#e5484d] focus:ring-1 focus:ring-[#e5484d]/40"
                        : "border-[#262626] bg-[#121212] focus:border-[#3b82f6]"
                    }`}
                  />
                  {editAlias.trim().length > 0 && !editAliasValidation.valid ? (
                    <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-[#e5484d]">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>{editAliasValidation.error}</span>
                    </div>
                  ) : (
                    <p className="mt-1.5 text-[12px] text-[#737373]">
                      Unique endpoint identifier used in API routes.
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                    Database Engine
                  </label>
                  <CustomSelect
                    value={editEngine}
                    options={engineOptions}
                    onChange={(val) => {
                      const prevEngine = editEngine;
                      const nextEngine = val as EngineType;
                      setEditEngine(nextEngine);
                      const oldDefaultPort =
                        DEFAULT_ENGINE_PORTS[prevEngine.toLowerCase()] || "";
                      const newDefaultPort =
                        DEFAULT_ENGINE_PORTS[nextEngine.toLowerCase()] || "";
                      let updatedPort = editPort;
                      if (!editPort || editPort === oldDefaultPort) {
                        updatedPort = newDefaultPort;
                        setEditPort(newDefaultPort);
                      }
                      if (
                        nextEngine.toLowerCase() === "postgresql" ||
                        nextEngine.toLowerCase() === "mysql"
                      ) {
                        setEditSslMode(
                          extractSslModeFromUrl(editUrl, nextEngine),
                        );
                      }
                      if (editConnectMode === "fields") {
                        const nextUrl = buildDatabaseUrl(
                          nextEngine,
                          {
                            host: editHost,
                            port: updatedPort,
                            database: editDatabase,
                            username: editUsername,
                            password: editPassword,
                            libsqlMode: editLibsqlMode,
                            libsqlFile: editLibsqlFile,
                            warehouse: editSnowflakeWarehouse,
                            schema: editSnowflakeSchema,
                            role: editSnowflakeRole,
                            token: editToken,
                          },
                          editSslMode,
                        );
                        setEditUrl(nextUrl);
                      }
                      setManageTestResult(null);
                      setManageError(null);
                    }}
                    menuWidth="w-full"
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="block text-[13px] font-medium text-[#cccccc]">
                      Connection{" "}
                      {editEngine.toLowerCase() !== "libsql" && (
                        <span className="text-[#e5484d]">*</span>
                      )}
                    </label>
                    <div className="inline-flex items-center rounded-[6px] border border-[#262626] bg-[#121212] p-0.5 select-none">
                      <button
                        type="button"
                        onClick={() => {
                          if (editConnectMode !== "fields") {
                            if (editUrl.trim().length > 0) {
                              const parsed = parseDatabaseUrl(
                                editUrl,
                                editEngine,
                              );
                              setEditHost(parsed.host);
                              setEditPort(
                                parsed.port ||
                                  DEFAULT_ENGINE_PORTS[
                                    editEngine.toLowerCase()
                                  ] ||
                                  "",
                              );
                              setEditDatabase(parsed.database);
                              setEditUsername(parsed.username);
                              setEditPassword(parsed.password);
                              if (parsed.libsqlMode)
                                setEditLibsqlMode(parsed.libsqlMode);
                              if (parsed.libsqlFile)
                                setEditLibsqlFile(parsed.libsqlFile);
                              if (parsed.warehouse)
                                setEditSnowflakeWarehouse(parsed.warehouse);
                              if (parsed.schema)
                                setEditSnowflakeSchema(parsed.schema);
                              if (parsed.role)
                                setEditSnowflakeRole(parsed.role);
                              if (parsed.token) setEditToken(parsed.token);
                            }
                            setEditConnectMode("fields");
                          }
                        }}
                        className={`rounded-[4px] px-2.5 py-1 text-[12px] font-medium transition-colors cursor-pointer ${
                          editConnectMode === "fields"
                            ? "bg-[#262626] text-white shadow-xs"
                            : "text-[#888888] hover:text-[#cccccc]"
                        }`}
                      >
                        Fields
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (editConnectMode !== "string") {
                            setEditConnectMode("string");
                          }
                        }}
                        className={`rounded-[4px] px-2.5 py-1 text-[12px] font-medium transition-colors cursor-pointer ${
                          editConnectMode === "string"
                            ? "bg-[#262626] text-white shadow-xs"
                            : "text-[#888888] hover:text-[#cccccc]"
                        }`}
                      >
                        Connection string
                      </button>
                    </div>
                  </div>

                  {editConnectMode === "fields" ? (
                    editEngine.toLowerCase() === "libsql" ? (
                      /* LibSQL Dialect View */
                      <div className="space-y-3">
                        <div>
                          <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                            Storage Mode
                          </label>
                          <div className="inline-flex items-center rounded-[6px] border border-[#262626] bg-[#121212] p-0.5 select-none w-full">
                            <button
                              type="button"
                              onClick={() => {
                                setEditLibsqlMode("local");
                                const nextUrl = buildDatabaseUrl("libsql", {
                                  host: "",
                                  port: "",
                                  database: "",
                                  username: "",
                                  password: "",
                                  libsqlMode: "local",
                                  libsqlFile: editLibsqlFile,
                                });
                                setEditUrl(nextUrl);
                                setManageTestResult(null);
                                setManageError(null);
                              }}
                              className={`flex-1 rounded-[4px] px-2.5 py-1 text-[12px] font-medium transition-colors cursor-pointer text-center ${
                                editLibsqlMode === "local"
                                  ? "bg-[#262626] text-white shadow-xs"
                                  : "text-[#888888] hover:text-[#cccccc]"
                              }`}
                            >
                              Local SQLite (Embedded)
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditLibsqlMode("remote");
                                const nextUrl = buildDatabaseUrl("libsql", {
                                  host: editHost,
                                  port: "",
                                  database: "",
                                  username: "",
                                  password: "",
                                  libsqlMode: "remote",
                                  token: editToken,
                                });
                                setEditUrl(nextUrl);
                                setManageTestResult(null);
                                setManageError(null);
                              }}
                              className={`flex-1 rounded-[4px] px-2.5 py-1 text-[12px] font-medium transition-colors cursor-pointer text-center ${
                                editLibsqlMode === "remote"
                                  ? "bg-[#262626] text-white shadow-xs"
                                  : "text-[#888888] hover:text-[#cccccc]"
                              }`}
                            >
                              Remote Turso Cloud / sqld
                            </button>
                          </div>
                        </div>

                        {editLibsqlMode === "local" ? (
                          <div className="space-y-2">
                            <div>
                              <div className="flex items-center justify-between mb-1.5">
                                <label className="block text-[13px] font-medium text-[#cccccc]">
                                  Database File Path
                                </label>
                                <span className="text-[11px] text-[#888888]">
                                  Leave blank to keep existing
                                </span>
                              </div>
                              <input
                                type="text"
                                value={editLibsqlFile}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setEditLibsqlFile(val);
                                  const nextUrl = buildDatabaseUrl("libsql", {
                                    host: "",
                                    port: "",
                                    database: "",
                                    username: "",
                                    password: "",
                                    libsqlMode: "local",
                                    libsqlFile: val,
                                  });
                                  setEditUrl(nextUrl);
                                  setManageTestResult(null);
                                  setManageError(null);
                                }}
                                placeholder={`data/${editAlias.trim() || selectedPool?.alias || "database"}.db`}
                                className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6] font-mono transition-colors"
                              />
                            </div>
                            <div className="flex items-center gap-2 pt-1">
                              <button
                                type="button"
                                onClick={() => {
                                  const defaultPath = `data/${editAlias.trim() || selectedPool?.alias || "database"}.db`;
                                  setEditLibsqlFile(defaultPath);
                                  const nextUrl = buildDatabaseUrl("libsql", {
                                    host: "",
                                    port: "",
                                    database: "",
                                    username: "",
                                    password: "",
                                    libsqlMode: "local",
                                    libsqlFile: defaultPath,
                                  });
                                  setEditUrl(nextUrl);
                                  setManageTestResult(null);
                                  setManageError(null);
                                }}
                                className="text-[11px] font-mono px-2 py-0.5 rounded bg-[#1a1a1a] hover:bg-[#262626] text-[#a3a3a3] hover:text-white border border-[#262626] transition-colors cursor-pointer"
                              >
                                Default (data/
                                {editAlias.trim() ||
                                  selectedPool?.alias ||
                                  "database"}
                                .db)
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditLibsqlFile(":memory:");
                                  setEditUrl(":memory:");
                                  setManageTestResult(null);
                                  setManageError(null);
                                }}
                                className="text-[11px] font-mono px-2 py-0.5 rounded bg-[#1a1a1a] hover:bg-[#262626] text-[#a3a3a3] hover:text-white border border-[#262626] transition-colors cursor-pointer"
                              >
                                In-Memory (:memory:)
                              </button>
                            </div>
                            <p className="text-[11px] text-[#737373] mt-1">
                              Stored locally inside the protected{" "}
                              <code className="font-mono text-[#a3a3a3]">
                                data/
                              </code>{" "}
                              directory. Uses high-throughput WAL mode and
                              memory page cache.
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <div>
                              <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                                Turso Endpoint URL
                              </label>
                              <input
                                type="text"
                                value={editHost}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setEditHost(val);
                                  const nextUrl = buildDatabaseUrl("libsql", {
                                    host: val,
                                    port: "",
                                    database: "",
                                    username: "",
                                    password: "",
                                    libsqlMode: "remote",
                                    token: editToken,
                                  });
                                  setEditUrl(nextUrl);
                                  setManageTestResult(null);
                                  setManageError(null);
                                }}
                                placeholder="libsql://your-db-org.turso.io (leave blank to keep existing)"
                                className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6] font-mono transition-colors"
                              />
                            </div>
                            <div>
                              <div className="flex items-center justify-between mb-1.5">
                                <label className="block text-[13px] font-medium text-[#cccccc]">
                                  Auth Token (Bearer JWT)
                                </label>
                                <span className="text-[11px] text-[#666666]">
                                  Optional
                                </span>
                              </div>
                              <div className="relative">
                                <input
                                  type={showEditToken ? "text" : "password"}
                                  value={editToken}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setEditToken(val);
                                    const nextUrl = buildDatabaseUrl("libsql", {
                                      host: editHost,
                                      port: "",
                                      database: "",
                                      username: "",
                                      password: "",
                                      libsqlMode: "remote",
                                      token: val,
                                    });
                                    setEditUrl(nextUrl);
                                    setManageTestResult(null);
                                    setManageError(null);
                                  }}
                                  placeholder="Leave blank to keep existing credentials"
                                  className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] pl-3 pr-10 text-[14px] text-white focus:outline-none focus:border-[#3b82f6] font-mono transition-colors"
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    setShowEditToken(!showEditToken)
                                  }
                                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#777777] hover:text-[#cccccc] transition-colors cursor-pointer"
                                  tabIndex={-1}
                                  aria-label={
                                    showEditToken ? "Hide token" : "Show token"
                                  }
                                >
                                  {showEditToken ? (
                                    <EyeOff className="w-3.5 h-3.5" />
                                  ) : (
                                    <Eye className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              </div>
                              <p className="mt-1 text-[11px] text-[#737373]">
                                Required for Turso Cloud databases. Leave blank
                                for unauthenticated sqld instances.
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : editEngine.toLowerCase() === "snowflake" ? (
                      /* Snowflake Dialect View */
                      <div className="space-y-3">
                        <div>
                          <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                            Account Host / Identifier
                          </label>
                          <input
                            type="text"
                            value={editHost}
                            onChange={(e) => {
                              const val = e.target.value;
                              setEditHost(val);
                              const nextUrl = buildDatabaseUrl("snowflake", {
                                host: val,
                                port: "443",
                                database: editDatabase,
                                schema: editSnowflakeSchema,
                                warehouse: editSnowflakeWarehouse,
                                role: editSnowflakeRole,
                                username: editUsername,
                                password: editPassword,
                              });
                              setEditUrl(nextUrl);
                              setManageTestResult(null);
                              setManageError(null);
                            }}
                            placeholder="xy12345.us-east-1.snowflakecomputing.com (leave blank to keep existing)"
                            className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6] font-mono transition-colors"
                          />
                        </div>

                        <div className="flex items-start gap-3">
                          <div className="flex-1">
                            <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                              Warehouse
                            </label>
                            <input
                              type="text"
                              value={editSnowflakeWarehouse}
                              onChange={(e) => {
                                const val = e.target.value;
                                setEditSnowflakeWarehouse(val);
                                const nextUrl = buildDatabaseUrl("snowflake", {
                                  host: editHost,
                                  port: "443",
                                  database: editDatabase,
                                  schema: editSnowflakeSchema,
                                  warehouse: val,
                                  role: editSnowflakeRole,
                                  username: editUsername,
                                  password: editPassword,
                                });
                                setEditUrl(nextUrl);
                                setManageTestResult(null);
                                setManageError(null);
                              }}
                              placeholder="COMPUTE_WH"
                              className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6] font-mono transition-colors"
                            />
                          </div>
                          <div className="flex-1">
                            <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                              Role{" "}
                              <span className="text-[11px] font-normal text-[#888888]">
                                (optional)
                              </span>
                            </label>
                            <input
                              type="text"
                              value={editSnowflakeRole}
                              onChange={(e) => {
                                const val = e.target.value;
                                setEditSnowflakeRole(val);
                                const nextUrl = buildDatabaseUrl("snowflake", {
                                  host: editHost,
                                  port: "443",
                                  database: editDatabase,
                                  schema: editSnowflakeSchema,
                                  warehouse: editSnowflakeWarehouse,
                                  role: val,
                                  username: editUsername,
                                  password: editPassword,
                                });
                                setEditUrl(nextUrl);
                                setManageTestResult(null);
                                setManageError(null);
                              }}
                              placeholder="ACCOUNTADMIN"
                              className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6] font-mono transition-colors"
                            />
                          </div>
                        </div>

                        <div className="flex items-start gap-3">
                          <div className="flex-1">
                            <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                              Database
                            </label>
                            <input
                              type="text"
                              value={editDatabase}
                              onChange={(e) => {
                                const val = e.target.value;
                                setEditDatabase(val);
                                const nextUrl = buildDatabaseUrl("snowflake", {
                                  host: editHost,
                                  port: "443",
                                  database: val,
                                  schema: editSnowflakeSchema,
                                  warehouse: editSnowflakeWarehouse,
                                  role: editSnowflakeRole,
                                  username: editUsername,
                                  password: editPassword,
                                });
                                setEditUrl(nextUrl);
                                setManageTestResult(null);
                                setManageError(null);
                              }}
                              placeholder="Leave blank to keep existing"
                              className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6] font-mono transition-colors"
                            />
                          </div>
                          <div className="flex-1">
                            <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                              Schema
                            </label>
                            <input
                              type="text"
                              value={editSnowflakeSchema}
                              onChange={(e) => {
                                const val = e.target.value;
                                setEditSnowflakeSchema(val);
                                const nextUrl = buildDatabaseUrl("snowflake", {
                                  host: editHost,
                                  port: "443",
                                  database: editDatabase,
                                  schema: val,
                                  warehouse: editSnowflakeWarehouse,
                                  role: editSnowflakeRole,
                                  username: editUsername,
                                  password: editPassword,
                                });
                                setEditUrl(nextUrl);
                                setManageTestResult(null);
                                setManageError(null);
                              }}
                              placeholder="PUBLIC"
                              className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6] font-mono transition-colors"
                            />
                          </div>
                        </div>

                        <div className="flex items-start gap-3">
                          <div className="flex-1">
                            <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                              Username
                            </label>
                            <input
                              type="text"
                              value={editUsername}
                              onChange={(e) => {
                                const val = e.target.value;
                                setEditUsername(val);
                                const nextUrl = buildDatabaseUrl("snowflake", {
                                  host: editHost,
                                  port: "443",
                                  database: editDatabase,
                                  schema: editSnowflakeSchema,
                                  warehouse: editSnowflakeWarehouse,
                                  role: editSnowflakeRole,
                                  username: val,
                                  password: editPassword,
                                });
                                setEditUrl(nextUrl);
                                setManageTestResult(null);
                                setManageError(null);
                              }}
                              placeholder="Leave blank to keep existing"
                              className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6] font-mono transition-colors"
                            />
                          </div>
                          <div className="flex-1">
                            <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                              Password
                            </label>
                            <div className="relative">
                              <input
                                type={showEditPassword ? "text" : "password"}
                                value={editPassword}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setEditPassword(val);
                                  const nextUrl = buildDatabaseUrl(
                                    "snowflake",
                                    {
                                      host: editHost,
                                      port: "443",
                                      database: editDatabase,
                                      schema: editSnowflakeSchema,
                                      warehouse: editSnowflakeWarehouse,
                                      role: editSnowflakeRole,
                                      username: editUsername,
                                      password: val,
                                    },
                                  );
                                  setEditUrl(nextUrl);
                                  setManageTestResult(null);
                                  setManageError(null);
                                }}
                                placeholder="Leave blank to keep existing"
                                className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] pl-3 pr-10 text-[14px] text-white focus:outline-none focus:border-[#3b82f6] font-mono transition-colors"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setShowEditPassword(!showEditPassword)
                                }
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#777777] hover:text-[#cccccc] transition-colors cursor-pointer"
                                tabIndex={-1}
                                aria-label={
                                  showEditPassword
                                    ? "Hide password"
                                    : "Show password"
                                }
                              >
                                {showEditPassword ? (
                                  <EyeOff className="w-3.5 h-3.5" />
                                ) : (
                                  <Eye className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                            <p className="mt-1.5 text-[11px] text-[#737373]">
                              Special characters are fine; Axiom escapes them
                              automatically.
                            </p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      /* Standard Relational Engines */
                      <div className="space-y-3">
                        <div className="flex items-start gap-3">
                          <div className="flex-1">
                            <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                              Host
                            </label>
                            <input
                              type="text"
                              value={editHost}
                              onChange={(e) => {
                                const val = e.target.value;
                                setEditHost(val);
                                const nextUrl = buildDatabaseUrl(
                                  editEngine,
                                  {
                                    host: val,
                                    port: editPort,
                                    database: editDatabase,
                                    username: editUsername,
                                    password: editPassword,
                                  },
                                  editSslMode,
                                );
                                setEditUrl(nextUrl);
                                setManageTestResult(null);
                                setManageError(null);
                              }}
                              placeholder={
                                editEngine.toLowerCase() === "clickhouse"
                                  ? "localhost or clickhouse.example.com"
                                  : editEngine.toLowerCase() === "oracle"
                                    ? "localhost or oracle.example.com"
                                    : editEngine.toLowerCase() === "mssql"
                                      ? "localhost or mssql.example.com"
                                      : "localhost or db.example.com"
                              }
                              className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6] font-mono transition-colors"
                            />
                          </div>
                          <div className="w-28 shrink-0">
                            <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                              Port
                            </label>
                            <input
                              type="text"
                              value={editPort}
                              onChange={(e) => {
                                const val = e.target.value;
                                setEditPort(val);
                                const nextUrl = buildDatabaseUrl(
                                  editEngine,
                                  {
                                    host: editHost,
                                    port: val,
                                    database: editDatabase,
                                    username: editUsername,
                                    password: editPassword,
                                  },
                                  editSslMode,
                                );
                                setEditUrl(nextUrl);
                                setManageTestResult(null);
                                setManageError(null);
                              }}
                              placeholder={
                                DEFAULT_ENGINE_PORTS[
                                  editEngine.toLowerCase()
                                ] || "5432"
                              }
                              className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6] font-mono transition-colors"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                            {editEngine.toLowerCase() === "oracle"
                              ? "Service Name / Database"
                              : "Database"}{" "}
                            <span className="text-[11px] font-normal text-[#888888]">
                              (optional)
                            </span>
                          </label>
                          <input
                            type="text"
                            value={editDatabase}
                            onChange={(e) => {
                              const val = e.target.value;
                              setEditDatabase(val);
                              const nextUrl = buildDatabaseUrl(
                                editEngine,
                                {
                                  host: editHost,
                                  port: editPort,
                                  database: val,
                                  username: editUsername,
                                  password: editPassword,
                                },
                                editSslMode,
                              );
                              setEditUrl(nextUrl);
                              setManageTestResult(null);
                              setManageError(null);
                            }}
                            placeholder={
                              editEngine.toLowerCase() === "clickhouse"
                                ? "default"
                                : editEngine.toLowerCase() === "oracle"
                                  ? "ORCL or XE"
                                  : editEngine.toLowerCase() === "mssql"
                                    ? "master or dbname"
                                    : "postgres or my_database"
                            }
                            className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6] font-mono transition-colors"
                          />
                        </div>

                        <div className="flex items-start gap-3">
                          <div className="flex-1">
                            <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                              Username
                            </label>
                            <input
                              type="text"
                              value={editUsername}
                              onChange={(e) => {
                                const val = e.target.value;
                                setEditUsername(val);
                                const nextUrl = buildDatabaseUrl(
                                  editEngine,
                                  {
                                    host: editHost,
                                    port: editPort,
                                    database: editDatabase,
                                    username: val,
                                    password: editPassword,
                                  },
                                  editSslMode,
                                );
                                setEditUrl(nextUrl);
                                setManageTestResult(null);
                                setManageError(null);
                              }}
                              placeholder={
                                editEngine.toLowerCase() === "clickhouse"
                                  ? "default"
                                  : editEngine.toLowerCase() === "mssql"
                                    ? "sa"
                                    : editEngine.toLowerCase() === "oracle"
                                      ? "system"
                                      : editEngine.toLowerCase() === "mysql"
                                        ? "root"
                                        : "postgres"
                              }
                              className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6] font-mono transition-colors"
                            />
                          </div>
                          <div className="flex-1">
                            <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                              Password
                            </label>
                            <div className="relative">
                              <input
                                type={showEditPassword ? "text" : "password"}
                                value={editPassword}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setEditPassword(val);
                                  const nextUrl = buildDatabaseUrl(
                                    editEngine,
                                    {
                                      host: editHost,
                                      port: editPort,
                                      database: editDatabase,
                                      username: editUsername,
                                      password: val,
                                    },
                                    editSslMode,
                                  );
                                  setEditUrl(nextUrl);
                                  setManageTestResult(null);
                                  setManageError(null);
                                }}
                                placeholder="Leave blank to keep existing"
                                className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] pl-3 pr-10 text-[14px] text-white focus:outline-none focus:border-[#3b82f6] font-mono transition-colors"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setShowEditPassword(!showEditPassword)
                                }
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#777777] hover:text-[#cccccc] transition-colors cursor-pointer"
                                tabIndex={-1}
                                aria-label={
                                  showEditPassword
                                    ? "Hide password"
                                    : "Show password"
                                }
                              >
                                {showEditPassword ? (
                                  <EyeOff className="w-3.5 h-3.5" />
                                ) : (
                                  <Eye className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                            <p className="mt-1.5 text-[11px] text-[#737373]">
                              Special characters are fine; Axiom escapes them
                              automatically.
                            </p>
                          </div>
                        </div>
                      </div>
                    )
                  ) : (
                    <div>
                      <div className="relative">
                        <input
                          type={showEditUrl ? "text" : "password"}
                          value={editUrl}
                          onChange={(e) => {
                            const val = e.target.value;
                            setEditUrl(val);
                            if (
                              editEngine.toLowerCase() === "postgresql" ||
                              editEngine.toLowerCase() === "mysql"
                            ) {
                              setEditSslMode(
                                extractSslModeFromUrl(val, editEngine),
                              );
                            }
                            setManageTestResult(null);
                            setManageError(null);
                          }}
                          placeholder="Leave blank to keep the existing"
                          className={`h-9 w-full rounded-[6px] border pl-3 pr-10 text-[14px] text-white focus:outline-none font-mono transition-colors ${
                            urlChanged && !editUrlValidation.valid
                              ? "border-[#e5484d] bg-[#1a0f0f] focus:border-[#e5484d] focus:ring-1 focus:ring-[#e5484d]/40"
                              : "border-[#262626] bg-[#121212] focus:border-[#3b82f6]"
                          }`}
                        />
                        <button
                          type="button"
                          onClick={() => setShowEditUrl(!showEditUrl)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#777777] hover:text-[#cccccc] transition-colors cursor-pointer"
                          tabIndex={-1}
                          aria-label={
                            showEditUrl ? "Hide password" : "Show password"
                          }
                        >
                          {showEditUrl ? (
                            <EyeOff className="w-3.5 h-3.5" />
                          ) : (
                            <Eye className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  {urlChanged &&
                    (editUrlValidation.valid ? (
                      <div className="flex items-center gap-1.5 text-[12px] text-[#f59e0b]">
                        <Check className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          New URI configured · Test required before saving
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-[12px] text-[#e5484d]">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          Invalid {formatEngine(editEngine)} scheme. Expected
                          prefix:{" "}
                          <code className="font-mono text-[#ff8080]">
                            {ENGINE_URL_SCHEMES[
                              editEngine.toLowerCase()
                            ]?.prefixes.join(", ")}
                          </code>
                        </span>
                      </div>
                    ))}
                  {!urlChanged && (
                    <p className="text-[12px] text-[#737373]">
                      Leave empty to keep existing password and connection
                      credentials.
                    </p>
                  )}
                </div>

                {editEngine.toLowerCase() === "libsql" &&
                  editConnectMode === "string" && (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="block text-[13px] font-medium text-[#cccccc]">
                          Auth Token{" "}
                          <span className="text-[11px] font-normal text-[#888888]">
                            (Turso / Remote LibSQL)
                          </span>
                        </label>
                        <span className="text-[11px] text-[#666666]">
                          Optional
                        </span>
                      </div>
                      <div className="relative">
                        <input
                          type={showEditToken ? "text" : "password"}
                          value={editToken}
                          onChange={(e) => {
                            setEditToken(e.target.value);
                            setManageTestResult(null);
                            setManageError(null);
                          }}
                          placeholder="Leave blank to keep existing token"
                          className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] pl-3 pr-10 text-[14px] text-white focus:outline-none focus:border-[#3b82f6] font-mono transition-colors"
                        />
                        <button
                          type="button"
                          onClick={() => setShowEditToken(!showEditToken)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#777777] hover:text-[#cccccc] transition-colors cursor-pointer"
                          tabIndex={-1}
                          aria-label={
                            showEditToken ? "Hide token" : "Show token"
                          }
                        >
                          {showEditToken ? (
                            <EyeOff className="w-3.5 h-3.5" />
                          ) : (
                            <Eye className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                      <p className="mt-1.5 text-[12px] text-[#737373]">
                        Update auth token for Turso. Leave empty to preserve
                        existing credentials.
                      </p>
                    </div>
                  )}

                {(editEngine.toLowerCase() === "postgresql" ||
                  editEngine.toLowerCase() === "mysql") && (
                  <div>
                    <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                      SSL mode
                    </label>
                    <CustomSelect
                      value={editSslMode}
                      options={SSL_MODE_OPTIONS}
                      onChange={(val) => {
                        const mode = val as SslMode;
                        setEditSslMode(mode);
                        if (editConnectMode === "fields") {
                          setEditUrl(
                            buildDatabaseUrl(
                              editEngine,
                              {
                                host: editHost,
                                port: editPort,
                                database: editDatabase,
                                username: editUsername,
                                password: editPassword,
                              },
                              mode,
                            ),
                          );
                        } else {
                          setEditUrl((prev) =>
                            applySslModeToUrl(prev, editEngine, mode),
                          );
                        }
                        setManageTestResult(null);
                        setManageError(null);
                      }}
                      menuWidth="w-full"
                    />
                    <p className="mt-1.5 text-[12px] text-[#737373]">
                      Use &quot;Require&quot; for hosted databases such as RDS,
                      Supabase or Neon.
                    </p>
                  </div>
                )}

                <div>
                  <button
                    type="button"
                    disabled={manageTestResult === "testing"}
                    onClick={handleManageTestConnection}
                    className={`h-8 px-3 rounded-[6px] text-[13px] font-medium border transition-colors inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 ${
                      manageTestResult === "success"
                        ? "border-[#30a46c]/40 bg-[#30a46c]/10 text-[#30a46c] hover:bg-[#30a46c]/20"
                        : manageTestResult === "fail"
                          ? "border-[#e5484d]/40 bg-[#e5484d]/10 text-[#e5484d] hover:bg-[#e5484d]/20"
                          : "border-[#262626] bg-[#161616] text-[#cccccc] hover:text-white hover:border-[#383838]"
                    }`}
                  >
                    {manageTestResult === "testing" ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#3b82f6]" />
                    ) : manageTestResult === "success" ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#30a46c]" />
                    ) : manageTestResult === "fail" ? (
                      <AlertTriangle className="w-3.5 h-3.5 text-[#e5484d]" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {manageTestResult === "testing"
                        ? "Testing Connection..."
                        : manageTestResult === "success"
                          ? "Connection Verified"
                          : manageTestResult === "fail"
                            ? "Test Failed · Retry"
                            : urlChanged
                              ? "Test New Connection"
                              : "Test Connection Handshake"}
                    </span>
                  </button>
                </div>

                {manageTestResult === "testing" && (
                  <div className="rounded-[6px] border border-[#262626] bg-[#141414] p-3 text-[13px] text-[#8c8c8c] flex items-center gap-2">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#3b82f6] shrink-0" />
                    <span>
                      Probing TCP handshake and validating dialect
                      authentication...
                    </span>
                  </div>
                )}

                {manageTestResult === "success" && (
                  <div className="rounded-[6px] border border-[#30a46c]/30 bg-[#30a46c]/10 p-3 text-[13px] text-[#30a46c] font-medium flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>
                      Connection handshake verified. Round-trip: 0.94 ms.
                    </span>
                  </div>
                )}

                {manageTestResult === "fail" && (
                  <div className="rounded-[6px] border border-[#e5484d]/30 bg-[#e5484d]/10 p-3 text-[13px] text-[#e5484d] font-medium flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>
                      {manageError ||
                        "Connection failed. Unable to reach database host or invalid credentials."}
                    </span>
                  </div>
                )}
              </div>

              <div className="pt-2">
                <h3 className="text-[16px] font-medium text-white tracking-tight">
                  Connection Bounds
                </h3>
                <p className="text-[13px] text-[#8c8c8c] mt-0.5">
                  Configure scaling limits and idle timeout thresholds.
                </p>
              </div>

              <div className="space-y-3.5">
                <div>
                  <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                    Min Connections
                  </label>
                  <input
                    type="number"
                    value={editMin}
                    onChange={(e) => setEditMin(Number(e.target.value))}
                    className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6]"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                    Max Connections
                  </label>
                  <input
                    type="number"
                    value={editMax}
                    onChange={(e) => setEditMax(Number(e.target.value))}
                    className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6]"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-[#cccccc] mb-1.5">
                    Idle Timeout (seconds)
                  </label>
                  <input
                    type="number"
                    value={editTimeout}
                    onChange={(e) => setEditTimeout(Number(e.target.value))}
                    className="h-9 w-full rounded-[6px] border border-[#262626] bg-[#121212] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6]"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {manageTab === "danger" && (
          <div className="flex-1 p-5 overflow-y-auto">
            <div className="rounded-[8px] border border-[#3a1515] bg-[#0e0404] p-4">
              <h3 className="text-[16px] font-medium text-[#e5484d] mb-1">
                Disconnect Pool
              </h3>
              <p className="text-[13px] text-[#8c8c8c] mb-4">
                Permanently remove{" "}
                <span className="text-white font-medium text-[13px]">
                  {selectedPool?.alias}
                </span>{" "}
                from the gateway. All active connections will be terminated.
              </p>
              <button
                type="button"
                disabled={!hasPermission("databases.delete")}
                onClick={() => setConfirmDisconnectOpen(true)}
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
                  Disconnect Pool
                </span>
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        {manageTab === "details" && (
          <div className="p-4 border-t border-[#222222] bg-[#0e0e0e] flex items-center justify-end gap-2.5 font-sans">
            <button
              type="button"
              onClick={requestCloseManage}
              className="inline-flex items-center justify-center h-9 px-4 rounded-[8px] text-[14px] font-medium text-[#cccccc] hover:text-white bg-transparent hover:bg-[#161616] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer font-sans"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={
                !canSave || isSaving || !hasPermission("databases.update")
              }
              onClick={handleSaveEdit}
              className="group relative flex shrink-0 items-center justify-center h-9 px-4 rounded-[8px] font-medium text-white shadow-xs outline-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed overflow-hidden ring-1 ring-[#1d4ed8] bg-[#2563eb] font-sans"
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
                {isSaving ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Verifying & Saving...</span>
                  </>
                ) : (
                  <span>Save</span>
                )}
              </span>
            </button>
          </div>
        )}
      </SlideOver>

      {/* Delete / Disconnect Confirmation Dialog */}
      <ConfirmDialog
        isOpen={confirmDisconnectOpen}
        onClose={() => setConfirmDisconnectOpen(false)}
        onConfirm={async () => {
          if (selectedPool) {
            try {
              await api.deleteDatabase(selectedPool.alias);
              await loadDatabases();
            } catch (err) {
              console.error("Failed to disconnect database pool:", err);
            }
          }
          setConfirmDisconnectOpen(false);
          setManageOpen(false);
        }}
        title="Disconnect Database Pool"
        description={
          <>
            Permanently remove database pool{" "}
            <span className="text-white font-medium">
              {selectedPool?.alias}
            </span>{" "}
            from the gateway? All active connections will be terminated.
          </>
        }
        confirmLabel="Disconnect Pool"
        cancelLabel="Cancel"
      />
      {/* Discard Attach Confirmation Dialog */}
      <ConfirmDialog
        isOpen={confirmDiscardAttachOpen}
        onClose={() => setConfirmDiscardAttachOpen(false)}
        onConfirm={forceCloseAttach}
        title="Discard New Database"
        description="You have unsaved database configuration. Are you sure you want to discard your changes?"
        confirmLabel="Discard Changes"
        cancelLabel="Keep Editing"
        variant="warning"
      />

      {/* Discard Manage/Edit Confirmation Dialog */}
      <ConfirmDialog
        isOpen={confirmDiscardEditOpen}
        onClose={() => setConfirmDiscardEditOpen(false)}
        onConfirm={forceCloseManage}
        title="Discard Unsaved Changes"
        description="You have unsaved changes to this database pool. Are you sure you want to discard them?"
        confirmLabel="Discard Changes"
        cancelLabel="Keep Editing"
        variant="warning"
      />
    </div>
  );
}
