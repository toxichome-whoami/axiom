/*
 * Model Context Protocol (MCP) server reference and client configuration generator.
 * Owned by: ui/mcp
 * Key deps: SlideOver, Button, lucide-react
 * Invariants: MCP schema matches backend /mcp/v1 tool capabilities and transport specs.
 * Last structural change: Standardized on Axiom pure dark neutral palette, horizontal tab navigation, and 13px typography.
 */

import React, { useState, useMemo } from "react";
import { SlideOver } from "../components/ui/SlideOver";
import { Button } from "../components/ui/Button";
import {
  Copy,
  Check,
  Plug,
  Wrench,
  Database,
  HardDrive,
  Search,
  Bot,
  ExternalLink,
  Terminal,
  FileCode,
  Shield,
  Layers,
  ChevronRight,
} from "lucide-react";

interface McpToolItem {
  name: string;
  category: "database" | "blob";
  type: "READ" | "WRITE";
  description: string;
  permissionRequired: string;
  parameters: {
    type: string;
    properties: Record<
      string,
      { type: string; description: string; enum?: string[] }
    >;
    required: string[];
  };
}

interface McpResourceItem {
  uri: string;
  category: "database" | "blob";
  description: string;
  mimeType: string;
}

/**
 * Formats JSON strings with dark syntax highlighting (VS Code/GitHub Dark style).
 */
function highlightJson(json: string): React.ReactNode {
  const tokenRegex =
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\\-]?\d+)?|[{}[\],])/g;
  const elements: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(json)) !== null) {
    if (match.index > lastIndex) {
      elements.push(json.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.endsWith(":")) {
      const key = token.slice(0, -1);
      elements.push(
        <span key={match.index} className="text-[#9cdcfe]">
          {key}
        </span>,
      );
      elements.push(
        <span key={`${match.index}-colon`} className="text-[#737373]">
          :
        </span>,
      );
    } else if (token.startsWith('"')) {
      elements.push(
        <span key={match.index} className="text-[#ce9178]">
          {token}
        </span>,
      );
    } else if (/^(true|false|null)$/.test(token)) {
      elements.push(
        <span key={match.index} className="text-[#569cd6]">
          {token}
        </span>,
      );
    } else if (/^-?\d/.test(token)) {
      elements.push(
        <span key={match.index} className="text-[#b5cea8]">
          {token}
        </span>,
      );
    } else {
      elements.push(
        <span key={match.index} className="text-[#737373]">
          {token}
        </span>,
      );
    }
    lastIndex = tokenRegex.lastIndex;
  }
  if (lastIndex < json.length) {
    elements.push(json.slice(lastIndex));
  }
  return <>{elements}</>;
}

export function Mcp() {
  const [activeTab, setActiveTab] = useState<"tools" | "resources" | "connect">(
    "tools",
  );
  const [activeCategory, setActiveCategory] = useState<
    "all" | "database" | "blob"
  >("all");
  const [activeType, setActiveType] = useState<"all" | "READ" | "WRITE">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTool, setSelectedTool] = useState<McpToolItem | null>(null);
  const [inspectOpen, setInspectOpen] = useState(false);
  const [clientTab, setClientTab] = useState<"claude" | "cursor" | "curl">(
    "claude",
  );
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedToolExample, setCopiedToolExample] = useState(false);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const tools: McpToolItem[] = [
    // ─── Relational Database Tools (8) ────────────────────────────────────────
    {
      name: "axiom_list_services",
      category: "database",
      type: "READ",
      description: "List all database connections you have access to",
      permissionRequired: "pools_view",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    {
      name: "axiom_list_tables",
      category: "database",
      type: "READ",
      description: "List tables in a database with pagination",
      permissionRequired: "db_select",
      parameters: {
        type: "object",
        properties: {
          database: { type: "string", description: "Database name" },
          cursor: { type: "string", description: "Pagination cursor" },
          limit: {
            type: "integer",
            description: "Maximum tables to return (default: 100)",
          },
        },
        required: ["database"],
      },
    },
    {
      name: "axiom_describe_table",
      category: "database",
      type: "READ",
      description: "Show columns, data types, and keys for a table",
      permissionRequired: "db_schema_describe",
      parameters: {
        type: "object",
        properties: {
          database: { type: "string", description: "Database name" },
          table: { type: "string", description: "Table name" },
        },
        required: ["database", "table"],
      },
    },
    {
      name: "axiom_query",
      category: "database",
      type: "READ",
      description: "Query table rows with optional filters and sorting",
      permissionRequired: "db_select",
      parameters: {
        type: "object",
        properties: {
          database: { type: "string", description: "Database name" },
          table: { type: "string", description: "Table name" },
          filter: {
            type: "object",
            description:
              'JSON filter criteria (e.g. {"status": {"eq": "active"}})',
          },
          sort: { type: "string", description: "Column to sort by" },
          order: { type: "string", description: "Sort direction: asc or desc" },
          limit: {
            type: "integer",
            description: "Maximum rows to return (default: 50, max: 500)",
          },
          cursor: { type: "string", description: "Pagination cursor" },
        },
        required: ["database", "table"],
      },
    },
    {
      name: "axiom_insert",
      category: "database",
      type: "WRITE",
      description: "Insert one or more rows into a table",
      permissionRequired: "db_insert",
      parameters: {
        type: "object",
        properties: {
          database: { type: "string", description: "Database name" },
          table: { type: "string", description: "Table name" },
          rows: { type: "array", description: "Array of rows to insert" },
          row: { type: "object", description: "Single row to insert" },
        },
        required: ["database", "table"],
      },
    },
    {
      name: "axiom_update",
      category: "database",
      type: "WRITE",
      description: "Update rows matching a filter",
      permissionRequired: "db_update",
      parameters: {
        type: "object",
        properties: {
          database: { type: "string", description: "Database name" },
          table: { type: "string", description: "Table name" },
          filter: {
            type: "object",
            description: "Filter criteria matching target rows",
          },
          data: { type: "object", description: "Column values to update" },
        },
        required: ["database", "table", "filter", "data"],
      },
    },
    {
      name: "axiom_delete",
      category: "database",
      type: "WRITE",
      description: "Delete rows matching a filter",
      permissionRequired: "db_delete",
      parameters: {
        type: "object",
        properties: {
          database: { type: "string", description: "Database name" },
          table: { type: "string", description: "Table name" },
          filter: {
            type: "object",
            description: "Filter criteria matching target rows",
          },
        },
        required: ["database", "table", "filter"],
      },
    },
    {
      name: "axiom_raw_sql",
      category: "database",
      type: "WRITE",
      description: "Execute a raw SQL query against a database",
      permissionRequired: "db_execute_raw",
      parameters: {
        type: "object",
        properties: {
          database: { type: "string", description: "Database name" },
          sql: { type: "string", description: "SQL query string" },
          params: { type: "array", description: "Positional query parameters" },
        },
        required: ["database", "sql"],
      },
    },

    // ─── Native Blob Storage Tools (7) ─────────────────────────────────────────
    {
      name: "axiom_list_blob_namespaces",
      category: "blob",
      type: "READ",
      description: "List accessible storage buckets",
      permissionRequired: "blob_read",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    {
      name: "axiom_list_blobs",
      category: "blob",
      type: "READ",
      description: "List files in a storage bucket",
      permissionRequired: "blob_read",
      parameters: {
        type: "object",
        properties: {
          namespace: { type: "string", description: "Storage bucket name" },
          prefix: { type: "string", description: "Folder or file path prefix" },
          cursor: { type: "string", description: "Pagination cursor" },
          limit: {
            type: "integer",
            description: "Maximum files to return (default: 50, max: 500)",
          },
        },
        required: ["namespace"],
      },
    },
    {
      name: "axiom_get_blob_metadata",
      category: "blob",
      type: "READ",
      description:
        "Get file details (size, MIME type, hash) without downloading content",
      permissionRequired: "blob_read",
      parameters: {
        type: "object",
        properties: {
          namespace: { type: "string", description: "Storage bucket name" },
          key: { type: "string", description: "File path or key" },
        },
        required: ["namespace", "key"],
      },
    },
    {
      name: "axiom_read_blob",
      category: "blob",
      type: "READ",
      description: "Read file contents as text or base64",
      permissionRequired: "blob_read",
      parameters: {
        type: "object",
        properties: {
          namespace: { type: "string", description: "Storage bucket name" },
          key: { type: "string", description: "File path or key" },
          encoding: {
            type: "string",
            enum: ["utf8", "base64"],
            description: "Encoding: utf8 or base64 (default: utf8)",
          },
          max_bytes: {
            type: "integer",
            description: "Maximum bytes to read (default: 5MB, max: 20MB)",
          },
        },
        required: ["namespace", "key"],
      },
    },
    {
      name: "axiom_write_blob",
      category: "blob",
      type: "WRITE",
      description: "Upload or update a file in a storage bucket",
      permissionRequired: "blob_write",
      parameters: {
        type: "object",
        properties: {
          namespace: { type: "string", description: "Storage bucket name" },
          key: {
            type: "string",
            description: "File path or key (e.g. reports/summary.md)",
          },
          content: {
            type: "string",
            description: "File contents (text or base64)",
          },
          encoding: {
            type: "string",
            enum: ["utf8", "base64"],
            description: "Payload encoding (default: utf8)",
          },
          content_type: {
            type: "string",
            description: "MIME type (e.g. text/markdown, image/png)",
          },
          ttl_seconds: {
            type: "integer",
            description: "Expiration in seconds before auto-deletion",
          },
        },
        required: ["namespace", "key", "content"],
      },
    },
    {
      name: "axiom_delete_blob",
      category: "blob",
      type: "WRITE",
      description: "Delete a file from a storage bucket",
      permissionRequired: "blob_delete",
      parameters: {
        type: "object",
        properties: {
          namespace: { type: "string", description: "Storage bucket name" },
          key: { type: "string", description: "File path or key to delete" },
        },
        required: ["namespace", "key"],
      },
    },
    {
      name: "axiom_create_download_ticket",
      category: "blob",
      type: "READ",
      description: "Create a temporary download link for a file",
      permissionRequired: "blob_read",
      parameters: {
        type: "object",
        properties: {
          namespace: { type: "string", description: "Storage bucket name" },
          key: { type: "string", description: "File path or key" },
          operation: {
            type: "string",
            enum: ["READ", "WRITE"],
            description: "Authorized operation: READ or WRITE",
          },
          ttl_seconds: {
            type: "integer",
            description: "Link validity in seconds (default: 3600, max: 86400)",
          },
        },
        required: ["namespace", "key"],
      },
    },
  ];

  const resources: McpResourceItem[] = [
    {
      uri: "axiom://services",
      category: "database",
      description: "List of configured databases and connection status",
      mimeType: "application/json",
    },
    {
      uri: "axiom://schema/{database}",
      category: "database",
      description: "Table schemas for a database",
      mimeType: "application/json",
    },
    {
      uri: "axiom://blobs",
      category: "blob",
      description: "List of storage buckets",
      mimeType: "application/json",
    },
    {
      uri: "axiom://blobs/{namespace}",
      category: "blob",
      description: "Files in a storage bucket",
      mimeType: "application/json",
    },
    {
      uri: "axiom://blob/{namespace}/{key}",
      category: "blob",
      description: "Direct file contents",
      mimeType: "application/octet-stream",
    },
  ];

  const filteredTools = useMemo(() => {
    return tools.filter((tool) => {
      const matchCat =
        activeCategory === "all" || tool.category === activeCategory;
      const matchType = activeType === "all" || tool.type === activeType;
      const matchQuery =
        !searchQuery.trim() ||
        tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        tool.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        tool.permissionRequired
          .toLowerCase()
          .includes(searchQuery.toLowerCase());
      return matchCat && matchType && matchQuery;
    });
  }, [tools, activeCategory, activeType, searchQuery]);

  const claudeConfig = JSON.stringify(
    {
      mcpServers: {
        axiom: {
          url: "http://localhost:4500/mcp/v1",
          headers: {
            "X-Axiom-Key": "base64(agent_key:key_secret)",
          },
        },
      },
    },
    null,
    2,
  );

  const cursorConfig = JSON.stringify(
    {
      name: "axiom-gateway",
      type: "sse",
      url: "http://localhost:4500/mcp/v1/sse",
      headers: {
        "X-Axiom-Key": "base64(agent_key:key_secret)",
      },
    },
    null,
    2,
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
        <h1 className="text-[16px] font-medium text-white tracking-tight">
          MCP Protocol
        </h1>
        <p className="text-[13px] text-[#8c8c8c] font-normal">
          Model Context Protocol server for Claude Desktop, Cursor, and AI
          agents
        </p>
      </div>

      {/* Top Segmented Navigation Tabs */}
      <div className="flex items-center gap-1 p-0.5 rounded-[8px] bg-[#0c0c0c] border border-[#262626] w-fit font-sans">
        <button
          type="button"
          onClick={() => setActiveTab("tools")}
          className={`flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[13px] font-medium transition-colors cursor-pointer outline-none ${
            activeTab === "tools"
              ? "bg-[#161616] text-white border border-[#333333]"
              : "text-[#8c8c8c] hover:text-white hover:bg-[#141414] border border-transparent"
          }`}
        >
          <Wrench className="w-3.5 h-3.5 shrink-0" />
          <span>Tools</span>
          <span className="ml-1 text-[11px] font-sans tabular-nums px-1.5 py-0.5 rounded bg-[#1a1a1a] text-[#8c8c8c]">
            {tools.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("resources")}
          className={`flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[13px] font-medium transition-colors cursor-pointer outline-none ${
            activeTab === "resources"
              ? "bg-[#161616] text-white border border-[#333333]"
              : "text-[#8c8c8c] hover:text-white hover:bg-[#141414] border border-transparent"
          }`}
        >
          <FileCode className="w-3.5 h-3.5 shrink-0" />
          <span>Resources</span>
          <span className="ml-1 text-[11px] font-sans tabular-nums px-1.5 py-0.5 rounded bg-[#1a1a1a] text-[#8c8c8c]">
            {resources.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("connect")}
          className={`flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[13px] font-medium transition-colors cursor-pointer outline-none ${
            activeTab === "connect"
              ? "bg-[#161616] text-white border border-[#333333]"
              : "text-[#8c8c8c] hover:text-white hover:bg-[#141414] border border-transparent"
          }`}
        >
          <Plug className="w-3.5 h-3.5 shrink-0" />
          <span>Client Setup</span>
        </button>
      </div>

      {/* TAB 1: TOOLS */}
      {activeTab === "tools" && (
        <div className="space-y-4">
          {/* Filter & Search Bar */}
          <div className="rounded-[8px] border border-[#262626] bg-[#0c0c0c] p-3 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            {/* Search Input */}
            <div className="relative flex-1 min-w-0">
              <Search className="w-3.5 h-3.5 text-[#8c8c8c] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search tools by name, description, or permission..."
                className="w-full h-8 pl-8 pr-3 rounded-[6px] bg-[#141414] border border-[#262626] hover:border-[#383838] focus:border-[#3b82f6] text-[13px] text-white placeholder-[#666666] outline-none transition-colors font-sans"
              />
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Category Filter */}
              <div className="inline-flex items-center p-0.5 rounded-[6px] bg-[#141414] border border-[#262626] font-sans">
                <button
                  type="button"
                  onClick={() => setActiveCategory("all")}
                  className={`h-7 px-2.5 text-[12px] rounded-[5px] transition-colors cursor-pointer ${
                    activeCategory === "all"
                      ? "bg-[#1e1e1e] text-white font-medium border border-[#333333]"
                      : "text-[#8c8c8c] hover:text-white border border-transparent"
                  }`}
                >
                  All ({tools.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveCategory("database")}
                  className={`h-7 px-2.5 text-[12px] rounded-[5px] transition-colors cursor-pointer flex items-center gap-1.5 ${
                    activeCategory === "database"
                      ? "bg-[#1e1e1e] text-white font-medium border border-[#333333]"
                      : "text-[#8c8c8c] hover:text-white border border-transparent"
                  }`}
                >
                  <Database className="w-3 h-3 text-[#8c8c8c]" />
                  <span>Databases (8)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveCategory("blob")}
                  className={`h-7 px-2.5 text-[12px] rounded-[5px] transition-colors cursor-pointer flex items-center gap-1.5 ${
                    activeCategory === "blob"
                      ? "bg-[#1e1e1e] text-white font-medium border border-[#333333]"
                      : "text-[#8c8c8c] hover:text-white border border-transparent"
                  }`}
                >
                  <HardDrive className="w-3 h-3 text-[#8c8c8c]" />
                  <span>Storage (7)</span>
                </button>
              </div>

              {/* Type Filter */}
              <div className="inline-flex items-center p-0.5 rounded-[6px] bg-[#141414] border border-[#262626] font-sans">
                <button
                  type="button"
                  onClick={() => setActiveType("all")}
                  className={`h-7 px-2.5 text-[12px] rounded-[5px] transition-colors cursor-pointer ${
                    activeType === "all"
                      ? "bg-[#1e1e1e] text-white font-medium border border-[#333333]"
                      : "text-[#8c8c8c] hover:text-white border border-transparent"
                  }`}
                >
                  All Types
                </button>
                <button
                  type="button"
                  onClick={() => setActiveType("READ")}
                  className={`h-7 px-2.5 text-[12px] rounded-[5px] transition-colors cursor-pointer ${
                    activeType === "READ"
                      ? "bg-[#1e1e1e] text-white font-medium border border-[#333333]"
                      : "text-[#8c8c8c] hover:text-white border border-transparent"
                  }`}
                >
                  Read
                </button>
                <button
                  type="button"
                  onClick={() => setActiveType("WRITE")}
                  className={`h-7 px-2.5 text-[12px] rounded-[5px] transition-colors cursor-pointer ${
                    activeType === "WRITE"
                      ? "bg-[#1e1e1e] text-white font-medium border border-[#333333]"
                      : "text-[#8c8c8c] hover:text-white border border-transparent"
                  }`}
                >
                  Write
                </button>
              </div>
            </div>
          </div>

          {/* Tools List */}
          <div className="rounded-[8px] border border-[#262626] bg-[#0c0c0c] divide-y divide-[#1e1e1e] overflow-hidden">
            {filteredTools.length === 0 ? (
              <div className="p-12 text-center text-[#8c8c8c] text-[13px] font-sans">
                No MCP tools matched your filter criteria.
              </div>
            ) : (
              filteredTools.map((tool) => (
                <div
                  key={tool.name}
                  onClick={() => {
                    setSelectedTool(tool);
                    setInspectOpen(true);
                  }}
                  className="group px-5 py-3.5 flex items-start gap-3.5 hover:bg-[#121212] transition-colors cursor-pointer"
                >
                  <span
                    className={`inline-flex items-center justify-center px-2 py-0.5 rounded-[4px] text-[11px] font-sans font-medium shrink-0 mt-0.5 ${
                      tool.type === "READ"
                        ? "bg-[#30a46c]/10 text-[#30a46c] border border-[#30a46c]/25"
                        : "bg-[#1c160c] text-[#f59e0b] border border-[#3d2c14]"
                    }`}
                  >
                    {tool.type === "READ" ? "Read" : "Write"}
                  </span>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-sans font-medium text-white group-hover:text-[#3b82f6] transition-colors">
                          {tool.name}
                        </span>
                        <span className="text-[11px] font-sans px-1.5 py-0.5 rounded-[4px] border border-[#262626] bg-[#141414] text-[#8c8c8c] font-medium flex items-center gap-1">
                          {tool.category === "blob" ? (
                            <>
                              <HardDrive className="w-2.5 h-2.5 text-[#737373]" />
                              <span>Storage</span>
                            </>
                          ) : (
                            <>
                              <Database className="w-2.5 h-2.5 text-[#737373]" />
                              <span>Database</span>
                            </>
                          )}
                        </span>
                      </div>
                      <span className="text-[12px] font-sans text-[#737373] group-hover:text-[#8c8c8c] transition-colors">
                        Permission:{" "}
                        <span className="text-[#a3a3a3]">
                          {tool.permissionRequired}
                        </span>
                      </span>
                    </div>
                    <p className="text-[13px] text-[#8c8c8c] font-normal mt-1 leading-relaxed font-sans">
                      {tool.description}
                    </p>
                  </div>

                  <ChevronRight className="w-4 h-4 text-[#555555] group-hover:text-white shrink-0 transition-colors self-center" />
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 2: RESOURCES */}
      {activeTab === "resources" && (
        <div className="space-y-4">
          <div className="rounded-[8px] border border-[#262626] bg-[#0c0c0c] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#222222]">
              <h2 className="text-[14px] font-medium text-white tracking-tight">
                Resource Endpoints
              </h2>
              <p className="text-[13px] text-[#8c8c8c] font-normal mt-0.5">
                Direct URIs for querying database schemas and file storage
              </p>
            </div>

            <div className="divide-y divide-[#1e1e1e]">
              {resources.map((res) => (
                <div
                  key={res.uri}
                  className="px-5 py-3.5 flex items-start gap-3.5 hover:bg-[#121212] transition-colors"
                >
                  <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-[4px] bg-[#141414] text-[#8c8c8c] border border-[#262626] text-[11px] font-sans font-medium shrink-0 mt-0.5">
                    URI
                  </span>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <span className="text-[13px] font-sans text-white font-medium select-all">
                        {res.uri}
                      </span>
                      <span className="text-[11px] font-sans text-[#737373] bg-[#141414] border border-[#262626] px-2 py-0.5 rounded-[4px]">
                        {res.mimeType}
                      </span>
                    </div>
                    <p className="text-[13px] text-[#8c8c8c] font-normal mt-1 leading-relaxed font-sans">
                      {res.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: CLIENT SETUP */}
      {activeTab === "connect" && (
        <div className="space-y-5">
          <div className="rounded-[8px] border border-[#262626] bg-[#0c0c0c] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#222222] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="text-[14px] font-medium text-white tracking-tight">
                  Client Configuration
                </h2>
                <p className="text-[13px] text-[#8c8c8c] font-normal mt-0.5">
                  Configure Claude Desktop, Cursor, or scripts to connect to
                  Axiom
                </p>
              </div>

              {/* Client Environment Switcher */}
              <div className="inline-flex items-center p-0.5 rounded-[6px] bg-[#141414] border border-[#262626] shrink-0 font-sans">
                {(["claude", "cursor", "curl"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setClientTab(tab)}
                    className={`h-7 px-3 text-[12px] rounded-[5px] transition-colors cursor-pointer ${
                      clientTab === tab
                        ? "bg-[#1e1e1e] text-white font-medium border border-[#333333]"
                        : "text-[#8c8c8c] hover:text-white border border-transparent"
                    }`}
                  >
                    {tab === "claude"
                      ? "Claude Desktop"
                      : tab === "cursor"
                        ? "Cursor IDE"
                        : "cURL"}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-5 space-y-4">
              <div className="relative">
                <pre className="rounded-[8px] border border-[#262626] bg-[#080808] p-4 text-[12px] font-mono text-[#d4d4d4] overflow-x-auto leading-relaxed select-all">
                  {clientTab === "claude" && highlightJson(claudeConfig)}
                  {clientTab === "cursor" && highlightJson(cursorConfig)}
                  {clientTab === "curl" && curlExample}
                </pre>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    const text =
                      clientTab === "claude"
                        ? claudeConfig
                        : clientTab === "cursor"
                          ? cursorConfig
                          : curlExample;
                    navigator.clipboard.writeText(text);
                    setCopiedCode(true);
                    setTimeout(() => setCopiedCode(false), 2000);
                  }}
                  className="absolute top-3 right-3"
                >
                  {copiedCode ? (
                    <Check className="w-3.5 h-3.5 text-[#30a46c]" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span className="text-[12px]">
                    {copiedCode ? "Copied" : "Copy Config"}
                  </span>
                </Button>
              </div>

              {/* Config File Locations */}
              <div className="rounded-[8px] border border-[#262626] bg-[#0e0e0e] overflow-hidden font-sans">
                <div className="px-4 py-2.5 border-b border-[#222222] flex items-center justify-between">
                  <h4 className="text-[13px] font-medium text-white">
                    Configuration Files
                  </h4>
                  <span className="text-[12px] font-normal text-[#8c8c8c]">
                    Add this to your local configuration file
                  </span>
                </div>

                <div className="divide-y divide-[#1e1e1e]">
                  {[
                    {
                      os: "macOS",
                      target: "Claude Desktop",
                      path: "~/Library/Application Support/Claude/claude_desktop_config.json",
                    },
                    {
                      os: "Windows",
                      target: "Claude Desktop",
                      path: "%APPDATA%\\Claude\\claude_desktop_config.json",
                    },
                    {
                      os: "Cursor",
                      target: "Workspace root",
                      path: ".cursor/mcp.json",
                    },
                  ].map((item) => (
                    <div
                      key={item.os}
                      className="px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-[#121212] transition-colors"
                    >
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[12px] font-medium text-white min-w-[64px]">
                          {item.os}
                        </span>
                        <span className="text-[12px] text-[#8c8c8c] font-normal">
                          ({item.target})
                        </span>
                      </div>

                      <div className="flex items-center gap-2 min-w-0 flex-1 sm:justify-end">
                        <code className="text-[12px] font-mono text-[#d4d4d4] bg-[#141414] border border-[#262626] px-2.5 py-1 rounded-[5px] truncate max-w-full select-all">
                          {item.path}
                        </code>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(item.path);
                            setCopiedPath(item.os);
                            setTimeout(() => setCopiedPath(null), 1800);
                          }}
                          className="p-1 text-[#8c8c8c] hover:text-white hover:bg-[#1a1a1a] rounded-[4px] transition-colors shrink-0 cursor-pointer"
                          title={`Copy ${item.os} path`}
                        >
                          {copiedPath === item.os ? (
                            <Check className="w-3.5 h-3.5 text-[#30a46c]" />
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
        </div>
      )}

      {/* Inspect Tool SlideOver */}
      <SlideOver
        isOpen={inspectOpen}
        onClose={() => setInspectOpen(false)}
        width="w-[520px] max-w-full"
        title={
          <div className="flex items-center gap-2 flex-wrap font-sans">
            <span
              className={`px-2 py-0.5 rounded-[4px] text-[11px] font-sans font-medium ${
                selectedTool?.type === "READ"
                  ? "bg-[#30a46c]/10 text-[#30a46c] border border-[#30a46c]/25"
                  : "bg-[#1c160c] text-[#f59e0b] border border-[#3d2c14]"
              }`}
            >
              {selectedTool?.type === "READ" ? "Read" : "Write"}
            </span>
            <span className="text-[11px] font-sans px-1.5 py-0.5 rounded-[4px] border border-[#262626] bg-[#141414] text-[#8c8c8c] font-medium flex items-center gap-1">
              {selectedTool?.category === "blob" ? (
                <>
                  <HardDrive className="w-2.5 h-2.5 text-[#737373]" />
                  <span>Storage</span>
                </>
              ) : (
                <>
                  <Database className="w-2.5 h-2.5 text-[#737373]" />
                  <span>Database</span>
                </>
              )}
            </span>
            <span className="text-white text-[15px] font-sans font-medium">
              {selectedTool?.name}
            </span>
          </div>
        }
        subtitle={selectedTool?.description}
      >
        <div className="flex-1 p-5 overflow-y-auto space-y-5 font-sans">
          {/* Metadata Card */}
          <div className="p-3.5 rounded-[8px] border border-[#262626] bg-[#0c0c0c] flex items-center justify-between gap-3">
            <span className="text-[13px] text-[#8c8c8c] font-normal">
              Required Permission
            </span>
            <span className="text-[12px] font-sans font-medium text-[#cccccc] bg-[#141414] border border-[#262626] px-2 py-0.5 rounded-[4px]">
              {selectedTool?.permissionRequired}
            </span>
          </div>

          {/* Parameters Section */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-medium text-white">Parameters</h3>
              <span className="text-[12px] text-[#8c8c8c] font-normal">
                {Object.keys(selectedTool?.parameters.properties || {})
                  .length === 0
                  ? "None"
                  : `${Object.keys(selectedTool?.parameters.properties || {}).length} arguments`}
              </span>
            </div>

            {Object.keys(selectedTool?.parameters.properties || {}).length ===
            0 ? (
              <div className="p-4 rounded-[8px] border border-[#262626] bg-[#0c0c0c] text-[13px] text-[#8c8c8c] text-center">
                This tool takes no parameters.
              </div>
            ) : (
              <div className="rounded-[8px] border border-[#262626] bg-[#0c0c0c] divide-y divide-[#1e1e1e] overflow-hidden">
                {Object.entries(selectedTool?.parameters.properties || {}).map(
                  ([paramName, prop]) => {
                    const isRequired =
                      selectedTool?.parameters.required.includes(paramName);
                    return (
                      <div key={paramName} className="p-3.5 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-sans font-medium text-white">
                              {paramName}
                            </span>
                            <span className="text-[11px] font-sans text-[#737373] bg-[#141414] border border-[#262626] px-1.5 py-0.5 rounded-[4px]">
                              {prop.type}
                            </span>
                          </div>
                          {isRequired ? (
                            <span className="text-[11px] font-sans font-medium text-[#e5484d] bg-[#e5484d]/10 border border-[#e5484d]/25 px-1.5 py-0.5 rounded-[4px]">
                              Required
                            </span>
                          ) : (
                            <span className="text-[11px] font-sans font-normal text-[#737373] bg-[#141414] border border-[#262626] px-1.5 py-0.5 rounded-[4px]">
                              Optional
                            </span>
                          )}
                        </div>
                        <p className="text-[13px] text-[#8c8c8c] font-normal leading-relaxed">
                          {prop.description}
                        </p>
                        {prop.enum && (
                          <div className="text-[12px] text-[#737373] flex items-center gap-1.5 pt-0.5">
                            <span>Allowed values:</span>
                            <span className="text-[#a3a3a3]">
                              {prop.enum.join(" · ")}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  },
                )}
              </div>
            )}
          </div>

          {/* Example JSON-RPC Invocation */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-medium text-white flex items-center gap-1.5 font-sans">
                <span className="text-white font-medium">JSON-RPC</span>
                <span>Example</span>
              </h3>
              <button
                type="button"
                onClick={() => {
                  if (!selectedTool) return;
                  const exampleJson = JSON.stringify(
                    {
                      jsonrpc: "2.0",
                      id: 1,
                      method: "tools/call",
                      params: {
                        name: selectedTool.name,
                        arguments: Object.fromEntries(
                          Object.entries(
                            selectedTool.parameters.properties,
                          ).map(([k, v]) => [
                            k,
                            v.type === "integer"
                              ? 100
                              : v.type === "object"
                                ? {}
                                : `<${k}>`,
                          ]),
                        ),
                      },
                    },
                    null,
                    2,
                  );
                  navigator.clipboard.writeText(exampleJson);
                  setCopiedToolExample(true);
                  setTimeout(() => setCopiedToolExample(false), 2000);
                }}
                className="inline-flex items-center gap-1.5 text-[12px] text-[#8c8c8c] hover:text-white transition-colors cursor-pointer"
              >
                {copiedToolExample ? (
                  <>
                    <Check className="w-3 h-3 text-[#30a46c]" />
                    <span className="text-[#30a46c]">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span>Copy JSON</span>
                  </>
                )}
              </button>
            </div>

            <pre className="rounded-[8px] border border-[#262626] bg-[#080808] p-3.5 text-[12px] font-mono text-[#d4d4d4] overflow-x-auto leading-relaxed select-all">
              {selectedTool &&
                highlightJson(
                  JSON.stringify(
                    {
                      jsonrpc: "2.0",
                      id: 1,
                      method: "tools/call",
                      params: {
                        name: selectedTool.name,
                        arguments: Object.fromEntries(
                          Object.entries(
                            selectedTool.parameters.properties || {},
                          ).map(([k, v]) => [
                            k,
                            v.type === "integer"
                              ? 100
                              : v.type === "object"
                                ? {}
                                : `<${k}>`,
                          ]),
                        ),
                      },
                    },
                    null,
                    2,
                  ),
                )}
            </pre>
          </div>
        </div>

        <div className="p-4 border-t border-[#222222] bg-[#0c0c0c] flex items-center justify-end font-sans">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setInspectOpen(false)}
          >
            Close
          </Button>
        </div>
      </SlideOver>
    </div>
  );
}
