/**
 * OpenClaw plugin for Otto Travel.
 *
 * Two-phase startup:
 * - No tokens: otto_setup tool registered for interactive auth
 * - Tokens exist: connects to MCP, discovers and registers all tools
 *
 * Tools are registered in register() (synchronous collection phase).
 * MCP connection + discovery happens in service.start() (async phase).
 */

import { OttoAuth } from "./src/auth.js";
import { OttoMcpClient } from "./src/mcp-client.js";

const DEFAULT_SERVER_URL = "https://api.ottotheagent.com/mcp";
const TOOL_LABEL = "Otto Travel";

export default {
  id: "openclaw-otto-travel",
  name: "Otto Travel",
  description: "Search, compare, and book flights and hotels via Otto's MCP endpoint with OAuth authentication.",

  register(api: any) {
    const config = (api.pluginConfig ?? {}) as { serverUrl?: string };
    const serverUrl = config.serverUrl?.trim() || DEFAULT_SERVER_URL;

    const auth = new OttoAuth(serverUrl, api.logger);
    const mcp = new OttoMcpClient(serverUrl, auth, api.logger);
    let toolsRegistered = false;

    async function connectAndRegisterTools(): Promise<void> {
      if (toolsRegistered) return;

      api.logger.info(`[otto] Connecting to ${serverUrl}...`);
      await mcp.connect();

      const tools = await mcp.listTools();
      api.logger.info(`[otto] Discovered ${tools.length} tools`);

      for (const tool of tools) {
        api.registerTool(
          () => ({
            name: tool.name,
            label: TOOL_LABEL,
            description: tool.description ?? `Otto Travel tool: ${tool.name}`,
            parameters: tool.inputSchema ?? { type: "object", properties: {} },
            async execute(_id: string, params: unknown) {
              const result = await mcp.callTool(tool.name, params as Record<string, unknown>);
              const content = result.content as Array<{ text?: string; data?: string }> | undefined;
              const text = content?.map((c) => c.text ?? c.data ?? "").join("\n") ?? "";
              return { content: [{ type: "text", text }], details: {} };
            },
          }),
          { names: [tool.name] },
        );
      }

      toolsRegistered = true;
      api.logger.info(`[otto] Ready — ${tools.length} tools registered`);
    }

    // --- otto_setup: registered in register() so agent always sees it ---
    api.registerTool(
      () => ({
        name: "otto_setup",
        label: TOOL_LABEL,
        description:
          "Set up Otto Travel authorization. Call this to connect your Otto account. " +
          "Returns a URL — ask the user to visit it and approve access. " +
          "After approval, travel tools (flight search, hotel booking, etc.) become available.",
        parameters: { type: "object", properties: {} },
        async execute() {
          try {
            // Already authorized — just connect
            if (await auth.hasTokens()) {
              try {
                await connectAndRegisterTools();
                return {
                  content: [{ type: "text", text: "Otto Travel is already authorized. All tools are now available." }],
                  details: {},
                };
              } catch {
                // Stored tokens invalid, fall through to re-auth
              }
            }

            const info = await auth.initiateDeviceAuth();

            const message = [
              "Otto Travel needs authorization.",
              "",
              "**Please visit this URL to approve:**",
              info.verification_uri_complete,
              "",
              `Or go to ${info.verification_uri} and enter code: **${info.user_code}**`,
              "",
              `Waiting for approval (expires in ${Math.floor(info.expires_in / 60)} minutes)...`,
            ].join("\n");

            // Poll in background so the URL is shown to the user immediately.
            // connectAndRegisterTools runs after approval succeeds.
            auth
              .pollForApproval(info)
              .then(() => connectAndRegisterTools())
              .catch((err: unknown) => {
                const msg = err instanceof Error ? err.message : String(err);
                api.logger.error(`[otto] Authorization failed: ${msg}`);
              });

            return { content: [{ type: "text", text: message }], details: {} };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              content: [{ type: "text", text: `Otto setup failed: ${msg}` }],
              details: {},
            };
          }
        },
      }),
      { names: ["otto_setup"] },
    );

    // --- Service lifecycle ---
    api.registerService({
      id: "openclaw-otto-travel",

      async start() {
        if (await auth.hasTokens()) {
          try {
            await connectAndRegisterTools();
          } catch (err) {
            api.logger.error("[otto] Failed to connect with stored tokens:", err);
            api.logger.info("[otto] Use otto_setup tool to re-authorize");
          }
        } else {
          api.logger.info("[otto] No authorization found. Use otto_setup tool or: openclaw otto auth");
        }
      },

      async stop() {
        api.logger.info("[otto] Disconnecting...");
        await mcp.disconnect();
      },
    });

    // --- CLI: openclaw otto auth / status ---
    try {
      api.registerCli?.(({ program }: { program: any }) => {
        const otto = program.command("otto").description("Otto Travel plugin commands");

        otto
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

        otto
          .command("status")
          .description("Check Otto Travel authorization status")
          .action(async () => {
            if (await auth.hasTokens()) {
              console.log("✓ Otto Travel is authorized. Tokens found.");
            } else {
              console.log("✗ Not authorized. Run: openclaw otto auth");
            }
          });
      });
    } catch {
      // registerCli not available in all OpenClaw versions
    }

    api.logger.info("[otto] Plugin registered");
  },
};
