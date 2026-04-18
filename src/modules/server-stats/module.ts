import { BaseModule, ModuleMetadata, ModuleContext } from '../../types/module.types.js';
import { command as serverstatsCommand, setServerStatsService } from './commands/serverstats.js';
import { guildMemberAddEvent } from './events/guildMemberAdd.js';
import { guildMemberRemoveEvent } from './events/guildMemberRemove.js';
import { channelDeleteEvent } from './events/channelDelete.js';
import { ServerStatsService, initServerStatsService } from './services/ServerStatsService.js';
import { DatabaseService } from '../../core/database/postgres.js';
import { Logger } from '../../shared/utils/logger.js';

const logger = new Logger('ServerStats');

/**
 * Server Stats Module - Creates channels that display server statistics
 */
export class ServerStatsModule extends BaseModule {
  readonly metadata: ModuleMetadata = {
    id: 'server-stats',
    name: 'Server Stats',
    description: 'Creates voice channels that display server statistics like member count',
    version: '1.0.0',
    author: 'QuadsLab',
    isCore: false,
    isPublic: true,
    dependencies: [],
    priority: 50,
  };

  readonly migrationsPath = 'migrations';

  private statsService: ServerStatsService | null = null;
  private updateInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();

    // Register commands
    this.commands = [serverstatsCommand];

    // Register events
    this.events = [
      guildMemberAddEvent,
      guildMemberRemoveEvent,
      channelDeleteEvent,
    ];
  }

  /**
   * Called when module loads
   */
  async onLoad(context: ModuleContext): Promise<void> {
    await super.onLoad(context);

    // Create database service
    const dbService = new DatabaseService();

    // Initialize service
    this.statsService = initServerStatsService(dbService);

    // Inject service into command
    setServerStatsService(this.statsService);

    logger.info('Server Stats module loaded');

    // Wait for client to be ready before starting updates
    if (context.client.isReady()) {
      await this.startPeriodicUpdates();
    } else {
      context.client.once('ready', async () => {
        await this.startPeriodicUpdates();
      });
    }
  }

  /**
   * Start periodic updates for stats channels
   * Updates every 5 minutes to avoid rate limits
   */
  private async startPeriodicUpdates(): Promise<void> {
    if (!this.statsService || !this.context) return;

    logger.info('Starting periodic stats updates...');

    // Initial update
    try {
      await this.statsService.updateAllStats(this.context.client);
      logger.debug('Initial stats update complete');
    } catch (error) {
      logger.error('Failed initial stats update:', error);
    }

    // Update every 5 minutes (Discord rate limits channel renames to 2 per 10 minutes)
    this.updateInterval = setInterval(async () => {
      if (!this.statsService || !this.context) return;

      try {
        await this.statsService.updateAllStats(this.context.client);
        logger.debug('Periodic stats update complete');
      } catch (error) {
        logger.error('Failed periodic stats update:', error);
      }
    }, 5 * 60 * 1000); // 5 minutes
  }

  /**
   * Called when module is enabled for a guild
   */
  async onEnable(guildId: string): Promise<void> {
    if (!this.statsService || !this.context) return;

    logger.info(`Server Stats enabled for guild ${guildId}`);

    // Update stats for this guild immediately
    try {
      await this.statsService.updateGuildStats(this.context.client, guildId);
    } catch (error) {
      logger.error(`Failed to update stats for guild ${guildId}:`, error);
    }
  }

  /**
   * Called when module is disabled for a guild
   */
  async onDisable(guildId: string): Promise<void> {
    if (!this.statsService || !this.context) return;

    logger.info(`Server Stats disabled for guild ${guildId}`);

    // Optionally delete all stats channels for this guild
    try {
      const channels = await this.statsService.getGuildStatsChannels(guildId);
      const guild = this.context.client.guilds.cache.get(guildId);

      for (const statsChannel of channels) {
        // Delete the Discord channel
        const channel = guild?.channels.cache.get(statsChannel.channel_id);
        if (channel) {
          await channel.delete('Server Stats module disabled').catch(() => {});
        }
      }

      // Clean up database
      await this.statsService.deleteGuildStatsChannels(guildId);
      logger.info(`Cleaned up ${channels.length} stats channel(s) for guild ${guildId}`);
    } catch (error) {
      logger.error(`Failed to clean up stats channels for guild ${guildId}:`, error);
    }
  }

  /**
   * Called when module unloads
   */
  async onUnload(): Promise<void> {
    logger.info('Unloading Server Stats module...');

    // Stop periodic updates
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    // Note: We don't delete stats channels on unload - they persist
    // Only delete on explicit module disable

    this.statsService = null;

    logger.info('Server Stats module unloaded');
  }
}
