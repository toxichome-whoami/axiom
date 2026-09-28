/*
 * Telemetry and Prometheus metrics exposition page built with Shadcn UI primitives.
 * Owned by: ui/pages
 * Key deps: ../components/ui, ../api
 * Invariants: Real Prometheus metric parsing, expandable raw exposition inspector, zero fake mock numbers.
 */

import React, { useState, useEffect } from 'react';
import { api } from '../api';
import {
  Button,
  Card,
  TelemetryCard,
  toast,
} from '../components/ui';
import { Activity, RefreshCw, Copy, Check, ChevronDown, ChevronUp, Globe, Database, ShieldAlert, Cpu } from 'lucide-react';

export const Metrics: React.FC = () => {
  const [rawMetrics, setRawMetrics] = useState('');
  const [loading, setLoading] = useState(true);
  const [showRaw, setShowRaw] = useState(false);
  const [hasCopied, setHasCopied] = useState(false);

  const loadMetrics = async () => {
    try {
      setLoading(true);
      const res = await api.getRawMetrics();
      setRawMetrics(typeof res === 'string' ? res : JSON.stringify(res, null, 2));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to scrape Prometheus metrics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMetrics();
  }, []);

  const copyMetrics = async () => {
    try {
      await navigator.clipboard.writeText(rawMetrics);
      setHasCopied(true);
      setTimeout(() => setHasCopied(false), 2000);
      toast.info('Metrics copied to clipboard');
    } catch {
      toast.error('Failed to copy metrics');
    }
  };

  // Parse sample values from Prometheus exposition if available
  const extractMetric = (metricName: string): number => {
    if (!rawMetrics) return 0;
    const match = rawMetrics.match(new RegExp(`^${metricName}(?:\\{[^}]*\\})?\\s+([0-9.]+)`, 'm'));
    return match ? parseFloat(match[1]) : 0;
  };

  // Extract real metric values without fake mock fallbacks
  const httpRequests = extractMetric('axiom_http_requests_total');
  const dbQueries = extractMetric('axiom_db_queries_total');
  const activeSockets = extractMetric('axiom_db_pool_connections_active');
  const rateLimitDrops = extractMetric('axiom_rate_limit_rejections_total');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#222222] pb-5">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Telemetry & Metrics</h1>
          <p className="text-xs text-[#8c8c8c] mt-1">
            Real-time Prometheus exposition endpoint and operational data plane counters.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={loadMetrics}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Scrape /metrics</span>
          </Button>
        </div>
      </div>

      {/* Telemetry Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <TelemetryCard
          title="TOTAL HTTP REQUESTS"
          value={loading ? '...' : httpRequests.toLocaleString()}
          subtext="via Axum Data Plane"
          icon={<Globe className="w-4 h-4 text-[#3b82f6]" />}
        />
        <TelemetryCard
          title="DB QUERIES EXECUTED"
          value={loading ? '...' : dbQueries.toLocaleString()}
          subtext="Parameterized queries"
          icon={<Database className="w-4 h-4 text-[#f38020]" />}
        />
        <TelemetryCard
          title="ACTIVE POOL SOCKETS"
          value={loading ? '...' : activeSockets}
          subtext="Across all aliases"
          icon={<Cpu className="w-4 h-4 text-emerald-400" />}
        />
        <TelemetryCard
          title="WAF / RATE DROPS"
          value={loading ? '...' : rateLimitDrops}
          subtext="Blocked violations"
          icon={<ShieldAlert className="w-4 h-4 text-amber-400" />}
        />
      </div>

      {/* Raw Prometheus Exposition Collapsible */}
      <div className="rounded-lg border border-[#222222] bg-[#0c0c0c] overflow-hidden">
        <div
          onClick={() => setShowRaw(!showRaw)}
          className="px-4 py-3 border-b border-[#222222] bg-[#0e0e0e] flex items-center justify-between cursor-pointer select-none"
        >
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-[#f38020]" />
            <h2 className="text-xs font-semibold text-white  ">
              Raw Prometheus Exposition (/metrics)
            </h2>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                copyMetrics();
              }}
              className="h-7 text-xs"
            >
              {hasCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{hasCopied ? 'Copied' : 'Copy'}</span>
            </Button>
            {showRaw ? <ChevronUp className="w-4 h-4 text-[#8c8c8c]" /> : <ChevronDown className="w-4 h-4 text-[#8c8c8c]" />}
          </div>
        </div>

        {showRaw && (
          <div className="p-4 bg-[#050505]">
            <pre className="p-3 rounded bg-[#090909] border border-[#1e1e1e]  text-xs text-[#a1a1a1] overflow-x-auto max-h-[480px]">
              {rawMetrics || 'Scraping metrics endpoint...'}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};
