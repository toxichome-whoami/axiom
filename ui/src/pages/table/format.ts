/*
 * Pure formatting and column type helper functions for the Table Editor.
 * Owned by: ui/pages/table
 * Key deps: lucide-react
 * Invariants: Pure functions without React state; zero side effects.
 */

import {
  Key,
  Link2,
  Hash,
  Type,
  Clock,
  CheckSquare,
  Code2,
} from 'lucide-react';

/**
 * Maps SQL column types to compact visual badge descriptors.
 */
export function getColumnTypeBadge(typeName: string, isPk: boolean, isFk: boolean) {
  const norm = (typeName || '').toLowerCase();

  if (isPk) {
    return {
      icon: Key,
      label: typeName || 'PK',
      color: 'text-[#8c8c8c]',
    };
  }
  if (isFk) {
    return {
      icon: Link2,
      label: typeName || 'FK',
      color: 'text-[#8c8c8c]',
    };
  }

  if (
    norm.includes('int') ||
    norm.includes('float') ||
    norm.includes('double') ||
    norm.includes('decimal') ||
    norm.includes('numeric') ||
    norm.includes('real')
  ) {
    return {
      icon: Hash,
      label: typeName,
      color: 'text-[#8c8c8c]',
    };
  }
  if (norm.includes('char') || norm.includes('text') || norm.includes('string')) {
    return {
      icon: Type,
      label: typeName,
      color: 'text-[#8c8c8c]',
    };
  }
  if (norm.includes('time') || norm.includes('date')) {
    return {
      icon: Clock,
      label: typeName,
      color: 'text-[#8c8c8c]',
    };
  }
  if (norm.includes('bool')) {
    return {
      icon: CheckSquare,
      label: typeName,
      color: 'text-[#8c8c8c]',
    };
  }
  if (norm.includes('json') || norm.includes('array')) {
    return {
      icon: Code2,
      label: typeName,
      color: 'text-[#8c8c8c]',
    };
  }

  return {
    icon: Type,
    label: typeName || 'text',
    color: 'text-[#8c8c8c]',
  };
}

/**
 * Translates verbose SQL information_schema types into concise tokens.
 */
export function formatColumnType(rawType: string): string {
  if (!rawType) return 'text';
  const norm = rawType.toLowerCase().trim();

  if (norm === 'character varying' || norm.startsWith('varchar')) return 'varchar';
  if (norm === 'character' || norm === 'char' || norm.startsWith('char(')) return 'char';
  if (norm === 'integer' || norm === 'int' || norm === 'int4') return 'int4';
  if (norm === 'bigint' || norm === 'int8') return 'int8';
  if (norm === 'smallint' || norm === 'int2') return 'int2';
  if (norm === 'tinyint') return 'int2';
  if (norm === 'boolean' || norm === 'bool') return 'bool';
  if (norm === 'timestamp with time zone' || norm === 'timestamptz') return 'timestamptz';
  if (norm === 'timestamp without time zone' || norm === 'timestamp') return 'timestamp';
  if (norm === 'time with time zone' || norm === 'timetz') return 'timetz';
  if (norm === 'time without time zone' || norm === 'time') return 'time';
  if (norm === 'double precision' || norm === 'float8') return 'float8';
  if (norm === 'real' || norm === 'float4') return 'float4';
  if (norm === 'numeric' || norm.startsWith('decimal') || norm.startsWith('numeric(')) return 'numeric';
  if (norm === 'text') return 'text';
  if (norm === 'jsonb') return 'jsonb';
  if (norm === 'json') return 'json';
  if (norm === 'uuid') return 'uuid';
  if (norm === 'bytea' || norm === 'blob') return 'bytea';
  if (norm === 'date') return 'date';
  if (norm.startsWith('serial')) return 'serial';
  if (norm.startsWith('bigserial')) return 'bigserial';

  const clean = norm.replace(/\(.*\)/, '').trim();
  if (clean === 'character varying' || clean === 'varchar') return 'varchar';
  if (clean === 'int' || clean === 'integer') return 'int4';
  return clean || norm;
}

/**
 * Maps raw database engine data types to the exact form option values in CustomSelect.
 */
export function mapSqlTypeToFormValue(rawType: string): string {
  if (!rawType) return 'text';
  const norm = rawType.toLowerCase().trim();

  if (norm.startsWith('varchar') || norm.includes('character varying') || norm.startsWith('char')) {
    return 'varchar(255)';
  }
  if (norm === 'text') return 'text';
  if (norm === 'integer' || norm === 'int' || norm === 'int4') return 'integer';
  if (norm === 'bigint' || norm === 'int8') return 'bigint';
  if (norm === 'smallint' || norm === 'int2' || norm === 'tinyint') return 'smallint';
  if (norm === 'boolean' || norm === 'bool' || norm === 'bit') return 'boolean';
  if (norm.includes('timestamp with time zone') || norm === 'timestamptz') return 'timestamp with time zone';
  if (norm.includes('timestamp') || norm.includes('datetime')) return 'timestamp without time zone';
  if (norm === 'date') return 'date';
  if (norm.startsWith('time')) return 'time';
  if (norm.includes('numeric') || norm.includes('decimal') || norm.includes('money')) return 'numeric';
  if (norm.includes('double') || norm.includes('float8')) return 'double precision';
  if (norm.includes('real') || norm.includes('float4') || norm.startsWith('float')) return 'real';
  if (norm === 'jsonb') return 'jsonb';
  if (norm === 'json') return 'json';
  if (norm === 'uuid') return 'uuid';
  if (norm === 'bytea' || norm === 'blob' || norm.includes('binary')) return 'bytea';

  return 'text';
}

/**
 * Calibrated shrink-fitted widths based on exact SQL semantic data types.
 */
export function getDefaultColumnWidth(typeName: string, colName?: string): number {
  const norm = (typeName || '').toLowerCase().trim();
  const normName = (colName || '').toLowerCase().trim();

  if (norm.includes('bool') || norm === 'bit') {
    return 110;
  }
  if (normName === 'id' || normName.endsWith('_id') || normName.endsWith('_fk')) {
    return 130;
  }
  if (
    normName.includes('qty') ||
    normName.includes('quantity') ||
    normName.includes('count') ||
    normName.includes('age') ||
    norm.includes('int2') ||
    norm.includes('smallint') ||
    norm.includes('tinyint')
  ) {
    return 120;
  }
  if (norm.includes('int') || norm.includes('serial') || norm.includes('year')) {
    return 140;
  }
  if (
    norm.includes('float') ||
    norm.includes('double') ||
    norm.includes('decimal') ||
    norm.includes('numeric') ||
    norm.includes('money') ||
    norm.includes('real')
  ) {
    return 155;
  }
  if (norm === 'date') {
    return 145;
  }
  if (norm === 'time' || norm.startsWith('time without')) {
    return 135;
  }
  if (norm.includes('time') || norm.includes('timestamp')) {
    return 210;
  }
  if (norm.includes('uuid') || norm.includes('guid') || normName.includes('hash') || normName.includes('token')) {
    return 235;
  }
  if (normName.includes('email') || normName.includes('url') || normName.includes('avatar') || normName.includes('link')) {
    return 240;
  }
  if (norm.includes('json') || norm.includes('xml') || norm.includes('bytea') || norm.includes('blob')) {
    return 210;
  }
  if (norm.includes('text') || norm.includes('char') || norm.includes('string')) {
    if (normName.includes('name') || normName.includes('title')) return 190;
    if (normName.includes('description') || normName.includes('bio') || normName.includes('comment')) return 260;
    return 180;
  }
  return 160;
}

/**
 * Exports records to a downloaded file formatted as CSV, JSON, or SQL INSERT statements.
 */
export function exportTableData(
  format: 'csv' | 'json' | 'sql',
  tableName: string,
  rows: Record<string, unknown>[],
  columns: { name: string; type: string }[]
) {
  if (rows.length === 0) return;

  const colNames = columns.length > 0 ? columns.map((c) => c.name) : Object.keys(rows[0]);
  let content = '';
  let mimeType = 'text/plain';
  let fileExt = format;

  if (format === 'json') {
    content = JSON.stringify(rows, null, 2);
    mimeType = 'application/json';
    fileExt = 'json';
  } else if (format === 'csv') {
    mimeType = 'text/csv;charset=utf-8;';
    fileExt = 'csv';
    // CSV Header
    const header = colNames.map((c) => `"${c.replace(/"/g, '""')}"`).join(',');
    // CSV Rows
    const dataLines = rows.map((r) => {
      return colNames
        .map((col) => {
          const val = r[col];
          if (val === null || val === undefined) return '';
          if (typeof val === 'object') {
            return `"${JSON.stringify(val).replace(/"/g, '""')}"`;
          }
          const str = String(val);
          return `"${str.replace(/"/g, '""')}"`;
        })
        .join(',');
    });
    content = [header, ...dataLines].join('\r\n');
  } else if (format === 'sql') {
    mimeType = 'application/sql';
    fileExt = 'sql';
    const escapedTable = `"${tableName.replace(/"/g, '""')}"`;
    const escapedCols = colNames.map((c) => `"${c.replace(/"/g, '""')}"`).join(', ');

    const insertStatements = rows.map((r) => {
      const values = colNames
        .map((col) => {
          const val = r[col];
          if (val === null || val === undefined) return 'NULL';
          if (typeof val === 'number') return isNaN(val) ? 'NULL' : String(val);
          if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
          if (typeof val === 'object') {
            return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
          }
          return `'${String(val).replace(/'/g, "''")}'`;
        })
        .join(', ');

      return `INSERT INTO ${escapedTable} (${escapedCols}) VALUES (${values});`;
    });

    content = insertStatements.join('\n');
  }

  // Trigger browser download
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${tableName || 'export'}_${new Date().toISOString().slice(0, 10)}.${fileExt}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
