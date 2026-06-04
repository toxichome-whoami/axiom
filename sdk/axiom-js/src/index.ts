import { AxiomClient, AxiomConfig } from "./client";
import { AuthAPI } from "./auth";
import { DatabaseAPI } from "./db";
import { StorageAPI } from "./fs";
import { RealtimeAPI } from "./realtime";

export class Axiom {
    private client: AxiomClient;
    public auth: AuthAPI;
    public db: DatabaseAPI;
    public fs: StorageAPI;
    public realtime: RealtimeAPI;

    constructor(config: AxiomConfig) {
        this.client = new AxiomClient(config);
        this.auth = new AuthAPI(this.client);
        this.db = new DatabaseAPI(this.client);
        this.fs = new StorageAPI(this.client);
        this.realtime = new RealtimeAPI(this.client);
    }
}

export * from "./client";
export * from "./auth";
export * from "./db";
export * from "./fs";
export * from "./realtime";
