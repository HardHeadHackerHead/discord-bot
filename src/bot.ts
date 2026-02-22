import { ExtendedClient } from './core/client/ExtendedClient.js';
import { Logger } from './shared/utils/logger.js';

const logger = new Logger('Bot');

/**
 * Global client instance
 */
let client: ExtendedClient | null = null;

/**
 * Get the bot client instance
 */
export function getClient(): ExtendedClient {
  if (!client) {
    throw new Error('Bot client not initialized');
  }
  return client;
}

/**
 * Start the bot
 */
export async function startBot(): Promise<ExtendedClient> {
  if (client) {
    logger.warn('Bot is already running');
    return client;
  }

  logger.info('Creating bot client...');
  client = new ExtendedClient();

  // Handle process signals for graceful shutdown
  setupShutdownHandlers();

  // Start the bot
  await client.start();

  return client;
}

/**
 * Stop the bot
 */
export async function stopBot(): Promise<void> {
  if (!client) {
    logger.warn('Bot is not running');
    return;
  }

  await client.shutdown();
  client = null;
}

/**
 * Set up graceful shutdown handlers
 */
function setupShutdownHandlers(): void {
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down...`);

    try {
      await stopBot();
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  };

  // Handle termination signals
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception:', error);
    shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection:', reason);
    // Don't exit on unhandled rejections, just log
  });
}

// Export client type for external use
export type { ExtendedClient };
