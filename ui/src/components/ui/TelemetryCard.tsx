/*
 * TelemetryCard component displaying metric values with optional micro sparklines.
 * Handles boundary conditions (empty, single-item sparklines) without NaN coordinates.
 * Invariant: Renders numeric/string metrics with standard monospace styling and trend deltas.
 */

import React from 'react';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';

interface TelemetryCardProps {
  title: string;
  value: string | number;
  change?: string;
  isPositive?: boolean;
  subtext?: string;
  icon?: React.ReactNode;
  sparkline?: number[];
}

export const TelemetryCard: React.FC<TelemetryCardProps> = ({
  title,
  value,
  change,
  isPositive = true,
  subtext,
  icon,
  sparkline = [],
}) => {
  // Guard against empty or single-point sparkline arrays which would divide by zero
  const hasSparkline = Array.isArray(sparkline) && sparkline.length > 1;
  let points = '';

  if (hasSparkline) {
    const min = Math.min(...sparkline);
    const max = Math.max(...sparkline);
    const range = max - min || 1;
    const height = 24;
    const width = 80;

    points = sparkline
      .map((val, idx) => {
        const x = (idx / (sparkline.length - 1)) * width;
        const y = height - ((val - min) / range) * (height - 4) - 2;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }

  return (
    <div className="rounded-lg border border-[#222222] bg-[#0c0c0c] p-4 flex flex-col justify-between hover:border-[#333333] transition-colors relative overflow-hidden">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[12px] font-medium text-[#8c8c8c]">{title}</span>
        {icon && <div className="text-[#666666]">{icon}</div>}
      </div>

      <div className="flex items-baseline justify-between gap-2 my-1">
        <div className="text-2xl font-bold tracking-tight text-white font-mono">{value}</div>
        {hasSparkline && points && (
          <svg className="w-20 h-6 shrink-0 overflow-visible" viewBox="0 0 80 24">
            <polyline
              fill="none"
              stroke="#f38020"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={points}
            />
          </svg>
        )}
      </div>

      <div className="flex items-center justify-between mt-1 text-[11px]">
        {change && (
          <div
            className={`inline-flex items-center gap-0.5 font-medium ${
              isPositive ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {isPositive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
            <span>{change}</span>
          </div>
        )}
        {subtext && <span className="text-[#666666] ml-auto">{subtext}</span>}
      </div>
    </div>
  );
};
