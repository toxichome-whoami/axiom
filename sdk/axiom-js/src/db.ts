import { AxiomClient } from "./client";

export class DatabaseAPI {
    constructor(private client: AxiomClient) {}

    public async select(
        alias: string,
        table: string,
        params: any = {},
    ): Promise<any> {
        const q = new URLSearchParams();
        if (params.limit) q.set("limit", params.limit);
        if (params.cursor) q.set("cursor", params.cursor);
        if (params.sort) q.set("sort", params.sort);
        if (params.order) q.set("order", params.order);
        if (params.filter) q.set("filter", JSON.stringify(params.filter));

        return this.client.fetch(
            `/api/v1/db/${alias}/${table}/rows?${q.toString()}`,
        );
    }

    public async insert(
        alias: string,
        table: string,
        rows: any[],
    ): Promise<any> {
        return this.client.fetch(`/api/v1/db/${alias}/${table}/rows`, {
            method: "POST",
            body: JSON.stringify({ rows }),
        });
    }

    public async update(
        alias: string,
        table: string,
        filter: any,
        update: any,
    ): Promise<any> {
        return this.client.fetch(`/api/v1/db/${alias}/${table}/rows`, {
            method: "PATCH",
            body: JSON.stringify({ filter, update }),
        });
    }

    public async delete(
        alias: string,
        table: string,
        filter: any,
    ): Promise<any> {
        return this.client.fetch(`/api/v1/db/${alias}/${table}/rows`, {
            method: "DELETE",
            body: JSON.stringify({ filter }),
        });
    }

    public async query(
        alias: string,
        sql: string,
        params: any = {},
    ): Promise<any> {
        return this.client.fetch(`/api/v1/db/${alias}/query`, {
            method: "POST",
            body: JSON.stringify({ sql, params }),
        });
    }

    public async listMigrations(alias: string): Promise<any> {
        return this.client.fetch(`/api/v1/db/${alias}/migrations`);
    }

    public async applyMigrations(alias: string): Promise<any> {
        return this.client.fetch(`/api/v1/db/${alias}/migrations`, {
            method: "POST",
        });
    }
}
