/**
 * Interaction Create Event Handler
 * Handles button interactions for poke and wave responses
 */

import { Interaction, ButtonInteraction, GuildMember } from 'discord.js';
import type { AnyModuleEvent } from '../../../types/event.types.js';
import type { PokeHandler } from '../services/PokeHandler.js';
import type { WaveHandler } from '../services/WaveHandler.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('WebsiteIntegration:Interaction');

let pokeHandler: PokeHandler | null = null;
let waveHandler: WaveHandler | null = null;

export function setPokeHandler(handler: PokeHandler): void {
  pokeHandler = handler;
}

export function setWaveHandler(handler: WaveHandler): void {
  waveHandler = handler;
}

export const interactionCreateEvent: AnyModuleEvent = {
  name: 'interactionCreate',
  once: false,

  async execute(...args: unknown[]): Promise<void> {
    const interaction = args[0] as Interaction;

    // Only handle button interactions
    if (!interaction.isButton()) return;

    // Handle poke responses
    if (interaction.customId.startsWith('poke_response:') && pokeHandler) {
      await handlePokeResponse(interaction);
      return;
    }

    // Handle wave back responses
    if (interaction.customId.startsWith('wave_back:') && waveHandler) {
      await handleWaveBack(interaction);
      return;
    }
  },
};

async function handlePokeResponse(interaction: ButtonInteraction): Promise<void> {
  // Parse the custom ID: poke_response:{interactionId}:{responseId}
  const parts = interaction.customId.split(':');
  const interactionId = parts[1];
  const responseId = parts[2];

  if (!interactionId || !responseId) {
    await interaction.reply({
      content: 'Invalid response button.',
      ephemeral: true,
    });
    return;
  }

  // Check if poke is still active
  if (!pokeHandler?.isPokeActive(interactionId)) {
    await interaction.reply({
      content: 'This poke has already been responded to or has expired.',
      ephemeral: true,
    });
    return;
  }

  // Get the member who clicked
  const member = interaction.member as GuildMember | null;
  if (!member) {
    await interaction.reply({
      content: 'Could not identify you. Please try again.',
      ephemeral: true,
    });
    return;
  }

  // Defer the update while we process
  await interaction.deferUpdate();

  try {
    const success = await pokeHandler.handleResponse(
      interactionId,
      responseId,
      member,
      interaction.message
    );

    if (!success) {
      // The poke was already responded to by someone else
      await interaction.followUp({
        content: 'Someone already responded to this poke!',
        ephemeral: true,
      });
    }
  } catch (error) {
    logger.error('Error handling poke response:', error);
    await interaction.followUp({
      content: 'An error occurred while processing your response.',
      ephemeral: true,
    });
  }
}

async function handleWaveBack(interaction: ButtonInteraction): Promise<void> {
  // Parse the custom ID: wave_back:{interactionId}
  const parts = interaction.customId.split(':');
  const interactionId = parts[1];

  if (!interactionId) {
    await interaction.reply({
      content: 'Invalid wave button.',
      ephemeral: true,
    });
    return;
  }

  // Check if wave is still active
  if (!waveHandler?.isWaveActive(interactionId)) {
    await interaction.reply({
      content: 'This wave has expired.',
      ephemeral: true,
    });
    return;
  }

  // Get the member who clicked
  const member = interaction.member as GuildMember | null;
  if (!member) {
    await interaction.reply({
      content: 'Could not identify you. Please try again.',
      ephemeral: true,
    });
    return;
  }

  // Defer the reply while we process
  await interaction.deferReply({ ephemeral: true });

  try {
    const result = await waveHandler.handleWaveBack(
      interactionId,
      member,
      interaction.message
    );

    if (result.success) {
      await interaction.editReply({
        content: '👋 You waved back! The website visitor can see your wave!',
      });
    } else if (result.alreadyWaved) {
      await interaction.editReply({
        content: "You've already waved back to this visitor!",
      });
    } else {
      await interaction.editReply({
        content: 'Failed to send your wave. The visitor may have left.',
      });
    }
  } catch (error) {
    logger.error('Error handling wave back:', error);
    await interaction.editReply({
      content: 'An error occurred while processing your wave.',
    });
  }
}
