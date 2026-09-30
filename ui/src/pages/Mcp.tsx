import React, { useState } from 'react';
import { McpTool } from '../types';
import { DataTable, Column } from '../components/shared/DataTable';
import { SlideOver } from '../components/ui/SlideOver';
import { Button } from '../components/ui/Button';
import { Bot, Copy, Check, Shield, Terminal, Code, Sparkles } from 'lucide-react';

export function Mcp() {
  const [selectedTool, setSelectedTool] = useState<McpTool | null>(null);
  const [inspectOpen, setInspectOpen] = useState(false);
  const [clientTab, setClientTab] = useState<'claude' | 'cursor' | 'curl'>('claude');
  const [copiedCode, setCopiedCode] = useState(false);

  const tools: McpTool[] = [
    {
      name: 'axiom_list_databases',
      description: 'Enumerate all active database connections, dial engine types, and cluster latency.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      permissionRequired: 'pools_view',
    },
    {
      name: 'axiom_list_tables',
      description: 'List user tables in a database pool with schema name and approximate row count.',
      parameters: {
        type: 'object',
        properties: {
          database: { type: 'string', description: 'Database pool alias' },
          cursor: { type: 'integer', description: 'Pagination offset' },
          limit: { type: 'integer', description: 'Max table count' },
        },
        required: ['database'],
      },
      permissionRequired: 'db_select',
    },
    {
      name: 'axiom_describe_table',
      description: 'Retrieve column data types, nullability, primary key, and default expressions.',
      parameters: {
        type: 'object',
        properties: {
          database: { type: 'string', description: 'Database pool alias' },
          table: { type: 'string', description: 'Target table name' },
        },
        required: ['database', 'table'],
      },
      permissionRequired: 'db_schema_describe',
    },
    {
      name: 'axiom_get_foreign_keys',
      description: 'Inspect relational constraints, foreign keys, referenced parent tables, and onDelete cascade rules.',
      parameters: {
        type: 'object',
        properties: {
          database: { type: 'string', description: 'Database pool alias' },
          table: { type: 'string', description: 'Target table name' },
        },
        required: ['database', 'table'],
      },
      permissionRequired: 'db_schema_describe',
    },
    {
      name: 'axiom_query_database',
      description: 'Execute parameterized SQL query. AST-validated against RBAC grants and query mutation policy.',
      parameters: {
        type: 'object',
        properties: {
          database: { type: 'string', description: 'Database pool alias' },
          sql: { type: 'string', description: 'SQL query with positional parameters' },
          params: { type: 'array', description: 'Bound parameter array' },
          timeout: { type: 'integer', description: 'Per-query execution timeout (seconds)' },
        },
        required: ['database', 'sql'],
      },
      permissionRequired: 'db_execute_raw',
    },
    {
      name: 'axiom_explain_query',
      description: 'Analyze SQL execution plan without writing changes to the database.',
      parameters: {
        type: 'object',
        properties: {
          database: { type: 'string', description: 'Database pool alias' },
          sql: { type: 'string', description: 'SQL query to explain' },
        },
        required: ['database', 'sql'],
      },
      permissionRequired: 'db_select',
    },
  ];

  const claudeConfig = JSON.stringify(
    {
      mcpServers: {
        axiom: {
          url: 'http://localhost:4500/mcp/v1',
          headers: {
            'X-Axiom-Key': 'base64(key_name:key_secret)',
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
        'X-Axiom-Key': 'base64(key_name:key_secret)',
      },
    },
    null,
    2
  );

  const curlExample = `curl -X POST http://localhost:4500/mcp/v1 \\
  -H "Content-Type: application/json" \\
  -H "X-Axiom-Key: base64(default_admin:secret)" \\
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "axiom_list_databases",
      "arguments": {}
    }
  }'`;

  const columns: Column<McpTool>[] = [
    {
      id: 'name',
      header: 'MCP Tool Function',
      accessorKey: 'name',
      isSortable: true,
      width: 240,
      cell: (row) => (
        <div className="flex items-center gap-2.5">
          <Bot className="w-4 h-4 text-[#8c8c8c] shrink-0" />
          <span className="font-medium text-white text-[14px]">{row.name}</span>
        </div>
      ),
    },
    {
      id: 'description',
      header: 'Description',
      accessorKey: 'description',
      isFlex: true,
      className: 'px-3',
      cell: (row) => (
        <span className="text-[14px] text-[#8c8c8c] font-normal truncate block" title={row.description}>
          {row.description}
        </span>
      ),
    },
    {
      id: 'permissionRequired',
      header: 'Required Grant',
      accessorKey: 'permissionRequired',
      width: 170,
      className: 'px-3',
      cell: (row) => (
        <span className="text-[14px] text-[#cccccc] font-normal">
          {row.permissionRequired}
        </span>
      ),
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      isFlex: true,
      headerClassName: 'justify-end pr-4 text-right',
      className: 'pl-3 pr-4 justify-end',
      cell: (row) => (
        <div className="flex items-center justify-end w-full">
          <button
            type="button"
            onClick={() => {
              setSelectedTool(row);
              setInspectOpen(true);
            }}
            className="inline-flex items-center justify-center h-7 px-3 rounded-[6px] text-[13px] font-medium leading-none text-white hover:text-white bg-transparent hover:bg-[#1a1a1a] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer shrink-0"
          >
            Inspect Schema &rarr;
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-[16px] font-semibold text-white tracking-tight">MCP</h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#30a46c]/10 border border-[#30a46c]/20 text-[11px] font-medium text-[#30a46c]">
            <span className="size-1.5 rounded-full bg-[#30a46c]" />
            MCP v2024-11-05
          </span>
          <span className="px-2.5 py-1 rounded-md bg-[#161616] border border-[#262626] font-mono text-[11px] text-[#8c8c8c]">
            POST /mcp/v1
          </span>
        </div>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <div className="rounded-lg border border-[#222222] bg-[#0e0e0e] p-4">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-normal text-[#8c8c8c]">Registered Tools</span>
            <span className="size-2 rounded-full bg-[#30a46c]" />
          </div>
          <p className="text-[24px] font-semibold tabular-nums text-white mt-2">{tools.length}</p>
          <p className="text-[12px] text-[#8c8c8c] mt-1">Ready for LLM tool invocation</p>
        </div>

        <div className="rounded-lg border border-[#222222] bg-[#0e0e0e] p-4">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-normal text-[#8c8c8c]">Protocol Engine</span>
            <span className="text-[11px] text-[#3b82f6] font-medium">JSON-RPC 2.0</span>
          </div>
          <p className="text-[24px] font-semibold text-white mt-2">HTTP + SSE</p>
          <p className="text-[12px] text-[#30a46c] mt-1">Streaming responses enabled</p>
        </div>

        <div className="rounded-lg border border-[#222222] bg-[#0e0e0e] p-4">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-normal text-[#8c8c8c]">Security Guarantee</span>
            <span className="text-[11px] text-[#30a46c] font-medium">RBAC Bound</span>
          </div>
          <p className="text-[24px] font-semibold text-white mt-2">Constant-Time</p>
          <p className="text-[12px] text-[#8c8c8c] mt-1">Zero unauthenticated tools</p>
        </div>
      </div>

      {/* Tools DataTable */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-white tracking-tight">Available MCP Tools</h2>
          <span className="text-[12px] text-[#666666]">All tools execute within the caller's role scope</span>
        </div>
        <DataTable
          columns={columns}
          data={tools}
          ariaLabel="MCP Tools Table"
          pagination={{
            page: 1,
            pageSize: 10,
            totalCount: tools.length,
            onPageChange: () => {},
            onPageSizeChange: () => {},
          }}
        />
      </div>

      {/* Client Configuration Setup */}
      <div className="rounded-lg border border-[#222222] bg-[#0e0e0e] p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#222222] pb-3">
          <div>
            <h3 className="text-[14px] font-semibold text-white">AI Agent Connection Config</h3>
            <p className="text-[12px] text-[#8c8c8c] mt-0.5">
              Add Axiom as an MCP Server in Claude Desktop, Cursor IDE, or custom autonomous agents.
            </p>
          </div>
          <div className="flex items-center gap-1.5 p-0.5 rounded-lg bg-[#0c0c0c] border border-[#222222]">
            {(['claude', 'cursor', 'curl'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setClientTab(tab)}
                className={`px-3 py-1.5 text-[12px] font-medium rounded-md transition-colors cursor-pointer capitalize ${
                  clientTab === tab
                    ? 'bg-[#1a1a1a] text-white shadow-xs'
                    : 'text-[#8c8c8c] hover:text-white hover:bg-[#141414]'
                }`}
              >
                {tab === 'claude' ? 'Claude Desktop' : tab === 'cursor' ? 'Cursor IDE' : 'cURL'}
              </button>
            ))}
          </div>
        </div>

        <div className="relative">
          <pre className="rounded-lg border border-[#222222] bg-[#0c0c0c] p-4 text-[12px] font-mono text-[#cccccc] overflow-x-auto">
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
            className="absolute top-3 right-3"
          >
            {copiedCode ? <Check className="w-3.5 h-3.5 text-[#30a46c]" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedCode ? 'Copied' : 'Copy'}</span>
          </Button>
        </div>
      </div>

      {/* Inspect Tool SlideOver */}
      <SlideOver
        isOpen={inspectOpen}
        onClose={() => setInspectOpen(false)}
        title={`MCP Tool: ${selectedTool?.name}`}
        subtitle={selectedTool?.description}
      >
        <div className="flex-1 p-5 overflow-y-auto space-y-4">
          <div className="p-3.5 rounded-lg border border-[#222222] bg-[#141414] space-y-1">
            <span className="text-[11px] text-[#8c8c8c] block uppercase tracking-wider font-semibold">RBAC Security Requirement</span>
            <span className="text-[13px] font-mono text-[#3b82f6] font-semibold">{selectedTool?.permissionRequired}</span>
          </div>

          <div>
            <label className="block text-[12px] font-medium text-[#cccccc] mb-1.5">JSON Schema Input Specification</label>
            <pre className="rounded-lg border border-[#222222] bg-[#0c0c0c] p-3.5 text-[12px] font-mono text-[#cccccc] overflow-x-auto">
              {JSON.stringify(selectedTool?.parameters, null, 2)}
            </pre>
          </div>
        </div>

        <div className="p-4 border-t border-[#222222] bg-[#000000] flex items-center justify-end">
          <Button variant="outline" size="sm" onClick={() => setInspectOpen(false)}>
            Close
          </Button>
        </div>
      </SlideOver>
    </div>
  );
}
