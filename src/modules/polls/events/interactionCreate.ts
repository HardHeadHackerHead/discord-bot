import {
  Interaction,
  ButtonInteraction,
  StringSelectMenuInteraction,
  PermissionFlagsBits,
  GuildMember,
  TextChannel,
} from 'discord.js';
import { AnyModuleEvent } from '../../../types/event.types.js';
import { ModuleEventBus } from '../../../core/modules/ModuleEventBus.js';
import { PollsService } from '../services/PollsService.js';
import { PollsPanel } from '../components/PollsPanel.js';
import { Logger } from '../../../shared/utils/logger.js';
import { MODULE_EVENTS } from '../../../types/module-events.types.js';

const logger = new Logger('Polls:Interaction');

let pollsService: PollsService | null = null;
let moduleEventBus: ModuleEventBus | null = null;
const POLLS_MODULE_ID = 'polls';

export function setPollsService(service: PollsService): void {
  pollsService = service;
}

export function setEventBus(eventBus: ModuleEventBus): void {
  moduleEventBus = eventBus;
}

export const interactionCreateEvent: AnyModuleEvent = {
  name: 'interactionCreate',
  once: false,

  async execute(...args: unknown[]): Promise<void> {
    const interaction = args[0] as Interaction;
    if (!pollsService) return;

    // Handle poll buttons
    if (interaction.isButton() && interaction.customId.startsWith('polls:')) {
      await handleButton(interaction, pollsService);
      return;
    }

    // Handle poll select menus
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('polls:')) {
      await handleSelectMenu(interaction, pollsService);
      return;
    }
  },
};

async function handleButton(
  interaction: ButtonInteraction,
  service: PollsService
): Promise<void> {
  const [, action, pollId, optionId] = interaction.customId.split(':');

  if (!action || !pollId) return;

  switch (action) {
    case 'vote':
      if (optionId) {
        await handleVote(interaction, service, pollId, optionId);
      }
      break;

    case 'end':
      await handleEndPoll(interaction, service, pollId);
      break;
  }
}

async function handleSelectMenu(
  interaction: StringSelectMenuInteraction,
  service: PollsService
): Promise<void> {
  const [, action, pollId] = interaction.customId.split(':');

  if (!action || !pollId) return;

  if (action === 'vote_select') {
    const optionId = interaction.values[0];
    if (optionId) {
      await handleVote(interaction, service, pollId, optionId);
    }
  }
}

async function handleVote(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  service: PollsService,
  pollId: string,
  optionId: string
): Promise<void> {
  const poll = await service.getPoll(pollId);

  if (!poll) {
    await interaction.reply({
      content: 'This poll no longer exists.',
      ephemeral: true,
    });
    return;
  }

  if (poll.status !== 'active') {
    await interaction.reply({
      content: 'This poll has ended.',
      ephemeral: true,
    });
    return;
  }

  // Check if poll has expired
  if (poll.ends_at && new Date(poll.ends_at) < new Date()) {
    await service.endPoll(pollId);
    await interaction.reply({
      content: 'This poll has expired.',
      ephemeral: true,
    });
    return;
  }

  // Toggle vote
  const result = await service.toggleVote(pollId, optionId, interaction.user.id);

  if (result === null) {
    await interaction.reply({
      content: 'Failed to register your vote.',
      ephemeral: true,
    });
    return;
  }

  // Get the option label for the response
  const option = await service.getOption(optionId);
  const optionLabel = option?.label || 'Unknown';

  // Update the poll message
  try {
    const options = await service.getPollOptionsWithVotes(pollId);
    const totalVoters = await service.getTotalVotes(pollId);

    const embed = poll.poll_type === 'lab_ownership'
      ? PollsPanel.createLabOwnershipEmbed(poll, options, totalVoters)
      : PollsPanel.createPollEmbed(poll, options, totalVoters);

    const components = PollsPanel.createVoteComponents(poll, options);

    await interaction.update({
      embeds: [embed],
      components,
    });
  } catch (error) {
    logger.error('Failed to update poll message:', error);
    // If we can't update, at least acknowledge the vote
    await interaction.reply({
      content: result.voted
        ? `Your vote for **${optionLabel}** has been recorded.`
        : `Your vote for **${optionLabel}** has been removed.`,
      ephemeral: true,
    });
  }
}

async function handleEndPoll(
  interaction: ButtonInteraction,
  service: PollsService,
  pollId: string
): Promise<void> {
  const poll = await service.getPoll(pollId);

  if (!poll) {
    await interaction.reply({
      content: 'This poll no longer exists.',
      ephemeral: true,
    });
    return;
  }

  if (poll.status !== 'active') {
    await interaction.reply({
      content: 'This poll has already ended.',
      ephemeral: true,
    });
    return;
  }

  // Check if user is creator or has manage messages permission
  const member = interaction.member as GuildMember;
  const isCreator = poll.creator_id === interaction.user.id;
  const hasPermission = member.permissions.has(PermissionFlagsBits.ManageMessages);

  if (!isCreator && !hasPermission) {
    await interaction.reply({
      content: 'Only the poll creator or moderators can end this poll.',
      ephemeral: true,
    });
    return;
  }

  try {
    // End the poll
    await service.endPoll(pollId);

    // Get results
    const options = await service.getPollOptionsWithVotes(pollId);
    const totalVoters = await service.getTotalVotes(pollId);
    const winners = await service.getWinners(pollId);

    const resultsEmbed = PollsPanel.createResultsEmbed(poll, options, totalVoters, winners);

    await interaction.update({
      embeds: [resultsEmbed],
      components: PollsPanel.createDisabledComponents(),
    });

    // If this was a lab ownership poll, emit an event with the winner
    if (poll.poll_type === 'lab_ownership' && winners.length > 0 && poll.context_id && moduleEventBus) {
      const winner = winners[0];
      const winnerId = winner?.value; // The user ID of the winner
      if (winnerId && winner) {
        moduleEventBus.emitAsync(
          MODULE_EVENTS.LAB_OWNERSHIP_DECIDED,
          POLLS_MODULE_ID,
          {
            pollId: poll.id,
            channelId: poll.context_id,
            guildId: poll.guild_id,
            winnerId,
            winnerVotes: winner.vote_count,
            totalVoters,
            isTie: winners.length > 1,
          }
        );
      }
    }

    logger.info(`Poll ${pollId} ended by ${interaction.user.username}`);
  } catch (error) {
    logger.error('Error ending poll:', error);
    await interaction.reply({
      content: 'An error occurred while ending the poll.',
      ephemeral: true,
    });
  }
}
