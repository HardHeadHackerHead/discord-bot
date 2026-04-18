import {
  Interaction,
  ButtonInteraction,
  StringSelectMenuInteraction,
  GuildMember,
  ThreadChannel,
} from 'discord.js';
import { AnyModuleEvent } from '../../../types/event.types.js';
import { HumorCompetitionService, Submission } from '../services/HumorCompetitionService.js';
import { HumorPanel } from '../components/HumorPanel.js';
import { getModuleSettingsService } from '../../../core/settings/ModuleSettingsService.js';
import { Logger } from '../../../shared/utils/logger.js';

interface HumorSettingsShape extends Record<string, unknown> {
  announce_channel_id: string | null;
}

const logger = new Logger('HumorCompetition:Interaction');

let service: HumorCompetitionService | null = null;

export function setService(s: HumorCompetitionService): void {
  service = s;
}

export const interactionCreateEvent: AnyModuleEvent = {
  name: 'interactionCreate',
  once: false,

  async execute(...args: unknown[]): Promise<void> {
    const interaction = args[0] as Interaction;
    if (!service) return;

    if (interaction.isButton() && interaction.customId.startsWith('humor:')) {
      await handleButton(interaction, service);
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('humor:')) {
      await handleSelect(interaction, service);
    }
  },
};

function isTrustedMember(member: GuildMember, trustedRoleId: string | null): boolean {
  if (!trustedRoleId) return false;
  return member.roles.cache.has(trustedRoleId);
}

async function handleButton(
  interaction: ButtonInteraction,
  svc: HumorCompetitionService
): Promise<void> {
  const parts = interaction.customId.split(':');
  const action = parts[1];
  const targetId = parts[2];
  if (!action || !targetId) return;

  switch (action) {
    case 'end':
      await handleEnd(interaction, svc, targetId);
      break;
    case 'cancel':
      await handleCancel(interaction, svc, targetId);
      break;
    case 'status':
      await handleStatus(interaction, svc, targetId);
      break;
    case 'leaderboard':
      await handleLeaderboard(interaction, svc);
      break;
    case 'lb_prev':
      await handleLeaderboardPage(interaction, svc, parseInt(targetId) - 1);
      break;
    case 'lb_next':
      await handleLeaderboardPage(interaction, svc, parseInt(targetId) + 1);
      break;
  }
}

async function handleSelect(
  interaction: StringSelectMenuInteraction,
  svc: HumorCompetitionService
): Promise<void> {
  const parts = interaction.customId.split(':');
  const action = parts[1];
  const threadId = parts[2];
  if (!action || !threadId) return;

  if (action === 'tiebreak') {
    await handleTieBreak(interaction, svc, threadId);
  }
}

// ==================== Handlers ====================

async function handleEnd(
  interaction: ButtonInteraction,
  svc: HumorCompetitionService,
  threadId: string
): Promise<void> {
  const settings = await svc.getGuildSettings(interaction.guildId!);
  const member = interaction.member as GuildMember;

  if (!isTrustedMember(member, settings?.trusted_role_id ?? null)) {
    await interaction.reply({ content: 'Only Humor Managers can end the competition.', ephemeral: true });
    return;
  }

  // Already has a winner?
  const existingWinner = await svc.getWinnerByThread(threadId);
  if (existingWinner) {
    await interaction.reply({ content: 'This competition has already ended.', ephemeral: true });
    return;
  }

  await interaction.deferReply();

  try {
    const submissions = await svc.getSubmissions(threadId);
    await tallyReactions(interaction, submissions, svc);

    const finalSubmissions = await svc.getSubmissions(threadId);
    const result = await resolveWinner(finalSubmissions);

    // Disable the panel
    const threadIndex = await svc.getThreadIndex(threadId);
    if (threadIndex?.panel_message_id) {
      try {
        const panelMsg = await interaction.channel!.messages.fetch(threadIndex.panel_message_id);
        await panelMsg.edit({ components: HumorPanel.createDisabledButtons() });
      } catch { /* ignore */ }
    }

    if (result.type === 'winner') {
      const winner = result.winner!;
      await svc.recordWinner(interaction.guildId!, threadId, winner.user_id, winner.id, winner.vote_count);

      await interaction.editReply({
        embeds: [HumorPanel.createWinnerEmbed(winner, finalSubmissions.length)],
      });

      if (settings?.winner_role_id) {
        try {
          const winnerMember = await interaction.guild!.members.fetch(winner.user_id);
          await winnerMember.roles.add(settings.winner_role_id);
        } catch (error) {
          logger.error('Error assigning winner role:', error);
        }
      }

      // Announce in the general/announce channel
      await announceWinnerInGeneral(interaction, svc, winner, finalSubmissions.length, threadId);
    } else if (result.type === 'tie') {
      // Resolve display names for the dropdown
      const displayNames = new Map<string, string>();
      for (const s of result.tied!) {
        try {
          const member = await interaction.guild!.members.fetch(s.user_id);
          displayNames.set(s.user_id, member.displayName);
        } catch {
          displayNames.set(s.user_id, s.user_id);
        }
      }

      await interaction.editReply({
        embeds: [HumorPanel.createTieBreakerEmbed(result.tied!)],
        components: HumorPanel.createTieBreakerSelect(threadId, result.tied!, displayNames),
      });
    } else {
      const reason = finalSubmissions.length === 0
        ? 'No submissions were received.'
        : 'No votes were cast.';
      await interaction.editReply({
        embeds: [HumorPanel.createNoWinnerEmbed(reason)],
      });
    }

    logger.info(`Competition in thread ${threadId} ended by ${interaction.user.username}`);
  } catch (error) {
    logger.error('Error ending competition:', error);
    await interaction.editReply({
      embeds: [HumorPanel.createErrorEmbed('Error', 'An error occurred while ending the competition.')],
    });
  }
}

async function handleTieBreak(
  interaction: StringSelectMenuInteraction,
  svc: HumorCompetitionService,
  threadId: string
): Promise<void> {
  const settings = await svc.getGuildSettings(interaction.guildId!);
  const member = interaction.member as GuildMember;

  if (!isTrustedMember(member, settings?.trusted_role_id ?? null)) {
    await interaction.reply({ content: 'Only Humor Managers can break ties.', ephemeral: true });
    return;
  }

  const submissionId = interaction.values[0];
  if (!submissionId) return;

  const winner = await svc.getSubmission(submissionId);
  if (!winner) {
    await interaction.reply({ content: 'Submission not found.', ephemeral: true });
    return;
  }

  await svc.recordWinner(interaction.guildId!, threadId, winner.user_id, winner.id, winner.vote_count);

  const submissions = await svc.getSubmissions(threadId);

  await interaction.update({
    embeds: [HumorPanel.createWinnerEmbed(winner, submissions.length)],
    components: [],
  });

  if (settings?.winner_role_id) {
    try {
      const winnerMember = await interaction.guild!.members.fetch(winner.user_id);
      await winnerMember.roles.add(settings.winner_role_id);
    } catch (error) {
      logger.error('Error assigning winner role:', error);
    }
  }

  // Announce in general
  await announceWinnerInGeneral(interaction, svc, winner, submissions.length, threadId);

  logger.info(`Tie broken in thread ${threadId}: winner ${winner.user_id}, chosen by ${interaction.user.username}`);
}

async function handleCancel(
  interaction: ButtonInteraction,
  svc: HumorCompetitionService,
  threadId: string
): Promise<void> {
  const settings = await svc.getGuildSettings(interaction.guildId!);
  const member = interaction.member as GuildMember;

  if (!isTrustedMember(member, settings?.trusted_role_id ?? null)) {
    await interaction.reply({ content: 'Only Humor Managers can cancel the competition.', ephemeral: true });
    return;
  }

  const threadIndex = await svc.getThreadIndex(threadId);
  if (threadIndex?.panel_message_id) {
    try {
      const panelMsg = await interaction.channel!.messages.fetch(threadIndex.panel_message_id);
      await panelMsg.edit({ components: HumorPanel.createDisabledButtons() });
    } catch { /* ignore */ }
  }

  await interaction.reply({
    embeds: [HumorPanel.createInfoEmbed('Competition Cancelled', "Today's competition has been cancelled.")],
  });

  logger.info(`Competition in thread ${threadId} cancelled by ${interaction.user.username}`);
}

async function handleStatus(
  interaction: ButtonInteraction,
  svc: HumorCompetitionService,
  threadId: string
): Promise<void> {
  const submissions = await svc.getSubmissions(threadId);
  await interaction.reply({
    embeds: [HumorPanel.createStatusEmbed(submissions, null)],
    ephemeral: true,
  });
}

async function handleLeaderboard(
  interaction: ButtonInteraction,
  svc: HumorCompetitionService
): Promise<void> {
  const entries = await svc.getLeaderboard(interaction.guildId!, 10, 0);
  const totalEntries = await svc.getLeaderboardCount(interaction.guildId!);
  const totalPages = Math.ceil(totalEntries / 10);

  await interaction.reply({
    embeds: [HumorPanel.createLeaderboardEmbed(entries, 0, totalEntries)],
    components: HumorPanel.createLeaderboardButtons(0, totalPages),
    ephemeral: true,
  });
}

async function handleLeaderboardPage(
  interaction: ButtonInteraction,
  svc: HumorCompetitionService,
  page: number
): Promise<void> {
  const entries = await svc.getLeaderboard(interaction.guildId!, 10, page * 10);
  const totalEntries = await svc.getLeaderboardCount(interaction.guildId!);
  const totalPages = Math.ceil(totalEntries / 10);

  try {
    await interaction.update({
      embeds: [HumorPanel.createLeaderboardEmbed(entries, page, totalEntries)],
      components: HumorPanel.createLeaderboardButtons(page, totalPages),
    });
  } catch (error) {
    logger.error('Error updating leaderboard:', error);
  }
}

// ==================== Helpers ====================

async function tallyReactions(
  interaction: ButtonInteraction,
  submissions: Submission[],
  svc: HumorCompetitionService
): Promise<void> {
  for (const submission of submissions) {
    try {
      const msg = await interaction.channel!.messages.fetch(submission.message_id);
      const thumbsUp = msg.reactions.cache.get('👍');

      if (thumbsUp) {
        const users = await thumbsUp.users.fetch();
        let count = 0;
        for (const [userId] of users) {
          if (userId === interaction.client.user?.id) continue;
          if (userId === submission.user_id) continue;
          count++;
        }
        await svc.updateSubmissionVoteCount(submission.id, count);
      }
    } catch {
      logger.debug(`Could not fetch reactions for submission ${submission.id}`);
    }
  }
}

interface WinnerResult {
  type: 'winner' | 'tie' | 'none';
  winner?: Submission;
  tied?: Submission[];
}

function resolveWinner(submissions: Submission[]): WinnerResult {
  if (submissions.length === 0) return { type: 'none' };

  const maxVotes = Math.max(...submissions.map(s => s.vote_count));
  if (maxVotes < 1) return { type: 'none' };

  const topSubmissions = submissions.filter(s => s.vote_count === maxVotes);

  if (topSubmissions.length === 1) {
    return { type: 'winner', winner: topSubmissions[0] };
  }

  return { type: 'tie', tied: topSubmissions };
}

async function announceWinnerInGeneral(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  svc: HumorCompetitionService,
  winner: Submission,
  totalSubmissions: number,
  threadId: string
): Promise<void> {
  // Prefer /settings value, fall back to auto-detected DB value
  let channelId: string | null = null;
  const settingsService = getModuleSettingsService();
  if (settingsService) {
    const userSettings = await settingsService.getSettings<HumorSettingsShape>('humor-competition', interaction.guildId!);
    channelId = userSettings.announce_channel_id;
  }
  if (!channelId) {
    const settings = await svc.getGuildSettings(interaction.guildId!);
    channelId = settings?.announce_channel_id ?? null;
  }
  if (!channelId) return;

  try {
    const channel = await interaction.guild!.channels.fetch(channelId);
    if (channel && channel.isTextBased()) {
      await (channel as import('discord.js').TextChannel).send({
        embeds: [HumorPanel.createWinnerAnnouncement(winner, totalSubmissions, threadId)],
      });
    }
  } catch (error) {
    logger.debug('Could not post winner announcement to announce channel:', error);
  }
}
