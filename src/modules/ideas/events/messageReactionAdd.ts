import {
  MessageReaction,
  PartialMessageReaction,
  User,
  PartialUser,
} from 'discord.js';
import { defineEvent } from '../../../types/event.types.js';
import {
  getIdeasService,
  AI_REACTIONS,
  VOTE_REACTIONS,
  AIFeature,
} from '../services/IdeasService.js';
import { IdeasPanel } from '../components/IdeasPanel.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('Ideas:ReactionAdd');

// Track pending AI requests to prevent spam
const pendingAIRequests = new Set<string>();

/**
 * Handle reactions on idea posts and suggestions
 */
export const messageReactionAddEvent = defineEvent(
  'messageReactionAdd',
  async (
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser
  ) => {
    // Ignore bot reactions
    if (user.bot) return;

    const service = getIdeasService();
    if (!service) return;

    // Fetch partial data if needed
    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch {
        return;
      }
    }

    if (user.partial) {
      try {
        await user.fetch();
      } catch {
        return;
      }
    }

    const message = reaction.message;
    const emoji = reaction.emoji.name;

    if (!emoji || !message.guild) return;

    // Check if this is an AI reaction on an idea
    if (emoji === AI_REACTIONS.SUMMARIZE || emoji === AI_REACTIONS.EXPAND || emoji === AI_REACTIONS.ISSUES) {
      await handleAIReaction(reaction, user as User, emoji);
      return;
    }

    // Check if this is a vote reaction on a suggestion
    if (emoji === VOTE_REACTIONS.UP || emoji === VOTE_REACTIONS.DOWN) {
      await handleVoteReaction(reaction, user as User, emoji);
      return;
    }
  }
);

/**
 * Handle AI feature reactions
 */
async function handleAIReaction(
  reaction: MessageReaction | PartialMessageReaction,
  user: User,
  emoji: string
): Promise<void> {
  const service = getIdeasService();
  if (!service) return;

  const message = reaction.message;

  // Find the idea by message ID (this should be the starter message)
  const idea = await service.getIdeaByThread(message.channelId);
  if (!idea) return;

  // Only allow AI reactions on the original idea message
  if (message.id !== idea.message_id) return;

  // Check if AI is available
  if (!service.hasAIProvider()) {
    try {
      await reaction.users.remove(user.id);
    } catch {}
    return;
  }

  // Determine AI feature
  const featureMap: Record<string, AIFeature> = {
    [AI_REACTIONS.SUMMARIZE]: 'summarize',
    [AI_REACTIONS.EXPAND]: 'expand',
    [AI_REACTIONS.ISSUES]: 'issues',
  };
  const feature = featureMap[emoji];
  if (!feature) return;

  // Check if already processing
  const requestKey = `${idea.id}:${feature}`;
  if (pendingAIRequests.has(requestKey)) {
    try {
      await reaction.users.remove(user.id);
    } catch {}
    return;
  }

  logger.info(`AI ${feature} requested for idea "${idea.title}" by ${user.username}`);

  pendingAIRequests.add(requestKey);

  try {
    // Get the thread to send the result
    const thread = message.channel;
    if (!thread.isThread()) return;

    // Send "thinking" message
    const thinkingMsg = await thread.send({
      embeds: [IdeasPanel.createInfoEmbed('🤖 Processing...', `Running AI ${feature}...`)],
    });

    // Run the AI feature
    let aiResult: { text: string; cached: boolean };
    switch (feature) {
      case 'summarize':
        aiResult = await service.summarizeIdea(idea.id, message.client);
        break;
      case 'expand':
        aiResult = await service.expandIdea(idea.id);
        break;
      case 'issues':
        aiResult = await service.findIssues(idea.id);
        break;
      default:
        // 'extract' is handled via buttons, not reactions
        await thinkingMsg.delete().catch(() => {});
        return;
    }

    // Update with the result
    const resultEmbed = IdeasPanel.createAIResultEmbed(feature as 'summarize' | 'expand' | 'issues', aiResult.text, idea.title, {
      cached: aiResult.cached,
    });
    await thinkingMsg.edit({
      embeds: [resultEmbed],
    });

    logger.info(`AI ${feature} completed for idea "${idea.title}"`);

  } catch (error) {
    logger.error(`AI ${feature} failed for idea ${idea.id}:`, error);

    try {
      const thread = message.channel;
      if (thread.isThread()) {
        await thread.send({
          embeds: [IdeasPanel.createErrorEmbed(
            'AI Error',
            `Failed to run ${feature}. Please try again later.`
          )],
        });
      }
    } catch {}
  } finally {
    pendingAIRequests.delete(requestKey);

    // Remove the user's reaction
    try {
      await reaction.users.remove(user.id);
    } catch {}
  }
}

/**
 * Handle vote reactions on suggestions
 */
async function handleVoteReaction(
  reaction: MessageReaction | PartialMessageReaction,
  user: User,
  emoji: string
): Promise<void> {
  const service = getIdeasService();
  if (!service) return;

  const message = reaction.message;

  // Find the suggestion by message ID
  const suggestion = await service.getSuggestionByMessage(message.id);
  if (!suggestion) return;

  // Get the idea to check status
  const idea = await service.getIdea(suggestion.idea_id);
  if (!idea) return;

  // Don't allow voting on closed ideas
  if (idea.status !== 'pending') {
    try {
      await reaction.users.remove(user.id);
    } catch {}
    return;
  }

  // Determine vote type
  const voteType = emoji === VOTE_REACTIONS.UP ? 'up' : 'down';

  // Process the vote
  const result = await service.vote(suggestion.id, user.id, voteType);

  logger.debug(
    `Vote ${result.action} on suggestion ${suggestion.id}: ` +
    `+${result.upvotes}/-${result.downvotes}`
  );

  // Remove the user's reaction after processing (they can add it again to toggle)
  try {
    await reaction.users.remove(user.id);
  } catch {}
}
