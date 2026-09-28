import React, { useState, useEffect, useRef } from 'react';
import { Terminal, Search, Trash2, ArrowDown, Shield } from 'lucide-react';

interface LogEntry {
  id: string;
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  message: string;
  source: string;
}

export const Logs: React.FC = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [levelFilter, setLevelFilter] = useState<'ALL' | 'INFO' | 'WARN' | 'ERROR'>('ALL');
  const [search, setSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Generate initial live telemetry log lines
    const now = new Date();
    const initial: LogEntry[] = [
      {
        id: '1',
        timestamp: new Date(now.getTime() - 60000).toISOString(),
        level: 'INFO',
        source: 'server::lifespan',
        message: 'Axiom Gateway v4.0.0 initialized on multi-thread Tokio runtime',
      },
      {
        id: '2',
        timestamp: new Date(now.getTime() - 55000).toISOString(),
        level: 'INFO',
        source: 'metadata::store',
        message: 'Loaded ArcSwap metadata snapshot from local libsql data/axiom.db',
      },
      {
        id: '3',
        timestamp: new Date(now.getTime() - 45000).toISOString(),
        level: 'INFO',
        source: 'db::pool',
        message: 'Initialized connection pools with per-alias non-blocking mutex locks',
      },
      {
        id: '4',
        timestamp: new Date(now.getTime() - 30000).toISOString(),
        level: 'INFO',
        source: 'cache::engine',
        message: 'L1 DashMap and L2 AOF cache subsystem ready (10k entries bounded)',
      },
      {
        id: '5',
        timestamp: new Date(now.getTime() - 15000).toISOString(),
        level: 'INFO',
        source: 'api::server',
        message: 'TCP listener accepting traffic on 0.0.0.0:4500',
      },
    ];
    setLogs(initial);

    // Periodically add simulated heartbeat log entries
    const interval = setInterval(() => {
      const entry: LogEntry = {
        id: Math.random().toString(36).substring(2, 9),
        timestamp: new Date().toISOString(),
        level: 'INFO',
        source: 'health::probe',
        message: 'Connection pool heartbeat check OK. Memory RSS stable.',
      };
      setLogs((prev) => [...prev.slice(-300), entry]);
    }, 12000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const filtered = logs.filter((l) => {
    if (levelFilter !== 'ALL' && l.level !== levelFilter) return false;
    if (search && !l.message.toLowerCase().includes(search.toLowerCase()) && !l.source.toLowerCase().includes(search.toLowerCase())) {
      return false;
    }
    return true;
  });

  return (
    <div className="space-y-4 flex flex-col flex-1">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#222222] pb-5">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">System Logs</h1>
          <p className="text-xs text-[#8c8c8c] mt-1">
            Real-time diagnostic event stream from internal engines, WAF filters, and database drivers.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setLogs([])}
            className="h-8 px-3 rounded text-xs font-medium text-[#cccccc] hover:text-white bg-[#141414] hover:bg-[#1a1a1a] border border-[#262626] transition-colors flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear Buffer</span>
          </button>
        </div>
      </div>

      {/* Control bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0c0c0c] p-2.5 rounded-lg border border-[#222222]">
        {/* Level Filters */}
        <div className="flex items-center gap-1">
          {(['ALL', 'INFO', 'WARN', 'ERROR'] as const).map((lvl) => (
            <button
              key={lvl}
              onClick={() => setLevelFilter(lvl)}
              className={`h-7 px-2.5 rounded text-xs font-mono font-medium transition-colors ${
                levelFilter === lvl
                  ? 'bg-[#202020] text-white border border-[#333333]'
                  : 'text-[#8c8c8c] hover:text-white'
              }`}
            >
              {lvl}
            </button>
          ))}
        </div>

        {/* Search & Auto-scroll */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#666666] absolute left-2.5 top-2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter logs..."
              className="h-7 pl-7 pr-2.5 rounded bg-[#141414] border border-[#262626] text-xs text-white placeholder-[#666666] focus:border-[#f38020] focus:outline-none"
            />
          </div>

          <label className="flex items-center gap-1.5 text-xs text-[#8c8c8c] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded border-[#333333] bg-[#141414] text-[#f38020] focus:ring-0"
            />
            <span className="flex items-center gap-1">
              <ArrowDown className="w-3 h-3" /> Auto-scroll
            </span>
          </label>
        </div>
      </div>

      {/* Terminal View */}
      <div className="flex-1 min-h-[420px] rounded-lg border border-[#222222] bg-[#050505] p-4 font-mono text-xs overflow-y-auto max-h-[620px] space-y-1.5 select-text shadow-inner">
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-[#555555]">
            No logs match the current filters.
          </div>
        ) : (
          filtered.map((log) => {
            const levelColor =
              log.level === 'ERROR'
                ? 'text-rose-400 bg-rose-500/10 border-rose-500/20'
                : log.level === 'WARN'
                ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
                : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';

            return (
              <div key={log.id} className="flex items-start gap-2.5 leading-relaxed hover:bg-[#0e0e0e] px-1.5 py-0.5 rounded transition-colors">
                <span className="text-[#555555] shrink-0 text-[11px]">
                  {log.timestamp.split('T')[1].replace('Z', '')}
                </span>
                <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold border shrink-0 ${levelColor}`}>
                  {log.level}
                </span>
                <span className="text-[#8c8c8c] shrink-0 font-medium">
                  [{log.source}]
                </span>
                <span className="text-[#dcdcdc] break-all">
                  {log.message}
                </span>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};
