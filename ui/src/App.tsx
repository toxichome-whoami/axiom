import React, { useState, useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { api } from './api';
import { Layout } from './components/layout/Layout';
import { Overview } from './pages/Overview';
import { Databases } from './pages/Databases';
import { ApiKeys } from './pages/ApiKeys';
import { Roles } from './pages/Roles';
import { Cache } from './pages/Cache';
import { Logs } from './pages/Logs';
import { Audit } from './pages/Audit';
import { Metrics } from './pages/Metrics';
import { System } from './pages/System';
import { Login } from './pages/Login';
import { Setup } from './pages/Setup';

const AuthGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const token = localStorage.getItem('axiom_session_token');
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
};

export const App: React.FC = () => {
  const [checkingSetup, setCheckingSetup] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);

  useEffect(() => {
    const check = async () => {
      try {
        const res = await api.checkSetupStatus();
        if (res.setup_required) {
          setSetupRequired(true);
        }
      } catch {
        // If check fails (e.g. already setup and restricted), proceed normally
      } finally {
        setCheckingSetup(false);
      }
    };
    check();
  }, []);

  if (checkingSetup) {
    return (
      <div className="min-h-screen bg-[#000000] flex items-center justify-center text-white">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#f38020] flex items-center justify-center text-black font-bold animate-pulse">
            ▲
          </div>
          <span className="text-xs font-mono text-[#8c8c8c]">Initializing Gateway UI...</span>
        </div>
      </div>
    );
  }

  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/setup" element={<Setup />} />

        {setupRequired && (
          <Route path="*" element={<Navigate to="/setup" replace />} />
        )}

        {/* Authenticated Dashboard Routes */}
        <Route
          element={
            <AuthGuard>
              <Layout />
            </AuthGuard>
          }
        >
          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route path="/overview" element={<Overview />} />
          <Route path="/databases" element={<Databases />} />
          <Route path="/keys" element={<ApiKeys />} />
          <Route path="/roles" element={<Roles />} />
          <Route path="/cache" element={<Cache />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="/audit" element={<Audit />} />
          <Route path="/metrics" element={<Metrics />} />
          <Route path="/system" element={<System />} />
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
};

export default App;
