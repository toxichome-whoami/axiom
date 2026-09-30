import React from 'react';
import { TelemetryCard, formatTimeFromPct } from '../components/shared/TelemetryCard';
import { Button } from '../components/ui/Button';
import { Activity, ExternalLink, RefreshCw, Zap, Server, ShieldCheck } from 'lucide-react';

export function Metrics() {
  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-[16px] font-semibold text-white tracking-tight">Metrics</h1>
        </div>
        <div className="flex items-center gap-2.5">
          <a
            href="/metrics"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-medium border border-[#262626] bg-[#141415] hover:bg-[#1a1a1c] text-white transition-colors"
          >
            <span>Prometheus /metrics</span>
            <ExternalLink className="w-3.5 h-3.5 text-[#8c8c8c]" />
          </a>
        </div>
      </div>

      {/* Primary KPI Telemetry Cards with Bezier SVG Charts */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <TelemetryCard
          title="24h Gateway Throughput"
          value="1.42M req"
          subLabel="peak 2,140/s"
          badge={{ text: '+14.2%', icon: 'up', color: '#2f80ed' }}
          gradientId="met-throughput"
          strokeColor="#2f80ed"
          pathD="M 0,110 C 150,90 300,50 450,60 C 600,70 750,25 1000,40"
          yAxisLabels={['2.5k', '1.5k', '500', '0']}
          tooltipMetricName="Throughput"
          onHoverCompute={(pct, _svgX, exactYPct) => {
            const norm = exactYPct !== undefined ? Math.max(0, Math.min(1, (116 - exactYPct * 130) / 102)) : pct;
            const val = Math.round(1100 + norm * 1050);
            return {
              pct,
              yPct: exactYPct ?? 0.38,
              time: formatTimeFromPct(pct),
              value: `${val.toLocaleString()} req/s`,
            };
          }}
        />

        <TelemetryCard
          title="p50 Pipeline Latency"
          value="0.68 ms"
          subLabel="AST + Pool"
          badge={{ text: 'Sub-ms', icon: 'none', color: '#8c8c8c' }}
          gradientId="met-p50"
          strokeColor="#2f80ed"
          pathD="M 0,70 C 200,65 400,68 600,55 C 800,58 900,48 1000,50"
          yAxisLabels={['1.5ms', '1.0ms', '0.5ms', '0ms']}
          tooltipMetricName="p50 Latency"
          onHoverCompute={(pct, _svgX, exactYPct) => {
            const norm = exactYPct !== undefined ? Math.max(0, Math.min(1, (116 - exactYPct * 130) / 102)) : 0.5;
            const val = (0.45 + norm * 0.55).toFixed(2);
            return {
              pct,
              yPct: exactYPct ?? 0.42,
              time: formatTimeFromPct(pct),
              value: `${val} ms`,
            };
          }}
        />

        <TelemetryCard
          title="p99 Pipeline Latency"
          value="2.84 ms"
          subLabel="Zero GC pause"
          badge={{ text: '-4.6%', icon: 'down', color: '#2f80ed' }}
          gradientId="met-p99"
          strokeColor="#2f80ed"
          pathD="M 0,95 C 200,90 400,80 600,70 C 800,65 900,55 1000,60"
          yAxisLabels={['5.0ms', '3.0ms', '1.5ms', '0ms']}
          tooltipMetricName="p99 Latency"
          onHoverCompute={(pct, _svgX, exactYPct) => {
            const norm = exactYPct !== undefined ? Math.max(0, Math.min(1, (116 - exactYPct * 130) / 102)) : 0.5;
            const val = (1.5 + norm * 2.5).toFixed(2);
            return {
              pct,
              yPct: exactYPct ?? 0.52,
              time: formatTimeFromPct(pct),
              value: `${val} ms`,
            };
          }}
        />

        <TelemetryCard
          title="Resident Memory (RSS)"
          value="18.4 MB"
          subLabel="mimalloc active"
          badge={{ text: 'Lean Profile', icon: 'none', color: '#8c8c8c' }}
          gradientId="met-mem"
          strokeColor="#2f80ed"
          pathD="M 0,55 C 250,54 500,53 750,52 C 900,52 950,51 1000,50"
          yAxisLabels={['30M', '20M', '10M', '0M']}
          tooltipMetricName="Memory RSS"
          onHoverCompute={(pct, _svgX, exactYPct) => ({
            pct,
            yPct: exactYPct ?? 0.45,
            time: formatTimeFromPct(pct),
            value: '18.4 MB',
          })}
        />
      </div>

      {/* Latency & Status Distribution Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Latency Buckets */}
        <div className="rounded-lg border border-[#222222] bg-[#0e0e0e] p-5 space-y-4">
          <div className="border-b border-[#222222] pb-3">
            <h2 className="text-[14px] font-semibold text-white">Execution Latency Buckets</h2>
            <p className="text-[12px] text-[#8c8c8c] mt-0.5">Execution distribution across all data plane routes</p>
          </div>
          <div className="space-y-3.5 text-[12px]">
            <div>
              <div className="flex justify-between mb-1.5 text-white">
                <span className="text-[#cccccc]">&lt; 1 ms (L1 Cache / Hot Pipeline)</span>
                <span className="tabular-nums text-[#3b82f6] font-medium">86.4%</span>
              </div>
              <div className="h-1.5 rounded-full bg-[#1a1a1a] overflow-hidden">
                <div className="h-full bg-[#3b82f6] rounded-full" style={{ width: '86.4%' }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between mb-1.5 text-white">
                <span className="text-[#cccccc]">1 – 5 ms (Local Engine Queries)</span>
                <span className="tabular-nums text-[#30a46c] font-medium">10.8%</span>
              </div>
              <div className="h-1.5 rounded-full bg-[#1a1a1a] overflow-hidden">
                <div className="h-full bg-[#30a46c] rounded-full" style={{ width: '10.8%' }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between mb-1.5 text-white">
                <span className="text-[#cccccc]">5 – 20 ms (Complex Analytical Queries)</span>
                <span className="tabular-nums text-[#f59e0b] font-medium">2.4%</span>
              </div>
              <div className="h-1.5 rounded-full bg-[#1a1a1a] overflow-hidden">
                <div className="h-full bg-[#f59e0b] rounded-full" style={{ width: '2.4%' }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between mb-1.5 text-white">
                <span className="text-[#cccccc]">&gt; 20 ms (Table Introspections)</span>
                <span className="tabular-nums text-[#e5484d] font-medium">0.4%</span>
              </div>
              <div className="h-1.5 rounded-full bg-[#1a1a1a] overflow-hidden">
                <div className="h-full bg-[#e5484d] rounded-full" style={{ width: '0.4%' }} />
              </div>
            </div>
          </div>
        </div>

        {/* HTTP Status Code Breakdown */}
        <div className="rounded-lg border border-[#222222] bg-[#0e0e0e] p-5 space-y-4">
          <div className="border-b border-[#222222] pb-3">
            <h2 className="text-[14px] font-semibold text-white">HTTP Status Code Distribution (24h)</h2>
            <p className="text-[12px] text-[#8c8c8c] mt-0.5">Classification breakdown across edge ingress traffic</p>
          </div>
          <div className="space-y-3.5 text-[12px]">
            <div>
              <div className="flex justify-between mb-1.5 text-white">
                <span className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-[#30a46c]" />
                  <span className="text-[#cccccc]">2xx Success (200 OK, 201 Created)</span>
                </span>
                <span className="tabular-nums text-white font-normal">1,418,220 (99.8%)</span>
              </div>
              <div className="h-1.5 rounded-full bg-[#1a1a1a] overflow-hidden">
                <div className="h-full bg-[#30a46c] rounded-full" style={{ width: '99.8%' }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between mb-1.5 text-white">
                <span className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-[#f59e0b]" />
                  <span className="text-[#cccccc]">4xx Client Errors (WAF blocked / Bad Auth)</span>
                </span>
                <span className="tabular-nums text-white font-normal">2,710 (0.19%)</span>
              </div>
              <div className="h-1.5 rounded-full bg-[#1a1a1a] overflow-hidden">
                <div className="h-full bg-[#f59e0b] rounded-full" style={{ width: '1.9%' }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between mb-1.5 text-white">
                <span className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-[#e5484d]" />
                  <span className="text-[#cccccc]">5xx Gateway Failures (Timeout / Saturation)</span>
                </span>
                <span className="tabular-nums text-white font-normal">20 (0.01%)</span>
              </div>
              <div className="h-1.5 rounded-full bg-[#1a1a1a] overflow-hidden">
                <div className="h-full bg-[#e5484d] rounded-full" style={{ width: '0.2%' }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
