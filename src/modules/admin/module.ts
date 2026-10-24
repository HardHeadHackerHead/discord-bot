import { BaseModule, ModuleMetadata } from '../../types/module.types.js';
import { command as modulesCommand } from './commands/modules.js';
import { command as reloadCommand } from './commands/reload.js';
import { command as settingsCommand } from './commands/settings.js';
import { command as clearCommand } from './commands/clear.js';
import { command as summarizeCommand } from './commands/summarize.js';
import { interactionCreateEvent } from './events/interactionCreate.js';

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

  // Migrations for the admin_code_stats table (now used by the code-stats module)
  readonly migrationsPath = './migrations';

  constructor() {
    super();

    // Register commands
    this.commands = [
      modulesCommand,
      reloadCommand,
      settingsCommand,
      clearCommand,
      summarizeCommand,
    ];

    // Register events
    this.events = [
      interactionCreateEvent,
    ];
  }
}
