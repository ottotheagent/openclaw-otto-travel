/**
 * OpenClaw plugin for Otto Travel.
 *
 * Two-phase startup:
 * - No tokens: registers otto_setup tool + CLI command for interactive auth
 * - Tokens exist: connects to MCP, discovers and registers all tools
 */

import { OttoAuth } from "./src/auth.js";
import { OttoMcpClient } from "./src/mcp-client.js";

const DEFAULT_SERVER_URL = "https://api.ottotheagent.com/mcp";

export default function register(api: any) {
  const config = (api.pluginConfig ?? {}) as { serverUrl?: string };
  const serverUrl = config.serverUrl?.trim() || DEFAULT_SERVER_URL;

  const auth = new OttoAuth(serverUrl, api.logger);
  const mcp = new OttoMcpClient(serverUrl, auth, api.logger);

  /** Connect to MCP and register all discovered tools. */
  async function connectAndRegisterTools() {
    api.logger.info(`[otto] Connecting to ${serverUrl}...`);
    await mcp.connect();

    const tools = await mcp.listTools();
    api.logger.info(`[otto] Discovered ${tools.length} tools`);

    for (const tool of tools) {
      api.registerTool({
        name: tool.name,
        description: tool.description ?? `Otto Travel tool: ${tool.name}`,
        parameters: tool.inputSchema ?? { type: "object", properties: {} },
        async execute(_id: string, params: unknown) {
          const result = await mcp.callTool(tool.name, params as Record<string, unknown>);
          const content = result.content as Array<{ text?: string; data?: string }> | undefined;
          const text = content?.map((c) => c.text ?? c.data ?? "").join("\n") ?? "";
          return {
            content: [{ type: "text", text }],
            isError: result.isError,
          };
        },
      });
    }

    api.logger.info(`[otto] Ready — ${tools.length} tools registered`);
  }

  /** Register the setup tool — always available, triggers device auth flow. */
  function registerSetupTool() {
    api.registerTool({
      name: "otto_setup",
      description:
        "Set up Otto Travel authorization. Call this once to connect your Otto account. " +
        "Returns a URL — ask the user to visit it and approve access. " +
        "After approval, Otto travel tools (flight search, hotel booking, etc.) become available.",
      parameters: { type: "object", properties: {} },
      async execute() {
        try {
          // Check if already authorized
          if (await auth.hasTokens()) {
            try {
              await connectAndRegisterTools();
              return {
                content: [{
                  type: "text",
                  text: "Otto Travel is already authorized and connected. All tools are now available.",
                }],
              };
            } catch {
              // Token might be invalid, fall through to re-auth
            }
          }

          // Initiate device auth — returns URL immediately (non-blocking)
          const info = await auth.initiateDeviceAuth();

          const message =
            `Otto Travel needs authorization.\n\n` +
            `**Please visit this URL to authorize:**\n` +
            `${info.verification_uri_complete}\n\n` +
            `Or go to ${info.verification_uri} and enter code: **${info.user_code}**\n\n` +
            `Waiting for approval (expires in ${Math.floor(info.expires_in / 60)} minutes)...`;

          // Start polling in background — don't block the tool response
          // so the agent can show the URL to the user immediately
          auth.pollForApproval(info).then(async () => {
            try {
              await connectAndRegisterTools();
            } catch (err) {
              api.logger.error("[otto] Connected but failed to register tools:", err);
            }
          }).catch((err: Error) => {
            api.logger.error("[otto] Authorization failed:", err.message);
          });

          return { content: [{ type: "text", text: message }] };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text", text: `Otto setup failed: ${msg}` }],
            isError: true,
          };
        }
      },
    });
  }

  /** Register CLI command: openclaw otto auth */
  function registerCli() {
    try {
      api.registerCli?.((cli: any) => {
        const ottoCmd = cli.command("otto").description("Otto Travel plugin commands");
        ottoCmd
          .command("auth")
          .description("Authorize Otto Travel (interactive device flow)")
          .action(async () => {
            console.log("[otto] Starting device authorization...\n");
            const info = await auth.initiateDeviceAuth();

            console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
            console.log("  Otto Travel — Device Authorization\n");
            console.log(`  Visit: ${info.verification_uri_complete}\n`);
            console.log(`  Or go to: ${info.verification_uri}`);
            console.log(`  Enter code: ${info.user_code}`);
            console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
            console.log("Waiting for approval...");

            await auth.pollForApproval(info);
            console.log("\n✓ Authorization complete. Tokens saved.");
            console.log("  Restart the gateway to activate Otto tools.");
          });

        ottoCmd
          .command("status")
          .description("Check Otto Travel authorization status")
          .action(async () => {
            const has = await auth.hasTokens();
            if (has) {
              console.log("✓ Otto Travel is authorized. Tokens found.");
            } else {
              console.log("✗ Not authorized. Run: openclaw otto auth");
            }
          });
      });
    } catch {
      // registerCli may not be available in all OpenClaw versions
    }
  }

  // --- Plugin startup ---

  api.registerService({
    id: "openclaw-otto-travel",

    async start() {
      const hasTokens = await auth.hasTokens();

      if (hasTokens) {
        // Phase 2: tokens exist — connect and register all tools
        try {
          await connectAndRegisterTools();
        } catch (err) {
          api.logger.error("[otto] Failed to connect with stored tokens:", err);
          api.logger.info("[otto] Registering otto_setup tool for re-authorization");
          registerSetupTool();
        }
      } else {
        // Phase 1: no tokens — register setup tool only
        api.logger.info("[otto] No authorization found. Use otto_setup tool or run: openclaw otto auth");
        registerSetupTool();
      }
    },

    async stop() {
      api.logger.info("[otto] Disconnecting...");
      await mcp.disconnect();
    },
  });

  registerCli();
  api.logger.info("[otto] Plugin registered");
}
