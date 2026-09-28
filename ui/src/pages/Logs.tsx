/*
 * System live log stream and audit trace built with Shadcn UI primitives.
 * Owned by: ui/pages
 * Key deps: ../components/ui, ../api
 * Invariants: Real-time event log, dynamic level filter, autoscrolling ANSI-styled output container.
 */

import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import { Button, Badge, Input } from '../components/ui';
import { Search, Trash2, ArrowDown } from 'lucide-react';

interface LogEntry {
  id: string;
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  source: string;
  message: string;
}

export const Logs: React.FC = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState<'ALL' | 'INFO' | 'WARN' | 'ERROR'>('ALL');
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;

    const loadRealEvents = async () => {
      try {
        const [auditRecords, health] = await Promise.all([
          api.getAuditLog(50, 0).catch(() => []),
          api.getHealth().catch(() => null),
        ]);

        if (!mounted) return;

        const entries: LogEntry[] = [];

        if (health) {
          entries.push({
            id: 'health-boot',
            timestamp: new Date().toISOString(),
            level: 'INFO',
            source: 'system::health',
            message: `Gateway status: ${health.status} (version ${health.version})`,
          });
        }

        if (Array.isArray(auditRecords)) {
          auditRecords.forEach((rec) => {
            entries.push({
              id: `audit-${rec.id}`,
              timestamp: new Date(rec.timestamp * 1000).toISOString(),
              level: rec.action.includes('fail') || rec.action.includes('deny') ? 'WARN' : 'INFO',
              source: `audit::${rec.actor}`,
              message: `Action '${rec.action}' on target '${rec.target}'${rec.details ? ` - ${rec.details}` : ''}`,
            });
          });
        }

        setLogs(entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp)));
      } catch (err) {
        console.error('Failed to load system events', err);
      }
    };

    loadRealEvents();

    // Live probe every 15s to append health heartbeat
    const interval = setInterval(async () => {
      try {
        const h = await api.getHealth();
        if (mounted && h) {
          const entry: LogEntry = {
            id: Math.random().toString(36).substring(2, 9),
            timestamp: new Date().toISOString(),
            level: 'INFO',
            source: 'health::probe',
            message: `Live health probe OK (${h.status})`,
          };
          setLogs((prev) => [...prev.slice(-300), entry]);
        }
      } catch {
        if (mounted) {
          const entry: LogEntry = {
            id: Math.random().toString(36).substring(2, 9),
            timestamp: new Date().toISOString(),
            level: 'WARN',
            source: 'health::probe',
            message: 'Heartbeat probe timed out or returned error',
          };
          setLogs((prev) => [...prev.slice(-300), entry]);
        }
      }
    }, 15000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
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
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setLogs([])}
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear Buffer</span>
          </Button>
        </div>
      </div>

      {/* Control bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0c0c0c] p-2.5 rounded-lg border border-[#222222]">
        {/* Level Filters */}
        <div className="flex items-center gap-1">
          {(['ALL', 'INFO', 'WARN', 'ERROR'] as const).map((lvl) => (
            <Button
              key={lvl}
              variant={levelFilter === lvl ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setLevelFilter(lvl)}
              className="h-7 px-2.5 font-mono text-xs"
            >
              {lvl}
            </Button>
          ))}
        </div>

        {/* Search & Auto-scroll */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#666666] absolute left-2.5 top-2.5" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter logs..."
              className="h-8 pl-8 pr-2.5 w-48 text-xs font-sans"
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
            const badgeVariant =
              log.level === 'ERROR'
                ? 'destructive'
                : log.level === 'WARN'
                ? 'warning'
                : 'success';

            return (
              <div key={log.id} className="flex items-start gap-2.5 leading-relaxed hover:bg-[#0e0e0e] px-1.5 py-0.5 rounded transition-colors">
                <span className="text-[#555555] shrink-0 text-[11px]">
                  {log.timestamp.split('T')[1].replace('Z', '')}
                </span>
                <Badge variant={badgeVariant} className="text-[10px] py-0 px-1.5">
                  {log.level}
                </Badge>
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
