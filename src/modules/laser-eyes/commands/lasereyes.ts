import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AttachmentBuilder,
  User,
  Message,
  Attachment,
} from 'discord.js';
import { SlashCommand } from '../../../types/command.types.js';
import { LaserEyesService, EyesNotDetectedError, GLOW_COLORS, resolveGlowColor, pickRandomGlowColor } from '../services/LaserEyesService.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('LaserEyes:Command');

let service: LaserEyesService | null = null;

export function setService(s: LaserEyesService): void {
  service = s;
}

export const command: SlashCommand = {
  type: 'slash',
  data: new SlashCommandBuilder()
    .setName('lasereyes')
    .setDescription('Charge up some laser eyes. 👁️🔴')
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('Whose avatar to zap (defaults to yourself)')
        .setRequired(false)
    )
    .addAttachmentOption(opt =>
      opt.setName('image')
        .setDescription('Or zap a custom image instead')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('color')
        .setDescription('Glow color (random if not set). Preset or #hex like #ff00ff.')
        .setRequired(false)
        .addChoices(
          ...(Object.keys(GLOW_COLORS) as (keyof typeof GLOW_COLORS)[]).map(name => ({
            name,
            value: name,
          }))
        )
    )
    .addBooleanOption(opt =>
      opt.setName('deepfry')
        .setDescription('Apply deepfried meme effect after lasering 🍟')
        .setRequired(false)
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!service) {
      await interaction.reply({ content: 'Laser eyes service not initialized.', ephemeral: true });
      return;
    }

    if (!service.isAvailable()) {
      await interaction.reply({
        content: '⚠️ Haar cascades missing from `assets/opencv-cascades/`.',
        ephemeral: true,
      });
      return;
    }

    const cooldown = service.getCooldownRemaining(interaction.user.id);
    if (cooldown > 0) {
      await interaction.reply({
        content: `🧊 Your lasers are cooling down. Try again in ${cooldown}s.`,
        ephemeral: true,
      });
      return;
    }

    const attachment = interaction.options.getAttachment('image');
    const targetUser: User = interaction.options.getUser('user') ?? interaction.user;

    logger.debug(
      `invoke by=${interaction.user.id} ` +
      `attachment=${attachment ? `${attachment.name}(${attachment.contentType ?? 'no-type'})` : 'none'} ` +
      `user=${interaction.options.getUser('user')?.id ?? 'none'}`
    );
    const colorInput = interaction.options.getString('color');
    const deepfry = interaction.options.getBoolean('deepfry') ?? false;

    // If the user picked a color, resolve it. If they didn't, roll a random
    // preset so each invocation feels different.
    let hexColor: string;
    let colorLabel: string;
    if (colorInput) {
      const resolved = resolveGlowColor(colorInput);
      if (resolved === null) {
        await interaction.reply({
          content: `❌ Invalid color \`${colorInput}\`. Use a preset or #RRGGBB hex.`,
          ephemeral: true,
        });
        return;
      }
      hexColor = resolved;
      colorLabel = colorInput;
    } else {
      const random = pickRandomGlowColor();
      hexColor = random.hex;
      colorLabel = random.name;
    }

    // Resolve the source image + a label for the response message.
    // Priority:
    //   1. `image` slash option (explicit attachment)
    //   2. `user` slash option → that user's avatar
    //   3. Most recent image posted by the invoker in this channel (lets
    //      users drop an image, then type /lasereyes — no parameter needed)
    //   4. Invoker's own avatar
    let sourceUrl: string;
    let label: string;

    if (attachment) {
      if (!isImageAttachment(attachment)) {
        await interaction.reply({
          content: '❌ That attachment is not an image.',
          ephemeral: true,
        });
        return;
      }
      sourceUrl = attachment.url;
      label = `this image`;
    } else if (interaction.options.getUser('user')) {
      sourceUrl = targetUser.displayAvatarURL({ extension: 'png', size: 1024, forceStatic: true });
      label = `<@${targetUser.id}>'s avatar`;
    } else {
      const recent = await findRecentImageFromUser(interaction);
      if (recent) {
        sourceUrl = recent.url;
        label = 'your recent image';
        logger.debug(`using recent channel image from message ${recent.messageId}`);
      } else {
        sourceUrl = interaction.user.displayAvatarURL({ extension: 'png', size: 1024, forceStatic: true });
        label = 'your avatar';
      }
    }

    await interaction.deferReply();

    try {
      const inputBuffer = await service.fetchImage(sourceUrl);

      if (deepfry) {
        // Tasting-flight mode: produce 5 deepfry intensities so the user
        // can pick the best one. Levels span from a light fry to maximum
        // chaos. Discord allows up to 10 attachments per message, so 5
        // fits comfortably.
        const levels: { pct: number; intensity: number }[] = [
          { pct: 15, intensity: 0.15 },
          { pct: 30, intensity: 0.30 },
          { pct: 50, intensity: 0.50 },
          { pct: 75, intensity: 0.75 },
          { pct: 100, intensity: 1.00 },
        ];

        const svc = service;
        const buffers = await Promise.all(
          levels.map(l => svc.applyLaserEyes(inputBuffer, interaction.user.id, hexColor, l.intensity))
        );

        const files = buffers.map((b, i) =>
          new AttachmentBuilder(b, { name: `lasereyes_fry${levels[i]!.pct}.png` })
        );

        await interaction.editReply({
          content:
            `🔴 ${colorLabel} lasers charged on ${label}. 🍟 Deepfry tasting flight ` +
            `(${levels.map(l => `${l.pct}%`).join(' / ')}) — pick your favorite. ⚡`,
          files,
        });
      } else {
        const resultBuffer = await service.applyLaserEyes(inputBuffer, interaction.user.id, hexColor, 0);
        const file = new AttachmentBuilder(resultBuffer, { name: 'lasereyes.png' });
        await interaction.editReply({
          content: `🔴 ${colorLabel} lasers charged on ${label}. ⚡`,
          files: [file],
        });
      }
    } catch (error) {
      // Error replies go back only to the invoker. The deferred "thinking…"
      // reply is public, so we delete it first and send an ephemeral follow-up.
      await interaction.deleteReply().catch(() => {});

      if (error instanceof EyesNotDetectedError) {
        await interaction.followUp({
          content: `👁️ I couldn't find any eyes on ${label}. Try a clearer, front-facing portrait.`,
          ephemeral: true,
        }).catch(() => {});
        return;
      }
      logger.error('Laser eyes command failed:', error);
      await interaction.followUp({
        content: '💥 The laser array misfired. Try again in a moment.',
        ephemeral: true,
      }).catch(() => {});
    }
  },
};

/** Check whether a Discord attachment is an image (by contentType or name/URL). */
function isImageAttachment(a: Attachment): boolean {
  return Boolean(
    a.contentType?.startsWith('image/') ||
    /\.(png|jpe?g|webp|gif|bmp)$/i.test(a.name ?? '') ||
    /\.(png|jpe?g|webp|gif|bmp)(\?|$)/i.test(a.url)
  );
}

/** How far back to scan the channel for a recent user-posted image. */
const RECENT_IMAGE_LOOKBACK_COUNT = 15;
const RECENT_IMAGE_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Look back through recent channel messages for the most recent image
 * attachment posted by the invoking user. Returns the URL + source message ID,
 * or null if nothing usable is found.
 */
async function findRecentImageFromUser(
  interaction: ChatInputCommandInteraction
): Promise<{ url: string; messageId: string } | null> {
  const channel = interaction.channel;
  if (!channel || !channel.isTextBased()) return null;

  let messages;
  try {
    messages = await channel.messages.fetch({ limit: RECENT_IMAGE_LOOKBACK_COUNT });
  } catch (error) {
    logger.debug('Could not fetch recent messages:', error);
    return null;
  }

  const now = Date.now();
  const sorted = [...messages.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp);

  for (const msg of sorted as Message[]) {
    if (msg.author.id !== interaction.user.id) continue;
    if (now - msg.createdTimestamp > RECENT_IMAGE_MAX_AGE_MS) continue;

    const img = msg.attachments.find(isImageAttachment);
    if (img) {
      return { url: img.url, messageId: msg.id };
    }
  }

  return null;
}
