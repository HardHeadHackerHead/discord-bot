import {
  Interaction,
  ButtonInteraction,
  StringSelectMenuInteraction,
  GuildMember,
  PermissionFlagsBits,
  Message,
  TextChannel,
  ThreadChannel,
} from 'discord.js';
import { defineEvent } from '../../../types/event.types.js';
import { getIdeasService, IdeaStatus, AIFeature, VOTE_REACTIONS, Idea, IDEA_STATUS_INFO } from '../services/IdeasService.js';
import { IdeasPanel } from '../components/IdeasPanel.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('Ideas:Interaction');

const ITEMS_PER_PAGE = 10;
const AUTO_RESET_DELAY = 5 * 60 * 1000; // 5 minutes in milliseconds
const BROWSER_RESET_DELAY = 60 * 1000; // 1 minute for browser view auto-reset
const EPHEMERAL_DELETE_DELAY = 15 * 1000; // 15 seconds for ephemeral message auto-delete

// Track pending AI requests to prevent spam
const pendingAIRequests = new Set<string>();

// Track auto-reset timers for Message 1
const autoResetTimers = new Map<string, NodeJS.Timeout>();

// Track auto-reset timers for Message 2 (browser view)
const browserResetTimers = new Map<string, NodeJS.Timeout>();

/**
 * Helper to delete a message after a delay
 */
function deleteMessageAfterDelay(message: Message, delayMs: number): void {
  setTimeout(async () => {
    try {
      await message.delete();
    } catch (error) {
      // Message may already be deleted or we don't have permissions
      logger.debug('Could not delete message:', error);
    }
  }, delayMs);
}

/**
 * Reset the browser view timer - cancels existing and sets up new auto-reset
 * When the timer fires, Message 2 returns to the status panel
 */
function resetBrowserTimer(
  ideaId: string,
  client: Interaction['client']
): void {
  // Cancel existing timer if any
  const existingTimer = browserResetTimers.get(ideaId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  logger.debug(`Setting browser reset timer for idea ${ideaId} (${BROWSER_RESET_DELAY / 1000}s)`);

  // Set up new auto-reset timer
  const timer = setTimeout(async () => {
    browserResetTimers.delete(ideaId);
    logger.info(`Browser reset timer fired for idea ${ideaId} - attempting to reset Message 2`);

    // Get fresh service reference
    const service = getIdeasService();
    if (!service) {
      logger.warn('Service not available for browser reset');
      return;
    }

    let idea;
    try {
      idea = await service.getIdea(ideaId);
      logger.info(`Fetched idea for browser reset: ${idea ? 'found' : 'not found'}`);
    } catch (err) {
      logger.error(`Failed to fetch idea ${ideaId} for browser reset:`, err);
      return;
    }

    if (!idea) {
      logger.info(`Skipping browser reset - idea ${ideaId} not found`);
      return;
    }

    logger.info(`Idea state: is_finalized=${idea.is_finalized}, voting_suggestion_id=${idea.voting_suggestion_id}`);

    if (idea.is_finalized) {
      logger.info(`Skipping browser reset - idea ${ideaId} is finalized`);
      return;
    }

    let botMessageId2;
    try {
      botMessageId2 = await service.getBotMessageId2(ideaId);
      logger.info(`Got Message 2 ID for browser reset: ${botMessageId2 || 'null'}`);
    } catch (err) {
      logger.error(`Failed to get Message 2 ID for idea ${ideaId}:`, err);
      return;
    }

    if (!botMessageId2) {
      logger.warn(`No Message 2 ID for idea ${ideaId} - cannot reset`);
      return;
    }

    let thread;
    try {
      logger.info(`Fetching thread ${idea.thread_id} for browser reset`);
      thread = await client.channels.fetch(idea.thread_id);
      logger.info(`Fetched thread: ${thread ? 'found' : 'not found'}, isThread: ${thread?.isThread()}`);
    } catch (err) {
      logger.error(`Failed to fetch thread ${idea.thread_id}:`, err);
      return;
    }

    if (!thread?.isThread()) {
      logger.warn(`Could not fetch thread for idea ${ideaId}`);
      return;
    }

    let message2;
    try {
      logger.info(`Fetching Message 2 (${botMessageId2}) for browser reset`);
      message2 = await (thread as ThreadChannel).messages.fetch(botMessageId2);
      logger.info(`Fetched Message 2: ${message2 ? 'found' : 'not found'}`);
    } catch (err) {
      logger.error(`Failed to fetch Message 2 (${botMessageId2}):`, err);
      return;
    }

    if (!message2) {
      logger.warn(`Could not fetch Message 2 for idea ${ideaId}`);
      return;
    }

    try {
      // Return to status panel
      const allSuggestions = await service.getSuggestionsForIdea(ideaId);
      const approved = allSuggestions.filter(s => s.status === 'approved').length;
      const rejected = allSuggestions.filter(s => s.status === 'rejected').length;
      const pending = allSuggestions.filter(s => s.status === 'pending').length;

      // Check for active votes to show in the status panel
      const activeVoteSuggestions = await service.getActiveVotesForIdea(ideaId);
      const activeVotes = activeVoteSuggestions.map(s => ({
        upvotes: s.upvotes,
        downvotes: s.downvotes,
        content: s.content,
      }));

      logger.info(`Resetting Message 2 to status panel: ${approved} approved, ${rejected} rejected, ${pending} pending, activeVotes=${activeVotes.length}`);

      const embed = IdeasPanel.createSuggestionStatusEmbed(idea, approved, rejected, pending, activeVotes.length > 0 ? activeVotes : null);
      const buttons = IdeasPanel.createSuggestionStatusButtons(ideaId, pending);

      logger.info(`Calling message2.edit() now...`);
      await message2.edit({
        embeds: [embed],
        components: buttons,
      });

      logger.info(`Successfully auto-reset Message 2 browser for idea ${ideaId}`);
    } catch (error) {
      logger.error(`Failed to edit Message 2 for idea ${ideaId}:`, error);
    }
  }, BROWSER_RESET_DELAY);

  browserResetTimers.set(ideaId, timer);
}

/**
 * Cancel the browser reset timer (call when user interacts with browser)
 */
function cancelBrowserTimer(ideaId: string): void {
  const timer = browserResetTimers.get(ideaId);
  if (timer) {
    clearTimeout(timer);
    browserResetTimers.delete(ideaId);
  }
}

/**
 * Check if user is an admin (has Manage Messages permission)
 */
function isAdmin(member: GuildMember): boolean {
  return member.permissions.has(PermissionFlagsBits.ManageMessages);
}

/**
 * Check if user is the idea author (OP) or an admin
 */
function isOPOrAdmin(member: GuildMember, idea: Idea): boolean {
  return member.id === idea.author_id || isAdmin(member);
}

export const interactionCreateEvent = defineEvent(
  'interactionCreate',
  async (interaction: Interaction) => {
    const service = getIdeasService();
    if (!service) return;

    // Handle button interactions
    if (interaction.isButton() && interaction.customId.startsWith('ideas:')) {
      await handleButton(interaction, service);
      return;
    }

    // Handle select menu interactions
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('ideas:')) {
      await handleSelectMenu(interaction, service);
      return;
    }
  }
);

/**
 * Handle button interactions
 */
async function handleButton(
  interaction: ButtonInteraction,
  service: ReturnType<typeof getIdeasService>
): Promise<void> {
  if (!service) return;

  const [, action, ...params] = interaction.customId.split(':');

  switch (action) {
    // Admin status buttons (from /ideas view command)
    case 'approve':
      if (params[0] === 'suggestion' && params[1]) {
        // ideas:approve:suggestion:<suggestionId> - OP approving a suggestion
        await handleApproveSuggestion(interaction, service, params[1]);
      } else if (params[0]) {
        // ideas:approve:<ideaId> - Admin approving an idea
        await handleStatusButton(interaction, service, action, params[0]);
      }
      break;

    case 'reject':
      if (params[0] === 'suggestion' && params[1]) {
        // ideas:reject:suggestion:<suggestionId> - OP rejecting a suggestion
        await handleRejectSuggestion(interaction, service, params[1]);
      } else if (params[0]) {
        // ideas:reject:<ideaId> - Admin rejecting an idea
        await handleStatusButton(interaction, service, action, params[0]);
      }
      break;

    case 'implement':
    case 'reopen':
      if (params[0]) {
        await handleStatusButton(interaction, service, action, params[0]);
      }
      break;

    // AI buttons (Message 1)
    case 'ai':
      if (params[0] && params[1]) {
        await handleAIButton(interaction, service, params[0] as AIFeature, params[1]);
      }
      break;

    // Legacy suggestion admin buttons
    case 'suggestion':
      if (params[0] && params[1]) {
        await handleSuggestionButton(interaction, service, params[0], params[1]);
      }
      break;

    // Draft Control Panel buttons (Message 2)
    case 'browse':
      // ideas:browse:<ideaId> - Open suggestion browser (legacy)
      if (params[0]) {
        await handleReviewSuggestions(interaction, service, params[0]);
      }
      break;

    case 'review':
      // ideas:review:<ideaId> - Review pending suggestions
      if (params[0]) {
        await handleReviewSuggestions(interaction, service, params[0]);
      }
      break;

    case 'nav':
      // ideas:nav:prev:<ideaId> or ideas:nav:next:<ideaId>
      if (params[0] && params[1]) {
        await handleNavigation(interaction, service, params[0] as 'prev' | 'next', params[1]);
      }
      break;

    case 'draft':
      // ideas:draft:<ideaId> - Back to draft view (legacy, now unused)
      if (params[0]) {
        await handleBackToDraft(interaction, service, params[0]);
      }
      break;

    case 'suggestions':
      // ideas:suggestions:<ideaId> - Back to suggestions panel
      if (params[0]) {
        await handleBackToSuggestions(interaction, service, params[0]);
      }
      break;

    case 'extract':
      // ideas:extract:<ideaId>
      if (params[0]) {
        await handleExtractButton(interaction, service, params[0]);
      }
      break;

    case 'updatedraft':
      // ideas:updatedraft:<ideaId>
      if (params[0]) {
        await handleUpdateDraft(interaction, service, params[0]);
      }
      break;

    case 'startvote':
      // ideas:startvote:<ideaId>:<suggestionId>
      if (params[0] && params[1]) {
        await handleStartVote(interaction, service, params[0], params[1]);
      }
      break;

    case 'endvote':
      // ideas:endvote:<ideaId>:<suggestionId>
      if (params[0] && params[1]) {
        await handleEndVote(interaction, service, params[0], params[1]);
      }
      break;

    case 'vote':
      // ideas:vote:yes:<suggestionId> or ideas:vote:no:<suggestionId>
      if (params[0] && params[1]) {
        await handleVoteButton(interaction, service, params[0], params[1]);
      }
      break;

    case 'finalize':
      // ideas:finalize:<ideaId> - initial click shows confirmation
      // ideas:finalize:confirm:<ideaId> - confirms submission
      // ideas:finalize:cancel:<ideaId> - cancels and returns to draft
      // ideas:finalize:endvotes:<ideaId> - ends all votes and proceeds to confirmation
      if (params[0] === 'confirm' && params[1]) {
        await handleFinalizeConfirm(interaction, service, params[1]);
      } else if (params[0] === 'cancel' && params[1]) {
        await handleFinalizeCancel(interaction, service, params[1]);
      } else if (params[0] === 'endvotes' && params[1]) {
        await handleFinalizeEndVotes(interaction, service, params[1]);
      } else if (params[0]) {
        await handleFinalizeButton(interaction, service, params[0]);
      }
      break;

    case 'status':
      // ideas:status:<ideaId>:<newStatus>
      if (params[0] && params[1]) {
        await handleStatusChange(interaction, service, params[0], params[1] as IdeaStatus);
      }
      break;

    case 'list':
      await handleListButton(interaction, service, params);
      break;
  }
}

/**
 * Handle suggestion approval/rejection buttons
 */
async function handleSuggestionButton(
  interaction: ButtonInteraction,
  service: NonNullable<ReturnType<typeof getIdeasService>>,
  action: string,
  suggestionId: string
): Promise<void> {
  const member = interaction.member as GuildMember;
  if (!isAdmin(member)) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed(
        'Permission Denied',
        'You need the **Manage Messages** permission to approve or reject suggestions.'
      )],
      ephemeral: true,
    });
    return;
  }

  const suggestion = await service.getSuggestion(suggestionId);
  if (!suggestion) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed('Not Found', 'This suggestion no longer exists.')],
      ephemeral: true,
    });
    return;
  }

  // Get the idea for context
  const idea = await service.getIdea(suggestion.idea_id);
  if (!idea) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed('Not Found', 'The idea for this suggestion no longer exists.')],
      ephemeral: true,
    });
    return;
  }

  await interaction.deferUpdate();

  try {
    if (action === 'approve') {
      await service.approveSuggestion(suggestionId, interaction.user.id);
    } else if (action === 'reject') {
      await service.rejectSuggestion(suggestionId, interaction.user.id);
    }

    logger.info(`Suggestion ${suggestionId} ${action}ed by ${interaction.user.username}`);

    // Get remaining pending suggestions for this idea
    const remainingSuggestions = await service.getPendingSuggestionsForIdea(idea.id);

    if (remainingSuggestions.length === 0) {
      // All done - show completion message
      await interaction.editReply({
        embeds: [IdeasPanel.createAllSuggestionsReviewedEmbed(idea.title)],
        components: [],
      });
    } else {
      // Show the next pending suggestion
      const nextSuggestion = remainingSuggestions[0]!;
      const totalRemaining = remainingSuggestions.length;
      const embed = IdeasPanel.createSuggestionReviewEmbed(
        nextSuggestion,
        idea.title,
        1,
        totalRemaining
      );
      const buttons = IdeasPanel.createSuggestionApprovalButtons(nextSuggestion.id);

      await interaction.editReply({
        embeds: [embed],
        components: [buttons],
      });
    }
  } catch (error) {
    logger.error(`Failed to ${action} suggestion ${suggestionId}:`, error);
    await interaction.followUp({
      embeds: [IdeasPanel.createErrorEmbed(
        'Error',
        `Failed to ${action} suggestion. Please try again.`
      )],
      ephemeral: true,
    });
  }
}

/**
 * Handle status change buttons (approve, reject, implement, reopen)
 */
async function handleStatusButton(
  interaction: ButtonInteraction,
  service: NonNullable<ReturnType<typeof getIdeasService>>,
  action: string,
  ideaId: string
): Promise<void> {
  // Check admin permission
  const member = interaction.member as GuildMember;
  if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed(
        'Permission Denied',
        'You need the **Manage Messages** permission to change idea status.'
      )],
      ephemeral: true,
    });
    return;
  }

  const idea = await service.getIdea(ideaId);
  if (!idea) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed('Not Found', 'This idea no longer exists.')],
      ephemeral: true,
    });
    return;
  }

  await interaction.deferUpdate();

  // Map action to status
  const statusMap: Record<string, IdeaStatus> = {
    approve: 'approved',
    reject: 'rejected',
    implement: 'implemented',
    reopen: 'pending',
  };
  const newStatus = statusMap[action];
  if (!newStatus) return;

  // Update status
  const updatedIdea = await service.updateStatus(idea.id, newStatus, interaction.user.id);

  // Lock/unlock thread based on status
  if (newStatus === 'approved' || newStatus === 'rejected' || newStatus === 'implemented') {
    await service.lockThread(interaction.client, idea.thread_id);
  } else if (newStatus === 'pending') {
    await service.unlockThread(interaction.client, idea.thread_id);
  }

  // Send notification to the thread
  try {
    const thread = await interaction.client.channels.fetch(idea.thread_id);
    if (thread?.isThread()) {
      const statusMessages: Record<IdeaStatus, string> = {
        pending: '📝 This idea has been **reopened** for discussion.',
        submitted: '📬 This idea has been **submitted** for review.',
        under_review: '👀 This idea is now **under review**.',
        approved: '✅ This idea has been **approved**! The thread is now locked.',
        rejected: '❌ This idea has been **rejected**. The thread is now locked.',
        in_progress: '🔨 This idea is now **in progress**!',
        implemented: '🎉 This idea has been **implemented**! The thread is now locked.',
      };

      await thread.send({
        embeds: [IdeasPanel.createInfoEmbed(
          'Status Updated',
          `${statusMessages[newStatus]}\n\nUpdated by <@${interaction.user.id}>`
        )],
      });
    }
  } catch (error) {
    logger.warn('Could not send status update to thread:', error);
  }

  // Update the message with new buttons
  const suggestions = await service.getSuggestionsForIdea(idea.id);
  const embed = IdeasPanel.createIdeaEmbed(updatedIdea!, suggestions);
  const adminButtons = IdeasPanel.createAdminButtons(updatedIdea!);

  await interaction.editReply({
    embeds: [embed],
    components: [adminButtons],
  });

  logger.info(`Idea ${idea.id} status changed to ${newStatus} by ${interaction.user.username}`);
}

/**
 * Handle status change for finalized/submitted ideas (Message 2)
 * Admins can update the approval workflow status
 */
async function handleStatusChange(
  interaction: ButtonInteraction,
  service: NonNullable<ReturnType<typeof getIdeasService>>,
  ideaId: string,
  newStatus: IdeaStatus
): Promise<void> {
  // Check admin permission
  const member = interaction.member as GuildMember;
  if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed(
        'Permission Denied',
        'You need the **Manage Messages** permission to change idea status.'
      )],
      ephemeral: true,
    });
    return;
  }

  const idea = await service.getIdea(ideaId);
  if (!idea) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed('Not Found', 'This idea no longer exists.')],
      ephemeral: true,
    });
    return;
  }

  // Make sure the idea is finalized before allowing status changes
  if (!idea.is_finalized) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed('Not Submitted', 'This idea has not been submitted yet.')],
      ephemeral: true,
    });
    return;
  }

  await interaction.deferUpdate();

  // Update the status
  const updatedIdea = await service.setIdeaStatus(ideaId, newStatus, interaction.user.id);
  if (!updatedIdea) {
    logger.error(`Failed to update status for idea ${ideaId}`);
    return;
  }

  // Send notification to the thread
  const threadLink = `https://discord.com/channels/${idea.guild_id}/${idea.thread_id}`;
  try {
    const thread = await interaction.client.channels.fetch(idea.thread_id);
    if (thread?.isThread()) {
      const statusMessages: Record<IdeaStatus, string> = {
        pending: '📝 This idea has been **reopened** for discussion.',
        submitted: '📬 This idea has been **submitted** for review.',
        under_review: '👀 This idea is now **under review**.',
        approved: '✅ This idea has been **approved** for implementation!',
        rejected: '❌ This idea has been **rejected**.',
        in_progress: '🔨 This idea is now **in progress**!',
        implemented: '🎉 This idea has been **implemented**!',
      };

      await (thread as ThreadChannel).send({
        embeds: [IdeasPanel.createInfoEmbed(
          'Status Updated',
          `${statusMessages[newStatus]}\n\nUpdated by <@${interaction.user.id}>`
        )],
      });
    }
  } catch (error) {
    logger.warn('Could not send status update to thread:', error);
  }

  // Send DM to the OP about the status change
  try {
    const author = await interaction.client.users.fetch(idea.author_id);
    if (author) {
      const statusMessages: Record<IdeaStatus, string> = {
        pending: 'Your idea has been **reopened** for discussion.',
        submitted: 'Your idea has been **submitted** for review.',
        under_review: 'Your idea is now **under review**.',
        approved: 'Your idea has been **approved** for implementation!',
        rejected: 'Your idea has been **rejected**.',
        in_progress: 'Your idea is now **in progress**!',
        implemented: 'Your idea has been **implemented**!',
      };

      const dmEmbed = IdeasPanel.createInfoEmbed(
        `${IDEA_STATUS_INFO[newStatus].emoji} Status Update: ${idea.title}`,
        `${statusMessages[newStatus]}\n\nUpdated by <@${interaction.user.id}>\n\n[View Idea](${threadLink})`
      );
      await author.send({ embeds: [dmEmbed] });
      logger.debug(`Sent status update DM to ${idea.author_id} for idea ${idea.id}`);
    }
  } catch (error) {
    logger.debug('Could not send status update DM to OP:', error);
  }

  // Update Message 2 with the new status panel
  const embed = IdeasPanel.createSubmittedSuggestionsPanelEmbed(updatedIdea);
  const buttons = IdeasPanel.createStatusButtons(ideaId, newStatus);

  await interaction.editReply({
    embeds: [embed],
    components: buttons,
  });

  logger.info(`Idea ${idea.id} status changed to ${newStatus} by ${interaction.user.username}`);
}

/**
 * Handle AI feature buttons (Message 1)
 * Only OP and admins can use these buttons
 */
async function handleAIButton(
  interaction: ButtonInteraction,
  service: NonNullable<ReturnType<typeof getIdeasService>>,
  feature: AIFeature,
  ideaId: string
): Promise<void> {
  const idea = await service.getIdea(ideaId);
  if (!idea) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed('Not Found', 'This idea no longer exists.')],
      ephemeral: true,
    });
    return;
  }

  const member = interaction.member as GuildMember;

  // Check if user is OP or admin - only they can use AI buttons
  if (!isOPOrAdmin(member, idea)) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed(
        'Permission Denied',
        'Only the idea author or admins can use AI analysis features.'
      )],
      ephemeral: true,
    });
    return;
  }

  // Check if AI is available
  if (!service.hasAIProvider()) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed(
        'AI Unavailable',
        'No AI provider is configured. Please contact an administrator.'
      )],
      ephemeral: true,
    });
    return;
  }

  // Check if already processing
  const requestKey = `${idea.id}:${feature}`;
  if (pendingAIRequests.has(requestKey)) {
    await interaction.reply({
      embeds: [IdeasPanel.createInfoEmbed(
        'Please Wait',
        'This AI request is already being processed.'
      )],
      ephemeral: true,
    });
    return;
  }

  const userIsAdmin = isAdmin(member);

  // Check tokens (admins are exempt, cached results don't consume tokens)
  const tokens = await service.getTokensRemaining(ideaId);
  const cachedResult = service.getCachedResult(idea, feature);

  // If not cached, not admin, and no tokens available
  if (!cachedResult && !userIsAdmin && tokens.remaining <= 0) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed(
        'No Tokens Available',
        `This idea has used all ${tokens.max} daily AI tokens. Tokens reset daily.\n\n` +
        'Admins can still use AI features without consuming tokens.'
      )],
      ephemeral: true,
    });
    return;
  }

  pendingAIRequests.add(requestKey);

  // Defer update since we're editing the same message
  await interaction.deferUpdate();

  try {
    // Cancel any existing auto-reset timer for this idea
    const existingTimer = autoResetTimers.get(idea.id);
    if (existingTimer) {
      clearTimeout(existingTimer);
      autoResetTimers.delete(idea.id);
    }

    // Show processing state immediately (no buttons)
    const processingEmbed = IdeasPanel.createAIProcessingEmbed(feature, idea.title);
    await interaction.editReply({
      embeds: [processingEmbed],
      components: [], // Remove buttons while processing
    });

    // Run the AI feature
    let result: { text: string; cached: boolean };
    switch (feature) {
      case 'summarize':
        result = await service.summarizeIdea(idea.id, interaction.client);
        break;
      case 'expand':
        result = await service.expandIdea(idea.id);
        break;
      case 'issues':
        result = await service.findIssues(idea.id);
        break;
      default:
        throw new Error(`Unknown AI feature: ${feature}`);
    }

    // Use a token if this wasn't cached and user isn't admin
    let newTokensRemaining = tokens.remaining;
    if (!result.cached && !userIsAdmin) {
      await service.useToken(ideaId);
      newTokensRemaining = tokens.remaining - 1;
    }

    // Update Message 1 with the result
    const resultEmbed = IdeasPanel.createAIResultEmbed(feature, result.text, idea.title, {
      cached: result.cached,
      tokensRemaining: newTokensRemaining,
      tokensMax: tokens.max,
    });

    const aiButtons = IdeasPanel.createMessage1Buttons(idea.id);

    await interaction.editReply({
      embeds: [resultEmbed],
      components: [aiButtons],
    });

    logger.info(`AI ${feature} completed for idea "${idea.title}" (cached: ${result.cached})`);

    // Set up auto-reset timer to restore welcome message after 5 minutes
    const resetTimer = setTimeout(async () => {
      try {
        autoResetTimers.delete(idea.id);

        // Get the Message 1 and restore welcome embed
        const botMessageId = await service.getBotMessageId(idea.id);
        if (!botMessageId) return;

        const thread = await interaction.client.channels.fetch(idea.thread_id);
        if (!thread?.isThread()) return;

        const message = await (thread as ThreadChannel).messages.fetch(botMessageId);
        if (!message) return;

        const welcomeEmbed = IdeasPanel.createWelcomeEmbed(idea.id, true);
        const buttons = IdeasPanel.createMessage1Buttons(idea.id);

        await message.edit({
          embeds: [welcomeEmbed],
          components: [buttons],
        });

        logger.debug(`Auto-reset Message 1 for idea ${idea.id}`);
      } catch (error) {
        logger.warn(`Failed to auto-reset Message 1 for idea ${idea.id}:`, error);
      }
    }, AUTO_RESET_DELAY);

    autoResetTimers.set(idea.id, resetTimer);

  } catch (error) {
    logger.error(`AI ${feature} failed for idea ${idea.id}:`, error);

    // Restore the welcome embed on error
    const welcomeEmbed = IdeasPanel.createWelcomeEmbed(idea.id, true);
    const aiButtons = IdeasPanel.createMessage1Buttons(idea.id);

    await interaction.editReply({
      embeds: [welcomeEmbed],
      components: [aiButtons],
    });

    // Send error as ephemeral followup
    await interaction.followUp({
      embeds: [IdeasPanel.createErrorEmbed(
        'AI Error',
        `Failed to run ${feature}. Please try again later.`
      )],
      ephemeral: true,
    });
  } finally {
    pendingAIRequests.delete(requestKey);
  }
}

/**
 * Handle Extract button (Message 2)
 * Only OP and admins can extract suggestions
 */
async function handleExtractButton(
  interaction: ButtonInteraction,
  service: NonNullable<ReturnType<typeof getIdeasService>>,
  ideaId: string
): Promise<void> {
  const idea = await service.getIdea(ideaId);
  if (!idea) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed('Not Found', 'This idea no longer exists.')],
      ephemeral: true,
    });
    return;
  }

  const member = interaction.member as GuildMember;

  // Check if user is OP or admin
  if (!isOPOrAdmin(member, idea)) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed(
        'Permission Denied',
        'Only the idea author or admins can extract suggestions.'
      )],
      ephemeral: true,
    });
    return;
  }

  // Check if AI is available
  if (!service.hasAIProvider()) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed(
        'AI Unavailable',
        'No AI provider is configured. Please contact an administrator.'
      )],
      ephemeral: true,
    });
    return;
  }

  // Check if already processing
  const requestKey = `${idea.id}:extract`;
  if (pendingAIRequests.has(requestKey)) {
    await interaction.reply({
      embeds: [IdeasPanel.createInfoEmbed(
        'Please Wait',
        'Extraction is already in progress.'
      )],
      ephemeral: true,
    });
    return;
  }

  pendingAIRequests.add(requestKey);
  await interaction.deferUpdate();

  try {
    // Show processing state on Message 2
    const processingEmbed = IdeasPanel.createExtractionInProgressEmbed(idea.title);
    await interaction.editReply({
      embeds: [processingEmbed],
      components: [], // Remove buttons while processing
    });

    // Extract suggestions using AI
    const extracted = await service.extractSuggestions(idea.id, interaction.client);

    // Save each extracted suggestion to database
    for (const suggestion of extracted) {
      await service.createSuggestionFromExtracted(idea.id, suggestion);
    }

    // Get all suggestions for this idea
    const allSuggestions = await service.getSuggestionsForIdea(idea.id);
    const approved = allSuggestions.filter(s => s.status === 'approved').length;
    const rejected = allSuggestions.filter(s => s.status === 'rejected').length;
    const pending = allSuggestions.filter(s => s.status === 'pending').length;

    // After extraction, return to status panel with updated counts
    const statusEmbed = IdeasPanel.createSuggestionStatusEmbed(idea, approved, rejected, pending);
    const statusButtons = IdeasPanel.createSuggestionStatusButtons(idea.id, pending);

    await interaction.editReply({
      embeds: [statusEmbed],
      components: statusButtons,
    });

    logger.info(`Extracted ${extracted.length} new suggestions for idea "${idea.title}", total: ${allSuggestions.length}`);

  } catch (error) {
    logger.error('Extraction failed:', error);

    // Restore status panel on error
    const allSuggestions = await service.getSuggestionsForIdea(idea.id);
    const approved = allSuggestions.filter(s => s.status === 'approved').length;
    const rejected = allSuggestions.filter(s => s.status === 'rejected').length;
    const pending = allSuggestions.filter(s => s.status === 'pending').length;

    await interaction.editReply({
      embeds: [IdeasPanel.createSuggestionStatusEmbed(idea, approved, rejected, pending)],
      components: IdeasPanel.createSuggestionStatusButtons(idea.id, pending),
    });

    await interaction.followUp({
      embeds: [IdeasPanel.createErrorEmbed(
        'Extraction Failed',
        'Failed to extract suggestions. Please try again later.'
      )],
      ephemeral: true,
    });
  } finally {
    pendingAIRequests.delete(requestKey);
  }
}

/**
 * Handle vote buttons (Vote Yes / Vote No)
 * Everyone can vote when voting is enabled
 * Button format: ideas:vote:yes:<suggestionId> or ideas:vote:no:<suggestionId>
 * Can be clicked from Message 2 (browser) or from the announcement message
 */
async function handleVoteButton(
  interaction: ButtonInteraction,
  service: NonNullable<ReturnType<typeof getIdeasService>>,
  voteType: string,
  suggestionId: string
): Promise<void> {
  const suggestion = await service.getSuggestion(suggestionId);
  if (!suggestion) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed('Not Found', 'This suggestion no longer exists.')],
      ephemeral: true,
    });
    return;
  }

  const idea = await service.getIdea(suggestion.idea_id);
  if (!idea) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed('Not Found', 'The idea no longer exists.')],
      ephemeral: true,
    });
    return;
  }

  // Check if voting is enabled for this suggestion
  if (!suggestion.is_voting_active) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed('Voting Closed', 'Voting is not currently enabled for this suggestion.')],
      ephemeral: true,
    });
    return;
  }

  await interaction.deferUpdate();

  try {
    // Record the vote
    const dbVoteType = voteType === 'yes' ? 'up' : 'down';
    const result = await service.vote(suggestionId, interaction.user.id, dbVoteType);

    // Refetch to get updated vote counts
    const updatedSuggestion = await service.getSuggestion(suggestionId);
    if (!updatedSuggestion) return;

    // Check if we're voting from the announcement or from Message 2
    const announcementMsgId = updatedSuggestion.vote_announcement_message_id;
    const botMessageId2 = await service.getBotMessageId2(idea.id);
    const isFromAnnouncement = interaction.message.id === announcementMsgId;

    // Update the message that was interacted with
    if (isFromAnnouncement) {
      // Update announcement message with new vote counts
      const announceEmbed = IdeasPanel.createVoteAnnouncementEmbed(updatedSuggestion, idea.title, idea.thread_id, idea.author_id);
      const voteButtons = IdeasPanel.createVoteAnnouncementVoteButtons(suggestionId);

      await interaction.editReply({
        embeds: [announceEmbed],
        components: [voteButtons],
      });

      // Also update Message 2 (browser) if it exists
      if (botMessageId2) {
        try {
          const thread = await interaction.client.channels.fetch(idea.thread_id);
          if (thread?.isThread()) {
            const message2 = await (thread as ThreadChannel).messages.fetch(botMessageId2);
            if (message2) {
              const suggestions = await service.getSuggestionsForIdea(idea.id);
              const currentIndex = idea.current_suggestion_index;
              const browserEmbed = IdeasPanel.createSuggestionBrowserEmbed(
                updatedSuggestion,
                currentIndex,
                suggestions.length,
                idea.title,
                true
              );
              const browserButtons = IdeasPanel.createSuggestionBrowserButtons(
                idea.id,
                updatedSuggestion.id,
                currentIndex,
                suggestions.length,
                updatedSuggestion.status,
                true
              );
              await message2.edit({
                embeds: [browserEmbed],
                components: browserButtons,
              });
            }
          }
        } catch (error) {
          logger.debug('Could not update Message 2 after vote from announcement:', error);
        }
      }
    } else {
      // Update Message 2 (browser view)
      const suggestions = await service.getSuggestionsForIdea(idea.id);
      const currentIndex = idea.current_suggestion_index;

      const embed = IdeasPanel.createSuggestionBrowserEmbed(
        updatedSuggestion,
        currentIndex,
        suggestions.length,
        idea.title,
        true // voting is enabled
      );
      const buttons = IdeasPanel.createSuggestionBrowserButtons(
        idea.id,
        updatedSuggestion.id,
        currentIndex,
        suggestions.length,
        updatedSuggestion.status,
        true
      );

      await interaction.editReply({
        embeds: [embed],
        components: buttons,
      });

      // Also update announcement message if it exists
      if (announcementMsgId) {
        try {
          const thread = await interaction.client.channels.fetch(idea.thread_id);
          if (thread?.isThread()) {
            const announceMsg = await (thread as ThreadChannel).messages.fetch(announcementMsgId);
            if (announceMsg) {
              const announceEmbed = IdeasPanel.createVoteAnnouncementEmbed(updatedSuggestion, idea.title, idea.thread_id, idea.author_id);
              const voteButtons = IdeasPanel.createVoteAnnouncementVoteButtons(suggestionId);
              await announceMsg.edit({
                embeds: [announceEmbed],
                components: [voteButtons],
              });
            }
          }
        } catch (error) {
          logger.debug('Could not update announcement after vote from Message 2:', error);
        }
      }
    }

    // Send feedback about the vote (auto-deleted after 15s)
    let voteMessage: string;
    if (result.action === 'removed') {
      voteMessage = `<@${interaction.user.id}> removed their vote from this suggestion.`;
    } else {
      const voteWord = voteType === 'yes' ? 'yes' : 'no';
      voteMessage = `<@${interaction.user.id}> voted **${voteWord}** for this suggestion.`;
    }

    const voteMsg = await interaction.followUp({
      content: voteMessage,
    });
    // Auto-delete the vote confirmation after 15 seconds
    deleteMessageAfterDelay(voteMsg, EPHEMERAL_DELETE_DELAY);

    logger.debug(`Vote ${dbVoteType} ${result.action} on suggestion ${suggestionId} by ${interaction.user.username}`);

  } catch (error) {
    logger.error(`Failed to vote on suggestion:`, error);
    await interaction.followUp({
      embeds: [IdeasPanel.createErrorEmbed('Error', 'Failed to record your vote.')],
      ephemeral: true,
    });
  }
}

/**
 * Handle Finalize Draft button (Message 1)
 * Shows confirmation before actually finalizing
 * Only OP can finalize their idea
 */
async function handleFinalizeButton(
  interaction: ButtonInteraction,
  service: NonNullable<ReturnType<typeof getIdeasService>>,
  ideaId: string
): Promise<void> {
  const idea = await service.getIdea(ideaId);
  if (!idea) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed('Not Found', 'This idea no longer exists.')],
      ephemeral: true,
    });
    return;
  }

  const member = interaction.member as GuildMember;

  // Only OP can finalize (not admins)
  if (member.id !== idea.author_id) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed(
        'Permission Denied',
        'Only the idea author can finalize the draft.'
      )],
      ephemeral: true,
    });
    return;
  }

  // Check if already finalized
  if (idea.is_finalized) {
    await interaction.reply({
      embeds: [IdeasPanel.createInfoEmbed(
        'Already Finalized',
        'This idea has already been finalized.'
      )],
      ephemeral: true,
    });
    return;
  }

  await interaction.deferUpdate();

  // Check for active votes - show warning with option to end all votes
  const activeVotes = await service.getActiveVotesForIdea(idea.id);
  if (activeVotes.length > 0) {
    // Show warning embed with "End All Votes & Continue" button
    const warningEmbed = IdeasPanel.createActiveVotesWarningEmbed(idea, activeVotes);
    const warningButtons = IdeasPanel.createActiveVotesWarningButtons(idea.id);

    await interaction.editReply({
      embeds: [warningEmbed],
      components: warningButtons,
    });
    return;
  }

  // No active votes - show confirmation embed with confirm/cancel buttons
  const approvedSuggestions = await service.getApprovedSuggestionsForIdea(idea.id);
  const confirmEmbed = IdeasPanel.createFinalizeConfirmEmbed(idea, approvedSuggestions.length);
  const confirmButtons = IdeasPanel.createFinalizeConfirmButtons(idea.id);

  await interaction.editReply({
    embeds: [confirmEmbed],
    components: confirmButtons,
  });
}

/**
 * Handle Finalize Confirm button - actually finalizes the idea
 */
async function handleFinalizeConfirm(
  interaction: ButtonInteraction,
  service: NonNullable<ReturnType<typeof getIdeasService>>,
  ideaId: string
): Promise<void> {
  const idea = await service.getIdea(ideaId);
  if (!idea) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed('Not Found', 'This idea no longer exists.')],
      ephemeral: true,
    });
    return;
  }

  const member = interaction.member as GuildMember;

  // Only OP can finalize
  if (member.id !== idea.author_id) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed(
        'Permission Denied',
        'Only the idea author can finalize the draft.'
      )],
      ephemeral: true,
    });
    return;
  }

  // Check if already finalized
  if (idea.is_finalized) {
    await interaction.reply({
      embeds: [IdeasPanel.createInfoEmbed(
        'Already Finalized',
        'This idea has already been finalized.'
      )],
      ephemeral: true,
    });
    return;
  }

  await interaction.deferUpdate();

  try {
    // Mark idea as finalized (this also sets status to 'submitted')
    const finalizedIdea = await service.finalizeIdea(idea.id);
    if (!finalizedIdea) {
      throw new Error('Failed to finalize idea');
    }

    // Get suggestions for the finalized embed
    const suggestions = await service.getSuggestionsForIdea(idea.id);

    // Update Message 1 (Draft) with finalized state - remove buttons
    const embed = IdeasPanel.createFinalizedEmbed(finalizedIdea, suggestions, finalizedIdea.draft_summary);

    await interaction.editReply({
      embeds: [embed],
      components: [], // Remove all buttons after finalization
    });

    // Update Message 2 (Suggestions Panel) to show status panel with buttons
    try {
      const botMessageId2 = await service.getBotMessageId2(idea.id);
      if (botMessageId2) {
        const thread = await interaction.client.channels.fetch(idea.thread_id);
        if (thread?.isThread()) {
          const message2 = await (thread as ThreadChannel).messages.fetch(botMessageId2);
          if (message2) {
            const statusEmbed = IdeasPanel.createSubmittedSuggestionsPanelEmbed(finalizedIdea);
            const statusButtons = IdeasPanel.createStatusButtons(idea.id, finalizedIdea.status);
            await message2.edit({
              embeds: [statusEmbed],
              components: statusButtons,
            });
            logger.debug(`Updated Message 2 to status panel for idea ${idea.id}`);
          }
        }
      }
    } catch (error) {
      logger.warn('Could not update Message 2 to status panel:', error);
    }

    // Send notification to the thread and lock it
    let threadLink = '';
    try {
      const thread = await interaction.client.channels.fetch(idea.thread_id);
      if (thread?.isThread()) {
        threadLink = `https://discord.com/channels/${idea.guild_id}/${idea.thread_id}`;
        await (thread as ThreadChannel).send({
          embeds: [IdeasPanel.createInfoEmbed(
            'Draft Finalized',
            `<@${idea.author_id}> has finalized this idea!\n\nThe draft is now submitted for official review. This thread is now locked.`
          )],
        });

        // Lock the thread after submission
        await service.lockThread(interaction.client, idea.thread_id);
        logger.info(`Locked thread ${idea.thread_id} after idea submission`);
      }
    } catch (error) {
      logger.warn('Could not send finalization notification or lock thread:', error);
    }

    // Send DM to configured admin (bot owner) with link to the idea
    try {
      // Get the bot application owner
      const application = await interaction.client.application?.fetch();
      if (application?.owner) {
        const ownerId = 'team' in application.owner ? null : application.owner.id;
        if (ownerId) {
          const owner = await interaction.client.users.fetch(ownerId);
          if (owner) {
            const dmEmbed = IdeasPanel.createInfoEmbed(
              '📬 New Idea Submitted',
              `**${finalizedIdea.title}**\n\n` +
              `Submitted by <@${finalizedIdea.author_id}>\n` +
              `Server: ${interaction.guild?.name || 'Unknown'}\n\n` +
              `${finalizedIdea.draft_summary ? finalizedIdea.draft_summary.slice(0, 200) + '...' : finalizedIdea.content.slice(0, 200) + '...'}\n\n` +
              `[View Idea](${threadLink})`
            );
            await owner.send({ embeds: [dmEmbed] });
            logger.info(`Sent DM notification to bot owner for idea ${idea.id}`);
          }
        }
      }
    } catch (error) {
      logger.warn('Could not send DM notification:', error);
    }

    logger.info(`Idea ${idea.id} finalized by ${interaction.user.username}`);

  } catch (error) {
    logger.error(`Failed to finalize idea ${idea.id}:`, error);
    await interaction.followUp({
      embeds: [IdeasPanel.createErrorEmbed('Error', 'Failed to finalize the draft.')],
      ephemeral: true,
    });
  }
}

/**
 * Handle Finalize Cancel button - returns to draft view
 */
async function handleFinalizeCancel(
  interaction: ButtonInteraction,
  service: NonNullable<ReturnType<typeof getIdeasService>>,
  ideaId: string
): Promise<void> {
  const idea = await service.getIdea(ideaId);
  if (!idea) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed('Not Found', 'This idea no longer exists.')],
      ephemeral: true,
    });
    return;
  }

  await interaction.deferUpdate();

  // Return to draft view
  const approvedSuggestions = await service.getApprovedSuggestionsForIdea(idea.id);
  const embed = IdeasPanel.createDraftEmbed(idea, approvedSuggestions, idea.draft_summary);
  const buttons = IdeasPanel.createDraftButtons(idea.id);

  await interaction.editReply({
    embeds: [embed],
    components: buttons,
  });
}

/**
 * Handle "End All Votes & Continue" button - ends all active votes and proceeds to finalize confirmation
 */
async function handleFinalizeEndVotes(
  interaction: ButtonInteraction,
  service: NonNullable<ReturnType<typeof getIdeasService>>,
  ideaId: string
): Promise<void> {
  const idea = await service.getIdea(ideaId);
  if (!idea) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed('Not Found', 'This idea no longer exists.')],
      ephemeral: true,
    });
    return;
  }

  const member = interaction.member as GuildMember;

  // Only OP can finalize
  if (member.id !== idea.author_id) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed(
        'Permission Denied',
        'Only the idea author can finalize the draft.'
      )],
      ephemeral: true,
    });
    return;
  }

  await interaction.deferUpdate();

  // Get all active votes and end them
  const activeVotes = await service.getActiveVotesForIdea(idea.id);

  for (const suggestion of activeVotes) {
    // Delete the vote announcement message
    try {
      if (suggestion.vote_announcement_message_id) {
        const thread = await interaction.client.channels.fetch(idea.thread_id);
        if (thread?.isThread()) {
          const announceMsg = await (thread as ThreadChannel).messages.fetch(suggestion.vote_announcement_message_id);
          if (announceMsg) {
            await announceMsg.delete();
          }
        }
      }
    } catch (error) {
      logger.debug(`Could not delete vote announcement for suggestion ${suggestion.id}:`, error);
    }

    // End voting on this suggestion
    await service.endVoteOnSuggestion(suggestion.id);

    // Post vote ended message to thread
    try {
      const thread = await interaction.client.channels.fetch(idea.thread_id);
      if (thread?.isThread()) {
        await (thread as ThreadChannel).send({
          embeds: [IdeasPanel.createVoteEndedEmbed(suggestion, idea.title, idea.author_id)],
        });
      }
    } catch (error) {
      logger.debug(`Could not post vote ended message for suggestion ${suggestion.id}:`, error);
    }
  }

  logger.info(`Ended ${activeVotes.length} active votes for idea ${ideaId} before finalization`);

  // Update Message 2 to reflect that votes have ended
  try {
    const botMessageId2 = await service.getBotMessageId2(idea.id);
    if (botMessageId2) {
      const thread = await interaction.client.channels.fetch(idea.thread_id);
      if (thread?.isThread()) {
        const message2 = await (thread as ThreadChannel).messages.fetch(botMessageId2);
        if (message2) {
          // Get suggestion stats
          const allSuggestions = await service.getSuggestionsForIdea(idea.id);
          const approved = allSuggestions.filter(s => s.status === 'approved').length;
          const rejected = allSuggestions.filter(s => s.status === 'rejected').length;
          const pending = allSuggestions.filter(s => s.status === 'pending').length;

          // Update with no active votes
          const statusEmbed = IdeasPanel.createSuggestionStatusEmbed(idea, approved, rejected, pending, null);
          const statusButtons = IdeasPanel.createSuggestionStatusButtons(idea.id, pending);

          await message2.edit({
            embeds: [statusEmbed],
            components: statusButtons,
          });
          logger.debug(`Updated Message 2 after ending all votes for idea ${idea.id}`);
        }
      }
    }
  } catch (error) {
    logger.warn('Could not update Message 2 after ending votes:', error);
  }

  // Now show the finalize confirmation
  const approvedSuggestions = await service.getApprovedSuggestionsForIdea(idea.id);
  const confirmEmbed = IdeasPanel.createFinalizeConfirmEmbed(idea, approvedSuggestions.length);
  const confirmButtons = IdeasPanel.createFinalizeConfirmButtons(idea.id);

  await interaction.editReply({
    embeds: [confirmEmbed],
    components: confirmButtons,
  });
}

// ==================== New Draft Control Panel Handlers ====================

/**
 * Handle Review Suggestions button - opens the suggestion browser view
 * Only OP or admin can review
 */
async function handleReviewSuggestions(
  interaction: ButtonInteraction,
  service: NonNullable<ReturnType<typeof getIdeasService>>,
  ideaId: string
): Promise<void> {
  const idea = await service.getIdea(ideaId);
  if (!idea) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed('Not Found', 'This idea no longer exists.')],
      ephemeral: true,
    });
    return;
  }

  const member = interaction.member as GuildMember;
  if (!isOPOrAdmin(member, idea)) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed('Permission Denied', 'Only the idea author can review suggestions.')],
      ephemeral: true,
    });
    return;
  }

  await interaction.deferUpdate();

  const suggestions = await service.getSuggestionsForIdea(idea.id);

  if (suggestions.length === 0) {
    await interaction.followUp({
      embeds: [IdeasPanel.createInfoEmbed('No Suggestions', 'No suggestions have been detected yet. Encourage people to share their feedback in the thread!')],
      ephemeral: true,
    });
    return;
  }

  // Find first pending suggestion, or show first if none pending
  const pendingSuggestions = suggestions.filter(s => s.status === 'pending');
  const startIndex = pendingSuggestions.length > 0
    ? suggestions.findIndex(s => s.id === pendingSuggestions[0]!.id)
    : 0;

  await service.setCurrentSuggestionIndex(idea.id, startIndex);
  const currentSuggestion = suggestions[startIndex]!;
  const votingEnabled = currentSuggestion.is_voting_active;

  const embed = IdeasPanel.createSuggestionBrowserEmbed(
    currentSuggestion,
    startIndex,
    suggestions.length,
    idea.title,
    votingEnabled
  );
  const buttons = IdeasPanel.createSuggestionBrowserButtons(
    idea.id,
    currentSuggestion.id,
    startIndex,
    suggestions.length,
    currentSuggestion.status,
    votingEnabled
  );

  await interaction.editReply({
    embeds: [embed],
    components: buttons,
  });

  // Set up auto-reset timer
  resetBrowserTimer(idea.id, interaction.client);
}

/**
 * Handle navigation in suggestion browser (prev/next)
 * Only OP or admin can navigate
 */
async function handleNavigation(
  interaction: ButtonInteraction,
  service: NonNullable<ReturnType<typeof getIdeasService>>,
  direction: 'prev' | 'next',
  ideaId: string
): Promise<void> {
  const idea = await service.getIdea(ideaId);
  if (!idea) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed('Not Found', 'This idea no longer exists.')],
      ephemeral: true,
    });
    return;
  }

  const member = interaction.member as GuildMember;
  if (!isOPOrAdmin(member, idea)) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed('Permission Denied', 'Only the idea author can navigate suggestions.')],
      ephemeral: true,
    });
    return;
  }

  await interaction.deferUpdate();

  const suggestions = await service.getSuggestionsForIdea(idea.id);
  if (suggestions.length === 0) return;

  const currentIndex = idea.current_suggestion_index;
  let newIndex = direction === 'prev'
    ? Math.max(0, currentIndex - 1)
    : Math.min(suggestions.length - 1, currentIndex + 1);

  await service.setCurrentSuggestionIndex(idea.id, newIndex);

  const currentSuggestion = suggestions[newIndex]!;
  const votingEnabled = currentSuggestion.is_voting_active;

  const embed = IdeasPanel.createSuggestionBrowserEmbed(
    currentSuggestion,
    newIndex,
    suggestions.length,
    idea.title,
    votingEnabled
  );
  const buttons = IdeasPanel.createSuggestionBrowserButtons(
    idea.id,
    currentSuggestion.id,
    newIndex,
    suggestions.length,
    currentSuggestion.status,
    votingEnabled
  );

  await interaction.editReply({
    embeds: [embed],
    components: buttons,
  });

  // Reset the browser auto-reset timer
  resetBrowserTimer(idea.id, interaction.client);
}

/**
 * Helper to update Message 1 (Draft) after changes
 */
async function updateDraftMessage(
  interaction: ButtonInteraction,
  service: NonNullable<ReturnType<typeof getIdeasService>>,
  ideaId: string
): Promise<void> {
  try {
    const idea = await service.getIdea(ideaId);
    if (!idea) return;

    const botMessageId = await service.getBotMessageId(idea.id);
    if (!botMessageId) return;

    const thread = await interaction.client.channels.fetch(idea.thread_id);
    if (!thread?.isThread()) return;

    const message = await (thread as ThreadChannel).messages.fetch(botMessageId);
    if (!message) return;

    const approvedSuggestions = await service.getApprovedSuggestionsForIdea(idea.id);
    const embed = IdeasPanel.createDraftEmbed(idea, approvedSuggestions, idea.draft_summary);
    const buttons = IdeasPanel.createDraftButtons(idea.id);

    await message.edit({
      embeds: [embed],
      components: buttons,
    });
  } catch (error) {
    logger.warn('Could not update draft message:', error);
  }
}

/**
 * Handle Back to Draft button - returns to main draft view (Message 1)
 * This is legacy - now draft is always on Message 1
 */
async function handleBackToDraft(
  interaction: ButtonInteraction,
  service: NonNullable<ReturnType<typeof getIdeasService>>,
  ideaId: string
): Promise<void> {
  // Just redirect to suggestions panel since draft is now on Message 1
  await handleBackToSuggestions(interaction, service, ideaId);
}

/**
 * Handle Back to Suggestions button - returns to suggestions panel (Message 2)
 */
async function handleBackToSuggestions(
  interaction: ButtonInteraction,
  service: NonNullable<ReturnType<typeof getIdeasService>>,
  ideaId: string
): Promise<void> {
  const idea = await service.getIdea(ideaId);
  if (!idea) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed('Not Found', 'This idea no longer exists.')],
      ephemeral: true,
    });
    return;
  }

  await interaction.deferUpdate();

  const allSuggestions = await service.getSuggestionsForIdea(idea.id);
  const approved = allSuggestions.filter(s => s.status === 'approved').length;
  const rejected = allSuggestions.filter(s => s.status === 'rejected').length;
  const pending = allSuggestions.filter(s => s.status === 'pending').length;

  // Check for active votes to show
  const activeVoteSuggestions = await service.getActiveVotesForIdea(idea.id);
  const activeVotes = activeVoteSuggestions.map(s => ({
    upvotes: s.upvotes,
    downvotes: s.downvotes,
    content: s.content,
  }));

  const embed = IdeasPanel.createSuggestionStatusEmbed(idea, approved, rejected, pending, activeVotes.length > 0 ? activeVotes : null);
  const buttons = IdeasPanel.createSuggestionStatusButtons(idea.id, pending);

  await interaction.editReply({
    embeds: [embed],
    components: buttons,
  });

  // Cancel the browser auto-reset timer since we're back to status panel
  cancelBrowserTimer(idea.id);
}

/**
 * Handle Update Draft button - generates AI summary
 * Only OP can update the draft
 */
async function handleUpdateDraft(
  interaction: ButtonInteraction,
  service: NonNullable<ReturnType<typeof getIdeasService>>,
  ideaId: string
): Promise<void> {
  const idea = await service.getIdea(ideaId);
  if (!idea) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed('Not Found', 'This idea no longer exists.')],
      ephemeral: true,
    });
    return;
  }

  const member = interaction.member as GuildMember;
  if (member.id !== idea.author_id && !isAdmin(member)) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed('Permission Denied', 'Only the idea author can update the draft.')],
      ephemeral: true,
    });
    return;
  }

  if (!service.hasAIProvider()) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed('AI Unavailable', 'No AI provider is configured.')],
      ephemeral: true,
    });
    return;
  }

  await interaction.deferUpdate();

  try {
    // Show processing state
    await interaction.editReply({
      embeds: [IdeasPanel.createInfoEmbed('Generating Draft...', 'AI is creating a concise summary of your idea with approved suggestions.')],
      components: [],
    });

    // Generate the draft summary
    const summary = await service.generateDraftSummary(idea.id);

    // Get updated data
    const approvedSuggestions = await service.getApprovedSuggestionsForIdea(idea.id);

    const embed = IdeasPanel.createDraftEmbed(idea, approvedSuggestions, summary);
    const buttons = IdeasPanel.createDraftButtons(idea.id);

    await interaction.editReply({
      embeds: [embed],
      components: buttons,
    });

    logger.info(`Draft updated for idea ${idea.id}`);

  } catch (error) {
    logger.error(`Failed to update draft for idea ${idea.id}:`, error);

    // Restore draft view on error
    const approvedSuggestions = await service.getApprovedSuggestionsForIdea(idea.id);

    await interaction.editReply({
      embeds: [IdeasPanel.createDraftEmbed(idea, approvedSuggestions, idea.draft_summary)],
      components: IdeasPanel.createDraftButtons(idea.id),
    });

    await interaction.followUp({
      embeds: [IdeasPanel.createErrorEmbed('Error', 'Failed to generate draft summary.')],
      ephemeral: true,
    });
  }
}

/**
 * Handle Approve Suggestion button
 * Only OP can approve suggestions
 */
async function handleApproveSuggestion(
  interaction: ButtonInteraction,
  service: NonNullable<ReturnType<typeof getIdeasService>>,
  suggestionId: string
): Promise<void> {
  const suggestion = await service.getSuggestion(suggestionId);
  if (!suggestion) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed('Not Found', 'This suggestion no longer exists.')],
      ephemeral: true,
    });
    return;
  }

  const idea = await service.getIdea(suggestion.idea_id);
  if (!idea) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed('Not Found', 'The idea no longer exists.')],
      ephemeral: true,
    });
    return;
  }

  const member = interaction.member as GuildMember;
  if (!isOPOrAdmin(member, idea)) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed('Permission Denied', 'Only the idea author can approve suggestions.')],
      ephemeral: true,
    });
    return;
  }

  await interaction.deferUpdate();

  // Approve the suggestion
  await service.approveSuggestion(suggestionId, interaction.user.id);

  // Update the browser view immediately (don't wait for AI)
  const suggestions = await service.getSuggestionsForIdea(idea.id);
  const currentIndex = idea.current_suggestion_index;
  const currentSuggestion = suggestions[currentIndex]!;
  const votingEnabled = currentSuggestion.is_voting_active;

  const embed = IdeasPanel.createSuggestionBrowserEmbed(
    currentSuggestion,
    currentIndex,
    suggestions.length,
    idea.title,
    votingEnabled
  );
  const buttons = IdeasPanel.createSuggestionBrowserButtons(
    idea.id,
    currentSuggestion.id,
    currentIndex,
    suggestions.length,
    currentSuggestion.status,
    votingEnabled
  );

  await interaction.editReply({
    embeds: [embed],
    components: buttons,
  });

  // Update Message 1 (Draft) immediately with current summary
  await updateDraftMessage(interaction, service, idea.id);

  // Reset browser timer (user is actively using it)
  resetBrowserTimer(idea.id, interaction.client);

  // Run AI regeneration in background (don't block UI)
  if (service.hasAIProvider()) {
    // Fire and forget - regenerate draft summary asynchronously
    service.generateDraftSummary(idea.id)
      .then(async () => {
        logger.debug(`Background draft regeneration complete for idea ${idea.id}`);
        // Update Message 1 again with the new AI-generated summary
        try {
          const updatedIdea = await service.getIdea(idea.id);
          if (!updatedIdea) return;

          const botMessageId = await service.getBotMessageId(idea.id);
          if (!botMessageId) return;

          const thread = await interaction.client.channels.fetch(updatedIdea.thread_id);
          if (!thread?.isThread()) return;

          const message = await (thread as ThreadChannel).messages.fetch(botMessageId);
          if (!message) return;

          const approvedSuggestions = await service.getApprovedSuggestionsForIdea(idea.id);
          const draftEmbed = IdeasPanel.createDraftEmbed(updatedIdea, approvedSuggestions, updatedIdea.draft_summary);
          const draftButtons = IdeasPanel.createDraftButtons(idea.id);

          await message.edit({
            embeds: [draftEmbed],
            components: draftButtons,
          });
          logger.debug(`Updated Message 1 with new AI summary for idea ${idea.id}`);
        } catch (error) {
          logger.warn(`Failed to update Message 1 after AI regeneration:`, error);
        }
      })
      .catch(error => {
        logger.warn(`Background draft regeneration failed for idea ${idea.id}:`, error);
      });
  }

  logger.info(`Suggestion ${suggestionId} approved by ${interaction.user.username}`);
}

/**
 * Handle Reject Suggestion button
 * Only OP can reject suggestions
 */
async function handleRejectSuggestion(
  interaction: ButtonInteraction,
  service: NonNullable<ReturnType<typeof getIdeasService>>,
  suggestionId: string
): Promise<void> {
  const suggestion = await service.getSuggestion(suggestionId);
  if (!suggestion) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed('Not Found', 'This suggestion no longer exists.')],
      ephemeral: true,
    });
    return;
  }

  const idea = await service.getIdea(suggestion.idea_id);
  if (!idea) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed('Not Found', 'The idea no longer exists.')],
      ephemeral: true,
    });
    return;
  }

  const member = interaction.member as GuildMember;
  if (!isOPOrAdmin(member, idea)) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed('Permission Denied', 'Only the idea author can reject suggestions.')],
      ephemeral: true,
    });
    return;
  }

  await interaction.deferUpdate();

  // Reject the suggestion
  await service.rejectSuggestion(suggestionId, interaction.user.id);

  // Update the browser view
  const suggestions = await service.getSuggestionsForIdea(idea.id);
  const currentIndex = idea.current_suggestion_index;
  const currentSuggestion = suggestions[currentIndex]!;
  const votingEnabled = currentSuggestion.is_voting_active;

  const embed = IdeasPanel.createSuggestionBrowserEmbed(
    currentSuggestion,
    currentIndex,
    suggestions.length,
    idea.title,
    votingEnabled
  );
  const buttons = IdeasPanel.createSuggestionBrowserButtons(
    idea.id,
    currentSuggestion.id,
    currentIndex,
    suggestions.length,
    currentSuggestion.status,
    votingEnabled
  );

  await interaction.editReply({
    embeds: [embed],
    components: buttons,
  });

  // Reset browser timer (user is actively using it)
  resetBrowserTimer(idea.id, interaction.client);

  logger.info(`Suggestion ${suggestionId} rejected by ${interaction.user.username}`);
}

/**
 * Handle Start Vote button - enables voting and posts to thread
 * Only OP can start a vote
 * Supports multiple simultaneous votes per idea
 */
async function handleStartVote(
  interaction: ButtonInteraction,
  service: NonNullable<ReturnType<typeof getIdeasService>>,
  ideaId: string,
  suggestionId: string
): Promise<void> {
  const idea = await service.getIdea(ideaId);
  if (!idea) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed('Not Found', 'This idea no longer exists.')],
      ephemeral: true,
    });
    return;
  }

  const member = interaction.member as GuildMember;
  if (!isOPOrAdmin(member, idea)) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed('Permission Denied', 'Only the idea author can start a vote.')],
      ephemeral: true,
    });
    return;
  }

  const suggestion = await service.getSuggestion(suggestionId);
  if (!suggestion) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed('Not Found', 'This suggestion no longer exists.')],
      ephemeral: true,
    });
    return;
  }

  // Check if this suggestion already has an active vote
  if (suggestion.is_voting_active) {
    await interaction.reply({
      embeds: [IdeasPanel.createInfoEmbed('Vote Already Active', 'This suggestion already has an active vote.')],
      ephemeral: true,
    });
    return;
  }

  await interaction.deferUpdate();

  // Post announcement to thread with voting buttons
  let announcementMsgId: string | null = null;
  try {
    const thread = await interaction.client.channels.fetch(idea.thread_id);
    if (thread?.isThread()) {
      const announceEmbed = IdeasPanel.createVoteAnnouncementEmbed(suggestion, idea.title, idea.thread_id, idea.author_id);

      // Create voting buttons for the announcement
      const voteButtons = IdeasPanel.createVoteAnnouncementVoteButtons(suggestionId);

      const announceMsg = await (thread as ThreadChannel).send({
        content: `@here <@${idea.author_id}> is asking for votes on a suggestion!`,
        embeds: [announceEmbed],
        components: [voteButtons],
      });

      announcementMsgId = announceMsg.id;
    }
  } catch (error) {
    logger.warn('Could not post vote announcement:', error);
  }

  // Start voting on this suggestion (stores announcement message ID on the suggestion)
  if (announcementMsgId) {
    await service.startVoteOnSuggestion(suggestionId, announcementMsgId);
  }

  // Update the browser view with voting enabled for this suggestion
  const suggestions = await service.getSuggestionsForIdea(idea.id);
  const currentIndex = idea.current_suggestion_index;
  const currentSuggestion = suggestions[currentIndex]!;
  const votingEnabled = currentSuggestion.is_voting_active;

  const embed = IdeasPanel.createSuggestionBrowserEmbed(
    currentSuggestion,
    currentIndex,
    suggestions.length,
    idea.title,
    votingEnabled
  );
  const buttons = IdeasPanel.createSuggestionBrowserButtons(
    idea.id,
    currentSuggestion.id,
    currentIndex,
    suggestions.length,
    currentSuggestion.status,
    votingEnabled
  );

  await interaction.editReply({
    embeds: [embed],
    components: buttons,
  });

  // Reset browser timer
  resetBrowserTimer(idea.id, interaction.client);

  logger.info(`Vote started on suggestion ${suggestionId} for idea ${ideaId}`);
}

/**
 * Handle End Vote button - disables voting
 * Only OP can end a vote
 */
async function handleEndVote(
  interaction: ButtonInteraction,
  service: NonNullable<ReturnType<typeof getIdeasService>>,
  ideaId: string,
  suggestionId: string
): Promise<void> {
  const idea = await service.getIdea(ideaId);
  if (!idea) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed('Not Found', 'This idea no longer exists.')],
      ephemeral: true,
    });
    return;
  }

  const member = interaction.member as GuildMember;
  if (!isOPOrAdmin(member, idea)) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed('Permission Denied', 'Only the idea author can end a vote.')],
      ephemeral: true,
    });
    return;
  }

  await interaction.deferUpdate();

  // Get the suggestion to find its announcement message
  const votingSuggestion = await service.getSuggestion(suggestionId);
  if (!votingSuggestion) {
    logger.warn(`Suggestion ${suggestionId} not found when ending vote`);
    return;
  }

  // Delete the vote announcement message
  try {
    const announcementMsgId = votingSuggestion.vote_announcement_message_id;
    if (announcementMsgId) {
      const thread = await interaction.client.channels.fetch(idea.thread_id);
      if (thread?.isThread()) {
        const announceMsg = await (thread as ThreadChannel).messages.fetch(announcementMsgId);
        if (announceMsg) {
          await announceMsg.delete();
          logger.debug(`Deleted vote announcement message ${announcementMsgId}`);
        }
      }
    }
  } catch (error) {
    logger.warn('Could not delete vote announcement message:', error);
  }

  // End voting on this suggestion
  await service.endVoteOnSuggestion(suggestionId);

  // Update the browser view with voting disabled
  const suggestions = await service.getSuggestionsForIdea(ideaId);
  const currentIndex = idea.current_suggestion_index;
  const currentSuggestion = suggestions[currentIndex]!;

  const embed = IdeasPanel.createSuggestionBrowserEmbed(
    currentSuggestion,
    currentIndex,
    suggestions.length,
    idea.title,
    false // voting disabled
  );
  const buttons = IdeasPanel.createSuggestionBrowserButtons(
    idea.id,
    currentSuggestion.id,
    currentIndex,
    suggestions.length,
    currentSuggestion.status,
    false
  );

  await interaction.editReply({
    embeds: [embed],
    components: buttons,
  });

  // Start browser reset timer now that voting has ended
  resetBrowserTimer(ideaId, interaction.client);

  // Get final vote counts and show detailed results
  const suggestion = await service.getSuggestion(suggestionId);
  if (suggestion) {
    // Post a detailed vote ended message to the thread (not auto-deleted - stays for context)
    try {
      const thread = await interaction.client.channels.fetch(idea.thread_id);
      if (thread?.isThread()) {
        await (thread as ThreadChannel).send({
          embeds: [IdeasPanel.createVoteEndedEmbed(suggestion, idea.title, idea.author_id)],
        });
      }
    } catch (error) {
      logger.warn('Could not post vote ended message to thread:', error);
    }
  }

  logger.info(`Vote ended on suggestion ${suggestionId} for idea ${ideaId}`);
}

/**
 * Handle list pagination buttons
 */
async function handleListButton(
  interaction: ButtonInteraction,
  service: NonNullable<ReturnType<typeof getIdeasService>>,
  params: string[]
): Promise<void> {
  const [direction, statusOrPage, maybePage] = params;
  const statusFilter = statusOrPage === 'all' ? undefined : statusOrPage as IdeaStatus | undefined;
  const currentPage = maybePage ? parseInt(maybePage, 10) : 0;

  const totalCount = await service.getIdeasCount(interaction.guildId!, statusFilter);
  const totalPages = Math.max(1, Math.ceil(totalCount / ITEMS_PER_PAGE));

  let newPage: number;
  switch (direction) {
    case 'first':
      newPage = 0;
      break;
    case 'prev':
      newPage = Math.max(0, currentPage - 1);
      break;
    case 'next':
      newPage = Math.min(totalPages - 1, currentPage + 1);
      break;
    case 'last':
      newPage = totalPages - 1;
      break;
    default:
      newPage = 0;
  }

  const ideas = await service.getIdeasByGuild(
    interaction.guildId!,
    statusFilter,
    ITEMS_PER_PAGE,
    newPage * ITEMS_PER_PAGE
  );

  const embed = IdeasPanel.createListEmbed(ideas, newPage, totalPages, statusFilter);
  const components = [];

  if (totalPages > 1) {
    components.push(IdeasPanel.createListButtons(newPage, totalPages, statusFilter));
  }
  components.push(IdeasPanel.createStatusFilter(statusFilter));

  await interaction.update({
    embeds: [embed],
    components,
  });
}

/**
 * Handle select menu interactions
 */
async function handleSelectMenu(
  interaction: StringSelectMenuInteraction,
  service: ReturnType<typeof getIdeasService>
): Promise<void> {
  if (!service) return;

  const [, action] = interaction.customId.split(':');

  if (action === 'filter') {
    await handleStatusFilter(interaction, service);
  }
}

/**
 * Handle status filter select menu
 */
async function handleStatusFilter(
  interaction: StringSelectMenuInteraction,
  service: NonNullable<ReturnType<typeof getIdeasService>>
): Promise<void> {
  const selected = interaction.values[0];
  const statusFilter = selected === 'all' ? undefined : selected as IdeaStatus;

  const totalCount = await service.getIdeasCount(interaction.guildId!, statusFilter);
  const totalPages = Math.max(1, Math.ceil(totalCount / ITEMS_PER_PAGE));
  const ideas = await service.getIdeasByGuild(interaction.guildId!, statusFilter, ITEMS_PER_PAGE, 0);

  const embed = IdeasPanel.createListEmbed(ideas, 0, totalPages, statusFilter);
  const components = [];

  if (totalPages > 1) {
    components.push(IdeasPanel.createListButtons(0, totalPages, statusFilter));
  }
  components.push(IdeasPanel.createStatusFilter(statusFilter));

  await interaction.update({
    embeds: [embed],
    components,
  });
}
