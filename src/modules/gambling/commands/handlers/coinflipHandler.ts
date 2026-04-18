import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { GamblingStatsService } from '../../services/GamblingStatsService.js';
import { PointsService } from '../../../points/services/PointsService.js';
import { createCoinflipSelectionEmbed } from '../../games/coinflip.js';

export async function handleCoinflip(
  interaction: ChatInputCommandInteraction,
  statsService: GamblingStatsService,
  pointsService: PointsService
): Promise<void> {
  const betAmount = interaction.options.getInteger('bet', true);
  const userId = interaction.user.id;
  const guildId = interaction.guildId!;

  // Check balance
  const points = await pointsService.getPoints(userId, guildId);
  const balance = points?.balance ?? 0;

  if (balance < betAmount) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Insufficient Points')
          .setDescription(
            `You don't have enough points!\n` +
            `**Your Balance:** ${balance.toLocaleString()} points\n` +
            `**Bet Amount:** ${betAmount.toLocaleString()} points`
          )
          .setColor(0xFF0000)
      ],
      ephemeral: true,
    });
    return;
  }

  // Deduct bet FIRST, before showing any UI
  await pointsService.removePoints(userId, guildId, betAmount, 'Coinflip bet', userId);

  // Show selection buttons (points already taken) — ephemeral so only the player sees it
  const { embed, row } = createCoinflipSelectionEmbed(betAmount, balance - betAmount);
  await interaction.reply({
    embeds: [embed],
    components: [row],
    ephemeral: true,
  });
}
