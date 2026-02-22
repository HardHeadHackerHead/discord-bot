import { VoiceState } from 'discord.js';
import { AnyModuleEvent } from '../../../types/event.types.js';
import { VoiceTrackingService } from '../services/VoiceTrackingService.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('VoiceTracking:Event');

let voiceTrackingService: VoiceTrackingService | null = null;

export function setVoiceTrackingService(service: VoiceTrackingService): void {
  voiceTrackingService = service;
}

export const voiceStateUpdateEvent: AnyModuleEvent = {
  name: 'voiceStateUpdate',
  once: false,

  async execute(...args: unknown[]): Promise<void> {
    const oldState = args[0] as VoiceState;
    const newState = args[1] as VoiceState;

    if (!voiceTrackingService) return;

    const userId = newState.member?.id || oldState.member?.id;
    const guildId = newState.guild?.id || oldState.guild?.id;

    if (!userId || !guildId) return;

    // Ignore bots
    if (newState.member?.user.bot || oldState.member?.user.bot) return;

    const oldChannelId = oldState.channelId;
    const newChannelId = newState.channelId;

    // No change in channel
    if (oldChannelId === newChannelId) return;

    try {
      // User left a voice channel
      if (oldChannelId && !newChannelId) {
        await voiceTrackingService.endActiveSession(userId, guildId);
        logger.debug(`User ${userId} left voice channel ${oldChannelId}`);
      }
      // User joined a voice channel
      else if (!oldChannelId && newChannelId) {
        await voiceTrackingService.startSession(userId, guildId, newChannelId);
        logger.debug(`User ${userId} joined voice channel ${newChannelId}`);
      }
      // User switched channels
      else if (oldChannelId && newChannelId && oldChannelId !== newChannelId) {
        // End old session and start new one
        await voiceTrackingService.endActiveSession(userId, guildId);
        await voiceTrackingService.startSession(userId, guildId, newChannelId);
        logger.debug(`User ${userId} switched from ${oldChannelId} to ${newChannelId}`);
      }
    } catch (error) {
      logger.error('Error handling voice state update:', error);
    }
  },
};
