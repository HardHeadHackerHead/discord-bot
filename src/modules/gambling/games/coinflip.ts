import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { GameResult } from '../types.js';

export type CoinSide = 'heads' | 'tails';

export interface CoinflipGameData {
  choice: CoinSide;
  result: CoinSide;
}

const COINFLIP_MULTIPLIER = 2.0;

/**
 * Play a coinflip game
 */
export function playCoinflip(choice: CoinSide, betAmount: number): GameResult {
  const result: CoinSide = Math.random() < 0.5 ? 'heads' : 'tails';
  const won = choice === result;

  const gameData: CoinflipGameData = {
    choice,
    result,
  };

  if (won) {
    return {
      outcome: 'win',
      payout: Math.floor(betAmount * COINFLIP_MULTIPLIER),
      multiplier: COINFLIP_MULTIPLIER,
      gameData,
    };
  } else {
    return {
      outcome: 'loss',
      payout: 0,
      multiplier: 0,
      gameData,
    };
  }
}

/**
 * Create the coinflip selection embed and buttons
 */
export function createCoinflipSelectionEmbed(
  betAmount: number,
  userBalance: number
): { embed: EmbedBuilder; row: ActionRowBuilder<ButtonBuilder> } {
  const embed = new EmbedBuilder()
    .setTitle('Coinflip')
    .setDescription(
      `**Bet Amount:** ${betAmount.toLocaleString()} points\n` +
      `**Your Balance:** ${userBalance.toLocaleString()} points\n\n` +
      `Choose heads or tails!`
    )
    .setColor(0xFFD700)
    .setFooter({ text: 'Win 2x your bet!' });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`coinflip:heads:${betAmount}`)
      .setLabel('Heads')
      .setEmoji('\u{1FA99}')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`coinflip:tails:${betAmount}`)
      .setLabel('Tails')
      .setEmoji('\u{1FA99}')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`coinflip:cancel:${betAmount}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embed, row };
}

/**
 * Create the coinflip result embed
 */
export function createCoinflipResultEmbed(
  result: GameResult,
  betAmount: number,
  newBalance: number
): EmbedBuilder {
  const gameData = result.gameData as CoinflipGameData;
  const coinEmoji = gameData.result === 'heads' ? '\u{1F451}' : '\u{1F985}';

  const embed = new EmbedBuilder()
    .setTitle(`Coinflip - ${result.outcome === 'win' ? 'You Won!' : 'You Lost!'}`)
    .setDescription(
      `${coinEmoji} The coin landed on **${gameData.result.toUpperCase()}**!\n` +
      `You chose **${gameData.choice.toUpperCase()}**\n\n` +
      (result.outcome === 'win'
        ? `You won **${result.payout.toLocaleString()}** points! (${result.multiplier}x)`
        : `You lost **${betAmount.toLocaleString()}** points.`) +
      `\n\n**Balance:** ${newBalance.toLocaleString()} points`
    )
    .setColor(result.outcome === 'win' ? 0x00FF00 : 0xFF0000);

  return embed;
}

/**
 * Create re-bet buttons for the result screen.
 * Re-bet starts a fresh game (picks heads/tails again).
 * Only includes buttons the user can actually afford.
 */
export function createCoinflipRebetButtons(
  betAmount: number,
  balance: number
): ActionRowBuilder<ButtonBuilder> | null {
  const buttons: ButtonBuilder[] = [];

  if (balance >= betAmount) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`coinflip:rebet:${betAmount}`)
        .setLabel(`Re-bet (${betAmount.toLocaleString()})`)
        .setEmoji('\u{1F504}')
        .setStyle(ButtonStyle.Primary)
    );
  }

  const doubleAmount = betAmount * 2;
  if (balance >= doubleAmount) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`coinflip:rebet:${doubleAmount}`)
        .setLabel(`Double (${doubleAmount.toLocaleString()})`)
        .setEmoji('\u2B06\uFE0F')
        .setStyle(ButtonStyle.Success)
    );
  }

  if (buttons.length === 0) return null;
  return new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
}
