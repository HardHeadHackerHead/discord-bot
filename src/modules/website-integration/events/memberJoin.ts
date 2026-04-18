/**
 * Member Join Event Handler
 * Sends member_join activity to the website
 */

import { GuildMember } from 'discord.js';
import type { AnyModuleEvent } from '../../../types/event.types.js';
import type { ActivityBatcher } from '../services/ActivityBatcher.js';

let activityBatcher: ActivityBatcher | null = null;

export function setActivityBatcher(batcher: ActivityBatcher): void {
  activityBatcher = batcher;
}

export const memberJoinEvent: AnyModuleEvent = {
  name: 'guildMemberAdd',
  once: false,

  async execute(...args: unknown[]): Promise<void> {
    const member = args[0] as GuildMember;

    if (!activityBatcher || member.user.bot) return;

    activityBatcher.addEvent({
      type: 'member_join',
      user: {
        id: member.id,
        username: member.displayName,
        avatar: member.user.displayAvatarURL({ size: 128 }),
      },
      title: 'Joined the server',
      emoji: '👋',
      category: 'social',
    });
  },
};
