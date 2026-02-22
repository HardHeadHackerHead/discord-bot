import { BaseModule, ModuleMetadata, ModuleContext } from '../../types/module.types.js';
import { command as commandsCommand } from './commands/commands.js';
import { Logger } from '../../shared/utils/logger.js';

const logger = new Logger('Help');

/**
 * Help Module - Provides command listing and help information
 */
export class HelpModule extends BaseModule {
  readonly metadata: ModuleMetadata = {
    id: 'help',
    name: 'Help',
    description: 'Lists all available commands with descriptions and permissions',
    version: '1.0.0',
    author: 'QuadsLab',
    isCore: false,
    isPublic: true,
    dependencies: [],
    priority: 100,
  };

  constructor() {
    super();
    this.commands = [commandsCommand];
  }

  async onLoad(context: ModuleContext): Promise<void> {
    await super.onLoad(context);
    logger.info('Help module loaded');
  }

  async onUnload(): Promise<void> {
    logger.info('Help module unloaded');
  }
}
