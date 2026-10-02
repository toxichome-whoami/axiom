/*
 * Interactive API Gateway endpoint tester and payload validator.
 * Owned by: ui/tester
 * Key deps: CustomSelect, Button, lucide-react, ../api/client
 * Invariants: Executes real HTTP requests against the gateway; responses are syntax-highlighted in real time.
 * Last structural change: Removed synthetic mock fallbacks; connected execution directly to live endpoints.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { ApiRoutePreset } from '../types';
import { CustomSelect } from '../components/shared/CustomSelect';
import { Button } from '../components/ui/Button';
import { Play, Copy, Check, Terminal } from 'lucide-react';
import { api, DatabaseRecordApi, ApiKeyRecordApi } from '../api/client';

function tokenizeJsonLine(line: string): React.ReactNode[] {
  if (!line) return [' '];

  const tokens: React.ReactNode[] = [];
  const regex =
    /("(?:\\.|[^"\\])*"(?:\s*:)?)|(\btrue\b|\bfalse\b|\bnull\b)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\],:])|([^\s"truefalsenull0-9{}[\]:,]+)|(\s+)/g;

  let match;
  let keyIndex = 0;
  let lastIndex = 0;

  while ((match = regex.exec(line)) !== null) {
    const [full] = match;

    if (match[1]) {
      // Key or String value
      if (full.endsWith(':')) {
        const colonIdx = full.lastIndexOf(':');
        const keyText = full.slice(0, colonIdx);
        const colonText = full.slice(colonIdx);
        tokens.push(
          <span key={keyIndex++} className="text-[#9cdcfe]">
            {keyText}
          </span>
        );
        tokens.push(
          <span key={keyIndex++} className="text-[#cccccc]">
            {colonText}
          </span>
        );
      } else {
        tokens.push(
          <span key={keyIndex++} className="text-[#ce9178]">
            {full}
          </span>
        );
      }
    } else if (match[2]) {
      // Boolean / Null (keyword blue)
      tokens.push(
        <span key={keyIndex++} className="text-[#569cd6]">
          {full}
        </span>
      );
    } else if (match[3]) {
      // Numbers (light green)
      tokens.push(
        <span key={keyIndex++} className="text-[#b5cea8]">
          {full}
        </span>
      );
    } else if (match[4]) {
      // Punctuation (brackets, commas, colons)
      tokens.push(
        <span key={keyIndex++} className="text-[#cccccc]">
          {full}
        </span>
      );
    } else {
      tokens.push(<span key={keyIndex++}>{full}</span>);
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < line.length) {
    tokens.push(<span key={keyIndex++}>{line.slice(lastIndex)}</span>);
  }

  return tokens;
}

function VsCodeJsonViewer({
  json,
  className = '',
}: {
  json: string;
  className?: string;
}) {
  const lines = json.split('\n');

  return (
    <div
      className={`flex flex-1 min-h-0 h-full bg-[#08090c] overflow-auto text-[13px] font-mono leading-relaxed select-text ${className}`}
    >
      {/* Line Numbers Gutter */}
      <div className="shrink-0 py-3.5 pl-3 pr-2.5 bg-[#060709] border-r border-[#16181e] select-none text-right text-[12px] text-[#4b5563] font-mono min-h-full">
        {lines.map((_, i) => (
          <div key={i} className="h-5 leading-5">{i + 1}</div>
        ))}
      </div>

      {/* Code Area */}
      <div className="flex-1 py-3.5 px-4 overflow-x-auto min-w-0 min-h-full">
        {lines.map((line, idx) => (
          <div key={idx} className="h-5 leading-5 whitespace-pre">
            {tokenizeJsonLine(line)}
          </div>
        ))}
      </div>
    </div>
  );
}

function VsCodeLiveJsonEditor({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
}) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const preRef = React.useRef<HTMLPreElement>(null);
  const gutterRef = React.useRef<HTMLDivElement>(null);

  const lines = (value || '').split('\n');

  function handleScroll(e: React.UIEvent<HTMLTextAreaElement>) {
    const { scrollTop, scrollLeft } = e.currentTarget;
    if (preRef.current) {
      preRef.current.scrollTop = scrollTop;
      preRef.current.scrollLeft = scrollLeft;
    }
    if (gutterRef.current) {
      gutterRef.current.scrollTop = scrollTop;
    }
  }

  return (
    <div className="flex flex-1 min-h-0 h-full bg-[#08090c] overflow-hidden relative">
      {/* Line Numbers Gutter */}
      <div
        ref={gutterRef}
        className="shrink-0 py-3 pl-3 pr-2.5 bg-[#060709] border-r border-[#16181e] select-none text-right text-[12px] text-[#4b5563] font-mono overflow-hidden pointer-events-none min-h-full"
      >
        {lines.map((_, i) => (
          <div key={i} className="h-5 leading-5">
            {i + 1}
          </div>
        ))}
      </div>

      {/* Editor Area */}
      <div className="relative flex-1 min-w-0 h-full overflow-hidden">
        {/* Highlighted Syntax Underlay */}
        <pre
          ref={preRef}
          aria-hidden="true"
          className="absolute inset-0 p-3 m-0 font-mono text-[13px] leading-5 whitespace-pre pointer-events-none select-none overflow-hidden text-left"
          style={{ tabSize: 2 }}
        >
          {lines.map((line, idx) => (
            <div key={idx} className="h-5 leading-5 whitespace-pre">
              {tokenizeJsonLine(line)}
            </div>
          ))}
        </pre>

        {/* Transparent Interactive Textarea Overlay */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={handleScroll}
          disabled={disabled}
          onKeyDown={(e) => {
            if (e.key === 'Tab') {
              e.preventDefault();
              const start = e.currentTarget.selectionStart;
              const end = e.currentTarget.selectionEnd;
              const nextVal = value.substring(0, start) + '  ' + value.substring(end);
              onChange(nextVal);
              requestAnimationFrame(() => {
                if (textareaRef.current) {
                  textareaRef.current.selectionStart = textareaRef.current.selectionEnd = start + 2;
                }
              });
            }
          }}
          className="relative w-full h-full min-h-full bg-transparent p-3 m-0 font-mono text-[13px] leading-5 whitespace-pre text-transparent caret-[#60a5fa] selection:bg-[#264f78]/60 focus:outline-none disabled:opacity-40 resize-none overflow-auto border-0"
          spellCheck={false}
          style={{ tabSize: 2 }}
        />
      </div>
    </div>
  );
}

function tokenizeCurlLine(line: string): React.ReactNode {
  const trimmed = line.trim();

  // If this line is purely a JSON line inside -d body
  if (
    trimmed.startsWith('"') ||
    trimmed.startsWith('}') ||
    trimmed.startsWith(']') ||
    trimmed === '{' ||
    trimmed === '}' ||
    trimmed === "}'"
  ) {
    if (trimmed === "}'") {
      const leadingSpaces = line.slice(0, line.indexOf('}'));
      return (
        <>
          {leadingSpaces}
          <span className="text-[#cccccc]">{'}'}</span>
          <span className="text-[#ce9178]">'</span>
        </>
      );
    }
    return tokenizeJsonLine(line);
  }

  // If line starts with curl
  if (trimmed.startsWith('curl')) {
    const parts = line.split(/(curl|-X|GET|POST|PATCH|DELETE|"[^"]*"|\\)/g);
    return parts.map((part, i) => {
      if (part === 'curl') return <span key={i} className="text-[#569cd6] font-medium">curl</span>;
      if (part === '-X') return <span key={i} className="text-[#9cdcfe]">-X</span>;
      if (part === 'GET') return <span key={i} className="text-[#34d399] font-medium">GET</span>;
      if (part === 'POST') return <span key={i} className="text-[#60a5fa] font-medium">POST</span>;
      if (part === 'PATCH') return <span key={i} className="text-[#fb923c] font-medium">PATCH</span>;
      if (part === 'DELETE') return <span key={i} className="text-[#f87171] font-medium">DELETE</span>;
      if (part.startsWith('"') && part.endsWith('"')) return <span key={i} className="text-[#ce9178]">{part}</span>;
      if (part === '\\') return <span key={i} className="text-[#808080]">\</span>;
      return <span key={i}>{part}</span>;
    });
  }

  // If line starts with -H
  if (trimmed.startsWith('-H')) {
    const parts = line.split(/(-H|"[^"]*"|\\)/g);
    return parts.map((part, i) => {
      if (part === '-H') return <span key={i} className="text-[#9cdcfe]">-H</span>;
      if (part.startsWith('"') && part.endsWith('"')) {
        const colonIdx = part.indexOf(':');
        if (colonIdx !== -1) {
          const name = part.slice(0, colonIdx);
          const val = part.slice(colonIdx);
          if (val.includes('$AXIOM_API_KEY')) {
            const [before, after] = val.split('$AXIOM_API_KEY');
            return (
              <span key={i}>
                <span className="text-[#4ec9b0]">{name}</span>
                <span className="text-[#ce9178]">{before}</span>
                <span className="text-[#9cdcfe] font-medium">$AXIOM_API_KEY</span>
                <span className="text-[#ce9178]">{after}</span>
              </span>
            );
          }
          return (
            <span key={i}>
              <span className="text-[#4ec9b0]">{name}</span>
              <span className="text-[#ce9178]">{val}</span>
            </span>
          );
        }
        return <span key={i} className="text-[#ce9178]">{part}</span>;
      }
      if (part === '\\') return <span key={i} className="text-[#808080]">\</span>;
      return <span key={i}>{part}</span>;
    });
  }

  // If line starts with -d
  if (trimmed.startsWith('-d')) {
    const parts = line.split(/(-d|'\{|')/g);
    return parts.map((part, i) => {
      if (part === '-d') return <span key={i} className="text-[#9cdcfe]">-d</span>;
      if (part === "'{") {
        return (
          <span key={i}>
            <span className="text-[#ce9178]">'</span>
            <span className="text-[#cccccc]">{'{'}</span>
          </span>
        );
      }
      if (part === "'") return <span key={i} className="text-[#ce9178]">'</span>;
      return <span key={i}>{part}</span>;
    });
  }

  return line;
}

export function Tester() {
  const [databases, setDatabases] = useState<DatabaseRecordApi[]>([]);
  const [keys, setKeys] = useState<ApiKeyRecordApi[]>([]);
  const [selectedDb, setSelectedDb] = useState<string>('');
  const [authIdentity, setAuthIdentity] = useState<string>('__session__');
  const [customKeyToken, setCustomKeyToken] = useState<string>('');

  useEffect(() => {
    let isMounted = true;
    Promise.allSettled([api.listDatabases(), api.listKeys()]).then(([dbRes, keyRes]) => {
      if (!isMounted) return;
      if (dbRes.status === 'fulfilled' && dbRes.value?.databases) {
        setDatabases(dbRes.value.databases);
        if (dbRes.value.databases.length > 0) {
          setSelectedDb(dbRes.value.databases[0].alias);
        }
      }
      if (keyRes.status === 'fulfilled' && keyRes.value?.keys) {
        setKeys(keyRes.value.keys);
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  const presets: ApiRoutePreset[] = useMemo(() => {
    const db = selectedDb || 'db';
    return [
      {
        id: 'query',
        name: 'Raw SQL Query',
        method: 'POST',
        path: `/api/v1/db/${db}/query`,
        description: 'Execute parameterized SQL with AST firewall inspection.',
        defaultBody: '{\n  "sql": "SELECT 1 AS connected",\n  "params": []\n}',
        defaultParams: '',
      },
      {
        id: 'databases',
        name: 'List Databases',
        method: 'GET',
        path: '/api/v1/db/databases',
        description: 'Enumerate all active and attached database pools.',
        defaultBody: '',
        defaultParams: '',
      },
      {
        id: 'tables',
        name: 'List Tables',
        method: 'GET',
        path: `/api/v1/db/${db}/tables`,
        description: 'List user tables in target database with pagination.',
        defaultBody: '',
        defaultParams: 'cursor=0&limit=50',
      },
      {
        id: 'schema',
        name: 'Describe Schema',
        method: 'GET',
        path: `/api/v1/db/${db}/table_name/schema`,
        description: 'Retrieve column data types, nullability, and foreign keys.',
        defaultBody: '',
        defaultParams: '',
      },
      {
        id: 'get_rows',
        name: 'Fetch Rows',
        method: 'GET',
        path: `/api/v1/db/${db}/table_name/rows`,
        description: 'Query records with cursor pagination, order, sort, and JSON filter.',
        defaultBody: '',
        defaultParams: 'limit=10',
      },
      {
        id: 'insert_rows',
        name: 'Insert Rows',
        method: 'POST',
        path: `/api/v1/db/${db}/table_name/rows`,
        description: 'Insert rows in a single atomic transaction.',
        defaultBody: '{\n  "rows": [\n    {}\n  ]\n}',
        defaultParams: '',
      },
      {
        id: 'update_rows',
        name: 'Update Rows',
        method: 'PATCH',
        path: `/api/v1/db/${db}/table_name/rows`,
        description: 'Update matching records. Strict safety requires a non-empty filter.',
        defaultBody: '{\n  "filter": {},\n  "set": {}\n}',
        defaultParams: '',
      },
      {
        id: 'delete_rows',
        name: 'Delete Rows',
        method: 'DELETE',
        path: `/api/v1/db/${db}/table_name/rows`,
        description: 'Delete matching records with mandatory safety filter predicate.',
        defaultBody: '{\n  "filter": {}\n}',
        defaultParams: '',
      },
    ];
  }, [selectedDb]);

  const methodOptions: { value: 'GET' | 'POST' | 'PATCH' | 'DELETE'; label: string; icon?: React.ReactNode }[] = [
    {
      value: 'GET',
      label: 'GET',
      icon: <span className="w-2 h-2 rounded-full bg-[#34d399]" />,
    },
    {
      value: 'POST',
      label: 'POST',
      icon: <span className="w-2 h-2 rounded-full bg-[#60a5fa]" />,
    },
    {
      value: 'PATCH',
      label: 'PATCH',
      icon: <span className="w-2 h-2 rounded-full bg-[#fb923c]" />,
    },
    {
      value: 'DELETE',
      label: 'DELETE',
      icon: <span className="w-2 h-2 rounded-full bg-[#f87171]" />,
    },
  ];

  const [activePresetId, setActivePresetId] = useState<string>('query');
  const activePreset = useMemo(
    () => presets.find((p) => p.id === activePresetId) || presets[0],
    [presets, activePresetId]
  );

  const [method, setMethod] = useState<'GET' | 'POST' | 'PATCH' | 'DELETE'>('POST');
  const [urlPath, setUrlPath] = useState('');
  const [queryParams, setQueryParams] = useState('');
  const [requestBody, setRequestBody] = useState('{\n  "sql": "SELECT 1 AS connected",\n  "params": []\n}');
  const [copiedCurl, setCopiedCurl] = useState(false);
  const [copiedResponse, setCopiedResponse] = useState(false);

  // Initialize urlPath when activePreset becomes available or preset changes
  useEffect(() => {
    if (activePreset) {
      setUrlPath(activePreset.path);
    }
  }, [activePreset?.id, selectedDb]);

  // Response Execution State (Starts completely clean - no synthetic mock data)
  const [isLoading, setIsLoading] = useState(false);
  const [responseStatus, setResponseStatus] = useState<string | null>(null);
  const [responseDuration, setResponseDuration] = useState<number | null>(null);
  const [responseCached, setResponseCached] = useState<boolean | null>(null);
  const [responseBody, setResponseBody] = useState<string | null>(null);

  function handleSelectPreset(preset: ApiRoutePreset) {
    setActivePresetId(preset.id);
    setMethod(preset.method);
    setUrlPath(preset.path);
    setQueryParams(preset.defaultParams);
    setRequestBody(preset.defaultBody);
  }

  async function handleExecute() {
    setIsLoading(true);
    const start = performance.now();

    const fullPath = queryParams ? `${urlPath}?${queryParams}` : urlPath;

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (authIdentity === '__session__') {
        const token = localStorage.getItem('axiom_session_token');
        if (token && token !== 'undefined' && token !== 'null') {
          headers['Authorization'] = `Bearer ${token}`;
        }
      } else if (authIdentity === '__custom__') {
        if (customKeyToken.trim()) {
          headers['X-Axiom-Key'] = customKeyToken.trim();
        }
      } else {
        headers['X-Axiom-Key'] = btoa(`${authIdentity}:secret`);
      }

      const res = await fetch(fullPath, {
        method,
        headers,
        credentials: 'include',
        body: method !== 'GET' && requestBody.trim() ? requestBody : undefined,
      });
      const end = performance.now();
      const dur = parseFloat((end - start).toFixed(2));
      const text = await res.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw_response: text };
      }
      setResponseStatus(`${res.status} ${res.statusText}`);
      setResponseDuration(dur);
      setResponseCached(res.headers.get('x-axiom-cache') === 'HIT');
      setResponseBody(JSON.stringify(json, null, 2));
    } catch (err: unknown) {
      const end = performance.now();
      const dur = parseFloat((end - start).toFixed(2));
      setResponseStatus('500 Network Error');
      setResponseDuration(dur);
      setResponseCached(false);
      setResponseBody(
        JSON.stringify(
          {
            success: false,
            error: {
              code: 'NETWORK_ERROR',
              message: err instanceof Error ? err.message : 'Unable to reach gateway endpoint',
            },
          },
          null,
          2
        )
      );
    } finally {
      setIsLoading(false);
    }
  }

  const sessionToken = localStorage.getItem('axiom_session_token');
  const validSessionToken = sessionToken && sessionToken !== 'undefined' && sessionToken !== 'null' ? sessionToken : '$AXIOM_SESSION_TOKEN';

  const curlAuthHeader =
    authIdentity === '__session__'
      ? `-H "Authorization: Bearer ${validSessionToken}"`
      : authIdentity === '__custom__' && customKeyToken.trim()
      ? `-H "X-Axiom-Key: ${customKeyToken.trim()}"`
      : `-H "X-Axiom-Key: ${authIdentity === '__session__' ? '$AXIOM_API_KEY' : btoa(`${authIdentity}:secret`)}"`;

  const generatedCurl = `curl -X ${method} "http://localhost:4500${urlPath}${queryParams ? `?${queryParams}` : ''}" \\
  -H "Content-Type: application/json" \\
  ${curlAuthHeader}${
    method !== 'GET' && requestBody.trim() ? ` \\\n  -d '${requestBody.replace(/'/g, "\\'")}'` : ''
  }`;

  return (
    <div className="w-full max-w-[1600px] mx-auto select-none font-sans flex flex-col h-[calc(100vh-148px)] min-h-[580px] space-y-3.5">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shrink-0">
        <div>
          <h1 className="text-[16px] font-medium text-white tracking-tight">API Explorer</h1>
          <p className="text-[12.5px] text-[#71717a]">Interactive live gateway endpoint tester and payload validator</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* Target DB Selector */}
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-[#8c8c8c]">Target DB:</span>
            <CustomSelect
              value={selectedDb}
              onChange={(val) => setSelectedDb(val)}
              size="sm"
              menuWidth="w-[200px]"
              options={
                databases.length > 0
                  ? databases.map((db) => ({
                      value: db.alias,
                      label: `${db.alias} (${db.engine})`,
                    }))
                  : [{ value: '', label: 'No database connected' }]
              }
            />
          </div>

          {/* Auth Identity Selector */}
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-[#8c8c8c]">Auth Identity:</span>
            <CustomSelect
              value={authIdentity}
              onChange={(val) => setAuthIdentity(val)}
              size="sm"
              menuWidth="w-[240px]"
              options={[
                { value: '__session__', label: 'Admin Session (Active Bearer)' },
                ...keys.map((k) => ({
                  value: k.name,
                  label: `${k.name} (${k.role_name || 'no role'})`,
                })),
                { value: '__custom__', label: 'Custom Key (X-Axiom-Key)...' },
              ]}
            />
          </div>
        </div>
      </div>

      {authIdentity === '__custom__' && (
        <div className="flex items-center gap-2 bg-[#0c0d10] border border-[#1e2025] rounded-[8px] px-3 py-1.5 shrink-0">
          <span className="text-[12.5px] text-[#8c8c8c] shrink-0">X-Axiom-Key:</span>
          <input
            type="text"
            value={customKeyToken}
            onChange={(e) => setCustomKeyToken(e.target.value)}
            placeholder="Paste base64 key token (name:secret)..."
            className="flex-1 bg-transparent text-[13px] text-white focus:outline-none placeholder-[#52525b]"
          />
        </div>
      )}

      {/* Preset Route Buttons */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none shrink-0">
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => handleSelectPreset(preset)}
            className={`px-3 py-1.5 rounded-[8px] text-[13px] transition-all shrink-0 flex items-center gap-2 cursor-pointer border ${
              activePreset.id === preset.id
                ? 'bg-[#14151a] text-white border-[#3b82f6]/40 shadow-xs font-medium'
                : 'bg-[#08090c] text-[#8c8c8c] hover:text-white border-[#1e2025] hover:bg-[#0c0d12] font-normal'
            }`}
          >
            <span
              className={`text-[11px] font-medium px-2 py-0.5 rounded-[4px] ${
                preset.method === 'GET'
                  ? 'bg-[#072714] text-[#34d399] border border-[#059669]/30'
                  : preset.method === 'POST'
                  ? 'bg-[#0c1f3d] text-[#60a5fa] border border-[#1d4ed8]/30'
                  : preset.method === 'PATCH'
                  ? 'bg-[#2b1704] text-[#fb923c] border border-[#ea580c]/30'
                  : 'bg-[#3b0d0c] text-[#f87171] border border-[#b91c1c]/30'
              }`}
            >
              {preset.method}
            </span>
            <span>{preset.name}</span>
          </button>
        ))}
      </div>

      {/* Request URL Input Bar */}
      <div className="rounded-[10px] border border-[#1e2025] bg-[#0c0d10] p-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
        <CustomSelect<'GET' | 'POST' | 'PATCH' | 'DELETE'>
          value={method}
          onChange={(val) => setMethod(val)}
          menuWidth="w-[130px]"
          className="w-full sm:w-[125px] shrink-0 text-[14px]"
          options={methodOptions}
        />

        <div className="flex-1 flex items-center rounded-[8px] border border-[#1e2025] bg-[#08090c] px-3 focus-within:border-[#3b82f6]/60 transition-colors">
          <span className="text-[14px] text-[#666666] select-none">http://localhost:4500</span>
          <input
            type="text"
            value={urlPath}
            onChange={(e) => setUrlPath(e.target.value)}
            className="h-9 flex-1 bg-transparent px-2 text-[14px] text-white focus:outline-none placeholder-[#555]"
            placeholder="/api/v1/db/..."
          />
        </div>

        <Button
          variant="primary"
          size="md"
          isLoading={isLoading}
          onClick={handleExecute}
          className="shrink-0 h-9 px-4 text-[14px] font-medium"
        >
          <Play className="w-3.5 h-3.5 mr-1.5 fill-current" />
          <span>Execute</span>
        </Button>
      </div>

      {/* Editor & Response Single Container with Edge-to-Edge Divider */}
      <div className="rounded-[10px] border border-[#1e2025] bg-[#0c0d10] overflow-hidden flex-1 min-h-0 flex flex-col">
        <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-[#1e2025] flex-1 min-h-0 h-full">
          {/* Left: Request Configuration */}
          <div className="p-4 flex flex-col h-full min-h-0 justify-between space-y-3">
            <div className="space-y-1.5 shrink-0">
              <div className="flex items-center justify-between">
                <label className="text-[13px] font-medium text-[#cccccc]">Query Parameters</label>
                <span className="text-[13px] text-[#8c8c8c]">URL-encoded query string</span>
              </div>
              <input
                type="text"
                value={queryParams}
                onChange={(e) => setQueryParams(e.target.value)}
                placeholder="e.g. limit=10&sort=id&order=desc"
                className="h-9 w-full rounded-[8px] border border-[#1e2025] bg-[#08090c] px-3 text-[14px] text-white focus:outline-none focus:border-[#3b82f6]/60 transition-colors placeholder-[#52525b]"
              />
            </div>

            <div className="space-y-1.5 flex-1 min-h-0 flex flex-col">
              <div className="flex items-center justify-between shrink-0">
                <label className="text-[13px] font-medium text-[#cccccc]">Request Payload (JSON)</label>
                {method === 'GET' && (
                  <span className="text-[13px] text-[#8c8c8c]">Ignored for GET requests</span>
                )}
              </div>

              <div className="rounded-[8px] border border-[#1e2025] bg-[#08090c] overflow-hidden focus-within:border-[#3b82f6]/60 transition-colors flex-1 min-h-0 flex flex-col">
                {/* VS Code Tab Header */}
                <div className="h-8 px-3.5 bg-[#060709] border-b border-[#16181e] flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-[#9cdcfe]">{'{}'}</span>
                    <span className="text-[13px] font-medium text-[#cccccc]">payload.json</span>
                  </div>
                  <span className="text-[12px] text-[#8c8c8c] font-normal">JSON</span>
                </div>

                {method === 'GET' ? (
                  <div className="h-full flex items-center justify-center text-[13px] text-[#8c8c8c]">
                    GET requests do not have a body payload.
                  </div>
                ) : (
                  <VsCodeLiveJsonEditor
                    value={requestBody}
                    onChange={setRequestBody}
                  />
                )}
              </div>
            </div>

            <div className="space-y-1.5 shrink-0">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium text-[#cccccc]">Generated cURL Command</span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(generatedCurl);
                    setCopiedCurl(true);
                    setTimeout(() => setCopiedCurl(false), 2000);
                  }}
                  className="text-[13px] text-[#8c8c8c] hover:text-white transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  {copiedCurl ? <Check className="w-3.5 h-3.5 text-[#34d399]" /> : <Copy className="w-3.5 h-3.5" />}
                  <span className={copiedCurl ? 'text-[#34d399]' : ''}>{copiedCurl ? 'Copied' : 'Copy cURL'}</span>
                </button>
              </div>
              <div className="rounded-[8px] border border-[#1e2025] bg-[#08090c] overflow-hidden">
                <div className="h-8 px-3.5 bg-[#060709] border-b border-[#16181e] flex items-center justify-between">
                  <span className="text-[12px] font-normal text-[#8c8c8c]">bash</span>
                </div>
                <div className="flex bg-[#08090c] overflow-auto max-h-[140px] text-[13px] font-mono leading-relaxed select-text">
                  <div className="shrink-0 py-2.5 pl-3.5 pr-2.5 bg-[#060709] border-r border-[#16181e] select-none text-right text-[12px] text-[#52525b] font-mono">
                    {generatedCurl.split('\n').map((_, i) => (
                      <div key={i} className="h-5 leading-5">{i + 1}</div>
                    ))}
                  </div>
                  <div className="flex-1 py-2.5 px-3.5 overflow-x-auto min-w-0">
                    {generatedCurl.split('\n').map((line, idx) => (
                      <div key={idx} className="h-5 leading-5 whitespace-pre">
                        {tokenizeCurlLine(line)}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Response Inspector */}
          <div className="p-4 flex flex-col h-full min-h-0">
            <div className="flex items-center justify-between pb-2.5 shrink-0">
              <div className="flex items-center gap-2.5">
                <span className="text-[14px] font-medium text-white">HTTP Response</span>
                {responseStatus !== null ? (
                  <span
                    className={`rounded-[4px] px-2.5 py-0.5 text-[12.5px] font-medium ${
                      responseStatus.startsWith('200')
                        ? 'bg-[#072714] text-[#34d399] border border-[#059669]/30'
                        : 'bg-[#3b0d0c] text-[#f87171] border border-[#b91c1c]/30'
                    }`}
                  >
                    {responseStatus}
                  </span>
                ) : (
                  <span className="rounded-[4px] px-2.5 py-0.5 text-[12px] font-medium border border-[#1e2025] bg-[#14151a] text-[#71717a]">
                    Idle
                  </span>
                )}
              </div>
              {responseStatus !== null ? (
                <div className="flex items-center gap-2.5 text-[13px] text-[#8c8c8c]">
                  <span>{responseDuration} ms</span>
                  <span
                    className={`rounded-[4px] px-2.5 py-0.5 border text-[12px] font-medium ${
                      responseCached
                        ? 'border-[#059669]/30 bg-[#072714] text-[#34d399]'
                        : 'border-[#1e2025] bg-[#14151a] text-[#8c8c8c]'
                    }`}
                  >
                    {responseCached ? 'L1 Cached' : 'Direct SQL'}
                  </span>
                </div>
              ) : (
                <span className="text-[12.5px] text-[#71717a]">No request executed yet</span>
              )}
            </div>

            {/* VS Code Style Response Viewer */}
            <div className="rounded-[8px] border border-[#1e2025] bg-[#08090c] overflow-hidden flex flex-col flex-1 min-h-0">
              {/* VS Code Tab Bar */}
              <div className="h-8 px-3.5 bg-[#060709] border-b border-[#16181e] flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-[#9cdcfe]">{'{}'}</span>
                  <span className="text-[13px] font-medium text-[#cccccc]">response.json</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[12px] font-normal text-[#8c8c8c]">UTF-8</span>
                  {responseBody !== null && (
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(responseBody);
                        setCopiedResponse(true);
                        setTimeout(() => setCopiedResponse(false), 2000);
                      }}
                      className="text-[13px] text-[#8c8c8c] hover:text-white flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      {copiedResponse ? <Check className="w-3.5 h-3.5 text-[#34d399]" /> : <Copy className="w-3.5 h-3.5" />}
                      <span className={copiedResponse ? 'text-[#34d399]' : ''}>{copiedResponse ? 'Copied' : 'Copy'}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Syntax Highlighted JSON with Line Numbers OR Clean Empty State */}
              {responseBody !== null ? (
                <VsCodeJsonViewer json={responseBody} />
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 select-none">
                  <div className="w-10 h-10 rounded-full bg-[#14151a] border border-[#1e2025] flex items-center justify-center mb-3 text-[#52525b]">
                    <Terminal className="w-5 h-5 text-[#8c8c8c]" />
                  </div>
                  <div className="text-[14px] font-medium text-[#cccccc] mb-1">Ready to Execute</div>
                  <div className="text-[13px] text-[#71717a] max-w-[320px]">
                    Select a route preset or enter a custom path, configure parameters, and click Execute to test live gateway responses.
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
