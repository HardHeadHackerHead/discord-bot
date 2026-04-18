import { ButtonInteraction, EmbedBuilder } from 'discord.js';
import { GamblingStatsService } from '../../services/GamblingStatsService.js';
import { BlackjackService } from '../../services/BlackjackService.js';
import { PointsService } from '../../../points/services/PointsService.js';
import { Card, BlackjackGame } from '../../types.js';
import {
  calculateHandValue,
  isBusted,
  drawCard,
  playDealerTurn,
  determineResult,
  createBlackjackEmbed,
  createBlackjackButtons,
  createBlackjackResultEmbed,
  createBlackjackRebetButtons,
  createSplitResult,
} from '../../games/blackjack.js';
import { startBlackjackGame } from '../../commands/handlers/blackjackHandler.js';
import { checkAndAnnounceBankruptcy } from '../../utils/bankruptcy.js';

export async function handleBlackjackButton(
  interaction: ButtonInteraction,
  statsService: GamblingStatsService,
  blackjackService: BlackjackService,
  pointsService: PointsService
): Promise<void> {
  const parts = interaction.customId.split(':');
  const action = parts[1] ?? '';
  const gameIdOrAmount = parts[2] ?? '';
  const userId = interaction.user.id;
  const guildId = interaction.guildId!;

  // --- Re-bet: start a fresh game from the result screen ---
  if (action === 'rebet') {
    const betAmount = parseInt(gameIdOrAmount);
    await startBlackjackGame(interaction, betAmount, statsService, blackjackService, pointsService);
    return;
  }

  // --- Normal game actions (hit/stand/double/split) ---
  const gameId = gameIdOrAmount;
  const game = await blackjackService.getActiveGame(userId, guildId);

  if (!game || game.id !== gameId) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Game Not Found')
          .setDescription('This game has expired or doesn\'t exist.')
          .setColor(0xFF0000)
      ],
      ephemeral: true,
    });
    return;
  }

  // Get current balance for potential double down
  const points = await pointsService.getPoints(userId, guildId);
  const balance = points?.balance ?? 0;

  switch (action) {
    case 'hit':
      await handleHit(interaction, game, balance, statsService, blackjackService, pointsService);
      break;
    case 'stand':
      await handleStand(interaction, game, balance, statsService, blackjackService, pointsService);
      break;
    case 'double':
      await handleDouble(interaction, game, balance, statsService, blackjackService, pointsService);
      break;
    case 'split':
      await handleSplit(interaction, game, balance, statsService, blackjackService, pointsService);
      break;
  }
}

async function handleHit(
  interaction: ButtonInteraction,
  game: BlackjackGame,
  balance: number,
  statsService: GamblingStatsService,
  blackjackService: BlackjackService,
  pointsService: PointsService
): Promise<void> {
  const userId = interaction.user.id;
  const guildId = interaction.guildId!;

  const isPlayingSplit = game.has_split && game.current_hand === 'split';
  const currentHand = isPlayingSplit ? game.split_hand! : game.player_hand;

  // Draw a card
  const newCard = drawCard(game.deck);
  currentHand.push(newCard);

  const handValue = calculateHandValue(currentHand);
  const busted = isBusted(currentHand);

  if (isPlayingSplit) {
    game.split_hand = currentHand;
    if (busted) game.split_hand_status = 'busted';
  } else {
    game.player_hand = currentHand;
    if (busted) game.main_hand_status = 'busted';
  }

  if (busted || handValue === 21) {
    if (game.has_split) {
      await handleSplitHandProgression(interaction, game, balance, isPlayingSplit, statsService, blackjackService, pointsService);
    } else {
      if (busted) {
        const result = determineResult(game.player_hand, game.dealer_hand, Number(game.bet_amount));
        await statsService.recordGameResult(userId, guildId, 'blackjack', Number(game.bet_amount), result);
        await blackjackService.deleteGame(game.id);

        // Fetch fresh balance for display
        const freshPoints = await pointsService.getPoints(userId, guildId);
        const freshBalance = freshPoints?.balance ?? 0;

        const rebetRow = createBlackjackRebetButtons(Number(game.bet_amount), freshBalance);
        await interaction.update({
          embeds: [createBlackjackResultEmbed(result, Number(game.bet_amount), freshBalance)],
          components: rebetRow ? [rebetRow] : [],
        });
        await checkAndAnnounceBankruptcy(interaction, userId, guildId, statsService, pointsService);
      } else {
        await handleStand(interaction, game, balance, statsService, blackjackService, pointsService);
      }
    }
  } else {
    await blackjackService.updateGame(game.id, {
      player_hand: game.player_hand,
      split_hand: game.split_hand,
      deck: game.deck,
      main_hand_status: game.main_hand_status,
      split_hand_status: game.split_hand_status,
    });

    await interaction.update({
      embeds: [createBlackjackEmbed(game)],
      components: [createBlackjackButtons(game.id, { canHit: true, canDouble: false, canSplit: false })],
    });
  }
}

async function handleStand(
  interaction: ButtonInteraction,
  game: BlackjackGame,
  balance: number,
  statsService: GamblingStatsService,
  blackjackService: BlackjackService,
  pointsService: PointsService
): Promise<void> {
  const userId = interaction.user.id;
  const guildId = interaction.guildId!;

  const isPlayingSplit = game.has_split && game.current_hand === 'split';

  if (isPlayingSplit) {
    game.split_hand_status = 'standing';
  } else {
    game.main_hand_status = 'standing';
  }

  if (game.has_split) {
    await handleSplitHandProgression(interaction, game, balance, isPlayingSplit, statsService, blackjackService, pointsService);
  } else {
    const finalDealerHand = playDealerTurn([...game.dealer_hand], [...game.deck]);
    const result = determineResult(game.player_hand, finalDealerHand, Number(game.bet_amount));

    if (result.gameData) {
      (result.gameData as { dealerHand: typeof finalDealerHand }).dealerHand = finalDealerHand;
    }

    await statsService.recordGameResult(userId, guildId, 'blackjack', Number(game.bet_amount), result);
    await blackjackService.deleteGame(game.id);

    if (result.payout > 0) {
      await pointsService.addPoints(userId, guildId, result.payout, 'Blackjack winnings', 'other');
    }

    // Fetch fresh balance for display
    const freshPoints = await pointsService.getPoints(userId, guildId);
    const newBalance = freshPoints?.balance ?? 0;

    const rebetRow = createBlackjackRebetButtons(Number(game.bet_amount), newBalance);
    await interaction.update({
      embeds: [createBlackjackResultEmbed(result, Number(game.bet_amount), newBalance)],
      components: rebetRow ? [rebetRow] : [],
    });
    await checkAndAnnounceBankruptcy(interaction, userId, guildId, statsService, pointsService);
  }
}

async function handleDouble(
  interaction: ButtonInteraction,
  game: BlackjackGame,
  balance: number,
  statsService: GamblingStatsService,
  blackjackService: BlackjackService,
  pointsService: PointsService
): Promise<void> {
  const userId = interaction.user.id;
  const guildId = interaction.guildId!;

  if (balance < Number(game.bet_amount)) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Insufficient Points')
          .setDescription(
            `You need ${Number(game.bet_amount).toLocaleString()} more points to double down!`
          )
          .setColor(0xFF0000)
      ],
      ephemeral: true,
    });
    return;
  }

  // Deduct additional bet
  await pointsService.removePoints(userId, guildId, Number(game.bet_amount), 'Blackjack double down', userId);
  const doubleBet = Number(game.bet_amount) * 2;

  // Draw exactly one card
  const newCard = drawCard(game.deck);
  game.player_hand.push(newCard);

  if (isBusted(game.player_hand)) {
    const result = determineResult(game.player_hand, game.dealer_hand, doubleBet);

    await statsService.recordGameResult(userId, guildId, 'blackjack', doubleBet, result);
    await blackjackService.deleteGame(game.id);

    const freshPoints = await pointsService.getPoints(userId, guildId);
    const newBalance = freshPoints?.balance ?? 0;

    const rebetRow = createBlackjackRebetButtons(Number(game.bet_amount), newBalance);
    await interaction.update({
      embeds: [createBlackjackResultEmbed(result, doubleBet, newBalance)],
      components: rebetRow ? [rebetRow] : [],
    });
    await checkAndAnnounceBankruptcy(interaction, userId, guildId, statsService, pointsService);
  } else {
    const finalDealerHand = playDealerTurn([...game.dealer_hand], [...game.deck]);
    const result = determineResult(game.player_hand, finalDealerHand, doubleBet);

    if (result.gameData) {
      (result.gameData as { dealerHand: typeof finalDealerHand }).dealerHand = finalDealerHand;
    }

    await statsService.recordGameResult(userId, guildId, 'blackjack', doubleBet, result);
    await blackjackService.deleteGame(game.id);

    if (result.payout > 0) {
      await pointsService.addPoints(userId, guildId, result.payout, 'Blackjack winnings', 'other');
    }

    const freshPoints = await pointsService.getPoints(userId, guildId);
    const newBalance = freshPoints?.balance ?? 0;

    // Re-bet uses the original bet amount, not the doubled amount
    const rebetRow = createBlackjackRebetButtons(Number(game.bet_amount), newBalance);
    await interaction.update({
      embeds: [createBlackjackResultEmbed(result, doubleBet, newBalance)],
      components: rebetRow ? [rebetRow] : [],
    });
    await checkAndAnnounceBankruptcy(interaction, userId, guildId, statsService, pointsService);
  }
}

async function handleSplit(
  interaction: ButtonInteraction,
  game: BlackjackGame,
  balance: number,
  statsService: GamblingStatsService,
  blackjackService: BlackjackService,
  pointsService: PointsService
): Promise<void> {
  const userId = interaction.user.id;
  const guildId = interaction.guildId!;

  if (balance < Number(game.bet_amount)) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Insufficient Points')
          .setDescription(
            `You need ${Number(game.bet_amount).toLocaleString()} more points to split!`
          )
          .setColor(0xFF0000)
      ],
      ephemeral: true,
    });
    return;
  }

  if (game.player_hand.length !== 2 || game.player_hand[0]?.rank !== game.player_hand[1]?.rank) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Cannot Split')
          .setDescription('You can only split when you have two cards of the same rank.')
          .setColor(0xFF0000)
      ],
      ephemeral: true,
    });
    return;
  }

  // Deduct split bet
  await pointsService.removePoints(userId, guildId, Number(game.bet_amount), 'Blackjack split bet', userId);

  // Split the hand
  const splitCard = game.player_hand.pop()!;
  const splitHand: Card[] = [splitCard];

  // Draw one card for each hand
  const mainCard = drawCard(game.deck);
  const splitCardNew = drawCard(game.deck);

  game.player_hand.push(mainCard);
  splitHand.push(splitCardNew);

  game.split_hand = splitHand;
  game.has_split = true;
  game.split_bet_amount = Number(game.bet_amount);
  game.current_hand = 'main';
  game.main_hand_status = 'playing';
  game.split_hand_status = 'playing';

  // Check for 21 on main hand
  const mainValue = calculateHandValue(game.player_hand);
  if (mainValue === 21) {
    game.main_hand_status = 'standing';
    game.current_hand = 'split';
  }

  // Check for 21 on split hand if we're already on it
  if (game.current_hand === 'split') {
    const splitValue = calculateHandValue(game.split_hand);
    if (splitValue === 21) {
      game.split_hand_status = 'standing';
      await finishSplitGame(interaction, game, balance - Number(game.bet_amount), statsService, blackjackService, pointsService);
      return;
    }
  }

  await blackjackService.updateGame(game.id, {
    player_hand: game.player_hand,
    split_hand: game.split_hand,
    deck: game.deck,
    has_split: game.has_split,
    split_bet_amount: Number(game.split_bet_amount),
    current_hand: game.current_hand,
    main_hand_status: game.main_hand_status,
    split_hand_status: game.split_hand_status,
  });

  await interaction.update({
    embeds: [createBlackjackEmbed(game)],
    components: [createBlackjackButtons(game.id, { canHit: true, canDouble: false, canSplit: false })],
  });
}

async function handleSplitHandProgression(
  interaction: ButtonInteraction,
  game: BlackjackGame,
  balance: number,
  wasPlayingSplit: boolean,
  statsService: GamblingStatsService,
  blackjackService: BlackjackService,
  pointsService: PointsService
): Promise<void> {
  if (!wasPlayingSplit) {
    const splitStatus = game.split_hand_status;

    if (splitStatus === 'playing') {
      game.current_hand = 'split';

      const splitValue = calculateHandValue(game.split_hand!);
      if (splitValue === 21) {
        game.split_hand_status = 'standing';
        await finishSplitGame(interaction, game, balance, statsService, blackjackService, pointsService);
        return;
      }

      await blackjackService.updateGame(game.id, {
        player_hand: game.player_hand,
        split_hand: game.split_hand,
        deck: game.deck,
        current_hand: game.current_hand,
        main_hand_status: game.main_hand_status,
        split_hand_status: game.split_hand_status,
      });

      await interaction.update({
        embeds: [createBlackjackEmbed(game)],
        components: [createBlackjackButtons(game.id, { canHit: true, canDouble: false, canSplit: false })],
      });
    } else {
      await finishSplitGame(interaction, game, balance, statsService, blackjackService, pointsService);
    }
  } else {
    await finishSplitGame(interaction, game, balance, statsService, blackjackService, pointsService);
  }
}

async function finishSplitGame(
  interaction: ButtonInteraction,
  game: BlackjackGame,
  balance: number,
  statsService: GamblingStatsService,
  blackjackService: BlackjackService,
  pointsService: PointsService
): Promise<void> {
  const userId = interaction.user.id;
  const guildId = interaction.guildId!;

  const finalDealerHand = playDealerTurn([...game.dealer_hand], [...game.deck]);

  const splitResult = createSplitResult(
    game.player_hand,
    game.split_hand!,
    finalDealerHand,
    Number(game.bet_amount),
    Number(game.split_bet_amount)
  );

  await statsService.recordGameResult(userId, guildId, 'blackjack', Number(game.bet_amount), splitResult.mainResult);
  if (splitResult.splitResult) {
    await statsService.recordGameResult(userId, guildId, 'blackjack', Number(game.split_bet_amount), splitResult.splitResult);
  }

  await blackjackService.deleteGame(game.id);

  if (splitResult.totalPayout > 0) {
    await pointsService.addPoints(userId, guildId, splitResult.totalPayout, 'Blackjack winnings', 'other');
  }

  // Fetch fresh balance for display
  const freshPoints = await pointsService.getPoints(userId, guildId);
  const newBalance = freshPoints?.balance ?? 0;

  const mainValue = calculateHandValue(game.player_hand);
  const splitValue = calculateHandValue(game.split_hand!);
  const dealerValue = calculateHandValue(finalDealerHand);

  const mainOutcome = splitResult.mainResult.outcome;
  const splitOutcome = splitResult.splitResult?.outcome ?? 'loss';

  const outcomeEmoji = (outcome: string) => {
    if (outcome === 'win') return '\u2705';
    if (outcome === 'loss') return '\u274C';
    return '\u{1F91D}';
  };

  const getSuitEmoji = (suit: string): string => {
    switch (suit) {
      case 'hearts': return '\u2665\uFE0F';
      case 'diamonds': return '\u2666\uFE0F';
      case 'clubs': return '\u2663\uFE0F';
      case 'spades': return '\u2660\uFE0F';
      default: return '';
    }
  };

  const embed = new EmbedBuilder()
    .setTitle('\u{1F0CF} Blackjack - Split Result')
    .setColor(splitResult.totalPayout > 0 ? 0x00FF00 : splitResult.totalPayout === 0 ? 0xFFFF00 : 0xFF0000)
    .addFields(
      {
        name: '\u{1F3B4} Dealer\'s Hand',
        value: `${finalDealerHand.map(c => `${c.rank}${getSuitEmoji(c.suit)}`).join(' ')} (${dealerValue})`,
        inline: false,
      },
      {
        name: `${outcomeEmoji(mainOutcome)} Main Hand`,
        value: `${game.player_hand.map(c => `${c.rank}${getSuitEmoji(c.suit)}`).join(' ')} (${mainValue})\n` +
          `**${mainOutcome.toUpperCase()}** - ${splitResult.mainResult.payout > 0 ? `+${splitResult.mainResult.payout.toLocaleString()}` : '0'} points`,
        inline: true,
      },
      {
        name: `${outcomeEmoji(splitOutcome)} Split Hand`,
        value: `${game.split_hand!.map(c => `${c.rank}${getSuitEmoji(c.suit)}`).join(' ')} (${splitValue})\n` +
          `**${splitOutcome.toUpperCase()}** - ${splitResult.splitResult?.payout ?? 0 > 0 ? `+${(splitResult.splitResult?.payout ?? 0).toLocaleString()}` : '0'} points`,
        inline: true,
      },
      {
        name: '\u{1F4B0} Result',
        value: `**Total Payout:** ${splitResult.totalPayout.toLocaleString()} points\n` +
          `**Net:** ${(splitResult.totalPayout - Number(game.bet_amount) - Number(game.split_bet_amount)) >= 0 ? '+' : ''}${(splitResult.totalPayout - Number(game.bet_amount) - Number(game.split_bet_amount)).toLocaleString()} points\n` +
          `**New Balance:** ${newBalance.toLocaleString()} points`,
        inline: false,
      }
    );

  const rebetRow = createBlackjackRebetButtons(Number(game.bet_amount), newBalance);
  await interaction.update({
    embeds: [embed],
    components: rebetRow ? [rebetRow] : [],
  });

  await checkAndAnnounceBankruptcy(interaction, userId, guildId, statsService, pointsService);
}
