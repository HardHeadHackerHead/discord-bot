import { Interaction, StringSelectMenuInteraction, AttachmentBuilder, MessageFlags } from 'discord.js';
import { AnyModuleEvent } from '../../../types/event.types.js';
import { LaserEyesService, GLOW_COLORS, resolveGlowColor, pickRandomGlowColor } from '../services/LaserEyesService.js';
import {
  LaserEyesPanel,
  LaserEyesPanelState,
  getPanelState,
  setPanelState,
  COLOR_RANDOM_VALUE,
  fryLevelByValue,
} from '../components/LaserEyesPanel.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('LaserEyes:InteractionCreate');

let service: LaserEyesService | null = null;

export function setService(s: LaserEyesService): void {
  service = s;
}

export const interactionCreateEvent: AnyModuleEvent = {
  name: 'interactionCreate',
  once: false,

  async execute(...args: unknown[]): Promise<void> {
    const interaction = args[0] as Interaction;
    if (!service) return;

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'lasereyes:color' || interaction.customId === 'lasereyes:fry') {
        await handlePanelSelect(interaction, service);
      }
    }
  },
};

/**
 * Handle a select-menu change on a laser-eyes panel: look up state, mutate
 * the relevant field, re-render the image with the new settings, and edit
 * the original message in place.
 */
async function handlePanelSelect(
  interaction: StringSelectMenuInteraction,
  svc: LaserEyesService
): Promise<void> {
  const messageId = interaction.message.id;
  const state = getPanelState(messageId);

  if (!state) {
    await interaction.reply({
      content: '⚠️ This panel has expired (state was cleared). Run `/lasereyes` again to start over.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return;
  }

  // Only the original requester can drive the panel. Anyone else's clicks
  // get an ephemeral nope.
  if (interaction.user.id !== state.requesterId) {
    await interaction.reply({
      content: '✋ Only the person who ran the command can change these settings. Run your own `/lasereyes`.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return;
  }

  const value = interaction.values[0];
  if (!value) return;

  // Apply the change to a working copy of state.
  const next: LaserEyesPanelState = { ...state };

  if (interaction.customId === 'lasereyes:color') {
    if (value === COLOR_RANDOM_VALUE) {
      const random = pickRandomGlowColor();
      next.colorChoice = COLOR_RANDOM_VALUE;
      next.hexColor = random.hex;
    } else if (value in GLOW_COLORS) {
      next.colorChoice = value;
      next.hexColor = GLOW_COLORS[value as keyof typeof GLOW_COLORS];
    } else {
      // Unknown value (shouldn't happen with our preset list).
      const resolved = resolveGlowColor(value);
      if (!resolved) return;
      next.colorChoice = value;
      next.hexColor = resolved;
    }
  } else if (interaction.customId === 'lasereyes:fry') {
    const level = fryLevelByValue(value);
    if (!level) return;
    next.fryIntensity = level.intensity;
  }

  // Acknowledge — re-rendering takes a few seconds, defer the update so
  // Discord doesn't time out the interaction (3s ack window).
  await interaction.deferUpdate().catch(() => {});

  try {
    const inputBuffer = await svc.fetchImage(next.sourceUrl);
    const { buffer: resultBuffer, eyesDetected } = await svc.applyLaserEyes(
      inputBuffer,
      next.requesterId,
      next.hexColor,
      next.fryIntensity,
      true, // skipCooldown — panel re-renders shouldn't burn the cooldown
      true, // eyesOptional — keep working even if detection fails on re-render
    );

    next.eyesDetected = eyesDetected;

    const file = new AttachmentBuilder(resultBuffer, { name: 'fry.png' });
    await interaction.editReply({
      content: LaserEyesPanel.buildContent(next),
      files: [file],
      components: LaserEyesPanel.buildComponents(next),
    });

    setPanelState(messageId, next);
  } catch (error) {
    logger.error('Panel re-render failed:', error);
    await interaction.followUp({
      content: '💥 Re-render failed. Try a different combination.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  }
}
