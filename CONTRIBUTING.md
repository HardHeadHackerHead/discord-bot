# Contributing to QuadsLabBot

Thanks for your interest in contributing! This document covers the process for contributing to this project.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/HardHeadHackerHead/discord-bot.git`
3. Install dependencies: `npm install`
4. Copy `.env.example` to `.env` and configure your environment
5. Create a branch for your changes: `git checkout -b feature/my-feature`

## Development Setup

You'll need:
- Node.js 18+
- MySQL 8.0+ (or use Docker: `docker compose up db -d`)
- A Discord bot token for testing

```bash
# Install dependencies
npm install

# Generate Prisma client
npm run db:generate

# Push database schema
npm run db:push

# Start dev mode with hot reload
npm run dev
```

## Making Changes

### Code Style

- This project uses TypeScript with strict mode enabled
- Run `npm run lint` before committing to check for style issues
- Run `npm run lint:fix` to auto-fix what can be fixed
- Follow existing patterns in the codebase

### Creating Modules

If you're contributing a new module, follow the structure documented in [docs/MODULE_DEVELOPMENT.md](docs/MODULE_DEVELOPMENT.md). Key points:

- Each module must be self-contained in `src/modules/<module-name>/`
- Include a `LICENSE` file if your module uses a different license than the project
- Include database migrations in `migrations/` if your module needs database tables
- Export a module instance from `index.ts`, not a class

### Commit Messages

Write clear, concise commit messages that describe what changed and why:

```
Add points decay feature for inactive users

Users who haven't earned points in 30 days now have
their balance reduced by 5% weekly to encourage activity.
```

### Pull Requests

1. Keep PRs focused — one feature or fix per PR
2. Update documentation if your change affects the public API or setup process
3. Make sure `npm run build` and `npm run lint` pass
4. Describe what your PR does and why in the description
5. Link any related issues

## Reporting Bugs

Open an issue with:
- Steps to reproduce
- Expected behavior
- Actual behavior
- Node.js version and OS
- Relevant log output

## Suggesting Features

Open an issue tagged as a feature request. Describe:
- The problem you're trying to solve
- Your proposed solution
- Any alternatives you've considered

## Module Licensing

The core framework is MIT licensed. If you contribute a module, you can choose your own license for it by including a `LICENSE` file in your module directory. If no license file is included, the module falls under the project's MIT license.

## Code of Conduct

Please read and follow our [Code of Conduct](CODE_OF_CONDUCT.md).
