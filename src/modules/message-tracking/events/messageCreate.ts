import { Message } from 'discord.js';
import { AnyModuleEvent } from '../../../types/event.types.js';
import { MessageTrackingService } from '../services/MessageTrackingService.js';
import { Logger } from '../../../shared/utils/logger.js';
import { getModuleSettingsService } from '../../../core/settings/ModuleSettingsService.js';
import type { MessageTrackingSettings } from '../module.js';

const logger = new Logger('MessageTracking:Event');

let messageTrackingService: MessageTrackingService | null = null;

export function setMessageTrackingService(service: MessageTrackingService): void {
  messageTrackingService = service;
}

export const messageCreateEvent: AnyModuleEvent = {
  name: 'messageCreate',
  once: false,

  async execute(...args: unknown[]): Promise<void> {
    const message = args[0] as Message;

    if (!messageTrackingService) return;

    // Ignore bots
    if (message.author.bot) return;

    // Ignore DMs
    if (!message.guild) return;

    // Ignore system messages
    if (message.system) return;

    const userId = message.author.id;
    const guildId = message.guild.id;
    const channelId = message.channel.id;
    const messageId = message.id;

    try {
      // Get guild-specific cooldown setting
      const settingsService = getModuleSettingsService();
      const settings = await settingsService?.getSettings<MessageTrackingSettings>(
        'message-tracking',
        guildId
      ) ?? { message_cooldown_seconds: 60 } as MessageTrackingSettings;

      await messageTrackingService.recordMessage(
        userId,
        guildId,
        channelId,
        messageId,
        settings.message_cooldown_seconds
      );
    } catch (error) {
      logger.error('Error handling message create:', error);
    }
  },
};
