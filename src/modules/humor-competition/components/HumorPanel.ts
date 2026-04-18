import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { COLORS } from '../../../shared/utils/embed.js';
import { Submission, LeaderboardEntry } from '../services/HumorCompetitionService.js';

export class HumorPanel {
  // ==================== Competition Embeds ====================

  static createWaitingPanel(submissionCount: number): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle('🎨 Daily Humor Competition')
      .setDescription(
        "Welcome to today's humor competition!\n\n" +
        '**Waiting for a Humor Manager to post the source image...**\n\n' +
        'Once the source picture is posted, everyone can submit their AI-generated funny images!'
      )
      .addFields({ name: '📝 Submissions', value: `${submissionCount}`, inline: true })
      .setColor(0xFFD700);
  }

  static createActivePanel(
    submissionCount: number,
    sourceImageUrl: string | null
  ): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle('🎨 Daily Humor Competition')
      .setDescription(
        "Today's source image has been posted! Create something **hilarious** from it using AI.\n\n" +
        '**How to play:**\n' +
        '1. Post your AI-generated funny image in this thread\n' +
        '2. The bot will add 👍 and 👎 reactions to your post\n' +
        '3. Everyone reacts with 👍 on their favorites\n' +
        '4. Most 👍 at the end wins **King of Humor**!'
      )
      .addFields({ name: '📝 Submissions', value: `${submissionCount}`, inline: true })
      .setColor(0xFFD700);

    if (sourceImageUrl) {
      embed.setThumbnail(sourceImageUrl);
    }

    return embed;
  }

  static createSourceImageEmbed(imageUrl: string, postedBy: string, avatarUrl: string | null): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle("📸 Today's Source Image")
      .setDescription(
        `Posted by <@${postedBy}>\n\n` +
        'Create something hilarious from this picture using AI and post it below!'
      )
      .setImage(imageUrl)
      .setColor(0xFFD700);

    if (avatarUrl) {
      embed.setThumbnail(avatarUrl);
    }

    return embed;
  }

  /**
   * Announcement embed posted to the general channel when a new competition starts.
   */
  static createGeneralAnnouncement(
    imageUrl: string,
    threadId: string,
    postedBy: string,
    avatarUrl: string | null
  ): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle('🎨 Daily Humor Competition is Live!')
      .setDescription(
        `<@${postedBy}> posted today's source image!\n\n` +
        `Create something hilarious from this picture using AI and submit it in the competition thread.\n\n` +
        `**[Join the competition!](https://discord.com/channels/0/${threadId})**`
      )
      .setImage(imageUrl)
      .setColor(0xFFD700);

    if (avatarUrl) {
      embed.setThumbnail(avatarUrl);
    }

    return embed;
  }

  static createWinnerEmbed(
    winner: Submission,
    totalSubmissions: number
  ): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle('👑 King of Humor!')
      .setDescription(
        `Congratulations <@${winner.user_id}>!\n\n` +
        `They won today's humor competition with **${winner.vote_count} vote${winner.vote_count !== 1 ? 's' : ''}** ` +
        `out of ${totalSubmissions} submission${totalSubmissions !== 1 ? 's' : ''}.`
      )
      .setImage(winner.image_url)
      .setColor(0xFFD700)
      .setTimestamp();
  }

  /**
   * Winner announcement posted to the general/announce channel.
   */
  static createWinnerAnnouncement(
    winner: Submission,
    totalSubmissions: number,
    threadId: string
  ): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle('👑 New King of Humor!')
      .setDescription(
        `<@${winner.user_id}> won today's humor competition with **${winner.vote_count} vote${winner.vote_count !== 1 ? 's' : ''}** ` +
        `out of ${totalSubmissions} submission${totalSubmissions !== 1 ? 's' : ''}!\n\n` +
        `**[See the competition](https://discord.com/channels/0/${threadId})**`
      )
      .setImage(winner.image_url)
      .setColor(0xFFD700)
      .setTimestamp();
  }

  static createTieBreakerEmbed(tied: Submission[]): EmbedBuilder {
    const names = tied.map(s => `<@${s.user_id}> (👍 ${s.vote_count})`).join('\n');
    return new EmbedBuilder()
      .setTitle('🤝 Tie!')
      .setDescription(
        `These submissions are tied! A **Humor Manager** must pick the winner.\n\n${names}`
      )
      .setColor(0xFFD700);
  }

  static createNoWinnerEmbed(reason: string): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle('🎨 Competition Ended')
      .setDescription(`Today's humor competition has ended.\n\n${reason}`)
      .setColor(COLORS.neutral)
      .setTimestamp();
  }

  static createStatusEmbed(
    submissions: Submission[],
    sourceImageUrl: string | null
  ): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle('🎨 Competition Status')
      .setColor(0xFFD700);

    if (sourceImageUrl) {
      embed.setThumbnail(sourceImageUrl);
    }

    embed.addFields(
      { name: 'Submissions', value: `${submissions.length}`, inline: true }
    );

    if (submissions.length > 0) {
      const top = submissions.slice(0, 5);
      const topList = top.map((s, i) =>
        `${i + 1}. <@${s.user_id}> - 👍 ${s.vote_count}`
      ).join('\n');
      embed.addFields({ name: 'Top Submissions', value: topList });
    }

    return embed;
  }

  static createLeaderboardEmbed(
    entries: LeaderboardEntry[],
    page: number,
    totalEntries: number
  ): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle('👑 King of Humor - Leaderboard')
      .setColor(0xFFD700);

    if (entries.length === 0) {
      embed.setDescription('No winners yet! Be the first to claim the crown.');
      return embed;
    }

    const startRank = page * 10 + 1;
    const medals = ['🥇', '🥈', '🥉'];

    const lines = entries.map((entry, i) => {
      const rank = startRank + i;
      const medal = rank <= 3 ? medals[rank - 1] : `**${rank}.**`;
      return `${medal} <@${entry.user_id}> - ${entry.wins} win${entry.wins !== 1 ? 's' : ''} (${entry.total_votes} total votes)`;
    });

    embed.setDescription(lines.join('\n'));

    const totalPages = Math.ceil(totalEntries / 10);
    if (totalPages > 1) {
      embed.setFooter({ text: `Page ${page + 1} of ${totalPages}` });
    }

    return embed;
  }

  // ==================== Components ====================

  static createManagementButtons(threadId: string): ActionRowBuilder<ButtonBuilder>[] {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`humor:end:${threadId}`)
          .setLabel('End Competition')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🏁'),
        new ButtonBuilder()
          .setCustomId(`humor:cancel:${threadId}`)
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('✖'),
        new ButtonBuilder()
          .setCustomId(`humor:status:${threadId}`)
          .setLabel('Status')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('📊'),
        new ButtonBuilder()
          .setCustomId(`humor:leaderboard:${threadId}`)
          .setLabel('Leaderboard')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('👑'),
      ),
    ];
  }

  static createTieBreakerSelect(
    threadId: string,
    tied: Submission[],
    displayNames: Map<string, string>
  ): ActionRowBuilder<StringSelectMenuBuilder>[] {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`humor:tiebreak:${threadId}`)
      .setPlaceholder('Pick the winner...')
      .addOptions(
        tied.map(s =>
          new StringSelectMenuOptionBuilder()
            .setLabel(displayNames.get(s.user_id) ?? 'Unknown User')
            .setDescription(`👍 ${s.vote_count} votes`)
            .setValue(s.id)
        )
      );

    return [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu),
    ];
  }

  static createLeaderboardButtons(page: number, totalPages: number): ActionRowBuilder<ButtonBuilder>[] {
    if (totalPages <= 1) return [];

    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`humor:lb_prev:${page}`)
          .setLabel('Previous')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page === 0),
        new ButtonBuilder()
          .setCustomId(`humor:lb_next:${page}`)
          .setLabel('Next')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page >= totalPages - 1),
      ),
    ];
  }

  static createDisabledButtons(): ActionRowBuilder<ButtonBuilder>[] {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('humor:ended')
          .setLabel('Competition Ended')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
      ),
    ];
  }

  // ==================== Utility Embeds ====================

  static createSuccessEmbed(title: string, description: string): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle(`✅ ${title}`)
      .setDescription(description)
      .setColor(COLORS.success);
  }

  static createErrorEmbed(title: string, description: string): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle(`❌ ${title}`)
      .setDescription(description)
      .setColor(COLORS.error);
  }

  static createInfoEmbed(title: string, description: string): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle(`ℹ️ ${title}`)
      .setDescription(description)
      .setColor(COLORS.info);
  }
}
