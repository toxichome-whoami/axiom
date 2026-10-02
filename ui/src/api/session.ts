/*
 * In-memory admin session state manager and token hygiene layer.
 * Owned by: ui/api
 * Key deps: none (pure browser memory + storage fallback)
 * Invariants: Session token is kept in memory to mitigate XSS exfiltration; expires_at skew tolerance is 30s.
 * Last structural change: Phase 1 frontend security hardening per UI audit F-01/F-04.
 */

// Ephemeral in-memory bearer token storage.
// Memory tokens prevent malicious extensions or XSS injection from exfiltrating live credentials via localStorage.
let memorySessionToken: string | null = null;

/**
 * Initializes or updates the active administrative session.
 * CONTRACT:
 *  - Stores token in volatile memory.
 *  - Persists operator metadata and expiration timestamp (epoch seconds) for UX state.
 *  - Side effects: Writes non-sensitive session metadata to sessionStorage / localStorage.
 *  - Idempotent: Yes.
 */
export function setSession(token: string, expiresAt?: number, username?: string): void {
  memorySessionToken = token;
  if (expiresAt && expiresAt > 0) {
    // Standardize to seconds (detecting if backend sent ms)
    const normalizedExp = expiresAt > 1e11 ? Math.floor(expiresAt / 1000) : expiresAt;
    localStorage.setItem('axiom_session_expires_at', String(normalizedExp));
  }
  if (username) {
    localStorage.setItem('axiom_operator_user', username);
  }
  localStorage.setItem('axiom_session_active', 'true');
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
  return memorySessionToken || localStorage.getItem('axiom_session_token');
}

/**
 * Returns the recorded administrative operator username.
 */
export function getOperatorUser(): string {
  return localStorage.getItem('axiom_operator_user') || 'admin';
}

/**
 * Checks whether the current session has exceeded its expiration deadline.
 * Tolerates up to 30 seconds of clock skew between client and gateway.
 */
export function isSessionExpired(): boolean {
  const expStr = localStorage.getItem('axiom_session_expires_at');
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
  return Boolean(memorySessionToken || localStorage.getItem('axiom_session_active'));
}

/**
 * Purges all in-memory and persistent session markers.
 * CONTRACT:
 *  - Resets volatile token and removes storage markers.
 *  - Idempotent: Yes.
 */
export function clearSession(): void {
  memorySessionToken = null;
  localStorage.removeItem('axiom_session_token');
  localStorage.removeItem('axiom_session_active');
  localStorage.removeItem('axiom_session_expires_at');
  localStorage.removeItem('axiom_operator_user');
}
