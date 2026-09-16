export interface AxiomConfig {
  baseUrl: string;
  keyName: string;
  keySecret: string;
}

export interface AxiomResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  pagination?: {
    limit: number;
    has_more: boolean;
    next_cursor: string | null;
  };
}

export interface DatabaseInfo {
  name: string;
  engine: string;
  mode: string;
  status: string;
  tables_count?: string;
}

export interface FetchRowsParams {
  limit?: number;
  cursor?: string;
  sort?: string;
  order?: "asc" | "desc";
  filter?: Record<string, any>;
  fields?: string;
  search?: string;
  search_fields?: string;
  count?: number;
}


export interface TableInfo {
  name: string;
}
