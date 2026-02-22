import { BaseModule, ModuleMetadata, ModuleContext } from '../../types/module.types.js';
import { command as userinfoCommand } from './commands/userinfo.js';
import { guildMemberAddEvent } from './events/guildMemberAdd.js';
import { guildMemberRemoveEvent } from './events/guildMemberRemove.js';
import { interactionCreateEvent } from './events/interactionCreate.js';
import { UserSyncService } from './services/UserSyncService.js';
import { Logger } from '../../shared/utils/logger.js';

const logger = new Logger('UserTracking');

/**
 * User Tracking Module - Tracks users in the database
 */
export class UserTrackingModule extends BaseModule {
  readonly metadata: ModuleMetadata = {
    id: 'user-tracking',
    name: 'User Tracking',
    description: 'Tracks users when they join and stores them in the database',
    version: '1.0.0',
    author: 'QuadsLab',
    isCore: true,      // Cannot be disabled - required by other modules
    isPublic: true,    // Users can see this module
    dependencies: [],   // No dependencies
    priority: 99,      // Load early (after admin)
  };

  // No migrations needed - uses core User/GuildMember tables
  readonly migrationsPath = null;

  private syncService: UserSyncService | null = null;

  constructor() {
    super();

    // Register commands
    this.commands = [
      userinfoCommand,
    ];

    // Register events
    this.events = [
      guildMemberAddEvent,
      guildMemberRemoveEvent,
      interactionCreateEvent,
    ];
  }

  /**
   * Called when module loads - sync all existing guild members
   */
  async onLoad(context: ModuleContext): Promise<void> {
    await super.onLoad(context);

    // Create sync service
    this.syncService = new UserSyncService(context.client, context.prisma);

    // Wait for client to be ready before syncing
    if (context.client.isReady()) {
      // Client is already ready, sync now
      await this.performInitialSync();
    } else {
      // Wait for ready event
      context.client.once('ready', async () => {
        await this.performInitialSync();
      });
    }
  }

  /**
   * Perform the initial sync of all guild members
   */
  private async performInitialSync(): Promise<void> {
    if (!this.syncService) return;

    logger.info('Performing initial user sync...');

    try {
      await this.syncService.syncAllGuilds();
    } catch (error) {
      logger.error('Failed to perform initial user sync:', error);
    }
  }
}
