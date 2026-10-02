import React, { useState, useEffect } from 'react';
import { Layout, NavPath } from './components/Layout';
import { Overview } from './pages/Overview';
import { Databases } from './pages/Databases';
import { Keys } from './pages/Keys';
import { Roles } from './pages/Roles';
import { Mcp } from './pages/Mcp';
import { Tester } from './pages/Tester';
import { Settings } from './pages/Settings';
import { AuthPage } from './pages/AuthPage';

export function App() {
  function normalizePath(path: string): NavPath {
    let p = path.replace(/\/$/, '');
    if (!p || p === '/') return '/system';

    // Convenience aliases
    if (p === '/settings') p = '/system/settings';
    if (p === '/databases') p = '/system/databases';
    if (p === '/keys') p = '/system/keys';
    if (p === '/roles') p = '/system/roles';
    if (p === '/mcp') p = '/system/mcp';
    if (p === '/tester') p = '/system/tester';

    const validPaths: NavPath[] = [
      '/system',
      '/system/databases',
      '/system/keys',
      '/system/roles',
      '/system/mcp',
      '/system/tester',
      '/system/settings',
    ];
    return validPaths.includes(p as NavPath) ? (p as NavPath) : '/system';
  }

  const [currentPath, setCurrentPath] = useState<NavPath>(() => {
    return normalizePath(window.location.pathname);
  });

  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    // Check localStorage or cookies for active session
    return Boolean(localStorage.getItem('axiom_session_active'));
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

  function handleNavigate(path: NavPath) {
    if (path !== currentPath) {
      window.history.pushState(null, '', path);
      setCurrentPath(path);
      window.scrollTo(0, 0);
    }
  }

  function handleLoginSuccess(token: string, username: string) {
    localStorage.setItem('axiom_session_active', 'true');
    localStorage.setItem('axiom_session_token', token);
    localStorage.setItem('axiom_operator_user', username);
    setIsAuthenticated(true);
    handleNavigate('/system');
  }

  // If user visits /system/login or is unauthenticated, render AuthPage with Stepper
  if (!isAuthenticated || window.location.pathname.includes('/login') || window.location.pathname.includes('/setup')) {
    const isSetup = window.location.pathname.includes('/setup');
    return (
      <AuthPage
        onLoginSuccess={handleLoginSuccess}
        initialMode={isSetup ? 'setup' : 'login'}
      />
    );
  }

  function getPageDetails(): { title: string; component: React.ReactNode } {
    switch (currentPath) {
      case '/system/databases':
        return { title: 'Database Pools', component: <Databases /> };
      case '/system/keys':
        return { title: 'API Keys', component: <Keys /> };
      case '/system/roles':
        return { title: 'Roles & RBAC', component: <Roles /> };
      case '/system/mcp':
        return { title: 'MCP Protocol', component: <Mcp /> };
      case '/system/tester':
        return { title: 'Database API Explorer', component: <Tester /> };
      case '/system/settings':
        return { title: 'Settings', component: <Settings /> };
      case '/system':
      default:
        return { title: 'Overview', component: <Overview onNavigate={handleNavigate} /> };
    }
  }

  function handleLogout() {
    localStorage.removeItem('axiom_session_active');
    localStorage.removeItem('axiom_session_token');
    localStorage.removeItem('axiom_operator_user');
    setIsAuthenticated(false);
  }

  const { title, component } = getPageDetails();

  return (
    <Layout currentPath={currentPath} onNavigate={handleNavigate} title={title} onLogout={handleLogout}>
      {component}
    </Layout>
  );
}

export default App;
