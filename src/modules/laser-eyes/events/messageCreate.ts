import { Message, AttachmentBuilder } from 'discord.js';
import { AnyModuleEvent } from '../../../types/event.types.js';
import { LaserEyesService, EyesNotDetectedError, GLOW_COLORS, resolveGlowColor, pickRandomGlowColor } from '../services/LaserEyesService.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('LaserEyes:MessageCreate');

let service: LaserEyesService | null = null;

export function setService(s: LaserEyesService): void {
  service = s;
}

/**
 * Trigger laser eyes when someone @mentions the bot in a message that contains
 * an image attachment. Optional: mentioning another user also targets their avatar
 * if no attachment is present. This gives a natural, "aura"-feeling alternative
 * to typing a slash command.
 */
export const messageCreateEvent: AnyModuleEvent = {
  name: 'messageCreate',
  once: false,

  async execute(...args: unknown[]): Promise<void> {
    const message = args[0] as Message;
    if (!service) return;
    if (message.author.bot) return;
    if (!message.guild) return;

    const botUser = message.client.user;
    if (!botUser) return;
    if (!message.mentions.has(botUser, { ignoreEveryone: true, ignoreRoles: true })) return;

    // Strip out the bot mention(s) and check that the remaining text (if any)
    // looks like a laser-eyes invocation. If there's no text at all but there's
    // an image, that's also a valid trigger.
    const mentionStripped = message.content
      .replace(new RegExp(`<@!?${botUser.id}>`, 'g'), '')
      .trim()
      .toLowerCase();

    const imageAttachment = message.attachments.find(a =>
      a.contentType?.startsWith('image/') ?? false
    );

    // Another user mentioned (not the bot) — we can target their avatar.
    const otherMention = message.mentions.users.find(u => u.id !== botUser.id);

    const keywordMatches =
      mentionStripped === '' ||
      /\blaser\s*eyes?\b/.test(mentionStripped) ||
      /\bzap\b/.test(mentionStripped);

    // Require a clear trigger so the bot doesn't try to laser random @mentions.
    const explicitRequest = /\blaser\s*eyes?\b/.test(mentionStripped) || /\bzap\b/.test(mentionStripped);
    if (!explicitRequest && !imageAttachment) return;
    if (!keywordMatches && !imageAttachment) return;

    if (!service.isAvailable()) {
      await message.reply('⚠️ Laser eyes are offline — Haar cascades missing from `assets/opencv-cascades/`.').catch(() => {});
      return;
    }

    const cooldown = service.getCooldownRemaining(message.author.id);
    if (cooldown > 0) {
      await message.reply(`🧊 Lasers cooling down. Try again in ${cooldown}s.`).catch(() => {});
      return;
    }

    let sourceUrl: string;
    let label: string;

    if (imageAttachment) {
      sourceUrl = imageAttachment.url;
      label = 'this image';
    } else if (otherMention) {
      sourceUrl = otherMention.displayAvatarURL({ extension: 'png', size: 1024, forceStatic: true });
      label = `<@${otherMention.id}>'s avatar`;
    } else {
      sourceUrl = message.author.displayAvatarURL({ extension: 'png', size: 1024, forceStatic: true });
      label = 'your avatar';
    }

    // Show typing so the user sees the bot is working on it (API calls take ~5-15s).
    if ('sendTyping' in message.channel) {
      try { await message.channel.sendTyping(); } catch { /* ignore */ }
    }

    // Parse color from the message text — first preset word found wins, else
    // first #hex found, else random.
    let hexColor: string | null = null;
    let colorLabel: string = '';
    for (const name of Object.keys(GLOW_COLORS)) {
      if (new RegExp(`\\b${name}\\b`, 'i').test(mentionStripped)) {
        hexColor = resolveGlowColor(name);
        colorLabel = name;
        break;
      }
    }
    if (!hexColor) {
      const hexMatch = mentionStripped.match(/#[0-9a-f]{6}\b/i);
      if (hexMatch) {
        hexColor = resolveGlowColor(hexMatch[0]);
        colorLabel = hexMatch[0];
      }
    }
    if (!hexColor) {
      const random = pickRandomGlowColor();
      hexColor = random.hex;
      colorLabel = random.name;
    }

    // Deepfry trigger — keyword in the mention text.
    const deepfry = /\b(deep[\s-]?fry|deepfried|fry)\b/i.test(mentionStripped);

    try {
      const inputBuffer = await service.fetchImage(sourceUrl);
      const { buffer: resultBuffer } = await service.applyLaserEyes(
        inputBuffer, message.author.id, hexColor!, deepfry ? 1 : 0
      );

      const file = new AttachmentBuilder(resultBuffer, { name: 'lasereyes.png' });
      const fryNote = deepfry ? ' 🍟 (deepfried)' : '';
      await message.reply({
        content: `🔴 ${colorLabel} lasers charged on ${label}.${fryNote} ⚡`,
        files: [file],
      });
    } catch (error) {
      // No ephemeral replies for regular messages — instead try DMing the
      // invoker so the error doesn't clutter the public channel. Falls back
      // to an auto-deleting channel reply if DMs are closed.
      const errText = error instanceof EyesNotDetectedError
        ? `👁️ I couldn't find any eyes on ${label}. Try a clearer, front-facing portrait.`
        : '💥 The laser array misfired. Try again in a moment.';

      if (!(error instanceof EyesNotDetectedError)) {
        logger.error('Laser eyes mention handler failed:', error);
      }

      try {
        await message.author.send(errText);
      } catch {
        // User has DMs closed — fall back to a channel reply that auto-deletes.
        const reply = await message.reply(errText).catch(() => null);
        if (reply) {
          setTimeout(() => { reply.delete().catch(() => {}); }, 10_000);
        }
      }
    }
  },
};
