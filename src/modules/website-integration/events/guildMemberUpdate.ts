/**
 * Guild Member Update Event Handler
 * Sends boost activity to the website when users boost the server
 */

import { GuildMember } from 'discord.js';
import type { AnyModuleEvent } from '../../../types/event.types.js';
import type { ActivityBatcher } from '../services/ActivityBatcher.js';

let activityBatcher: ActivityBatcher | null = null;

export function setActivityBatcher(batcher: ActivityBatcher): void {
  activityBatcher = batcher;
}

export const guildMemberUpdateEvent: AnyModuleEvent = {
  name: 'guildMemberUpdate',
  once: false,

  async execute(...args: unknown[]): Promise<void> {
    const oldMember = args[0] as GuildMember;
    const newMember = args[1] as GuildMember;

    if (!activityBatcher || newMember.user.bot) return;

    // Check if user just started boosting
    if (!oldMember.premiumSince && newMember.premiumSince) {
      activityBatcher.addEvent({
        type: 'boost',
        user: {
          id: newMember.id,
          username: newMember.displayName,
          avatar: newMember.user.displayAvatarURL({ size: 128 }),
        },
        title: 'Boosted the server',
        emoji: '💎',
        category: 'social',
      });
    }
  },
};
