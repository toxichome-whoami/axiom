import { AxiomConfig, AxiomResponse, DatabaseInfo, FetchRowsParams } from "./types";

export * from "./types";

export class AxiomClient {
  private config: AxiomConfig;
  private headers: Headers;

  constructor(config: AxiomConfig) {
    this.config = {
      ...config,
      baseUrl: config.baseUrl.replace(/\/$/, "")
    };

    const token = Buffer.from(`${config.keyName}:${config.keySecret}`).toString("base64");
    
    this.headers = new Headers({
      "Content-Type": "application/json",
      "X-Axiom-Key": token,
    });
  }

  private async request<T>(method: string, endpoint: string, body?: any): Promise<AxiomResponse<T>> {
    const url = `${this.config.baseUrl}${endpoint}`;
    
    const options: RequestInit = {
      method,
      headers: this.headers,
    };

    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, options);
      const json = await response.json() as any;
      
      if (!response.ok) {
        return {
          success: false,
          error: json.error || { code: "UNKNOWN", message: `HTTP ${response.status}` }
        };
      }
      
      return json;
    } catch (err: any) {
      return {
        success: false,
        error: { code: "NETWORK_ERROR", message: err.message }
      };
    }
  }

  // List all databases
  public async listDatabases(): Promise<AxiomResponse<{ databases: DatabaseInfo[] }>> {
    return this.request("GET", "/api/v1/db/databases");
  }

    // List tables in a database
  public async listTables(db: string): Promise<AxiomResponse<{ tables: TableInfo[] }>> {
    return this.request("GET", /api/v1/db/ + db + /tables);
  }

  // Fetch rows with cursor pagination
  public async fetchRows<T = any>(db: string, table: string, params?: FetchRowsParams): Promise<AxiomResponse<{ rows: T[] }>> {
    const urlParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          urlParams.append(key, typeof value === "object" ? JSON.stringify(value) : String(value));
        }
      });
    }
    
    const qs = urlParams.toString();
    const endpoint = `/api/v1/db/${db}/${table}/rows${qs ? "?" + qs : ""}`;
    return this.request("GET", endpoint);
  }

  // Insert rows
  public async insertRows<T = any>(db: string, table: string, rows: Partial<T> | Partial<T>[]): Promise<AxiomResponse<any>> {
    const payload = Array.isArray(rows) ? rows : [rows];
    return this.request("POST", `/api/v1/db/${db}/${table}/rows`, payload);
  }

  // Update rows
  public async updateRows(db: string, table: string, filter: Record<string, any>, update: Record<string, any>): Promise<AxiomResponse<any>> {
    return this.request("PATCH", `/api/v1/db/${db}/${table}/rows`, { filter, update });
  }

  // Delete rows
  public async deleteRows(db: string, table: string, filter: Record<string, any>): Promise<AxiomResponse<any>> {
    return this.request("DELETE", `/api/v1/db/${db}/${table}/rows`, filter);
  }

  // Execute raw query
  public async query<T = any>(db: string, sql: string, params?: Record<string, any>): Promise<AxiomResponse<{ rows: T[], affected_rows: number }>> {
    return this.request("POST", `/api/v1/db/${db}/query`, { sql, params });
  }
}


