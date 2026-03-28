/**
 * RFC 8628 Device Authorization Grant + token refresh.
 *
 * Two modes:
 * - Interactive: initiateDeviceAuth() returns URL → pollForApproval() blocks until approved
 * - Background: getAccessToken() uses stored tokens or refresh, never starts device flow
 */

import { type StoredTokens, isExpired, loadTokens, saveTokens } from "./token-store.js";

const DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

export interface DeviceAuthInfo {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
  client_id: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
}

interface Logger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export class OttoAuth {
  private tokens: StoredTokens | null = null;
  private refreshing: Promise<string> | null = null;

  constructor(
    private serverUrl: string,
    private logger: Logger,
  ) {}

  private get baseUrl(): string {
    return this.serverUrl.replace(/\/mcp\/?$/, "");
  }

  /** Check if valid tokens exist (on disk or in memory). */
  async hasTokens(): Promise<boolean> {
    if (!this.tokens) {
      this.tokens = await loadTokens(this.serverUrl);
    }
    if (!this.tokens) return false;
    // If expired but we have a refresh token, we can still recover
    if (isExpired(this.tokens) && !this.tokens.refresh_token) return false;
    return true;
  }

  /**
   * Get a valid access token. Uses stored tokens or refresh.
   * Throws if no tokens exist — caller should use hasTokens() first
   * and run the setup flow if needed.
   */
  async getAccessToken(): Promise<string> {
    if (!this.tokens) {
      this.tokens = await loadTokens(this.serverUrl);
    }

    if (this.tokens && !isExpired(this.tokens)) {
      return this.tokens.access_token;
    }

    if (this.tokens?.refresh_token) {
      return this.refresh();
    }

    throw new Error("[otto] No tokens available. Run otto_setup first.");
  }

  /** Step 1 of device auth: register client + request code. Returns info for display. */
  async initiateDeviceAuth(): Promise<DeviceAuthInfo> {
    const clientId = await this.registerClient();
    const device = await this.requestDeviceCode(clientId);
    return { ...device, client_id: clientId };
  }

  /** Step 2 of device auth: poll until user approves. Blocks. */
  async pollForApproval(info: DeviceAuthInfo): Promise<void> {
    const tokenData = await this.pollForToken(info);
    await this.persistTokens(tokenData, info.client_id);
    this.logger.info("[otto] Authorization complete, tokens saved");
  }

  /** Refresh using stored refresh_token. Deduplicates concurrent calls. */
  private async refresh(): Promise<string> {
    if (this.refreshing) return this.refreshing;

    this.refreshing = (async () => {
      try {
        const params = new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: this.tokens!.refresh_token,
          client_id: this.tokens!.client_id,
        });

        const res = await fetch(`${this.baseUrl}/oauth/token`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        });

        if (!res.ok) {
          this.logger.warn("[otto] Refresh failed — tokens cleared, run otto_setup again");
          this.tokens = null;
          throw new Error("[otto] Token refresh failed. Run otto_setup to re-authorize.");
        }

        const data: TokenResponse = await res.json();
        await this.persistTokens(data, this.tokens!.client_id);
        return data.access_token;
      } finally {
        this.refreshing = null;
      }
    })();

    return this.refreshing;
  }

  private async registerClient(): Promise<string> {
    const res = await fetch(`${this.baseUrl}/oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "openclaw-otto-travel",
        redirect_uris: ["http://localhost"],
        grant_types: [DEVICE_CODE_GRANT],
      }),
    });

    if (!res.ok) {
      throw new Error(`[otto] Client registration failed: ${res.status}`);
    }

    const data = await res.json();
    return data.client_id;
  }

  private async requestDeviceCode(clientId: string): Promise<Omit<DeviceAuthInfo, "client_id">> {
    const params = new URLSearchParams({ client_id: clientId });
    const res = await fetch(`${this.baseUrl}/oauth/device_authorization`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!res.ok) {
      throw new Error(`[otto] Device authorization request failed: ${res.status}`);
    }

    return res.json();
  }

  private async pollForToken(info: DeviceAuthInfo): Promise<TokenResponse> {
    const deadline = Date.now() + info.expires_in * 1000;
    let interval = info.interval * 1000;

    while (Date.now() < deadline) {
      await sleep(interval);

      const params = new URLSearchParams({
        grant_type: DEVICE_CODE_GRANT,
        device_code: info.device_code,
        client_id: info.client_id,
      });

      const res = await fetch(`${this.baseUrl}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });

      if (res.ok) {
        return res.json();
      }

      const body = await res.json();
      switch (body.error) {
        case "authorization_pending":
          continue;
        case "slow_down":
          interval += 5000;
          continue;
        case "access_denied":
          throw new Error("[otto] User denied authorization");
        case "expired_token":
          throw new Error("[otto] Device code expired — please try again");
        default:
          throw new Error(`[otto] Token exchange failed: ${body.error}`);
      }
    }

    throw new Error("[otto] Device code expired — user did not authorize in time");
  }

  private async persistTokens(data: TokenResponse, clientId: string): Promise<void> {
    this.tokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
      scope: data.scope,
      client_id: clientId,
      server_url: this.serverUrl,
    };
    await saveTokens(this.tokens);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
