import { Message, ChannelType, ThreadChannel } from 'discord.js';
import { defineEvent } from '../../../types/event.types.js';
import { getIdeasService } from '../services/IdeasService.js';
import { IdeasPanel } from '../components/IdeasPanel.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('Ideas:MessageCreate');

// Debounce delay before running extraction (in milliseconds)
const EXTRACTION_DELAY = 30 * 1000; // 30 seconds

// Track pending extraction timers by thread ID
const pendingExtractions = new Map<string, NodeJS.Timeout>();

/**
 * Handle new messages in idea threads
 * Automatically extracts suggestions after a debounce period
 */
export const messageCreateEvent = defineEvent(
  'messageCreate',
  async (message: Message) => {
    // Ignore bot messages
    if (message.author.bot) {
      return;
    }

    // Only handle messages in public threads
    if (message.channel.type !== ChannelType.PublicThread) {
      return;
    }

    const thread = message.channel as ThreadChannel;

    // Need guild
    if (!thread.guildId) {
      return;
    }

    const service = getIdeasService();
    if (!service) {
      return;
    }

    // Check if this thread is an ideas thread
    const idea = await service.getIdeaByThread(thread.id);
    if (!idea) {
      return;
    }

    // Don't process if idea is finalized
    if (idea.is_finalized) {
      return;
    }

    // Skip very short messages (likely not suggestions)
    if (message.content.length < 10) {
      logger.debug(`Skipping short message in idea thread ${thread.id}`);
      return;
    }

    logger.debug(`New message in idea thread "${idea.title}" from ${message.author.username}`);

    // Cancel any existing extraction timer for this thread
    const existingTimer = pendingExtractions.get(thread.id);
    if (existingTimer) {
      clearTimeout(existingTimer);
      logger.debug(`Reset extraction timer for thread ${thread.id}`);
    }

    // Set a new timer for extraction
    const timer = setTimeout(async () => {
      pendingExtractions.delete(thread.id);
      await runAutoExtraction(thread, idea.id, message.client);
    }, EXTRACTION_DELAY);

    pendingExtractions.set(thread.id, timer);
    logger.debug(`Scheduled extraction for thread ${thread.id} in ${EXTRACTION_DELAY / 1000}s`);
  }
);

/**
 * Run automatic extraction after debounce period
 */
async function runAutoExtraction(
  thread: ThreadChannel,
  ideaId: string,
  client: Message['client']
): Promise<void> {
  const service = getIdeasService();
  if (!service) return;

  // Re-fetch the idea to make sure it's still valid
  const idea = await service.getIdea(ideaId);
  if (!idea || idea.is_finalized) {
    logger.debug(`Skipping extraction for idea ${ideaId} - not found or finalized`);
    return;
  }

  // Check if AI is available
  if (!service.hasAIProvider()) {
    logger.debug('AI provider not available, skipping extraction');
    return;
  }

  logger.info(`Running auto-extraction for idea "${idea.title}"`);

  try {
    // Extract suggestions from the thread
    const extracted = await service.extractSuggestions(ideaId, client);

    if (extracted.length === 0) {
      logger.debug(`No new suggestions found for idea ${ideaId}`);
      // Still update Message 2 to refresh the stats
      await updateSuggestionsPanelMessage(thread, service, idea);
      return;
    }

    // Save each extracted suggestion to database
    for (const suggestion of extracted) {
      await service.createSuggestionFromExtracted(ideaId, suggestion);
    }

    logger.info(`Auto-extracted ${extracted.length} suggestions for idea "${idea.title}"`);

    // Update Message 2 with new suggestion counts
    await updateSuggestionsPanelMessage(thread, service, idea);

  } catch (error) {
    logger.error(`Auto-extraction failed for idea ${ideaId}:`, error);
  }
}

/**
 * Update Message 2 (Suggestions Panel) with current stats
 */
async function updateSuggestionsPanelMessage(
  thread: ThreadChannel,
  service: NonNullable<ReturnType<typeof getIdeasService>>,
  idea: NonNullable<Awaited<ReturnType<NonNullable<ReturnType<typeof getIdeasService>>['getIdea']>>>
): Promise<void> {
  try {
    const botMessageId2 = await service.getBotMessageId2(idea.id);
    if (!botMessageId2) {
      logger.debug(`No Message 2 ID found for idea ${idea.id}`);
      return;
    }

    const message2 = await thread.messages.fetch(botMessageId2);
    if (!message2) {
      logger.debug(`Could not fetch Message 2 for idea ${idea.id}`);
      return;
    }

    // Get suggestion stats
    const allSuggestions = await service.getSuggestionsForIdea(idea.id);
    const approved = allSuggestions.filter(s => s.status === 'approved').length;
    const rejected = allSuggestions.filter(s => s.status === 'rejected').length;
    const pending = allSuggestions.filter(s => s.status === 'pending').length;

    // Create updated embed and buttons
    const embed = IdeasPanel.createSuggestionStatusEmbed(idea, approved, rejected, pending);
    const buttons = IdeasPanel.createSuggestionStatusButtons(idea.id, pending);

    await message2.edit({
      embeds: [embed],
      components: buttons,
    });

    logger.debug(`Updated Message 2 for idea ${idea.id}: ${approved} approved, ${rejected} rejected, ${pending} pending`);

  } catch (error) {
    logger.warn(`Failed to update Message 2 for idea ${idea.id}:`, error);
  }
}

/**
 * Cancel any pending extraction for a thread
 * Call this when an idea is finalized to clean up
 */
export function cancelPendingExtraction(threadId: string): void {
  const timer = pendingExtractions.get(threadId);
  if (timer) {
    clearTimeout(timer);
    pendingExtractions.delete(threadId);
    logger.debug(`Cancelled pending extraction for thread ${threadId}`);
  }
}
