/**
 * MCP Server Entry Point for Discord Server Management
 *
 * This is a standalone entry point that starts an MCP server
 * for managing Discord servers via Claude Code.
 *
 * Usage:
 *   node dist/mcp-server.js
 *
 * Required environment variables:
 *   DISCORD_TOKEN - Your Discord bot token
 *   DISCORD_GUILD_ID - The ID of the Discord server to manage
 */

import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

import { initializeClient, destroyClient, refreshServerCache } from './mcp/discord-client.js';
import { createMCPServer, startMCPServer } from './mcp/index.js';

async function main(): Promise<void> {
  // Validate required environment variables
  // Support both DISCORD_TOKEN and BOT_TOKEN (fallback)
  const token = process.env['DISCORD_TOKEN'] || process.env['BOT_TOKEN'];
  const guildId = process.env['DISCORD_GUILD_ID'];

  if (!token) {
    console.error('Error: DISCORD_TOKEN or BOT_TOKEN environment variable is required');
    process.exit(1);
  }

  if (!guildId) {
    console.error('Error: DISCORD_GUILD_ID environment variable is required');
    process.exit(1);
  }

  // Set DISCORD_TOKEN for the discord-client module
  process.env['DISCORD_TOKEN'] = token;

  console.error('Starting Discord MCP server...');
  console.error(`Guild ID: ${guildId}`);

  try {
    // Initialize Discord client
    console.error('Connecting to Discord...');
    const client = await initializeClient();
    console.error(`Logged in as ${client.user?.tag}`);

    // Pre-cache server data for fast lookups
    console.error('Caching server data...');
    await refreshServerCache();

    // Create and start MCP server
    const mcpServer = createMCPServer();
    await startMCPServer(mcpServer);

    console.error('MCP server ready and listening');

    // Handle graceful shutdown
    const shutdown = async (signal: string) => {
      console.error(`\nReceived ${signal}, shutting down...`);
      await destroyClient();
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

  } catch (error) {
    console.error('Failed to start MCP server:', error);
    await destroyClient();
    process.exit(1);
  }
}

main();
