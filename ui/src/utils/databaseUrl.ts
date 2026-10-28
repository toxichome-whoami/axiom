/*
 * Connection URL builder, parser, and dialect validator.
 * Owned by: ui/utils
 * Contract: Matches the connection routing table implemented in crates/db/src/pool.rs.
 * Invariants:
 *  - Passwords and usernames are URL-encoded on build and URL-decoded on parse.
 *  - LibSQL supports local SQLite files jailed to data/ directory and remote Turso endpoints.
 *  - Snowflake supports account host, warehouse, role, schema, database, and encoded credentials.
 */

import { formatEngine } from "../types";

/**
 * Expected URL prefix mappings and examples per database engine dialect.
 * Contract: Matches the connection routing table implemented in crates/db/src/pool.rs.
 */
export const ENGINE_URL_SCHEMES: Record<
  string,
  { prefixes: string[]; example: string }
> = {
  postgresql: {
    prefixes: ["postgres://", "postgresql://"],
    example: "postgres://user:secret@host:5432/dbname",
  },
  mysql: {
    prefixes: ["mysql://", "mariadb://"],
    example: "mysql://user:secret@host:3306/dbname",
  },
  mssql: {
    prefixes: ["mssql://", "sqlserver://"],
    example: "mssql://user:secret@host:1433/dbname",
  },
  clickhouse: {
    prefixes: ["clickhouse://", "clickhouse+https://", "http://", "https://"],
    example: "clickhouse://user:secret@host:8123/default",
  },
  libsql: {
    prefixes: ["libsql://", "sqlite://", "file:", "https://"],
    example:
      "libsql://database.turso.io, https://database.turso.io, or leave blank",
  },
  snowflake: {
    prefixes: ["snowflake://", "snowflake+https://", "https://"],
    example:
      "snowflake://user:secret@account.snowflakecomputing.com?warehouse=COMPUTE_WH&database=DB&schema=PUBLIC",
  },
  oracle: {
    prefixes: ["oracle://", "oracle+tcp://", "ords://", "ords+https://"],
    example:
      "oracle://user:secret@host:1521/service or ords+https://host/ords/schema",
  },
};

export type SslMode =
  "prefer" | "require" | "disable" | "verify-ca" | "verify-full";

export const SSL_MODE_OPTIONS: { value: SslMode; label: string }[] = [
  { value: "prefer", label: "Prefer (default)" },
  { value: "require", label: "Require" },
  { value: "disable", label: "Disable" },
  { value: "verify-ca", label: "Verify CA" },
  { value: "verify-full", label: "Verify Full" },
];

/**
 * Extracts the current SSL mode from a database connection URL.
 */
export function extractSslModeFromUrl(url: string, engine: string): SslMode {
  const normEngine = (engine || "").toLowerCase();
  if (normEngine !== "postgresql" && normEngine !== "mysql") {
    return "prefer";
  }
  const qIdx = url.indexOf("?");
  if (qIdx === -1) return "prefer";
  const queryString = url.slice(qIdx + 1);
  const params = new URLSearchParams(queryString);
  const val = (
    params.get("sslmode") ||
    params.get("ssl-mode") ||
    ""
  ).toLowerCase();
  if (val === "require" || val === "required") return "require";
  if (val === "disable" || val === "disabled") return "disable";
  if (val === "verify-ca") return "verify-ca";
  if (val === "verify-full" || val === "verify_identity") return "verify-full";
  return "prefer";
}

/**
 * Updates or removes the SSL mode parameter in a database connection URL.
 */
export function applySslModeToUrl(
  url: string,
  engine: string,
  mode: SslMode,
): string {
  const normEngine = (engine || "").toLowerCase();
  if (normEngine !== "postgresql" && normEngine !== "mysql") {
    return url;
  }
  const trimmed = url.trim();
  if (!trimmed) return trimmed;

  const qIdx = trimmed.indexOf("?");
  const base = qIdx === -1 ? trimmed : trimmed.slice(0, qIdx);
  const queryString = qIdx === -1 ? "" : trimmed.slice(qIdx + 1);
  const params = new URLSearchParams(queryString);

  // Remove existing sslmode / ssl-mode params
  params.delete("sslmode");
  params.delete("ssl-mode");

  // If mode is not default 'prefer', set the appropriate param
  if (mode !== "prefer") {
    if (normEngine === "mysql") {
      const mysqlModeMap: Record<SslMode, string> = {
        prefer: "PREFERRED",
        require: "REQUIRED",
        disable: "DISABLED",
        "verify-ca": "VERIFY_CA",
        "verify-full": "VERIFY_IDENTITY",
      };
      params.set("ssl-mode", mysqlModeMap[mode] || mode);
    } else {
      params.set("sslmode", mode);
    }
  }

  const newQuery = params.toString();
  return newQuery ? `${base}?${newQuery}` : base;
}

export interface DatabaseConnectionFields {
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
  // Engine dialect specific fields
  libsqlMode?: "local" | "remote";
  libsqlFile?: string;
  token?: string;
  warehouse?: string;
  schema?: string;
  role?: string;
}

export const DEFAULT_ENGINE_PORTS: Record<string, string> = {
  postgresql: "5432",
  mysql: "3306",
  mssql: "1433",
  clickhouse: "8123",
  libsql: "8080",
  snowflake: "443",
  oracle: "1521",
};

export const DEFAULT_ENGINE_SCHEMES: Record<string, string> = {
  postgresql: "postgres",
  mysql: "mysql",
  mssql: "mssql",
  clickhouse: "clickhouse",
  libsql: "libsql",
  snowflake: "snowflake",
  oracle: "oracle",
};

/**
 * Builds a valid connection URL from discrete connection fields.
 * CONTRACT:
 *  - LibSQL Local: uses file path (or empty for default data/{alias}.db).
 *  - LibSQL Remote: uses libsql:// or https:// endpoint with token.
 *  - Snowflake: builds snowflake:// with warehouse, schema, role, and encoded credentials.
 *  - Relational: encodes username and password using encodeURIComponent so special characters
 *    (such as '@', ':', '#', '%', '&', '/') are safely escaped for driver URI parsers.
 *  - Retains SSL mode parameter if specified and engine is PostgreSQL or MySQL.
 */
export function buildDatabaseUrl(
  engine: string,
  fields: DatabaseConnectionFields,
  sslMode?: SslMode,
): string {
  const normEngine = (engine || "postgresql").toLowerCase().trim();

  // 1. LibSQL / SQLite specialized dialect handling
  if (normEngine === "libsql" || normEngine === "sqlite") {
    if (fields.libsqlMode === "remote") {
      let endpoint = (fields.host || "").trim();
      if (!endpoint) return "";
      if (!endpoint.includes("://")) {
        endpoint = `libsql://${endpoint}`;
      }
      if (fields.token && fields.token.trim()) {
        const hasQuery = endpoint.includes("?");
        return `${endpoint}${hasQuery ? "&" : "?"}authToken=${encodeURIComponent(fields.token.trim())}`;
      }
      return endpoint;
    } else {
      // Local SQLite file path or :memory:
      return (fields.libsqlFile || "").trim();
    }
  }

  // 2. Snowflake specialized dialect handling
  if (normEngine === "snowflake") {
    const host = (fields.host || "").trim();
    if (!host) return "";
    const username = (fields.username || "").trim();
    const password = fields.password || "";
    const database = (fields.database || "").trim();
    const schema = (fields.schema || "").trim();
    const warehouse = (fields.warehouse || "").trim();
    const role = (fields.role || "").trim();

    let auth = "";
    if (username && password) {
      auth = `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`;
    } else if (username) {
      auth = `${encodeURIComponent(username)}@`;
    } else if (password) {
      auth = `:${encodeURIComponent(password)}@`;
    }

    let path = "";
    if (database && schema) {
      path = `/${database}/${schema}`;
    } else if (database) {
      path = `/${database}`;
    }

    const params = new URLSearchParams();
    if (warehouse) params.set("warehouse", warehouse);
    if (role) params.set("role", role);
    const q = params.toString();

    return `snowflake://${auth}${host}${path}${q ? "?" + q : ""}`;
  }

  // 3. Standard Relational Engines (PostgreSQL, MySQL, MSSQL, ClickHouse, Oracle)
  const scheme = DEFAULT_ENGINE_SCHEMES[normEngine] || "postgres";
  const host = (fields.host || "").trim();
  const port = (fields.port || "").trim();
  const database = (fields.database || "").trim();
  const username = (fields.username || "").trim();
  const password = fields.password || "";

  if (!host && !database && !username && !password) {
    return "";
  }

  let auth = "";
  if (username && password) {
    auth = `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`;
  } else if (username) {
    auth = `${encodeURIComponent(username)}@`;
  } else if (password) {
    auth = `:${encodeURIComponent(password)}@`;
  }

  let hostPort = host;
  if (host && port) {
    hostPort = `${host}:${port}`;
  } else if (!host && port) {
    hostPort = `localhost:${port}`;
  }

  const cleanDb = database.replace(/^\/+/, "");
  let url = `${scheme}://${auth}${hostPort}/${cleanDb}`;

  if (
    sslMode &&
    sslMode !== "prefer" &&
    (normEngine === "postgresql" || normEngine === "mysql")
  ) {
    url = applySslModeToUrl(url, engine, sslMode);
  }

  return url;
}

/**
 * Parses a database connection URL into discrete connection fields.
 * CONTRACT:
 *  - Handles LibSQL local SQLite vs remote Turso endpoints.
 *  - Handles Snowflake URLs and query parameters.
 *  - Decodes username and password using decodeURIComponent so the user sees
 *    unencoded plaintext credentials in form fields.
 *  - Falls back to regex parser if WHATWG URL parser rejects custom schemes.
 */
export function parseDatabaseUrl(
  rawUrl: string,
  engine?: string,
): DatabaseConnectionFields {
  const normEngine = (engine || "").toLowerCase().trim();
  const defaultPort = DEFAULT_ENGINE_PORTS[normEngine] || "";

  const emptyFields: DatabaseConnectionFields = {
    host: "",
    port: defaultPort,
    database: "",
    username: "",
    password: "",
    libsqlMode: "local",
    libsqlFile: "",
    token: "",
    warehouse: "",
    schema: "",
    role: "",
  };

  const trimmed = (rawUrl || "").trim();
  if (!trimmed) return emptyFields;

  // 1. LibSQL / SQLite parsing
  if (normEngine === "libsql" || normEngine === "sqlite") {
    if (trimmed.startsWith("libsql://") || trimmed.startsWith("https://")) {
      try {
        const u = new URL(trimmed.replace(/^libsql:\/\//, "https://"));
        const token = u.searchParams.get("authToken") || "";
        u.searchParams.delete("authToken");
        const cleanHost = u.origin.replace(/^https:\/\//, "libsql://");
        return {
          ...emptyFields,
          libsqlMode: "remote",
          host: cleanHost,
          token,
        };
      } catch {
        return {
          ...emptyFields,
          libsqlMode: "remote",
          host: trimmed,
        };
      }
    } else {
      const cleanFile = trimmed
        .replace(/^sqlite:\/\//, "")
        .replace(/^file:\/\//, "")
        .replace(/^file:/, "");
      return {
        ...emptyFields,
        libsqlMode: "local",
        libsqlFile: cleanFile,
      };
    }
  }

  // 2. Snowflake parsing
  if (normEngine === "snowflake" || trimmed.startsWith("snowflake://")) {
    try {
      const normalizedScheme = trimmed.replace(
        /^snowflake(\+[a-z]+)?:\/\//,
        "https://",
      );
      const u = new URL(normalizedScheme);
      const segments = u.pathname.split("/").filter(Boolean);
      const db = segments[0] || u.searchParams.get("database") || "";
      const sch = segments[1] || u.searchParams.get("schema") || "";
      const wh = u.searchParams.get("warehouse") || "";
      const rl = u.searchParams.get("role") || "";
      let username = "";
      let password = "";
      if (u.username) {
        try {
          username = decodeURIComponent(u.username);
        } catch {
          username = u.username;
        }
      }
      if (u.password) {
        try {
          password = decodeURIComponent(u.password);
        } catch {
          password = u.password;
        }
      }
      return {
        ...emptyFields,
        host: u.hostname || "",
        database: db,
        schema: sch,
        warehouse: wh,
        role: rl,
        username,
        password,
      };
    } catch {
      // Fallback to regex below
    }
  }

  // 3. Standard Relational parsing
  try {
    const url = new URL(trimmed);
    let username = "";
    let password = "";
    if (url.username) {
      try {
        username = decodeURIComponent(url.username);
      } catch {
        username = url.username;
      }
    }
    if (url.password) {
      try {
        password = decodeURIComponent(url.password);
      } catch {
        password = url.password;
      }
    }
    return {
      ...emptyFields,
      host: url.hostname || "",
      port: url.port || defaultPort,
      database: (url.pathname || "").replace(/^\/+/, ""),
      username,
      password,
    };
  } catch {
    const regex =
      /^(?:([a-zA-Z0-9+.-]+):\/\/)?(?:([^:@\s]+)(?::([^@\s]*))?@)?([^:\/\s?#]+)?(?::([0-9]+))?(?:\/([^?#\s]*))?(?:\?(.*))?$/;
    const match = trimmed.match(regex);
    if (!match) return emptyFields;

    const rawUser = match[2] || "";
    const rawPass = match[3] || "";
    let username = rawUser;
    let password = rawPass;
    try {
      username = decodeURIComponent(rawUser);
    } catch {
      // Keep raw on malformed URI sequence
    }
    try {
      password = decodeURIComponent(rawPass);
    } catch {
      // Keep raw on malformed URI sequence
    }

    return {
      ...emptyFields,
      host: match[4] || "",
      port: match[5] || defaultPort,
      database: match[6] || "",
      username,
      password,
    };
  }
}

/**
 * Validates connection URI scheme against target database engine dialect.
 * CONTRACT:
 *  - Fails closed on empty, whitespace, or invalid scheme prefix.
 *  - Case-insensitive on protocol scheme.
 *  - Enforces minimum URI structure (scheme + target endpoint).
 *  - LibSQL allows empty string (defaults to data/{alias}.db) and restricts local paths to data/.
 * @param engine - Dialect identifier (e.g. 'PostgreSQL', 'MySQL', 'LibSQL')
 * @param rawUrl - Input URI string to validate
 */
export function validateDatabaseUrl(
  engine: string,
  rawUrl: string,
): { valid: boolean; error?: string } {
  const trimmed = rawUrl.trim();
  const normEngine = engine.toLowerCase().trim();

  // LibSQL / SQLite allows blank URL to auto-create sqlite://data/{alias}.db
  if (!trimmed) {
    if (normEngine === "libsql" || normEngine === "sqlite") {
      return { valid: true };
    }
    return { valid: false, error: "Connection URL is required." };
  }

  // Security jailing checks for local LibSQL / SQLite
  if (normEngine === "libsql" || normEngine === "sqlite") {
    if (trimmed.includes("..")) {
      return {
        valid: false,
        error:
          "Directory traversal ('..') is prohibited. Local databases are restricted to the 'data/' directory.",
      };
    }
    if (
      /^[a-zA-Z]:/.test(trimmed) ||
      (trimmed.startsWith("/") && !trimmed.startsWith("//"))
    ) {
      return {
        valid: false,
        error:
          "Absolute drive and root paths are prohibited. Local databases are restricted to the 'data/' directory.",
      };
    }
  }

  const spec = ENGINE_URL_SCHEMES[normEngine];
  if (!spec) {
    return { valid: trimmed.includes("://") || trimmed.startsWith("file:") };
  }

  const lowerUrl = trimmed.toLowerCase();
  const matched = spec.prefixes.some((p) => lowerUrl.startsWith(p));
  if (!matched) {
    // For LibSQL/SQLite, plain relative file names (e.g. mydb.db or data/mydb.db) are valid
    if (normEngine === "libsql" || normEngine === "sqlite") {
      if (!trimmed.includes("://")) {
        return { valid: true };
      }
    }
    return {
      valid: false,
      error: `Invalid URL protocol for ${formatEngine(engine)}. Expected prefix: ${spec.prefixes.join(" or ")}`,
    };
  }

  const matchedPrefix = spec.prefixes.find((p) => lowerUrl.startsWith(p))!;
  const remainder = trimmed.slice(matchedPrefix.length).trim();
  if (!remainder) {
    return {
      valid: false,
      error: "URL is missing host or target path after protocol prefix.",
    };
  }

  return { valid: true };
}
