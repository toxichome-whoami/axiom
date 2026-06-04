import { AxiomClient } from "./client";

export class RealtimeAPI {
    private ws?: WebSocket;
    private listeners: Map<string, Function[]> = new Map();

    constructor(private client: AxiomClient) {}

    public connect() {
        const wsUrl = this.client.url.replace(/^http/, "ws") + "/api/v1/ws";
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            if (this.client.userToken) {
                this.ws?.send(
                    JSON.stringify({
                        type: "auth",
                        token: this.client.userToken,
                    }),
                );
            } else if (this.client.apiKey) {
                this.ws?.send(
                    JSON.stringify({ type: "auth", token: this.client.apiKey }),
                );
            }
        };

        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === "message" && data.topic) {
                const cbs = this.listeners.get(data.topic) || [];
                cbs.forEach((cb) => cb(data.payload));
            }
        };
    }

    public subscribe(topic: string, callback: (payload: any) => void) {
        if (!this.listeners.has(topic)) {
            this.listeners.set(topic, []);
        }
        this.listeners.get(topic)!.push(callback);

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(
                JSON.stringify({
                    type: "subscribe",
                    topic,
                    request_id: Math.random().toString(),
                }),
            );
        }
    }

    public unsubscribe(topic: string) {
        this.listeners.delete(topic);
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: "unsubscribe", topic }));
        }
    }

    public disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = undefined;
        }
    }
}
