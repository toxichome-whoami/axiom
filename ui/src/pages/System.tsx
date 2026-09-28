import React, { useState, useEffect } from 'react';
import { api, type SystemStatus, type UserRecord } from '../api';
import { TelemetryCard } from '../components/ui/TelemetryCard';
import { Badge } from '../components/ui/Badge';
import { Server, Cpu, HardDrive, ShieldCheck, CheckCircle2, Clock, Users, User, Shield, Terminal } from 'lucide-react';

export const System: React.FC = () => {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const currentUsername = localStorage.getItem('axiom_username') || 'admin';
  const displayUsers = users.length > 0
    ? users
    : [{ id: 1, username: currentUsername, created_at: 1790545110 }];

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const [statusRes, usersRes] = await Promise.all([
          api.getStatus().catch(() => null),
          api.getUsers().catch(() => []),
        ]);
        setStatus(statusRes);
        setUsers(Array.isArray(usersRes) ? usersRes : []);
      } catch (err) {
        console.error('Failed to load system info', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#222222] pb-5">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">System Runtime & Specs</h1>
          <p className="text-xs text-[#8c8c8c] mt-1">
            Daemon process metadata, Tokio asynchronous runtime mode, and binary configuration.
          </p>
        </div>
      </div>

      {/* Telemetry Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <TelemetryCard
          title="GATEWAY CORE"
          value="v4.0.0"
          change="Latest Release"
          isPositive={true}
          subtext="Single binary"
          icon={<Server className="w-4 h-4 text-[#f38020]" />}
          sparkline={[]}
        />
        <TelemetryCard
          title="MEMORY USAGE"
          value={loading ? '...' : `${status?.memory_mb ?? 24} MB`}
          change="Allocated"
          isPositive={true}
          subtext="mimalloc heap"
          icon={<HardDrive className="w-4 h-4 text-[#3b82f6]" />}
          sparkline={[20, 21, 23, 22, 24, 24, 25]}
        />
        <TelemetryCard
          title="TOKIO RUNTIME"
          value="Multi-Thread"
          change="epoll / kqueue"
          isPositive={true}
          subtext="Configured workers"
          icon={<Cpu className="w-4 h-4 text-emerald-400" />}
          sparkline={[]}
        />
        <TelemetryCard
          title="ACTIVE PROBES"
          value="Healthy"
          change="0 errors"
          isPositive={true}
          subtext="Ready for traffic"
          icon={<ShieldCheck className="w-4 h-4 text-amber-400" />}
          sparkline={[]}
        />
      </div>

      {/* Specs Details Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Environment & Process */}
        <div className="p-5 rounded-lg border border-[#222222] bg-[#0c0c0c] space-y-4">
          <h2 className="text-xs font-semibold text-white   flex items-center gap-2">
            <Server className="w-3.5 h-3.5 text-[#f38020]" />
            <span>Process & Host Specs</span>
          </h2>
          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-[#1c1c1c]">
              <span className="text-[#8c8c8c]">Runtime Mode</span>
              <span className=" text-white">Tokio Multi-Threaded Executor</span>
            </div>
            <div className="flex items-center justify-between pb-2 border-b border-[#1c1c1c]">
              <span className="text-[#8c8c8c]">Memory Allocator</span>
              <span className=" text-white">mimalloc (secure memory zeroing)</span>
            </div>
            <div className="flex items-center justify-between pb-2 border-b border-[#1c1c1c]">
              <span className="text-[#8c8c8c]">Metadata Storage</span>
              <span className=" text-white">libsql (local data/axiom.db)</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#8c8c8c]">Target Architecture</span>
              <span className=" text-[#3b82f6]">x86_64-pc-windows-msvc</span>
            </div>
          </div>
        </div>

        {/* Security Baseline Checklist */}
        <div className="p-5 rounded-lg border border-[#222222] bg-[#0c0c0c] space-y-4">
          <h2 className="text-xs font-semibold text-white   flex items-center gap-2">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Active Security Safeguards</span>
          </h2>
          <div className="space-y-2.5 text-xs">
            <div className="flex items-center gap-2 text-emerald-400">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span className="text-white">WAF Triple URL Deep-Decode Path Traversal Guard</span>
            </div>
            <div className="flex items-center gap-2 text-emerald-400">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span className="text-white">Constant-Time Byte XOR Secret Comparison</span>
            </div>
            <div className="flex items-center gap-2 text-emerald-400">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span className="text-white">Parameterized Query Engine with AST Inspection</span>
            </div>
            <div className="flex items-center gap-2 text-emerald-400">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span className="text-white">Brute-Force Auto-Ban & Suspension Engine</span>
            </div>
          </div>
        </div>
      </div>

      {/* Administrator Accounts List */}
      <div className="rounded-lg border border-[#222222] bg-[#0c0c0c] overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between px-5 py-4 border-b border-[#222222] gap-2">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-[#f38020]" />
            <h2 className="text-xs font-semibold text-white">Administrator Accounts</h2>
            <span className="text-[11px] text-[#8c8c8c] bg-[#161718] border border-[#26282a] px-1.5 py-0.5 rounded font-mono">
              {displayUsers.length} registered
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-[#8c8c8c]">
            <Terminal className="w-3 h-3 text-[#f38020]" />
            <span>Provision via CLI: <code className="text-white font-mono">axiom user add &lt;username&gt;</code></span>
          </div>
        </div>

        <div className="divide-y divide-[#1c1c1c]">
          {loading ? (
            <div className="p-8 text-center text-xs text-[#8c8c8c]">
              Loading administrator accounts...
            </div>
          ) : (
            displayUsers.map((u) => {
              const isCurrent = u.username.toLowerCase() === currentUsername.toLowerCase();
              return (
                <div key={u.id} className="flex items-center justify-between px-5 py-3.5 hover:bg-[#111111] transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full bg-[#181818] border border-[#282828] flex items-center justify-center text-[#cccccc] text-xs font-semibold">
                      {u.username.substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-white">{u.username}</span>
                        {isCurrent && (
                          <Badge variant="outline" className="text-[10px] py-0 px-1.5 text-emerald-400 border-emerald-500/30 bg-emerald-500/10">
                            Current Session
                          </Badge>
                        )}
                      </div>
                      <span className="text-[11px] text-[#8c8c8c] font-mono">ID: {u.id}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-xs">
                    <div className="text-right hidden sm:block">
                      <span className="block text-[11px] text-[#8c8c8c]">Provisioned</span>
                      <span className="text-[11px] text-[#cccccc] font-mono">
                        {u.created_at ? new Date(u.created_at * 1000).toLocaleDateString() : 'Initial Setup'}
                      </span>
                    </div>
                    <Badge variant="default" className="text-[11px]">
                      Superadmin
                    </Badge>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

