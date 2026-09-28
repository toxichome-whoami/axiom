import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { toast } from '../components/ui/Toast';
import { Lock, User, AlertCircle, ArrowRight } from 'lucide-react';

export const Login: React.FC = () => {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password) {
      setError('Username and password are required.');
      return;
    }

    try {
      setLoading(true);
      const res = await api.login({ username: username.trim(), password });
      localStorage.setItem('axiom_session_token', res.token);
      localStorage.setItem('axiom_username', res.username);
      toast.success(`Welcome back, ${res.username}`);
      navigate('/overview');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#000000] flex flex-col justify-center items-center p-4 selection:bg-[#f38020] selection:text-black">
      <div className="w-full max-w-[380px] space-y-6">
        {/* Brand */}
        <div className="text-center space-y-2">
          <div className="inline-flex w-10 h-10 rounded-lg bg-[#f38020] items-center justify-center text-black font-bold text-lg shadow-lg">
            ▲
          </div>
          <h1 className="text-lg font-bold tracking-tight text-white">
            Sign in to Axiom Gateway
          </h1>
          <p className="text-xs text-[#8c8c8c]">
            Enter your administrator credentials to access the control plane.
          </p>
        </div>

        {/* Card */}
        <div className="rounded-lg border border-[#222222] bg-[#0c0c0c] p-6 shadow-2xl">
          {error && (
            <div className="mb-4 p-3 rounded bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#cccccc] mb-1.5">
                Username
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-[#666666] absolute left-3 top-2.5" />
                <input
                  type="text"
                  required
                  autoFocus
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                  className="w-full h-9 pl-9 pr-3 rounded bg-[#141414] border border-[#262626] text-xs text-white placeholder-[#555555] focus:border-[#f38020] focus:outline-none transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#cccccc] mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-[#666666] absolute left-3 top-2.5" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full h-9 pl-9 pr-3 rounded bg-[#141414] border border-[#262626] text-xs text-white placeholder-[#555555] focus:border-[#f38020] focus:outline-none transition-colors"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-9 mt-2 rounded text-xs font-semibold bg-[#f38020] hover:bg-[#fa8c16] text-black transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer shadow-md"
            >
              {loading && <span className="animate-spin w-3 h-3 border-2 border-black border-t-transparent rounded-full" />}
              <span>Sign In</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>

        {/* Footer info */}
        <div className="text-center text-[11px]  text-[#555555]">
          Axiom Enterprise Gateway Core v4.0.0
        </div>
      </div>
    </div>
  );
};
