# openclaw-otto-travel

OpenClaw plugin for Otto Travel — search, compare, and book flights and hotels in natural language. Global inventory, live prices, loyalty tracking, PNR-backed bookings.

## Install

```bash
openclaw plugins install clawhub:@ottotheagent/openclaw-otto-travel
```

If your gateway has sandbox mode on (`agents.defaults.sandbox.mode` is `"all"` or `"non-main"`), allow-list the plugin's tools:

```json
{
  "tools": {
    "sandbox": {
      "tools": { "allow": ["openclaw-otto-travel"] }
    }
  }
}
```

Restart the gateway if it doesn't pick up the new plugin automatically:

```bash
openclaw gateway restart
```

## Authorize

Ask the agent to call `otto_setup`. It returns an authorization URL — visit it, approve access, and all travel tools become available in the same session.

Terminal equivalent:

```bash
openclaw otto auth
```

Tokens are stored at `~/.openclaw/.otto-tokens.json` and refresh automatically.

## Tools

- `search_flights`, `query_flights`, `book_flight` — flight search and booking
- `search_hotels`, `get_hotel_rooms`, `book_hotel` — hotel search and booking
- `get_bookings`, `cancel_booking` — manage existing bookings
- `read_preferences`, `write_preference` — travel preferences
- `read_loyalty_programs`, `write_loyalty_program` — frequent flyer & hotel loyalty
- `task_status` — poll long-running operations
- `read_skill` — load a usage guide the agent reads before calling other tools

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Plugin loaded but agent can't see tools | Allow-list under `tools.sandbox.tools.allow` (see Install) |
| OAuth flow never completes | Have the agent show the auth URL, or run `openclaw otto auth` |
| Tools stop working unexpectedly | Delete `~/.openclaw/.otto-tokens.json` and re-authorize |

## License

MIT
