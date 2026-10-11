/*
 * Supabase Studio-style Interactive ER Diagram & Schema Visualizer Canvas.
 * Owned by: ui/pages/table
 * Key features:
 * - Dot-grid interactive panning & zooming canvas
 * - Table entity nodes with header icon, column names, icons (PK, Unique, Nullable), and data types
 * - Orthogonal SVG connection paths between foreign key source and target columns
 * - Auto-layout algorithm arranging nodes in dependency layers
 * - Schema selector dropdown & table search filter in top bar
 * - Copy as SQL dropdown (PostgreSQL, SQLite, MySQL)
 * - Minimap radar in the bottom right corner showing viewport and node positions
 * - Legend footer showing column constraint symbols (Primary key, Identity, Unique, Nullable, Non-Nullable)
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Key,
  Hash,
  Sparkles,
  MoreVertical,
  LayoutGrid,
} from 'lucide-react';
import { TableInfoApi, ColumnInfoApi, ForeignKeyInfoApi } from '../../types';
import { formatColumnType } from './format';

export interface SchemaViewProps {
  selectedDb: string;
  selectedTable: string;
  tables: TableInfoApi[];
  columns: ColumnInfoApi[];
  foreignKeys: ForeignKeyInfoApi[];
  allDbTablesSchema: Record<string, { columns: ColumnInfoApi[]; foreign_keys?: ForeignKeyInfoApi[] }>;
  copiedKey: string | null;
  handleCopy: (text: string, key: string) => void;
  onSelectTable: (tableName: string) => void;
  searchTerm?: string;
  transform: { x: number; y: number; scale: number };
  setTransform: React.Dispatch<React.SetStateAction<{ x: number; y: number; scale: number }>>;
  autoLayoutTrigger?: number;
  onEditTable?: (tableName: string) => void;
  onEditColumn?: (tableName: string, col: ColumnInfoApi) => void;
  onViewInTableEditor?: (tableName: string) => void;
}

interface TablePosition {
  x: number;
  y: number;
}

const CARD_WIDTH = 290;
const HEADER_OFFSET = 59; // Card padding (10px) + Header (40px) + Header margin-bottom (8px) + Inset border (1px)
const ROW_HEIGHT = 33;    // Row height (32px) + Divider border (1px)

export function SchemaView({
  selectedDb,
  selectedTable,
  tables,
  allDbTablesSchema,
  copiedKey,
  handleCopy,
  onSelectTable,
  searchTerm = '',
  transform,
  setTransform,
  autoLayoutTrigger,
  onEditTable,
  onEditColumn,
  onViewInTableEditor,
}: SchemaViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Table node header action menu state
  const [activeTableMenu, setActiveTableMenu] = useState<{
    tableName: string;
    rect: { top: number; left: number; width: number; height: number };
  } | null>(null);
  const tableMenuRef = useRef<HTMLDivElement>(null);

  // Column row action menu state
  const [activeColumnMenu, setActiveColumnMenu] = useState<{
    tableName: string;
    column: ColumnInfoApi;
    rect: { top: number; left: number; width: number; height: number };
  } | null>(null);
  const columnMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeTableMenu && !activeColumnMenu) return;
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (tableMenuRef.current && !tableMenuRef.current.contains(target)) {
        setActiveTableMenu(null);
      }
      if (columnMenuRef.current && !columnMenuRef.current.contains(target)) {
        setActiveColumnMenu(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveTableMenu(null);
        setActiveColumnMenu(null);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleKey);
    };
  }, [activeTableMenu, activeColumnMenu]);

  // Canvas Viewport transform: pan state
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number; y: number; startTx: number; startTy: number } | null>(null);

  // Click-and-hold inspection state: animates dashed lines flowing along path only while mouse is pressed
  const [holdingTable, setHoldingTable] = useState<string | null>(null);
  const [holdingLineId, setHoldingLineId] = useState<string | null>(null);

  // Dragging individual table nodes
  const [nodePositions, setNodePositions] = useState<Record<string, TablePosition>>({});
  const [draggingNode, setDraggingNode] = useState<{
    tableName: string;
    startX: number;
    startY: number;
    initialPos: TablePosition;
  } | null>(null);

  // Compute table heights
  const getTableHeight = useCallback(
    (tableName: string) => {
      const cols = allDbTablesSchema[tableName]?.columns || [];
      return HEADER_OFFSET + Math.max(cols.length, 1) * ROW_HEIGHT + 14;
    },
    [allDbTablesSchema]
  );

  // Auto-layout computation (topological layer layout)
  const computeAutoLayout = useCallback(() => {
    const tableNames = tables.map((t) => t.name);
    if (tableNames.length === 0) return;

    // Build adjacency list for dependency levels
    const inDegree: Record<string, number> = {};
    const adj: Record<string, string[]> = {};
    tableNames.forEach((name) => {
      inDegree[name] = 0;
      adj[name] = [];
    });

    tableNames.forEach((name) => {
      const fks = allDbTablesSchema[name]?.foreign_keys || [];
      fks.forEach((fk) => {
        if (tableNames.includes(fk.referenced_table) && fk.referenced_table !== name) {
          adj[fk.referenced_table].push(name);
          inDegree[name] = (inDegree[name] || 0) + 1;
        }
      });
    });

    // Assign columns/layers
    const layers: string[][] = [];
    const assigned = new Set<string>();

    const totalFkCount = Object.values(allDbTablesSchema).reduce(
      (sum, s) => sum + (s?.foreign_keys?.length || 0),
      0
    );

    // If there are no foreign key relationships yet (or schemas are standalone),
    // lay out in a clean 3-4 column grid rather than stacking all tables in 1 giant vertical column!
    if (totalFkCount === 0) {
      const COLS = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(tableNames.length))));
      const newPositions: Record<string, TablePosition> = {};
      const layerSpacingX = 380;
      const colCurrentY: number[] = new Array(COLS).fill(60);

      tableNames.forEach((tableName) => {
        // Pick the column with minimum current height
        let shortestCol = 0;
        for (let c = 1; c < COLS; c++) {
          if (colCurrentY[c] < colCurrentY[shortestCol]) {
            shortestCol = c;
          }
        }

        newPositions[tableName] = {
          x: 60 + shortestCol * layerSpacingX,
          y: colCurrentY[shortestCol],
        };
        colCurrentY[shortestCol] += getTableHeight(tableName) + 36;
      });

      setNodePositions(newPositions);
      setTransform({ x: 40, y: 40, scale: 0.9 });
      return;
    }

    let currentLayer = tableNames.filter((name) => inDegree[name] === 0);
    if (currentLayer.length === 0) {
      currentLayer = [tableNames[0]];
    }

    while (currentLayer.length > 0 && assigned.size < tableNames.length) {
      layers.push(currentLayer);
      currentLayer.forEach((n) => assigned.add(n));

      const nextLayerSet = new Set<string>();
      currentLayer.forEach((parent) => {
        adj[parent]?.forEach((child) => {
          if (!assigned.has(child)) {
            nextLayerSet.add(child);
          }
        });
      });

      // Catch unconnected leftovers if any
      if (nextLayerSet.size === 0 && assigned.size < tableNames.length) {
        const remaining = tableNames.filter((n) => !assigned.has(n));
        if (remaining.length > 0) {
          nextLayerSet.add(remaining[0]);
        }
      }

      currentLayer = Array.from(nextLayerSet);
    }

    // Place each layer
    const newPositions: Record<string, TablePosition> = {};
    const layerSpacingX = 390;
    const itemSpacingY = 32;

    layers.forEach((layerTables, layerIdx) => {
      let currentY = 60;
      layerTables.forEach((tableName) => {
        newPositions[tableName] = {
          x: 60 + layerIdx * layerSpacingX,
          y: currentY,
        };
        currentY += getTableHeight(tableName) + itemSpacingY;
      });
    });

    // Fill in any missed tables
    tableNames.forEach((name, i) => {
      if (!newPositions[name]) {
        newPositions[name] = {
          x: 60 + (i % 3) * layerSpacingX,
          y: 60 + Math.floor(i / 3) * 320,
        };
      }
    });

    setNodePositions(newPositions);
    setTransform({ x: 40, y: 40, scale: 0.9 });
  }, [tables, allDbTablesSchema, getTableHeight, setTransform]);

  // Initial layout run and re-layout whenever schema relationships arrive
  const prevSchemaCountRef = useRef(0);
  useEffect(() => {
    const loadedCount = Object.keys(allDbTablesSchema).length;
    const hasPositions = Object.keys(nodePositions).length > 0;

    if (tables.length > 0) {
      if (!hasPositions || (prevSchemaCountRef.current < tables.length && loadedCount >= tables.length)) {
        computeAutoLayout();
      }
    }
    prevSchemaCountRef.current = loadedCount;
  }, [tables, allDbTablesSchema, nodePositions, computeAutoLayout]);

  // Auto layout trigger from parent toolbar
  useEffect(() => {
    if (autoLayoutTrigger && autoLayoutTrigger > 0) {
      computeAutoLayout();
    }
  }, [autoLayoutTrigger, computeAutoLayout]);

  // Ref tracking for active drag & pan to avoid stale closures in window event listeners
  const draggingNodeRef = useRef<{
    tableName: string;
    startX: number;
    startY: number;
    initialPos: TablePosition;
  } | null>(null);

  const isPanningRef = useRef(false);
  const panMovedRef = useRef(false);
  const transformRef = useRef(transform);
  transformRef.current = transform;
  const onSelectTableRef = useRef(onSelectTable);
  onSelectTableRef.current = onSelectTable;

  // Global window mousemove & mouseup listeners so dragging or panning never gets stuck
  useEffect(() => {
    const onWindowMouseMove = (e: MouseEvent) => {
      if (draggingNodeRef.current) {
        const currentScale = transformRef.current.scale || 1;
        const dx = (e.clientX - draggingNodeRef.current.startX) / currentScale;
        const dy = (e.clientY - draggingNodeRef.current.startY) / currentScale;
        const targetTableName = draggingNodeRef.current.tableName;
        const initPos = draggingNodeRef.current.initialPos;

        setNodePositions((prev) => ({
          ...prev,
          [targetTableName]: {
            x: Math.round(initPos.x + dx),
            y: Math.round(initPos.y + dy),
          },
        }));
        return;
      }

      if (isPanningRef.current && panStartRef.current) {
        const dx = e.clientX - panStartRef.current.x;
        const dy = e.clientY - panStartRef.current.y;
        if (Math.hypot(dx, dy) > 4) {
          panMovedRef.current = true;
        }
        setTransform({
          scale: transformRef.current.scale,
          x: Math.round(panStartRef.current.startTx + dx),
          y: Math.round(panStartRef.current.startTy + dy),
        });
      }
    };

    const onWindowMouseUp = () => {
      // Clear click-and-hold line animation and table focus
      setHoldingTable(null);
      setHoldingLineId(null);

      if (isPanningRef.current && !panMovedRef.current) {
        onSelectTableRef.current('');
      }

      if (draggingNodeRef.current || isPanningRef.current) {
        draggingNodeRef.current = null;
        isPanningRef.current = false;
        panStartRef.current = null;
        setDraggingNode(null);
        setIsPanning(false);
      }
    };

    window.addEventListener('mousemove', onWindowMouseMove, { passive: true });
    window.addEventListener('mouseup', onWindowMouseUp);

    return () => {
      window.removeEventListener('mousemove', onWindowMouseMove);
      window.removeEventListener('mouseup', onWindowMouseUp);
    };
  }, []);

  // Canvas Panning Handlers
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    // Only pan if left click on canvas background (not on a card or button)
    if (e.button !== 0) return;
    setIsPanning(true);
    isPanningRef.current = true;
    panMovedRef.current = false;
    panStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      startTx: transform.x,
      startTy: transform.y,
    };
  };

  // Zoom on wheel (clamped to prevent NaN or extreme scales)
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
    const newScale = Math.min(Math.max(0.3, Number((transform.scale * zoomFactor).toFixed(3))), 2.2);

    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      setTransform((prev) => {
        const ratio = newScale / prev.scale;
        return {
          scale: newScale,
          x: Math.round(mouseX - (mouseX - prev.x) * ratio),
          y: Math.round(mouseY - (mouseY - prev.y) * ratio),
        };
      });
    }
  };

  // Filtered tables for search
  const filteredTableNames = useMemo(() => {
    if (!searchTerm.trim()) return tables.map((t) => t.name);
    return tables
      .filter((t) => t.name.toLowerCase().includes(searchTerm.toLowerCase()))
      .map((t) => t.name);
  }, [tables, searchTerm]);

  // Compute all relationships / connection lines
  const relations = useMemo(() => {
    const list: Array<{
      id: string;
      sourceTable: string;
      sourceCol: string;
      targetTable: string;
      targetCol: string;
      startX: number;
      startY: number;
      endX: number;
      endY: number;
      isSelf: boolean;
    }> = [];

    tables.forEach((t) => {
      const tData = allDbTablesSchema[t.name];
      if (!tData || !tData.foreign_keys) return;

      const sourcePos = nodePositions[t.name];
      if (!sourcePos) return;

      tData.foreign_keys.forEach((fk, idx) => {
        const targetPos = nodePositions[fk.referenced_table];
        if (!targetPos) return;

        const sourceColIdx = tData.columns.findIndex((c) => c.name === fk.column);
        const targetCols = allDbTablesSchema[fk.referenced_table]?.columns || [];
        const targetColIdx = targetCols.findIndex((c) => c.name === fk.referenced_column);

        // Calculate exact vertical center of the row:
        // HEADER_OFFSET (59px) + colIdx * ROW_HEIGHT (33px) + row center (16px)
        const sourceYOffset = HEADER_OFFSET + Math.max(0, sourceColIdx) * ROW_HEIGHT + 16;
        const targetYOffset = HEADER_OFFSET + Math.max(0, targetColIdx) * ROW_HEIGHT + 16;

        const startY = sourcePos.y + sourceYOffset;
        const endY = targetPos.y + targetYOffset;

        const isSelf = t.name === fk.referenced_table;
        let startX: number;
        let endX: number;

        if (isSelf) {
          // Self-referencing FK (e.g. employees.manager_id -> employees.id)
          // Both attach to the left edge of the table and loop smoothly outside to the left!
          startX = sourcePos.x;
          endX = sourcePos.x;
        } else {
          // Choose attach side: right side if target is to the right, left side if target is to the left
          const sourceIsLeftOfTarget = sourcePos.x < targetPos.x;
          startX = sourceIsLeftOfTarget ? sourcePos.x + CARD_WIDTH : sourcePos.x;
          endX = sourceIsLeftOfTarget ? targetPos.x : targetPos.x + CARD_WIDTH;
        }

        list.push({
          id: `${t.name}.${fk.column}->${fk.referenced_table}.${fk.referenced_column}_${idx}`,
          sourceTable: t.name,
          sourceCol: fk.column,
          targetTable: fk.referenced_table,
          targetCol: fk.referenced_column,
          startX,
          startY,
          endX,
          endY,
          isSelf,
        });
      });
    });

    return list;
  }, [tables, allDbTablesSchema, nodePositions]);

  // Set of tables directly connected to the active table for smart focus highlighting during hold
  const isDirectlyConnected = useMemo(() => {
    if (!holdingTable) return new Set<string>();
    const connected = new Set<string>([holdingTable]);
    relations.forEach((r) => {
      if (r.sourceTable === holdingTable) connected.add(r.targetTable);
      if (r.targetTable === holdingTable) connected.add(r.sourceTable);
    });
    return connected;
  }, [holdingTable, relations]);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden select-none bg-[#09090b] font-sans">
      {/* ─── Interactive Canvas Viewport (Pannable & Zoomable) ─── */}
      <div
        ref={containerRef}
        onMouseDown={handleCanvasMouseDown}
        onWheel={handleWheel}
        className={`flex-1 relative min-h-0 overflow-hidden ${
          isPanning ? 'cursor-grabbing' : 'cursor-default'
        }`}
      >
        {/* ─── Dot Grid Background Pattern ─── */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          xmlns="http://www.w3.org/2000/svg"
        >
        <defs>
          <pattern
            id="axiom-schema-dot-grid"
            width={24 * transform.scale}
            height={24 * transform.scale}
            patternUnits="userSpaceOnUse"
            patternTransform={`translate(${transform.x}, ${transform.y})`}
          >
            <circle cx="2" cy="2" r="1.1" fill="#202024" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#axiom-schema-dot-grid)" />
      </svg>

      {/* ─── Zoomable / Pannable Workspace Plane ─── */}
      <div
        className="absolute inset-0 origin-top-left pointer-events-none"
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
        }}
      >
        {/* SVG Orthogonal Relationship Connector Lines (Behind Cards) */}
        <svg
          className="absolute inset-0 overflow-visible pointer-events-none"
          style={{ width: 1, height: 1 }}
        >
          <defs>
            <style>{`
              @keyframes axiomFlowAhead {
                from {
                  stroke-dashoffset: 22;
                }
                to {
                  stroke-dashoffset: 0;
                }
              }
              @keyframes axiomFlowBack {
                from {
                  stroke-dashoffset: 0;
                }
                to {
                  stroke-dashoffset: 22;
                }
              }
              .animate-flowing-ahead {
                stroke-dasharray: 6 5;
                animation: axiomFlowAhead 0.6s linear infinite;
              }
              .animate-flowing-back {
                stroke-dasharray: 6 5;
                animation: axiomFlowBack 0.6s linear infinite;
              }
            `}</style>
          </defs>

          {relations.map((rel) => {
            let pathData: string;
            if (rel.isSelf) {
              // Self-loop on the left side:
              // Loops out to the left and curves back into the referenced column (id)
              const loopOffset = 42;
              pathData = `M ${rel.startX} ${rel.startY} C ${rel.startX - loopOffset} ${rel.startY}, ${
                rel.endX - loopOffset
              } ${rel.endY}, ${rel.endX} ${rel.endY}`;
            } else {
              const dx = rel.endX - rel.startX;
              const controlOffset = Math.max(40, Math.min(100, Math.abs(dx) * 0.4));
              pathData = `M ${rel.startX} ${rel.startY} C ${rel.startX + (dx >= 0 ? controlOffset : -controlOffset)} ${rel.startY}, ${
                rel.endX + (dx >= 0 ? -controlOffset : controlOffset)
              } ${rel.endY}, ${rel.endX} ${rel.endY}`;
            }

            const isSourceHold = holdingTable === rel.sourceTable;
            const isTargetHold = holdingTable === rel.targetTable;
            const isHoldActive = isSourceHold || isTargetHold || holdingLineId === rel.id;

            // ONLY animate if holding is active! In unselected state, all lines (including in-table loops) remain completely stationary!
            const flowClass = isHoldActive
              ? isSourceHold || rel.isSelf
                ? 'animate-flowing-ahead'
                : 'animate-flowing-back'
              : undefined;

            const activeStroke = isHoldActive
              ? isSourceHold
                ? '#38bdf8'
                : '#818cf8'
              : '#52525b';

            return (
              <g key={rel.id} className="pointer-events-none">
                {/* Background outline for contrast */}
                <path
                  d={pathData}
                  fill="none"
                  stroke="#09090b"
                  strokeWidth={isHoldActive ? 5 : 3.5}
                  strokeLinecap="round"
                />
                {/* Visible relationship connector */}
                <path
                  d={pathData}
                  fill="none"
                  stroke={activeStroke}
                  strokeWidth={isHoldActive ? 2 : 1.2}
                  strokeOpacity={isHoldActive ? 1 : holdingTable ? 0.35 : 0.75}
                  strokeLinecap="round"
                  className={flowClass}
                />
              </g>
            );
          })}
        </svg>

        {/* Table Entity Cards */}
        {tables.map((t) => {
          const isHeld = holdingTable === t.name;
          const pos = nodePositions[t.name] || { x: 80, y: 80 };
          const tableData = allDbTablesSchema[t.name] || { columns: [], foreign_keys: [] };
          const cols = tableData.columns || [];
          const isMatchingSearch = filteredTableNames.includes(t.name);

          return (
            <div
              key={t.name}
              style={{
                transform: `translate(${pos.x}px, ${pos.y}px)`,
                width: `${CARD_WIDTH}px`,
              }}
              onMouseDown={(e) => {
                if (e.button === 0) {
                  setHoldingTable(t.name);
                }
              }}
              className={`absolute rounded-[14px] bg-[#101012] border shadow-2xl pointer-events-auto transition-[opacity,border-color] duration-150 p-2.5 ${
                !isMatchingSearch
                  ? 'opacity-25'
                  : holdingTable && !isDirectlyConnected.has(t.name)
                  ? 'opacity-35 hover:opacity-85'
                  : 'opacity-100'
              } ${
                isHeld
                  ? 'border-blue-500/80 ring-1 ring-blue-500/30'
                  : 'border-[#222226] hover:border-[#333338]'
              }`}
            >
              {/* Card Header (Drag handle & Click-and-Hold trigger) */}
              <div
                onMouseDown={(e) => {
                  if (e.button !== 0) return;
                  e.stopPropagation();
                  setHoldingTable(t.name);
                  const dragPayload = {
                    tableName: t.name,
                    startX: e.clientX,
                    startY: e.clientY,
                    initialPos: pos,
                  };
                  draggingNodeRef.current = dragPayload;
                  setDraggingNode(dragPayload);
                }}
                className="h-10 px-2.5 flex items-center justify-between gap-2.5 select-none cursor-grab active:cursor-grabbing mb-2"
              >
                <div className="flex items-center gap-2.5 min-w-0 pointer-events-none">
                  <LayoutGrid className="w-4 h-4 text-zinc-400 shrink-0" />
                  <span className="font-sans font-semibold text-white text-[14px] tracking-tight truncate">
                    {t.name}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    const r = e.currentTarget.getBoundingClientRect();
                    setActiveTableMenu((prev) =>
                      prev?.tableName === t.name
                        ? null
                        : {
                            tableName: t.name,
                            rect: { top: r.top, left: r.left, width: r.width, height: r.height },
                          }
                    );
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  title={`${t.name} actions`}
                  className="w-6 h-6 flex items-center justify-center text-[#71717a] hover:text-white rounded-[5px] hover:bg-[#1f1f23] transition-colors cursor-pointer"
                >
                  <MoreVertical className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Column Rows Container (Clean inset card with crisp dividers and comfortable padding) */}
              <div className="rounded-[10px] bg-[#161619] border border-[#26262a] divide-y divide-[#232327] overflow-hidden">
                {cols.map((col) => {
                  const isPk = col.primary_key;

                  return (
                    <div
                      key={col.name}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onEditColumn) {
                          onEditColumn(t.name, col);
                        }
                      }}
                      className="h-8 px-3 flex items-center justify-between gap-3 text-[12.5px] hover:bg-[#1e1e22] transition-colors group cursor-pointer"
                      title={`Edit column ${col.name}`}
                    >
                      {/* Left: Column Constraint Icon + Column Name */}
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        {isPk ? (
                          <Key className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        ) : col.name.toLowerCase() === 'id' ? (
                          <Hash className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                        ) : col.nullable ? (
                          <svg className="w-3.5 h-3.5 text-zinc-500 shrink-0" viewBox="0 0 12 12" fill="none">
                            <path d="M6 1.5L10.5 6L6 10.5L1.5 6Z" stroke="currentColor" strokeWidth="1.2" />
                          </svg>
                        ) : (
                          <svg className="w-3.5 h-3.5 text-zinc-300 shrink-0" viewBox="0 0 12 12" fill="currentColor">
                            <path d="M6 1.5L10.5 6L6 10.5L1.5 6Z" />
                          </svg>
                        )}

                        <span
                          className={`font-sans truncate ${
                            isPk ? 'text-white font-medium' : 'text-[#d4d4d8]'
                          }`}
                          title={col.name}
                        >
                          {col.name}
                        </span>
                      </div>

                      {/* Right: Data Type (Default) / 3-dots menu button on hover */}
                      <div className="shrink-0 flex items-center justify-end relative h-full">
                        {/* Data Type - Hidden on hover or when this column's menu is active */}
                        <div
                          className={`font-mono text-[11px] text-[#71717a] transition-opacity duration-150 ${
                            activeColumnMenu?.tableName === t.name && activeColumnMenu?.column.name === col.name
                              ? 'hidden'
                              : 'group-hover:hidden'
                          }`}
                        >
                          <span>{formatColumnType(col.type)}</span>
                        </div>

                        {/* 3-dots button - Revealed on hover or when this column's menu is active */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const r = e.currentTarget.getBoundingClientRect();
                            setActiveColumnMenu((prev) =>
                              prev?.tableName === t.name && prev?.column.name === col.name
                                ? null
                                : {
                                    tableName: t.name,
                                    column: col,
                                    rect: { top: r.top, left: r.left, width: r.width, height: r.height },
                                  }
                            );
                          }}
                          onMouseDown={(e) => e.stopPropagation()}
                          title={`Column actions`}
                          className={`w-6 h-6 flex items-center justify-center text-[#8e8e93] hover:text-white rounded-[4px] hover:bg-[#232328] transition-colors cursor-pointer ${
                            activeColumnMenu?.tableName === t.name && activeColumnMenu?.column.name === col.name
                              ? 'flex bg-[#232328] text-white'
                              : 'hidden group-hover:flex'
                          }`}
                        >
                          <MoreVertical className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* SVG Connection Port Circles (Rendered in front of cards so they sit clearly on the borders) */}
        <svg
          className="absolute inset-0 overflow-visible pointer-events-none"
          style={{ width: 1, height: 1 }}
        >
          {relations.map((rel) => {
            const isSourceHold = holdingTable === rel.sourceTable;
            const isTargetHold = holdingTable === rel.targetTable;
            const isHoldActive = isSourceHold || isTargetHold || holdingLineId === rel.id;
            const activeColor = isSourceHold ? '#38bdf8' : '#818cf8';

            return (
              <g key={`port-circles-${rel.id}`}>
                {/* Source connection circle on FK column edge */}
                <circle
                  cx={rel.startX}
                  cy={rel.startY}
                  r={isHoldActive ? 4.5 : 3.2}
                  fill={isHoldActive ? activeColor : holdingTable ? '#3f3f46' : '#8e8e93'}
                  stroke="#101012"
                  strokeWidth={2}
                />
                {/* Target connection circle on referenced PK column edge */}
                <circle
                  cx={rel.endX}
                  cy={rel.endY}
                  r={isHoldActive ? 5.5 : 4.2}
                  fill={isHoldActive ? activeColor : holdingTable ? '#52525b' : '#e4e4e7'}
                  stroke="#101012"
                  strokeWidth={2}
                />
              </g>
            );
          })}
        </svg>
        </div>
      </div>

      {/* ─── Bottom Footer Bar: Symbol Legend & Schema Stats ─── */}
      <div
        className="h-12 shrink-0 px-4 bg-[#0a0a0a] border-t border-[#222222] flex items-center justify-between gap-4 text-[13px] text-[#8c8c8c] z-30 select-none font-sans"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Legend Symbols */}
        <div className="flex items-center gap-5 text-[13px] font-sans">
          <div className="flex items-center gap-1.5">
            <Key className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="text-[#a1a1aa] font-sans">Primary key</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Hash className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
            <span className="text-[#a1a1aa] font-sans">Identity</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
            <span className="text-[#a1a1aa] font-sans">Unique</span>
          </div>
          <div className="flex items-center gap-1.5">
            <svg className="w-3 h-3 text-zinc-400 shrink-0" viewBox="0 0 12 12" fill="none">
              <path d="M6 1.5L10.5 6L6 10.5L1.5 6Z" stroke="currentColor" strokeWidth="1.3" />
            </svg>
            <span className="text-[#a1a1aa] font-sans">Nullable</span>
          </div>
          <div className="flex items-center gap-1.5">
            <svg className="w-3 h-3 text-zinc-300 shrink-0" viewBox="0 0 12 12" fill="currentColor">
              <path d="M6 1.5L10.5 6L6 10.5L1.5 6Z" />
            </svg>
            <span className="text-[#a1a1aa] font-sans">Non-Nullable</span>
          </div>
        </div>

        {/* Right Info */}
        <div className="text-[13px] text-[#8c8c8c] font-sans flex items-center gap-1.5">
          <span>
            Showing <span className="text-white font-medium">{tables.length}</span> tables
            {selectedDb && (
              <> in <span className="text-white font-mono">{selectedDb}</span></>
            )}
          </span>
          <span className="text-[#555555]">·</span>
          <span>
            <span className="text-white font-medium">{relations.length}</span> relations
          </span>
        </div>
      </div>

      {/* ─── Node Header Action Menu Popup (Matching screenshot) ─── */}
      {activeTableMenu && (() => {
        const menuWidth = 175;
        const menuHeight = 170;
        const top = Math.min(window.innerHeight - menuHeight - 12, activeTableMenu.rect.top + activeTableMenu.rect.height + 4);
        const left = Math.max(8, Math.min(window.innerWidth - menuWidth - 12, activeTableMenu.rect.left - menuWidth + activeTableMenu.rect.width));
        const targetTable = activeTableMenu.tableName;

        return (
          <div
            ref={tableMenuRef}
            style={{ top: `${top}px`, left: `${left}px`, width: `${menuWidth}px` }}
            className="fixed z-50 rounded-[8px] border border-[#26262a] bg-[#141416] shadow-[0_16px_36px_rgba(0,0,0,0.95)] p-1 flex flex-col font-sans select-none animate-in fade-in zoom-in-95 duration-75 text-[13px]"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* 1. Edit table */}
            <button
              type="button"
              onClick={() => {
                setActiveTableMenu(null);
                if (onEditTable) {
                  onEditTable(targetTable);
                } else {
                  onSelectTable(targetTable);
                }
              }}
              className="w-full flex items-center px-2.5 py-1.5 rounded-[5px] text-[#e4e4e7] hover:text-white hover:bg-[#202024] transition-colors cursor-pointer text-left font-normal"
            >
              <span>Edit table</span>
            </button>

            {/* 2. View in Table Editor */}
            <button
              type="button"
              onClick={() => {
                setActiveTableMenu(null);
                if (onViewInTableEditor) {
                  onViewInTableEditor(targetTable);
                } else {
                  onSelectTable(targetTable);
                }
              }}
              className="w-full flex items-center px-2.5 py-1.5 rounded-[5px] text-[#e4e4e7] hover:text-white hover:bg-[#202024] transition-colors cursor-pointer text-left font-normal"
            >
              <span>View in Table Editor</span>
            </button>

            {/* Separator line between View and Copy actions */}
            <div className="-mx-1 border-t border-[#232326] my-1" />

            {/* 3. Copy name */}
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(targetTable);
                handleCopy(targetTable, `table_name_${targetTable}`);
                setActiveTableMenu(null);
              }}
              className="w-full flex items-center px-2.5 py-1.5 rounded-[5px] text-[#e4e4e7] hover:text-white hover:bg-[#202024] transition-colors cursor-pointer text-left font-normal"
            >
              <span>{copiedKey === `table_name_${targetTable}` ? 'Copied name!' : 'Copy name'}</span>
            </button>

            {/* 4. Copy as SQL */}
            <button
              type="button"
              onClick={() => {
                const tData = allDbTablesSchema[targetTable] || { columns: [], foreign_keys: [] };
                let ddl = `CREATE TABLE ${targetTable} (\n`;
                const colLines = (tData.columns || []).map((c) => {
                  let line = `  ${c.name} ${c.type}`;
                  if (c.primary_key) line += ' PRIMARY KEY';
                  if (!c.nullable) line += ' NOT NULL';
                  return line;
                });
                if (tData.foreign_keys && tData.foreign_keys.length > 0) {
                  tData.foreign_keys.forEach((fk) => {
                    colLines.push(`  CONSTRAINT fk_${fk.column} FOREIGN KEY (${fk.column}) REFERENCES ${fk.referenced_table} (${fk.referenced_column})`);
                  });
                }
                ddl += colLines.join(',\n') + '\n);';
                navigator.clipboard.writeText(ddl);
                handleCopy(ddl, `table_sql_${targetTable}`);
                setActiveTableMenu(null);
              }}
              className="w-full flex items-center px-2.5 py-1.5 rounded-[5px] text-[#e4e4e7] hover:text-white hover:bg-[#202024] transition-colors cursor-pointer text-left font-normal"
            >
              <span>{copiedKey === `table_sql_${targetTable}` ? 'Copied SQL!' : 'Copy as SQL'}</span>
            </button>

            {/* 5. Copy as Markdown */}
            <button
              type="button"
              onClick={() => {
                const tData = allDbTablesSchema[targetTable] || { columns: [], foreign_keys: [] };
                let md = `## Table \`${targetTable}\`\n\n`;
                md += `| Column | Type | Nullable | Primary Key | Default |\n`;
                md += `| :--- | :--- | :--- | :--- | :--- |\n`;
                (tData.columns || []).forEach((c) => {
                  md += `| \`${c.name}\` | \`${c.type}\` | ${c.nullable ? 'Yes' : 'No'} | ${c.primary_key ? 'Yes' : 'No'} | ${c.default_value ?? '-'} |\n`;
                });
                if (tData.foreign_keys && tData.foreign_keys.length > 0) {
                  md += `\n**Foreign Keys:**\n\n`;
                  tData.foreign_keys.forEach((fk) => {
                    md += `- \`${fk.column}\` -> \`${fk.referenced_table}(${fk.referenced_column})\`\n`;
                  });
                }
                navigator.clipboard.writeText(md.trim());
                handleCopy(md.trim(), `table_md_${targetTable}`);
                setActiveTableMenu(null);
              }}
              className="w-full flex items-center px-2.5 py-1.5 rounded-[5px] text-[#e4e4e7] hover:text-white hover:bg-[#202024] transition-colors cursor-pointer text-left font-normal"
            >
              <span>{copiedKey === `table_md_${targetTable}` ? 'Copied Markdown!' : 'Copy as Markdown'}</span>
            </button>
          </div>
        );
      })()}

      {/* ─── Column Row Action Menu Popup ─── */}
      {activeColumnMenu && (() => {
        const menuWidth = 160;
        const menuHeight = 85;
        const top = Math.min(window.innerHeight - menuHeight - 12, activeColumnMenu.rect.top + activeColumnMenu.rect.height + 4);
        const left = Math.max(8, Math.min(window.innerWidth - menuWidth - 12, activeColumnMenu.rect.left - menuWidth + activeColumnMenu.rect.width));
        const { tableName, column } = activeColumnMenu;
        const colCopyKey = `col_name_${tableName}_${column.name}`;

        return (
          <div
            ref={columnMenuRef}
            style={{ top: `${top}px`, left: `${left}px`, width: `${menuWidth}px` }}
            className="fixed z-50 rounded-[8px] border border-[#26262a] bg-[#141416] shadow-[0_16px_36px_rgba(0,0,0,0.95)] p-1 flex flex-col font-sans select-none animate-in fade-in zoom-in-95 duration-75 text-[13px]"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* 1. Edit column */}
            <button
              type="button"
              onClick={() => {
                setActiveColumnMenu(null);
                if (onEditColumn) {
                  onEditColumn(tableName, column);
                }
              }}
              className="w-full flex items-center px-2.5 py-1.5 rounded-[5px] text-[#e4e4e7] hover:text-white hover:bg-[#202024] transition-colors cursor-pointer text-left font-normal"
            >
              <span>Edit column</span>
            </button>

            {/* 2. Copy column name */}
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(column.name);
                handleCopy(column.name, colCopyKey);
                setActiveColumnMenu(null);
              }}
              className="w-full flex items-center px-2.5 py-1.5 rounded-[5px] text-[#e4e4e7] hover:text-white hover:bg-[#202024] transition-colors cursor-pointer text-left font-normal"
            >
              <span>{copiedKey === colCopyKey ? 'Copied name!' : 'Copy name'}</span>
            </button>
          </div>
        );
      })()}
    </div>
  );
}
