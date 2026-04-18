import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { SlashCommand } from '../../../types/command.types.js';
import { GamblingStatsService } from '../services/GamblingStatsService.js';
import { RouletteService } from '../services/RouletteService.js';
import { PointsService } from '../../points/services/PointsService.js';
import { handleRoulette } from './handlers/rouletteHandler.js';

let statsService: GamblingStatsService | null = null;
let rouletteService: RouletteService | null = null;
let pointsService: PointsService | null = null;

export function setStatsService(service: GamblingStatsService): void { statsService = service; }
export function setRouletteService(service: RouletteService): void { rouletteService = service; }
export function setPointsService(service: PointsService): void { pointsService = service; }

export const command: SlashCommand = {
  type: 'slash',
  data: new SlashCommandBuilder()
    .setName('roulette')
    .setDescription('Open a multiplayer roulette table (requires voice channel)')
    .addIntegerOption(opt =>
      opt.setName('duration')
        .setDescription('Betting duration in seconds (default: 30)')
        .setRequired(false)
        .setMinValue(15)
        .setMaxValue(120)
    ) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!statsService || !rouletteService || !pointsService) {
      await interaction.reply({ content: 'Gambling service not available.', ephemeral: true });
      return;
    }
    await handleRoulette(interaction, statsService, rouletteService, pointsService);
  },
};
