export class AxiomAuth {
    /**
     * @param {Object} config
     * @param {string} config.baseUrl  The base URL of the Axiom backend (e.g. "http://localhost:4500")
     * @param {string} config.apiKey  The API key for the project (key name, not secret)
     * @param {string} config.projectId  The project ID (matches the api_key name in config.toml)
     */
    constructor({ baseUrl, apiKey, projectId }) {
        this.baseUrl = baseUrl.replace(/\/$/, "");
        this.apiKey = apiKey;
        this.projectId = projectId || apiKey;
        this.accessToken = null;
        this.refreshToken = null;
    }

    /**
     * Helper to restore tokens from storage (e.g. localStorage).
     */
    setTokens({ access_token, refresh_token }) {
        if (access_token) this.accessToken = access_token;
        if (refresh_token) this.refreshToken = refresh_token;
    }

    /**
     * Internal request wrapper.
     * @param {string} method  HTTP method
     * @param {string} path    Path relative to /api/v1/auth/{projectId}
     * @param {any}    body    JSON body (or null)
     * @param {boolean} useUserToken  If true, sends the user's access token. Otherwise sends the API key.
     */
    async _request(method, path, body = null, useUserToken = false) {
        const headers = {
            "Content-Type": "application/json",
            "x-api-key": this.apiKey,
        };

        if (useUserToken) {
            if (!this.accessToken) throw new Error("Missing access token");
            headers["Authorization"] = `Bearer ${this.accessToken}`;
        }

        const options = { method, headers };
        if (body !== null) options.body = JSON.stringify(body);

        const url = `${this.baseUrl}/api/v1/auth/${this.projectId}${path}`;
        let response = await fetch(url, options);

        // Auto-refresh on 401 if we have a refresh token and this was a user-token request
        if (response.status === 401 && this.refreshToken && useUserToken) {
            try {
                await this.refresh();
                headers["Authorization"] = `Bearer ${this.accessToken}`;
                response = await fetch(url, { ...options, headers });
            } catch {
                throw new Error("Session expired and could not be refreshed.");
            }
        }

        if (!response.ok) {
            let errBody;
            try {
                errBody = await response.json();
            } catch {
                errBody = { message: response.statusText };
            }
            throw new Error(
                errBody?.detail ||
                    errBody?.error?.message ||
                    errBody?.message ||
                    "Request failed",
            );
        }

        return response.json();
    }

    // ─── Signup & Login ───────────────────────────────────────────────────────

    async signup(email, password, { displayName, avatarUrl, metadata } = {}) {
        const res = await this._request("POST", "/signup", {
            email,
            password,
            display_name: displayName,
            avatar_url: avatarUrl,
            metadata,
        });
        this.setTokens(res);
        return res;
    }

    async login(email, password) {
        const res = await this._request("POST", "/login", { email, password });
        if (!res.mfa_required) this.setTokens(res);
        return res;
    }

    async refresh() {
        if (!this.refreshToken) throw new Error("No refresh token available");
        const res = await this._request("POST", "/refresh", {
            refresh_token: this.refreshToken,
        });
        this.setTokens(res);
        return res;
    }

    async logout() {
        if (!this.refreshToken) return;
        await this._request(
            "POST",
            "/logout",
            { refresh_token: this.refreshToken },
            true,
        );
        this.accessToken = null;
        this.refreshToken = null;
    }

    // ─── Passwordless ─────────────────────────────────────────────────────────

    async sendMagicLink(email) {
        return this._request("POST", "/magic-link", { email });
    }

    async verifyMagicLink(token) {
        const res = await this._request("POST", "/magic-link/verify", {
            token,
        });
        this.setTokens(res);
        return res;
    }

    async sendOtp(email) {
        return this._request("POST", "/otp/send", { email });
    }

    async verifyOtp(email, code) {
        const res = await this._request("POST", "/verify/otp", { email, code });
        this.setTokens(res);
        return res;
    }

    async resend(email, type) {
        return this._request("POST", "/resend", { email, type });
    }

    // ─── Email Verification ───────────────────────────────────────────────────

    async verifyEmail(token) {
        return this._request("POST", "/verify/email", { token });
    }

    // ─── Password ─────────────────────────────────────────────────────────────

    async forgotPassword(email) {
        return this._request("POST", "/password/forgot", { email });
    }

    async resetPassword(token, new_password) {
        return this._request("POST", "/password/reset", {
            token,
            new_password,
        });
    }

    // ─── User Profile ─────────────────────────────────────────────────────────

    async getMe() {
        return this._request("GET", "/user", null, true);
    }

    async updateMe({ displayName, avatarUrl, metadata } = {}) {
        return this._request(
            "PATCH",
            "/user",
            {
                display_name: displayName,
                avatar_url: avatarUrl,
                metadata,
            },
            true,
        );
    }

    async deleteMe(password) {
        return this._request("DELETE", "/user", { password }, true);
    }

    async changeEmail(new_email, password) {
        return this._request(
            "POST",
            "/user/email",
            { new_email, password },
            true,
        );
    }

    async confirmEmailChange(token) {
        return this._request("POST", "/user/email/confirm", { token }, true);
    }

    async updatePassword(current_password, new_password) {
        return this._request(
            "POST",
            "/user/password",
            { current_password, new_password },
            true,
        );
    }

    // ─── Sessions ─────────────────────────────────────────────────────────────

    async getSessions() {
        return this._request("GET", "/user/sessions", null, true);
    }

    async revokeSession(sessionId) {
        return this._request(
            "DELETE",
            `/user/sessions/${sessionId}`,
            null,
            true,
        );
    }

    async revokeAllSessions() {
        const res = await this._request("DELETE", "/user/sessions", null, true);
        this.accessToken = null;
        this.refreshToken = null;
        return res;
    }

    // ─── TOTP / 2FA ───────────────────────────────────────────────────────────

    async totpEnroll() {
        return this._request("POST", "/totp/enroll", null, true);
    }

    async totpConfirm(code) {
        const res = await this._request(
            "POST",
            "/totp/confirm",
            { code },
            true,
        );
        return res;
    }

    async totpVerify(mfa_token, code) {
        const res = await this._request("POST", "/totp/verify", {
            mfa_token,
            code,
        });
        this.setTokens(res);
        return res;
    }

    async totpDisable(code) {
        return this._request("POST", "/totp/disable", { code }, true);
    }

    async totpBackupVerify(mfa_token, code) {
        const res = await this._request("POST", "/totp/backup/verify", {
            mfa_token,
            code,
        });
        this.setTokens(res);
        return res;
    }

    async totpBackupRegenerate() {
        return this._request("GET", "/totp/backup/regenerate", null, true);
    }

    // ─── Anonymous Auth ───────────────────────────────────────────────────────

    async anonymousLogin() {
        const res = await this._request("POST", "/anonymous");
        this.setTokens(res);
        return res;
    }

    async upgradeAnonymous(email, password, { displayName, avatarUrl } = {}) {
        const res = await this._request(
            "POST",
            "/anonymous/upgrade",
            {
                email,
                password,
                display_name: displayName,
                avatar_url: avatarUrl,
            },
            true,
        );
        this.setTokens(res);
        return res;
    }
}
