import { ButtonInteraction, EmbedBuilder } from 'discord.js';
import { GamblingStatsService } from '../../services/GamblingStatsService.js';
import { PointsService } from '../../../points/services/PointsService.js';
import {
  playCoinflip,
  createCoinflipSelectionEmbed,
  createCoinflipResultEmbed,
  createCoinflipRebetButtons,
  CoinSide,
} from '../../games/coinflip.js';
import { checkAndAnnounceBankruptcy } from '../../utils/bankruptcy.js';

export async function handleCoinflipButton(
  interaction: ButtonInteraction,
  statsService: GamblingStatsService,
  pointsService: PointsService
): Promise<void> {
  const parts = interaction.customId.split(':');
  const action = parts[1] ?? '';
  const userId = interaction.user.id;
  const guildId = interaction.guildId!;

  // --- Cancel: refund and close ---
  if (action === 'cancel') {
    const betAmount = parseInt(parts[2] ?? '0');
    if (betAmount > 0) {
      await pointsService.addPoints(userId, guildId, betAmount, 'Coinflip cancelled - refund', 'other');
    }

    await interaction.update({
      embeds: [
        new EmbedBuilder()
          .setTitle('Coinflip Cancelled')
          .setDescription(`Your **${betAmount.toLocaleString()}** points have been refunded.`)
          .setColor(0x808080)
      ],
      components: [],
    });
    return;
  }

  // --- Re-bet: deduct points, show heads/tails selection (fresh game) ---
  if (action === 'rebet') {
    const betAmount = parseInt(parts[2] ?? '0');

    const pts = await pointsService.getPoints(userId, guildId);
    const balance = pts?.balance ?? 0;

    if (balance < betAmount) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setDescription('You no longer have enough points for this bet!')
            .setColor(0xe53935)
        ],
        ephemeral: true,
      });
      return;
    }

    // Deduct bet, then show the heads/tails picker
    await pointsService.removePoints(userId, guildId, betAmount, 'Coinflip bet', userId);

    const freshPts = await pointsService.getPoints(userId, guildId);
    const { embed, row } = createCoinflipSelectionEmbed(betAmount, freshPts?.balance ?? 0);

    await interaction.update({
      embeds: [embed],
      components: [row],
    });
    return;
  }

  // --- Initial choice (heads/tails): play the game ---
  const choice = action as CoinSide;
  const betAmount = parseInt(parts[2] ?? '0');

  // Points were already deducted — just play
  const result = playCoinflip(choice, betAmount);
  await statsService.recordGameResult(userId, guildId, 'coinflip', betAmount, result);

  if (result.payout > 0) {
    await pointsService.addPoints(userId, guildId, result.payout, 'Coinflip winnings', 'other');
  }

  const freshPts = await pointsService.getPoints(userId, guildId);
  const newBalance = freshPts?.balance ?? 0;

  const rebetRow = createCoinflipRebetButtons(betAmount, newBalance);

  await interaction.update({
    embeds: [createCoinflipResultEmbed(result, betAmount, newBalance)],
    components: rebetRow ? [rebetRow] : [],
  });

  await checkAndAnnounceBankruptcy(interaction, userId, guildId, statsService, pointsService);
}
