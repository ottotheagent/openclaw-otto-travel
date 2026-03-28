/**
 * MCP client that connects to Otto's /mcp endpoint via Streamable HTTP.
 * Injects OAuth Bearer token from OttoAuth into every request.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { OttoAuth } from "./auth.js";
import type { Logger } from "./types.js";

const CLIENT_NAME = "openclaw-otto-travel";
const CLIENT_VERSION = "0.1.0";

export class OttoMcpClient {
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;

  constructor(
    private serverUrl: string,
    private auth: OttoAuth,
    private logger: Logger,
  ) {}

  async connect(): Promise<void> {
    const token = await this.auth.getAccessToken();

    this.transport = new StreamableHTTPClientTransport(new URL(this.serverUrl), {
      requestInit: {
        headers: { Authorization: `Bearer ${token}` },
      },
    });

    this.client = new Client({ name: CLIENT_NAME, version: CLIENT_VERSION });
    await this.client.connect(this.transport);
    this.logger.info("[otto] Connected to MCP server");
  }

  async listTools() {
    if (!this.client) throw new Error("[otto] Not connected");
    const result = await this.client.listTools();
    return result.tools;
  }

  async callTool(name: string, args: Record<string, unknown>) {
    if (!this.client) throw new Error("[otto] Not connected");

    try {
      return await this.client.callTool({ name, arguments: args });
    } catch (err) {
      if (this.isAuthError(err)) {
        this.logger.info("[otto] Token expired, reconnecting...");
        await this.reconnect();
        return await this.client!.callTool({ name, arguments: args });
      }
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.transport?.close();
    } catch {
      // Ignore close errors during teardown
    }
    this.client = null;
    this.transport = null;
  }

  private async reconnect(): Promise<void> {
    await this.disconnect();
    await this.connect();
  }

  private isAuthError(err: unknown): boolean {
    const msg = String(err);
    // Match HTTP 401 status or explicit "Unauthorized" — avoid false positives
    // from generic "token" substring in unrelated errors
    return msg.includes("401") || msg.includes("Unauthorized");
  }
}
