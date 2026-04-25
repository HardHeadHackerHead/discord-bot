import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AttachmentBuilder,
  User,
  Message,
  Attachment,
} from 'discord.js';
import { SlashCommand } from '../../../types/command.types.js';
import { LaserEyesService, pickRandomGlowColor } from '../services/LaserEyesService.js';
import { LaserEyesPanel, setPanelState, COLOR_RANDOM_VALUE } from '../components/LaserEyesPanel.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('LaserEyes:Fry');

let service: LaserEyesService | null = null;

export function setService(s: LaserEyesService): void {
  service = s;
}

/** Default deepfry intensity for a fresh /fry invocation. Users adjust via the panel. */
const DEFAULT_FRY_INTENSITY = 0.5;

export const command: SlashCommand = {
  type: 'slash',
  data: new SlashCommandBuilder()
    .setName('fry')
    .setDescription('Fry an avatar or image. 🍟 Adds laser eyes if a face is detected.')
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('Whose avatar to fry (defaults to yourself or the most recent image in chat)')
        .setRequired(false)
    )
    .addAttachmentOption(opt =>
      opt.setName('image')
        .setDescription('Or fry a specific image')
        .setRequired(false)
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!service) {
      await interaction.reply({ content: 'Fry service not initialized.', ephemeral: true });
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
        content: `🧊 The fryer is cooling down. Try again in ${cooldown}s.`,
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

    // Roll a random glow color to start. User can override via the panel.
    const random = pickRandomGlowColor();
    const hexColor = random.hex;
    const colorChoice = COLOR_RANDOM_VALUE;
    const fryIntensity = DEFAULT_FRY_INTENSITY;

    // Resolve source image. Priority:
    //   1. `image` attachment (explicit)
    //   2. `user` option → that user's avatar
    //   3. Most recent image posted by the invoker in this channel
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
      const { buffer: resultBuffer, eyesDetected } = await service.applyLaserEyes(
        inputBuffer,
        interaction.user.id,
        hexColor,
        fryIntensity,
        false, // don't skip cooldown on initial invocation
        true,  // eyesOptional — fall back to fry-only if no face found
      );

      const initialState = {
        sourceUrl,
        colorChoice,
        hexColor,
        fryIntensity,
        requesterId: interaction.user.id,
        label,
        eyesDetected,
        lastTouched: Date.now(),
      };

      const file = new AttachmentBuilder(resultBuffer, { name: 'fry.png' });
      const sent = await interaction.editReply({
        content: LaserEyesPanel.buildContent(initialState),
        files: [file],
        components: LaserEyesPanel.buildComponents(initialState),
      });

      // Save panel state under the message ID so the interaction handler
      // can look it up and re-render on subsequent select changes.
      setPanelState(sent.id, initialState);
    } catch (error) {
      // Eye-detection failure is now handled inside the service via
      // eyesOptional=true, so reaching this branch means a real fault.
      await interaction.deleteReply().catch(() => {});
      logger.error('/fry failed:', error);
      await interaction.followUp({
        content: '💥 The fryer misfired. Try again in a moment.',
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
