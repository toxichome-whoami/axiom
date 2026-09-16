import { AxiomConfig, DatabasesResponse, TablesResponse, SchemaResponse, FetchResponse, FetchRowsParams, MutationResponse, QueryResponse } from "./types";

export * from "./types";

export class AxiomClient {
  private readonly baseUrl: string;
  private readonly headers: HeadersInit;

  constructor(config: AxiomConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");

    // btoa is available natively in Browser, Node 16+, and Cloudflare Workers
    const token = btoa(`${config.keyName}:${config.keySecret}`);
    this.headers = {
      "Content-Type": "application/json",
      "X-Axiom-Key": token,
    };
  }

  private async request<T extends { success: boolean, error?: any }>(method: string, endpoint: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const options: RequestInit = {
      method,
      headers: this.headers,
    };

    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, options);
      const json = (await response.json()) as T;

      if (!response.ok) {
        return {
          success: false,
          error: json.error ?? { code: "UNKNOWN", message: `HTTP ${response.status}` },
        } as unknown as T;
      }

      return json;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: { code: "NETWORK_ERROR", message },
      } as unknown as T;
    }
  }

  /** List all databases the API key has access to. */
  listDatabases(): Promise<DatabasesResponse> {
    return this.request("GET", "/api/v1/db/databases");
  }

  /** List all tables in a specific database. */
  listTables(db: string): Promise<TablesResponse> {
    return this.request("GET", `/api/v1/db/${db}/tables`);
  }

  /** Get the column schema and foreign key relationships for a table. */
  describeTable(db: string, table: string): Promise<SchemaResponse> {
    return this.request("GET", `/api/v1/db/${db}/${table}/schema`);
  }

  /** Fetch rows from a table with full cursor pagination and filter support. */
  fetchRows<T = Record<string, unknown>>(
    db: string,
    table: string,
    params?: FetchRowsParams
  ): Promise<FetchResponse<T>> {
    const qs = new URLSearchParams();
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          qs.append(key, typeof value === "object" ? JSON.stringify(value) : String(value));
        }
      }
    }
    const query = qs.toString();
    return this.request("GET", `/api/v1/db/${db}/${table}/rows${query ? "?" + query : ""}`);
  }

  /**
   * Async generator that transparently paginates through ALL rows using the cursor.
   *
   * @example
   * for await (const page of client.fetchAllRows("main_db", "users")) {
   *   for (const row of page) console.log(row);
   * }
   */
  async *fetchAllRows<T = Record<string, unknown>>(
    db: string,
    table: string,
    params?: Omit<FetchRowsParams, "cursor">
  ): AsyncGenerator<T[]> {
    let cursor: string | null = null;

    while (true) {
      const result: FetchResponse<T> = await this.fetchRows<T>(db, table, { ...params, cursor: cursor ?? undefined });
      const rows = result.data?.rows ?? [];
      yield rows;

      const nextCursor: string | null = result.data?.pagination?.next_cursor ?? null;
      if (!nextCursor || rows.length === 0) break;
      cursor = nextCursor;
    }
  }

  /** Insert one row or an array of rows into a table. */
  insertRows<T = Record<string, unknown>>(
    db: string,
    table: string,
    rows: Partial<T> | Partial<T>[]
  ): Promise<MutationResponse> {
    const payload = Array.isArray(rows) ? rows : [rows];
    return this.request("POST", `/api/v1/db/${db}/${table}/rows`, { rows: payload });
  }

  /** Update rows matching filter with the values in update. */
  updateRows(
    db: string,
    table: string,
    filter: Record<string, unknown>,
    update: Record<string, unknown>
  ): Promise<MutationResponse> {
    return this.request("PATCH", `/api/v1/db/${db}/${table}/rows`, { filter, update });
  }

  /** Delete rows matching the filter. */
  deleteRows(
    db: string,
    table: string,
    filter: Record<string, unknown>
  ): Promise<MutationResponse> {
    return this.request("DELETE", `/api/v1/db/${db}/${table}/rows`, { filter });
  }

  /** Execute a raw SQL query. */
  query<T = Record<string, unknown>>(
    db: string,
    sql: string,
    params?: Record<string, unknown>
  ): Promise<QueryResponse<T>> {
    return this.request("POST", `/api/v1/db/${db}/query`, { sql, params });
  }
}
