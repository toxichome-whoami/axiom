package axiom

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Client struct {
	baseURL string
	http    *http.Client
	token   string
}

func NewClient(config AxiomConfig) *Client {
	// Trim trailing slash so URL construction is always consistent
	baseURL := strings.TrimRight(config.BaseURL, "/")
	token := base64.StdEncoding.EncodeToString([]byte(config.KeyName + ":" + config.KeySecret))

	return &Client{
		baseURL: baseURL,
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

	req, err := http.NewRequest(method, c.baseURL+endpoint, bodyReader)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Axiom-Key", c.token)

	res, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()

	resBody, err := io.ReadAll(res.Body)
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

func (c *Client) ListTables(db string) (*TablesResponse, error) {
	var resp TablesResponse
	err := c.request("GET", fmt.Sprintf("/api/v1/db/%s/tables", db), nil, &resp)
	return &resp, err
}

func (c *Client) FetchRows(db, table string, params *FetchRowsParams) (*FetchResponse, error) {
	endpoint := fmt.Sprintf("/api/v1/db/%s/%s/rows", db, table)

	if params != nil {
		q := url.Values{}
		if params.Limit > 0 {
			q.Set("limit", fmt.Sprintf("%d", params.Limit))
		}
		if params.Cursor != "" {
			q.Set("cursor", params.Cursor)
		}
		if params.Sort != "" {
			q.Set("sort", params.Sort)
		}
		if params.Order != "" {
			q.Set("order", params.Order)
		}
		if params.Filter != nil {
			fBytes, err := json.Marshal(params.Filter)
			if err == nil {
				// url.Values.Encode() percent-encodes all values automatically
				q.Set("filter", string(fBytes))
			}
		}
		if qs := q.Encode(); qs != "" {
			endpoint = endpoint + "?" + qs
		}
	}

	var resp FetchResponse
	err := c.request("GET", endpoint, nil, &resp)
	return &resp, err
}

func (c *Client) InsertRows(db, table string, rows interface{}) (*MutationResponse, error) {
	var resp MutationResponse
	payload := map[string]interface{}{"rows": rows}
	err := c.request("POST", fmt.Sprintf("/api/v1/db/%s/%s/rows", db, table), payload, &resp)
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
	payload := map[string]interface{}{"filter": filter}
	err := c.request("DELETE", fmt.Sprintf("/api/v1/db/%s/%s/rows", db, table), payload, &resp)
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



func (c *Client) DescribeTable(db, table string) (*SchemaResponse, error) {
	var resp SchemaResponse
	err := c.request("GET", fmt.Sprintf("/api/v1/db/%s/%s/schema", db, table), nil, &resp)
	if err != nil {
		return nil, err
	}
	return &resp, nil
}
