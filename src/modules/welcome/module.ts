import { BaseModule, ModuleMetadata, ModuleContext } from '../../types/module.types.js';
import { command as welcomeCommand, setServices as setCommandServices } from './commands/welcome.js';
import { guildMemberAddEvent, setServices as setEventServices } from './events/guildMemberAdd.js';
import { WelcomeService } from './services/WelcomeService.js';
import { WelcomeImageService } from './services/ImageService.js';
import { getModuleSettingsService } from '../../core/settings/ModuleSettingsService.js';
import type { ModuleSettingsSchema } from '../../core/settings/SettingsDefinition.js';
import { initClaudeProvider, initOpenAIProvider } from '../../core/ai/index.js';
import { Logger } from '../../shared/utils/logger.js';

const logger = new Logger('Welcome');

/**
 * Settings schema for the welcome module
 */
const SETTINGS_SCHEMA: ModuleSettingsSchema = {
  moduleId: 'welcome',
  moduleName: 'Welcome Messages',
  settings: [
    {
      key: 'default_color',
      name: 'Default Glow Color',
      description: 'Default neon glow color for welcome images',
      type: 'string',
      defaultValue: '#00D4FF',
      category: 'appearance',
    },
  ],
};

/**
 * Welcome Module - Welcomes new members with custom branded images and AI messages
 *
 * Features:
 * - Custom welcome images with lab-themed neon glow effects
 * - AI-generated personalized welcome messages
 * - Configurable welcome channel and DM options
 * - Template-based messages with placeholders
 *
 * Commands:
 * - /welcome setup <channel> - Quick setup
 * - /welcome toggle - Enable/disable
 * - /welcome channel <channel> - Set welcome channel
 * - /welcome color <hex> - Set glow color
 * - /welcome dm - Toggle DM welcome
 * - /welcome image - Toggle image generation
 * - /welcome ai - Toggle AI messages
 * - /welcome prompt <text> - Set AI prompt template
 * - /welcome test - Test on yourself
 * - /welcome settings - View current settings
 */
export class WelcomeModule extends BaseModule {
  readonly metadata: ModuleMetadata = {
    id: 'welcome',
    name: 'Welcome Messages',
    description: 'Welcomes new members with custom branded images and AI messages',
    version: '1.0.0',
    author: 'QuadsLab',
    isCore: false,
    isPublic: true,
    dependencies: [],
    optionalDependencies: ['points'], // Could award points on join if available
    priority: 50,
  };

  readonly migrationsPath = './migrations';

  private welcomeService: WelcomeService | null = null;
  private imageService: WelcomeImageService | null = null;

  constructor() {
    super();
    this.commands = [welcomeCommand];
    this.events = [guildMemberAddEvent];
  }

  async onLoad(context: ModuleContext): Promise<void> {
    await super.onLoad(context);

    // Initialize AI providers (if configured)
    try {
      initOpenAIProvider();
    } catch {
      logger.debug('OpenAI provider not configured');
    }
    try {
      initClaudeProvider();
    } catch {
      logger.debug('Claude provider not configured');
    }

    // Initialize services
    this.welcomeService = new WelcomeService(context.db);
    this.imageService = new WelcomeImageService();

    // Inject services into commands and events
    setCommandServices(this.welcomeService, this.imageService);
    setEventServices(this.welcomeService, this.imageService);

    // Register settings schema
    getModuleSettingsService()?.registerSchema(SETTINGS_SCHEMA);

    logger.info('Welcome module loaded');
  }

  async onEnable(guildId: string): Promise<void> {
    logger.debug(`Welcome module enabled for guild ${guildId}`);
  }

  async onDisable(guildId: string): Promise<void> {
    logger.debug(`Welcome module disabled for guild ${guildId}`);
  }

  async onUnload(): Promise<void> {
    // Unregister settings
    getModuleSettingsService()?.unregisterSchema(this.metadata.id);

    // Clean up services
    this.welcomeService = null;
    this.imageService = null;

    await super.onUnload();
    logger.info('Welcome module unloaded');
  }

  /**
   * Get the welcome service for external use
   */
  getWelcomeService(): WelcomeService | null {
    return this.welcomeService;
  }

  /**
   * Get the image service for external use
   */
  getImageService(): WelcomeImageService | null {
    return this.imageService;
  }
}
