import React, { useState } from 'react';
import { cn } from '../../utils/cn';

export interface AxiomPermissions {
  // Database Query & CRUD
  db_select: boolean;
  db_insert: boolean;
  db_update: boolean;
  db_delete: boolean;
  db_execute_raw: boolean;
  db_schema_describe: boolean;

  // Management & Gateway
  keys_view: boolean;
  keys_create: boolean;
  keys_rotate: boolean;
  keys_delete: boolean;

  pools_view: boolean;
  pools_add: boolean;
  pools_delete: boolean;

  roles_view: boolean;
  roles_create: boolean;
  roles_edit: boolean;
  roles_delete: boolean;

  // MCP & API Explorer
  mcp_access: boolean;
  mcp_tools_invoke: boolean;
  tester_execute: boolean;

  // Observability & System
  logs_view_audit: boolean;
  metrics_view: boolean;
  cache_stats_view: boolean;
  cache_flush: boolean;
  settings_view: boolean;
}

export interface PermissionTableProps {
  value: AxiomPermissions;
  onChange?: (p: AxiomPermissions) => void;
  disabled?: Partial<Record<keyof AxiomPermissions, boolean>>;
  readOnly?: boolean;
}

interface PermissionGroup {
  id: string;
  label: string;
  items: {
    key: keyof AxiomPermissions;
    label: string;
    desc: string;
  }[];
}

const GROUPS: PermissionGroup[] = [
  {
    id: 'database_crud',
    label: 'Database & CRUD Operations',
    items: [
      { key: 'db_select', label: 'SELECT / Read', desc: 'Can query tables and retrieve rows via Data API' },
      { key: 'db_insert', label: 'INSERT / Create', desc: 'Can insert new records into permitted tables' },
      { key: 'db_update', label: 'UPDATE / Modify', desc: 'Can update records in permitted tables (filter required)' },
      { key: 'db_delete', label: 'DELETE / Remove', desc: 'Can delete records from permitted tables (filter required)' },
      { key: 'db_execute_raw', label: 'Execute Raw SQL', desc: 'Can send arbitrary SQL queries to the /query endpoint' },
      { key: 'db_schema_describe', label: 'Describe Schema', desc: 'Can inspect columns, types, and foreign key relations' },
    ],
  },
  {
    id: 'api_keys',
    label: 'API Key Management',
    items: [
      { key: 'keys_view', label: 'View API Keys', desc: 'Can inspect active API keys and rate limits' },
      { key: 'keys_create', label: 'Create API Keys', desc: 'Can issue new API keys bound to roles' },
      { key: 'keys_rotate', label: 'Rotate Secrets', desc: 'Can generate new cryptographic secrets for existing keys' },
      { key: 'keys_delete', label: 'Revoke API Keys', desc: 'Can permanently delete and invalidate API keys' },
    ],
  },
  {
    id: 'databases',
    label: 'Connection Pool Management',
    items: [
      { key: 'pools_view', label: 'View Database Pools', desc: 'Can view database aliases and connection statuses' },
      { key: 'pools_add', label: 'Register New Database', desc: 'Can add and configure new database endpoints' },
      { key: 'pools_delete', label: 'Deregister Database', desc: 'Can disconnect and remove database pools' },
    ],
  },
  {
    id: 'rbac_roles',
    label: 'Role-Based Access Control (RBAC)',
    items: [
      { key: 'roles_view', label: 'View Roles', desc: 'Can inspect role policies and permission rules' },
      { key: 'roles_create', label: 'Create Roles', desc: 'Can define new role configurations' },
      { key: 'roles_edit', label: 'Edit Permissions', desc: 'Can adjust operation matrices and table scopes' },
      { key: 'roles_delete', label: 'Delete Roles', desc: 'Can purge role records from metadata store' },
    ],
  },
  {
    id: 'mcp_explorer',
    label: 'MCP & API Explorer',
    items: [
      { key: 'mcp_access', label: 'Model Context Protocol', desc: 'Can connect to /mcp/v1 endpoint for LLM tool invocation' },
      { key: 'mcp_tools_invoke', label: 'Invoke MCP Tools', desc: 'Can trigger schema and query tools on behalf of AI agents' },
      { key: 'tester_execute', label: 'API Explorer Execution', desc: 'Can run queries directly in the Web UI API Explorer' },
    ],
  },
  {
    id: 'observability',
    label: 'Telemetry & Cache Control',
    items: [
      { key: 'logs_view_audit', label: 'View Audit Trail', desc: 'Can inspect immutable security mutation logs' },
      { key: 'metrics_view', label: 'View Metrics', desc: 'Can monitor gateway latencies and pool utilization' },
      { key: 'cache_stats_view', label: 'View Cache Statistics', desc: 'Can check L1 memory and L2 persistent hit rates' },
      { key: 'cache_flush', label: 'Flush Cache Engine', desc: 'Can purge cached query entries and force cold lookups' },
      { key: 'settings_view', label: 'System Configuration', desc: 'Can view server daemon runtime settings' },
    ],
  },
];

export const PermissionTable: React.FC<PermissionTableProps> = ({
  value,
  onChange,
  disabled = {},
  readOnly = false,
}) => {
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    database_crud: true,
    api_keys: false,
    databases: false,
    rbac_roles: false,
    mcp_explorer: false,
    observability: false,
  });

  const toggleExpand = (groupId: string) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  };

  const handleToggle = (key: keyof AxiomPermissions) => {
    if (readOnly || disabled[key]) return;
    
    const nextVal = !value[key];
    const newValue = { ...value, [key]: nextVal };

    // Parent-child relationships (e.g. create/edit requires view)
    const parentMap: Partial<Record<keyof AxiomPermissions, keyof AxiomPermissions>> = {
      keys_create: 'keys_view',
      keys_rotate: 'keys_view',
      keys_delete: 'keys_view',

      pools_add: 'pools_view',
      pools_delete: 'pools_view',

      roles_create: 'roles_view',
      roles_edit: 'roles_view',
      roles_delete: 'roles_view',

      mcp_tools_invoke: 'mcp_access',
    };

    // If toggling ON a child, force parent ON
    if (nextVal === true && parentMap[key]) {
      const parent = parentMap[key]!;
      if (!disabled[parent]) {
        newValue[parent] = true;
      }
    }

    // If toggling OFF a parent, force all its children OFF
    if (nextVal === false) {
      for (const [childKey, parentKey] of Object.entries(parentMap)) {
        if (parentKey === key) {
          newValue[childKey as keyof AxiomPermissions] = false;
        }
      }
    }

    onChange?.(newValue);
  };

  const handleToggleGroup = (items: { key: keyof AxiomPermissions }[]) => {
    if (readOnly) return;

    const enableableItems = items.filter((item) => !disabled[item.key]);
    if (enableableItems.length === 0) return;

    const allChecked = enableableItems.every((item) => value[item.key]);

    const newValue = { ...value };
    for (const item of enableableItems) {
      newValue[item.key] = !allChecked;
    }
    onChange?.(newValue);
  };

  return (
    <div className="w-full border border-[#222222] rounded-[8px] overflow-hidden bg-[#0c0c0c] divide-y divide-[#222222] font-sans select-none">
      {GROUPS.map((group) => {
        const isExpanded = !!expandedGroups[group.id];
        const enableableItems = group.items.filter((item) => !disabled[item.key]);
        const checkedCount = group.items.filter((i) => value[i.key]).length;
        const isGroupIndeterminate =
          enableableItems.some((i) => value[i.key]) &&
          !enableableItems.every((i) => value[i.key]);
        const isGroupChecked =
          enableableItems.length > 0 && enableableItems.every((i) => value[i.key]);
        const isGroupDisabled = enableableItems.length === 0;

        return (
          <div key={group.id} className="w-full">
            {/* Expandable Group Header */}
            <div
              onClick={() => toggleExpand(group.id)}
              className="flex items-center justify-between px-3.5 py-2.5 bg-[#141414] hover:bg-[#181818] transition-colors cursor-pointer select-none"
            >
              <div className="flex items-center gap-2 min-w-0 pr-2">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 256 256"
                  fill="currentColor"
                  className={cn(
                    "text-[#8c8c8c] shrink-0 transition-transform duration-150",
                    isExpanded && "rotate-90 text-white"
                  )}
                >
                  <path d="M92.69,216.49a12,12,0,0,1-17-17L147,128,75.71,56.49a12,12,0,0,1,17-17l80,80a12,12,0,0,1,0,17Z" />
                </svg>
                <span className="text-[13px] font-medium text-white truncate">{group.label}</span>
                <span
                  className={cn(
                    "text-[12px] tabular-nums",
                    checkedCount > 0 ? "text-[#3b82f6] font-medium" : "text-[#777777]"
                  )}
                >
                  ({checkedCount}/{enableableItems.length})
                </span>
              </div>

              <button
                type="button"
                role="checkbox"
                aria-checked={isGroupChecked ? 'true' : isGroupIndeterminate ? 'mixed' : 'false'}
                disabled={readOnly || isGroupDisabled}
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggleGroup(group.items);
                }}
                className={cn(
                  "relative flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border-0 bg-[#141414] ring-1 ring-[#3a3a3a] hover:ring-[#555555] focus:outline-none transition-all cursor-pointer",
                  isGroupChecked && "bg-[#3b82f6] ring-[#3b82f6]",
                  isGroupIndeterminate && "bg-[#3b82f6] ring-[#3b82f6]",
                  (readOnly || isGroupDisabled) && "opacity-40 cursor-not-allowed"
                )}
                title={isGroupChecked ? "Deselect group" : "Select all in group"}
              >
                {isGroupChecked ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" fill="currentColor" viewBox="0 0 256 256" className="text-white">
                    <path d="M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z" />
                  </svg>
                ) : isGroupIndeterminate ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" fill="currentColor" viewBox="0 0 256 256" className="text-white">
                    <path d="M228,128a12,12,0,0,1-12,12H40a12,12,0,0,1,0-24H216A12,12,0,0,1,228,128Z" />
                  </svg>
                ) : null}
              </button>
            </div>

            {/* Sub-items */}
            {isExpanded && (
              <div className="divide-y divide-[#1e1e1e] bg-[#0c0c0c] border-t border-[#222222]">
                {group.items.map((item) => {
                  const isChecked = !!value[item.key];
                  const isDisabled = readOnly || disabled[item.key];

                  return (
                    <div
                      key={item.key}
                      onClick={() => handleToggle(item.key)}
                      className={cn(
                        "flex items-center justify-between gap-3 px-3.5 py-2.5 transition-colors cursor-pointer",
                        isDisabled ? "bg-[#090909] opacity-50 cursor-not-allowed" : "hover:bg-[#141414]"
                      )}
                    >
                      <div className="flex flex-col min-w-0 pr-2 pl-3">
                        <span
                          className={cn(
                            "text-[13px] font-medium leading-tight",
                            isDisabled ? "text-[#777777]" : "text-white"
                          )}
                        >
                          {item.label}
                        </span>
                        <span className="text-[12px] text-[#777777] leading-normal mt-0.5 truncate" title={item.desc}>
                          {item.desc}
                        </span>
                      </div>

                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={isChecked}
                        disabled={isDisabled}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggle(item.key);
                        }}
                        className={cn(
                          "relative flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border-0 bg-[#141414] ring-1 ring-[#3a3a3a] hover:ring-[#555555] focus:outline-none transition-all cursor-pointer",
                          isChecked && !isDisabled && "bg-[#3b82f6] ring-[#3b82f6]",
                          isChecked && isDisabled && "bg-[#2a2a2a] ring-[#3a3a3a]",
                          isDisabled && "cursor-not-allowed opacity-50"
                        )}
                      >
                        {isChecked && (
                          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" fill="currentColor" viewBox="0 0 256 256" className="text-white">
                            <path d="M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z" />
                          </svg>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
