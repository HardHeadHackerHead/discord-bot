import { GuildMember, PartialGuildMember } from 'discord.js';
import { AnyModuleEvent } from '../../../types/event.types.js';
import { LabService, LAB_OWNER_EMOJI } from '../services/LabService.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('DynamicLab:MemberUpdate');

// Store the service instance (will be set by module)
let labService: LabService | null = null;

export function setLabService(service: LabService): void {
  labService = service;
}

export const guildMemberUpdateEvent: AnyModuleEvent = {
  name: 'guildMemberUpdate',
  once: false,

  async execute(...args: unknown[]): Promise<void> {
    const [oldMember, newMember] = args as [GuildMember | PartialGuildMember, GuildMember];

    if (!labService) return;

    // Ignore bots
    if (newMember.user.bot) return;

    // Check if nickname changed
    const oldNick = oldMember.nickname;
    const newNick = newMember.nickname;

    // If nickname didn't change, ignore
    if (oldNick === newNick) return;

    // Check if the new nickname contains the flask emoji
    if (!labService.hasFlaskEmoji(newNick)) return;

    // Check if this user has an active lab - if so, they're allowed to have the flask
    const userLab = await labService.getUserLab(newMember.id, newMember.guild.id);
    if (userLab) {
      // User has an active lab, they're allowed to have the flask
      return;
    }

    // User doesn't have a lab but has flask in nickname - remove it
    logger.info(`User ${newMember.user.username} added flask emoji without having a lab - removing it`);
    await labService.removeAnyFlaskFromNickname(newMember);
  },
};
