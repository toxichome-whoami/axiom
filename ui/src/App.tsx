import React, { useState, useEffect, Suspense, lazy } from "react";
import { Layout, NavPath } from "./components/Layout";
import { setSession, clearSession, hasActiveSession, setCurrentUser, hasPermission } from "./api/session";
import { api } from "./api/client";
import { GlobalAlertDialog } from "./components/ui/AlertDialog";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
const isRelease =
  import.meta.env.MODE === "release" || import.meta.env.VITE_RELEASE === "true";
const Agentation: React.ComponentType = !isRelease
  ? lazy(() => import("agentation").then((m) => ({ default: m.Agentation })))
  : () => null;

const Overview = lazy(() =>
  import("./pages/Overview").then((m) => ({ default: m.Overview })),
);
const Databases = lazy(() =>
  import("./pages/Databases").then((m) => ({ default: m.Databases })),
);
const TableEditor = lazy(() =>
  import("./pages/TableEditor").then((m) => ({ default: m.TableEditor })),
);
const Storage = lazy(() =>
  import("./pages/Storage").then((m) => ({ default: m.Storage })),
);
const Cluster = lazy(() =>
  import("./pages/Cluster").then((m) => ({ default: m.Cluster })),
);
const Users = lazy(() =>
  import("./pages/Users").then((m) => ({ default: m.Users })),
);
const Keys = lazy(() =>
  import("./pages/Keys").then((m) => ({ default: m.Keys })),
);
const Roles = lazy(() =>
  import("./pages/Roles").then((m) => ({ default: m.Roles })),
);
const AuditLog = lazy(() =>
  import("./pages/AuditLog").then((m) => ({ default: m.AuditLog })),
);
const Mcp = lazy(() => import("./pages/Mcp").then((m) => ({ default: m.Mcp })));
const Settings = lazy(() =>
  import("./pages/Settings").then((m) => ({ default: m.Settings })),
);
const AuthPage = lazy(() =>
  import("./pages/AuthPage").then((m) => ({ default: m.AuthPage })),
);
const ShareViewerPage = lazy(() =>
  import("./pages/storage/ShareViewerPage").then((m) => ({
    default: m.ShareViewerPage,
  })),
);

const ROUTE_PERMISSIONS: Partial<Record<NavPath, string>> = {
  "/system/databases": "databases.view",
  "/system/tables": "databases.view",
  "/system/storage": "blobs.view",
  "/system/cluster": "cluster.view",
  "/system/users": "users.view",
  "/system/keys": "keys.view",
  "/system/roles": "roles.view",
  "/system/audit": "audit.view",
  "/system/mcp": "settings.view",
  "/system/settings": "settings.view",
};

function AccessRestricted({
  required,
  onBack,
}: {
  required: string;
  onBack: () => void;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center min-h-[420px] p-6 text-center">
      <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4 text-red-400">
        <svg
          className="w-6 h-6"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
      </div>
      <h2 className="text-[17px] font-semibold text-white mb-2">
        Access Restricted
      </h2>
      <p className="text-[13px] text-[#8c8c8c] max-w-md mb-6 leading-relaxed">
        Your user account does not possess the required capability{" "}
        <span className="font-mono text-[#d4d4d4] bg-[#1a1a1a] px-1.5 py-0.5 rounded border border-[#2e2e2e]">
          {required}
        </span>{" "}
        to view this section. Contact your system administrator for access.
      </p>
      <button
        onClick={onBack}
        className="h-8 px-4 rounded-[6px] bg-[#1a1a1a] hover:bg-[#262626] text-white text-[13px] font-medium border border-[#333333] transition-colors cursor-pointer"
      >
        Return to Overview
      </button>
    </div>
  );
}

function PageFallback() {
  return (
    <div className="flex-1 flex items-center justify-center p-12 min-h-[300px]">
      <svg
        className="animate-spin h-6 w-6 text-[#2563eb]"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8v8H4z"
        />
      </svg>
    </div>
  );
}

export function App() {
  function normalizePath(path: string): NavPath {
    let p = path.replace(/\/$/, "");
    if (!p || p === "/") return "/system";

    // Convenience aliases
    if (p === "/settings") p = "/system/settings";
    if (p === "/databases") p = "/system/databases";
    if (p === "/tables" || p === "/editor" || p === "/table-editor")
      p = "/system/tables";
    if (p === "/storage" || p === "/blobs") p = "/system/storage";
    if (p === "/cluster" || p === "/mesh" || p === "/nodes")
      p = "/system/cluster";
    if (p === "/users" || p === "/admins" || p === "/administrators")
      p = "/system/users";
    if (p === "/keys") p = "/system/keys";
    if (p === "/roles") p = "/system/roles";
    if (p === "/audit" || p === "/logs" || p === "/audit-log")
      p = "/system/audit";
    if (p === "/mcp") p = "/system/mcp";

    const validPaths: NavPath[] = [
      "/system",
      "/system/databases",
      "/system/tables",
      "/system/storage",
      "/system/cluster",
      "/system/users",
      "/system/keys",
      "/system/roles",
      "/system/audit",
      "/system/mcp",
      "/system/settings",
    ];
    return validPaths.includes(p as NavPath) ? (p as NavPath) : "/system";
  }

  const [currentPath, setCurrentPath] = useState<NavPath>(() => {
    return normalizePath(window.location.pathname);
  });

  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    return hasActiveSession();
  });

  useEffect(() => {
    function handlePopState() {
      setCurrentPath(normalizePath(window.location.pathname));
    }
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  // Listen for unauthorized 401/403 events from client.ts to force logout
  useEffect(() => {
    function onUnauthorized() {
      handleLogout();
    }
    window.addEventListener("axiom:unauthorized", onUnauthorized);
    return () => {
      window.removeEventListener("axiom:unauthorized", onUnauthorized);
    };
  }, []);

  // Probe session and hydrate effective permissions on mount
  useEffect(() => {
    if (isAuthenticated) {
      api
        .getMe()
        .then((user) => {
          setCurrentUser(user);
        })
        .catch(() => {
          handleLogout();
        });
    }
  }, [isAuthenticated]);

  function handleNavigate(path: NavPath) {
    if (path !== currentPath || window.location.pathname !== path) {
      window.history.pushState(null, "", path);
      setCurrentPath(path);
      window.scrollTo(0, 0);
    }
  }

  function handleLoginSuccess(
    token: string,
    username: string,
    expiresAt?: number,
  ) {
    setSession(token, expiresAt, username);
    setIsAuthenticated(true);
    window.history.pushState(null, "", "/system");
    setCurrentPath("/system");
    window.scrollTo(0, 0);
  }

  // Check for public capability share/preview viewer
  const isShareViewer =
    window.location.pathname === "/system/preview" ||
    window.location.pathname === "/system/share" ||
    window.location.pathname === "/system/storage/share" ||
    window.location.pathname === "/preview" ||
    window.location.pathname === "/share" ||
    window.location.pathname === "/view";

  if (isShareViewer) {
    return (
      <>
        <ErrorBoundary>
          <Suspense fallback={<PageFallback />}>
            <ShareViewerPage />
          </Suspense>
        </ErrorBoundary>
        <GlobalAlertDialog />
      </>
    );
  }

  // If user is unauthenticated, render AuthPage
  if (!isAuthenticated) {
    const isSetup = window.location.pathname.includes("/setup");
    return (
      <>
        <ErrorBoundary>
          <Suspense fallback={<PageFallback />}>
            <AuthPage
              onLoginSuccess={handleLoginSuccess}
              initialMode={isSetup ? "setup" : "login"}
            />
          </Suspense>
        </ErrorBoundary>
        <GlobalAlertDialog />
        <Suspense fallback={null}>
          <Agentation />
        </Suspense>
      </>
    );
  }

  function getPageDetails(): { title: string; component: React.ReactNode } {
    const requiredPermission = ROUTE_PERMISSIONS[currentPath];
    if (requiredPermission && !hasPermission(requiredPermission)) {
      return {
        title: "Access Restricted",
        component: (
          <AccessRestricted
            required={requiredPermission}
            onBack={() => handleNavigate("/system")}
          />
        ),
      };
    }

    switch (currentPath) {
      case "/system/databases":
        return { title: "Database Pools", component: <Databases /> };
      case "/system/tables":
        return { title: "Table & Schema Editor", component: <TableEditor /> };
      case "/system/storage":
        return { title: "Native Blob Storage", component: <Storage /> };
      case "/system/cluster":
        return { title: "Cluster Mesh", component: <Cluster /> };
      case "/system/users":
        return { title: "Users", component: <Users /> };

      case "/system/keys":
        return { title: "API Keys", component: <Keys /> };
      case "/system/roles":
        return { title: "Roles & RBAC", component: <Roles /> };
      case "/system/audit":
        return { title: "Audit Trail", component: <AuditLog /> };
      case "/system/mcp":
        return { title: "MCP Protocol", component: <Mcp /> };
      case "/system/settings":
        return { title: "Settings", component: <Settings /> };
      case "/system":
      default:
        return {
          title: "Overview",
          component: <Overview onNavigate={handleNavigate} />,
        };
    }
  }

  async function handleLogout() {
    // Revoke server session BEFORE clearing local state so the Bearer token
    // is still present in the request for the logout endpoint.
    try {
      await api.logout();
    } catch {
      // Best-effort server session revocation
    } finally {
      clearSession();
      setIsAuthenticated(false);
      window.history.pushState(null, "", "/system/login");
      setCurrentPath("/system");
    }
  }

  const { title, component } = getPageDetails();

  return (
    <>
      <Layout
        currentPath={currentPath}
        onNavigate={handleNavigate}
        title={title}
        onLogout={handleLogout}
      >
        <ErrorBoundary>
          <Suspense fallback={<PageFallback />}>{component}</Suspense>
        </ErrorBoundary>
      </Layout>
      <GlobalAlertDialog />
      <Suspense fallback={null}>
        <Agentation />
      </Suspense>
    </>
  );
}

export default App;
