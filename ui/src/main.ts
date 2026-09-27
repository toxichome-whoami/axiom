/*
 * Axiom Web UI main application entrypoint and hash router.
 * Dispatches setup wizard, login screen, or administrative dashboard shell.
 */

import './style.css';
import { api } from './api';
import { renderNavbar } from './components/Navbar';
import { renderSidebar } from './components/Sidebar';
import { renderSetup } from './pages/Setup';
import { renderLogin } from './pages/Login';
import { renderOverview } from './pages/Overview';
import { renderDatabases } from './pages/Databases';
import { renderApiKeys } from './pages/ApiKeys';
import { renderRoles } from './pages/Roles';
import { renderCache } from './pages/Cache';
import { renderAudit } from './pages/Audit';
import { renderMetrics } from './pages/Metrics';
import { renderSystem } from './pages/System';

const app = document.getElementById('app') as HTMLElement;
let isMobileSidebarOpen = false;

async function route() {
  const hash = window.location.hash || '#/overview';

  // Check setup wizard status first
  try {
    const setupStatus = await api.checkSetupStatus();
    if (setupStatus.setup_required) {
      if (hash !== '#/setup') {
        window.location.hash = '#/setup';
        return;
      }
      renderSetup(app);
      return;
    } else if (hash === '#/setup') {
      // Setup already complete; redirect to login
      window.location.hash = '#/login';
      return;
    }
  } catch {
    // If setup check fails, continue
  }

  // Handle Login view
  if (hash === '#/login') {
    renderLogin(app);
    return;
  }

  // Ensure authentication session exists
  const token = localStorage.getItem('axiom_session_token');
  if (!token) {
    window.location.hash = '#/login';
    return;
  }

  const routeName = hash.replace('#/', '').split('?')[0] || 'overview';

  // Render Dashboard Shell
  app.innerHTML = `
    <div class="min-h-screen bg-background flex flex-col">
      <div id="navbar-container"></div>
      <div class="flex-1 flex overflow-hidden">
        <div id="sidebar-container"></div>
        <main id="main-content" class="flex-1 overflow-y-auto bg-background"></main>
      </div>
    </div>
  `;

  const toggleSidebar = () => {
    isMobileSidebarOpen = !isMobileSidebarOpen;
    updateSidebar();
  };

  const closeSidebar = () => {
    isMobileSidebarOpen = false;
    updateSidebar();
  };

  const updateSidebar = () => {
    const sidebarContainer = document.getElementById('sidebar-container') as HTMLElement;
    if (sidebarContainer) {
      sidebarContainer.innerHTML = renderSidebar(routeName, isMobileSidebarOpen, closeSidebar);
      document.getElementById('sidebar-close-btn')?.addEventListener('click', closeSidebar);
    }
  };

  const navbarContainer = document.getElementById('navbar-container') as HTMLElement;
  navbarContainer.innerHTML = renderNavbar(toggleSidebar);
  updateSidebar();

  const mainContent = document.getElementById('main-content') as HTMLElement;

  // Dispatch page view
  switch (routeName) {
    case 'overview':
      renderOverview(mainContent);
      break;
    case 'databases':
      renderDatabases(mainContent);
      break;
    case 'keys':
      renderApiKeys(mainContent);
      break;
    case 'roles':
      renderRoles(mainContent);
      break;
    case 'cache':
      renderCache(mainContent);
      break;
    case 'audit':
      renderAudit(mainContent);
      break;
    case 'metrics':
      renderMetrics(mainContent);
      break;
    case 'system':
      renderSystem(mainContent);
      break;
    default:
      renderOverview(mainContent);
      break;
  }
}

window.addEventListener('hashchange', () => {
  isMobileSidebarOpen = false;
  route();
});

route();
