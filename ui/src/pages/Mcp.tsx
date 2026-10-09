/*
 * Model Context Protocol (MCP) server reference and client configuration generator.
 * Owned by: ui/mcp
 * Key deps: SlideOver, Button, lucide-react
 * Invariants: MCP schema matches backend /mcp/v1 tool capabilities and transport specs.
 * Last structural change: Standardized MCP tool catalog and client configuration generation.
 */

import React, { useState } from 'react';
import { SlideOver } from '../components/ui/SlideOver';
import { Button } from '../components/ui/Button';
import { Copy, Check, Plug, Wrench, Database, HardDrive } from 'lucide-react';

interface McpToolItem {
  name: string;
  category: 'database' | 'blob';
  type: 'READ' | 'WRITE';
  description: string;
  permissionRequired: string;
  parameters: {
    type: string;
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required: string[];
  };
}

interface McpResourceItem {
  uri: string;
  category: 'database' | 'blob';
  description: string;
  mimeType: string;
}

export function Mcp() {
  const [activeNav, setActiveNav] = useState<'tools' | 'connect'>('tools');
  const [activeCategory, setActiveCategory] = useState<'database' | 'blob'>('database');
  const [selectedTool, setSelectedTool] = useState<McpToolItem | null>(null);
  const [inspectOpen, setInspectOpen] = useState(false);
  const [clientTab, setClientTab] = useState<'claude' | 'cursor' | 'curl'>('claude');
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedToolExample, setCopiedToolExample] = useState(false);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const tools: McpToolItem[] = [
    // ─── Relational Database Tools (8) ────────────────────────────────────────
    {
      name: 'axiom_list_services',
      category: 'database',
      type: 'READ',
      description: 'Lists all configured database services that the caller is authorized to access',
      permissionRequired: 'pools_view',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    {
      name: 'axiom_list_tables',
      category: 'database',
      type: 'READ',
      description: 'Lists tables in the target database, with pagination support. Filtered by RBAC policies',
      permissionRequired: 'db_select',
      parameters: {
        type: 'object',
        properties: {
          database: { type: 'string', description: 'Database service alias' },
          cursor: { type: 'string', description: 'Optional pagination cursor' },
          limit: { type: 'integer', description: 'Max tables to return (default: 100)' },
        },
        required: ['database'],
      },
    },
    {
      name: 'axiom_describe_table',
      category: 'database',
      type: 'READ',
      description: 'Returns schema metadata for a table including columns, types, nullability, primary keys, and foreign keys',
      permissionRequired: 'db_schema_describe',
      parameters: {
        type: 'object',
        properties: {
          database: { type: 'string', description: 'Database service alias' },
          table: { type: 'string', description: 'Table name to describe' },
        },
        required: ['database', 'table'],
      },
    },
    {
      name: 'axiom_query',
      category: 'database',
      type: 'READ',
      description: 'Executes a structured, dialect-agnostic SELECT query with JSON filters and sorting',
      permissionRequired: 'db_select',
      parameters: {
        type: 'object',
        properties: {
          database: { type: 'string', description: 'Database service alias' },
          table: { type: 'string', description: 'Table name to query' },
          filter: { type: 'object', description: 'JSON filter criteria (e.g. {"status": {"eq": "active"}})' },
          sort: { type: 'string', description: 'Column name to sort by' },
          order: { type: 'string', description: 'Sort direction: asc | desc' },
          limit: { type: 'integer', description: 'Max rows to return (default: 50, max: 500)' },
          cursor: { type: 'string', description: 'Pagination cursor' },
        },
        required: ['database', 'table'],
      },
    },
    {
      name: 'axiom_insert',
      category: 'database',
      type: 'WRITE',
      description: 'Inserts one or more rows into a table using parameterized queries',
      permissionRequired: 'db_insert',
      parameters: {
        type: 'object',
        properties: {
          database: { type: 'string', description: 'Database service alias' },
          table: { type: 'string', description: 'Table name to insert into' },
          rows: { type: 'array', description: 'Array of row objects to insert' },
          row: { type: 'object', description: 'Single row object to insert' },
        },
        required: ['database', 'table'],
      },
    },
    {
      name: 'axiom_update',
      category: 'database',
      type: 'WRITE',
      description: 'Updates rows matching a required filter criteria. Guardrail: rejects unconstrained full-table updates',
      permissionRequired: 'db_update',
      parameters: {
        type: 'object',
        properties: {
          database: { type: 'string', description: 'Database service alias' },
          table: { type: 'string', description: 'Table name to update' },
          filter: { type: 'object', description: 'Filter criteria matching target rows (must not be empty)' },
          data: { type: 'object', description: 'Column key-values to set' },
        },
        required: ['database', 'table', 'filter', 'data'],
      },
    },
    {
      name: 'axiom_delete',
      category: 'database',
      type: 'WRITE',
      description: 'Deletes rows matching a required filter criteria. Guardrail: rejects unconstrained full-table wipes',
      permissionRequired: 'db_delete',
      parameters: {
        type: 'object',
        properties: {
          database: { type: 'string', description: 'Database service alias' },
          table: { type: 'string', description: 'Table name to delete from' },
          filter: { type: 'object', description: 'Filter criteria matching target rows (must not be empty)' },
        },
        required: ['database', 'table', 'filter'],
      },
    },
    {
      name: 'axiom_raw_sql',
      category: 'database',
      type: 'WRITE',
      description: 'Executes raw SQL query against a database. Subject to AST firewall validation and role permission enforcement',
      permissionRequired: 'db_execute_raw',
      parameters: {
        type: 'object',
        properties: {
          database: { type: 'string', description: 'Database service alias' },
          sql: { type: 'string', description: 'Raw SQL query string' },
          params: { type: 'array', description: 'Optional positional parameters' },
        },
        required: ['database', 'sql'],
      },
    },

    // ─── Native Blob Storage Tools (7) ─────────────────────────────────────────
    {
      name: 'axiom_list_blob_namespaces',
      category: 'blob',
      type: 'READ',
      description: 'Discovers all blob storage namespaces authorized for the caller under active RBAC policies',
      permissionRequired: 'blob_read',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    {
      name: 'axiom_list_blobs',
      category: 'blob',
      type: 'READ',
      description: 'Lists stored objects and virtual directories in a blob namespace matching an optional prefix and cursor',
      permissionRequired: 'blob_read',
      parameters: {
        type: 'object',
        properties: {
          namespace: { type: 'string', description: 'Target blob namespace' },
          prefix: { type: 'string', description: 'Optional virtual path prefix (e.g. "reports/" or "images/")' },
          cursor: { type: 'string', description: 'Optional pagination cursor' },
          limit: { type: 'integer', description: 'Max objects to return (default: 50, max: 500)' },
        },
        required: ['namespace'],
      },
    },
    {
      name: 'axiom_get_blob_metadata',
      category: 'blob',
      type: 'READ',
      description: 'Retrieves object metadata (size, MIME type, BLAKE3 hash, storage tier) without fetching payload bytes',
      permissionRequired: 'blob_read',
      parameters: {
        type: 'object',
        properties: {
          namespace: { type: 'string', description: 'Target blob namespace' },
          key: { type: 'string', description: 'Object key / virtual file path' },
        },
        required: ['namespace', 'key'],
      },
    },
    {
      name: 'axiom_read_blob',
      category: 'blob',
      type: 'READ',
      description: 'Reads object contents into context with safety size capping (max 20MB) and Base64 fallback for binary files',
      permissionRequired: 'blob_read',
      parameters: {
        type: 'object',
        properties: {
          namespace: { type: 'string', description: 'Target blob namespace' },
          key: { type: 'string', description: 'Object key / virtual file path' },
          encoding: { type: 'string', enum: ['utf8', 'base64'], description: 'Content encoding (default: utf8)' },
          max_bytes: { type: 'integer', description: 'Maximum bytes to ingest into context (default: 5242880, max: 20971520)' },
        },
        required: ['namespace', 'key'],
      },
    },
    {
      name: 'axiom_write_blob',
      category: 'blob',
      type: 'WRITE',
      description: 'Stores or overwrites a blob object using UTF-8 text or Base64 payload, with optional TTL expiration',
      permissionRequired: 'blob_write',
      parameters: {
        type: 'object',
        properties: {
          namespace: { type: 'string', description: 'Target blob namespace' },
          key: { type: 'string', description: 'Object key / path (e.g. "reports/summary.md")' },
          content: { type: 'string', description: 'File payload as UTF-8 text or Base64 string' },
          encoding: { type: 'string', enum: ['utf8', 'base64'], description: 'Payload encoding (default: utf8)' },
          content_type: { type: 'string', description: 'MIME type (e.g. "text/markdown" or "image/png")' },
          ttl_seconds: { type: 'integer', description: 'Optional time-to-live in seconds for automatic deletion' },
        },
        required: ['namespace', 'key', 'content'],
      },
    },
    {
      name: 'axiom_delete_blob',
      category: 'blob',
      type: 'WRITE',
      description: 'Permanently deletes an object key from the specified namespace. Enforced under RBAC DELETE policy',
      permissionRequired: 'blob_delete',
      parameters: {
        type: 'object',
        properties: {
          namespace: { type: 'string', description: 'Target blob namespace' },
          key: { type: 'string', description: 'Object key to delete' },
        },
        required: ['namespace', 'key'],
      },
    },
    {
      name: 'axiom_create_download_ticket',
      category: 'blob',
      type: 'READ',
      description: 'Generates a time-bounded cryptographic pre-signed capability download ticket URL for human users or direct retrieval',
      permissionRequired: 'blob_read',
      parameters: {
        type: 'object',
        properties: {
          namespace: { type: 'string', description: 'Target blob namespace' },
          key: { type: 'string', description: 'Target object key' },
          operation: { type: 'string', enum: ['READ', 'WRITE'], description: 'Authorized capability operation (default: READ)' },
          ttl_seconds: { type: 'integer', description: 'Ticket validity in seconds (default: 3600, max: 86400)' },
        },
        required: ['namespace', 'key'],
      },
    },
  ];

  const resources: McpResourceItem[] = [
    {
      uri: 'axiom://services',
      category: 'database',
      description: 'Catalog of active database services and operational health',
      mimeType: 'application/json',
    },
    {
      uri: 'axiom://schema/{database}',
      category: 'database',
      description: 'Table definitions and schema metadata for target database',
      mimeType: 'application/json',
    },
    {
      uri: 'axiom://blobs',
      category: 'blob',
      description: 'Catalog of active blob storage namespaces and storage telemetry',
      mimeType: 'application/json',
    },
    {
      uri: 'axiom://blobs/{namespace}',
      category: 'blob',
      description: 'Listing of stored objects and virtual directories in target namespace',
      mimeType: 'application/json',
    },
    {
      uri: 'axiom://blob/{namespace}/{key}',
      category: 'blob',
      description: 'Direct object content retrieval with MIME type and binary fallback',
      mimeType: 'application/octet-stream',
    },
  ];

  const claudeConfig = JSON.stringify(
    {
      mcpServers: {
        axiom: {
          url: 'http://localhost:4500/mcp/v1',
          headers: {
            'X-Axiom-Key': 'base64(agent_key:key_secret)',
          },
        },
      },
    },
    null,
    2
  );

  const cursorConfig = JSON.stringify(
    {
      name: 'axiom-gateway',
      type: 'sse',
      url: 'http://localhost:4500/mcp/v1/sse',
      headers: {
        'X-Axiom-Key': 'base64(agent_key:key_secret)',
      },
    },
    null,
    2
  );

  const curlExample = `curl -X POST http://localhost:4500/mcp/v1 \\
  -H "Content-Type: application/json" \\
  -H "X-Axiom-Key: base64(agent_key:key_secret)" \\
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "axiom_list_services",
      "arguments": {}
    }
  }'`;

  return (
    <div className="w-full max-w-[1600px] mx-auto pb-12 select-none font-sans space-y-6">
      {/* Top Header */}
      <div className="space-y-1">
        <h1 className="text-[16px] font-medium text-white tracking-tight">MCP Server</h1>
        <p className="text-[13px] text-[#8c8c8c]">
          Connect AI assistants to your databases via the Model Context Protocol
        </p>
      </div>

      {/* Main Two-Column Layout */}
      <div className="flex flex-col md:flex-row gap-5 items-start">
        {/* Left Sub-Navigation */}
        <div className="w-full md:w-48 shrink-0 flex md:flex-col gap-1 font-sans">
          <button
            type="button"
            onClick={() => setActiveNav('tools')}
            className={`group w-full h-8 flex items-center gap-2 px-2.5 rounded-[6px] text-[13px] transition-all cursor-pointer text-left ${
              activeNav === 'tools'
                ? 'bg-[#14151a] text-white border border-[#3b82f6]/40 shadow-xs font-medium'
                : 'text-[#8c8c8c] hover:text-white hover:bg-[#141414] border border-transparent font-normal'
            }`}
          >
            <Wrench
              className={`w-3.5 h-3.5 shrink-0 transition-colors ${
                activeNav === 'tools' ? 'text-[#60a5fa]' : 'text-[#737373] group-hover:text-white'
              }`}
            />
            <span>Tools</span>
            <span
              className={`ml-auto text-[11px] font-mono transition-colors ${
                activeNav === 'tools'
                  ? 'text-[#60a5fa]'
                  : 'text-[#737373] group-hover:text-[#a3a3a3]'
              }`}
            >
              {tools.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveNav('connect')}
            className={`group w-full h-8 flex items-center gap-2 px-2.5 rounded-[6px] text-[13px] transition-all cursor-pointer text-left ${
              activeNav === 'connect'
                ? 'bg-[#14151a] text-white border border-[#3b82f6]/40 shadow-xs font-medium'
                : 'text-[#8c8c8c] hover:text-white hover:bg-[#141414] border border-transparent font-normal'
            }`}
          >
            <Plug
              className={`w-3.5 h-3.5 shrink-0 transition-colors ${
                activeNav === 'connect' ? 'text-[#60a5fa]' : 'text-[#737373] group-hover:text-white'
              }`}
            />
            <span>Connect</span>
          </button>
        </div>

        {/* Right Main Content */}
        <div className="flex-1 w-full min-w-0">
          {/* TAB 1: TOOLS */}
          {activeNav === 'tools' && (
            <div className="space-y-5">
              {/* Available Tools Card */}
              <div className="rounded-[10px] border border-[#1e2025] bg-[#0c0d10] p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <h2 className="text-[15px] font-medium text-white tracking-tight">Available Tools</h2>
                    <p className="text-[12px] text-[#8c8c8c]">
                      {activeCategory === 'database'
                        ? 'Relational SQL query and database schema inspection tools'
                        : 'Object storage ingestion, chunked streaming, and capability ticket tools'}
                    </p>
                  </div>

                  {/* Clean Two-Way Segmented Switcher */}
                  <div className="inline-flex items-center p-0.5 rounded-[6px] bg-[#08090c] border border-[#1e2025]">
                    <button
                      type="button"
                      onClick={() => setActiveCategory('database')}
                      className={`h-7 px-3 text-[12px] rounded-[5px] transition-colors cursor-pointer flex items-center gap-1.5 ${
                        activeCategory === 'database'
                          ? 'bg-[#181920] text-white shadow-xs font-medium'
                          : 'text-[#8c8c8c] hover:text-white font-normal'
                      }`}
                    >
                      <Database className="w-3.5 h-3.5 text-[#60a5fa]" />
                      <span>Database</span>
                      <span className={`text-[11px] font-mono ${activeCategory === 'database' ? 'text-[#93c5fd]' : 'text-[#71717a]'}`}>
                        {tools.filter((t) => t.category === 'database').length}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveCategory('blob')}
                      className={`h-7 px-3 text-[12px] rounded-[5px] transition-colors cursor-pointer flex items-center gap-1.5 ${
                        activeCategory === 'blob'
                          ? 'bg-[#181920] text-white shadow-xs font-medium'
                          : 'text-[#8c8c8c] hover:text-white font-normal'
                      }`}
                    >
                      <HardDrive className="w-3.5 h-3.5 text-[#eab308]" />
                      <span>Blob Storage</span>
                      <span className={`text-[11px] font-mono ${activeCategory === 'blob' ? 'text-[#fde047]' : 'text-[#71717a]'}`}>
                        {tools.filter((t) => t.category === 'blob').length}
                      </span>
                    </button>
                  </div>
                </div>

                {/* Tools List */}
                <div className="space-y-2">
                  {tools
                    .filter((tool) => tool.category === activeCategory)
                    .map((tool) => (
                      <div
                        key={tool.name}
                        onClick={() => {
                          setSelectedTool(tool);
                          setInspectOpen(true);
                        }}
                        className="group rounded-[8px] border border-[#1e2025] bg-[#08090c] hover:bg-[#0c0d12] hover:border-[#2a2c35] p-3 flex items-start gap-3 transition-all cursor-pointer"
                      >
                        <span
                          className={`inline-flex items-center justify-center px-2 py-0.5 rounded-[4px] text-[11px] font-medium shrink-0 mt-0.5 ${
                            tool.type === 'READ'
                              ? 'bg-[#072714] text-[#34d399] border border-[#059669]/30'
                              : 'bg-[#2b1704] text-[#fb923c] border border-[#ea580c]/30'
                          }`}
                        >
                          {tool.type === 'READ' ? 'Read' : 'Write'}
                        </span>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[13px] font-mono font-medium text-white group-hover:text-[#60a5fa] transition-colors">
                              {tool.name}
                            </span>
                            <span className="text-[11px] font-mono text-[#71717a] group-hover:text-[#8c8c8c] transition-colors">
                              grant: {tool.permissionRequired}
                            </span>
                          </div>
                          <p className="text-[12px] font-normal text-[#8c8c8c] mt-0.5 leading-relaxed">
                            {tool.description}
                          </p>
                        </div>
                      </div>
                    ))}
                </div>
              </div>

              {/* Resources Card */}
              <div className="rounded-[10px] border border-[#1e2025] bg-[#0c0d10] p-5 space-y-4">
                <div className="space-y-0.5">
                  <h2 className="text-[15px] font-medium text-white tracking-tight">Resources</h2>
                  <p className="text-[12px] text-[#8c8c8c]">
                    {activeCategory === 'database'
                      ? 'Contextual schema and service metadata URIs for AI agents'
                      : 'Contextual namespace and object payload URIs for AI agents'}
                  </p>
                </div>

                <div className="space-y-2">
                  {resources
                    .filter((res) => res.category === activeCategory)
                    .map((res) => (
                      <div
                        key={res.uri}
                        className="rounded-[8px] border border-[#1e2025] bg-[#08090c] hover:border-[#2a2c35] p-3 flex items-start gap-3 transition-all"
                      >
                        <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-[4px] bg-[#0c1f3d] text-[#60a5fa] border border-[#2563eb]/30 text-[11px] font-medium shrink-0 mt-0.5">
                          Resource
                        </span>

                        <div className="flex-1 min-w-0">
                          <span className="text-[12px] font-mono text-white">
                            {res.uri}
                          </span>
                          <p className="text-[12px] font-normal text-[#8c8c8c] mt-0.5 leading-relaxed">
                            {res.description}
                          </p>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: CONNECT */}
          {activeNav === 'connect' && (
            <div className="space-y-5">
              <div className="rounded-[10px] border border-[#1e2025] bg-[#0c0d10] p-5 space-y-4 overflow-hidden">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 -mx-5 -mt-5 px-5 py-3.5 border-b border-[#1e2025]">
                  <div>
                    <h2 className="text-[15px] font-medium text-white">Client Configuration</h2>
                    <p className="text-[12px] text-[#8c8c8c] mt-0.5">
                      Add Axiom to your AI development environment with one click
                    </p>
                  </div>
                  <div className="flex items-center gap-1 p-0.5 rounded-[6px] bg-[#08090c] border border-[#1f2127]">
                    {(['claude', 'cursor', 'curl'] as const).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setClientTab(tab)}
                        className={`px-2.5 py-1 text-[12px] rounded-[5px] transition-colors cursor-pointer capitalize ${
                          clientTab === tab
                            ? 'bg-[#1a1b22] text-white shadow-xs font-medium'
                            : 'text-[#8c8c8c] hover:text-white hover:bg-[#14151a] font-normal'
                        }`}
                      >
                        {tab === 'claude' ? 'Claude Desktop' : tab === 'cursor' ? 'Cursor IDE' : 'cURL'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="relative">
                  <pre className="rounded-[8px] border border-[#1e2025] bg-[#08090c] p-3.5 text-[12px] font-mono text-[#cccccc] overflow-x-auto leading-relaxed">
                    {clientTab === 'claude' && claudeConfig}
                    {clientTab === 'cursor' && cursorConfig}
                    {clientTab === 'curl' && curlExample}
                  </pre>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      const text =
                        clientTab === 'claude' ? claudeConfig : clientTab === 'cursor' ? cursorConfig : curlExample;
                      navigator.clipboard.writeText(text);
                      setCopiedCode(true);
                      setTimeout(() => setCopiedCode(false), 2000);
                    }}
                    className="absolute top-2.5 right-2.5"
                  >
                    {copiedCode ? <Check className="w-3.5 h-3.5 text-[#30a46c]" /> : <Copy className="w-3.5 h-3.5" />}
                    <span className="text-[12px]">{copiedCode ? 'Copied' : 'Copy Config'}</span>
                  </Button>
                </div>

                <div className="rounded-[8px] bg-[#08090c] border border-[#1e2025] overflow-hidden">
                  <div className="px-3.5 py-2.5 border-b border-[#16181e] flex items-center justify-between">
                    <h4 className="text-[13px] font-medium text-white">Config File Locations</h4>
                    <span className="text-[12px] font-normal text-[#8c8c8c]">Target files to paste configuration</span>
                  </div>

                  <div className="divide-y divide-[#13141a]">
                    {[
                      {
                        os: 'macOS',
                        target: 'Claude Desktop',
                        path: '~/Library/Application Support/Claude/claude_desktop_config.json',
                      },
                      {
                        os: 'Windows',
                        target: 'Claude Desktop',
                        path: '%APPDATA%\\Claude\\claude_desktop_config.json',
                      },
                      {
                        os: 'Cursor',
                        target: 'Workspace root',
                        path: '.cursor/mcp.json',
                      },
                    ].map((item) => (
                      <div
                        key={item.os}
                        className="px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-[#0c0d12] transition-colors"
                      >
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[12px] font-medium text-white min-w-[64px]">{item.os}</span>
                          <span className="text-[12px] text-[#8c8c8c] font-normal">({item.target})</span>
                        </div>

                        <div className="flex items-center gap-2 min-w-0 flex-1 sm:justify-end">
                          <code className="text-[12px] font-mono text-[#e4e4e7] bg-[#0e0f14] border border-[#1e2025] px-2 py-1 rounded-[5px] truncate max-w-full select-all">
                            {item.path}
                          </code>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(item.path);
                              setCopiedPath(item.os);
                              setTimeout(() => setCopiedPath(null), 1800);
                            }}
                            className="p-1 text-[#8c8c8c] hover:text-white hover:bg-[#1a1c22] rounded-[4px] transition-colors shrink-0 cursor-pointer"
                            title={`Copy ${item.os} path`}
                          >
                            {copiedPath === item.os ? (
                              <Check className="w-3.5 h-3.5 text-[#34d399]" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Inspect Tool SlideOver */}
      <SlideOver
        isOpen={inspectOpen}
        onClose={() => setInspectOpen(false)}
        width="w-[500px] max-w-full"
        title={
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`px-2 py-0.5 rounded-[4px] text-[11px] font-medium ${
                selectedTool?.type === 'READ'
                  ? 'bg-[#072714] text-[#34d399] border border-[#059669]/30'
                  : 'bg-[#2b1704] text-[#fb923c] border border-[#ea580c]/30'
              }`}
            >
              {selectedTool?.type === 'READ' ? 'Read' : 'Write'}
            </span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded border font-normal flex items-center gap-1 ${
                selectedTool?.category === 'blob'
                  ? 'bg-[#181507] text-[#eab308] border-[#854d0e]/30'
                  : 'bg-[#0c1524] text-[#60a5fa] border-[#1d4ed8]/30'
              }`}
            >
              {selectedTool?.category === 'blob' ? (
                <>
                  <HardDrive className="w-2.5 h-2.5" />
                  <span>Blob Storage</span>
                </>
              ) : (
                <>
                  <Database className="w-2.5 h-2.5" />
                  <span>Database</span>
                </>
              )}
            </span>
            <span className="text-white text-[15px] font-medium">{selectedTool?.name}</span>
          </div>
        }
        subtitle={selectedTool?.description}
      >
        <div className="flex-1 p-4 overflow-y-auto space-y-4 font-sans">
          {/* Metadata Card */}
          <div className="p-3 rounded-[8px] border border-[#1e2025] bg-[#08090c] flex items-center justify-between gap-3">
            <span className="text-[12px] text-[#8c8c8c] font-normal">
              Required Permission Grant
            </span>
            <span className="text-[11px] font-mono text-[#60a5fa] bg-[#0d1f3d] border border-[#1d4ed8]/30 px-2 py-0.5 rounded-[4px]">
              {selectedTool?.permissionRequired}
            </span>
          </div>

          {/* Parameters Section */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-medium text-white">Parameters</h3>
              <span className="text-[12px] text-[#8c8c8c] font-normal">
                {Object.keys(selectedTool?.parameters.properties || {}).length === 0
                  ? 'None'
                  : `${Object.keys(selectedTool?.parameters.properties || {}).length} arguments`}
              </span>
            </div>

            {Object.keys(selectedTool?.parameters.properties || {}).length === 0 ? (
              <div className="p-3.5 rounded-[8px] border border-[#1e2025] bg-[#08090c] text-[12px] text-[#8c8c8c] text-center">
                This tool takes no parameters.
              </div>
            ) : (
              <div className="rounded-[8px] border border-[#1e2025] bg-[#08090c] divide-y divide-[#16181e] overflow-hidden">
                {Object.entries(selectedTool?.parameters.properties || {}).map(([paramName, prop]) => {
                  const isRequired = selectedTool?.parameters.required.includes(paramName);
                  return (
                    <div key={paramName} className="p-3 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] font-mono font-medium text-white">{paramName}</span>
                          <span className="text-[11px] font-mono text-[#a1a1aa] bg-[#14151a] px-1.5 py-0.5 rounded">
                            {prop.type}
                          </span>
                        </div>
                        {isRequired ? (
                          <span className="text-[10px] font-medium text-[#f87171] bg-[#450a0a]/50 border border-[#b91c1c]/40 px-1.5 py-0.5 rounded-[4px]">
                            Required
                          </span>
                        ) : (
                          <span className="text-[10px] font-normal text-[#8c8c8c] bg-[#16171d] px-1.5 py-0.5 rounded-[4px]">
                            Optional
                          </span>
                        )}
                      </div>
                      <p className="text-[12px] text-[#8c8c8c] font-normal leading-relaxed">
                        {prop.description}
                      </p>
                      {prop.enum && (
                        <div className="text-[11px] text-[#8c8c8c] flex items-center gap-1.5 pt-0.5">
                          <span>Allowed values:</span>
                          <span className="font-mono text-[#d4d4d8]">{prop.enum.join(' | ')}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Example JSON-RPC Invocation */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-medium text-white">JSON-RPC Example</h3>
              <button
                type="button"
                onClick={() => {
                  if (!selectedTool) return;
                  const exampleJson = JSON.stringify(
                    {
                      jsonrpc: '2.0',
                      id: 1,
                      method: 'tools/call',
                      params: {
                        name: selectedTool.name,
                        arguments: Object.fromEntries(
                          Object.entries(selectedTool.parameters.properties).map(([k, v]) => [
                            k,
                            v.type === 'integer' ? 100 : v.type === 'object' ? {} : `<${k}>`,
                          ])
                        ),
                      },
                    },
                    null,
                    2
                  );
                  navigator.clipboard.writeText(exampleJson);
                  setCopiedToolExample(true);
                  setTimeout(() => setCopiedToolExample(false), 2000);
                }}
                className="inline-flex items-center gap-1.5 text-[12px] text-[#8c8c8c] hover:text-white transition-colors cursor-pointer"
              >
                {copiedToolExample ? (
                  <>
                    <Check className="w-3 h-3 text-[#34d399]" />
                    <span className="text-[#34d399]">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span>Copy JSON</span>
                  </>
                )}
              </button>
            </div>

            <pre className="rounded-[8px] border border-[#1e2025] bg-[#08090c] p-3 text-[12px] font-mono text-[#cccccc] overflow-x-auto leading-relaxed">
              {JSON.stringify(
                {
                  jsonrpc: '2.0',
                  id: 1,
                  method: 'tools/call',
                  params: {
                    name: selectedTool?.name,
                    arguments: Object.fromEntries(
                      Object.entries(selectedTool?.parameters.properties || {}).map(([k, v]) => [
                        k,
                        v.type === 'integer' ? 100 : v.type === 'object' ? {} : `<${k}>`,
                      ])
                    ),
                  },
                },
                null,
                2
              )}
            </pre>
          </div>
        </div>

        <div className="p-3.5 border-t border-[#1e2025] bg-[#0c0d10] flex items-center justify-end">
          <Button variant="outline" size="sm" onClick={() => setInspectOpen(false)}>
            Close
          </Button>
        </div>
      </SlideOver>
    </div>
  );
}
