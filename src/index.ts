/**
 * QuadsLabBot - Modular Discord Bot Framework
 *
 * Entry point for the application.
 */

import { startBot } from './bot.js';
import { Logger } from './shared/utils/logger.js';

const logger = new Logger('Main');

async function main(): Promise<void> {
  logger.info('QuadsLabBot starting...');
  logger.info(`Environment: ${process.env['NODE_ENV'] || 'development'}`);

  try {
    await startBot();
    logger.info('Bot is now running!');
  } catch (error) {
    logger.error('Failed to start bot:', error);
    process.exit(1);
  }
}

// Run the bot
main();
