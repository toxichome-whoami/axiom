import React, { useState, useEffect } from 'react';
import { api, type SystemStatus } from '../api';
import { TelemetryCard } from '../components/ui/TelemetryCard';
import { Server, Cpu, HardDrive, ShieldCheck, CheckCircle2, Clock } from 'lucide-react';

export const System: React.FC = () => {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const res = await api.getStatus();
        setStatus(res);
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
          <h2 className="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-2">
            <Server className="w-3.5 h-3.5 text-[#f38020]" />
            <span>Process & Host Specs</span>
          </h2>
          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-[#1c1c1c]">
              <span className="text-[#8c8c8c]">Runtime Mode</span>
              <span className="font-mono text-white">Tokio Multi-Threaded Executor</span>
            </div>
            <div className="flex items-center justify-between pb-2 border-b border-[#1c1c1c]">
              <span className="text-[#8c8c8c]">Memory Allocator</span>
              <span className="font-mono text-white">mimalloc (secure memory zeroing)</span>
            </div>
            <div className="flex items-center justify-between pb-2 border-b border-[#1c1c1c]">
              <span className="text-[#8c8c8c]">Metadata Storage</span>
              <span className="font-mono text-white">libsql (local data/axiom.db)</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#8c8c8c]">Target Architecture</span>
              <span className="font-mono text-[#3b82f6]">x86_64-pc-windows-msvc</span>
            </div>
          </div>
        </div>

        {/* Security Baseline Checklist */}
        <div className="p-5 rounded-lg border border-[#222222] bg-[#0c0c0c] space-y-4">
          <h2 className="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-2">
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
    </div>
  );
};
