import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { toast } from '../components/ui/Toast';
import { CheckCircle2, Shield, Database, ArrowRight, AlertCircle, Copy, Check } from 'lucide-react';

export const Setup: React.FC = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Step 2 Admin Account
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Step 3 First Database (skippable)
  const [alias, setAlias] = useState('main_db');
  const [engine, setEngine] = useState('postgres');
  const [url, setUrl] = useState('');

  // Step 4 Complete
  const [adminToken, setAdminToken] = useState('');
  const [hasCopied, setHasCopied] = useState(false);

  const handleStep2Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password) {
      setError('Please provide a username and password.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    try {
      setLoading(true);
      const res = await api.createAdminAccount({ username: username.trim(), password });
      setAdminToken(res.token);
      localStorage.setItem('axiom_session_token', res.token);
      localStorage.setItem('axiom_username', res.username);
      setStep(3);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create admin user');
    } finally {
      setLoading(false);
    }
  };

  const handleStep3Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!url.trim()) {
      // User clicked continue without entering URL, treat as skip
      setStep(4);
      return;
    }

    try {
      setLoading(true);
      await api.setupDatabase({ alias: alias.trim(), url: url.trim(), engine });
      toast.success(`Database '${alias}' connected`);
      setStep(4);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to connect database');
    } finally {
      setLoading(false);
    }
  };

  const handleFinish = async () => {
    try {
      setLoading(true);
      await api.completeSetup();
      toast.success('Setup completed! Welcome to Axiom.');
      navigate('/overview');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to finalize setup');
      navigate('/overview');
    } finally {
      setLoading(false);
    }
  };

  const copyToken = async () => {
    try {
      await navigator.clipboard.writeText(adminToken);
      setHasCopied(true);
      setTimeout(() => setHasCopied(false), 2000);
      toast.info('Session token copied');
    } catch {
      toast.error('Failed to copy');
    }
  };

  return (
    <div className="min-h-screen bg-[#000000] flex flex-col justify-center items-center p-4 selection:bg-[#f38020] selection:text-black">
      <div className="w-full max-w-[500px] space-y-6">
        {/* Brand */}
        <div className="text-center space-y-2">
          <div className="inline-flex w-10 h-10 rounded-lg bg-[#f38020] items-center justify-center text-black font-bold text-lg shadow-lg">
            ▲
          </div>
          <h1 className="text-lg font-bold tracking-tight text-white">
            Axiom Gateway Initialization
          </h1>
          <p className="text-xs text-[#8c8c8c]">
            Step {step} of 4 — Setup your administrative control plane
          </p>
        </div>

        {/* Progress Dots */}
        <div className="flex items-center justify-center gap-2">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === step ? 'w-8 bg-[#f38020]' : i < step ? 'w-4 bg-emerald-500' : 'w-4 bg-[#222222]'
              }`}
            />
          ))}
        </div>

        {/* Card */}
        <div className="rounded-lg border border-[#222222] bg-[#0c0c0c] p-6 shadow-2xl">
          {error && (
            <div className="mb-4 p-3 rounded bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Step 1: Welcome */}
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-white">Welcome to Axiom</h2>
              <p className="text-xs text-[#8c8c8c] leading-relaxed">
                Axiom is an enterprise single-binary database gateway with built-in RBAC, connection pooling, high-performance two-tier caching, and structured audit logging.
              </p>
              <div className="p-3.5 rounded bg-[#101010] border border-[#222222] space-y-2 text-xs text-[#a1a1a1]">
                <div className="flex items-center gap-2 text-white">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>Single-binary deployment with zero external dependencies</span>
                </div>
                <div className="flex items-center gap-2 text-white">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>Sub-microsecond L1 cache & BLAKE3 authentication</span>
                </div>
                <div className="flex items-center gap-2 text-white">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>PostgreSQL, MySQL, MSSQL, ClickHouse, and LibSQL</span>
                </div>
              </div>
              <button
                onClick={() => setStep(2)}
                className="w-full h-9 rounded text-xs font-semibold bg-[#f38020] hover:bg-[#fa8c16] text-black transition-colors flex items-center justify-center gap-1.5"
              >
                <span>Get Started</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Step 2: Create Admin Account */}
          {step === 2 && (
            <form onSubmit={handleStep2Submit} className="space-y-4">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-[#f38020]" />
                <h2 className="text-sm font-semibold text-white">Create Admin Account</h2>
              </div>
              <p className="text-xs text-[#8c8c8c]">
                This account will own the gateway and can manage keys, roles, and databases.
              </p>

              <div>
                <label className="block text-xs font-medium text-[#cccccc] mb-1">
                  Administrator Username
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="admin"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full h-8 px-3 rounded bg-[#141414] border border-[#262626] text-xs text-white focus:border-[#f38020] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#cccccc] mb-1">
                  Password (min 8 chars)
                </label>
                <input
                  type="password"
                  required
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-8 px-3 rounded bg-[#141414] border border-[#262626] text-xs text-white focus:border-[#f38020] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#cccccc] mb-1">
                  Confirm Password
                </label>
                <input
                  type="password"
                  required
                  placeholder="••••••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full h-8 px-3 rounded bg-[#141414] border border-[#262626] text-xs text-white focus:border-[#f38020] focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full h-9 rounded text-xs font-semibold bg-[#f38020] hover:bg-[#fa8c16] text-black transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {loading && <span className="animate-spin w-3 h-3 border-2 border-black border-t-transparent rounded-full" />}
                <span>Create Admin Account</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </form>
          )}

          {/* Step 3: Connect First Database */}
          {step === 3 && (
            <form onSubmit={handleStep3Submit} className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-[#f38020]" />
                  <h2 className="text-sm font-semibold text-white">Connect First Database</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setStep(4)}
                  className="text-xs text-[#8c8c8c] hover:text-white transition-colors"
                >
                  Skip for now
                </button>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#cccccc] mb-1">
                  Database Alias
                </label>
                <input
                  type="text"
                  value={alias}
                  onChange={(e) => setAlias(e.target.value)}
                  className="w-full h-8 px-3 rounded bg-[#141414] border border-[#262626] text-xs text-white focus:border-[#f38020] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#cccccc] mb-1">
                  Engine
                </label>
                <select
                  value={engine}
                  onChange={(e) => setEngine(e.target.value)}
                  className="w-full h-8 px-2.5 rounded bg-[#141414] border border-[#262626] text-xs text-white focus:border-[#f38020] focus:outline-none"
                >
                  <option value="postgres">PostgreSQL</option>
                  <option value="mysql">MySQL / MariaDB</option>
                  <option value="mssql">Microsoft SQL Server</option>
                  <option value="libsql">SQLite / LibSQL</option>
                  <option value="clickhouse">ClickHouse</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#cccccc] mb-1">
                  Connection URL
                </label>
                <input
                  type="text"
                  placeholder="e.g. postgres://user:pass@localhost:5432/dbname"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="w-full h-8 px-3 rounded bg-[#141414] border border-[#262626] text-xs text-white focus:border-[#f38020] focus:outline-none "
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setStep(4)}
                  className="w-1/2 h-9 rounded text-xs font-medium bg-[#141414] hover:bg-[#1a1a1a] border border-[#262626] text-[#cccccc] hover:text-white transition-colors"
                >
                  Skip
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-1/2 h-9 rounded text-xs font-semibold bg-[#f38020] hover:bg-[#fa8c16] text-black transition-colors flex items-center justify-center gap-1.5"
                >
                  {loading && <span className="animate-spin w-3 h-3 border-2 border-black border-t-transparent rounded-full" />}
                  <span>Connect</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </form>
          )}

          {/* Step 4: Done */}
          {step === 4 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-emerald-400">
                <CheckCircle2 className="w-5 h-5" />
                <h2 className="text-sm font-semibold text-white">Axiom is Ready!</h2>
              </div>
              <p className="text-xs text-[#8c8c8c]">
                Your gateway has been successfully initialized. You can now access the full administrative dashboard.
              </p>

              {adminToken && (
                <div>
                  <label className="block text-[11px]  text-[#8c8c8c] mb-1">
                    Your Session Token:
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={adminToken}
                      className="w-full h-8 px-2.5 rounded bg-[#141414] border border-[#262626] text-xs  text-white select-all focus:outline-none"
                    />
                    <button
                      onClick={copyToken}
                      className="h-8 px-2.5 rounded bg-[#1a1a1a] hover:bg-[#252525] border border-[#2c2c2c] text-xs font-medium text-white transition-colors flex items-center gap-1 shrink-0"
                    >
                      {hasCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>{hasCopied ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                </div>
              )}

              <button
                onClick={handleFinish}
                disabled={loading}
                className="w-full h-9 rounded text-xs font-semibold bg-[#f38020] hover:bg-[#fa8c16] text-black transition-colors flex items-center justify-center gap-1.5 shadow-lg"
              >
                <span>Launch Dashboard</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
