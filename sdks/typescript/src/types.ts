export interface AxiomConfig {
  baseUrl: string;
  keyName: string;
  keySecret: string;
}

export interface AxiomError {
  code: string;
  message: string;
}

export interface Pagination {
  limit: number;
  has_more: boolean;
  next_cursor: string | null;
}

export interface DatabaseInfo {
  name: string;
  engine: string;
  mode: string;
  status: string;
  tables_count?: string;
}

export interface TableInfo {
  name: string;
}

// Server returns databases at top level
export interface DatabasesResponse {
  success: boolean;
  databases?: DatabaseInfo[];
  error?: AxiomError;
}

// Server returns tables inside data
export interface TablesResponse {
  success: boolean;
  data?: {
    database: string;
    tables: TableInfo[];
  };
  error?: AxiomError;
}

// Server returns schema inside data
export interface SchemaResponse {
  success: boolean;
  data?: {
    database: string;
    table: string;
    columns: any[];
    foreign_keys: any[];
  };
  error?: AxiomError;
}

// FetchRows returns rows and pagination inside data
export interface FetchResponse<T = Record<string, unknown>> {
  success: boolean;
  data?: {
    rows: T[];
    pagination?: Pagination;
  };
  error?: AxiomError;
}

// Insert/Update/Delete returns affected_rows at top level
export interface MutationResponse {
  success: boolean;
  affected_rows?: number;
  error?: AxiomError;
}

// Query returns rows and affected_rows at top level
export interface QueryResponse<T = Record<string, unknown>> {
  success: boolean;
  rows?: T[];
  affected_rows?: number;
  error?: AxiomError;
}

export interface FetchRowsParams {
  limit?: number;
  cursor?: string;
  sort?: string;
  order?: "asc" | "desc";
  filter?: Record<string, unknown>;
  fields?: string;
  search?: string;
  search_fields?: string;
}
