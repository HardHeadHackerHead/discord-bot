import { BaseModule, ModuleMetadata, ModuleContext } from '../../types/module.types.js';
import { command as linesCommand } from './commands/lines.js';
import { interactionCreateEvent } from './events/interactionCreate.js';
import { initCodeStatsService } from './services/CodeStatsService.js';
import { Logger } from '../../shared/utils/logger.js';

const logger = new Logger('CodeStats');

/**
 * Code Stats Module - lines-of-code stats and history charts
 */
export class CodeStatsModule extends BaseModule {
  readonly metadata: ModuleMetadata = {
    id: 'code-stats',
    name: 'Code Stats',
    description: 'Shows how many lines of code the bot has, with history charts',
    version: '1.0.0',
    author: 'QuadsLab',
    isCore: false,
    isPublic: true,
    dependencies: [],
    priority: 50,
  };

  // The admin_code_stats table is created by the admin module's migrations,
  // which ran before this module was split out.
  readonly migrationsPath = null;

  constructor() {
    super();
    this.commands = [linesCommand];
    this.events = [interactionCreateEvent];
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
