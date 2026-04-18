/**
 * Inactive Users Panel
 * UI components for displaying inactive user lists
 */

import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  Guild,
} from 'discord.js';
import { COLORS } from '../../../shared/utils/embed.js';
import { InactiveUser, InactiveFilter } from '../services/InactiveUsersService.js';

const USERS_PER_PAGE = 15;

export interface InactiveUsersPanelState {
  filter: InactiveFilter;
  page: number;
}

export class InactiveUsersPanel {
  // ==================== Embeds ====================

  static createStatsEmbed(stats: {
    totalMembers: number;
    noActivity: number;
    noMessages: number;
    noVoice: number;
  }): EmbedBuilder {
    const activePercent = stats.totalMembers > 0
      ? (((stats.totalMembers - stats.noActivity) / stats.totalMembers) * 100).toFixed(1)
      : '0';

    return new EmbedBuilder()
      .setTitle('Inactive Users Overview')
      .setDescription('View members who have not participated in chat or voice.')
      .setColor(COLORS.primary)
      .addFields(
        {
          name: 'Total Members',
          value: stats.totalMembers.toLocaleString(),
          inline: true,
        },
        {
          name: 'Active Rate',
          value: `${activePercent}%`,
          inline: true,
        },
        {
          name: '\u200B',
          value: '\u200B',
          inline: true,
        },
        {
          name: 'No Activity (chat + voice)',
          value: `${stats.noActivity.toLocaleString()} members`,
          inline: true,
        },
        {
          name: 'No Messages',
          value: `${stats.noMessages.toLocaleString()} members`,
          inline: true,
        },
        {
          name: 'No Voice Time',
          value: `${stats.noVoice.toLocaleString()} members`,
          inline: true,
        }
      )
      .setFooter({ text: 'Select a filter below to view the list' });
  }

  static async createListEmbed(
    users: InactiveUser[],
    guild: Guild,
    filter: InactiveFilter,
    page: number,
    totalCount: number
  ): Promise<EmbedBuilder> {
    const totalPages = Math.max(1, Math.ceil(totalCount / USERS_PER_PAGE));
    const filterLabels: Record<InactiveFilter, string> = {
      all: 'No Activity (chat + voice)',
      no_messages: 'No Messages',
      no_voice: 'No Voice Time',
    };

    const embed = new EmbedBuilder()
      .setTitle(`Inactive Users - ${filterLabels[filter]}`)
      .setColor(COLORS.warning)
      .setFooter({
        text: `Page ${page + 1}/${totalPages} | ${totalCount.toLocaleString()} total inactive users`,
      });

    if (users.length === 0) {
      embed.setDescription('No inactive users found with this filter.');
      return embed;
    }

    // Build user list with mentions and join dates
    const lines: string[] = [];
    for (const user of users) {
      const joinDate = user.joined_at
        ? `<t:${Math.floor(new Date(user.joined_at).getTime() / 1000)}:R>`
        : 'Unknown';

      // Format based on filter
      let stats = '';
      if (filter === 'all') {
        stats = '(no messages, no voice)';
      } else if (filter === 'no_messages') {
        const voiceTime = this.formatDuration(user.voice_seconds);
        stats = user.voice_seconds > 0 ? `(${voiceTime} voice)` : '(no voice)';
      } else {
        stats = user.message_count > 0
          ? `(${user.message_count.toLocaleString()} msgs)`
          : '(no messages)';
      }

      lines.push(`<@${user.user_id}> - Joined ${joinDate} ${stats}`);
    }

    embed.setDescription(lines.join('\n'));
    return embed;
  }

  // ==================== Components ====================

  static createStatsComponents(): ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] {
    const components: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [];

    // Filter select menu
    const filterSelect = new StringSelectMenuBuilder()
      .setCustomId('inactive:filter')
      .setPlaceholder('Select a filter to view inactive users...')
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel('No Activity (chat + voice)')
          .setDescription('Users with zero messages AND zero voice time')
          .setValue('all')
          .setEmoji('👻'),
        new StringSelectMenuOptionBuilder()
          .setLabel('No Messages')
          .setDescription('Users who have never sent a message')
          .setValue('no_messages')
          .setEmoji('💬'),
        new StringSelectMenuOptionBuilder()
          .setLabel('No Voice Time')
          .setDescription('Users who have never joined voice')
          .setValue('no_voice')
          .setEmoji('🔇')
      );

    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(filterSelect)
    );

    // Refresh button
    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('inactive:refresh')
        .setLabel('Refresh Stats')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🔄')
    );

    components.push(buttons);

    return components;
  }

  static createListComponents(
    page: number,
    totalCount: number,
    filter: InactiveFilter
  ): ActionRowBuilder<ButtonBuilder>[] {
    const totalPages = Math.max(1, Math.ceil(totalCount / USERS_PER_PAGE));
    const components: ActionRowBuilder<ButtonBuilder>[] = [];

    // Navigation and action buttons
    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('inactive:back')
        .setLabel('Back to Overview')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('◀'),
      new ButtonBuilder()
        .setCustomId(`inactive:prev:${filter}`)
        .setLabel('Previous')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId(`inactive:page:${filter}`)
        .setLabel(`${page + 1}/${totalPages}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`inactive:next:${filter}`)
        .setLabel('Next')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(page >= totalPages - 1)
    );

    components.push(buttons);

    return components;
  }

  // ==================== Helper Methods ====================

  static formatDuration(seconds: number): string {
    if (seconds === 0) return '0m';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }

  static getUsersPerPage(): number {
    return USERS_PER_PAGE;
  }
}
