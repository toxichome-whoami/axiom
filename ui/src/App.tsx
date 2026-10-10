import React, { useState, useEffect, Suspense, lazy } from 'react';
import { Layout, NavPath } from './components/Layout';
import { setSession, clearSession, hasActiveSession } from './api/session';
import { api } from './api/client';

const Overview = lazy(() => import('./pages/Overview').then((m) => ({ default: m.Overview })));
const Databases = lazy(() => import('./pages/Databases').then((m) => ({ default: m.Databases })));
const TableEditor = lazy(() => import('./pages/TableEditor').then((m) => ({ default: m.TableEditor })));
const Storage = lazy(() => import('./pages/Storage').then((m) => ({ default: m.Storage })));
const Keys = lazy(() => import('./pages/Keys').then((m) => ({ default: m.Keys })));
const Roles = lazy(() => import('./pages/Roles').then((m) => ({ default: m.Roles })));
const Mcp = lazy(() => import('./pages/Mcp').then((m) => ({ default: m.Mcp })));
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })));
const AuthPage = lazy(() => import('./pages/AuthPage').then((m) => ({ default: m.AuthPage })));

function PageFallback() {
  return (
    <div className="flex-1 flex items-center justify-center p-12 min-h-[300px]">
      <svg className="animate-spin h-6 w-6 text-[#2563eb]" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
      </svg>
    </div>
  );
}

export function App() {
  function normalizePath(path: string): NavPath {
    let p = path.replace(/\/$/, '');
    if (!p || p === '/') return '/system';

    // Convenience aliases
    if (p === '/settings') p = '/system/settings';
    if (p === '/databases') p = '/system/databases';
    if (p === '/tables' || p === '/editor' || p === '/table-editor') p = '/system/tables';
    if (p === '/storage' || p === '/blobs') p = '/system/storage';
    if (p === '/keys') p = '/system/keys';
    if (p === '/roles') p = '/system/roles';
    if (p === '/mcp') p = '/system/mcp';

    const validPaths: NavPath[] = [
      '/system',
      '/system/databases',
      '/system/tables',
      '/system/storage',
      '/system/keys',
      '/system/roles',
      '/system/mcp',
      '/system/settings',
    ];
    return validPaths.includes(p as NavPath) ? (p as NavPath) : '/system';
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
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  // Listen for unauthorized 401/403 events from client.ts to force logout
  useEffect(() => {
    function onUnauthorized() {
      handleLogout();
    }
    window.addEventListener('axiom:unauthorized', onUnauthorized);
    return () => {
      window.removeEventListener('axiom:unauthorized', onUnauthorized);
    };
  }, []);

  // Probe server status on mount to verify session validity with backend
  useEffect(() => {
    if (isAuthenticated) {
      api.getStatus().catch(() => {
        handleLogout();
      });
    }
  }, [isAuthenticated]);

  function handleNavigate(path: NavPath) {
    if (path !== currentPath) {
      window.history.pushState(null, '', path);
      setCurrentPath(path);
      window.scrollTo(0, 0);
    }
  }

  function handleLoginSuccess(token: string, username: string, expiresAt?: number) {
    setSession(token, expiresAt, username);
    setIsAuthenticated(true);
    handleNavigate('/system');
  }

  // If user visits /system/login or is unauthenticated, render AuthPage with Stepper
  if (!isAuthenticated || window.location.pathname.includes('/login') || window.location.pathname.includes('/setup')) {
    const isSetup = window.location.pathname.includes('/setup');
    return (
      <Suspense fallback={<PageFallback />}>
        <AuthPage
          onLoginSuccess={handleLoginSuccess}
          initialMode={isSetup ? 'setup' : 'login'}
        />
      </Suspense>
    );
  }

  function getPageDetails(): { title: string; component: React.ReactNode } {
    switch (currentPath) {
      case '/system/databases':
        return { title: 'Database Pools', component: <Databases /> };
      case '/system/tables':
        return { title: 'Table & Schema Editor', component: <TableEditor /> };
      case '/system/storage':
        return { title: 'Native Blob Storage', component: <Storage /> };

      case '/system/keys':
        return { title: 'API Keys', component: <Keys /> };
      case '/system/roles':
        return { title: 'Roles & RBAC', component: <Roles /> };
      case '/system/mcp':
        return { title: 'MCP Protocol', component: <Mcp /> };
      case '/system/settings':
        return { title: 'Settings', component: <Settings /> };
      case '/system':
      default:
        return { title: 'Overview', component: <Overview onNavigate={handleNavigate} /> };
    }
  }

  async function handleLogout() {
    clearSession();
    setIsAuthenticated(false);
    try {
      await api.logout();
    } catch {
      // Best-effort server session revocation
    }
  }

  const { title, component } = getPageDetails();

  return (
    <Layout currentPath={currentPath} onNavigate={handleNavigate} title={title} onLogout={handleLogout}>
      <Suspense fallback={<PageFallback />}>
        {component}
      </Suspense>
    </Layout>
  );
}

export default App;
