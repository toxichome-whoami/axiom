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
  resetViewTrigger?: number;
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
  resetViewTrigger,
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
      const target = e.target as HTMLElement | null;
      if (!target) return;

      // Handle table menu dismissal
      if (activeTableMenu) {
        const isInsideMenu = !!tableMenuRef.current?.contains(target);
        const isOwnTrigger = !!target.closest(`[data-table-menu-trigger="${activeTableMenu.tableName}"]`);
        if (!isInsideMenu && !isOwnTrigger) {
          setActiveTableMenu(null);
        }
      }

      // Handle column menu dismissal
      if (activeColumnMenu) {
        const isInsideMenu = !!columnMenuRef.current?.contains(target);
        const ownTriggerSelector = `[data-column-menu-trigger="${activeColumnMenu.tableName}:${activeColumnMenu.column.name}"]`;
        const isOwnTrigger = !!target.closest(ownTriggerSelector);
        if (!isInsideMenu && !isOwnTrigger) {
          setActiveColumnMenu(null);
        }
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveTableMenu(null);
        setActiveColumnMenu(null);
      }
    };
    document.addEventListener('mousedown', handleOutside, true);
    window.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside, true);
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
  const [isDraggingNode, setIsDraggingNode] = useState(false);

  // Compute exact table card pixel height
  const getTableHeight = useCallback(
    (tableName: string) => {
      const tableData = allDbTablesSchema[tableName];
      const cols = tableData?.columns;
      // Default to 4 columns if schema is still loading to preserve ample vertical spacing
      const colCount = cols && cols.length > 0 ? cols.length : 4;
      // 20px (p-2.5) + 2px border + 40px (h-10) + 8px (mb-2) + 2px list border + N * 32px + (N-1) dividers
      return 72 + colCount * 33;
    },
    [allDbTablesSchema]
  );

  // Center and fit nodes in viewport
  const centerNodesInViewport = useCallback((positions: Record<string, TablePosition>) => {
    const tableKeys = Object.keys(positions);
    if (tableKeys.length === 0) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    tableKeys.forEach((name) => {
      const pos = positions[name];
      if (!pos) return;
      const h = getTableHeight(name);
      if (pos.x < minX) minX = pos.x;
      if (pos.y < minY) minY = pos.y;
      if (pos.x + CARD_WIDTH > maxX) maxX = pos.x + CARD_WIDTH;
      if (pos.y + h > maxY) maxY = pos.y + h;
    });

    const contentWidth = Math.max(maxX - minX, 100);
    const contentHeight = Math.max(maxY - minY, 100);

    const vpWidth = containerRef.current?.clientWidth || window.innerWidth || 1200;
    const vpHeight = containerRef.current?.clientHeight || window.innerHeight || 800;

    const padding = 72;
    const scaleX = (vpWidth - padding * 2) / contentWidth;
    const scaleY = (vpHeight - padding * 2) / contentHeight;

    // Pick clean scale clamped between 0.45 and 1.0 (never upscale past 1.0)
    let newScale = Math.min(scaleX, scaleY, 1.0);
    newScale = Math.max(0.45, Math.min(1.0, Number(newScale.toFixed(2))));

    const contentCenterX = minX + contentWidth / 2;
    const contentCenterY = minY + contentHeight / 2;

    const newX = Math.round(vpWidth / 2 - contentCenterX * newScale);
    const newY = Math.round(vpHeight / 2 - contentCenterY * newScale);

    setTransform({
      x: newX,
      y: newY,
      scale: newScale,
    });
  }, [getTableHeight, setTransform]);

  // Auto-layout computation: topological layering + grid fallback + auto-centering
  const computeAutoLayout = useCallback(() => {
    const tableNames = tables.map((t) => t.name);
    if (tableNames.length === 0) return;

    const GAP_X = 420; // 290px card width + 130px connector margin
    const GAP_Y = 56;  // Clean 56px vertical gap between stacked table nodes

    // Build directed graph of foreign key relationships:
    // If Table B has FK referencing Table A:
    // Table A is the parent (reference/dimension table on left).
    // Table B is the child (transaction/fact table on right).
    const inDegree: Record<string, number> = {};
    const outDegree: Record<string, number> = {};
    const adj: Record<string, string[]> = {};
    const reverseAdj: Record<string, string[]> = {};

    tableNames.forEach((name) => {
      inDegree[name] = 0;
      outDegree[name] = 0;
      adj[name] = [];
      reverseAdj[name] = [];
    });

    let totalRelationships = 0;
    tableNames.forEach((childName) => {
      const fks = allDbTablesSchema[childName]?.foreign_keys || [];
      fks.forEach((fk) => {
        const parentName = fk.referenced_table;
        if (tableNames.includes(parentName) && parentName !== childName) {
          if (!adj[parentName].includes(childName)) {
            adj[parentName].push(childName);
            reverseAdj[childName].push(parentName);
            inDegree[childName] = (inDegree[childName] || 0) + 1;
            outDegree[parentName] = (outDegree[parentName] || 0) + 1;
            totalRelationships++;
          }
        }
      });
    });

    const newPositions: Record<string, TablePosition> = {};

    // ─── CASE 1: No Foreign Key Relationships (Masonry Column Balance) ───
    if (totalRelationships === 0) {
      const count = tableNames.length;
      const numCols = count <= 2 ? 1 : count <= 4 ? 2 : count <= 8 ? 3 : 4;
      const colCurrentY: number[] = new Array(numCols).fill(40);

      // Sort tables by height descending to balance masonry columns evenly
      const sorted = [...tableNames].sort((a, b) => getTableHeight(b) - getTableHeight(a));
      sorted.forEach((tableName) => {
        let shortestCol = 0;
        for (let c = 1; c < numCols; c++) {
          if (colCurrentY[c] < colCurrentY[shortestCol]) {
            shortestCol = c;
          }
        }
        newPositions[tableName] = {
          x: 40 + shortestCol * GAP_X,
          y: colCurrentY[shortestCol],
        };
        colCurrentY[shortestCol] += getTableHeight(tableName) + GAP_Y;
      });

      setNodePositions(newPositions);
      centerNodesInViewport(newPositions);
      return;
    }

    // ─── CASE 2: Connected ER Diagram (Topological Multi-layer DAG) ───
    // Layer assignment:
    // Root reference tables (inDegree === 0) start at Layer 0.
    // Each child table is placed at layer = Math.max(parent_layers) + 1.
    const assignedLayer: Record<string, number> = {};

    let roots = tableNames.filter((name) => inDegree[name] === 0);
    if (roots.length === 0) {
      // Fallback for circular dependencies: choose table with highest outgoing relations
      roots = [[...tableNames].sort((a, b) => (outDegree[b] || 0) - (outDegree[a] || 0))[0]];
    }

    roots.forEach((name) => {
      assignedLayer[name] = 0;
    });

    const queue = [...roots];
    let maxLayer = 0;
    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentLayer = assignedLayer[current] || 0;

      adj[current]?.forEach((child) => {
        const nextLayer = currentLayer + 1;
        if (assignedLayer[child] === undefined || assignedLayer[child] < nextLayer) {
          assignedLayer[child] = nextLayer;
          if (nextLayer > maxLayer) maxLayer = nextLayer;
          if (!queue.includes(child)) {
            queue.push(child);
          }
        }
      });
    }

    // Catch any disconnected tables and place them in Layer 0
    tableNames.forEach((name) => {
      if (assignedLayer[name] === undefined) {
        assignedLayer[name] = 0;
      }
    });

    // Group tables by layer
    const rawLayers: string[][] = [];
    for (let l = 0; l <= maxLayer; l++) {
      rawLayers.push([]);
    }
    tableNames.forEach((name) => {
      const l = assignedLayer[name] || 0;
      rawLayers[l].push(name);
    });

    // Sub-divide any layer that has more than 3 tables into 2 balanced columns
    const columns: string[][] = [];
    rawLayers.forEach((layerTables) => {
      if (layerTables.length === 0) return;
      if (layerTables.length > 3) {
        const colA: string[] = [];
        const colB: string[] = [];
        let hA = 0;
        let hB = 0;
        layerTables.forEach((t) => {
          const h = getTableHeight(t);
          if (hA <= hB) {
            colA.push(t);
            hA += h + GAP_Y;
          } else {
            colB.push(t);
            hB += h + GAP_Y;
          }
        });
        columns.push(colA);
        columns.push(colB);
      } else {
        columns.push(layerTables);
      }
    });

    // Calculate column heights for vertical centering
    const columnHeights = columns.map((colTables) => {
      return colTables.reduce((sum, name) => sum + getTableHeight(name) + GAP_Y, 0) - GAP_Y;
    });
    const maxColumnHeight = Math.max(...columnHeights, 400);

    // Position tables in each column with harmonious vertical alignment
    columns.forEach((colTables, colIdx) => {
      const colHeight = columnHeights[colIdx] || 0;
      const startY = Math.max(40, Math.round(40 + (maxColumnHeight - colHeight) / 2));
      let currentY = startY;

      colTables.forEach((tableName) => {
        newPositions[tableName] = {
          x: 40 + colIdx * GAP_X,
          y: currentY,
        };
        currentY += getTableHeight(tableName) + GAP_Y;
      });
    });

    setNodePositions(newPositions);
    centerNodesInViewport(newPositions);
  }, [tables, allDbTablesSchema, getTableHeight, centerNodesInViewport]);

  // Keep latest nodePositions ref synchronized without triggering effect loops
  const nodePositionsRef = useRef(nodePositions);
  nodePositionsRef.current = nodePositions;

  // Track if user has manually moved/dragged any node so we don't clobber manual work
  const userHasMovedNodesRef = useRef(false);
  const layoutCalculatedWithFullSchemaRef = useRef(false);

  // Reset layout flags when switching databases
  const prevDbRef = useRef(selectedDb);
  useEffect(() => {
    if (prevDbRef.current !== selectedDb) {
      prevDbRef.current = selectedDb;
      userHasMovedNodesRef.current = false;
      layoutCalculatedWithFullSchemaRef.current = false;
    }
  }, [selectedDb]);

  // Initial layout run and auto-rebalance when full schemas finish loading
  useEffect(() => {
    if (tables.length === 0) return;
    const loadedCount = Object.keys(allDbTablesSchema).length;
    const hasPositions = Object.keys(nodePositionsRef.current).length > 0;

    // First mount: run initial layout
    if (!hasPositions) {
      computeAutoLayout();
      if (loadedCount >= tables.length) {
        layoutCalculatedWithFullSchemaRef.current = true;
      }
      return;
    }

    // Once all table schemas have arrived from the server, recalculate layout with real columns and FKs
    if (!layoutCalculatedWithFullSchemaRef.current && loadedCount >= tables.length && !userHasMovedNodesRef.current) {
      computeAutoLayout();
      layoutCalculatedWithFullSchemaRef.current = true;
    }
  }, [tables, allDbTablesSchema, computeAutoLayout]);

  // Auto layout trigger from parent toolbar (fires ONLY when trigger value changes)
  const lastAutoLayoutTriggerRef = useRef(autoLayoutTrigger);
  useEffect(() => {
    if (autoLayoutTrigger && autoLayoutTrigger !== lastAutoLayoutTriggerRef.current) {
      lastAutoLayoutTriggerRef.current = autoLayoutTrigger;
      userHasMovedNodesRef.current = false;
      computeAutoLayout();
    }
  }, [autoLayoutTrigger, computeAutoLayout]);

  // Reset view / Fit to screen trigger from parent toolbar (fires ONLY when trigger value changes)
  const lastResetViewTriggerRef = useRef(resetViewTrigger);
  useEffect(() => {
    if (resetViewTrigger && resetViewTrigger !== lastResetViewTriggerRef.current) {
      lastResetViewTriggerRef.current = resetViewTrigger;
      centerNodesInViewport(nodePositionsRef.current);
    }
  }, [resetViewTrigger, centerNodesInViewport]);

  // Ref tracking for active drag & pan to avoid stale closures in window event listeners
  const draggingNodeRef = useRef<{
    tableName: string;
    startX: number;
    startY: number;
    initialPos: TablePosition;
  } | null>(null);

  const hasDraggedNodeRef = useRef(false);
  const isPanningRef = useRef(false);
  const panMovedRef = useRef(false);
  const transformRef = useRef(transform);
  transformRef.current = transform;
  const onSelectTableRef = useRef(onSelectTable);
  onSelectTableRef.current = onSelectTable;

  // Global window mousemove & mouseup listeners throttled with requestAnimationFrame for 60/120fps efficiency
  useEffect(() => {
    let rafId: number | null = null;
    let pendingMousePos: { clientX: number; clientY: number } | null = null;

    const flushMove = () => {
      rafId = null;
      if (!pendingMousePos) return;
      const { clientX, clientY } = pendingMousePos;
      pendingMousePos = null;

      if (draggingNodeRef.current) {
        const dx = clientX - draggingNodeRef.current.startX;
        const dy = clientY - draggingNodeRef.current.startY;
        if (Math.hypot(dx, dy) > 3) {
          hasDraggedNodeRef.current = true;
          userHasMovedNodesRef.current = true;
        }

        const currentScale = transformRef.current.scale || 1;
        const scaledDx = dx / currentScale;
        const scaledDy = dy / currentScale;
        const targetTableName = draggingNodeRef.current.tableName;
        const initPos = draggingNodeRef.current.initialPos;

        setNodePositions((prev) => ({
          ...prev,
          [targetTableName]: {
            x: Math.round(initPos.x + scaledDx),
            y: Math.round(initPos.y + scaledDy),
          },
        }));
        return;
      }

      if (isPanningRef.current && panStartRef.current) {
        const dx = clientX - panStartRef.current.x;
        const dy = clientY - panStartRef.current.y;
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

    const onWindowMouseMove = (e: MouseEvent) => {
      // If no mouse button is pressed, immediately cancel any active drag or pan
      if (e.buttons === 0) {
        if (draggingNodeRef.current || isPanningRef.current) {
          onWindowMouseUp();
        }
        return;
      }

      // Early exit if user is not actively dragging or panning
      if (!draggingNodeRef.current && !isPanningRef.current) return;
      pendingMousePos = { clientX: e.clientX, clientY: e.clientY };
      if (!rafId) {
        rafId = requestAnimationFrame(flushMove);
      }
    };

    const onWindowMouseUp = () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (pendingMousePos) {
        flushMove();
      }
      pendingMousePos = null;

      // Clear click-and-hold line animation
      setHoldingTable(null);
      setHoldingLineId(null);

      if (draggingNodeRef.current) {
        if (!hasDraggedNodeRef.current) {
          // Clean click without dragging toggles table selection
          onSelectTableRef.current(draggingNodeRef.current.tableName);
        }
        draggingNodeRef.current = null;
        hasDraggedNodeRef.current = false;
        setIsDraggingNode(false);
      }

      if (isPanningRef.current) {
        if (!panMovedRef.current) {
          // Clean click on background deselects table
          onSelectTableRef.current('');
        }
        isPanningRef.current = false;
        panStartRef.current = null;
        setIsPanning(false);
      }
    };

    window.addEventListener('mousemove', onWindowMouseMove, { passive: true });
    window.addEventListener('mouseup', onWindowMouseUp);
    window.addEventListener('blur', onWindowMouseUp);

    return () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      window.removeEventListener('mousemove', onWindowMouseMove);
      window.removeEventListener('mouseup', onWindowMouseUp);
      window.removeEventListener('blur', onWindowMouseUp);
    };
  }, [setTransform]);

  // Canvas Panning Handlers
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    // Only pan if left click on canvas background (not on a card or button)
    if (e.button !== 0) return;
    e.preventDefault();
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

  // Pre-indexed column index map for O(1) row positioning instead of repeated array findIndex scans
  const colIndexMap = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    Object.keys(allDbTablesSchema).forEach((tName) => {
      const cols = allDbTablesSchema[tName]?.columns || [];
      const subMap: Record<string, number> = {};
      cols.forEach((c, idx) => {
        subMap[c.name] = idx;
      });
      map[tName] = subMap;
    });
    return map;
  }, [allDbTablesSchema]);

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

        const sourceColIdx = colIndexMap[t.name]?.[fk.column] ?? 0;
        const targetColIdx = colIndexMap[fk.referenced_table]?.[fk.referenced_column] ?? 0;

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

  // Set of tables directly connected to the active table for smart focus highlighting
  const isDirectlyConnected = useMemo(() => {
    const active = holdingTable || selectedTable;
    if (!active) return new Set<string>();
    const connected = new Set<string>([active]);
    relations.forEach((r) => {
      if (r.sourceTable === active) connected.add(r.targetTable);
      if (r.targetTable === active) connected.add(r.sourceTable);
    });
    return connected;
  }, [holdingTable, selectedTable, relations]);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden select-none bg-[#09090b] font-sans">
      {/* ─── Interactive Canvas Viewport (Pannable & Zoomable) ─── */}
      <div
        ref={containerRef}
        onMouseDown={handleCanvasMouseDown}
        onWheel={handleWheel}
        className={`flex-1 relative min-h-0 overflow-hidden ${
          isDraggingNode || isPanning ? 'cursor-grabbing select-none' : 'cursor-default'
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
          transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
          willChange: isPanning ? 'transform' : 'auto',
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

            const isSourceHold = holdingTable === rel.sourceTable || selectedTable === rel.sourceTable;
            const isTargetHold = holdingTable === rel.targetTable || selectedTable === rel.targetTable;
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
                transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`,
                width: `${CARD_WIDTH}px`,
                willChange: isDraggingNode ? 'transform' : 'auto',
              }}
              onMouseDown={(e) => {
                e.stopPropagation();
                if (e.button === 0) {
                  setHoldingTable(t.name);
                }
              }}
              className={`absolute rounded-[14px] bg-[#101012] border shadow-lg pointer-events-auto transition-[opacity,border-color] duration-150 p-2.5 ${
                !isMatchingSearch
                  ? 'opacity-25'
                  : (holdingTable || selectedTable) && !isDirectlyConnected.has(t.name)
                  ? 'opacity-35 hover:opacity-85'
                  : 'opacity-100'
              } ${
                isHeld || selectedTable === t.name
                  ? 'border-blue-500/80 ring-1 ring-blue-500/30'
                  : 'border-[#222226] hover:border-[#333338]'
              }`}
            >
              {/* Card Header (Drag handle & Click-and-Hold trigger) */}
              <div
                onMouseDown={(e) => {
                  if (e.button !== 0) return;
                  e.stopPropagation();
                  e.preventDefault();

                  hasDraggedNodeRef.current = false;
                  setIsDraggingNode(true);
                  setHoldingTable(t.name);

                  const currentPos = nodePositionsRef.current[t.name] || pos || { x: 80, y: 80 };
                  const dragPayload = {
                    tableName: t.name,
                    startX: e.clientX,
                    startY: e.clientY,
                    initialPos: currentPos,
                  };
                  draggingNodeRef.current = dragPayload;
                }}
                className={`h-10 px-2.5 flex items-center justify-between gap-2.5 select-none mb-2 ${
                  isDraggingNode ? 'cursor-grabbing' : 'cursor-grab active:cursor-grabbing'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0 pointer-events-none">
                  <LayoutGrid className="w-4 h-4 text-zinc-400 shrink-0" />
                  <span className="font-sans font-semibold text-white text-[14px] tracking-tight truncate">
                    {t.name}
                  </span>
                </div>
                <button
                  type="button"
                  data-table-menu-trigger={t.name}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveColumnMenu(null);
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
                  const isPk = !!col.primary_key;
                  const normName = col.name.toLowerCase();
                  const normType = (col.type || '').toLowerCase();
                  const normDefault = (col.default_value || '').toLowerCase();

                  // Identity: explicit identity field, or serial/identity type, or sequence default, or column named 'id' / ending in '_id' if integer/pk
                  const isIdentity =
                    !!col.identity ||
                    normType.includes('serial') ||
                    normType.includes('identity') ||
                    normDefault.includes('nextval') ||
                    normDefault.includes('identity') ||
                    normName === 'id';

                  // Unique: explicit unique field, or if type/name is explicitly marked unique
                  const isUnique = !!col.unique;

                  return (
                    <div
                      key={col.name}
                      className="h-8 px-3 flex items-center justify-between gap-3 text-[12.5px] hover:bg-[#1e1e22] transition-colors group"
                    >
                      {/* Left: Column Constraint Icon + Column Name */}
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        {isPk ? (
                          <span title="Primary key" className="shrink-0 flex items-center">
                            <Key className="w-3.5 h-3.5 text-amber-400" />
                          </span>
                        ) : isIdentity ? (
                          <span title="Identity" className="shrink-0 flex items-center">
                            <Hash className="w-3.5 h-3.5 text-zinc-400" />
                          </span>
                        ) : isUnique ? (
                          <span title="Unique" className="shrink-0 flex items-center">
                            <Sparkles className="w-3.5 h-3.5 text-zinc-400" />
                          </span>
                        ) : col.nullable ? (
                          <span title="Nullable" className="shrink-0 flex items-center">
                            <svg className="w-3.5 h-3.5 text-zinc-500" viewBox="0 0 12 12" fill="none">
                              <path d="M6 1.5L10.5 6L6 10.5L1.5 6Z" stroke="currentColor" strokeWidth="1.2" />
                            </svg>
                          </span>
                        ) : (
                          <span title="Non-Nullable" className="shrink-0 flex items-center">
                            <svg className="w-3.5 h-3.5 text-zinc-300" viewBox="0 0 12 12" fill="currentColor">
                              <path d="M6 1.5L10.5 6L6 10.5L1.5 6Z" />
                            </svg>
                          </span>
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
                          data-column-menu-trigger={`${t.name}:${col.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveTableMenu(null);
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
            const isSourceHold = holdingTable === rel.sourceTable || selectedTable === rel.sourceTable;
            const isTargetHold = holdingTable === rel.targetTable || selectedTable === rel.targetTable;
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
        className="h-12 shrink-0 px-4 bg-[#0a0a0a] border-t border-[#222222] flex items-center justify-between gap-4 text-[13px] text-[#8c8c8c] z-30 select-none font-sans overflow-x-auto scrollbar-none whitespace-nowrap"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Legend Symbols */}
        <div className="flex items-center gap-4 sm:gap-5 text-[13px] font-sans shrink-0 whitespace-nowrap">
          <div className="flex items-center gap-1.5 shrink-0 whitespace-nowrap">
            <Key className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="text-[#a1a1aa] font-sans whitespace-nowrap">Primary key</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 whitespace-nowrap">
            <Hash className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
            <span className="text-[#a1a1aa] font-sans whitespace-nowrap">Identity</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 whitespace-nowrap">
            <Sparkles className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
            <span className="text-[#a1a1aa] font-sans whitespace-nowrap">Unique</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 whitespace-nowrap">
            <svg className="w-3 h-3 text-zinc-400 shrink-0" viewBox="0 0 12 12" fill="none">
              <path d="M6 1.5L10.5 6L6 10.5L1.5 6Z" stroke="currentColor" strokeWidth="1.3" />
            </svg>
            <span className="text-[#a1a1aa] font-sans whitespace-nowrap">Nullable</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 whitespace-nowrap">
            <svg className="w-3 h-3 text-zinc-300 shrink-0" viewBox="0 0 12 12" fill="currentColor">
              <path d="M6 1.5L10.5 6L6 10.5L1.5 6Z" />
            </svg>
            <span className="text-[#a1a1aa] font-sans whitespace-nowrap">Non-Nullable</span>
          </div>
        </div>

        {/* Right Info */}
        <div className="text-[13px] text-[#8c8c8c] font-sans flex items-center gap-1.5 shrink-0 whitespace-nowrap">
          <span className="whitespace-nowrap">
            Showing <span className="text-white font-medium">{tables.length}</span> tables
            {selectedDb && (
              <> in <span className="text-white font-mono">{selectedDb}</span></>
            )}
          </span>
          <span className="text-[#555555]">·</span>
          <span className="whitespace-nowrap">
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
