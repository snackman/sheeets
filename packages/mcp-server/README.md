# @sheeets/mcp

MCP (Model Context Protocol) server for **sheeets** -- a crypto event discovery platform. This package lets AI assistants search events, manage itineraries, check which friends are going, RSVP, and get personalized recommendations.

## Installation

```bash
npx @sheeets/mcp
```

Or install globally:

```bash
npm install -g @sheeets/mcp
sheeets-mcp
```

## Configuration

### Claude Code

Add to your `.claude.json` or project settings:

```json
{
  "mcpServers": {
    "sheeets": {
      "command": "npx",
      "args": ["@sheeets/mcp"],
      "env": {
        "SHEEETS_API_KEY": "$SHEEETS_API_KEY"
      }
    }
  }
}
```

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sheeets": {
      "command": "npx",
      "args": ["@sheeets/mcp"],
      "env": {
        "SHEEETS_API_KEY": "shts_your_key_here"
      }
    }
  }
}
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SHEEETS_API_KEY` | For authenticated endpoints | Your sheeets API key (format: `shts_...`). Generate one at sheeets.xyz/settings. |
| `SHEEETS_API_URL` | No | Override the API base URL (for development). |

## Available Tools

### Public (no API key needed)

| Tool | Description |
|------|-------------|
| `search_events` | Search/filter events by conference, date, tags, text, free, or happening now |
| `get_event` | Get full details for a specific event by ID |
| `list_conferences` | List all conferences with event counts |
| `list_tags` | List all event tags with counts (sorted by popularity) |
| `list_dates` | List all event dates with counts |

### Authenticated (API key required)

| Tool | Description |
|------|-------------|
| `get_itinerary` | Get the user's saved event itinerary |
| `add_to_itinerary` | Add events to the user's itinerary |
| `remove_from_itinerary` | Remove events from the user's itinerary |
| `get_friends` | List the user's friends |
| `friends_going` | See which friends are attending events |
| `list_rsvps` | List the user's RSVPs |
| `rsvp_event` | RSVP to an event |
| `get_recommendations` | Get personalized event recommendations |

## Example Usage

Once connected, you can ask your AI assistant things like:

- "What crypto events are happening today in Denver?"
- "Find free networking events at ETH Denver"
- "Add the DeFi summit to my itinerary"
- "Which of my friends are going to the hackathon?"
- "RSVP me to the Supabase meetup"
- "What events do you recommend for me?"

## Security

- **Never hardcode API keys** in config files checked into source control.
- Use environment variable references (`$SHEEETS_API_KEY`) where supported.
- API keys are scoped to your user account and can be revoked at any time.
- Add `shts_*` to your `.gitignore` to prevent accidental key commits.

## Development

```bash
cd packages/mcp-server
npm install
npm run build
npm start
```

## License

MIT
