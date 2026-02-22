import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { COLORS, progressBar } from '../../../shared/utils/embed.js';
import { Poll, PollOptionWithVotes } from '../services/PollsService.js';

/**
 * UI components for the Polls module
 */
export class PollsPanel {
  // ==================== Poll Embeds ====================

  /**
   * Create the main poll embed
   */
  static createPollEmbed(
    poll: Poll,
    options: PollOptionWithVotes[],
    totalVoters: number
  ): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle(`📊 ${poll.title}`)
      .setColor(poll.status === 'active' ? COLORS.primary : COLORS.neutral);

    if (poll.description) {
      embed.setDescription(poll.description);
    }

    // Build options display
    const maxVotes = Math.max(...options.map(o => o.vote_count), 1);
    const optionLines: string[] = [];

    for (const opt of options) {
      const percentage = totalVoters > 0
        ? Math.round((opt.vote_count / totalVoters) * 100)
        : 0;
      const bar = progressBar(opt.vote_count, maxVotes, 10, '🟦', '⬜');

      let line = '';
      if (opt.emoji) {
        line += `${opt.emoji} `;
      }
      line += `**${opt.label}**\n`;
      line += `${bar} ${opt.vote_count} vote${opt.vote_count !== 1 ? 's' : ''} (${percentage}%)`;

      // Show voters if not anonymous
      if (!poll.anonymous && opt.voters.length > 0 && opt.voters.length <= 5) {
        const voterMentions = opt.voters.map(v => `<@${v}>`).join(', ');
        line += `\n└ ${voterMentions}`;
      } else if (!poll.anonymous && opt.voters.length > 5) {
        line += `\n└ ${opt.voters.length} voters`;
      }

      optionLines.push(line);
    }

    embed.addFields({
      name: 'Options',
      value: optionLines.join('\n\n') || 'No options',
    });

    // Footer with status
    let footerText = `Total: ${totalVoters} voter${totalVoters !== 1 ? 's' : ''}`;

    if (poll.status === 'active' && poll.ends_at) {
      const endsAt = new Date(poll.ends_at);
      footerText += ` • Ends <t:${Math.floor(endsAt.getTime() / 1000)}:R>`;
    } else if (poll.status === 'ended') {
      footerText += ' • Poll ended';
    } else if (poll.status === 'cancelled') {
      footerText += ' • Poll cancelled';
    }

    if (poll.allow_multiple) {
      footerText += ' • Multiple votes allowed';
    }

    embed.setFooter({ text: footerText });

    return embed;
  }

  /**
   * Create poll results embed (shown when poll ends)
   */
  static createResultsEmbed(
    poll: Poll,
    options: PollOptionWithVotes[],
    totalVoters: number,
    winners: PollOptionWithVotes[]
  ): EmbedBuilder {
    const embed = this.createPollEmbed(poll, options, totalVoters);

    embed.setTitle(`📊 ${poll.title} - Results`);
    embed.setColor(COLORS.success);

    if (winners.length > 0) {
      const winnerLabels = winners.map(w => {
        let label = '';
        if (w.emoji) label += `${w.emoji} `;
        label += w.label;
        return label;
      }).join(', ');

      embed.addFields({
        name: '🏆 Winner',
        value: winners.length === 1
          ? winnerLabels
          : `Tie: ${winnerLabels}`,
      });
    } else {
      embed.addFields({
        name: 'Result',
        value: 'No votes were cast',
      });
    }

    return embed;
  }

  /**
   * Create lab ownership poll embed
   */
  static createLabOwnershipEmbed(
    poll: Poll,
    options: PollOptionWithVotes[],
    totalVoters: number
  ): EmbedBuilder {
    const embed = this.createPollEmbed(poll, options, totalVoters);

    embed.setTitle('🧪 Lab Ownership Vote');
    embed.setColor(0x9B59B6); // Purple for lab ownership

    return embed;
  }

  // ==================== Vote Components ====================

  /**
   * Create vote buttons for a poll
   */
  static createVoteComponents(
    poll: Poll,
    options: PollOptionWithVotes[]
  ): ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] {
    const components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];

    if (poll.status !== 'active') {
      // Poll is not active, don't show vote buttons
      return components;
    }

    // If 5 or fewer options, use buttons
    if (options.length <= 5) {
      const buttonRow = new ActionRowBuilder<ButtonBuilder>();

      for (const opt of options) {
        const button = new ButtonBuilder()
          .setCustomId(`polls:vote:${poll.id}:${opt.id}`)
          .setLabel(opt.label)
          .setStyle(ButtonStyle.Primary);

        if (opt.emoji) {
          button.setEmoji(opt.emoji);
        }

        buttonRow.addComponents(button);
      }

      components.push(buttonRow);
    } else {
      // More than 5 options, use select menu
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`polls:vote_select:${poll.id}`)
        .setPlaceholder('Select an option to vote...')
        .addOptions(
          options.map(opt => {
            const option = new StringSelectMenuOptionBuilder()
              .setLabel(opt.label)
              .setValue(opt.id);

            if (opt.description) {
              option.setDescription(opt.description);
            }
            if (opt.emoji) {
              option.setEmoji(opt.emoji);
            }

            return option;
          })
        );

      components.push(
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu)
      );
    }

    // Add end poll button for creator/admins
    const controlRow = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`polls:end:${poll.id}`)
          .setLabel('End Poll')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🛑')
      );

    components.push(controlRow);

    return components;
  }

  /**
   * Create disabled components (for ended polls)
   */
  static createDisabledComponents(): ActionRowBuilder<ButtonBuilder>[] {
    return [
      new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('polls:ended')
            .setLabel('Poll Ended')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true)
        ),
    ];
  }

  // ==================== Admin Panel ====================

  /**
   * Create poll creation modal
   */
  static createPollModal(): ModalBuilder {
    const modal = new ModalBuilder()
      .setCustomId('polls:modal_create')
      .setTitle('Create a Poll');

    const titleInput = new TextInputBuilder()
      .setCustomId('polls:input_title')
      .setLabel('Poll Title')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('What do you want to ask?')
      .setRequired(true)
      .setMaxLength(255);

    const descriptionInput = new TextInputBuilder()
      .setCustomId('polls:input_description')
      .setLabel('Description (optional)')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Add more context...')
      .setRequired(false)
      .setMaxLength(1000);

    const optionsInput = new TextInputBuilder()
      .setCustomId('polls:input_options')
      .setLabel('Options (one per line)')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Option 1\nOption 2\nOption 3')
      .setRequired(true)
      .setMaxLength(1000);

    const durationInput = new TextInputBuilder()
      .setCustomId('polls:input_duration')
      .setLabel('Duration in minutes (0 = no limit)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('60')
      .setRequired(false)
      .setMaxLength(10);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(optionsInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(durationInput)
    );

    return modal;
  }

  // ==================== Result Embeds ====================

  /**
   * Create a success embed
   */
  static createSuccessEmbed(title: string, description: string): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle(`✅ ${title}`)
      .setDescription(description)
      .setColor(COLORS.success);
  }

  /**
   * Create an error embed
   */
  static createErrorEmbed(title: string, description: string): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle(`❌ ${title}`)
      .setDescription(description)
      .setColor(COLORS.error);
  }

  /**
   * Create an info embed
   */
  static createInfoEmbed(title: string, description: string): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle(`ℹ️ ${title}`)
      .setDescription(description)
      .setColor(COLORS.info);
  }
}
