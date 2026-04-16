/*
 * Copyright 2026 Otto Trip, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * OpenClaw plugin for Otto Travel.
 *
 * All tools are pre-registered as stubs at register() time so they appear
 * in every session from the start. Before auth/connection, calling any
 * travel tool returns a message directing the user to call otto_setup.
 * After connection, calls proxy through to the MCP server.
 */

import { OttoAuth } from "./src/auth.js";
import { OttoMcpClient } from "./src/mcp-client.js";

const DEFAULT_SERVER_URL = "https://api.ottotheagent.com/mcp";
const TOOL_LABEL = "Otto Travel";

// Known MCP tools — pre-registered as stubs so sessions see them immediately.
// Descriptions are intentionally brief; the MCP server's read_skill tool
// provides full usage docs at runtime.
const KNOWN_TOOLS: Array<{ name: string; description: string; parameters: object }> = [
  { name: "read_skill", description: "Read a skill guide and get a key required by all other tools. Call this FIRST.", parameters: { type: "object", properties: { skill_name: { type: "string", description: "Skill to read (e.g. flight_search, hotel_search, booking_management)" } }, required: ["skill_name"] } },
  { name: "search_flights", description: "Search flights by origin, destination, and date. Returns an async task handle.", parameters: { type: "object", properties: { intent: { type: "object", description: "Structured intent from read_skill" }, origin: { type: "string", description: "Origin IATA code" }, destination: { type: "string", description: "Destination IATA code" }, departure_date: { type: "string", description: "YYYY-MM-DD" }, skill_keys: { type: "array", items: { type: "string" } }, cabin_class: { type: "string" }, return_date: { type: "string" }, booking_id: { type: "string" }, legs: { type: "string" }, outbound_flight_id: { type: "string" } }, required: ["intent", "origin", "destination", "departure_date", "skill_keys"] } },
  { name: "query_flights", description: "Query flight search results using SQL.", parameters: { type: "object", properties: { intent: { type: "object" }, handle: { type: "string", description: "Handle from search_flights" }, sql: { type: "string", description: "SQL query against flights/fare_options/segments/seats tables" }, skill_keys: { type: "array", items: { type: "string" } }, seat_map_flight_id: { type: "string" }, outbound_flight_id: { type: "string" } }, required: ["intent", "handle", "sql", "skill_keys"] } },
  { name: "book_flight", description: "Book a flight by flight_id.", parameters: { type: "object", properties: { intent: { type: "object" }, flight_id: { type: "string" }, skill_keys: { type: "array", items: { type: "string" } }, seats: { type: "object" }, booking_id: { type: "string" } }, required: ["intent", "flight_id", "skill_keys"] } },
  { name: "search_hotels", description: "Search hotels by location and dates.", parameters: { type: "object", properties: { intent: { type: "object" }, check_in: { type: "string" }, check_out: { type: "string" }, skill_keys: { type: "array", items: { type: "string" } }, latitude: { type: "number" }, longitude: { type: "number" }, guests: { type: "integer" }, radius_km: { type: "number" }, booking_id: { type: "string" } }, required: ["intent", "check_in", "check_out", "skill_keys"] } },
  { name: "get_hotel_rooms", description: "Get room options for specific hotels.", parameters: { type: "object", properties: { intent: { type: "object" }, hotel_ids: { type: "array", items: { type: "string" } }, skill_keys: { type: "array", items: { type: "string" } } }, required: ["intent", "hotel_ids", "skill_keys"] } },
  { name: "book_hotel", description: "Book a hotel room by room_id.", parameters: { type: "object", properties: { intent: { type: "object" }, room_id: { type: "string" }, skill_keys: { type: "array", items: { type: "string" } }, booking_id: { type: "string" } }, required: ["intent", "room_id", "skill_keys"] } },
  { name: "get_bookings", description: "Retrieve user's flight and hotel bookings.", parameters: { type: "object", properties: { intent: { type: "object" }, skill_keys: { type: "array", items: { type: "string" } }, booking_type: { type: "string" }, status: { type: "string" }, pnr_id: { type: "string" } }, required: ["intent", "skill_keys"] } },
  { name: "cancel_booking", description: "Cancel a booking. Two-step: preview then confirm.", parameters: { type: "object", properties: { booking_id: { type: "string" }, skill_keys: { type: "array", items: { type: "string" } }, confirmed: { type: "boolean" }, cancel_option: { type: "integer" } }, required: ["booking_id", "skill_keys"] } },
  { name: "task_status", description: "Poll an async task for progress/completion.", parameters: { type: "object", properties: { task_id: { type: "string" }, skill_keys: { type: "array", items: { type: "string" } }, timeout_ms: { type: "integer" } }, required: ["task_id", "skill_keys"] } },
  { name: "read_preferences", description: "Read stored travel preferences.", parameters: { type: "object", properties: { skill_keys: { type: "array", items: { type: "string" } } }, required: ["skill_keys"] } },
  { name: "write_preference", description: "Add, remove, or update travel preferences.", parameters: { type: "object", properties: { skill_keys: { type: "array", items: { type: "string" } }, add: { type: "array", items: { type: "string" } }, remove: { type: "array", items: { type: "string" } }, update: { type: "array", items: { type: "string" } } }, required: ["skill_keys"] } },
  { name: "read_loyalty_programs", description: "Read frequent flyer and hotel loyalty numbers.", parameters: { type: "object", properties: { skill_keys: { type: "array", items: { type: "string" } } }, required: ["skill_keys"] } },
  { name: "write_loyalty_program", description: "Add or remove a loyalty program number.", parameters: { type: "object", properties: { skill_keys: { type: "array", items: { type: "string" } }, type: { type: "string", description: "'flight' or 'hotel'" }, code: { type: "string", description: "IATA airline code or hotel chain code" }, number: { type: "string" } }, required: ["skill_keys", "type", "code"] } },
];

export default {
  id: "openclaw-otto-travel",
  name: "Otto Travel",
  description: "Search, compare, and book flights and hotels via Otto's MCP endpoint with OAuth authentication.",

  register(api: any) {
    const config = (api.pluginConfig ?? {}) as { serverUrl?: string };
    const serverUrl = config.serverUrl?.trim() || DEFAULT_SERVER_URL;

    const auth = new OttoAuth(serverUrl, api.logger);
    const mcp = new OttoMcpClient(serverUrl, auth, api.logger);
    let connected = false;

    // Track in-flight device flow so repeated otto_setup calls don't
    // start a new one while a poll is already running.
    let pendingUserCode: string | null = null;

    async function ensureConnected(): Promise<void> {
      if (connected) return;
      api.logger.info(`[otto] Connecting to ${serverUrl}...`);
      await mcp.connect();
      connected = true;
      api.logger.info("[otto] Connected to MCP server");
    }

    // --- Pre-register all travel tools as stubs ---
    for (const tool of KNOWN_TOOLS) {
      const toolName = tool.name;
      api.registerTool(
        () => ({
          name: toolName,
          label: TOOL_LABEL,
          description: tool.description,
          parameters: tool.parameters,
          async execute(_id: string, params: unknown) {
            // Not authorized yet — tell the agent to call otto_setup
            if (!(await auth.hasTokens())) {
              return {
                content: [{ type: "text", text: "Otto Travel is not authorized. Call the otto_setup tool first to connect your account." }],
                details: {},
              };
            }

            // Connect on first use
            try {
              await ensureConnected();
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              return {
                content: [{ type: "text", text: `Otto Travel connection failed: ${msg}. Try calling otto_setup to re-authorize.` }],
                details: {},
              };
            }

            // Proxy to MCP
            const result = await mcp.callTool(toolName, params as Record<string, unknown>);
            const content = result.content as Array<{ text?: string; data?: string }> | undefined;
            const text = content?.map((c) => c.text ?? c.data ?? "").join("\n") ?? "";
            return { content: [{ type: "text", text }], details: {} };
          },
        }),
        { names: [toolName] },
      );
    }

    // --- otto_setup: registered in register() so agent always sees it ---
    api.registerTool(
      () => ({
        name: "otto_setup",
        label: TOOL_LABEL,
        description:
          "Set up Otto Travel authorization. Call this to connect your Otto account. " +
          "Returns a URL — ask the user to visit it and approve access. " +
          "After approval, all travel tools work immediately in this session.",
        parameters: { type: "object", properties: {} },
        async execute() {
          try {
            // Already authorized — just connect
            if (await auth.hasTokens()) {
              await ensureConnected();
              pendingUserCode = null;
              return {
                content: [{ type: "text", text: "Otto Travel is authorized and connected. All travel tools are ready to use." }],
                details: {},
              };
            }

            // A device flow is already in progress — don't start a new one.
            if (pendingUserCode) {
              return {
                content: [{
                  type: "text",
                  text: `Authorization already in progress for code **${pendingUserCode}**. ` +
                    "Ask the user to approve that code on the Otto website. " +
                    "Once approved, call otto_setup again to complete connection.",
                }],
                details: {},
              };
            }

            const info = await auth.initiateDeviceAuth();
            pendingUserCode = info.user_code;

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

            // Poll in background — when approval completes, tokens are saved
            // and the next tool call will connect automatically.
            auth
              .pollForApproval(info)
              .then(async () => {
                try {
                  await ensureConnected();
                } catch {
                  // Connection will be retried on next tool call
                }
              })
              .catch((err: unknown) => {
                const msg = err instanceof Error ? err.message : String(err);
                api.logger.error(`[otto] Authorization failed: ${msg}`);
              })
              .finally(() => {
                pendingUserCode = null;
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
            await ensureConnected();
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
        connected = false;
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
