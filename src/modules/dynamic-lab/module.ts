import { BaseModule, ModuleMetadata, ModuleContext } from '../../types/module.types.js';
import { command as labSetupCommand, setLabService as setSetupLabService } from './commands/lab-setup.js';
import { voiceStateUpdateEvent, setLabService as setVoiceLabService } from './events/voiceStateUpdate.js';
import { interactionCreateEvent, setLabService as setInteractionLabService } from './events/interactionCreate.js';
import { messageCreateEvent, setLabService as setMessageLabService } from './events/messageCreate.js';
import { guildCreateEvent, setLabSetupService as setGuildCreateLabSetupService } from './events/guildCreate.js';
import { guildMemberUpdateEvent, setLabService as setMemberUpdateLabService } from './events/guildMemberUpdate.js';
import { LabService } from './services/LabService.js';
import { LabSetupService } from './services/LabSetupService.js';
import { DatabaseService } from '../../core/database/postgres.js';
import { Logger } from '../../shared/utils/logger.js';
import { MODULE_EVENTS, LabOwnershipDecidedEvent } from '../../types/module-events.types.js';
import { EventSubscription } from '../../core/modules/ModuleEventBus.js';
import { ChannelType, VoiceChannel } from 'discord.js';
import { destroyChannelRateLimitManager } from './services/ChannelRateLimitManager.js';

const logger = new Logger('DynamicLab');

/**
 * Dynamic Lab Module - Creates temporary voice channels for users
 */
export class DynamicLabModule extends BaseModule {
  readonly metadata: ModuleMetadata = {
    id: 'dynamic-lab',
    name: 'Dynamic Labs',
    description: 'Creates personal voice channels (labs) for users with control panel',
    version: '1.0.0',
    author: 'QuadsLab',
    isCore: false,
    isPublic: true,
    dependencies: [],
    priority: 50,
  };

  // Relative path - ModuleManager will join with module directory
  readonly migrationsPath = 'migrations';

  private labService: LabService | null = null;
  private labSetupService: LabSetupService | null = null;
  private eventSubscriptions: EventSubscription[] = [];

  constructor() {
    super();

    // Register commands
    this.commands = [
      labSetupCommand,
    ];

    // Register events
    this.events = [
      voiceStateUpdateEvent,
      interactionCreateEvent,
      messageCreateEvent,
      guildCreateEvent,
      guildMemberUpdateEvent,
    ];
  }

  /**
   * Called when module loads
   */
  async onLoad(context: ModuleContext): Promise<void> {
    await super.onLoad(context);

    // Create database service for this module
    const dbService = new DatabaseService();

    // Create services
    this.labService = new LabService(dbService);
    this.labSetupService = new LabSetupService(dbService, this.labService);

    // Inject services into commands and events
    setSetupLabService(this.labService);
    setVoiceLabService(this.labService);
    setInteractionLabService(this.labService);
    setMessageLabService(this.labService);
    setGuildCreateLabSetupService(this.labSetupService);
    setMemberUpdateLabService(this.labService);

    logger.info('Dynamic Lab module loaded');

    // Subscribe to lab ownership poll results
    this.subscribeToEvents();

    // Setup Get Lab Here channels for all guilds when client is ready
    if (context.client.isReady()) {
      await this.performInitialSetup();
    } else {
      context.client.once('ready', async () => {
        await this.performInitialSetup();
      });
    }
  }

  /**
   * Subscribe to events from other modules
   */
  private subscribeToEvents(): void {
    if (!this.context) return;

    // Listen for lab ownership poll results
    const subscription = this.context.events.on<LabOwnershipDecidedEvent>(
      MODULE_EVENTS.LAB_OWNERSHIP_DECIDED,
      this.metadata.id,
      async (payload) => {
        await this.handleOwnershipPollResult(payload.data);
      }
    );

    this.eventSubscriptions.push(subscription);
    logger.debug('Subscribed to lab ownership poll events');
  }

  /**
   * Handle the result of a lab ownership poll
   */
  private async handleOwnershipPollResult(payload: LabOwnershipDecidedEvent): Promise<void> {
    if (!this.labService || !this.context) return;

    const { channelId, guildId, winnerId, isTie } = payload;

    try {
      // Get the lab
      const lab = await this.labService.getLabByChannel(channelId);
      if (!lab) {
        logger.debug(`No lab found for channel ${channelId}, poll result ignored`);
        return;
      }

      // Get the guild and channel
      const guild = this.context.client.guilds.cache.get(guildId);
      if (!guild) {
        logger.warn(`Guild ${guildId} not found for ownership transfer`);
        return;
      }

      const channel = guild.channels.cache.get(channelId);
      if (!channel || channel.type !== ChannelType.GuildVoice) {
        logger.warn(`Voice channel ${channelId} not found for ownership transfer`);
        return;
      }

      const voiceChannel = channel as VoiceChannel;

      // Get the winning member
      const newOwner = await guild.members.fetch(winnerId).catch(() => null);
      if (!newOwner) {
        logger.warn(`Winner ${winnerId} not found in guild ${guildId}`);
        return;
      }

      // Check if the winner is still in the channel
      if (!voiceChannel.members.has(winnerId)) {
        logger.info(`Winner ${newOwner.user.username} is no longer in the lab, skipping transfer`);
        return;
      }

      // Transfer ownership
      await this.labService.transferOwnership(lab.id, winnerId);

      // Add flask to new owner's nickname
      await this.labService.addFlaskToNickname(newOwner);

      // Get the creator config for default settings
      const creator = await this.labService.getCreatorForLab(lab.id);
      if (!creator) {
        logger.warn(`No creator found for lab ${lab.id}, using basic transfer`);
        // Fallback: just give permissions without applying full settings
        await voiceChannel.permissionOverwrites.create(newOwner.id, {
          ManageChannels: true,
          MoveMembers: true,
          MuteMembers: true,
          DeafenMembers: true,
          Connect: true,
          Speak: true,
        });
      } else {
        // Apply the new owner's full settings (name, lock state, permit list, etc.)
        await this.labService.applyNewOwnerSettings(lab, voiceChannel, newOwner, creator);
      }

      // Send announcement
      const tieNote = isTie ? ' (won by tie-breaker)' : '';
      try {
        await voiceChannel.send({
          content: `🧪 **${newOwner.displayName}** is now the lab owner${tieNote}!`,
        });
      } catch (error) {
        logger.debug('Could not send ownership transfer message:', error);
      }

      // Update the control panel
      const updatedLab = await this.labService.getLabByChannel(channelId);
      if (updatedLab) {
        await this.updateControlPanel(voiceChannel, updatedLab);
      }

      logger.info(`Lab ownership transferred to ${newOwner.user.username} via poll`);
    } catch (error) {
      logger.error('Error handling ownership poll result:', error);
    }
  }

  /**
   * Update the control panel in a lab channel
   */
  private async updateControlPanel(
    channel: VoiceChannel,
    lab: Awaited<ReturnType<LabService['getLabByChannel']>>
  ): Promise<void> {
    if (!lab?.control_message_id || !this.labService) return;

    try {
      const { LabControlPanel } = await import('./components/LabControlPanel.js');

      const message = await channel.messages.fetch(lab.control_message_id);
      const owner = await channel.guild.members.fetch(lab.owner_id);
      const permitList = await this.labService.getUserPermitList(lab.owner_id, lab.guild_id);

      const embed = LabControlPanel.createEmbed(lab, channel, owner.user, permitList);
      const mainButtons = LabControlPanel.createMainButtons(lab);
      const userButtons = LabControlPanel.createUserButtons(lab.is_locked);

      await message.edit({
        embeds: [embed],
        components: [mainButtons, userButtons],
      });
    } catch (error) {
      logger.debug('Could not update control panel:', error);
    }
  }

  /**
   * Perform initial setup of Get Lab Here channels for all guilds
   */
  private async performInitialSetup(): Promise<void> {
    if (!this.labSetupService || !this.context) return;

    logger.info('Setting up Get Lab Here channels...');

    try {
      await this.labSetupService.setupAllGuilds(this.context.client.guilds.cache);
    } catch (error) {
      logger.error('Failed to setup Get Lab Here channels:', error);
    }
  }

  /**
   * Called when module is enabled for a guild
   */
  async onEnable(guildId: string): Promise<void> {
    if (!this.labSetupService || !this.context) return;

    const guild = this.context.client.guilds.cache.get(guildId);
    if (!guild) {
      logger.warn(`Could not find guild ${guildId} to enable module`);
      return;
    }

    logger.info(`Enabling Dynamic Lab module for guild: ${guild.name}`);

    try {
      // Setup the Get Lab Here channel for this guild
      await this.labSetupService.ensureGetLabChannel(guild);
      logger.info(`Dynamic Lab enabled for ${guild.name}`);
    } catch (error) {
      logger.error(`Failed to enable Dynamic Lab for ${guild.name}:`, error);
    }
  }

  /**
   * Called when module is disabled for a guild
   */
  async onDisable(guildId: string): Promise<void> {
    if (!this.labSetupService || !this.context) return;

    const guild = this.context.client.guilds.cache.get(guildId);
    if (!guild) {
      logger.warn(`Could not find guild ${guildId} to disable module`);
      return;
    }

    logger.info(`Disabling Dynamic Lab module for guild: ${guild.name}`);

    try {
      // Perform full cleanup for this guild - delete all labs, Get Lab Here channels, and empty categories
      const result = await this.labSetupService.cleanupGuild(guild, 'delete_all');

      if (result.labsDeleted > 0 || result.channelsDeleted.length > 0 || result.categoryDeleted) {
        logger.info(
          `Cleanup for ${guild.name}: ${result.labsDeleted} lab(s), ` +
          `${result.channelsDeleted.length} creator channel(s), ` +
          `${result.categoryDeleted ? '1 category' : '0 categories'} deleted`
        );
      }

      if (result.errors.length > 0) {
        logger.warn(`Encountered ${result.errors.length} error(s) during cleanup for ${guild.name}`);
      }

      logger.info(`Dynamic Lab disabled for ${guild.name}`);
    } catch (error) {
      logger.error(`Failed to disable Dynamic Lab for ${guild.name}:`, error);
    }
  }

  /**
   * Called when module unloads
   */
  async onUnload(): Promise<void> {
    logger.info('Unloading Dynamic Lab module...');

    // Unsubscribe from events
    for (const subscription of this.eventSubscriptions) {
      subscription.unsubscribe();
    }
    this.eventSubscriptions = [];

    // Destroy the channel rate limit manager
    destroyChannelRateLimitManager();

    // Perform full cleanup for all guilds - delete all labs, Get Lab Here channels, and empty categories
    if (this.labSetupService && this.context) {
      try {
        const results = await this.labSetupService.cleanupAllGuilds(
          this.context.client.guilds.cache,
          'delete_all' // Delete everything on unload
        );

        // Log summary
        let totalLabs = 0;
        let totalChannels = 0;
        let totalCategories = 0;
        let totalErrors = 0;
        for (const result of results.values()) {
          totalLabs += result.labsDeleted;
          totalChannels += result.channelsDeleted.length;
          if (result.categoryDeleted) totalCategories++;
          totalErrors += result.errors.length;
        }

        if (totalLabs > 0 || totalChannels > 0 || totalCategories > 0) {
          logger.info(`Cleanup complete: ${totalLabs} lab(s), ${totalChannels} creator channel(s), ${totalCategories} category(ies) deleted`);
        }
        if (totalErrors > 0) {
          logger.warn(`Encountered ${totalErrors} error(s) during cleanup`);
        }
      } catch (error) {
        logger.error('Failed to cleanup during unload:', error);
      }
    }

    // Clear service references
    this.labService = null;
    this.labSetupService = null;

    logger.info('Dynamic Lab module unloaded');
  }

  /**
   * Called when module is reloaded (hot-reload)
   */
  async onReload(): Promise<void> {
    logger.info('Reloading Dynamic Lab module...');
    // The default behavior is fine - onUnload will be called, then onLoad
    // This is just for logging
  }
}
