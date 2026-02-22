# Discord MCP Server

A Model Context Protocol (MCP) server that provides full Discord server administration through Claude Code. Built with Discord.js v14 and the MCP SDK, it exposes 73 tools covering every aspect of server management — from sending messages and managing roles to configuring auto-moderation rules and scheduled events.

## Setup

### Requirements

- Node.js 18+
- A Discord bot token with appropriate permissions
- The bot must be invited to the target server with the necessary OAuth2 scopes (`bot`, `applications.commands`)

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_TOKEN` | Yes | Your Discord bot token (also accepts `BOT_TOKEN` as fallback) |
| `DISCORD_GUILD_ID` | Yes | The ID of the Discord server to manage |

These are loaded from a `.env` file via `dotenv`.

### Running

```bash
# Build
npm run build

# Start standalone
npm run mcp:start
# or
node dist/mcp-server.js
```

### Claude Code Integration

The server is configured in `.mcp.json`:

```json
{
  "mcpServers": {
    "discord-server": {
      "command": "node",
      "args": ["dist/mcp-server.js"],
      "cwd": "/path/to/QuadsLabBot"
    }
  }
}
```

Reconnect with `/mcp` in Claude Code after any changes.

---

## Architecture

```
src/mcp/
  mcp-server.ts          # Entry point — validates env, initializes client, starts server
  index.ts               # MCP server setup — registers tools, resources, and request handlers
  discord-client.ts      # Discord.js client — intents, caching, connection management
  tools/
    index.ts             # Tool registry — routes tool calls to category handlers
    utils.ts             # Fuzzy matching — smart name resolution for channels, roles, members
    guild.ts             # Server info tools (2)
    roles.ts             # Role management tools (8)
    channels.ts          # Channel management tools (12)
    members.ts           # Member management tools (9)
    messages.ts          # Messaging tools (10)
    reactions.ts         # Reaction tools (1)
    server.ts            # Server admin tools (6)
    threads.ts           # Thread management tools (7)
    emojis.ts            # Emoji & sticker tools (7)
    webhooks.ts          # Webhook tools (4)
    events.ts            # Scheduled event tools (4)
    automod.ts           # Auto-moderation tools (4)
```

### Key Design Features

- **Fuzzy matching**: All channel, role, and member parameters are fuzzy-matched. You can type `"bot testing"`, `"bot-testing"`, or `"bottesting"` and it resolves correctly. Exact ID matches are also supported.
- **Server cache**: On startup, the server pre-caches all channels, roles, and members for instant fuzzy lookups without API calls.
- **Consistent JSON responses**: Every tool returns structured, pretty-printed JSON.
- **Audit log integration**: All modifying operations accept a `reason` parameter that appears in the Discord audit log.
- **Error recovery**: Failed lookups return helpful suggestions (e.g., "Did you mean: #general, #bot-testing?").

### Gateway Intents

The bot connects with these intents:

- `Guilds` — server structure (channels, roles)
- `GuildMembers` — member data and events
- `GuildMessages` — message content and events
- `GuildModeration` — ban and kick events
- `MessageContent` — read message text
- `GuildMessageReactions` — reaction data
- `GuildScheduledEvents` — scheduled event management
- `AutoModerationConfiguration` — automod rule management
- `GuildWebhooks` — webhook events
- `GuildInvites` — invite tracking

### MCP Resources

Three read-only resources are available:

| URI | Description |
|-----|-------------|
| `discord://server/summary` | Text overview of the server (channels, roles, members) |
| `discord://server/channels` | JSON list of all channels organized by category |
| `discord://server/roles` | JSON list of all roles sorted by position |

---

## Tools Reference

### Guild (2 tools)

| Tool | Description |
|------|-------------|
| `list_guilds` | List all servers the bot is a member of |
| `get_guild_info` | Detailed server info — member count, channels, roles, features, boost tier |

### Roles (8 tools)

| Tool | Description |
|------|-------------|
| `list_roles` | List all roles sorted by position with colors and member counts |
| `create_role` | Create a new role with name, color, hoist, and mentionable options |
| `delete_role` | Delete a role (with managed role protection) |
| `modify_role` | Change a role's name, color, hoist, mentionable, or position |
| `get_role_permissions` | View all permissions granted to a role |
| `modify_role_permissions` | Grant or revoke specific permissions on a role |
| `assign_role` | Add a role to a member |
| `remove_role` | Remove a role from a member |

### Channels (12 tools)

| Tool | Description |
|------|-------------|
| `list_channels` | List all channels organized by category |
| `create_text_channel` | Create a new text channel, optionally in a category |
| `create_voice_channel` | Create a new voice channel with bitrate and user limit |
| `create_category` | Create a new channel category |
| `delete_channel` | Delete any channel type |
| `modify_channel` | Change name, topic, category, NSFW, position, user limit |
| `set_channel_permissions` | Set permission overwrites for a role or user on a channel |
| `view_channel_permissions` | View all permission overwrites on a channel |
| `lock_channel` | Deny SendMessages for @everyone (quick lock) |
| `unlock_channel` | Remove SendMessages deny for @everyone |
| `set_slowmode` | Set rate limit (0-21600 seconds) on a text channel |
| `clone_channel` | Duplicate a channel with all permissions and settings |

### Members (9 tools)

| Tool | Description |
|------|-------------|
| `list_members` | List members with optional role and search filters |
| `get_member` | Detailed member info — roles, join date, account age, permissions |
| `kick_member` | Kick a member from the server |
| `ban_member` | Ban a member with optional message deletion (0-7 days) |
| `unban_member` | Remove a ban by username or user ID |
| `timeout_member` | Apply a timeout (10m, 1h, 1d, 1w) or remove one |
| `set_nickname` | Change a member's nickname or reset it |
| `move_to_voice` | Move a member to a different voice channel |
| `disconnect_from_voice` | Disconnect a member from their voice channel |

### Messages (10 tools)

| Tool | Description |
|------|-------------|
| `get_messages` | Fetch recent messages from a text or voice channel |
| `send_message` | Send a text message, optionally as a reply |
| `send_embed` | Send a rich embed with title, fields, images, and footer |
| `delete_message` | Delete a single message by ID |
| `bulk_delete_messages` | Delete 2-100 messages at once (< 14 days old), optionally filtered by user |
| `pin_message` | Pin a message |
| `unpin_message` | Unpin a message |
| `list_pinned_messages` | Get all pinned messages in a channel |
| `add_reaction` | Add a reaction from the bot to a message |
| `remove_reaction` | Remove the bot's reaction from a message |

### Reactions (1 tool)

| Tool | Description |
|------|-------------|
| `get_reactions` | Get all reactions on a message with full reactor details — account creation date, server join date, roles, avatar, boost status. Optionally filter by emoji. |

### Server Admin (6 tools)

| Tool | Description |
|------|-------------|
| `edit_server` | Modify server name, description, verification level, notification defaults |
| `list_invites` | List all active invite links with usage stats and expiration |
| `create_invite` | Generate a new invite with configurable max age, uses, and temporary flag |
| `delete_invite` | Revoke an invite by code |
| `get_audit_log` | Fetch audit log entries, optionally filtered by action type or user |
| `list_bans` | View all banned users with reasons |

### Threads (7 tools)

| Tool | Description |
|------|-------------|
| `list_threads` | List active threads, optionally filtered to a channel |
| `create_thread` | Start a thread from a message or as a standalone public thread |
| `archive_thread` | Archive a thread |
| `unarchive_thread` | Unarchive a thread |
| `delete_thread` | Delete a thread |
| `lock_thread` | Lock a thread (prevent new messages without archiving) |
| `unlock_thread` | Unlock a thread |

### Emojis & Stickers (7 tools)

| Tool | Description |
|------|-------------|
| `list_emojis` | List all custom emojis with names, IDs, animated status, and URLs |
| `create_emoji` | Upload a new custom emoji from a URL |
| `delete_emoji` | Remove a custom emoji by name or ID |
| `rename_emoji` | Rename a custom emoji |
| `list_stickers` | List all custom stickers with descriptions and format info |
| `create_sticker` | Upload a new custom sticker from a URL |
| `delete_sticker` | Remove a custom sticker by name or ID |

### Webhooks (4 tools)

| Tool | Description |
|------|-------------|
| `list_webhooks` | List all webhooks, optionally filtered to a channel |
| `create_webhook` | Create a webhook on a channel with name and optional avatar |
| `delete_webhook` | Delete a webhook by ID |
| `send_webhook_message` | Send a message via webhook with optional name/avatar override |

### Scheduled Events (4 tools)

| Tool | Description |
|------|-------------|
| `list_events` | List all scheduled events with times, status, type, and attendee count |
| `create_event` | Create a voice, stage, or external event with start/end times |
| `edit_event` | Modify an event's name, description, times, or status |
| `delete_event` | Delete a scheduled event |

### Auto-Moderation (4 tools)

| Tool | Description |
|------|-------------|
| `list_automod_rules` | List all automod rules with triggers, actions, and exemptions |
| `create_automod_rule` | Create a rule — keyword filter, spam detection, keyword presets, or mention spam |
| `edit_automod_rule` | Modify a rule's keywords, actions, exemptions, or enabled state |
| `delete_automod_rule` | Delete an automod rule |

---

## Fuzzy Matching

All tools that accept channel, role, or member names use smart fuzzy matching. The resolution order is:

1. **Exact ID match** — pass a Discord snowflake ID directly
2. **Exact name match** — case-insensitive
3. **Normalized match** — ignores hyphens, spaces, and underscores (`"bot testing"` matches `"bot-testing"`)
4. **Substring match** — partial name matches at 0.7+ similarity threshold

Mention formats are also handled automatically:
- Channels: `#name` or `<#id>`
- Roles: `@name` or `<@&id>`
- Members: `@name` or `<@id>` or `<@!id>`

If no match is found, the error message includes suggestions of similar names.

---

## Permissions

The Discord bot needs the following permissions in the server for full functionality:

- **General**: Manage Server, Manage Roles, Manage Channels, View Audit Log, Manage Webhooks, Manage Events, Manage Emojis and Stickers
- **Text**: Send Messages, Manage Messages, Read Message History, Add Reactions, Use External Emojis
- **Voice**: Move Members, Disconnect Members
- **Moderation**: Kick Members, Ban Members, Moderate Members, Manage Auto Moderation

The bot can only act within its role hierarchy — it cannot manage roles higher than its own.
