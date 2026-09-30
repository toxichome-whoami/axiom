import React, { useState, useRef } from 'react';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';

export interface TelemetryHoverData {
  pct: number;
  yPct: number;
  time: string;
  value: string;
}

export interface TelemetryCardProps {
  title: string;
  value: string | number;
  badge?: {
    text: string;
    icon?: 'up' | 'down' | 'none';
    color?: string;
    mlAuto?: boolean;
  };
  subLabel?: string;
  onMenuClick?: (e: React.MouseEvent) => void;
  onClick?: () => void;
  className?: string;

  // Chart Properties
  gradientId: string;
  strokeColor: string;
  gradientColor?: string;
  pathD: string;
  fillD?: string;
  yAxisLabels?: (string | number)[];
  tooltipMetricName?: string;
  onHoverCompute?: (pct: number, svgX: number, exactYPct?: number) => TelemetryHoverData | null;
  noData?: boolean;
  noDataId?: string;
}

export function formatTimeFromPct(pct: number): string {
  const now = new Date();
  const pointTime = new Date(now.getTime() - (1 - pct) * 24 * 60 * 60 * 1000);
  const day = pointTime.getDate();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
  const month = months[pointTime.getMonth()];
  const hh = String(pointTime.getHours()).padStart(2, '0');
  const mm = String(pointTime.getMinutes()).padStart(2, '0');
  const ss = String(pointTime.getSeconds()).padStart(2, '0');
  return `${day} ${month}, ${hh}:${mm}:${ss}`;
}

export function cubicBezierY(
  targetX: number,
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number]
): number {
  let low = 0;
  let high = 1;
  let t = 0.5;
  for (let i = 0; i < 16; i++) {
    t = (low + high) / 2;
    const inv = 1 - t;
    const x =
      inv * inv * inv * p0[0] +
      3 * inv * inv * t * p1[0] +
      3 * inv * t * t * p2[0] +
      t * t * t * p3[0];
    if (x < targetX) {
      low = t;
    } else {
      high = t;
    }
  }
  const inv = 1 - t;
  return (
    inv * inv * inv * p0[1] +
    3 * inv * inv * t * p1[1] +
    3 * inv * t * t * p2[1] +
    t * t * t * p3[1]
  );
}

const WAVY_NO_DATA_PATH =
  'M0.00,54.82 L6.67,53.35 L13.33,55.07 L20.00,57.95 L26.67,60.06 L33.33,60.51 L40.00,59.77 L46.67,59.19 L53.33,60.07 L60.00,62.86 L66.67,66.84 L73.33,70.51 L80.00,72.48 L86.67,72.25 L93.33,70.57 L100.00,69.07 L106.67,69.27 L113.33,71.71 L120.00,75.41 L126.67,78.20 L133.33,77.76 L140.00,72.80 L146.67,63.93 L153.33,53.59 L160.00,45.16 L166.67,41.60 L173.33,44.14 L180.00,51.81 L186.67,61.85 L193.33,70.97 L200.00,76.66 L206.67,78.13 L213.33,76.41 L220.00,73.53 L226.67,71.42 L233.33,70.97 L240.00,71.71 L246.67,72.29 L253.33,71.41 L260.00,68.62 L266.67,64.64 L273.33,60.97 L280.00,59.00 L286.67,59.23 L293.33,60.91 L300.00,62.41 L306.67,62.21 L313.33,59.77 L320.00,56.07 L326.67,53.28 L333.33,53.72 L340.00,58.68 L346.67,67.55 L353.33,77.89 L360.00,86.32 L366.67,89.88 L373.33,87.34 L380.00,79.67 L386.67,69.63 L393.33,60.51 L400.00,54.82';

export const TelemetryCard: React.FC<TelemetryCardProps> = ({
  title,
  value,
  badge,
  subLabel,
  onMenuClick,
  onClick,
  className = '',
  gradientId,
  strokeColor,
  gradientColor,
  pathD,
  fillD,
  yAxisLabels = ['250', '150', '50', '0'],
  tooltipMetricName,
  onHoverCompute,
  noData = false,
  noDataId = 'nodata',
}) => {
  const [hoverData, setHoverData] = useState<TelemetryHoverData | null>(null);
  const pathRef = useRef<SVGPathElement>(null);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onHoverCompute || noData) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const pct = x / rect.width;
    const svgX = pct * 1000;

    let calculatedYPct: number | null = null;
    if (pathRef.current && typeof pathRef.current.getTotalLength === 'function') {
      try {
        const totalLen = pathRef.current.getTotalLength();
        if (totalLen > 0) {
          const startPt = pathRef.current.getPointAtLength(0);
          const endPt = pathRef.current.getPointAtLength(totalLen);
          if (svgX <= startPt.x) {
            calculatedYPct = startPt.y / 130;
          } else if (svgX >= endPt.x) {
            calculatedYPct = endPt.y / 130;
          } else {
            let low = 0;
            let high = totalLen;
            for (let i = 0; i < 18; i++) {
              const mid = (low + high) / 2;
              const pt = pathRef.current.getPointAtLength(mid);
              if (pt.x < svgX) {
                low = mid;
              } else {
                high = mid;
              }
            }
            const pt = pathRef.current.getPointAtLength((low + high) / 2);
            calculatedYPct = pt.y / 130;
          }
        }
      } catch {
        // fallback
      }
    }

    const computed = onHoverCompute(pct, svgX, calculatedYPct ?? undefined);
    if (computed) {
      setHoverData({
        ...computed,
        pct,
        yPct: calculatedYPct !== null ? calculatedYPct : computed.yPct,
      });
    }
  };

  const gColor = gradientColor || strokeColor;
  const effectiveFillD = fillD || `${pathD} L 1000,126 L 0,126 Z`;

  return (
    <div
      className={`analytics-card relative flex flex-col justify-between rounded-[8px] bg-[#0e0e0e] border border-[#222222] hover:border-[#383838] transition-colors h-[241px] overflow-hidden group select-none ${
        onClick ? 'cursor-pointer' : ''
      } ${className}`}
      onClick={onClick}
    >
      {/* Header */}
      <div className="p-4 pb-0">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-normal text-[#8c8c8c] group-hover:text-[#cccccc] transition-colors font-sans">
            {title}
          </span>
          {onMenuClick && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                onMenuClick(e);
              }}
              className="text-[#555555] hover:text-gray-300 text-[12px] cursor-pointer font-bold leading-none p-1 rounded hover:bg-[#1a1a1a] transition-colors"
            >
              •••
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-2 mt-1">
          <span className="text-[26px] font-semibold text-white tracking-[-0.02em] leading-tight font-sans tabular-nums">
            {value}
          </span>
          {subLabel && (
            <span className="text-[12px] text-[#8c8c8c] font-sans">
              {subLabel}
            </span>
          )}
          {badge && (
            <span
              className={`text-[12px] font-medium flex items-center gap-0.5 font-sans ${badge.mlAuto ? 'ml-auto' : ''}`}
              style={{ color: badge.color || (badge.icon === 'down' ? '#f59e0b' : '#30a46c') }}
            >
              {badge.icon === 'down' ? (
                <ArrowDownRight className="w-3.5 h-3.5 shrink-0" />
              ) : badge.icon === 'none' ? null : (
                <ArrowUpRight className="w-3.5 h-3.5 shrink-0" />
              )}
              <span>{badge.text}</span>
            </span>
          )}
        </div>
      </div>

      {/* Chart Section */}
      {noData ? (
        <div className="relative w-full h-[160px] mt-auto flex items-end justify-center overflow-hidden">
          <svg
            aria-hidden="true"
            width="100%"
            height="100%"
            viewBox="0 0 400 173"
            preserveAspectRatio="none"
            className="block w-full h-full"
          >
            <defs>
              <linearGradient id={`kumo-nodata-fill-${noDataId}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#5C5C5C" stopOpacity="0.2" />
                <stop offset="100%" stopColor="#5C5C5C" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            <path
              d={`${WAVY_NO_DATA_PATH} L400,173 L0,173 Z`}
              fill={`url(#kumo-nodata-fill-${noDataId})`}
              stroke="none"
            />
            <path
              d={WAVY_NO_DATA_PATH}
              fill="none"
              stroke="#5C5C5C"
              strokeOpacity="0.45"
              strokeWidth="1.2"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <div className="pointer-events-none absolute left-1/2 top-[40%] -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-[#141414] px-2.5 py-0.5 text-[11px] font-medium text-[#8c8c8c] border border-[#262626] font-sans">
            No data
          </div>
          <span className="absolute bottom-1 right-1 pointer-events-none opacity-40">
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" fill="currentColor" viewBox="0 0 256 256" className="text-[#555555]">
              <path d="M216.49,136.49l-80,80a12,12,0,1,1-17-17l80-80a12,12,0,1,1,17,17Zm-16-105a12,12,0,0,0-17,0l-152,152a12,12,0,0,0,17,17l152-152A12,12,0,0,0,200.49,31.51Z" />
            </svg>
          </span>
        </div>
      ) : (
        <div className="chart-graph-container relative w-full h-[155px] mt-auto select-none flex items-stretch pl-4 pr-3 overflow-hidden">
          <div
            className="chart-canvas relative flex-1 h-full cursor-crosshair overflow-visible"
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHoverData(null)}
          >
            <svg className="w-full h-full block" viewBox="0 0 1000 130" preserveAspectRatio="none">
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={gColor} stopOpacity="0.25" />
                  <stop offset="100%" stopColor={gColor} stopOpacity="0.0" />
                </linearGradient>
              </defs>
              <line className="chart-grid-line" x1="0" y1="14" x2="1000" y2="14" stroke="#1c1c1c" strokeWidth="1" />
              <line className="chart-grid-line" x1="0" y1="48" x2="1000" y2="48" stroke="#1c1c1c" strokeWidth="1" />
              <line className="chart-grid-line" x1="0" y1="82" x2="1000" y2="82" stroke="#1c1c1c" strokeWidth="1" />
              <line className="chart-grid-line" x1="0" y1="116" x2="1000" y2="116" stroke="#262626" strokeWidth="1" />

              <path
                d={effectiveFillD}
                fill={`url(#${gradientId})`}
                stroke="none"
              />
              <path
                ref={pathRef}
                d={pathD}
                fill="none"
                stroke={strokeColor}
                strokeWidth="1.8"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>

            {/* Tracking Guideline & Circular Riding Dot */}
            {hoverData && (
              <div className="chart-hover-overlay pointer-events-none">
                <div
                  className="absolute top-[10.8%] bottom-[10.8%] w-px border-r border-dashed border-[#666666] -translate-x-1/2 pointer-events-none z-10"
                  style={{ left: `${hoverData.pct * 100}%` }}
                />
                <div
                  className="absolute w-2.5 h-2.5 rounded-full border-[1.5px] border-white shadow-md pointer-events-none z-20 -translate-x-1/2 -translate-y-1/2"
                  style={{
                    left: `${hoverData.pct * 100}%`,
                    top: `${hoverData.yPct * 100}%`,
                    backgroundColor: strokeColor,
                  }}
                />
                <div
                  className={`absolute pointer-events-none z-30 select-none ${
                    hoverData.pct > 0.5 ? '-translate-x-full pr-3' : 'pl-3'
                  }`}
                  style={{ left: `${hoverData.pct * 100}%`, top: '16px' }}
                >
                  <div className="bg-[#121212] rounded-lg shadow-2xl shadow-black/80 border border-[#2a2a2a] p-2.5 min-w-[145px] max-w-xs font-sans">
                    <div className="text-[11px] font-normal text-white mb-1 tabular-nums font-sans">
                      {hoverData.time}
                    </div>
                    <div className="flex items-center justify-between gap-3 py-0.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: strokeColor }}
                        />
                        <span className="text-[12px] font-normal text-[#d4d4d8] truncate font-sans">
                          {tooltipMetricName || title}
                        </span>
                      </div>
                      <span className="text-[12px] font-normal text-white shrink-0 tabular-nums font-sans">
                        {hoverData.value}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Y-Axis Labels */}
          {yAxisLabels && yAxisLabels.length > 0 && (
            <div className="chart-y-axis relative shrink-0 pl-2.5 text-[11px] text-[#8c8c8c] text-right font-normal pointer-events-none select-none tabular-nums flex flex-col justify-between pt-[10px] pb-[10px] font-sans">
              {yAxisLabels.map((lbl, idx) => (
                <span key={idx}>{lbl}</span>
              ))}
            </div>
          )}

          {/* Resize notch */}
          <span className="absolute bottom-1 right-1 pointer-events-none opacity-40">
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" fill="currentColor" viewBox="0 0 256 256" className="text-[#555555]">
              <path d="M216.49,136.49l-80,80a12,12,0,1,1-17-17l80-80a12,12,0,1,1,17,17Zm-16-105a12,12,0,0,0-17,0l-152,152a12,12,0,0,0,17,17l152-152A12,12,0,0,0,200.49,31.51Z" />
            </svg>
          </span>
        </div>
      )}
    </div>
  );
};
