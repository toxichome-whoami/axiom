import { AxiomClient } from "./client";

export class StorageAPI {
    constructor(private client: AxiomClient) {}

    public async list(
        alias: string,
        path: string = "/",
        params: any = {},
    ): Promise<any> {
        const q = new URLSearchParams();
        q.set("path", path);
        if (params.limit) q.set("limit", params.limit);
        if (params.continuation_token)
            q.set("continuation_token", params.continuation_token);
        if (params.recursive) q.set("recursive", "true");

        return this.client.fetch(`/api/v1/fs/${alias}/list?${q.toString()}`);
    }

    public async download(alias: string, path: string): Promise<any> {
        const q = new URLSearchParams();
        q.set("path", path);
        return this.client.fetch(
            `/api/v1/fs/${alias}/download?${q.toString()}`,
        );
    }

    // Uploading raw files requires FormData, which uses different headers
    public async upload(
        alias: string,
        path: string,
        file: Blob,
        filename: string,
    ): Promise<any> {
        const formData = new FormData();
        formData.append("action", "direct");
        formData.append("path", path);
        formData.append("file", file, filename);

        const headers = new Headers();
        if (this.client.userToken) {
            headers.set("X-User-Access-Token", this.client.userToken);
        } else if (this.client.apiKey) {
            headers.set("X-Axiom-Key", this.client.apiKey);
        }

        const res = await fetch(
            `${this.client.url}/api/v1/fs/${alias}/upload`,
            {
                method: "POST",
                headers,
                body: formData,
            },
        );

        const json = await res.json();
        if (!json.success)
            throw new Error(json.error?.message || "Unknown error");
        return json.data;
    }
}
