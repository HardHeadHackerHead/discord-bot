import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { SlashCommand } from '../../../types/command.types.js';
import { RPSService } from '../services/RPSService.js';
import { PointsService } from '../../points/services/PointsService.js';
import { handleRPS } from './handlers/rpsHandler.js';

let rpsService: RPSService | null = null;
let pointsService: PointsService | null = null;

export function setRPSService(service: RPSService): void { rpsService = service; }
export function setPointsService(service: PointsService): void { pointsService = service; }

export const command: SlashCommand = {
  type: 'slash',
  data: new SlashCommandBuilder()
    .setName('rps')
    .setDescription('Challenge someone to Rock Paper Scissors!')
    .addUserOption(opt =>
      opt.setName('opponent').setDescription('User to challenge').setRequired(true)
    )
    .addIntegerOption(opt =>
      opt.setName('bet').setDescription('Amount of points to bet').setRequired(true).setMinValue(1)
    ) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!rpsService || !pointsService) {
      await interaction.reply({ content: 'Gambling service not available.', ephemeral: true });
      return;
    }
    await handleRPS(interaction, rpsService, pointsService);
  },
};
