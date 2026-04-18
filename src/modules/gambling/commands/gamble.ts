import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { SlashCommand } from '../../../types/command.types.js';
import { GamblingStatsService } from '../services/GamblingStatsService.js';
import { PointsService } from '../../points/services/PointsService.js';

let statsService: GamblingStatsService | null = null;
let pointsService: PointsService | null = null;

export function setStatsService(service: GamblingStatsService): void {
  statsService = service;
}

export function setPointsService(service: PointsService): void {
  pointsService = service;
}

export const command: SlashCommand = {
  type: 'slash',
  data: new SlashCommandBuilder()
    .setName('gamble')
    .setDescription('Open the casino — pick a game to play') as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    // Get balance for the header
    let balanceText = '';
    if (pointsService) {
      const pts = await pointsService.getPoints(interaction.user.id, interaction.guildId);
      balanceText = `\n**Your balance:** ${(pts?.balance ?? 0).toLocaleString()} pts\n`;
    }

    const embed = new EmbedBuilder()
      .setTitle('\u{1F3B0} Casino')
      .setDescription(
        `${balanceText}\n` +
        'Pick a game below or use a command directly.\n\n' +
        '\u{1FA99} **Coinflip** \u2014 50/50 for 2x \u2014 `/coinflip <bet>`\n' +
        '\u{1F3B0} **Slots** \u2014 Spin for up to 50x \u2014 `/slots <bet>`\n' +
        '\u{1F0CF} **Blackjack** \u2014 Beat the dealer for 2x \u2014 `/bj <bet>`\n' +
        '\u{1F3B0} **Roulette** \u2014 Multiplayer table \u2014 `/roulette`\n' +
        '\u270A **Rock Paper Scissors** \u2014 PvP wager \u2014 `/rps <opponent> <bet>`'
      )
      .setColor(0x1a6b35)
      .setFooter({ text: 'Use the buttons for quick play, or use the slash commands for full options.' });

    // Row 1: Quick-play buttons (open bet amount modals)
    const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('casino:play:coinflip')
        .setLabel('Coinflip')
        .setEmoji('\u{1FA99}')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('casino:play:slots')
        .setLabel('Slots')
        .setEmoji('\u{1F3B0}')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('casino:play:blackjack')
        .setLabel('Blackjack')
        .setEmoji('\u{1F0CF}')
        .setStyle(ButtonStyle.Primary),
    );

    // Row 2: Info buttons
    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('casino:stats')
        .setLabel('My Stats')
        .setEmoji('\u{1F4CA}')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('casino:paytable')
        .setLabel('Slots Paytable')
        .setEmoji('\u{1F4CB}')
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.reply({
      embeds: [embed],
      components: [row1, row2],
      ephemeral: true,
    });
  },
};
