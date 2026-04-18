import {
  Message,
  GuildMember,
  ThreadChannel,
  TextChannel,
  AttachmentBuilder,
} from 'discord.js';
import { AnyModuleEvent } from '../../../types/event.types.js';
import { HumorCompetitionService } from '../services/HumorCompetitionService.js';
import { HumorPanel } from '../components/HumorPanel.js';
import { getModuleSettingsService } from '../../../core/settings/ModuleSettingsService.js';
import { Logger } from '../../../shared/utils/logger.js';

interface HumorSettingsShape extends Record<string, unknown> {
  announce_channel_id: string | null;
}

async function resolveAnnounceChannelId(
  guildId: string,
  svc: HumorCompetitionService
): Promise<string | null> {
  const settingsService = getModuleSettingsService();
  if (settingsService) {
    const userSettings = await settingsService.getSettings<HumorSettingsShape>('humor-competition', guildId);
    if (userSettings.announce_channel_id) {
      return userSettings.announce_channel_id;
    }
  }
  const settings = await svc.getGuildSettings(guildId);
  return settings?.announce_channel_id ?? null;
}

const logger = new Logger('HumorCompetition:MessageCreate');

let service: HumorCompetitionService | null = null;

export function setService(s: HumorCompetitionService): void {
  service = s;
}

/** Auto-delete delay for warning messages (ms) */
const WARNING_DELETE_DELAY = 12_000;

/**
 * Watches for messages posted in competition forum posts.
 *
 * Rules:
 * - Non-image messages → deleted + temporary warning
 * - First image from a trusted role member → source image (original deleted, embed posted)
 * - One image per person — if their old message was deleted they can resubmit
 * - Duplicate posts (while existing one is still there) → deleted + temporary warning
 * - Bot auto-reacts submissions with 👍 and 👎
 */
export const messageCreateEvent: AnyModuleEvent = {
  name: 'messageCreate',
  once: false,

  async execute(...args: unknown[]): Promise<void> {
    const message = args[0] as Message;
    if (!service) return;
    if (message.author.bot) return;
    if (!message.guild || !message.channel.isThread()) return;

    await handleThreadMessage(message, message.channel as ThreadChannel, service);
  },
};

async function handleThreadMessage(
  message: Message,
  thread: ThreadChannel,
  svc: HumorCompetitionService
): Promise<void> {
  // Check if this thread is in our index
  const threadIndex = await svc.getThreadIndex(thread.id);
  if (!threadIndex) return;

  const settings = await svc.getGuildSettings(threadIndex.guild_id);
  if (!settings) return;

  // Check if competition already has a winner (ended)
  const existingWinner = await svc.getWinnerByThread(thread.id);
  if (existingWinner) {
    // Competition ended — delete everything
    await deleteWithWarning(message, 'This competition has ended.');
    return;
  }

  const imageAttachment = message.attachments.find(a =>
    a.contentType?.startsWith('image/') ?? false
  );

  // No image → delete + warn
  if (!imageAttachment) {
    await deleteWithWarning(message, 'Only image submissions are allowed in this thread.');
    return;
  }

  const member = message.member as GuildMember;

  // Check if source image has been posted yet (any submissions = source was posted)
  const submissions = await svc.getSubmissions(thread.id);
  const sourcePosted = submissions.length > 0 || await threadHasSourceEmbed(thread);

  if (!sourcePosted) {
    // Waiting for source — only trusted role can post
    const isTrusted = settings.trusted_role_id
      ? member.roles.cache.has(settings.trusted_role_id)
      : false;

    if (isTrusted) {
      await handleSourceImage(message, thread, imageAttachment.url, svc);
    } else {
      await deleteWithWarning(message, 'Waiting for a Humor Manager to post the source image first.');
    }
    return;
  }

  // Source is posted — this is a submission
  await handleSubmission(message, thread, imageAttachment.url, settings, svc);
}

/**
 * Check if the thread already has a source image embed from the bot.
 */
async function threadHasSourceEmbed(thread: ThreadChannel): Promise<boolean> {
  try {
    const messages = await thread.messages.fetch({ limit: 10 });
    return messages.some(m =>
      m.author.bot && m.embeds.some(e => e.title?.includes("Today's Source Image"))
    );
  } catch {
    return false;
  }
}

async function handleSourceImage(
  message: Message,
  thread: ThreadChannel,
  imageUrl: string,
  svc: HumorCompetitionService
): Promise<void> {
  try {
    const avatarUrl = message.author.displayAvatarURL({ size: 128 });

    // Re-upload the image as a bot attachment so the URL survives message deletion
    const attachment = new AttachmentBuilder(imageUrl, { name: 'source.png' });
    const botMsg = await thread.send({
      embeds: [HumorPanel.createSourceImageEmbed('attachment://source.png', message.author.id, avatarUrl)],
      files: [attachment],
    });

    // Now safe to delete the manager's original message
    try { await message.delete(); } catch { /* ignore */ }

    // Use the bot's new attachment URL for the panel thumbnail
    const botImageUrl = botMsg.embeds[0]?.image?.url ?? null;

    // Update the panel to active state
    const threadIndex = await svc.getThreadIndex(thread.id);
    if (threadIndex?.panel_message_id) {
      try {
        const panelMsg = await thread.messages.fetch(threadIndex.panel_message_id);
        await panelMsg.edit({
          embeds: [HumorPanel.createActivePanel(0, botImageUrl)],
          components: HumorPanel.createManagementButtons(thread.id),
        });
      } catch { /* panel gone */ }
    }

    // Cross-post announcement to the configured announce channel
    const announceChannelId = await resolveAnnounceChannelId(message.guild!.id, svc);
    if (announceChannelId) {
      try {
        const announceChannel = await message.guild!.channels.fetch(announceChannelId);
        if (announceChannel && announceChannel.isTextBased()) {
          const announcementImage = new AttachmentBuilder(imageUrl, { name: 'source-announce.png' });
          await (announceChannel as TextChannel).send({
            embeds: [HumorPanel.createGeneralAnnouncement(
              'attachment://source-announce.png',
              thread.id,
              message.author.id,
              avatarUrl
            )],
            files: [announcementImage],
          });
        }
      } catch (error) {
        logger.debug('Could not post announcement to announce channel:', error);
      }
    }

    logger.info(`Source image set in thread ${thread.id} by ${message.author.username}`);
  } catch (error) {
    logger.error('Error handling source image:', error);
  }
}

async function handleSubmission(
  message: Message,
  thread: ThreadChannel,
  imageUrl: string,
  settings: import('../services/HumorCompetitionService.js').GuildSettings,
  svc: HumorCompetitionService
): Promise<void> {
  try {
    // Check for existing submission in DB
    const existing = await svc.getUserSubmission(thread.id, message.author.id);

    if (existing) {
      // Check if their old message still exists
      let oldMessageExists = false;
      try {
        await thread.messages.fetch(existing.message_id);
        oldMessageExists = true;
      } catch {
        oldMessageExists = false;
      }

      if (oldMessageExists) {
        await deleteWithWarning(message, 'You already submitted an entry! One submission per person.');
        return;
      }

      // Old message gone — clear stale record
      await svc.deleteSubmission(existing.id);
    }

    const submission = await svc.addSubmission(
      thread.id,
      settings.guild_id,
      message.author.id,
      message.id,
      imageUrl
    );

    if (!submission) return;

    await message.react('👍');
    await message.react('👎');

    logger.debug(`Submission by ${message.author.username} in thread ${thread.id}`);

    // Update panel count
    const threadIndex = await svc.getThreadIndex(thread.id);
    if (threadIndex?.panel_message_id) {
      try {
        const submissions = await svc.getSubmissions(thread.id);
        const panelMsg = await thread.messages.fetch(threadIndex.panel_message_id);
        await panelMsg.edit({
          embeds: [HumorPanel.createActivePanel(submissions.length, null)],
          components: HumorPanel.createManagementButtons(thread.id),
        });
      } catch { /* non-critical */ }
    }
  } catch (error) {
    logger.error('Error handling submission:', error);
  }
}

/**
 * Delete a user's message and send a temporary warning that auto-deletes after ~12 seconds.
 */
async function deleteWithWarning(message: Message, warning: string): Promise<void> {
  try { await message.delete(); } catch { /* ignore */ }

  try {
    const warn = await (message.channel as ThreadChannel).send({
      content: `<@${message.author.id}> ${warning}`,
    });
    setTimeout(async () => {
      try { await warn.delete(); } catch { /* ignore */ }
    }, WARNING_DELETE_DELAY);
  } catch { /* ignore */ }
}
