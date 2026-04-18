import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from 'discord.js';
import { Idea, Suggestion, IdeaStatus, SuggestionStatus, AIFeature, ExtractedSuggestion, IDEA_STATUS_INFO } from '../services/IdeasService.js';

const STATUS_COLORS: Record<IdeaStatus, number> = {
  pending: 0x5865F2,     // Blurple
  submitted: 0x5865F2,   // Blurple
  under_review: 0xFEE75C, // Yellow
  approved: 0x57F287,    // Green
  rejected: 0xED4245,    // Red
  in_progress: 0xEB459E, // Pink/Magenta
  implemented: 0x57F287, // Green
};

const STATUS_EMOJIS: Record<IdeaStatus, string> = {
  pending: '📝',
  submitted: '📬',
  under_review: '👀',
  approved: '✅',
  rejected: '❌',
  in_progress: '🔨',
  implemented: '🎉',
};

export class IdeasPanel {
  /**
   * Create the main idea embed
   */
  static createIdeaEmbed(idea: Idea, suggestions?: Suggestion[]): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle(`${STATUS_EMOJIS[idea.status]} ${idea.title}`)
      .setDescription(idea.content.length > 2000 ? idea.content.slice(0, 2000) + '...' : idea.content)
      .setColor(STATUS_COLORS[idea.status])
      .addFields(
        { name: 'Status', value: this.formatStatus(idea.status), inline: true },
        { name: 'Author', value: `<@${idea.author_id}>`, inline: true },
        { name: 'Created', value: `<t:${Math.floor(new Date(idea.created_at).getTime() / 1000)}:R>`, inline: true }
      )
      .setFooter({ text: `ID: ${idea.id.slice(0, 8)}` });

    if (idea.approved_by) {
      embed.addFields({
        name: 'Approved By',
        value: `<@${idea.approved_by}>`,
        inline: true,
      });
    }

    if (idea.implemented_at) {
      embed.addFields({
        name: 'Implemented',
        value: `<t:${Math.floor(new Date(idea.implemented_at).getTime() / 1000)}:R>`,
        inline: true,
      });
    }

    // Add suggestions summary if provided
    if (suggestions && suggestions.length > 0) {
      const incorporated = suggestions.filter(s => s.is_incorporated).length;
      const topSuggestions = suggestions
        .slice(0, 3)
        .map(s => {
          const votes = `\`+${s.upvotes}/-${s.downvotes}\``;
          const inc = s.is_incorporated ? ' ✓' : '';
          const content = s.content.length > 80 ? s.content.slice(0, 80) + '...' : s.content;
          return `${votes} ${content}${inc}`;
        })
        .join('\n');

      embed.addFields({
        name: `Suggestions (${suggestions.length})`,
        value: topSuggestions + (suggestions.length > 3 ? `\n*...and ${suggestions.length - 3} more*` : ''),
        inline: false,
      });

      if (incorporated > 0) {
        embed.addFields({
          name: 'Incorporated',
          value: `${incorporated}/${suggestions.length}`,
          inline: true,
        });
      }
    }

    // Add AI summary if available
    if (idea.ai_summary) {
      const summary = idea.ai_summary.length > 500
        ? idea.ai_summary.slice(0, 500) + '...'
        : idea.ai_summary;
      embed.addFields({
        name: '🤖 AI Summary',
        value: summary,
        inline: false,
      });
    }

    return embed;
  }

  /**
   * Create admin action buttons
   */
  static createAdminButtons(idea: Idea): ActionRowBuilder<ButtonBuilder> {
    const row = new ActionRowBuilder<ButtonBuilder>();

    if (idea.status === 'pending') {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`ideas:approve:${idea.id}`)
          .setLabel('Approve')
          .setEmoji('✅')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`ideas:reject:${idea.id}`)
          .setLabel('Reject')
          .setEmoji('❌')
          .setStyle(ButtonStyle.Danger)
      );
    }

    if (idea.status === 'approved') {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`ideas:implement:${idea.id}`)
          .setLabel('Mark Implemented')
          .setEmoji('🚀')
          .setStyle(ButtonStyle.Primary)
      );
    }

    if (idea.status === 'rejected') {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`ideas:reopen:${idea.id}`)
          .setLabel('Reopen')
          .setEmoji('🔄')
          .setStyle(ButtonStyle.Secondary)
      );
    }

    // Always add link to thread
    row.addComponents(
      new ButtonBuilder()
        .setLabel('Go to Thread')
        .setEmoji('💬')
        .setStyle(ButtonStyle.Link)
        .setURL(`https://discord.com/channels/${idea.guild_id}/${idea.thread_id}`)
    );

    return row;
  }

  /**
   * Create AI feature buttons (shown in thread)
   */
  static createAIButtons(ideaId: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`ideas:ai:summarize:${ideaId}`)
        .setLabel('Summarize')
        .setEmoji('📝')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`ideas:ai:expand:${ideaId}`)
        .setLabel('Expand')
        .setEmoji('💡')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`ideas:ai:issues:${ideaId}`)
        .setLabel('Find Issues')
        .setEmoji('⚠️')
        .setStyle(ButtonStyle.Secondary)
    );
  }

  /**
   * Create extract suggestions button (admin only, shown in thread)
   */
  static createExtractButton(ideaId: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`ideas:extract:start:${ideaId}`)
        .setLabel('Extract Suggestions')
        .setEmoji('🔍')
        .setStyle(ButtonStyle.Primary)
    );
  }

  /**
   * Create AI result embed
   */
  static createAIResultEmbed(
    type: 'summarize' | 'expand' | 'issues',
    content: string,
    ideaTitle: string,
    options?: { cached?: boolean; tokensRemaining?: number; tokensMax?: number }
  ): EmbedBuilder {
    const titles: Record<'summarize' | 'expand' | 'issues', string> = {
      summarize: '📝 AI Summary',
      expand: '💡 Expanded Idea',
      issues: '⚠️ Potential Issues',
    };

    const colors: Record<'summarize' | 'expand' | 'issues', number> = {
      summarize: 0x5865F2,
      expand: 0x57F287,
      issues: 0xFEE75C,
    };

    const embed = new EmbedBuilder()
      .setTitle(titles[type])
      .setDescription(content.length > 4000 ? content.slice(0, 4000) + '...' : content)
      .setColor(colors[type])
      .setTimestamp();

    // Build footer text
    let footerText = `Re: ${ideaTitle}`;
    if (options?.cached) {
      footerText += ' • Cached result';
    }
    if (options?.tokensRemaining !== undefined && options?.tokensMax !== undefined) {
      footerText += ` • Tokens: ${options.tokensRemaining}/${options.tokensMax}`;
    }
    embed.setFooter({ text: footerText });

    return embed;
  }

  /**
   * Create the unified AI analysis embed (placeholder before any analysis)
   */
  static createAIPlaceholderEmbed(ideaId: string, tokensRemaining: number, tokensMax: number): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle('🤖 AI Analysis')
      .setDescription(
        'Click a button below to run AI analysis on this idea.\n\n' +
        '• **Summarize** - Get a concise summary of the idea and discussion\n' +
        '• **Expand** - Have AI elaborate on the idea with implementation details\n' +
        '• **Find Issues** - Identify potential challenges and considerations\n' +
        '• **Extract** - Find actionable suggestions from thread replies'
      )
      .setColor(0x5865F2)
      .setFooter({ text: `Tokens: ${tokensRemaining}/${tokensMax} • ID: ${ideaId.slice(0, 8)}` });
  }

  /**
   * Create processing state embed (shown while AI is working)
   */
  static createAIProcessingEmbed(feature: string, ideaTitle: string): EmbedBuilder {
    const featureLabels: Record<string, string> = {
      summarize: 'Summarizing',
      expand: 'Expanding',
      issues: 'Finding Issues',
      extract: 'Extracting Suggestions',
    };

    return new EmbedBuilder()
      .setTitle('🤖 Processing...')
      .setDescription(
        `**${featureLabels[feature] || feature}**\n\n` +
        'Please wait while AI analyzes the idea and discussion...'
      )
      .setColor(0xFEE75C)
      .setFooter({ text: `Re: ${ideaTitle}` });
  }

  /**
   * Create AI buttons with token display
   */
  static createAIButtonsWithTokens(
    ideaId: string,
    tokensRemaining: number,
    disabled: boolean = false
  ): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`ideas:ai:summarize:${ideaId}`)
        .setLabel('Summarize')
        .setEmoji('📝')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(`ideas:ai:expand:${ideaId}`)
        .setLabel('Expand')
        .setEmoji('💡')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(`ideas:ai:issues:${ideaId}`)
        .setLabel('Find Issues')
        .setEmoji('⚠️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(`ideas:ai:extract:${ideaId}`)
        .setLabel('Extract')
        .setEmoji('🔍')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled)
    );
  }

  /**
   * Create suggestion approval buttons for admins
   */
  static createSuggestionApprovalButtons(suggestionId: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`ideas:suggestion:approve:${suggestionId}`)
        .setLabel('Approve')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`ideas:suggestion:reject:${suggestionId}`)
        .setLabel('Reject')
        .setEmoji('❌')
        .setStyle(ButtonStyle.Danger)
    );
  }

  /**
   * Create pending suggestions embed for admin review
   */
  static createPendingSuggestionsEmbed(
    suggestions: Suggestion[],
    ideaTitle: string
  ): EmbedBuilder {
    if (suggestions.length === 0) {
      return new EmbedBuilder()
        .setTitle('📋 Pending Suggestions')
        .setDescription('No pending suggestions to review.')
        .setColor(0x5865F2)
        .setFooter({ text: `Re: ${ideaTitle}` });
    }

    const suggestionList = suggestions
      .slice(0, 10)
      .map((s, i) => {
        const content = s.content.length > 100 ? s.content.slice(0, 100) + '...' : s.content;
        const votes = `+${s.upvotes}/-${s.downvotes}`;
        return `**${i + 1}.** ${content}\n   └ by <@${s.author_id}> • ${votes}`;
      })
      .join('\n\n');

    return new EmbedBuilder()
      .setTitle('📋 Pending Suggestions')
      .setDescription(suggestionList)
      .setColor(0xFEE75C)
      .setFooter({
        text: suggestions.length > 10
          ? `Showing 10 of ${suggestions.length} pending • Re: ${ideaTitle}`
          : `Re: ${ideaTitle}`,
      });
  }

  /**
   * Create a single suggestion review embed for admin approval
   */
  static createSuggestionReviewEmbed(
    suggestion: Suggestion,
    ideaTitle: string,
    current: number,
    total: number
  ): EmbedBuilder {
    const votes = suggestion.upvotes - suggestion.downvotes;
    const voteText = votes > 0 ? `+${votes}` : votes < 0 ? `${votes}` : '0';

    return new EmbedBuilder()
      .setTitle('📋 Review Suggestion')
      .setDescription(suggestion.content)
      .setColor(0xFEE75C)
      .addFields(
        { name: 'Author', value: `<@${suggestion.author_id}>`, inline: true },
        { name: 'Votes', value: `${voteText} (+${suggestion.upvotes}/-${suggestion.downvotes})`, inline: true },
        { name: 'Progress', value: `${current} of ${total} pending`, inline: true }
      )
      .setFooter({ text: `Re: ${ideaTitle} • ID: ${suggestion.id.slice(0, 8)}` });
  }

  /**
   * Create embed shown after all suggestions are reviewed
   */
  static createAllSuggestionsReviewedEmbed(ideaTitle: string): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle('✅ All Suggestions Reviewed')
      .setDescription(`You've reviewed all pending suggestions for "${ideaTitle}".`)
      .setColor(0x57F287);
  }

  /**
   * Create ideas list embed
   */
  static createListEmbed(
    ideas: Idea[],
    page: number,
    totalPages: number,
    status?: IdeaStatus
  ): EmbedBuilder {
    const statusText = status ? ` (${status})` : '';
    const embed = new EmbedBuilder()
      .setTitle(`💡 Ideas${statusText}`)
      .setColor(0x5865F2)
      .setFooter({ text: `Page ${page + 1}/${totalPages}` });

    if (ideas.length === 0) {
      embed.setDescription('No ideas found.');
      return embed;
    }

    const description = ideas
      .map((idea, i) => {
        const num = page * 10 + i + 1;
        const emoji = STATUS_EMOJIS[idea.status];
        const title = idea.title.length > 50 ? idea.title.slice(0, 50) + '...' : idea.title;
        const time = `<t:${Math.floor(new Date(idea.created_at).getTime() / 1000)}:R>`;
        return `**${num}.** ${emoji} ${title}\n└ by <@${idea.author_id}> • ${time}`;
      })
      .join('\n\n');

    embed.setDescription(description);

    return embed;
  }

  /**
   * Create pagination buttons for list
   */
  static createListButtons(
    page: number,
    totalPages: number,
    status?: IdeaStatus
  ): ActionRowBuilder<ButtonBuilder> {
    const statusParam = status || 'all';
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`ideas:list:first:${statusParam}`)
        .setEmoji('⏮️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId(`ideas:list:prev:${statusParam}:${page}`)
        .setEmoji('◀️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId(`ideas:list:next:${statusParam}:${page}`)
        .setEmoji('▶️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1),
      new ButtonBuilder()
        .setCustomId(`ideas:list:last:${statusParam}:${page}`)
        .setEmoji('⏭️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1)
    );
  }

  /**
   * Create status filter select menu
   */
  static createStatusFilter(currentStatus?: IdeaStatus): ActionRowBuilder<StringSelectMenuBuilder> {
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('ideas:filter:status')
        .setPlaceholder('Filter by status')
        .addOptions(
          {
            label: 'All Ideas',
            value: 'all',
            emoji: '📋',
            default: !currentStatus,
          },
          {
            label: 'Pending',
            value: 'pending',
            emoji: '⏳',
            default: currentStatus === 'pending',
          },
          {
            label: 'Approved',
            value: 'approved',
            emoji: '✅',
            default: currentStatus === 'approved',
          },
          {
            label: 'Rejected',
            value: 'rejected',
            emoji: '❌',
            default: currentStatus === 'rejected',
          },
          {
            label: 'Implemented',
            value: 'implemented',
            emoji: '🚀',
            default: currentStatus === 'implemented',
          }
        )
    );
  }

  /**
   * Create suggestion embed
   */
  static createSuggestionEmbed(suggestion: Suggestion, ideaTitle: string): EmbedBuilder {
    return new EmbedBuilder()
      .setDescription(suggestion.content)
      .setColor(suggestion.is_incorporated ? 0x57F287 : 0x5865F2)
      .addFields(
        { name: 'Votes', value: `+${suggestion.upvotes} / -${suggestion.downvotes}`, inline: true },
        { name: 'Status', value: suggestion.is_incorporated ? '✓ Incorporated' : 'Pending', inline: true }
      )
      .setFooter({ text: `Re: ${ideaTitle}` });
  }

  // ==================== Message 1: Draft ====================
  // Shows the idea content and approved suggestions
  // OP can update draft and finalize

  /**
   * Create Message 1: Draft View
   * Shows the current draft with approved suggestions incorporated
   */
  static createDraftEmbed(
    idea: Idea,
    approvedSuggestions: Suggestion[],
    draftSummary?: string | null
  ): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle('📝 Draft')
      .setColor(0x5865F2);

    // If we have a draft summary from AI, show it
    if (draftSummary) {
      embed.setDescription(draftSummary);
    } else {
      // Show the original idea content
      const content = idea.content.length > 1500
        ? idea.content.slice(0, 1500) + '...'
        : idea.content;
      embed.setDescription(`**${idea.title}**\n\n${content}`);
    }

    // Show approved suggestions count
    if (approvedSuggestions.length > 0) {
      const suggestionList = approvedSuggestions
        .slice(0, 3)
        .map(s => `• ${s.content.length > 50 ? s.content.slice(0, 50) + '...' : s.content}`)
        .join('\n');

      embed.addFields({
        name: `✅ Approved Suggestions (${approvedSuggestions.length})`,
        value: suggestionList + (approvedSuggestions.length > 3 ? `\n*...and ${approvedSuggestions.length - 3} more*` : ''),
        inline: false,
      });
    }

    embed.setFooter({ text: `Idea ID: ${idea.id.slice(0, 8)}` });

    return embed;
  }

  /**
   * Create Message 1 buttons: Finalize & Submit
   * Only OP can use these buttons
   * Note: Update Draft removed - draft regeneration is automatic on suggestion approval
   */
  static createDraftButtons(ideaId: string): ActionRowBuilder<ButtonBuilder>[] {
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];

    const mainRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`ideas:finalize:${ideaId}`)
        .setLabel('Finalize & Submit')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success)
    );
    rows.push(mainRow);

    return rows;
  }

  /**
   * Create confirmation buttons for Finalize & Submit
   * Shows "Yes, Submit" (green) and "No, I'm Not Ready" (red)
   */
  static createFinalizeConfirmButtons(ideaId: string): ActionRowBuilder<ButtonBuilder>[] {
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];

    const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`ideas:finalize:confirm:${ideaId}`)
        .setLabel('Yes, Submit')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`ideas:finalize:cancel:${ideaId}`)
        .setLabel("No, I'm Not Ready")
        .setEmoji('❌')
        .setStyle(ButtonStyle.Danger)
    );
    rows.push(confirmRow);

    return rows;
  }

  /**
   * Create confirmation embed for Finalize & Submit
   */
  static createFinalizeConfirmEmbed(idea: Idea, approvedCount: number): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle('⚠️ Confirm Submission')
      .setDescription(
        `Are you sure you want to finalize and submit **${idea.title}**?\n\n` +
        `**What this means:**\n` +
        `• Your idea will be submitted for official review\n` +
        `• No further suggestions can be added\n` +
        `• The draft cannot be changed after submission\n\n` +
        `**Current Status:**\n` +
        `• ${approvedCount} approved suggestion${approvedCount === 1 ? '' : 's'} incorporated`
      )
      .setColor(0xFEE75C)
      .setFooter({ text: 'This action cannot be undone' });
  }

  /**
   * Create warning embed when trying to submit with active votes
   */
  static createActiveVotesWarningEmbed(idea: Idea, activeVotes: Array<{ content: string; upvotes: number; downvotes: number }>): EmbedBuilder {
    const voteList = activeVotes.map((v, i) => {
      const preview = v.content.length > 50 ? v.content.slice(0, 50) + '...' : v.content;
      return `${i + 1}. "${preview}" (👍 ${v.upvotes} / 👎 ${v.downvotes})`;
    }).join('\n');

    return new EmbedBuilder()
      .setTitle('🗳️ Votes Still In Progress')
      .setDescription(
        `You have **${activeVotes.length}** active vote${activeVotes.length > 1 ? 's' : ''}.\n\n` +
        `**Active votes:**\n${voteList}\n\n` +
        `You can end all votes now to proceed with submission, or go back to finish them manually.`
      )
      .setColor(0xFEE75C)
      .setFooter({ text: idea.title });
  }

  /**
   * Create buttons for active votes warning
   * "End All Votes & Continue" and "Go Back"
   */
  static createActiveVotesWarningButtons(ideaId: string): ActionRowBuilder<ButtonBuilder>[] {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`ideas:finalize:endvotes:${ideaId}`)
        .setLabel('End All Votes & Continue')
        .setEmoji('🛑')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`ideas:finalize:cancel:${ideaId}`)
        .setLabel('Go Back')
        .setEmoji('↩️')
        .setStyle(ButtonStyle.Secondary)
    );
    return [row];
  }

  // ==================== Message 2: Suggestions Panel ====================
  // Passive status display for community suggestions (auto-extracted)

  /**
   * Create Message 2: Suggestion Status (passive display)
   * Shows suggestion stats and encourages discussion
   * If voting is active, shows current vote counts (supports multiple active votes)
   */
  static createSuggestionStatusEmbed(
    idea: Idea,
    approved: number,
    rejected: number,
    pending: number,
    activeVotes?: Array<{ upvotes: number; downvotes: number; content: string }> | null
  ): EmbedBuilder {
    const total = approved + rejected + pending;
    const hasActiveVotes = activeVotes && activeVotes.length > 0;
    const embed = new EmbedBuilder()
      .setTitle('💬 Community Feedback')
      .setColor(hasActiveVotes ? 0xFEE75C : 0x5865F2); // Yellow if voting active

    if (total === 0 && !hasActiveVotes) {
      embed.setDescription(
        '**Share your thoughts below!**\n\n' +
        'Reply to this thread with your suggestions, feedback, or questions about this idea.\n\n' +
        'Actionable suggestions will be automatically detected and the author can approve them to incorporate into the final draft.'
      );
    } else {
      let statusText = '**Suggestion Summary:**\n';
      statusText += `✅ **${approved}** approved\n`;
      statusText += `❌ **${rejected}** rejected\n`;
      statusText += `⏳ **${pending}** pending review\n`;

      if (hasActiveVotes) {
        statusText += `\n---\n🗳️ **${activeVotes.length} Vote${activeVotes.length > 1 ? 's' : ''} in Progress!**\n`;

        // Show up to 3 active votes with previews
        const votesToShow = activeVotes.slice(0, 3);
        votesToShow.forEach((vote, index) => {
          const preview = vote.content.length > 60
            ? vote.content.slice(0, 60) + '...'
            : vote.content;
          statusText += `\n${index + 1}. "${preview}"\n`;
          statusText += `   👍 ${vote.upvotes} / 👎 ${vote.downvotes}\n`;
        });

        if (activeVotes.length > 3) {
          statusText += `\n*...and ${activeVotes.length - 3} more vote${activeVotes.length - 3 > 1 ? 's' : ''}*\n`;
        }

        statusText += `\n*Scroll down in the thread to vote!*`;
      } else if (pending > 0) {
        statusText += `\n*Click **Review** to approve or reject pending suggestions*`;
      }

      embed.setDescription(statusText);
    }

    embed.setFooter({ text: `Idea: ${idea.title.slice(0, 40)}${idea.title.length > 40 ? '...' : ''} • ID: ${idea.id.slice(0, 8)}` });

    return embed;
  }

  /**
   * Create buttons for Message 2 suggestion status panel
   * Shows Review button if there are pending suggestions
   */
  static createSuggestionStatusButtons(
    ideaId: string,
    pendingCount: number
  ): ActionRowBuilder<ButtonBuilder>[] {
    const buttons: ButtonBuilder[] = [];

    // Add Review button if there are pending suggestions
    if (pendingCount > 0) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`ideas:review:${ideaId}`)
          .setLabel(`Review (${pendingCount})`)
          .setEmoji('📋')
          .setStyle(ButtonStyle.Primary)
      );
    }

    if (buttons.length === 0) {
      return []; // No buttons needed
    }

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);
    return [row];
  }

  /**
   * Create Message 2: Suggestions Panel (legacy - for backwards compatibility)
   * @deprecated Use createSuggestionStatusEmbed instead
   */
  static createSuggestionsPanelEmbed(
    ideaId: string,
    totalSuggestions: number,
    pendingSuggestions: number
  ): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle('💬 Community Feedback')
      .setColor(0x5865F2);

    if (totalSuggestions === 0) {
      embed.setDescription(
        '**Share your thoughts below!**\n\n' +
        'Reply to this thread with your suggestions, feedback, or questions about this idea.\n\n' +
        'Actionable suggestions will be automatically detected and the author can approve them to incorporate into the final draft.'
      );
    } else {
      const approved = totalSuggestions - pendingSuggestions;
      embed.setDescription(
        '**Suggestion Summary:**\n' +
        `✅ **${approved}** approved\n` +
        `⏳ **${pendingSuggestions}** pending review\n\n` +
        (pendingSuggestions > 0 ? `*${pendingSuggestions} suggestion${pendingSuggestions === 1 ? '' : 's'} waiting for author review*` : '')
      );
    }

    embed.setFooter({ text: `Idea ID: ${ideaId.slice(0, 8)}` });

    return embed;
  }

  /**
   * Create Message 2 buttons (legacy - no longer used)
   * @deprecated Buttons removed - suggestions are auto-extracted
   */
  static createSuggestionsPanelButtons(ideaId: string, hasSuggestions: boolean): ActionRowBuilder<ButtonBuilder>[] {
    // Return empty array - no buttons needed anymore
    return [];
  }

  // Legacy method names for backwards compatibility
  static createWelcomeEmbed(ideaId: string, hasAI: boolean): EmbedBuilder {
    // Now just returns a simple welcome - draft is shown separately
    return new EmbedBuilder()
      .setTitle('💡 Idea Discussion')
      .setColor(0x5865F2)
      .setDescription(
        'Welcome to this idea discussion!\n\n' +
        '**How it works:**\n' +
        '• Reply with suggestions, questions, or feedback\n' +
        '• The idea author can extract suggestions from replies\n' +
        '• Vote on suggestions when prompted\n' +
        '• The author finalizes the draft when ready'
      )
      .setFooter({ text: `Idea ID: ${ideaId.slice(0, 8)}` });
  }

  static createMessage1Buttons(ideaId: string, disabled: boolean = false): ActionRowBuilder<ButtonBuilder> {
    // Keeping for backwards compatibility but now empty/unused
    return new ActionRowBuilder<ButtonBuilder>();
  }

  /**
   * Create Message 2: Suggestion Browser View
   * OP can scroll through suggestions, approve them, or start a vote
   */
  static createSuggestionBrowserEmbed(
    suggestion: Suggestion,
    currentIndex: number,
    totalCount: number,
    ideaTitle: string,
    votingEnabled: boolean
  ): EmbedBuilder {
    const netVotes = suggestion.upvotes - suggestion.downvotes;
    const voteDisplay = netVotes > 0 ? `+${netVotes}` : `${netVotes}`;

    const statusEmoji = suggestion.status === 'approved' ? '✅ ' :
                        suggestion.status === 'rejected' ? '❌ ' : '';

    const embed = new EmbedBuilder()
      .setTitle(`${statusEmoji}Suggestion ${currentIndex + 1} of ${totalCount}`)
      .setDescription(suggestion.content)
      .setColor(suggestion.status === 'approved' ? 0x57F287 :
                suggestion.status === 'rejected' ? 0xED4245 : 0x5865F2)
      .addFields(
        { name: 'From', value: `<@${suggestion.author_id}>`, inline: true },
        { name: 'Status', value: suggestion.status.charAt(0).toUpperCase() + suggestion.status.slice(1), inline: true },
        { name: 'Votes', value: `${voteDisplay} (👍 ${suggestion.upvotes} / 👎 ${suggestion.downvotes})`, inline: true }
      );

    if (votingEnabled) {
      embed.addFields({
        name: '🗳️ Voting Active',
        value: 'Community members can now vote on this suggestion!',
        inline: false,
      });
    }

    embed.setFooter({ text: `Re: ${ideaTitle}` });

    return embed;
  }

  /**
   * Create Message 2 buttons for Suggestion Browser View
   * OP can navigate, approve, start voting, or go back to draft
   * When voting is active: approve/reject buttons are hidden, only End Vote + voting buttons shown
   */
  static createSuggestionBrowserButtons(
    ideaId: string,
    suggestionId: string,
    currentIndex: number,
    totalCount: number,
    suggestionStatus: string,
    votingEnabled: boolean
  ): ActionRowBuilder<ButtonBuilder>[] {
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    const isApproved = suggestionStatus === 'approved';
    const isRejected = suggestionStatus === 'rejected';

    // Row 1: Navigation + End Vote (if voting) or just navigation
    const navRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`ideas:nav:prev:${ideaId}`)
        .setEmoji('◀️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentIndex <= 0),
      new ButtonBuilder()
        .setCustomId(`ideas:nav:next:${ideaId}`)
        .setEmoji('▶️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentIndex >= totalCount - 1),
      new ButtonBuilder()
        .setCustomId(`ideas:suggestions:${ideaId}`)
        .setLabel('Back')
        .setEmoji('📋')
        .setStyle(ButtonStyle.Secondary)
    );

    // Add End Vote to navigation row if voting is enabled
    if (votingEnabled) {
      navRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`ideas:endvote:${ideaId}:${suggestionId}`)
          .setLabel('End Vote')
          .setEmoji('🛑')
          .setStyle(ButtonStyle.Secondary)
      );
    }
    rows.push(navRow);

    // Row 2: Actions - different based on voting state and suggestion status
    if (votingEnabled) {
      // During voting: show info that vote is active (users vote via announcement in thread)
      // No vote buttons here - they can scroll down to the announcement
    } else if (!isApproved && !isRejected) {
      // Not voting AND suggestion is still pending: show approve/reject/start vote buttons
      const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`ideas:approve:suggestion:${suggestionId}`)
          .setLabel('Approve')
          .setEmoji('✅')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`ideas:reject:suggestion:${suggestionId}`)
          .setLabel('Reject')
          .setEmoji('❌')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`ideas:startvote:${ideaId}:${suggestionId}`)
          .setLabel('Start Vote')
          .setEmoji('🗳️')
          .setStyle(ButtonStyle.Primary)
      );
      rows.push(actionRow);
    }
    // If suggestion is already approved or rejected, don't show action buttons at all

    return rows;
  }

  /**
   * Create embed for voting announcement posted to thread
   */
  static createVoteAnnouncementEmbed(
    suggestion: Suggestion,
    ideaTitle: string,
    threadId: string,
    authorId: string
  ): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle('🗳️ Vote on This Suggestion!')
      .setDescription(
        `**Idea:** ${ideaTitle}\n\n` +
        `**Suggestion:**\n${suggestion.content}`
      )
      .setColor(0x5865F2)
      .addFields(
        { name: 'Suggested by', value: `<@${suggestion.author_id}>`, inline: true },
        { name: 'Current Votes', value: `👍 ${suggestion.upvotes} / 👎 ${suggestion.downvotes}`, inline: true }
      )
      .setFooter({ text: 'Vote using the buttons below!' });
  }

  /**
   * Create voting buttons for the announcement message
   * These are the same vote buttons but attached to the announcement
   */
  static createVoteAnnouncementVoteButtons(suggestionId: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`ideas:vote:yes:${suggestionId}`)
        .setLabel('Vote Yes')
        .setEmoji('👍')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`ideas:vote:no:${suggestionId}`)
        .setLabel('Vote No')
        .setEmoji('👎')
        .setStyle(ButtonStyle.Danger)
    );
  }

  /**
   * Create embed for when voting ends - shows results and next steps
   */
  static createVoteEndedEmbed(
    suggestion: Suggestion,
    ideaTitle: string,
    authorId: string
  ): EmbedBuilder {
    const netVotes = suggestion.upvotes - suggestion.downvotes;
    const voteResult = netVotes > 0 ? '👍 Positive' : netVotes < 0 ? '👎 Negative' : '➖ Neutral';

    return new EmbedBuilder()
      .setTitle('🗳️ Vote Ended')
      .setDescription(
        `**Suggestion:**\n${suggestion.content.length > 300 ? suggestion.content.slice(0, 300) + '...' : suggestion.content}`
      )
      .setColor(netVotes > 0 ? 0x57F287 : netVotes < 0 ? 0xED4245 : 0x5865F2)
      .addFields(
        { name: 'Final Results', value: `👍 ${suggestion.upvotes} / 👎 ${suggestion.downvotes}`, inline: true },
        { name: 'Outcome', value: voteResult, inline: true },
        { name: 'Next Steps', value: `<@${authorId}> can now approve or reject this suggestion based on the community feedback.`, inline: false }
      )
      .setFooter({ text: `Re: ${ideaTitle}` });
  }

  /**
   * Create "Jump to Vote" button for vote announcement
   * Links to Message 2 (draft control panel) where voting buttons are
   */
  static createVoteAnnouncementButtons(
    guildId: string,
    channelId: string,
    messageId: string
  ): ActionRowBuilder<ButtonBuilder> {
    // Discord message link format: https://discord.com/channels/{guildId}/{channelId}/{messageId}
    const messageLink = `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;

    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel('Jump to Vote')
        .setEmoji('🗳️')
        .setStyle(ButtonStyle.Link)
        .setURL(messageLink)
    );
  }

  /**
   * Create embed for Message 2 when the idea has been finalized/submitted
   * Shows current status in the approval workflow
   */
  static createSubmittedSuggestionsPanelEmbed(idea: Idea): EmbedBuilder {
    const statusInfo = IDEA_STATUS_INFO[idea.status] || IDEA_STATUS_INFO.submitted;

    const embed = new EmbedBuilder()
      .setTitle(`${statusInfo.emoji} Status: ${statusInfo.label}`)
      .setColor(statusInfo.color);

    // Build status description
    let description = `**${idea.title}**\n\n`;
    description += `${statusInfo.description}\n\n`;

    // Show workflow progress
    description += '**Progress:**\n';
    const statuses: IdeaStatus[] = ['submitted', 'under_review', 'approved', 'in_progress', 'implemented'];
    const currentIndex = statuses.indexOf(idea.status as IdeaStatus);

    // Handle rejected specially
    if (idea.status === 'rejected') {
      description += statuses.map((s, i) => {
        const info = IDEA_STATUS_INFO[s];
        if (s === 'approved') {
          return `${IDEA_STATUS_INFO.rejected.emoji} ~~${IDEA_STATUS_INFO.rejected.label}~~ (Rejected)`;
        }
        return i < 2 ? `${info.emoji} ~~${info.label}~~` : `⬜ ${info.label}`;
      }).join('\n');
    } else {
      description += statuses.map((s, i) => {
        const info = IDEA_STATUS_INFO[s];
        if (i < currentIndex) {
          return `${info.emoji} ~~${info.label}~~`; // Completed
        } else if (i === currentIndex) {
          return `**${info.emoji} ${info.label}** ◀️`; // Current
        } else {
          return `⬜ ${info.label}`; // Not yet
        }
      }).join('\n');
    }

    // Show who changed the status and when
    if (idea.status_changed_by && idea.status !== 'submitted') {
      description += `\n\n*Last updated by <@${idea.status_changed_by}>*`;
      if (idea.status_changed_at) {
        description += ` <t:${Math.floor(new Date(idea.status_changed_at).getTime() / 1000)}:R>`;
      }
    }

    // Show admin notes if any
    if (idea.admin_notes) {
      description += `\n\n**Notes:** ${idea.admin_notes}`;
    }

    embed.setDescription(description);
    embed.setFooter({ text: `Idea ID: ${idea.id.slice(0, 8)} • Submitted by @${idea.author_id}` });

    return embed;
  }

  /**
   * Create status buttons for Message 2 after submission
   * Progressive workflow - only show next available actions
   * Workflow: submitted -> under_review -> approved/rejected -> in_progress -> implemented
   */
  static createStatusButtons(ideaId: string, currentStatus: IdeaStatus): ActionRowBuilder<ButtonBuilder>[] {
    // Terminal states - no more buttons needed
    if (currentStatus === 'implemented' || currentStatus === 'rejected') {
      return [];
    }

    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    const row = new ActionRowBuilder<ButtonBuilder>();

    // Progressive workflow:
    // submitted: show only under_review (must start review first)
    // under_review: show approved, rejected (decision phase)
    // approved: show in_progress, implemented (implementation phase)
    // in_progress: show implemented (only final step remaining)

    if (currentStatus === 'submitted') {
      // Initial phase: must start review first
      const info = IDEA_STATUS_INFO['under_review'];
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`ideas:status:${ideaId}:under_review`)
          .setLabel(info.label)
          .setEmoji(info.emoji)
          .setStyle(ButtonStyle.Secondary)
      );
    } else if (currentStatus === 'under_review') {
      // Decision phase: can approve or reject (under_review step is complete)
      for (const status of ['approved', 'rejected'] as IdeaStatus[]) {
        const info = IDEA_STATUS_INFO[status];
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`ideas:status:${ideaId}:${status}`)
            .setLabel(info.label)
            .setEmoji(info.emoji)
            .setStyle(ButtonStyle.Secondary)
        );
      }
    } else if (currentStatus === 'approved') {
      // Implementation phase: can start work or mark as implemented
      for (const status of ['in_progress', 'implemented'] as IdeaStatus[]) {
        const info = IDEA_STATUS_INFO[status];
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`ideas:status:${ideaId}:${status}`)
            .setLabel(info.label)
            .setEmoji(info.emoji)
            .setStyle(ButtonStyle.Secondary)
        );
      }
    } else if (currentStatus === 'in_progress') {
      // Final phase: can only mark as implemented
      const info = IDEA_STATUS_INFO['implemented'];
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`ideas:status:${ideaId}:implemented`)
          .setLabel(info.label)
          .setEmoji(info.emoji)
          .setStyle(ButtonStyle.Secondary)
      );
    }

    if (row.components.length > 0) {
      rows.push(row);
    }

    return rows;
  }

  /**
   * Create finalized idea embed
   */
  static createFinalizedEmbed(idea: Idea, suggestions: Suggestion[], draftSummary?: string | null): EmbedBuilder {
    const approvedSuggestions = suggestions.filter(s => s.status === 'approved');

    const embed = new EmbedBuilder()
      .setTitle('✅ Draft Finalized')
      .setColor(0x57F287);

    // Show the final draft content
    if (draftSummary) {
      embed.setDescription(draftSummary);
    } else {
      const content = idea.content.length > 1500
        ? idea.content.slice(0, 1500) + '...'
        : idea.content;
      embed.setDescription(`**${idea.title}**\n\n${content}`);
    }

    embed.addFields(
      { name: 'Author', value: `<@${idea.author_id}>`, inline: true },
      { name: 'Suggestions Incorporated', value: `${approvedSuggestions.length}`, inline: true }
    );

    if (approvedSuggestions.length > 0) {
      const suggestionList = approvedSuggestions
        .slice(0, 5)
        .map((s, i) => `${i + 1}. ${s.content.length > 50 ? s.content.slice(0, 50) + '...' : s.content}`)
        .join('\n');

      embed.addFields({
        name: 'Approved Suggestions',
        value: suggestionList + (approvedSuggestions.length > 5 ? `\n*...and ${approvedSuggestions.length - 5} more*` : ''),
        inline: false,
      });
    }

    embed.setFooter({ text: `Submitted for review • ID: ${idea.id.slice(0, 8)}` });

    return embed;
  }

  /**
   * Create Message 2: No suggestions state (after extraction with no results)
   */
  static createNoSuggestionsEmbed(ideaId: string): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle('📝 Your Draft')
      .setDescription(
        'No suggestions have been extracted yet.\n\n' +
        '**Getting started:**\n' +
        '• Wait for community members to reply with feedback\n' +
        '• Click **Extract New** to find suggestions from replies\n' +
        '• Approve suggestions to add them to your draft\n' +
        '• Click **Update Draft** to generate a summary with approved suggestions'
      )
      .setColor(0x5865F2)
      .setFooter({ text: `Idea ID: ${ideaId.slice(0, 8)}` });
  }

  // Keep old method name for backwards compatibility during transition
  static createMessage2DefaultEmbed(ideaId: string): EmbedBuilder {
    return this.createNoSuggestionsEmbed(ideaId);
  }

  // Keep old method for backwards compatibility
  static createMessage2Buttons(
    ideaId: string,
    hasSuggestions: boolean,
    currentIndex: number,
    totalCount: number
  ): ActionRowBuilder<ButtonBuilder>[] {
    return this.createSuggestionsPanelButtons(ideaId, hasSuggestions);
  }

  /**
   * Format status for display
   */
  private static formatStatus(status: IdeaStatus): string {
    const formatted: Record<IdeaStatus, string> = {
      pending: '📝 Draft',
      submitted: '📬 Submitted',
      under_review: '👀 Under Review',
      approved: '✅ Approved',
      rejected: '❌ Rejected',
      in_progress: '🔨 In Progress',
      implemented: '🎉 Implemented',
    };
    return formatted[status];
  }

  /**
   * Create success embed
   */
  static createSuccessEmbed(title: string, description: string): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor(0x57F287);
  }

  /**
   * Create error embed
   */
  static createErrorEmbed(title: string, description: string): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor(0xED4245);
  }

  /**
   * Create info embed
   */
  static createInfoEmbed(title: string, description: string): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor(0x5865F2);
  }

  /**
   * Create embed for extracted suggestion review
   */
  static createExtractedSuggestionEmbed(
    extracted: ExtractedSuggestion,
    ideaTitle: string,
    current: number,
    total: number
  ): EmbedBuilder {
    const confidenceEmoji: Record<string, string> = {
      high: '🟢',
      medium: '🟡',
      low: '🔴',
    };

    return new EmbedBuilder()
      .setTitle('🔍 Review Extracted Suggestion')
      .setDescription(extracted.content)
      .setColor(0x5865F2)
      .addFields(
        { name: 'From', value: `<@${extracted.authorId}>`, inline: true },
        { name: 'Confidence', value: `${confidenceEmoji[extracted.confidence]} ${extracted.confidence}`, inline: true },
        { name: 'Progress', value: `${current} of ${total}`, inline: true }
      )
      .setFooter({ text: `Re: ${ideaTitle}` });
  }

  /**
   * Create buttons for extracted suggestion approval
   */
  static createExtractedSuggestionButtons(
    ideaId: string,
    extractedIndex: number
  ): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`ideas:extract:approve:${ideaId}:${extractedIndex}`)
        .setLabel('Add as Suggestion')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`ideas:extract:skip:${ideaId}:${extractedIndex}`)
        .setLabel('Skip')
        .setEmoji('⏭️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`ideas:extract:reject:${ideaId}:${extractedIndex}`)
        .setLabel('Reject')
        .setEmoji('❌')
        .setStyle(ButtonStyle.Danger)
    );
  }

  /**
   * Create embed showing extraction results summary
   */
  static createExtractionResultsEmbed(
    ideaTitle: string,
    totalFound: number,
    approved: number,
    skipped: number,
    rejected: number
  ): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle('🔍 Extraction Complete')
      .setDescription(
        `Finished reviewing AI-extracted suggestions for "${ideaTitle}".`
      )
      .setColor(0x57F287)
      .addFields(
        { name: 'Found', value: `${totalFound}`, inline: true },
        { name: 'Added', value: `${approved}`, inline: true },
        { name: 'Skipped', value: `${skipped}`, inline: true },
        { name: 'Rejected', value: `${rejected}`, inline: true }
      );
  }

  /**
   * Create embed when no suggestions were extracted
   */
  static createNoExtractionsEmbed(ideaTitle: string): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle('🔍 No Suggestions Found')
      .setDescription(
        `AI analysis found no new actionable suggestions in the thread replies for "${ideaTitle}".\n\n` +
        'This could mean:\n' +
        '• All suggestions have already been extracted\n' +
        '• The replies don\'t contain specific proposals\n' +
        '• The discussion is mostly questions or comments'
      )
      .setColor(0xFEE75C);
  }

  /**
   * Create extraction in progress embed
   */
  static createExtractionInProgressEmbed(ideaTitle: string): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle('🔍 Extracting Suggestions...')
      .setDescription(
        `AI is analyzing thread replies for "${ideaTitle}" to find actionable suggestions.\n\n` +
        'This may take a moment...'
      )
      .setColor(0x5865F2);
  }

  /**
   * Create embed for a single extracted suggestion posted to thread for voting
   */
  static createExtractedSuggestionVoteEmbed(
    content: string,
    authorId: string,
    confidence: 'high' | 'medium' | 'low'
  ): EmbedBuilder {
    const confidenceEmoji: Record<string, string> = {
      high: '🟢',
      medium: '🟡',
      low: '🔴',
    };

    return new EmbedBuilder()
      .setTitle('💡 Extracted Suggestion')
      .setDescription(content)
      .setColor(0x5865F2)
      .addFields(
        { name: 'From', value: `<@${authorId}>`, inline: true },
        { name: 'Confidence', value: `${confidenceEmoji[confidence]} ${confidence}`, inline: true }
      )
      .setFooter({ text: 'Vote with ✅ or ❌ below' });
  }

  /**
   * Create summary embed after extraction showing what was found
   */
  static createExtractionSummaryEmbed(
    ideaTitle: string,
    count: number
  ): EmbedBuilder {
    if (count === 0) {
      return new EmbedBuilder()
        .setTitle('🔍 Extraction Complete')
        .setDescription(
          `No new actionable suggestions found in the thread replies.\n\n` +
          'This could mean:\n' +
          '• All suggestions have already been extracted\n' +
          '• The replies don\'t contain specific proposals\n' +
          '• The discussion is mostly questions or comments'
        )
        .setColor(0xFEE75C)
        .setFooter({ text: `Re: ${ideaTitle}` });
    }

    return new EmbedBuilder()
      .setTitle('🔍 Extraction Complete')
      .setDescription(
        `Found **${count}** actionable suggestion${count === 1 ? '' : 's'}!\n\n` +
        'Each suggestion has been posted above with vote reactions.\n' +
        'Vote ✅ to support or ❌ to oppose each suggestion.'
      )
      .setColor(0x57F287)
      .setFooter({ text: `Re: ${ideaTitle}` });
  }
}
