/**
 * Website Integration Module
 * Integrates Discord bot with the Quad H Lab website
 *
 * Features:
 * - Sends activity events (member join, voice join, level up, etc.) to website
 * - Syncs leaderboard data periodically
 * - Webhook server receives interactions from website in real-time
 * - Data endpoints serve live Discord data to website
 */

import { Client } from 'discord.js';
import { BaseModule, ModuleMetadata, ModuleContext } from '../../types/module.types.js';
import { Logger } from '../../shared/utils/logger.js';
import { getModuleSettingsService } from '../../core/settings/ModuleSettingsService.js';
import { ModuleSettingsSchema } from '../../core/settings/SettingsDefinition.js';
import { MODULE_EVENTS } from '../../types/module-events.types.js';
import type { EventSubscription } from '../../core/modules/ModuleEventBus.js';

// Services
import { WebsiteApiService } from './services/WebsiteApiService.js';
import { ActivityBatcher } from './services/ActivityBatcher.js';
import { LeaderboardSync } from './services/LeaderboardSync.js';
import { InteractionPoller } from './services/InteractionPoller.js';
import { WebhookServer } from './services/WebhookServer.js';
import { NgrokService } from './services/NgrokService.js';
import { PointsService } from '../points/services/PointsService.js';

// Events
import { memberJoinEvent, setActivityBatcher as setMemberJoinBatcher } from './events/memberJoin.js';
import { voiceStateUpdateEvent, setActivityBatcher as setVoiceBatcher } from './events/voiceStateUpdate.js';
import { guildMemberUpdateEvent, setActivityBatcher as setMemberUpdateBatcher } from './events/guildMemberUpdate.js';
import { presenceUpdateEvent, setActivityBatcher as setPresenceBatcher } from './events/presenceUpdate.js';
import { interactionCreateEvent, setPokeHandler, setWaveHandler } from './events/interactionCreate.js';

// Commands
import { websiteCommand, setServices as setCommandServices } from './commands/website.js';

// Types
import type { WebsiteIntegrationSettings } from './types/website.types.js';

const logger = new Logger('WebsiteIntegration');

// Settings schema
const SETTINGS_SCHEMA: ModuleSettingsSchema = {
  moduleId: 'website-integration',
  moduleName: 'Website Integration',
  settings: [
    {
      key: 'enabled',
      name: 'Enable Integration',
      description: 'Enable or disable website integration',
      type: 'boolean',
      defaultValue: false,
      category: 'general',
    },
    {
      key: 'website_url',
      name: 'Website URL',
      description: 'Base URL of the website (e.g., https://quadhlab.com)',
      type: 'string',
      defaultValue: '',
      required: true,
      category: 'general',
    },
    {
      key: 'webhook_secret',
      name: 'Webhook Secret',
      description: 'Shared secret for authenticating with the website API',
      type: 'string',
      defaultValue: '',
      required: true,
      category: 'authentication',
    },
    {
      key: 'interaction_channel_id',
      name: 'Interaction Channel',
      description: 'Channel ID where website interactions will be posted',
      type: 'string',
      defaultValue: '',
      category: 'interactions',
    },
    {
      key: 'leaderboard_sync_interval',
      name: 'Leaderboard Sync Interval',
      description: 'How often to sync leaderboard data to the website (in minutes)',
      type: 'number',
      defaultValue: 10,
      min: 5,
      max: 60,
      category: 'sync',
    },
    {
      key: 'interaction_poll_interval',
      name: 'Interaction Poll Interval',
      description: 'How often to poll for website interactions (in seconds)',
      type: 'number',
      defaultValue: 10,
      min: 5,
      max: 60,
      category: 'interactions',
    },
    {
      key: 'activity_batch_interval',
      name: 'Activity Batch Interval',
      description: 'How often to send batched activity events (in seconds)',
      type: 'number',
      defaultValue: 10,
      min: 5,
      max: 60,
      category: 'sync',
    },
    {
      key: 'poke_responder_role_id',
      name: 'Poke Responder Role',
      description: 'Role to ping when poke interactions arrive (users can subscribe via /website subscribe)',
      type: 'string',
      defaultValue: '',
      category: 'interactions',
    },
    {
      key: 'poke_points_reward',
      name: 'Poke Points Reward',
      description: 'Points awarded for responding to a poke interaction (0 to disable)',
      type: 'number',
      defaultValue: 50,
      min: 0,
      max: 1000,
      category: 'interactions',
    },
    {
      key: 'webhook_server_enabled',
      name: 'Enable Webhook Server',
      description: 'Enable HTTP server for receiving webhooks from website (recommended over polling)',
      type: 'boolean',
      defaultValue: true,
      category: 'webhook',
    },
    {
      key: 'webhook_server_port',
      name: 'Webhook Server Port',
      description: 'Port for the webhook server (default: 3001)',
      type: 'number',
      defaultValue: 3001,
      min: 1024,
      max: 65535,
      category: 'webhook',
    },
    {
      key: 'webhook_rate_limit',
      name: 'Rate Limit',
      description: 'Maximum requests per minute from website (per IP)',
      type: 'number',
      defaultValue: 100,
      min: 10,
      max: 1000,
      category: 'webhook',
    },
    {
      key: 'ngrok_enabled',
      name: 'Enable Ngrok Tunnel',
      description: 'Automatically start an ngrok tunnel for local development (exposes webhook server to internet)',
      type: 'boolean',
      defaultValue: false,
      category: 'ngrok',
    },
    {
      key: 'ngrok_auth_token',
      name: 'Ngrok Auth Token',
      description: 'Your ngrok authentication token (optional - get from ngrok.com for stable URLs)',
      type: 'string',
      defaultValue: '',
      category: 'ngrok',
    },
    {
      key: 'ngrok_region',
      name: 'Ngrok Region',
      description: 'Ngrok server region: us, eu, ap, au, sa, jp, in (default: us)',
      type: 'string',
      defaultValue: 'us',
      category: 'ngrok',
    },
  ],
};

export class WebsiteIntegrationModule extends BaseModule {
  readonly metadata: ModuleMetadata = {
    id: 'website-integration',
    name: 'Website Integration',
    description: 'Integrates Discord bot with the Quad H Lab website',
    version: '1.0.0',
    author: 'QuadsLab',
    isCore: false,
    isPublic: true,
    dependencies: [],
    optionalDependencies: ['points', 'message-tracking', 'voice-tracking', 'user-tracking'],
    priority: 30, // Load after tracking modules
  };

  readonly migrationsPath = './migrations';

  // Services
  private apiService: WebsiteApiService | null = null;
  private activityBatcher: ActivityBatcher | null = null;
  private leaderboardSync: LeaderboardSync | null = null;
  private interactionPoller: InteractionPoller | null = null;
  private webhookServer: WebhookServer | null = null;
  private ngrokService: NgrokService | null = null;
  private pointsService: PointsService | null = null;

  // Event subscriptions
  private eventSubscriptions: EventSubscription[] = [];

  // Context reference
  private moduleContext: ModuleContext | null = null;

  constructor() {
    super();
    this.commands = [websiteCommand];
    this.events = [
      memberJoinEvent,
      voiceStateUpdateEvent,
      guildMemberUpdateEvent,
      presenceUpdateEvent,
      interactionCreateEvent,
    ];
  }

  async onLoad(context: ModuleContext): Promise<void> {
    await super.onLoad(context);
    this.moduleContext = context;

    // Register settings schema
    const settingsService = getModuleSettingsService();
    if (settingsService) {
      settingsService.registerSchema(SETTINGS_SCHEMA);
    }

    // Defer initialization until client is ready (don't block module loading)
    if (context.client.isReady()) {
      await this.initializeServices(context);
    } else {
      context.client.once('ready', async () => {
        await this.initializeServices(context);
      });
      logger.info('Website Integration module loaded, waiting for client ready to initialize services');
    }
  }

  /**
   * Initialize services after client is ready
   */
  private async initializeServices(context: ModuleContext): Promise<void> {
    try {
      // Get settings - we need to determine the guild ID
      // For a single-server bot, we can get it from the client
      const guildId = this.getPrimaryGuildIdSync(context.client);

      if (!guildId) {
        logger.warn('No guild found, website integration will not start');
        return;
      }

      const settings = await this.getSettings(guildId);

      if (!settings.enabled) {
        logger.info('Website integration is disabled');
        return;
      }

      if (!settings.website_url || !settings.webhook_secret) {
        logger.warn('Website URL or secret not configured, integration will not start');
        return;
      }

      // Initialize services
      this.apiService = new WebsiteApiService(settings.website_url, settings.webhook_secret);

      this.activityBatcher = new ActivityBatcher(
        this.apiService,
        settings.webhook_secret,
        { batchInterval: settings.activity_batch_interval * 1000 }
      );

      this.leaderboardSync = new LeaderboardSync(
        this.apiService,
        context.prisma,
        guildId,
        settings.webhook_secret,
        { syncInterval: settings.leaderboard_sync_interval * 60 * 1000 }
      );

      // Get the guild for interaction handling
      const guild = context.client.guilds.cache.first();

      // Create PointsService if points module is loaded
      if (context.isModuleLoaded('points')) {
        this.pointsService = new PointsService(context.db, context.events);
        logger.debug('Points service created for poke rewards');
      }

      // Use webhook server (recommended) or fallback to polling
      if (settings.webhook_server_enabled) {
        // Create webhook server for receiving interactions
        this.webhookServer = new WebhookServer(
          context.client,
          this.apiService,
          {
            port: settings.webhook_server_port ?? 3001,
            secret: settings.webhook_secret,
            rateLimit: settings.webhook_rate_limit ?? 100,
          },
          settings.interaction_channel_id
        );

        if (guild) {
          this.webhookServer.setGuild(guild);
        }

        // Configure handlers
        this.webhookServer.updateHandlerSettings({
          channelId: settings.interaction_channel_id,
          responderRoleId: settings.poke_responder_role_id || '',
          pointsReward: settings.poke_points_reward ?? 50,
        });

        // Set points service on poke handler
        if (this.pointsService) {
          this.webhookServer.getPokeHandler().setPointsService(this.pointsService);
        }

        // Inject handlers into button event handler
        setPokeHandler(this.webhookServer.getPokeHandler());
        setWaveHandler(this.webhookServer.getWaveHandler());

        logger.info('Using webhook server for website interactions');
      } else {
        // Fallback to polling (deprecated but still works)
        this.interactionPoller = new InteractionPoller(
          this.apiService,
          context.client,
          settings.interaction_channel_id,
          settings.webhook_secret,
          { pollInterval: settings.interaction_poll_interval * 1000 }
        );

        if (guild) {
          this.interactionPoller.setGuild(guild);
        }

        // Configure poke handler with settings and points service
        const pokeHandler = this.interactionPoller.getPokeHandler();
        pokeHandler.updateSettings({
          responderRoleId: settings.poke_responder_role_id || '',
          pointsReward: settings.poke_points_reward ?? 50,
        });
        if (this.pointsService) {
          pokeHandler.setPointsService(this.pointsService);
        }

        // Configure wave handler with settings (shares the same responder role)
        const waveHandler = this.interactionPoller.getWaveHandler();
        waveHandler.updateSettings({
          responderRoleId: settings.poke_responder_role_id || '',
        });

        // Inject handlers into button event handler
        setPokeHandler(this.interactionPoller.getPokeHandler());
        setWaveHandler(this.interactionPoller.getWaveHandler());

        logger.warn('Using polling for website interactions (deprecated - enable webhook server)');
      }

      // Inject services into event handlers
      setMemberJoinBatcher(this.activityBatcher);
      setVoiceBatcher(this.activityBatcher);
      setMemberUpdateBatcher(this.activityBatcher);
      setPresenceBatcher(this.activityBatcher);

      // Inject services into command
      setCommandServices(
        this.apiService,
        this.activityBatcher,
        this.leaderboardSync,
        this.interactionPoller
      );

      // Subscribe to module events for level ups and message milestones
      this.subscribeToModuleEvents(context);

      // Start services
      this.activityBatcher.start();
      this.leaderboardSync.start();

      if (this.webhookServer) {
        await this.webhookServer.start();

        // Start ngrok tunnel if enabled (only with webhook server)
        if (settings.ngrok_enabled) {
          this.ngrokService = new NgrokService({
            port: settings.webhook_server_port ?? 3001,
            authToken: settings.ngrok_auth_token || undefined,
            region: settings.ngrok_region || 'us',
          });
          const ngrokUrl = await this.ngrokService.start();

          // Register the ngrok URL with the website so it knows where to send requests
          if (ngrokUrl && this.apiService) {
            await this.apiService.registerBotUrl(ngrokUrl);
          }
        }
      } else if (this.interactionPoller) {
        this.interactionPoller.start();
      }

      logger.info('Website Integration module initialized and started');
    } catch (error) {
      logger.error('Failed to initialize website integration:', error);
    }
  }

  async onUnload(): Promise<void> {
    // Stop services
    this.activityBatcher?.stop();
    this.leaderboardSync?.stop();
    this.interactionPoller?.stop();

    // Stop ngrok tunnel
    if (this.ngrokService) {
      await this.ngrokService.stop();
    }

    // Stop webhook server gracefully
    if (this.webhookServer) {
      await this.webhookServer.stop();
    }

    // Flush any pending events
    if (this.activityBatcher && this.activityBatcher.getQueueSize() > 0) {
      logger.info('Flushing pending activity events before unload...');
      await this.activityBatcher.flush();
    }

    // Unsubscribe from events
    for (const sub of this.eventSubscriptions) {
      sub.unsubscribe();
    }
    this.eventSubscriptions = [];

    // Unregister settings
    const settingsService = getModuleSettingsService();
    if (settingsService) {
      settingsService.unregisterSchema(this.metadata.id);
    }

    this.apiService = null;
    this.activityBatcher = null;
    this.leaderboardSync = null;
    this.interactionPoller = null;
    this.webhookServer = null;
    this.ngrokService = null;
    this.pointsService = null;
    this.moduleContext = null;

    await super.onUnload();
    logger.info('Website Integration module unloaded');
  }

  /**
   * Get primary guild ID for single-server bot (synchronous - client must be ready)
   */
  private getPrimaryGuildIdSync(client: Client): string | null {
    const guild = client.guilds.cache.first();
    return guild?.id || null;
  }

  /**
   * Get settings for a guild
   */
  private async getSettings(guildId: string): Promise<WebsiteIntegrationSettings> {
    const settingsService = getModuleSettingsService();

    const defaults: WebsiteIntegrationSettings = {
      enabled: false,
      website_url: process.env['WEBSITE_URL'] || '',
      webhook_secret: process.env['WEBSITE_WEBHOOK_SECRET'] || '',
      interaction_channel_id: '',
      leaderboard_sync_interval: 10,
      interaction_poll_interval: 10,
      activity_batch_interval: 10,
      poke_responder_role_id: '',
      poke_points_reward: 50,
      webhook_server_enabled: true,
      webhook_server_port: parseInt(process.env['WEBHOOK_SERVER_PORT'] || '3001', 10),
      webhook_rate_limit: 100,
      ngrok_enabled: process.env['NGROK_ENABLED'] === 'true',
      ngrok_auth_token: process.env['NGROK_AUTH_TOKEN'] || '',
      ngrok_region: process.env['NGROK_REGION'] || 'us',
    };

    if (!settingsService) {
      return defaults;
    }

    const settings = await settingsService.getSettings<WebsiteIntegrationSettings>(
      this.metadata.id,
      guildId
    );

    return { ...defaults, ...settings };
  }

  /**
   * Subscribe to module events for cross-module integration
   */
  private subscribeToModuleEvents(context: ModuleContext): void {
    // Listen for points awarded events (for level ups)
    if (context.isModuleLoaded('points')) {
      const pointsSub = context.events.on<{ userId: string; guildId: string; amount: number; newTotal: number; level?: number }>(
        MODULE_EVENTS.POINTS_AWARDED,
        this.metadata.id,
        async (payload) => {
          // Check if level changed (you'd need to track this or have level in the event)
          // For now, we'll skip level_up since points module may not emit level changes
          // This would need enhancement in the points module
        }
      );
      this.eventSubscriptions.push(pointsSub);
    }

    // Listen for message counted events (for milestones)
    if (context.isModuleLoaded('message-tracking')) {
      const msgSub = context.events.on<{ userId: string; guildId: string; newCount: number }>(
        MODULE_EVENTS.MESSAGE_COUNTED,
        this.metadata.id,
        async (payload) => {
          const { userId, guildId, newCount } = payload.data;

          // Check for milestones
          const milestones = [100, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
          if (milestones.includes(newCount) && this.activityBatcher) {
            // Get user info
            const member = await this.moduleContext?.client.guilds.cache.get(guildId)?.members.fetch(userId);
            if (member) {
              this.activityBatcher.addEvent({
                type: 'message_milestone',
                user: {
                  id: userId,
                  username: member.displayName,
                  avatar: member.user.displayAvatarURL({ size: 128 }),
                },
                title: `Reached ${newCount.toLocaleString()} messages`,
                emoji: '💬',
                category: 'achievement',
                metadata: {
                  messageCount: newCount,
                },
              });
            }
          }
        }
      );
      this.eventSubscriptions.push(msgSub);
    }
  }
}
