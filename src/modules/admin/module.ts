import { BaseModule, ModuleMetadata, ModuleContext } from '../../types/module.types.js';
import { command as modulesCommand } from './commands/modules.js';
import { command as reloadCommand } from './commands/reload.js';
import { command as settingsCommand } from './commands/settings.js';
import { command as linesCommand } from './commands/lines.js';
import { command as clearCommand } from './commands/clear.js';
import { interactionCreateEvent } from './events/interactionCreate.js';
import { initCodeStatsService } from './services/CodeStatsService.js';
import { Logger } from '../../shared/utils/logger.js';

const logger = new Logger('Admin');

/**
 * Admin Module - Core administrative commands
 */
export class AdminModule extends BaseModule {
  readonly metadata: ModuleMetadata = {
    id: 'admin',
    name: 'Admin',
    description: 'Core administrative commands for managing the bot',
    version: '1.0.0',
    author: 'QuadsLab',
    isCore: true,      // Cannot be disabled
    isPublic: true,    // Users can see this module
    dependencies: [],   // No dependencies
    priority: 100,     // Load first
  };

  // Migrations path for code stats table
  readonly migrationsPath = './migrations';

  constructor() {
    super();

    // Register commands
    this.commands = [
      modulesCommand,
      reloadCommand,
      settingsCommand,
      linesCommand,
      clearCommand,
    ];

    // Register events
    this.events = [
      interactionCreateEvent,
    ];
  }

  async onLoad(context: ModuleContext): Promise<void> {
    await super.onLoad(context);

    // Initialize code stats service and record current stats
    const codeStatsService = initCodeStatsService(context.db);

    // Record stats on bot load (will skip if unchanged or in production without source)
    try {
      const { recorded, stats } = await codeStatsService.recordStats();
      if (recorded && stats) {
        logger.info(`New code stats recorded: ${stats.totalLines.toLocaleString()} lines in ${stats.fileCount} files`);
      }
    } catch (error) {
      logger.error('Failed to record code stats on load:', error);
    }
  }
}
