/**
 * Inactive Users Module
 * Provides admin tools to view members with no chat or voice activity
 */

import { BaseModule, ModuleMetadata, ModuleContext } from '../../types/module.types.js';
import { Logger } from '../../shared/utils/logger.js';
import { DatabaseService } from '../../core/database/postgres.js';

// Services
import { InactiveUsersService } from './services/InactiveUsersService.js';

// Commands
import { command as inactiveCommand, setService as setCommandService } from './commands/inactive.js';

// Events
import { interactionCreateEvent, setService as setEventService } from './events/interactionCreate.js';

const logger = new Logger('InactiveUsers');

export class InactiveUsersModule extends BaseModule {
  readonly metadata: ModuleMetadata = {
    id: 'inactive-users',
    name: 'Inactive Users',
    description: 'View and manage members with no chat or voice activity',
    version: '1.0.0',
    author: 'QuadsLab',
    isCore: false,
    isPublic: true,
    dependencies: ['user-tracking'],
    optionalDependencies: ['message-tracking', 'voice-tracking'],
    priority: 60, // Load after tracking modules
  };

  private service: InactiveUsersService | null = null;

  constructor() {
    super();
    this.commands = [inactiveCommand];
    this.events = [interactionCreateEvent];
  }

  async onLoad(context: ModuleContext): Promise<void> {
    await super.onLoad(context);

    // Initialize service
    const dbService = new DatabaseService();
    this.service = new InactiveUsersService(dbService);

    // Inject service into commands and events
    setCommandService(this.service);
    setEventService(this.service);

    logger.info('Inactive Users module loaded');
  }

  async onEnable(guildId: string): Promise<void> {
    logger.info(`Inactive Users module enabled for guild ${guildId}`);
  }

  async onDisable(guildId: string): Promise<void> {
    logger.info(`Inactive Users module disabled for guild ${guildId}`);
  }

  async onUnload(): Promise<void> {
    this.service = null;
    logger.info('Inactive Users module unloaded');
  }
}
