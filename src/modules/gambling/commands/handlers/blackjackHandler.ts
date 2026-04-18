import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { GamblingStatsService } from '../../services/GamblingStatsService.js';
import { BlackjackService } from '../../services/BlackjackService.js';
import { PointsService } from '../../../points/services/PointsService.js';
import {
  createDeck,
  initializeGame,
  isBlackjack,
  determineResult,
  createBlackjackEmbed,
  createBlackjackButtons,
  createBlackjackResultEmbed,
  createBlackjackRebetButtons,
  canSplit,
} from '../../games/blackjack.js';
import { checkAndAnnounceBankruptcy } from '../../utils/bankruptcy.js';

export async function handleBlackjack(
  interaction: ChatInputCommandInteraction,
  statsService: GamblingStatsService,
  blackjackService: BlackjackService,
  pointsService: PointsService
): Promise<void> {
  const betAmount = interaction.options.getInteger('bet', true);
  await startBlackjackGame(interaction, betAmount, statsService, blackjackService, pointsService);
}

/**
 * Shared logic for starting a blackjack game — used by both the slash command
 * and the re-bet button handler.
 */
export async function startBlackjackGame(
  interaction: ChatInputCommandInteraction | import('discord.js').ButtonInteraction,
  betAmount: number,
  statsService: GamblingStatsService,
  blackjackService: BlackjackService,
  pointsService: PointsService
): Promise<void> {
  const userId = interaction.user.id;
  const guildId = interaction.guildId!;
  const isButton = interaction.isButton();

  // Check for existing game
  const existingGame = await blackjackService.getActiveGame(userId, guildId);
  if (existingGame) {
    const msg = {
      embeds: [
        new EmbedBuilder()
          .setTitle('Game In Progress')
          .setDescription(
            'You already have an active blackjack game!\n' +
            'Finish your current game before starting a new one.'
          )
          .setColor(0xFF0000)
      ],
      ephemeral: true as const,
    };

    if (isButton) {
      await interaction.reply(msg);
    } else {
      await interaction.reply(msg);
    }
    return;
  }

  // Check balance
  const points = await pointsService.getPoints(userId, guildId);
  const balance = points?.balance ?? 0;

  if (balance < betAmount) {
    const msg = {
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
      ephemeral: true as const,
    };

    if (isButton) {
      await interaction.reply(msg);
    } else {
      await interaction.reply(msg);
    }
    return;
  }

  // Deduct bet
  await pointsService.removePoints(userId, guildId, betAmount, 'Blackjack bet', userId);

  // Create deck and deal cards
  const deck = createDeck();
  const { playerHand, dealerHand, deck: remainingDeck } = initializeGame(deck);

  // Create game in database
  const game = await blackjackService.createGame(
    userId,
    guildId,
    interaction.channelId,
    betAmount,
    playerHand,
    dealerHand,
    remainingDeck
  );

  // Check for immediate blackjack
  const playerHasBlackjack = isBlackjack(playerHand);
  const dealerHasBlackjack = isBlackjack(dealerHand);

  if (playerHasBlackjack || dealerHasBlackjack) {
    const finalDealerHand = dealerHand;
    const result = determineResult(playerHand, finalDealerHand, betAmount);

    await statsService.recordGameResult(userId, guildId, 'blackjack', betAmount, result);
    await blackjackService.deleteGame(game.id);

    if (result.payout > 0) {
      await pointsService.addPoints(userId, guildId, result.payout, 'Blackjack winnings', 'other');
    }

    const freshPoints = await pointsService.getPoints(userId, guildId);
    const newBalance = freshPoints?.balance ?? 0;

    const rebetRow = createBlackjackRebetButtons(betAmount, newBalance);
    const components = rebetRow ? [rebetRow] : [];

    if (isButton) {
      await interaction.update({
        embeds: [createBlackjackResultEmbed(result, betAmount, newBalance)],
        components,
      });
    } else {
      await interaction.reply({
        embeds: [createBlackjackResultEmbed(result, betAmount, newBalance)],
        components,
        ephemeral: true,
      });
    }
    await checkAndAnnounceBankruptcy(interaction, userId, guildId, statsService, pointsService);
    return;
  }

  // Show game state with action buttons — ephemeral so only the player sees it
  const embed = createBlackjackEmbed(game);

  // Check if splitting is possible (need enough balance for additional bet)
  const freshBalance = (await pointsService.getPoints(userId, guildId))?.balance ?? 0;
  const canSplitHand = canSplit(playerHand) && freshBalance >= betAmount;

  const buttons = createBlackjackButtons(game.id, {
    canHit: true,
    canDouble: true,
    canSplit: canSplitHand,
  });

  if (isButton) {
    await interaction.update({
      embeds: [embed],
      components: [buttons],
    });
  } else {
    const reply = await interaction.reply({
      embeds: [embed],
      components: [buttons],
      ephemeral: true,
      fetchReply: true,
    });

    await blackjackService.updateGame(game.id, {
      message_id: reply.id,
    });
  }
}
