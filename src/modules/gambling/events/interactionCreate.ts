import { Interaction } from 'discord.js';
import { AnyModuleEvent } from '../../../types/event.types.js';
import { GamblingStatsService } from '../services/GamblingStatsService.js';
import { BlackjackService } from '../services/BlackjackService.js';
import { RouletteService } from '../services/RouletteService.js';
import { PointsService } from '../../points/services/PointsService.js';

import { handleCoinflipButton } from './handlers/coinflipHandler.js';
import { handleBlackjackButton } from './handlers/blackjackHandler.js';
import { handleRouletteButton, handleRouletteModal } from './handlers/rouletteHandler.js';
import { handleRPSButton } from './handlers/rpsHandler.js';
import { handleCasinoButton, handleCasinoModal } from './handlers/casinoMenuHandler.js';
import { RPSService } from '../services/RPSService.js';

let statsService: GamblingStatsService | null = null;
let blackjackService: BlackjackService | null = null;
let rouletteService: RouletteService | null = null;
let rpsService: RPSService | null = null;
let pointsService: PointsService | null = null;

export function setStatsService(service: GamblingStatsService): void {
  statsService = service;
}

export function setBlackjackService(service: BlackjackService): void {
  blackjackService = service;
}

export function setRouletteService(service: RouletteService): void {
  rouletteService = service;
}

export function setRPSService(service: RPSService): void {
  rpsService = service;
}

export function setPointsService(service: PointsService): void {
  pointsService = service;
}

export const interactionCreateEvent: AnyModuleEvent = {
  name: 'interactionCreate',
  once: false,

  async execute(...args: unknown[]): Promise<void> {
    const interaction = args[0] as Interaction;

    if (!statsService || !pointsService) return;
    if (!interaction.guildId) return;

    // Handle button interactions
    if (interaction.isButton()) {
      const customId = interaction.customId;

      if (customId.startsWith('coinflip:')) {
        await handleCoinflipButton(interaction, statsService, pointsService);
      } else if (customId.startsWith('blackjack:') && blackjackService) {
        await handleBlackjackButton(interaction, statsService, blackjackService, pointsService);
      } else if (customId.startsWith('roulette:') && rouletteService) {
        await handleRouletteButton(interaction, rouletteService, pointsService);
      } else if (customId.startsWith('rps:') && rpsService) {
        await handleRPSButton(interaction, statsService, rpsService, pointsService);
      } else if (customId.startsWith('casino:') && blackjackService) {
        await handleCasinoButton(interaction, statsService, blackjackService, pointsService);
      }
    }

    // Handle modal submissions
    if (interaction.isModalSubmit()) {
      const customId = interaction.customId;

      if (customId.startsWith('roulette:') && rouletteService) {
        await handleRouletteModal(interaction, rouletteService, pointsService);
      } else if (customId.startsWith('casino:') && blackjackService) {
        await handleCasinoModal(interaction, statsService, blackjackService, pointsService);
      }
    }
  },
};
