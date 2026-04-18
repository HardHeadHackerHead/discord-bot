/**
 * Interaction Create Event Handler
 * Handles button and select menu interactions for the inactive users panel
 */

import {
  Interaction,
  ButtonInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import { AnyModuleEvent } from '../../../types/event.types.js';
import { InactiveUsersService, InactiveFilter } from '../services/InactiveUsersService.js';
import { InactiveUsersPanel } from '../components/InactiveUsersPanel.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('InactiveUsers:Events');

let service: InactiveUsersService | null = null;

export function setService(s: InactiveUsersService): void {
  service = s;
}

// Track panel state per message
const panelStates = new Map<string, { filter: InactiveFilter; page: number }>();

function getState(messageId: string): { filter: InactiveFilter; page: number } {
  let state = panelStates.get(messageId);
  if (!state) {
    state = { filter: 'all', page: 0 };
    panelStates.set(messageId, state);
  }
  return state;
}

export const interactionCreateEvent: AnyModuleEvent = {
  name: 'interactionCreate',
  once: false,

  async execute(...args: unknown[]): Promise<void> {
    const interaction = args[0] as Interaction;
    if (!service) return;

    // Handle button interactions
    if (interaction.isButton() && interaction.customId.startsWith('inactive:')) {
      await handleButton(interaction);
    }

    // Handle select menu interactions
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('inactive:')) {
      await handleSelectMenu(interaction);
    }
  },
};

async function handleButton(interaction: ButtonInteraction): Promise<void> {
  if (!service || !interaction.guildId || !interaction.guild) return;

  const parts = interaction.customId.split(':');
  const action = parts[1];
  const state = getState(interaction.message.id);

  try {
    switch (action) {
      case 'refresh': {
        // Refresh the stats overview
        await interaction.deferUpdate();
        const stats = await service.getInactiveStats(interaction.guildId);
        await interaction.editReply({
          embeds: [InactiveUsersPanel.createStatsEmbed(stats)],
          components: InactiveUsersPanel.createStatsComponents(),
        });
        break;
      }

      case 'back': {
        // Go back to stats overview
        await interaction.deferUpdate();
        const stats = await service.getInactiveStats(interaction.guildId);
        state.page = 0;
        await interaction.editReply({
          embeds: [InactiveUsersPanel.createStatsEmbed(stats)],
          components: InactiveUsersPanel.createStatsComponents(),
        });
        break;
      }

      case 'prev': {
        // Previous page
        const filter = parts[2] as InactiveFilter;
        state.filter = filter;
        state.page = Math.max(0, state.page - 1);
        await updateListView(interaction, state);
        break;
      }

      case 'next': {
        // Next page
        const filter = parts[2] as InactiveFilter;
        state.filter = filter;
        state.page += 1;
        await updateListView(interaction, state);
        break;
      }
    }
  } catch (error) {
    logger.error('Error handling button interaction:', error);
    await interaction.reply({
      content: 'An error occurred. Please try again.',
      ephemeral: true,
    }).catch(() => {});
  }
}

async function handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!service || !interaction.guildId || !interaction.guild) return;

  const [, action] = interaction.customId.split(':');
  const state = getState(interaction.message.id);

  try {
    if (action === 'filter') {
      const selectedFilter = interaction.values[0] as InactiveFilter;
      state.filter = selectedFilter;
      state.page = 0;
      await updateListView(interaction, state);
    }
  } catch (error) {
    logger.error('Error handling select menu interaction:', error);
    await interaction.reply({
      content: 'An error occurred. Please try again.',
      ephemeral: true,
    }).catch(() => {});
  }
}

async function updateListView(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  state: { filter: InactiveFilter; page: number }
): Promise<void> {
  if (!service || !interaction.guildId || !interaction.guild) return;

  await interaction.deferUpdate();

  const usersPerPage = InactiveUsersPanel.getUsersPerPage();
  const offset = state.page * usersPerPage;

  const [users, totalCount] = await Promise.all([
    service.getInactiveUsers(interaction.guildId, state.filter, usersPerPage, offset),
    service.getInactiveUserCount(interaction.guildId, state.filter),
  ]);

  const embed = await InactiveUsersPanel.createListEmbed(
    users,
    interaction.guild,
    state.filter,
    state.page,
    totalCount
  );

  await interaction.editReply({
    embeds: [embed],
    components: InactiveUsersPanel.createListComponents(state.page, totalCount, state.filter),
  });
}
