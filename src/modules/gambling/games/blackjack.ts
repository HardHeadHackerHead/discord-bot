import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { GameResult, Card, BlackjackGame, HandStatus } from '../types.js';

export type HandOutcome = 'blackjack' | 'win' | 'loss' | 'push' | 'bust' | 'dealer_bust';

export interface BlackjackGameData {
  playerHand: Card[];
  splitHand?: Card[];
  dealerHand: Card[];
  playerValue: number;
  splitValue?: number;
  dealerValue: number;
  outcome: HandOutcome;
  splitOutcome?: HandOutcome;
}

export interface SplitGameResult {
  mainResult: GameResult;
  splitResult: GameResult | null;
  totalPayout: number;
}

const SUITS: Card['suit'][] = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

const SUIT_EMOJIS: Record<Card['suit'], string> = {
  hearts: '♥️',
  diamonds: '♦️',
  clubs: '♣️',
  spades: '♠️',
};

/**
 * Create a fresh shuffled deck
 */
export function createDeck(): Card[] {
  const deck: Card[] = [];

  for (const suit of SUITS) {
    for (const rank of RANKS) {
      let value: number;
      if (rank === 'A') {
        value = 11; // Ace starts as 11, can be reduced to 1
      } else if (['J', 'Q', 'K'].includes(rank)) {
        value = 10;
      } else {
        value = parseInt(rank);
      }

      deck.push({ suit, rank, value });
    }
  }

  // Fisher-Yates shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = deck[i]!;
    deck[i] = deck[j]!;
    deck[j] = temp;
  }

  return deck;
}

/**
 * Draw a card from the deck
 */
export function drawCard(deck: Card[]): Card {
  const card = deck.pop();
  if (!card) {
    throw new Error('Deck is empty');
  }
  return card;
}

/**
 * Calculate the best hand value (handles aces)
 */
export function calculateHandValue(hand: Card[]): number {
  let value = hand.reduce((sum, card) => sum + card.value, 0);
  let aces = hand.filter(card => card.rank === 'A').length;

  // Reduce aces from 11 to 1 if we're over 21
  while (value > 21 && aces > 0) {
    value -= 10;
    aces--;
  }

  return value;
}

/**
 * Check if hand is a natural blackjack (21 with 2 cards)
 */
export function isBlackjack(hand: Card[]): boolean {
  return hand.length === 2 && calculateHandValue(hand) === 21;
}

/**
 * Check if hand is busted (over 21)
 */
export function isBusted(hand: Card[]): boolean {
  return calculateHandValue(hand) > 21;
}

/**
 * Check if a hand can be split (two cards of same rank)
 */
export function canSplit(hand: Card[]): boolean {
  if (hand.length !== 2) return false;
  // Cards can be split if they have the same rank
  // Some casinos allow splitting any two 10-value cards, we'll be strict
  return hand[0]?.rank === hand[1]?.rank;
}

/**
 * Get the card value for splitting (10, J, Q, K all count as 10)
 */
export function getCardValue(card: Card): number {
  if (['J', 'Q', 'K'].includes(card.rank)) return 10;
  if (card.rank === 'A') return 11;
  return parseInt(card.rank);
}

/**
 * Format a hand of cards for display
 */
export function formatHand(hand: Card[], hideSecond: boolean = false): string {
  if (hand.length === 0) return '*No cards*';

  return hand.map((card, index) => {
    if (hideSecond && index === 1) {
      return '🂠'; // Hidden card
    }
    const emoji = SUIT_EMOJIS[card.suit];
    return `${card.rank}${emoji}`;
  }).join(' ');
}

/**
 * Get the displayed value (with hidden card consideration)
 */
export function getDisplayedValue(hand: Card[], hideSecond: boolean = false): string {
  if (hideSecond && hand.length >= 2) {
    const firstCard = hand[0];
    return `${firstCard?.value ?? 0}+?`;
  }
  return calculateHandValue(hand).toString();
}

/**
 * Initialize a new blackjack game
 */
export function initializeGame(
  deck: Card[]
): { playerHand: Card[]; dealerHand: Card[]; deck: Card[] } {
  const playerHand: Card[] = [];
  const dealerHand: Card[] = [];

  // Deal alternating cards
  playerHand.push(drawCard(deck));
  dealerHand.push(drawCard(deck));
  playerHand.push(drawCard(deck));
  dealerHand.push(drawCard(deck));

  return { playerHand, dealerHand, deck };
}

/**
 * Play out the dealer's turn
 */
export function playDealerTurn(dealerHand: Card[], deck: Card[]): Card[] {
  // Dealer hits on 16 or less, stands on 17+
  while (calculateHandValue(dealerHand) < 17) {
    dealerHand.push(drawCard(deck));
  }
  return dealerHand;
}

/**
 * Determine the final result of the game
 */
export function determineResult(
  playerHand: Card[],
  dealerHand: Card[],
  betAmount: number
): GameResult {
  const playerValue = calculateHandValue(playerHand);
  const dealerValue = calculateHandValue(dealerHand);
  const playerBlackjack = isBlackjack(playerHand);
  const dealerBlackjack = isBlackjack(dealerHand);

  const gameData: BlackjackGameData = {
    playerHand,
    dealerHand,
    playerValue,
    dealerValue,
    outcome: 'loss', // Will be updated
  };

  // Both blackjack = push
  if (playerBlackjack && dealerBlackjack) {
    gameData.outcome = 'push';
    return {
      outcome: 'push',
      payout: betAmount,
      multiplier: 1,
      gameData,
    };
  }

  // Player blackjack = 3:2 payout
  if (playerBlackjack) {
    gameData.outcome = 'blackjack';
    return {
      outcome: 'win',
      payout: Math.floor(betAmount * 2.5),
      multiplier: 2.5,
      gameData,
    };
  }

  // Dealer blackjack = player loses
  if (dealerBlackjack) {
    gameData.outcome = 'loss';
    return {
      outcome: 'loss',
      payout: 0,
      multiplier: 0,
      gameData,
    };
  }

  // Player busted
  if (playerValue > 21) {
    gameData.outcome = 'bust';
    return {
      outcome: 'loss',
      payout: 0,
      multiplier: 0,
      gameData,
    };
  }

  // Dealer busted
  if (dealerValue > 21) {
    gameData.outcome = 'dealer_bust';
    return {
      outcome: 'win',
      payout: betAmount * 2,
      multiplier: 2,
      gameData,
    };
  }

  // Compare hands
  if (playerValue > dealerValue) {
    gameData.outcome = 'win';
    return {
      outcome: 'win',
      payout: betAmount * 2,
      multiplier: 2,
      gameData,
    };
  } else if (playerValue < dealerValue) {
    gameData.outcome = 'loss';
    return {
      outcome: 'loss',
      payout: 0,
      multiplier: 0,
      gameData,
    };
  } else {
    gameData.outcome = 'push';
    return {
      outcome: 'push',
      payout: betAmount,
      multiplier: 1,
      gameData,
    };
  }
}

/**
 * Get status indicator for a hand
 */
function getHandStatusIndicator(status: HandStatus | null): string {
  switch (status) {
    case 'standing': return ' ✋';
    case 'busted': return ' 💥';
    case 'blackjack': return ' 🃏';
    default: return '';
  }
}

/**
 * Create the blackjack game embed
 */
export function createBlackjackEmbed(
  game: BlackjackGame,
  showDealerCards: boolean = false
): EmbedBuilder {
  const playerValue = calculateHandValue(game.player_hand);
  const playerBlackjack = isBlackjack(game.player_hand);

  let status: string;
  let color: number;

  if (game.status === 'finished') {
    status = 'Game Over';
    color = 0x808080;
  } else if (playerBlackjack && !game.has_split) {
    status = 'BLACKJACK!';
    color = 0xFFD700;
  } else if (game.has_split) {
    // Show which hand is active
    if (game.current_hand === 'main') {
      status = 'Playing Hand 1';
    } else {
      status = 'Playing Hand 2';
    }
    color = 0x0099FF;
  } else if (playerValue === 21) {
    status = 'Standing on 21';
    color = 0x00FF00;
  } else if (game.status === 'playing') {
    status = 'Your Turn';
    color = 0x0099FF;
  } else {
    status = 'Dealer\'s Turn';
    color = 0xFFA500;
  }

  const embed = new EmbedBuilder()
    .setTitle(`🃏 Blackjack - ${status}`)
    .setColor(color);

  // Add main hand
  const mainHandActive = game.current_hand === 'main' && game.main_hand_status === 'playing';
  const mainHandIndicator = game.has_split
    ? (mainHandActive ? ' 👈' : getHandStatusIndicator(game.main_hand_status))
    : '';

  embed.addFields({
    name: `${game.has_split ? 'Hand 1' : 'Your Hand'} (${calculateHandValue(game.player_hand)})${mainHandIndicator}`,
    value: formatHand(game.player_hand),
    inline: true,
  });

  // Add split hand if exists
  if (game.has_split && game.split_hand) {
    const splitHandActive = game.current_hand === 'split' && game.split_hand_status === 'playing';
    const splitHandIndicator = splitHandActive ? ' 👈' : getHandStatusIndicator(game.split_hand_status);

    embed.addFields({
      name: `Hand 2 (${calculateHandValue(game.split_hand)})${splitHandIndicator}`,
      value: formatHand(game.split_hand),
      inline: true,
    });
  }

  // Add dealer's hand
  embed.addFields({
    name: `Dealer's Hand (${getDisplayedValue(game.dealer_hand, !showDealerCards)})`,
    value: formatHand(game.dealer_hand, !showDealerCards),
    inline: true,
  });

  // Footer with bet info
  const totalBet = Number(game.bet_amount) + Number(game.split_bet_amount);
  const betText = game.has_split
    ? `Total Bet: ${totalBet.toLocaleString()} points (${Number(game.bet_amount).toLocaleString()} + ${Number(game.split_bet_amount).toLocaleString()})`
    : `Bet: ${Number(game.bet_amount).toLocaleString()} points`;
  embed.setFooter({ text: betText });

  return embed;
}

/**
 * Create the action buttons for blackjack
 */
export function createBlackjackButtons(
  gameId: string,
  options: {
    canHit?: boolean;
    canDouble?: boolean;
    canSplit?: boolean;
  } = {}
): ActionRowBuilder<ButtonBuilder> {
  const { canHit = true, canDouble = true, canSplit = false } = options;

  const buttons = [
    new ButtonBuilder()
      .setCustomId(`blackjack:hit:${gameId}`)
      .setLabel('Hit')
      .setEmoji('🃏')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!canHit),
    new ButtonBuilder()
      .setCustomId(`blackjack:stand:${gameId}`)
      .setLabel('Stand')
      .setEmoji('✋')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`blackjack:double:${gameId}`)
      .setLabel('Double Down')
      .setEmoji('💰')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canDouble),
  ];

  // Add split button if applicable
  if (canSplit) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`blackjack:split:${gameId}`)
        .setLabel('Split')
        .setEmoji('✂️')
        .setStyle(ButtonStyle.Danger)
    );
  }

  return new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
}

/**
 * Get outcome description
 */
function getOutcomeDescription(outcome: HandOutcome): string {
  switch (outcome) {
    case 'blackjack': return 'Blackjack!';
    case 'win': return 'Win';
    case 'dealer_bust': return 'Win (Dealer Bust)';
    case 'push': return 'Push';
    case 'bust': return 'Bust';
    case 'loss': return 'Loss';
    default: return 'Loss';
  }
}

/**
 * Create the result embed
 */
export function createBlackjackResultEmbed(
  result: GameResult,
  betAmount: number,
  newBalance: number
): EmbedBuilder {
  const gameData = result.gameData as BlackjackGameData;

  let title: string;
  let description: string;
  let color: number;

  // Determine overall outcome for title/color
  const hasWin = result.outcome === 'win' || (gameData.splitOutcome && ['win', 'dealer_bust', 'blackjack'].includes(gameData.splitOutcome));
  const allLoss = gameData.outcome === 'loss' || gameData.outcome === 'bust';
  const allLossSplit = !gameData.splitOutcome || gameData.splitOutcome === 'loss' || gameData.splitOutcome === 'bust';

  if (gameData.splitHand) {
    // Split game result
    if (hasWin) {
      title = '🎉 Results';
      color = 0x00FF00;
    } else if (allLoss && allLossSplit) {
      title = '😔 Results';
      color = 0xFF0000;
    } else {
      title = '🤝 Results';
      color = 0xFFFF00;
    }

    description = '**Hand Results:**\n';
    description += `• Hand 1: ${formatHand(gameData.playerHand)} (${gameData.playerValue}) - **${getOutcomeDescription(gameData.outcome)}**\n`;
    description += `• Hand 2: ${formatHand(gameData.splitHand)} (${gameData.splitValue ?? 0}) - **${getOutcomeDescription(gameData.splitOutcome ?? 'loss')}**\n`;
    description += `\n**Dealer:** ${formatHand(gameData.dealerHand)} (${gameData.dealerValue})\n`;
  } else {
    // Single hand result
    switch (gameData.outcome) {
      case 'blackjack':
        title = '🃏 BLACKJACK!';
        description = 'You got a natural 21!';
        color = 0xFFD700;
        break;
      case 'win':
        title = '🎉 You Won!';
        description = 'Your hand beats the dealer!';
        color = 0x00FF00;
        break;
      case 'dealer_bust':
        title = '🎉 Dealer Busted!';
        description = 'The dealer went over 21!';
        color = 0x00FF00;
        break;
      case 'push':
        title = '🤝 Push';
        description = 'It\'s a tie! Your bet is returned.';
        color = 0xFFFF00;
        break;
      case 'bust':
        title = '💥 Busted!';
        description = 'You went over 21!';
        color = 0xFF0000;
        break;
      case 'loss':
      default:
        title = '😔 You Lost';
        description = 'The dealer wins this round.';
        color = 0xFF0000;
        break;
    }

    description += '\n\n' +
      `**Your Hand:** ${formatHand(gameData.playerHand)} (${gameData.playerValue})\n` +
      `**Dealer's Hand:** ${formatHand(gameData.dealerHand)} (${gameData.dealerValue})\n`;
  }

  // Add payout info
  description += '\n';
  if (result.outcome === 'win') {
    description += `You won **${result.payout.toLocaleString()}** points!`;
  } else if (result.outcome === 'push') {
    description += `Your bet of **${betAmount.toLocaleString()}** points was returned.`;
  } else {
    description += `You lost **${betAmount.toLocaleString()}** points.`;
  }

  description += `\n\n**New Balance:** ${newBalance.toLocaleString()} points`;

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color);

  return embed;
}

/**
 * Create a combined result for split hands
 */
export function createSplitResult(
  mainHand: Card[],
  splitHand: Card[],
  dealerHand: Card[],
  mainBet: number,
  splitBet: number
): SplitGameResult {
  const dealerValue = calculateHandValue(dealerHand);
  const dealerBusted = dealerValue > 21;

  // Calculate main hand result
  const mainResult = determineHandResult(mainHand, dealerHand, mainBet);
  const splitResult = determineHandResult(splitHand, dealerHand, splitBet);

  // Combine game data
  const gameData: BlackjackGameData = {
    playerHand: mainHand,
    splitHand: splitHand,
    dealerHand: dealerHand,
    playerValue: calculateHandValue(mainHand),
    splitValue: calculateHandValue(splitHand),
    dealerValue: dealerValue,
    outcome: (mainResult.gameData as BlackjackGameData).outcome,
    splitOutcome: (splitResult.gameData as BlackjackGameData).outcome,
  };

  const totalPayout = mainResult.payout + splitResult.payout;

  // Determine overall outcome
  let overallOutcome: 'win' | 'loss' | 'push';
  const totalBet = mainBet + splitBet;

  if (totalPayout > totalBet) {
    overallOutcome = 'win';
  } else if (totalPayout === totalBet) {
    overallOutcome = 'push';
  } else {
    overallOutcome = 'loss';
  }

  return {
    mainResult: {
      outcome: overallOutcome,
      payout: totalPayout,
      multiplier: totalPayout / totalBet,
      gameData,
    },
    splitResult,
    totalPayout,
  };
}

/**
 * Determine result for a single hand (used for split calculations)
 */
function determineHandResult(
  playerHand: Card[],
  dealerHand: Card[],
  betAmount: number
): GameResult {
  const playerValue = calculateHandValue(playerHand);
  const dealerValue = calculateHandValue(dealerHand);

  const gameData: BlackjackGameData = {
    playerHand,
    dealerHand,
    playerValue,
    dealerValue,
    outcome: 'loss',
  };

  // Player busted
  if (playerValue > 21) {
    gameData.outcome = 'bust';
    return { outcome: 'loss', payout: 0, multiplier: 0, gameData };
  }

  // Dealer busted
  if (dealerValue > 21) {
    gameData.outcome = 'dealer_bust';
    return { outcome: 'win', payout: betAmount * 2, multiplier: 2, gameData };
  }

  // Compare hands
  if (playerValue > dealerValue) {
    gameData.outcome = 'win';
    return { outcome: 'win', payout: betAmount * 2, multiplier: 2, gameData };
  } else if (playerValue < dealerValue) {
    gameData.outcome = 'loss';
    return { outcome: 'loss', payout: 0, multiplier: 0, gameData };
  } else {
    gameData.outcome = 'push';
    return { outcome: 'push', payout: betAmount, multiplier: 1, gameData };
  }
}

/**
 * Create re-bet buttons for the result screen.
 * Only includes buttons the user can actually afford.
 */
export function createBlackjackRebetButtons(
  betAmount: number,
  balance: number
): ActionRowBuilder<ButtonBuilder> | null {
  const buttons: ButtonBuilder[] = [];

  if (balance >= betAmount) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`blackjack:rebet:${betAmount}`)
        .setLabel(`Re-bet (${betAmount.toLocaleString()})`)
        .setEmoji('\u{1F504}')
        .setStyle(ButtonStyle.Primary)
    );
  }

  const doubleAmount = betAmount * 2;
  if (balance >= doubleAmount) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`blackjack:rebet:${doubleAmount}`)
        .setLabel(`Double (${doubleAmount.toLocaleString()})`)
        .setEmoji('\u2B06\uFE0F')
        .setStyle(ButtonStyle.Success)
    );
  }

  if (buttons.length === 0) return null;
  return new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
}
