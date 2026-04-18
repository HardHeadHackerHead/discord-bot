import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { SlashCommand } from '../../../types/command.types.js';
import { GamblingStatsService } from '../services/GamblingStatsService.js';
import { PointsService } from '../../points/services/PointsService.js';
import { handleSlots } from './handlers/slotsHandler.js';

let statsService: GamblingStatsService | null = null;
let pointsService: PointsService | null = null;

export function setStatsService(service: GamblingStatsService): void { statsService = service; }
export function setPointsService(service: PointsService): void { pointsService = service; }

export const command: SlashCommand = {
  type: 'slash',
  data: new SlashCommandBuilder()
    .setName('slots')
    .setDescription('Spin the slot machine — up to 50x payout!')
    .addIntegerOption(opt =>
      opt.setName('bet').setDescription('Amount of points to bet').setRequired(true).setMinValue(1)
    ) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!statsService || !pointsService) {
      await interaction.reply({ content: 'Gambling service not available.', ephemeral: true });
      return;
    }
    await handleSlots(interaction, statsService, pointsService);
  },
};
