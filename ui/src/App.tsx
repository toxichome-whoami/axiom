import React, { useState, useEffect } from 'react';
import { Layout, NavPath } from './components/Layout';
import { Overview } from './pages/Overview';
import { Databases } from './pages/Databases';
import { Keys } from './pages/Keys';
import { Roles } from './pages/Roles';
import { Mcp } from './pages/Mcp';
import { Tester } from './pages/Tester';
import { Metrics } from './pages/Metrics';
import { Audit } from './pages/Audit';
import { Settings } from './pages/Settings';

export function App() {
  const [currentPath, setCurrentPath] = useState<NavPath>(() => {
    const p = window.location.pathname.replace(/\/$/, '') || '/ui';
    const validPaths: NavPath[] = [
      '/ui',
      '/ui/databases',
      '/ui/keys',
      '/ui/roles',
      '/ui/mcp',
      '/ui/tester',
      '/ui/metrics',
      '/ui/audit',
      '/ui/settings',
    ];
    return validPaths.includes(p as NavPath) ? (p as NavPath) : '/ui';
  });

  useEffect(() => {
    function handlePopState() {
      const p = window.location.pathname.replace(/\/$/, '') || '/ui';
      setCurrentPath(p as NavPath);
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

  function getPageDetails(): { title: string; component: React.ReactNode } {
    switch (currentPath) {
      case '/ui/databases':
        return { title: 'Database Pools', component: <Databases /> };
      case '/ui/keys':
        return { title: 'API Keys', component: <Keys /> };
      case '/ui/roles':
        return { title: 'Roles & RBAC', component: <Roles /> };
      case '/ui/mcp':
        return { title: 'MCP Protocol', component: <Mcp /> };
      case '/ui/tester':
        return { title: 'Database API Explorer', component: <Tester /> };
      case '/ui/metrics':
        return { title: 'Telemetry & Metrics', component: <Metrics /> };
      case '/ui/audit':
        return { title: 'Audit Trail', component: <Audit /> };
      case '/ui/settings':
        return { title: 'Settings & Administration', component: <Settings /> };
      case '/ui':
      default:
        return { title: 'Overview', component: <Overview onNavigate={handleNavigate} /> };
    }
  }

  const { title, component } = getPageDetails();

  return (
    <Layout currentPath={currentPath} onNavigate={handleNavigate} title={title}>
      {component}
    </Layout>
  );
}

export default App;
