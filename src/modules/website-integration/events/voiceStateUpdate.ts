/**
 * Voice State Update Event Handler
 * Sends voice_join/voice_leave and stream_start/stream_end activity to the website
 */

import { VoiceState } from 'discord.js';
import type { AnyModuleEvent } from '../../../types/event.types.js';
import type { ActivityBatcher } from '../services/ActivityBatcher.js';

let activityBatcher: ActivityBatcher | null = null;

export function setActivityBatcher(batcher: ActivityBatcher): void {
  activityBatcher = batcher;
}

export const voiceStateUpdateEvent: AnyModuleEvent = {
  name: 'voiceStateUpdate',
  once: false,

  async execute(...args: unknown[]): Promise<void> {
    const oldState = args[0] as VoiceState;
    const newState = args[1] as VoiceState;

    if (!activityBatcher || !newState.member || newState.member.user.bot) return;

    const user = {
      id: newState.member.id,
      username: newState.member.displayName,
      avatar: newState.member.user.displayAvatarURL({ size: 128 }),
    };

    // User joined a voice channel
    if (!oldState.channel && newState.channel) {
      activityBatcher.addEvent({
        type: 'voice_join',
        user,
        title: `Joined ${newState.channel.name}`,
        emoji: '🎤',
        category: 'voice',
        metadata: {
          channelId: newState.channel.id,
          channelName: newState.channel.name,
        },
      });
    }

    // User left a voice channel (without joining another)
    if (oldState.channel && !newState.channel) {
      activityBatcher.addEvent({
        type: 'voice_leave',
        user,
        title: `Left ${oldState.channel.name}`,
        emoji: '👋',
        category: 'voice',
        metadata: {
          channelId: oldState.channel.id,
          channelName: oldState.channel.name,
        },
      });
    }

    // User started streaming (Go Live)
    if (!oldState.streaming && newState.streaming && newState.channel) {
      activityBatcher.addEvent({
        type: 'stream_start',
        user,
        title: `Started streaming in ${newState.channel.name}`,
        emoji: '📺',
        category: 'voice',
        metadata: {
          channelId: newState.channel.id,
          channelName: newState.channel.name,
        },
      });
    }

    // User stopped streaming (Go Live)
    if (oldState.streaming && !newState.streaming) {
      const channelName = newState.channel?.name || oldState.channel?.name || 'voice';
      activityBatcher.addEvent({
        type: 'stream_end',
        user,
        title: `Stopped streaming in ${channelName}`,
        emoji: '📺',
        category: 'voice',
        metadata: {
          channelId: newState.channel?.id || oldState.channel?.id,
          channelName,
        },
      });
    }
  },
};
