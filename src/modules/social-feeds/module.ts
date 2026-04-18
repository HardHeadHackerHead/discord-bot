import { BaseModule, ModuleMetadata, ModuleContext } from '../../types/module.types.js';
import { command as socialCommand, setFeedsService, setFeedChecker } from './commands/social.js';
import { SocialFeedsService } from './services/SocialFeedsService.js';
import { FeedChecker } from './services/FeedChecker.js';
import { getModuleSettingsService } from '../../core/settings/ModuleSettingsService.js';
import type { ModuleSettingsSchema } from '../../core/settings/SettingsDefinition.js';
import { Logger } from '../../shared/utils/logger.js';

const logger = new Logger('SocialFeeds');

/**
 * Settings schema for the social feeds module
 */
const SETTINGS_SCHEMA: ModuleSettingsSchema = {
  moduleId: 'social-feeds',
  moduleName: 'Social Feeds',
  settings: [
    {
      key: 'check_interval_minutes',
      name: 'Check Interval',
      description: 'How often to check for new posts (in minutes)',
      type: 'number',
      defaultValue: 15,
      min: 5,
      max: 60,
      category: 'general',
    },
    {
      key: 'max_posts_per_check',
      name: 'Max Posts Per Check',
      description: 'Maximum number of new posts to send per check (prevents spam)',
      type: 'number',
      defaultValue: 5,
      min: 1,
      max: 10,
      category: 'general',
    },
  ],
};

/**
 * Social Feeds Module - Posts notifications for YouTube and other social media
 *
 * Features:
 * - YouTube channel RSS monitoring
 * - Configurable post channels per feed
 * - Custom notification messages
 * - Duplicate prevention
 *
 * Extensible for future platforms (Twitch, Twitter/X, etc.)
 */
export class SocialFeedsModule extends BaseModule {
  readonly metadata: ModuleMetadata = {
    id: 'social-feeds',
    name: 'Social Feeds',
    description: 'Posts notifications for YouTube uploads and other social media',
    version: '1.0.0',
    author: 'QuadsLab',
    isCore: false,
    isPublic: true,
    dependencies: [],
    optionalDependencies: [],
    priority: 50,
  };

  readonly migrationsPath = './migrations';

  private feedsService: SocialFeedsService | null = null;
  private feedChecker: FeedChecker | null = null;

  constructor() {
    super();

    this.commands = [socialCommand];
    this.events = [];
  }

  async onLoad(context: ModuleContext): Promise<void> {
    await super.onLoad(context);

    // Create service
    this.feedsService = new SocialFeedsService(context.db);

    // Inject service into commands
    setFeedsService(this.feedsService);

    // Register settings schema
    getModuleSettingsService()?.registerSchema(SETTINGS_SCHEMA);

    // Create and start feed checker
    const intervalMs = 15 * 60 * 1000; // Default 15 minutes
    this.feedChecker = new FeedChecker(context.client, this.feedsService, intervalMs);
    this.feedChecker.start();

    // Inject feed checker into commands
    setFeedChecker(this.feedChecker);

    logger.info('Social Feeds module loaded');
  }

  async onUnload(): Promise<void> {
    // Stop feed checker
    if (this.feedChecker) {
      this.feedChecker.stop();
      this.feedChecker = null;
    }

    // Unregister settings
    getModuleSettingsService()?.unregisterSchema(this.metadata.id);

    this.feedsService = null;
    await super.onUnload();
    logger.info('Social Feeds module unloaded');
  }

  async onEnable(guildId: string): Promise<void> {
    logger.debug(`Social Feeds enabled for guild ${guildId}`);
  }

  async onDisable(guildId: string): Promise<void> {
    logger.debug(`Social Feeds disabled for guild ${guildId}`);
  }

  /**
   * Get the feeds service for external use
   */
  getService(): SocialFeedsService | null {
    return this.feedsService;
  }

  /**
   * Get the feed checker for external use
   */
  getFeedChecker(): FeedChecker | null {
    return this.feedChecker;
  }
}
