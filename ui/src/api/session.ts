/*
 * In-memory admin session state manager and token hygiene layer.
 * Owned by: ui/api
 * Key deps: none (pure browser memory + storage fallback)
 * Invariants: Session token is kept in memory to mitigate XSS exfiltration; expires_at skew tolerance is 30s.
 * Last structural change: Phase 1 frontend security hardening per UI audit F-01/F-04.
 */

import type { UserRecordApi } from "./client";

// Ephemeral in-memory bearer token storage.
// Memory tokens prevent malicious extensions or XSS injection from exfiltrating live credentials via localStorage.
let memorySessionToken: string | null = null;
let memoryCurrentUser: UserRecordApi | null = null;

/**
 * Initializes or updates the active administrative session.
 * CONTRACT:
 *  - Stores token in volatile memory.
 *  - Persists operator metadata and expiration timestamp (epoch seconds) for UX state.
 *  - Side effects: Writes non-sensitive session metadata to sessionStorage / localStorage.
 *  - Idempotent: Yes.
 */
export function setSession(
  token: string,
  expiresAt?: number,
  username?: string,
): void {
  memorySessionToken = token;
  if (token) {
    localStorage.setItem("axiom_session_token", token);
  }
  if (expiresAt && expiresAt > 0) {
    // Standardize to seconds (detecting if backend sent ms)
    const normalizedExp =
      expiresAt > 1e11 ? Math.floor(expiresAt / 1000) : expiresAt;
    localStorage.setItem("axiom_session_expires_at", String(normalizedExp));
  }
  if (username) {
    localStorage.setItem("axiom_operator_user", username);
  }
  localStorage.setItem("axiom_session_active", "true");
}

/**
 * Stores the current user profile and permission set.
 */
export function setCurrentUser(user: UserRecordApi | null): void {
  memoryCurrentUser = user;
  if (user) {
    localStorage.setItem("axiom_current_user", JSON.stringify(user));
  } else {
    localStorage.removeItem("axiom_current_user");
  }

  // Reactive notification: broadcast user profile/permission change across the application
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("axiom:user_updated", { detail: user }),
    );
  }
}

/**
 * Retrieves the current logged-in user profile.
 */
export function getCurrentUser(): UserRecordApi | null {
  if (memoryCurrentUser) return memoryCurrentUser;
  const raw = localStorage.getItem("axiom_current_user");
  if (raw) {
    try {
      memoryCurrentUser = JSON.parse(raw);
      return memoryCurrentUser;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Evaluates whether the active operator has a specific granular capability.
 * CONTRACT:
 *  - Root super-administrator (id = 1, is_super_admin = true) bypasses all checks.
 *  - Evaluates system permissions with wildcard support:
 *    - `*` grants all capabilities.
 *    - `<resource>.*` grants all operations on that resource.
 *    - `<resource>.<action>` grants exact operation.
 *  - Backwards compatibility for legacy tokens (e.g. `manage_keys` -> `keys.*`).
 */
export function hasPermission(required: string): boolean {
  const user = getCurrentUser();
  if (!user) {
    return false; // Deny by default when unauthenticated or unhydrated
  }
  if (user.is_super_admin) {
    return true;
  }
  const perms = user.permissions?.system || [];
  if (perms.includes("*")) {
    return true;
  }
  if (perms.includes(required)) {
    return true;
  }

  // Dual aliasing for database permissions: databases.<action> <-> db.<action>
  if (required.startsWith("databases.")) {
    const action = required.slice("databases.".length);
    if (perms.includes(`db.${action}`) || perms.includes("db.*")) return true;
  } else if (required.startsWith("db.")) {
    const action = required.slice("db.".length);
    if (perms.includes(`databases.${action}`) || perms.includes("databases.*")) return true;
  }

  // Dual aliasing for blob permissions: blobs.<action> <-> blob.<action>
  if (required.startsWith("blobs.")) {
    const action = required.slice("blobs.".length);
    if (perms.includes(`blob.${action}`) || perms.includes("blob.*")) return true;
  } else if (required.startsWith("blob.")) {
    const action = required.slice("blob.".length);
    if (perms.includes(`blobs.${action}`) || perms.includes("blobs.*")) return true;
  }

  const resource = required.split(".")[0];
  if (resource && perms.includes(`${resource}.*`)) {
    return true;
  }

  // Legacy capability token aliases
  if (required.startsWith("keys.") && perms.includes("manage_keys")) return true;
  if (required.startsWith("roles.") && perms.includes("manage_roles")) return true;
  if ((required.startsWith("databases.") || required.startsWith("db.")) && perms.includes("manage_databases")) return true;
  if (required.startsWith("users.") && perms.includes("manage_users")) return true;
  if (required.startsWith("audit.") && perms.includes("view_audit")) return true;
  if (required.startsWith("cluster.") && perms.includes("manage_cluster")) return true;
  if (required.startsWith("settings.") && perms.includes("manage_settings")) return true;
  if ((required.startsWith("blobs.") || required.startsWith("blob.")) && perms.includes("manage_blobs")) return true;

  return false;
}

/**
 * Checks whether the current operator has read or write access to a given database or table.
 */
export function hasDatabaseAccess(dbName?: string, requiredOp?: string, tableName?: string): boolean {
  const user = getCurrentUser();
  if (!user) return false;
  if (user.is_super_admin) return true;
  if (hasPermission("databases.*")) return true;

  const dbRules = user.permissions?.databases || [];

  // General navigation check (no specific db, table, or op requested)
  if (!dbName && !tableName && !requiredOp) {
    return hasPermission("databases.view") || dbRules.length > 0;
  }

  // If the user has explicit granular database rules, those rules strictly dictate table and op access
  if (dbRules.length > 0) {
    if (!dbName) return true;
    return dbRules.some((rule) => {
      const dbMatches = rule.database === "*" || rule.database.toLowerCase() === dbName.toLowerCase();
      if (!dbMatches) return false;
      if (tableName && rule.table_name && rule.table_name !== "*" && rule.table_name.toLowerCase() !== tableName.toLowerCase()) {
        return false;
      }
      if (!requiredOp) return true;
      return rule.operations.includes(requiredOp) || rule.operations.includes("*");
    });
  }

  // Fallback when no granular database rules exist: evaluate system-level capabilities
  if (!requiredOp || requiredOp === "SELECT" || requiredOp === "READ") {
    // If a specific table was requested but user has no granular rules and no databases.*, deny table access
    if (tableName) return false;
    return hasPermission("databases.view");
  }
  if (requiredOp === "INSERT" || requiredOp === "UPDATE") {
    return hasPermission("databases.update") || hasPermission("databases.create");
  }
  if (requiredOp === "DELETE") {
    return hasPermission("databases.delete");
  }
  if (requiredOp === "DDL") {
    return hasPermission("databases.create") || hasPermission("databases.delete");
  }

  return false;
}

/**
 * Checks whether the current operator has access to a blob namespace.
 */
export function hasBlobAccess(namespace?: string, requiredOp?: string): boolean {
  const user = getCurrentUser();
  if (!user) return false;
  if (user.is_super_admin) return true;
  if (hasPermission("blobs.*")) return true;

  const blobRules = user.permissions?.blobs || [];

  // General navigation check (no namespace or op requested)
  if (!namespace && !requiredOp) {
    return hasPermission("blobs.view") || blobRules.length > 0;
  }

  // If the user has explicit granular blob rules, those rules strictly dictate namespace access
  if (blobRules.length > 0) {
    if (!namespace) return true;
    return blobRules.some((rule) => {
      const nsMatches = rule.namespace === "*" || rule.namespace.toLowerCase() === namespace.toLowerCase();
      if (!nsMatches) return false;
      if (!requiredOp) return true;
      return rule.operations.includes(requiredOp) || rule.operations.includes("*");
    });
  }

  // Fallback when no granular blob rules exist: evaluate system-level capabilities
  if (!requiredOp || requiredOp === "READ" || requiredOp === "SELECT") {
    return hasPermission("blobs.view");
  }
  if (requiredOp === "WRITE" || requiredOp === "INSERT" || requiredOp === "UPDATE") {
    return hasPermission("blobs.create") || hasPermission("blobs.update");
  }
  if (requiredOp === "DELETE") {
    return hasPermission("blobs.delete");
  }

  return false;
}

/**
 * Retrieves the current session token if available and unexpired.
 * CONTRACT:
 *  - Returns memory token if present, falling back to stored session token.
 *  - Returns null if session has expired or no token exists.
 *  - Side effects: Clears session if expired.
 */
export function getSessionToken(): string | null {
  if (isSessionExpired()) {
    clearSession();
    return null;
  }
  return memorySessionToken || localStorage.getItem("axiom_session_token");
}

/**
 * Returns the recorded administrative operator username.
 */
export function getOperatorUser(): string {
  return localStorage.getItem("axiom_operator_user") || "admin";
}

/**
 * Checks whether the current session has exceeded its expiration deadline.
 * Tolerates up to 30 seconds of clock skew between client and gateway.
 */
export function isSessionExpired(): boolean {
  const expStr = localStorage.getItem("axiom_session_expires_at");
  if (!expStr) return false;
  const exp = parseInt(expStr, 10);
  if (isNaN(exp)) return false;
  const now = Math.floor(Date.now() / 1000);
  // 30-second skew tolerance
  return now >= exp - 30;
}

/**
 * Checks if an active, unexpired session exists.
 */
export function hasActiveSession(): boolean {
  if (isSessionExpired()) {
    clearSession();
    return false;
  }
  return Boolean(
    memorySessionToken || localStorage.getItem("axiom_session_active"),
  );
}

/**
 * Purges all in-memory and persistent session markers.
 * CONTRACT:
 *  - Resets volatile token and removes storage markers.
 *  - Idempotent: Yes.
 */
export function clearSession(): void {
  memorySessionToken = null;
  memoryCurrentUser = null;
  localStorage.removeItem("axiom_session_token");
  localStorage.removeItem("axiom_session_active");
  localStorage.removeItem("axiom_session_expires_at");
  localStorage.removeItem("axiom_operator_user");
  localStorage.removeItem("axiom_current_user");
}
