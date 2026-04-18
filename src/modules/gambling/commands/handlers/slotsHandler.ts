import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { GamblingStatsService } from '../../services/GamblingStatsService.js';
import { PointsService } from '../../../points/services/PointsService.js';
import { playSlots, createSlotsResultEmbed, createSpinningEmbed } from '../../games/slots.js';
import { checkAndAnnounceBankruptcy } from '../../utils/bankruptcy.js';

export async function handleSlots(
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

  // Deduct bet immediately
  await pointsService.removePoints(userId, guildId, betAmount, 'Slots bet', interaction.user.id);

  // Show spinning animation
  await interaction.reply({
    embeds: [createSpinningEmbed()],
  });

  // Wait a moment for suspense
  await new Promise(resolve => setTimeout(resolve, 1500));

  // Play the game
  const result = playSlots(betAmount);

  // Record result
  await statsService.recordGameResult(userId, guildId, 'slots', betAmount, result);

  // Add winnings if any
  if (result.payout > 0) {
    await pointsService.addPoints(userId, guildId, result.payout, 'Slots winnings', 'other');
  }

  // Get fresh balance for display
  const updatedPoints = await pointsService.getPoints(userId, guildId);
  const newBalance = updatedPoints?.balance ?? 0;

  // Show result
  await interaction.editReply({
    embeds: [createSlotsResultEmbed(result, betAmount, newBalance)],
  });

  await checkAndAnnounceBankruptcy(interaction, userId, guildId, statsService, pointsService);
}

export async function handlePaytable(interaction: ChatInputCommandInteraction): Promise<void> {
  const { createPaytableEmbed } = await import('../../games/slots.js');
  await interaction.reply({
    embeds: [createPaytableEmbed()],
    ephemeral: true,
  });
}
