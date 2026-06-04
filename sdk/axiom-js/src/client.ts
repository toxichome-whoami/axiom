export interface AxiomConfig {
    url: string;
    projectId?: string;
    apiKey?: string;
}

export class AxiomClient {
    public url: string;
    public projectId: string;
    public apiKey?: string;
    public userToken?: string;

    constructor(config: AxiomConfig) {
        this.url = config.url.replace(/\/$/, "");
        this.projectId = config.projectId || "default";
        if (config.apiKey) {
            this.apiKey = btoa(config.apiKey);
        }
    }

    public setToken(token: string) {
        this.userToken = token;
    }

    public async fetch(path: string, options: RequestInit = {}): Promise<any> {
        const headers = new Headers(options.headers || {});
        headers.set("Content-Type", "application/json");

        if (this.userToken) {
            headers.set("X-User-Access-Token", this.userToken);
        } else if (this.apiKey) {
            headers.set("X-Axiom-Key", this.apiKey);
        }

        const res = await fetch(`${this.url}${path}`, {
            ...options,
            headers,
        });

        const json = await res.json();
        if (!json.success) {
            throw new Error(json.error?.message || "Unknown error");
        }
        return json.data;
    }
}
