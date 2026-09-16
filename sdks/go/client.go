package axiom

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"net/http"
	"strings"
	"time"
)

type Client struct {
	config AxiomConfig
	http   *http.Client
	token  string
}

func NewClient(config AxiomConfig) *Client {
	baseURL := strings.TrimRight(config.BaseURL, "/")
	token := base64.StdEncoding.EncodeToString([]byte(config.KeyName + ":" + config.KeySecret))

	return &Client{
		config: config,
		http: &http.Client{
			Timeout: time.Second * 30,
		},
		token: token,
	}
}

func (c *Client) request(method, endpoint string, body interface{}, out interface{}) error {
	var bodyReader *bytes.Reader
	if body != nil {
		jsonBytes, err := json.Marshal(body)
		if err != nil {
			return err
		}
		bodyReader = bytes.NewReader(jsonBytes)
	} else {
		bodyReader = bytes.NewReader([]byte{})
	}

	req, err := http.NewRequest(method, c.config.BaseURL+endpoint, bodyReader)
	if err != nil {
		return err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Axiom-Key", c.token)

	res, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()

	resBody, err := ioutil.ReadAll(res.Body)
	if err != nil {
		return err
	}

	err = json.Unmarshal(resBody, out)
	if err != nil {
		return fmt.Errorf("failed to parse JSON: %s", string(resBody))
	}

	return nil
}

func (c *Client) ListDatabases() (*DatabasesResponse, error) {
	var resp DatabasesResponse
	err := c.request("GET", "/api/v1/db/databases", nil, &resp)
	return &resp, err
}

func (c *Client) Query(db string, sql string, params map[string]interface{}) (*QueryResponse, error) {
	payload := map[string]interface{}{
		"sql": sql,
	}
	if params != nil {
		payload["params"] = params
	}

	var resp QueryResponse
	err := c.request("POST", fmt.Sprintf("/api/v1/db/%s/query", db), payload, &resp)
	return &resp, err
}


func (c *Client) ListTables(db string) (*TablesResponse, error) {
	var resp TablesResponse
	err := c.request("GET", fmt.Sprintf("/api/v1/db/%s/tables", db), nil, &resp)
	return &resp, err
}

func (c *Client) FetchRows(db, table string, params *FetchRowsParams) (*FetchResponse, error) {
	endpoint := fmt.Sprintf("/api/v1/db/%s/%s/rows", db, table)
	
	if params != nil {
		req, _ := http.NewRequest("GET", c.config.BaseURL+endpoint, nil)
		q := req.URL.Query()
		if params.Limit > 0 {
			q.Add("limit", fmt.Sprintf("%d", params.Limit))
		}
		if params.Cursor != "" {
			q.Add("cursor", params.Cursor)
		}
		if params.Sort != "" {
			q.Add("sort", params.Sort)
		}
		if params.Order != "" {
			q.Add("order", params.Order)
		}
		if params.Filter != nil {
			fBytes, _ := json.Marshal(params.Filter)
			q.Add("filter", string(fBytes))
		}
		endpoint = endpoint + "?" + q.Encode()
	}

	var resp FetchResponse
	err := c.request("GET", endpoint, nil, &resp)
	return &resp, err
}

func (c *Client) InsertRows(db, table string, rows interface{}) (*MutationResponse, error) {
	var resp MutationResponse
	err := c.request("POST", fmt.Sprintf("/api/v1/db/%s/%s/rows", db, table), rows, &resp)
	return &resp, err
}

func (c *Client) UpdateRows(db, table string, filter map[string]interface{}, update map[string]interface{}) (*MutationResponse, error) {
	payload := map[string]interface{}{
		"filter": filter,
		"update": update,
	}
	var resp MutationResponse
	err := c.request("PATCH", fmt.Sprintf("/api/v1/db/%s/%s/rows", db, table), payload, &resp)
	return &resp, err
}

func (c *Client) DeleteRows(db, table string, filter map[string]interface{}) (*MutationResponse, error) {
	var resp MutationResponse
	err := c.request("DELETE", fmt.Sprintf("/api/v1/db/%s/%s/rows", db, table), filter, &resp)
	return &resp, err
}
