/*
 * Axiom Authentication & Setup Wizard view styled with binary_alive aesthetic.
 * Owned by: ui/auth
 * Key deps: Stepper, CustomSelect, lucide-react, ../api/client
 * Invariants: Setup mode is only available when axiom.db has zero registered admin users; credentials never persisted in plaintext.
 * Last structural change: Refined UI layout and typography to match binary_alive minimalist technical design.
 */

import React, { useState, useEffect } from 'react';
import { Stepper, StepItem } from '../components/shared/Stepper';
import { CustomSelect } from '../components/shared/CustomSelect';
import { api } from '../api/client';
import {
  Shield,
  Key,
  Database,
  CheckCircle2,
  Lock,
  User,
  ArrowRight,
  ArrowLeft,
  Server,
  Terminal,
  Copy,
  Check,
  AlertCircle,
  Eye,
  EyeOff,
  Sparkles,
  RefreshCw,
} from 'lucide-react';

interface AuthPageProps {
  onLoginSuccess: (token: string, username: string) => void;
  initialMode?: 'setup' | 'login';
}

const WIZARD_STEPS: StepItem[] = [
  { id: 1, label: 'Welcome' },
  { id: 2, label: 'Account' },
  { id: 3, label: 'Database' },
  { id: 4, label: 'Complete' },
];

const ENGINE_OPTIONS = [
  { value: 'PostgreSQL', label: 'PostgreSQL' },
  { value: 'MySQL', label: 'MySQL / MariaDB' },
  { value: 'MSSQL', label: 'Microsoft SQL Server' },
  { value: 'ClickHouse', label: 'ClickHouse (HTTP)' },
  { value: 'LibSQL', label: 'LibSQL / SQLite (Turso)' },
];

/**
 * Authentication and Initial Setup gateway page.
 * CONTRACT:
 *  - Checks whether initial setup is required on mount via /admin/v1/setup/begin.
 *  - Renders 4-step wizard when setup is required or requested.
 *  - Renders clean binary_alive-style login screen when cluster is already initialized.
 *  - Invokes onLoginSuccess callback on authenticated session creation.
 */
export function AuthPage({ onLoginSuccess, initialMode = 'login' }: AuthPageProps) {
  const [mode, setMode] = useState<'setup' | 'login'>(initialMode);
  const [currentStep, setCurrentStep] = useState(1);
  const [isCheckingSetup, setIsCheckingSetup] = useState(true);

  // Operator Login State
  const [loginUsername, setLoginUsername] = useState('admin');
  const [loginPassword, setLoginPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Setup Wizard Step 2: Admin Account
  const [adminUsername, setAdminUsername] = useState('admin');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminConfirmPassword, setAdminConfirmPassword] = useState('');

  // Setup Wizard Step 3: Database Target
  const [dbAlias, setDbAlias] = useState('main_db');
  const [dbEngine, setDbEngine] = useState('PostgreSQL');
  const [dbUrl, setDbUrl] = useState('postgres://postgres:password@127.0.0.1:5432/postgres');
  const [dbTesting, setDbTesting] = useState(false);
  const [dbTestSuccess, setDbTestSuccess] = useState<boolean | null>(null);

  // Setup Wizard Step 4: Token Generation
  const [copiedToken, setCopiedToken] = useState(false);
  const [generatedToken, setGeneratedToken] = useState('');

  // ─── Initialization & Setup Status Probe ───────────────────────────────────

  useEffect(() => {
    let mounted = true;
    async function checkSetup() {
      try {
        const res = await api.checkSetup();
        if (mounted) {
          if (res?.setup_required) {
            // No admin login secrets exist -> open onboarding setup wizard
            setMode('setup');
            setCurrentStep(1);
          } else {
            // Admin secrets exist -> setup is permanently locked forever
            setMode('login');
            if (window.location.pathname.includes('/setup')) {
              window.history.replaceState(null, '', '/login');
            }
          }
        }
      } catch {
        // Fallback to login
        if (mounted) setMode('login');
      } finally {
        if (mounted) setIsCheckingSetup(false);
      }
    }
    checkSetup();
    return () => {
      mounted = false;
    };
  }, []);

  // ─── Authentication Handlers ───────────────────────────────────────────────

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!loginUsername.trim() || !loginPassword) {
      setErrorMessage('Please enter both username and password.');
      return;
    }

    setErrorMessage(null);
    setLoginLoading(true);

    try {
      const data = await api.login({
        username: loginUsername.trim(),
        password: loginPassword,
      });

      if (rememberDevice) {
        localStorage.setItem('axiom_remember_device', 'true');
      } else {
        localStorage.removeItem('axiom_remember_device');
      }

      const token = data.session_token || data.token || '';
      onLoginSuccess(token, data.username);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid credentials or connection error.';
      setErrorMessage(msg);
    } finally {
      setLoginLoading(false);
    }
  }

  // ─── Setup Wizard Step Actions ─────────────────────────────────────────────

  async function handleCreateAccount() {
    if (!adminUsername.trim() || !adminPassword) {
      setErrorMessage('Username and password are required.');
      return;
    }
    if (adminPassword.length < 6) {
      setErrorMessage('Password must be at least 6 characters long.');
      return;
    }
    if (adminPassword !== adminConfirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    setErrorMessage(null);
    setLoginLoading(true);

    try {
      const res = await api.setupAccount({
        username: adminUsername.trim(),
        password: adminPassword,
      });
      const token = res.session_token || res.token || '';
      localStorage.setItem('axiom_session_token', token);
      localStorage.setItem('axiom_operator_user', res.username);
      setCurrentStep(3);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to initialize administrator account.';
      setErrorMessage(msg);
    } finally {
      setLoginLoading(false);
    }
  }

  function validateUrlScheme(engine: string, url: string): { valid: boolean; error?: string } {
    const trimmed = url.trim().toLowerCase();
    if (!trimmed) {
      return { valid: false, error: 'Database connection URI cannot be empty.' };
    }
    const schemes: Record<string, string[]> = {
      postgresql: ['postgres://', 'postgresql://'],
      mysql: ['mysql://', 'mariadb://'],
      mssql: ['mssql://', 'sqlserver://'],
      clickhouse: ['clickhouse://', 'clickhouse+https://', 'http://', 'https://'],
      libsql: ['sqlite://', 'libsql://', 'file:'],
    };
    const expected = schemes[engine.toLowerCase()];
    if (expected && !expected.some((prefix) => trimmed.startsWith(prefix))) {
      return {
        valid: false,
        error: `Invalid URL protocol for ${engine}. Expected scheme: ${expected.join(' or ')}`,
      };
    }
    return { valid: true };
  }

  async function handleTestDatabase() {
    const validation = validateUrlScheme(dbEngine, dbUrl);
    if (!validation.valid) {
      setErrorMessage(validation.error || 'Invalid URL protocol.');
      setDbTestSuccess(false);
      return;
    }

    setDbTesting(true);
    setDbTestSuccess(null);
    setErrorMessage(null);

    try {
      await api.testDatabaseUrl(dbUrl.trim());
      setDbTestSuccess(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Database connectivity test failed.';
      setErrorMessage(msg);
      setDbTestSuccess(false);
    } finally {
      setDbTesting(false);
    }
  }

  async function handleAttachDatabase() {
    if (!dbAlias.trim() || !dbUrl.trim()) {
      setErrorMessage('Database alias and URL are required.');
      return;
    }

    const validation = validateUrlScheme(dbEngine, dbUrl);
    if (!validation.valid) {
      setErrorMessage(validation.error || 'Invalid URL protocol.');
      setDbTestSuccess(false);
      return;
    }

    setLoginLoading(true);
    setErrorMessage(null);

    try {
      await api.setupDatabase({
        alias: dbAlias.trim(),
        url: dbUrl.trim(),
        engine: dbEngine,
      });
      setDbTestSuccess(true);
      setCurrentStep(4);
      await handleFinalizeSetup();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to connect to database.';
      setErrorMessage(msg);
      setDbTestSuccess(false);
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleFinalizeSetup() {
    try {
      const res = await api.setupComplete();
      if (res?.api_key?.token) {
        setGeneratedToken(res.api_key.token);
      }
    } catch {
      // In case complete was already called
    }
  }

  function handleCopyToken() {
    if (!generatedToken) return;
    navigator.clipboard?.writeText(generatedToken);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  }

  function handleFinishAndEnter() {
    const sessionToken = localStorage.getItem('axiom_session_token') || 'setup_completed';
    const user = adminUsername.trim() || 'admin';
    onLoginSuccess(sessionToken, user);
  }

  // ─── Loading Splash ────────────────────────────────────────────────────────

  if (isCheckingSetup) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0B0B0C]">
        <svg className="animate-spin h-7 w-7 text-[#2563eb]" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
      </div>
    );
  }

  // ─── Main Render ───────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[#0B0B0C] text-gray-100 selection:bg-[#2563eb] selection:text-white select-none font-sans">
      <div className="w-full max-w-[420px] flex flex-col items-stretch py-8">
        
        {/* Brand Header */}
        <div className="text-left mb-6">
          <h1 className="text-[20px] font-semibold text-white leading-snug tracking-tight">
            {mode === 'setup'
              ? currentStep === 1
                ? 'Welcome to Axiom'
                : currentStep === 2
                ? 'Create Admin Account'
                : currentStep === 3
                ? 'Connect Database'
                : 'Setup Complete'
              : 'Sign in to Axiom Gateway'}
          </h1>
          <p className="text-[13px] text-[#8c8c8c] mt-1 leading-normal">
            {mode === 'setup'
              ? currentStep === 1
                ? 'Initialize high-concurrency database proxy & RBAC engine.'
                : currentStep === 2
                ? 'Set credentials for the root gateway administrator.'
                : currentStep === 3
                ? 'Configure upstream SQL database pool (optional).'
                : 'Cluster initialized. Save credentials before proceeding.'
              : 'Enter your administrative credentials to manage cluster.'}
          </p>
        </div>

        {/* Stepper Progress Indicator (when in Setup Mode) */}
        {mode === 'setup' && (
          <div className="mb-6 pt-1 pb-2">
            <Stepper
              steps={WIZARD_STEPS}
              currentStep={currentStep}
              className="max-w-[380px] mx-auto"
            />
          </div>
        )}

        {/* Error Notification Banner */}
        {errorMessage && (
          <div className="mb-4 p-3 rounded-[8px] bg-[#ef4444]/10 border border-[#ef4444]/20 text-[#ef4444] text-[13px] flex items-start gap-2.5 leading-relaxed">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#ef4444]" />
            <div className="flex-1">{errorMessage}</div>
          </div>
        )}

        {/* ─── Mode: Direct Operator Login ──────────────────────────────────── */}
        {mode === 'login' && (
          <form onSubmit={handleLogin} className="flex flex-col space-y-4">
            <div>
              <label className="text-[13px] font-medium text-[#cccccc] mb-1.5 block">
                Username
              </label>
              <input
                type="text"
                autoComplete="username"
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                placeholder="admin"
                required
                className="h-10 w-full rounded-[8px] bg-[#141414] border border-[#262626] focus:border-[#2563eb] focus:ring-1 focus:ring-[#2563eb] px-3 text-[14px] text-white outline-none placeholder-[#555555] transition-colors"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[13px] font-medium text-[#cccccc] block">
                  Password
                </label>
              </div>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="••••••••••••"
                  required
                  className="h-10 w-full rounded-[8px] bg-[#141414] border border-[#262626] focus:border-[#2563eb] focus:ring-1 focus:ring-[#2563eb] pl-3 pr-10 text-[14px] text-white outline-none placeholder-[#555555] transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#777777] hover:text-[#cccccc] transition-colors cursor-pointer"
                  tabIndex={-1}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Remember Device Checkbox */}
            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberDevice}
                  onChange={(e) => setRememberDevice(e.target.checked)}
                  className="w-4 h-4 rounded border-[#262626] bg-[#141414] text-[#2563eb] focus:ring-0 focus:ring-offset-0 cursor-pointer"
                />
                <span className="text-[13px] text-[#8c8c8c] hover:text-[#cccccc] transition-colors">
                  Remember this device
                </span>
              </label>
            </div>

            {/* Submit Action */}
            <button
              type="submit"
              disabled={loginLoading}
              className="mt-2 h-10 w-full rounded-[8px] bg-white text-black font-medium hover:bg-[#eaeaea] transition-colors flex items-center justify-center gap-2 cursor-pointer text-[14px] shadow-sm disabled:opacity-50"
            >
              {loginLoading ? (
                <RefreshCw className="w-4 h-4 animate-spin text-black" />
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

          </form>
        )}

        {/* ─── Mode: Setup Wizard Step 1 (Welcome) ───────────────────────────── */}
        {mode === 'setup' && currentStep === 1 && (
          <div className="space-y-4">
            <div className="rounded-[8px] border border-[#222222] bg-[#141414] p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#2563eb]/10 border border-[#2563eb]/20 flex items-center justify-center text-[#2563eb] shrink-0">
                  <Shield className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-[14px] font-medium text-white">Centralized Policy & RBAC</h3>
                  <p className="text-[12px] text-[#8c8c8c] mt-0.5">
                    Zero-lock hot path using ArcSwap snapshot and BLAKE3 tokens.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#2563eb]/10 border border-[#2563eb]/20 flex items-center justify-center text-[#2563eb] shrink-0">
                  <Database className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-[14px] font-medium text-white">Universal Database Gateway</h3>
                  <p className="text-[12px] text-[#8c8c8c] mt-0.5">
                    PostgreSQL, MySQL, ClickHouse, MSSQL, and LibSQL with AST security firewall.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#2563eb]/10 border border-[#2563eb]/20 flex items-center justify-center text-[#2563eb] shrink-0">
                  <Server className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-[14px] font-medium text-white">Embedded Metadata Store</h3>
                  <p className="text-[12px] text-[#8c8c8c] mt-0.5">
                    Persistent SQLite/Turso catalog with hot reload and live audit logging.
                  </p>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setErrorMessage(null);
                setCurrentStep(2);
              }}
              className="h-10 w-full rounded-[8px] bg-white text-black font-medium hover:bg-[#eaeaea] transition-colors flex items-center justify-center gap-2 cursor-pointer text-[14px] shadow-sm"
            >
              <span>Get Started</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ─── Mode: Setup Wizard Step 2 (Admin Account) ─────────────────────── */}
        {mode === 'setup' && currentStep === 2 && (
          <div className="space-y-4">
            <div>
              <label className="text-[13px] font-medium text-[#cccccc] mb-1.5 block">
                Master Username
              </label>
              <input
                type="text"
                value={adminUsername}
                onChange={(e) => setAdminUsername(e.target.value)}
                placeholder="admin"
                className="h-10 w-full rounded-[8px] bg-[#141414] border border-[#262626] focus:border-[#2563eb] focus:ring-1 focus:ring-[#2563eb] px-3 text-[14px] text-white outline-none placeholder-[#555555] transition-colors"
              />
            </div>

            <div>
              <label className="text-[13px] font-medium text-[#cccccc] mb-1.5 block">
                Password
              </label>
              <input
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                placeholder="••••••••••••"
                className="h-10 w-full rounded-[8px] bg-[#141414] border border-[#262626] focus:border-[#2563eb] focus:ring-1 focus:ring-[#2563eb] px-3 text-[14px] text-white outline-none placeholder-[#555555] transition-colors"
              />
            </div>

            <div>
              <label className="text-[13px] font-medium text-[#cccccc] mb-1.5 block">
                Confirm Password
              </label>
              <input
                type="password"
                value={adminConfirmPassword}
                onChange={(e) => setAdminConfirmPassword(e.target.value)}
                placeholder="••••••••••••"
                className="h-10 w-full rounded-[8px] bg-[#141414] border border-[#262626] focus:border-[#2563eb] focus:ring-1 focus:ring-[#2563eb] px-3 text-[14px] text-white outline-none placeholder-[#555555] transition-colors"
              />
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setCurrentStep(1)}
                className="h-10 px-4 rounded-[8px] bg-[#141414] text-[#cccccc] hover:text-white hover:bg-[#1a1a1a] border border-[#262626] transition-colors cursor-pointer text-[14px]"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleCreateAccount}
                disabled={loginLoading}
                className="flex-1 h-10 rounded-[8px] bg-white text-black font-medium hover:bg-[#eaeaea] transition-colors flex items-center justify-center gap-2 cursor-pointer text-[14px] shadow-sm disabled:opacity-50"
              >
                {loginLoading ? (
                  <RefreshCw className="w-4 h-4 animate-spin text-black" />
                ) : (
                  <>
                    <span>Create & Continue</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* ─── Mode: Setup Wizard Step 3 (Database Target) ───────────────────── */}
        {mode === 'setup' && currentStep === 3 && (
          <div className="space-y-4">
            <div>
              <label className="text-[13px] font-medium text-[#cccccc] mb-1.5 block">
                Database Alias
              </label>
              <input
                type="text"
                value={dbAlias}
                onChange={(e) => setDbAlias(e.target.value)}
                placeholder="main_db"
                className="h-10 w-full rounded-[8px] bg-[#141414] border border-[#262626] focus:border-[#2563eb] focus:ring-1 focus:ring-[#2563eb] px-3 text-[14px] text-white outline-none placeholder-[#555555] transition-colors"
              />
            </div>

            <div>
              <label className="text-[13px] font-medium text-[#cccccc] mb-1.5 block">
                Engine Dialect
              </label>
              <CustomSelect
                value={dbEngine}
                options={ENGINE_OPTIONS}
                onChange={(val) => {
                  setDbEngine(val);
                  setDbTestSuccess(null);
                  setErrorMessage(null);
                }}
                menuWidth="w-full"
              />
            </div>

            <div>
              <label className="text-[13px] font-medium text-[#cccccc] mb-1.5 block">
                Connection URI
              </label>
              <input
                type="text"
                value={dbUrl}
                onChange={(e) => {
                  setDbUrl(e.target.value);
                  setDbTestSuccess(null);
                  setErrorMessage(null);
                }}
                placeholder="postgres://user:pass@host:5432/db"
                className="h-10 w-full rounded-[8px] bg-[#141414] border border-[#262626] focus:border-[#2563eb] focus:ring-1 focus:ring-[#2563eb] px-3 text-[14px] font-mono text-white outline-none placeholder-[#555555] transition-colors"
              />
            </div>

            {/* Test Connection Button */}
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={handleTestDatabase}
                disabled={dbTesting}
                className="text-[13px] text-[#2563eb] hover:text-[#60a5fa] transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${dbTesting ? 'animate-spin' : ''}`} />
                <span>Test Connection</span>
              </button>

              {dbTestSuccess === true && (
                <span className="text-[12px] text-[#30a46c] flex items-center gap-1 font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Connected
                </span>
              )}

              {dbTestSuccess === false && (
                <span className="text-[12px] text-[#ef4444] flex items-center gap-1 font-medium">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Connection Failed
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setCurrentStep(4);
                  handleFinalizeSetup();
                }}
                className="h-10 px-4 rounded-[8px] bg-[#141414] text-[#cccccc] hover:text-white hover:bg-[#1a1a1a] border border-[#262626] transition-colors cursor-pointer text-[13px]"
              >
                Skip
              </button>
              <button
                type="button"
                onClick={handleAttachDatabase}
                disabled={loginLoading}
                className="flex-1 h-10 rounded-[8px] bg-white text-black font-medium hover:bg-[#eaeaea] transition-colors flex items-center justify-center gap-2 cursor-pointer text-[14px] shadow-sm disabled:opacity-50"
              >
                {loginLoading ? (
                  <RefreshCw className="w-4 h-4 animate-spin text-black" />
                ) : (
                  <>
                    <span>Connect & Complete</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* ─── Mode: Setup Wizard Step 4 (Complete) ─────────────────────────── */}
        {mode === 'setup' && currentStep === 4 && (
          <div className="space-y-4">
            <div className="rounded-[8px] border border-[#30a46c]/30 bg-[#30a46c]/5 p-4 text-center space-y-2">
              <div className="w-10 h-10 rounded-full bg-[#30a46c]/20 text-[#30a46c] flex items-center justify-center mx-auto">
                <Check className="w-5 h-5" />
              </div>
              <h3 className="text-[15px] font-semibold text-white">Cluster Ready</h3>
              <p className="text-[13px] text-[#8c8c8c] leading-relaxed">
                Your administrative master account and metadata catalog are securely initialized.
              </p>
            </div>

            {generatedToken && (
              <div>
                <label className="text-[13px] font-medium text-[#cccccc] mb-1.5 block">
                  Initial Master API Key Token
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    readOnly
                    value={generatedToken}
                    className="h-10 flex-1 rounded-[8px] bg-[#141414] border border-[#262626] px-3 font-mono text-[12px] text-white outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleCopyToken}
                    className="h-10 px-3 rounded-[8px] bg-[#141414] border border-[#262626] hover:bg-[#202020] text-white transition-colors cursor-pointer"
                    title="Copy token"
                  >
                    {copiedToken ? <Check className="w-4 h-4 text-[#30a46c]" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-[11px] text-[#8c8c8c] mt-1">
                  Save this token now; secrets cannot be recovered after this session.
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={handleFinishAndEnter}
              className="mt-2 h-10 w-full rounded-[8px] bg-white text-black font-medium hover:bg-[#eaeaea] transition-colors flex items-center justify-center gap-2 cursor-pointer text-[14px] shadow-sm"
            >
              <span>Enter Axiom Console</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
