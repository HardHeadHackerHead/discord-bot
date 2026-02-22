# @quadslab.io/discord-bot

[![npm version](https://img.shields.io/npm/v/@quadslab.io/discord-bot)](https://www.npmjs.com/package/@quadslab.io/discord-bot)
[![CI](https://github.com/HardHeadHackerHead/discord-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/HardHeadHackerHead/discord-bot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A modular Discord bot framework built with TypeScript and Discord.js. Features a plugin architecture with dynamic module loading, runtime database migrations, AI integration, and an inter-module event bus. Build new features as self-contained modules without touching the core.

## Install

```bash
npm install @quadslab.io/discord-bot
```

## Features

- **Drop-In Module System** — Auto-discovered modules with their own commands, events, services, database migrations, settings, and leaderboards
- **Slash Command Framework** — Declarative command builder with permission guards, subcommands, autocomplete, and context menus
- **Inter-Module Event Bus** — Loosely coupled communication between modules (e.g., voice tracking emits session events that the points module listens to)
- **Per-Module Database Migrations** — Each module manages its own SQL migrations that run automatically on load
- **Centralized Settings** — Modules register configurable settings that server admins manage through `/settings`
- **Leaderboard Registry** — Any module can register leaderboard providers, all accessible through a unified `/leaderboard` command
- **Cron Scheduler** — Built-in scheduled task runner with per-module job registration
- **AI Provider Abstraction** — Pluggable AI backends (Claude, OpenAI) for modules that need AI features
- **Docker Ready** — Multi-stage Docker build with MySQL service, health checks, and compose orchestration

## Quick Start

### Prerequisites

- **Node.js 18+** — [Download](https://nodejs.org/)
- **MySQL 8.0+** — [Download](https://dev.mysql.com/downloads/) or use Docker (see below)
- **Discord Bot Token** — Create an application at the [Discord Developer Portal](https://discord.com/developers/applications)

### Step 1: Create a Discord Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application**, give it a name
3. Go to **Bot** in the sidebar, click **Reset Token**, and copy your bot token
4. On the same page, enable these **Privileged Gateway Intents**:
   - Presence Intent
   - Server Members Intent
   - Message Content Intent
5. Go to **OAuth2** in the sidebar, copy the **Client ID**
6. Use this URL to invite the bot to your server (replace `YOUR_CLIENT_ID`):
   ```
   https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=8&scope=bot%20applications.commands
   ```

### Step 2: Set Up the Project

```bash
# Clone the repository
git clone https://github.com/HardHeadHackerHead/discord-bot.git
cd discord-bot

# Install dependencies
npm install

# Copy the example environment file
cp .env.example .env
```

### Step 3: Configure Environment

Edit `.env` and fill in the **required** values:

```env
# REQUIRED — paste your bot token and client ID from Step 1
BOT_TOKEN=your_bot_token_here
CLIENT_ID=your_client_id_here

# REQUIRED — MySQL connection string
# If using local MySQL:
DATABASE_URL=mysql://root:yourpassword@localhost:3306/quadslab_bot
# If using Docker MySQL (see below):
DATABASE_URL=mysql://root:rootpassword@localhost:3307/quadslab_bot

# RECOMMENDED — your Discord server ID for instant command updates
# Right-click your server name in Discord (Developer Mode must be enabled) → Copy Server ID
DEV_GUILD_ID=your_server_id_here
```

### Step 4: Set Up the Database

**Option A: Local MySQL**

Create the database in MySQL:
```sql
CREATE DATABASE quadslab_bot;
```

Then run:
```bash
# Generate Prisma client
npm run db:generate

# Create database tables
npm run db:push
```

**Option B: Docker MySQL (no local install needed)**

```bash
# Start just the database
docker compose up db -d

# Wait 10 seconds for MySQL to initialize, then run:
npm run db:generate
npm run db:push
```

This starts MySQL on port **3307** (to avoid conflicting with any local MySQL on 3306).

### Step 5: Start the Bot

```bash
# Development mode (hot reload on file changes)
npm run dev

# Or build and run for production
npm run build
npm start
```

You should see output like:
```
[Bot] Logged in as YourBot#1234
[ModuleLoader] Discovered 10 modules
[ModuleManager] All modules loaded successfully
```

### Full Docker Setup (Bot + Database)

To run everything in Docker:

```bash
# Start bot and MySQL together
docker compose up -d

# View logs
docker compose logs -f bot

# Stop everything
docker compose down
```

## Configuration Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `BOT_TOKEN` | Yes | — | Discord bot token |
| `CLIENT_ID` | Yes | — | Discord application client ID |
| `DATABASE_URL` | Yes | — | MySQL connection string (`mysql://user:pass@host:port/db`) |
| `DEV_GUILD_ID` | No | — | Guild ID for instant slash command registration |
| `NODE_ENV` | No | `development` | `development`, `production`, or `test` |
| `LOG_LEVEL` | No | `info` | `debug`, `info`, `warn`, or `error` |
| `BOT_OWNER_IDS` | No | — | Comma-separated Discord user IDs with owner-level access |

See `.env.example` for additional optional settings (website integration, ngrok, Docker).

## Included Modules

These modules ship with the framework and can be enabled/disabled per server:

| Module | Description | Commands |
|---|---|---|
| **admin** | Module management, settings, bot stats | `/modules`, `/reload`, `/settings`, `/lines`, `/clear` |
| **help** | Lists all available commands | `/commands` |
| **user-tracking** | Tracks users joining/leaving guilds | `/userinfo` |
| **message-tracking** | Tracks message counts with spam cooldown | `/messages` |
| **voice-tracking** | Tracks voice channel time with session management | `/voicetime` |
| **points** | Currency system with balance and transaction history | `/points` |
| **leaderboard** | Unified leaderboard display for all module stats | `/leaderboard` |
| **polls** | Create and manage polls with voting | `/poll` |
| **role-management** | Self-assignable roles via dropdown menus | `/roles` |
| **message-editor** | Edit bot messages via emoji reactions | *(reaction-based)* |

### How Modules Work Together

Modules communicate through events, not direct imports. This means any module can be removed without breaking others:

```
message-tracking ──emits──> "message-counted" ──listened by──> points
voice-tracking   ──emits──> "session-ended"   ──listened by──> points
points           ──registers──> leaderboard provider ──displayed by──> leaderboard
```

If `points` isn't loaded, `message-tracking` and `voice-tracking` still work — they just track stats without awarding points.

## Creating Modules

### Module Structure

Every module lives in its own directory under `src/modules/`:

```
src/modules/my-module/
├── index.ts              # Exports module INSTANCE (not class)
├── module.ts             # Module class with metadata and lifecycle
├── LICENSE               # Module-specific license (optional)
├── migrations/           # SQL migrations (auto-run on load)
│   └── 001_initial.sql
├── commands/             # Slash commands
│   └── my-command.ts
├── events/               # Discord event handlers
│   └── interactionCreate.ts
├── services/             # Business logic and database operations
│   └── MyService.ts
└── components/           # UI builders (embeds, buttons, modals)
    └── MyPanel.ts
```

### Minimal Module Example

**`module.ts`** — Define metadata and lifecycle:
```typescript
import { BaseModule, ModuleMetadata, ModuleContext } from '../../types/module.types.js';
import { command as pingCommand } from './commands/ping.js';
import { Logger } from '../../shared/utils/logger.js';

const logger = new Logger('Ping');

export class PingModule extends BaseModule {
  readonly metadata: ModuleMetadata = {
    id: 'ping',
    name: 'Ping',
    description: 'Simple ping/pong command',
    version: '1.0.0',
    author: 'Your Name',
    isCore: false,
    isPublic: true,
    dependencies: [],
    priority: 50,
  };

  // Set to null if no database tables needed
  readonly migrationsPath = null;

  constructor() {
    super();
    this.commands = [pingCommand];
  }

  async onLoad(context: ModuleContext): Promise<void> {
    await super.onLoad(context);
    logger.info('Ping module loaded');
  }
}
```

**`index.ts`** — Export an instance (not the class):
```typescript
import { PingModule } from './module.js';
export default new PingModule();
```

**`commands/ping.ts`** — Define a slash command:
```typescript
import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { SlashCommand } from '../../../types/command.types.js';

export const command: SlashCommand = {
  type: 'slash',
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check bot latency') as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const latency = Date.now() - interaction.createdTimestamp;
    await interaction.reply(`Pong! ${latency}ms`);
  },
};
```

Drop this folder into `src/modules/ping/`, restart the bot, and the `/ping` command is live. No registration code, no config files — the framework discovers it automatically.

### Full Development Guide

See [docs/MODULE_DEVELOPMENT.md](docs/MODULE_DEVELOPMENT.md) for the complete guide covering:

- Database migrations and the `DatabaseService` API
- Commands with subcommands, autocomplete, and context menus
- Event handlers and custom ID conventions
- Services with dependency injection pattern
- UI components (embeds, buttons, select menus, modals)
- Inter-module event bus (emitting and subscribing)
- Centralized settings system (per-guild configuration)
- Leaderboard registry (registering stat providers)
- Cron jobs (scheduled tasks)
- Panel state management for multi-step UI flows

## Building Modules with Claude Code

This project is designed to work well with [Claude Code](https://docs.anthropic.com/en/docs/claude-code). The module architecture follows strict, consistent patterns that Claude Code can replicate reliably. Here's how to use it effectively.

### Creating a New Module

Give Claude Code context about what you want, and reference the existing patterns:

```
Read docs/MODULE_DEVELOPMENT.md and the points module in src/modules/points/
as a reference. Then create a new module called "warnings" that:

- Tracks user warnings with reasons
- /warn command (admin only) to warn a user
- /warnings command to view a user's warning history
- Stores warnings in a database table
- Emits a "warning-issued" event so other modules can react
```

Claude Code will follow the established patterns because:
1. The module structure is enforced (every module has the same file layout)
2. The types are well-documented (`ModuleMetadata`, `SlashCommand`, `BaseModule`)
3. Real examples exist in the codebase to reference

### Tips for Effective Prompts

**Be specific about the module's behavior:**
```
Create a "birthday" module that lets users set their birthday with /birthday set,
shows upcoming birthdays with /birthday list, and announces birthdays daily
using the cron system. Store dates in a birthday_dates table.
```

**Reference existing modules for complex patterns:**
```
Look at how the points module subscribes to events from voice-tracking
and message-tracking. Create a "levels" module that listens to the same
events but calculates XP and levels instead of points. Register a
leaderboard showing level rankings.
```

**Ask for specific integrations:**
```
Create a "welcome" module that sends a welcome embed when users join.
Register a setting for the welcome channel ID and welcome message text
using the centralized settings system so admins can configure it with /settings.
```

### What Claude Code Should Know

When creating modules, these are the key patterns:

| Pattern | How It Works |
|---|---|
| **Service injection** | Services are created in `onLoad()`, then passed to commands/events via `setService()` functions |
| **Custom IDs** | All interaction custom IDs use `<module>:<action>:<data>` format (e.g., `polls:vote:abc123`) |
| **Table naming** | Database tables are prefixed with the module ID (e.g., `points_user_points`) |
| **Event naming** | Module events use `<module-id>:<event-name>` format (e.g., `voice-tracking:session-ended`) |
| **Exports** | `index.ts` must export an **instance**: `export default new MyModule()` |
| **Migrations** | Numbered SQL files in `migrations/` (e.g., `001_initial.sql`) — run automatically |
| **Cleanup** | Always unsubscribe events, unregister leaderboards/settings/cron in `onUnload()` |

### Example Prompts for Common Module Types

**Tracking module** (like message-tracking):
```
Create a "reaction-tracking" module that counts reactions users give and receive.
Track both given and received counts. Emit events when reactions are counted.
Register two leaderboards: "Most Reactions Given" and "Most Reactions Received".
```

**Admin module** (like role-management):
```
Create an "auto-role" module with an admin command /autorole that configures
roles automatically assigned when users join. Support multiple roles per guild.
Use the settings system for an optional "delay" before role assignment.
```

**Game module** (like polls):
```
Create a "trivia" module with /trivia that posts a question with 4 button
options. Use a panel component for the question embed and answer buttons.
Track correct answers per user and register a leaderboard.
```

**Integration module** (with events):
```
Create a "milestones" module that listens to the points:awarded event.
When a user crosses a milestone threshold (100, 500, 1000, 5000 points),
send a congratulations embed to a configurable channel. Use the settings
system for the announcement channel.
```

## Project Structure

```
QuadsLabBot/
├── src/
│   ├── index.ts                # Entry point
│   ├── bot.ts                  # Bot initialization and orchestration
│   ├── config/
│   │   └── environment.ts      # Env validation with zod
│   ├── core/                   # Core framework (don't modify for modules)
│   │   ├── ai/                 # AI provider abstraction (Claude, OpenAI)
│   │   ├── client/             # Discord.js client wrapper
│   │   ├── commands/           # Command registration and routing
│   │   ├── cron/               # Scheduled task runner
│   │   ├── database/           # Prisma client + migration runner
│   │   ├── events/             # Event handler system
│   │   ├── leaderboards/       # Leaderboard registry
│   │   ├── modules/            # Module loader, registry, event bus
│   │   └── settings/           # Per-module settings system
│   ├── modules/                # Plugin modules (add yours here)
│   ├── shared/
│   │   └── utils/              # Logger, embed helpers, pagination, permissions
│   └── types/                  # TypeScript types for modules, commands, events
├── prisma/                     # Prisma schema and core migrations
├── docs/                       # Documentation
├── Dockerfile                  # Multi-stage Docker build
└── docker-compose.yml          # Docker Compose (bot + MySQL)
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start in development mode with hot reload |
| `npm run build` | Compile TypeScript to JavaScript |
| `npm start` | Run the compiled bot |
| `npm run db:generate` | Generate Prisma client |
| `npm run db:migrate` | Run Prisma migrations |
| `npm run db:push` | Push schema changes to database |
| `npm run db:studio` | Open Prisma Studio (database GUI) |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Run ESLint with auto-fix |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to contribute.

## License

The core framework is licensed under the [MIT License](LICENSE).

Individual modules in `src/modules/` may have their own licenses. Check each module's `LICENSE` file for details. Modules without a license file fall under the project's MIT license.
