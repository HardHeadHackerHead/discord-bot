import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  ComponentType,
  ButtonInteraction,
} from 'discord.js';
import { defineSlashCommand } from '../../../types/command.types.js';
import { createEmbed, COLORS, errorEmbed } from '../../../shared/utils/embed.js';
import {
  getLeaderboardRegistry,
  RegisteredLeaderboard,
} from '../../../core/leaderboards/LeaderboardRegistry.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('Leaderboard:Command');

const PAGE_SIZE = 10;

export const command = defineSlashCommand(
  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('View server leaderboards')
    .addStringOption((opt) =>
      opt
        .setName('type')
        .setDescription('Type of leaderboard to view')
        .setRequired(false)
        .setAutocomplete(true)
    ) as SlashCommandBuilder,

  async (interaction: ChatInputCommandInteraction) => {
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({
        embeds: [errorEmbed('Error', 'This command can only be used in a server')],
        ephemeral: true,
      });
      return;
    }

    const registry = getLeaderboardRegistry();
    const leaderboards = registry.getAll();

    if (leaderboards.length === 0) {
      await interaction.reply({
        embeds: [errorEmbed('No Leaderboards', 'No leaderboards are currently available.')],
        ephemeral: true,
      });
      return;
    }

    // Get requested type or default to first leaderboard
    // We know leaderboards[0] exists because we checked length > 0 above
    const defaultLeaderboard = leaderboards[0]!;
    const requestedType = interaction.options.getString('type');
    let currentLeaderboard: RegisteredLeaderboard = requestedType
      ? (registry.get(requestedType) ?? defaultLeaderboard)
      : defaultLeaderboard;

    let page = 0;

    const buildEmbed = async (leaderboard: RegisteredLeaderboard, currentPage: number) => {
      const totalUsers = await leaderboard.provider.getTotalUsers(guildId);
      const totalPages = Math.max(1, Math.ceil(totalUsers / PAGE_SIZE));

      const entries = await leaderboard.provider.getEntries(
        guildId,
        PAGE_SIZE,
        currentPage * PAGE_SIZE
      );

      const embed = createEmbed(COLORS.primary)
        .setTitle(`${leaderboard.emoji} ${leaderboard.name} Leaderboard`)
        .setFooter({
          text: `Page ${currentPage + 1} of ${totalPages} • ${totalUsers} users`,
        });

      if (entries.length === 0) {
        embed.setDescription('No users on the leaderboard yet.');
        return { embed, totalPages };
      }

      const lines = await Promise.all(
        entries.map(async (entry, index) => {
          const rank = currentPage * PAGE_SIZE + index + 1;
          const medal =
            rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `**${rank}.**`;

          // Try to get username
          let username = 'Unknown User';
          try {
            const user = await interaction.client.users.fetch(entry.userId);
            username = user.displayName;
          } catch {
            // User not found
          }

          const formattedValue = leaderboard.formatValue(entry.value);
          const secondaryText =
            entry.secondaryValue !== undefined && leaderboard.formatSecondaryValue
              ? ` (${leaderboard.formatSecondaryValue(entry.secondaryValue)})`
              : '';
          return `${medal} ${username} — ${formattedValue}${secondaryText}`;
        })
      );

      embed.setDescription(lines.join('\n'));

      // Add requester's rank
      const userRankInfo = await leaderboard.provider.getUserRank(
        interaction.user.id,
        guildId
      );

      if (userRankInfo) {
        const formattedValue = leaderboard.formatValue(userRankInfo.value);
        const secondaryText =
          userRankInfo.secondaryValue !== undefined && leaderboard.formatSecondaryValue
            ? ` (${leaderboard.formatSecondaryValue(userRankInfo.secondaryValue)})`
            : '';
        embed.addFields({
          name: 'Your Rank',
          value: `#${userRankInfo.rank} with ${formattedValue}${secondaryText}`,
        });
      }

      return { embed, totalPages };
    };

    const buildSelectMenu = (selectedId: string, disabled: boolean = false) => {
      const options = registry.getForSelectMenu().map((lb) => ({
        label: lb.name,
        value: lb.id,
        description: lb.description.substring(0, 100),
        emoji: lb.emoji,
        default: lb.id === selectedId,
      }));

      return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('leaderboard:select')
          .setPlaceholder('Select a leaderboard')
          .addOptions(options)
          .setDisabled(disabled)
      );
    };

    const buildPaginationButtons = (
      currentPage: number,
      totalPages: number,
      disabled: boolean = false
    ) => {
      return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('leaderboard:first')
          .setEmoji('⏮️')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled || currentPage === 0),
        new ButtonBuilder()
          .setCustomId('leaderboard:prev')
          .setEmoji('◀️')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled || currentPage === 0),
        new ButtonBuilder()
          .setCustomId('leaderboard:next')
          .setEmoji('▶️')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled || currentPage >= totalPages - 1),
        new ButtonBuilder()
          .setCustomId('leaderboard:last')
          .setEmoji('⏭️')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled || currentPage >= totalPages - 1)
      );
    };

    const { embed, totalPages } = await buildEmbed(currentLeaderboard, page);

    const components: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [];

    // Add select menu if there are multiple leaderboards
    if (leaderboards.length > 1) {
      components.push(buildSelectMenu(currentLeaderboard.id));
    }

    // Add pagination buttons if there are multiple pages
    if (totalPages > 1) {
      components.push(buildPaginationButtons(page, totalPages));
    }

    const response = await interaction.reply({
      embeds: [embed],
      components,
      fetchReply: true,
    });

    // No interaction collection needed if single page and single leaderboard
    if (totalPages <= 1 && leaderboards.length <= 1) return;

    // Handle interactions
    const collector = response.createMessageComponentCollector({
      filter: (i) => i.user.id === interaction.user.id,
      time: 120000, // 2 minutes
    });

    collector.on('collect', async (componentInteraction) => {
      try {
        if (componentInteraction.isStringSelectMenu()) {
          // Handle leaderboard selection
          const selectInteraction = componentInteraction as StringSelectMenuInteraction;
          const selectedId = selectInteraction.values[0];
          if (!selectedId) return;
          const newLeaderboard = registry.get(selectedId);

          if (newLeaderboard) {
            currentLeaderboard = newLeaderboard;
            page = 0; // Reset to first page

            const { embed: newEmbed, totalPages: newTotalPages } = await buildEmbed(
              currentLeaderboard,
              page
            );

            const newComponents: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [];
            if (leaderboards.length > 1) {
              newComponents.push(buildSelectMenu(currentLeaderboard.id));
            }
            if (newTotalPages > 1) {
              newComponents.push(buildPaginationButtons(page, newTotalPages));
            }

            await selectInteraction.update({
              embeds: [newEmbed],
              components: newComponents,
            });
          }
        } else if (componentInteraction.isButton()) {
          // Handle pagination
          const buttonInteraction = componentInteraction as ButtonInteraction;
          const action = buttonInteraction.customId.split(':')[1];

          const { totalPages: currentTotalPages } = await buildEmbed(currentLeaderboard, page);

          switch (action) {
            case 'first':
              page = 0;
              break;
            case 'prev':
              page = Math.max(0, page - 1);
              break;
            case 'next':
              page = Math.min(currentTotalPages - 1, page + 1);
              break;
            case 'last':
              page = currentTotalPages - 1;
              break;
          }

          const { embed: newEmbed, totalPages: newTotalPages } = await buildEmbed(
            currentLeaderboard,
            page
          );

          const newComponents: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [];
          if (leaderboards.length > 1) {
            newComponents.push(buildSelectMenu(currentLeaderboard.id));
          }
          if (newTotalPages > 1) {
            newComponents.push(buildPaginationButtons(page, newTotalPages));
          }

          await buttonInteraction.update({
            embeds: [newEmbed],
            components: newComponents,
          });
        }
      } catch (error) {
        logger.error('Error handling leaderboard interaction:', error);
      }
    });

    collector.on('end', async () => {
      try {
        const { embed: finalEmbed, totalPages: finalTotalPages } = await buildEmbed(
          currentLeaderboard,
          page
        );

        const disabledComponents: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [];
        if (leaderboards.length > 1) {
          disabledComponents.push(buildSelectMenu(currentLeaderboard.id, true));
        }
        if (finalTotalPages > 1) {
          disabledComponents.push(buildPaginationButtons(page, finalTotalPages, true));
        }

        await interaction.editReply({
          embeds: [finalEmbed],
          components: disabledComponents,
        });
      } catch {
        // Message might have been deleted
      }
    });
  },
  {
    guildOnly: true,
    autocomplete: async (interaction) => {
      const focusedValue = interaction.options.getFocused().toLowerCase();
      const registry = getLeaderboardRegistry();

      const choices = registry.getForSelectMenu()
        .filter((lb) => lb.name.toLowerCase().includes(focusedValue))
        .slice(0, 25)
        .map((lb) => ({
          name: `${lb.emoji} ${lb.name}`,
          value: lb.id,
        }));

      await interaction.respond(choices);
    },
  }
);
