import {
  Client,
  ClientOptions,
  GatewayIntentBits,
  Partials,
  Events,
} from 'discord.js';
import { prisma, connectPrisma, disconnectPrisma } from '../database/prisma.js';
import { testMySQLConnection, closeMySQLPool } from '../database/mysql.js';
import { ModuleManager } from '../modules/ModuleManager.js';
import { CommandManager } from '../commands/CommandManager.js';
import { EventManager } from '../events/EventManager.js';
import { SettingsManager } from '../settings/SettingsManager.js';
import { initModuleSettingsService } from '../settings/ModuleSettingsService.js';
import { initCronService, startCronService, stopCronService, getCronService, CronService } from '../cron/index.js';
import { env, isDevelopment } from '../../config/environment.js';
import { Logger } from '../../shared/utils/logger.js';

const logger = new Logger('Client');

/**
 * Default client options with all necessary intents
 */
const DEFAULT_CLIENT_OPTIONS: ClientOptions = {
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
    Partials.GuildMember,
    Partials.User,
  ],
};

/**
 * Extended Discord.js Client with integrated managers.
 */
export class ExtendedClient extends Client {
  /** Module manager instance */
  public readonly modules: ModuleManager;

  /** Command manager instance */
  public readonly commands: CommandManager;

  /** Event manager instance */
  public readonly events: EventManager;

  /** Settings manager instance */
  public readonly settings: SettingsManager;

  /** Cron service instance */
  public readonly cron: CronService;

  /** Whether the bot is ready */
  private _isReady: boolean = false;

  /** Whether initial startup is complete (used to determine if we should auto-deploy commands) */
  private _startupComplete: boolean = false;

  constructor(options?: Partial<ClientOptions>) {
    super({ ...DEFAULT_CLIENT_OPTIONS, ...options });

    // Initialize managers
    this.modules = new ModuleManager({
      client: this,
      prisma,
    });

    this.commands = new CommandManager(this);
    this.events = new EventManager(this);
    this.settings = new SettingsManager(prisma);
    this.cron = initCronService();

    // Wire up managers
    this.wireManagers();

    // Set up core event handlers
    this.setupCoreEvents();
  }

  /**
   * Wire up manager callbacks
   */
  private wireManagers(): void {
    // Module manager needs to notify command/event managers
    this.modules.setCommandsChangedCallback(async (moduleId, action) => {
      const module = this.modules.getModule(moduleId);
      if (!module) return;

      // Only auto-deploy commands after initial startup is complete
      // During startup, we batch deploy all commands at once
      const shouldDeploy = this._startupComplete;

      if (action === 'register') {
        await this.commands.registerModuleCommands(module, shouldDeploy);
      } else {
        await this.commands.unregisterModuleCommands(moduleId, shouldDeploy);
      }
    });

    this.modules.setEventsChangedCallback(async (moduleId, action) => {
      const module = this.modules.getModule(moduleId);
      if (!module) return;

      if (action === 'register') {
        await this.events.registerModuleEvents(module);
      } else {
        await this.events.unregisterModuleEvents(moduleId);
      }
    });

    // Event manager needs to check module enabled status
    this.events.setModuleEnabledChecker(async (moduleId, guildId) => {
      return this.modules.isEnabledForGuild(moduleId, guildId);
    });

    // Command manager needs to check module enabled status
    this.commands.setModuleEnabledChecker(async (moduleId, guildId) => {
      return this.modules.isEnabledForGuild(moduleId, guildId);
    });

    // Command manager needs to get module instances
    this.commands.setModuleGetter((moduleId) => {
      return this.modules.getModule(moduleId);
    });

    // Module manager needs to update command permissions when module is enabled/disabled for a guild
    this.modules.setModuleGuildStateChangedCallback(async (moduleId, guildId, enabled) => {
      await this.commands.updateModuleCommandPermissions(moduleId, guildId, enabled);
    });
  }

  /**
   * Set up core Discord event handlers
   */
  private setupCoreEvents(): void {
    // Ready event
    this.once(Events.ClientReady, async () => {
      this._isReady = true;
      logger.info(`Logged in as ${this.user?.tag}`);
      logger.info(`Serving ${this.guilds.cache.size} guild(s)`);

      // Deploy commands after ready
      try {
        await this.commands.deployCommands();
        // Mark startup as complete - future module loads will auto-deploy
        this._startupComplete = true;
      } catch (error) {
        logger.error('Failed to deploy commands:', error);
      }
    });

    // Interaction handler
    this.on(Events.InteractionCreate, async (interaction) => {
      await this.commands.handleInteraction(interaction);
    });

    // Guild join - ensure guild exists in database
    this.on(Events.GuildCreate, async (guild) => {
      logger.info(`Joined guild: ${guild.name} (${guild.id})`);

      await prisma.guild.upsert({
        where: { id: guild.id },
        update: {
          name: guild.name,
          iconHash: guild.icon,
          ownerId: guild.ownerId,
          isActive: true,
          leftAt: null,
        },
        create: {
          id: guild.id,
          name: guild.name,
          iconHash: guild.icon,
          ownerId: guild.ownerId,
        },
      });
    });

    // Guild leave - mark as inactive
    this.on(Events.GuildDelete, async (guild) => {
      logger.info(`Left guild: ${guild.name} (${guild.id})`);

      await prisma.guild.update({
        where: { id: guild.id },
        data: {
          isActive: false,
          leftAt: new Date(),
        },
      }).catch(() => {
        // Guild might not exist in database
      });
    });

    // Error handling
    this.on(Events.Error, (error) => {
      logger.error('Client error:', error);
    });

    this.on(Events.Warn, (message) => {
      logger.warn('Client warning:', message);
    });

    // Debug logging in development
    if (isDevelopment) {
      this.on(Events.Debug, (message) => {
        // Filter out noisy messages
        if (message.includes('Heartbeat')) return;
        logger.debug(message);
      });
    }
  }

  /**
   * Initialize the bot - connect to database and load modules
   */
  async initialize(): Promise<void> {
    logger.info('Initializing bot...');

    // Connect to Prisma (core tables)
    logger.info('Connecting to database...');
    await connectPrisma();

    // Test MySQL connection (module tables)
    const mysqlConnected = await testMySQLConnection();
    if (!mysqlConnected) {
      throw new Error('Failed to connect to MySQL database');
    }

    logger.info('Database connected');

    // Initialize the centralized module settings service
    initModuleSettingsService(prisma);
    logger.info('Module settings service initialized');

    // Initialize modules
    await this.modules.initialize();

    // Start cron service
    startCronService();
    logger.info('Cron service started');

    logger.info('Bot initialized');
  }

  /**
   * Start the bot - login to Discord
   */
  async start(): Promise<void> {
    logger.info('Starting bot...');

    // Initialize first
    await this.initialize();

    // Login to Discord
    await this.login(env.BOT_TOKEN);
  }

  /**
   * Shutdown the bot gracefully
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down bot...');

    // Stop cron service
    stopCronService();
    logger.info('Cron service stopped');

    // Shutdown modules
    await this.modules.shutdown();

    // Disconnect from database
    await disconnectPrisma();
    await closeMySQLPool();

    // Destroy Discord client
    this.destroy();

    logger.info('Bot shut down');
  }

  /**
   * Check if bot is ready
   */
  get isInitialized(): boolean {
    return this._isReady;
  }
}

/**
 * Create and export client instance
 */
export function createClient(options?: Partial<ClientOptions>): ExtendedClient {
  return new ExtendedClient(options);
}
