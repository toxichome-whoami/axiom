package main

import "fmt"

func RunStorageTests() {
	testEndpoint("List Storages", "GET", "/api/v1/fs/storages", nil, nil)
	testEndpoint("List Root Folder", "GET", fmt.Sprintf("/api/v1/fs/%s/list?path=/", StorageName), nil, nil)
	testEndpoint("Initiate Upload", "POST", fmt.Sprintf("/api/v1/fs/%s/action", StorageName), map[string]string{"action": "initiate"}, nil)
	testEndpoint("FS Presign", "POST", fmt.Sprintf("/api/v1/fs/%s/presign", StorageName), map[string]string{"path": "test.txt"}, nil)
	testEndpoint("FS Download", "GET", fmt.Sprintf("/api/v1/fs/%s/download/test.txt", StorageName), nil, nil)
}
