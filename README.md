# QuadsLabBot

A modular Discord bot framework built with TypeScript and Discord.js. Features dynamic module loading, runtime database migrations, AI integration, and a plugin architecture that makes it easy to add new functionality.

## Features

- **Dynamic Module System** — Drop-in modules with auto-discovery, hot configuration, and per-module database migrations
- **Slash Command Framework** — Declarative command registration with permission guards and guild/global scoping
- **AI Integration** — Pluggable AI providers (Claude, OpenAI) with voice transcription and text-to-speech support
- **Database Management** — Prisma ORM with MySQL, plus per-module SQL migrations that run automatically
- **Event-Driven Architecture** — Inter-module event bus for decoupled communication between modules
- **Docker Ready** — Multi-stage Docker build with MySQL service and health checks

## Quick Start

### Prerequisites

- Node.js 18+
- MySQL 8.0+
- A Discord bot token ([Discord Developer Portal](https://discord.com/developers/applications))

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/QuadsLabBot.git
cd QuadsLabBot

# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your bot token and database credentials

# Generate Prisma client
npm run db:generate

# Push database schema
npm run db:push

# Start in development mode
npm run dev
```

### Docker

```bash
# Start with Docker Compose (bot + MySQL)
docker compose up -d

# View logs
docker compose logs -f bot
```

## Configuration

Copy `.env.example` to `.env` and fill in the required values:

| Variable | Required | Description |
|---|---|---|
| `BOT_TOKEN` | Yes | Discord bot token |
| `CLIENT_ID` | Yes | Discord application client ID |
| `DATABASE_URL` | Yes | MySQL connection string |
| `DEV_GUILD_ID` | No | Guild ID for instant slash command updates during development |
| `NODE_ENV` | No | `development` or `production` (default: `development`) |
| `LOG_LEVEL` | No | `debug`, `info`, `warn`, or `error` (default: `debug`) |

See `.env.example` for the full list of configuration options.

## Module System

QuadsLabBot uses a plugin-based module system. Each module is a self-contained directory under `src/modules/` with its own commands, events, services, and database migrations.

### Included Modules

The core framework ships without modules. Community and first-party modules can be installed by placing them in `src/modules/`. See the [Module Development Guide](docs/MODULE_DEVELOPMENT.md) for details on creating your own.

### Creating a Module

```
src/modules/my-module/
├── index.ts              # Module export
├── module.ts             # Module class with metadata
├── migrations/           # SQL migrations (auto-run)
│   └── 001_initial.sql
├── commands/             # Slash commands
│   └── my-command.ts
├── events/               # Discord event handlers
│   └── messageCreate.ts
├── services/             # Business logic
│   └── MyService.ts
└── components/           # UI builders
    └── MyPanel.ts
```

See [docs/MODULE_DEVELOPMENT.md](docs/MODULE_DEVELOPMENT.md) for the full development guide.

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

## Project Structure

```
QuadsLabBot/
├── src/
│   ├── index.ts              # Entry point
│   ├── bot.ts                # Bot initialization
│   ├── config/               # Environment validation
│   ├── core/                 # Core framework
│   │   ├── ai/               # AI provider abstraction
│   │   ├── client/           # Discord.js client wrapper
│   │   ├── commands/         # Command registration system
│   │   ├── cron/             # Scheduled task runner
│   │   ├── database/         # Prisma + migration runner
│   │   ├── events/           # Event handler system
│   │   └── modules/          # Module loader
│   ├── modules/              # Plugin modules (see Module System)
│   └── shared/               # Shared utilities and types
├── prisma/                   # Prisma schema and migrations
├── docs/                     # Documentation
├── Dockerfile                # Multi-stage Docker build
└── docker-compose.yml        # Docker Compose configuration
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to contribute to this project.

## License

This project's core framework is licensed under the [MIT License](LICENSE).

Individual modules in `src/modules/` may have their own licenses. Check each module's `LICENSE` file for details. If a module does not include a license file, it falls under the project's MIT license.
