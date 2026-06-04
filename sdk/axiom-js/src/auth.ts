import { AxiomClient } from "./client";

export class AuthAPI {
    constructor(private client: AxiomClient) {}

    public async login(email: string, password: string): Promise<any> {
        const res = await this.client.fetch(
            `/api/v1/auth/${this.client.projectId}/login`,
            {
                method: "POST",
                body: JSON.stringify({ email, password }),
            },
        );
        if (res.access_token) {
            this.client.setToken(res.access_token);
        }
        return res;
    }

    public async signup(email: string, password: string): Promise<any> {
        return this.client.fetch(
            `/api/v1/auth/${this.client.projectId}/signup`,
            {
                method: "POST",
                body: JSON.stringify({ email, password }),
            },
        );
    }

    public async logout(): Promise<any> {
        const res = await this.client.fetch(
            `/api/v1/auth/${this.client.projectId}/logout`,
            {
                method: "POST",
            },
        );
        this.client.userToken = undefined;
        return res;
    }

    public async getUser(): Promise<any> {
        return this.client.fetch(`/api/v1/auth/${this.client.projectId}/user`);
    }

    public getOAuthLoginUrl(provider: "google" | "github"): string {
        return `${this.client.url}/api/v1/auth/${this.client.projectId}/oauth/${provider}/login`;
    }
}
