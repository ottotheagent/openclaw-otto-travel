# openclaw-otto-travel

OpenClaw plugin for Otto Travel — search, compare, and book flights and hotels via Otto's MCP endpoint.

## Install

### 1. Install the plugin

```bash
openclaw plugins install ~/.openclaw/workspace/openclaw-otto-travel.tgz
```

### 2. Configure `~/.openclaw/openclaw.json`

Merge these keys into your existing config:

```json
{
  "plugins": {
    "allow": ["openclaw-otto-travel"]
  }
}
```

### 3. Allow plugin tools in sandbox

If sandbox is enabled (`agents.defaults.sandbox.mode` is `"all"` or `"non-main"`), plugin tools are blocked by default. Add this to your config:

```json
{
  "tools": {
    "sandbox": {
      "tools": {
        "allow": ["openclaw-otto-travel"]
      }
    }
  }
}
```

Skip this step if sandbox mode is `"off"`.

### 4. Restart the gateway

```bash
openclaw gateway restart
```

## Authorization

On first use, ask the agent to call `otto_setup`. It returns an authorization URL. Visit the URL, approve access, and all travel tools become available.

Alternatively, run `openclaw otto auth` from the terminal.

Tokens are stored at `~/.openclaw/.otto-tokens.json` and refresh automatically.

## Tools

Tools are discovered dynamically from the MCP server:

- `search_flights` — Search flights by route and date
- `query_flights` — Query search results with SQL
- `book_flight` — Book a flight
- `search_hotels` — Search hotels by location
- `get_hotel_rooms` — Get room options for a hotel
- `book_hotel` — Book a hotel room
- `get_bookings` — View your bookings
- `read_preferences` / `write_preference` — Manage travel preferences
- `read_loyalty_programs` / `write_loyalty_program` — Manage loyalty programs

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Plugin loaded but agent can't see tools | Add plugin to `tools.sandbox.tools.allow` (see step 3) |
| `otto_setup` missing | Add `"openclaw-otto-travel"` to `plugins.allow` |
| OAuth flow never completes | Check the agent's response for the auth URL and visit it |
| Tools gone after restart | Delete `~/.openclaw/.otto-tokens.json` and re-authorize |
