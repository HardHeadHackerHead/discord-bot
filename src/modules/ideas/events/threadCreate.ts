import { ThreadChannel, ChannelType, ForumChannel } from 'discord.js';
import { defineEvent } from '../../../types/event.types.js';
import { getIdeasService } from '../services/IdeasService.js';
import { IdeasPanel } from '../components/IdeasPanel.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('Ideas:ThreadCreate');

/**
 * Handle new forum posts (threads created in forum channels)
 */
export const threadCreateEvent = defineEvent(
  'threadCreate',
  async (thread: ThreadChannel, newlyCreated: boolean) => {
    // Only handle newly created threads
    if (!newlyCreated) {
      return;
    }

    // Only handle public threads in forum channels
    if (thread.type !== ChannelType.PublicThread) {
      return;
    }

    // Need guildId
    if (!thread.guildId) {
      logger.debug('Thread has no guildId, skipping');
      return;
    }

    const service = getIdeasService();
    if (!service) {
      logger.debug('Ideas service not initialized');
      return;
    }

    // Check if the parent is a forum channel
    const parent = thread.parent;
    if (!parent) {
      logger.debug(`Thread ${thread.id} has no parent channel`);
      return;
    }

    if (parent.type !== ChannelType.GuildForum) {
      logger.debug(`Parent channel ${parent.id} is not a forum (type: ${parent.type})`);
      return;
    }

    const forumChannel = parent as ForumChannel;

    // Check if this forum is configured as the ideas channel
    const configuredForumId = await service.getForumChannelId(thread.guildId);
    logger.debug(`Configured forum ID: ${configuredForumId}, This forum ID: ${forumChannel.id}`);

    if (!configuredForumId) {
      logger.debug(`No ideas forum configured for guild ${thread.guildId}`);
      return;
    }

    if (configuredForumId !== forumChannel.id) {
      logger.debug(`Forum ${forumChannel.id} is not the configured ideas forum`);
      return;
    }

    logger.info(`New idea thread created: "${thread.name}" in ${forumChannel.name}`);

    try {
      // Small delay to ensure the starter message is available
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Fetch the starter message (the original forum post)
      let starterMessage = await thread.fetchStarterMessage();

      // Retry once if starter message not found
      if (!starterMessage) {
        logger.debug('Starter message not found, retrying after delay...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        starterMessage = await thread.fetchStarterMessage();
      }

      if (!starterMessage) {
        logger.warn(`Could not fetch starter message for thread ${thread.id}`);
        return;
      }

      // Create the idea in database
      const idea = await service.createIdea(
        thread.guildId,
        forumChannel.id,
        thread.id,
        starterMessage.id,
        starterMessage.author.id,
        thread.name,
        starterMessage.content || '(No content)'
      );

      // Message 1: Draft (shows idea content, OP can update/finalize)
      // Post immediately without AI summary - we'll update it in the background
      const draftEmbed = IdeasPanel.createDraftEmbed(idea, [], null);
      const draftButtons = IdeasPanel.createDraftButtons(idea.id);

      const message1 = await thread.send({
        embeds: [draftEmbed],
        components: draftButtons,
      });

      // Save Message 1 ID for draft updates
      await service.setBotMessageId(idea.id, message1.id);
      logger.debug(`Saved Message 1 (Draft) ID ${message1.id} for idea ${idea.id}`);

      // Message 2: Suggestions Panel (extract, browse, approve/reject, voting)
      const suggestionsEmbed = IdeasPanel.createSuggestionsPanelEmbed(idea.id, 0, 0);
      const suggestionsButtons = IdeasPanel.createSuggestionsPanelButtons(idea.id, false);

      const message2 = await thread.send({
        embeds: [suggestionsEmbed],
        components: suggestionsButtons,
      });

      // Save Message 2 ID for suggestions panel
      await service.setBotMessageId2(idea.id, message2.id);
      logger.debug(`Saved Message 2 (Suggestions) ID ${message2.id} for idea ${idea.id}`);

      logger.info(`Idea "${idea.title}" tracked with ID ${idea.id}`);

      // Generate AI draft summary in the background and update Message 1 when ready
      if (service.hasAIProvider()) {
        (async () => {
          try {
            logger.debug(`Generating initial draft summary for idea ${idea.id} in background`);
            const draftSummary = await service.generateDraftSummary(idea.id);
            logger.debug(`Generated draft summary for idea ${idea.id}`);

            // Fetch fresh idea data and update Message 1
            const updatedIdea = await service.getIdea(idea.id);
            if (updatedIdea) {
              const approvedSuggestions = await service.getApprovedSuggestionsForIdea(idea.id);
              const updatedEmbed = IdeasPanel.createDraftEmbed(updatedIdea, approvedSuggestions, draftSummary);
              const updatedButtons = IdeasPanel.createDraftButtons(idea.id);

              await message1.edit({
                embeds: [updatedEmbed],
                components: updatedButtons,
              });
              logger.debug(`Updated Message 1 with AI summary for idea ${idea.id}`);
            }
          } catch (error) {
            logger.warn(`Failed to generate/update draft summary for idea ${idea.id}:`, error);
            // Silent failure - the message was already posted without the summary
          }
        })();
      }

    } catch (error) {
      logger.error(`Failed to process new idea thread:`, error);
    }
  }
);
