/**
 * Presence Update Event Handler
 * Sends stream_start/stream_end activity to the website when users start/stop streaming
 */

import { Presence, ActivityType as DiscordActivityType } from 'discord.js';
import type { AnyModuleEvent } from '../../../types/event.types.js';
import type { ActivityBatcher } from '../services/ActivityBatcher.js';

let activityBatcher: ActivityBatcher | null = null;

export function setActivityBatcher(batcher: ActivityBatcher): void {
  activityBatcher = batcher;
}

// Track streaming users to detect start/stop
const streamingUsers = new Set<string>();

export const presenceUpdateEvent: AnyModuleEvent = {
  name: 'presenceUpdate',
  once: false,

  async execute(...args: unknown[]): Promise<void> {
    const newPresence = args[1] as Presence;

    if (!activityBatcher || !newPresence.member || newPresence.member.user.bot) return;

    const userId = newPresence.member.id;
    const wasStreaming = streamingUsers.has(userId);
    const streamingActivity = newPresence.activities.find(
      activity => activity.type === DiscordActivityType.Streaming
    );
    const isStreaming = !!streamingActivity;

    const user = {
      id: newPresence.member.id,
      username: newPresence.member.displayName,
      avatar: newPresence.member.user.displayAvatarURL({ size: 128 }),
    };

    // Started streaming
    if (!wasStreaming && isStreaming) {
      streamingUsers.add(userId);
      activityBatcher.addEvent({
        type: 'stream_start',
        user,
        title: 'Started streaming',
        description: streamingActivity?.name || undefined,
        emoji: '📺',
        category: 'voice',
        metadata: {
          streamName: streamingActivity?.name,
          streamUrl: streamingActivity?.url,
        },
      });
    }

    // Stopped streaming
    if (wasStreaming && !isStreaming) {
      streamingUsers.delete(userId);
      activityBatcher.addEvent({
        type: 'stream_end',
        user,
        title: 'Stopped streaming',
        emoji: '📺',
        category: 'voice',
      });
    }
  },
};
