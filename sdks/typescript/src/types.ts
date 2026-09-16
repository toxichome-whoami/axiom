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

export interface AxiomResponse<T = Record<string, unknown>> {
  success: boolean;
  error?: AxiomError;
  pagination?: Pagination;
  // The response fields are spread at the top level (e.g. rows, databases, tables)
  // so T is intersected below per method rather than nested in data
  rows?: unknown[];
  databases?: unknown[];
  tables?: unknown[];
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

export interface MutationResponse {
  affected_rows?: number;
}

export interface QueryResponse<T = Record<string, unknown>> {
  rows?: T[];
  affected_rows?: number;
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
