package axiom

type AxiomConfig struct {
	BaseURL   string
	KeyName   string
	KeySecret string
}

type DatabaseInfo struct {
	Name        string `json:"name"`
	Engine      string `json:"engine"`
	Mode        string `json:"mode"`
	Status      string `json:"status"`
	TablesCount string `json:"tables_count,omitempty"`
}

type GenericResponse struct {
	Success bool                   `json:"success"`
	Data    map[string]interface{} `json:"data,omitempty"`
	Error   *AxiomError            `json:"error,omitempty"`
}

type DatabasesResponse struct {
	Success   bool           `json:"success"`
	Databases []DatabaseInfo `json:"databases,omitempty"`
	Error     *AxiomError    `json:"error,omitempty"`
}

type QueryResponse struct {
	Success      bool                     `json:"success"`
	Rows         []map[string]interface{} `json:"rows,omitempty"`
	AffectedRows int                      `json:"affected_rows,omitempty"`
	Error        *AxiomError              `json:"error,omitempty"`
}

type AxiomError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}


type TableInfo struct {
	Name string json:"name"
}

type TablesResponse struct {
	Success bool         json:"success"
	Tables  []TableInfo  json:"tables,omitempty"
	Error   *AxiomError  json:"error,omitempty"
}

type FetchRowsParams struct {
	Limit  int
	Cursor string
	Sort   string
	Order  string
	Filter map[string]interface{}
}

type FetchResponse struct {
	Success    bool                     json:"success"
	Rows       []map[string]interface{} json:"rows,omitempty"
	Pagination map[string]interface{}   json:"pagination,omitempty"
	Error      *AxiomError              json:"error,omitempty"
}

type MutationResponse struct {
	Success      bool        json:"success"
	AffectedRows int         json:"affected_rows,omitempty"
	Error        *AxiomError json:"error,omitempty"
}

