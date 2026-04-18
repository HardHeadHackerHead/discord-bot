import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { SlashCommand } from '../../../types/command.types.js';
import { GamblingStatsService } from '../services/GamblingStatsService.js';
import { BlackjackService } from '../services/BlackjackService.js';
import { PointsService } from '../../points/services/PointsService.js';
import { handleBlackjack } from './handlers/blackjackHandler.js';

let statsService: GamblingStatsService | null = null;
let blackjackService: BlackjackService | null = null;
let pointsService: PointsService | null = null;

export function setStatsService(service: GamblingStatsService): void { statsService = service; }
export function setBlackjackService(service: BlackjackService): void { blackjackService = service; }
export function setPointsService(service: PointsService): void { pointsService = service; }

export const command: SlashCommand = {
  type: 'slash',
  data: new SlashCommandBuilder()
    .setName('bj')
    .setDescription('Play blackjack — beat the dealer for 2x (2.5x on blackjack!)')
    .addIntegerOption(opt =>
      opt.setName('bet').setDescription('Amount of points to bet').setRequired(true).setMinValue(1)
    ) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!statsService || !blackjackService || !pointsService) {
      await interaction.reply({ content: 'Gambling service not available.', ephemeral: true });
      return;
    }
    await handleBlackjack(interaction, statsService, blackjackService, pointsService);
  },
};
