import { EmbedBuilder } from 'discord.js';
import { GameResult } from '../types.js';

export interface SlotsGameData {
  reels: string[];
  payline: string;
}

// Slot symbols with their weights (higher = more common)
const SYMBOLS = [
  { emoji: '🍒', name: 'cherry', weight: 30 },
  { emoji: '🍋', name: 'lemon', weight: 25 },
  { emoji: '🍊', name: 'orange', weight: 20 },
  { emoji: '🍇', name: 'grape', weight: 15 },
  { emoji: '🔔', name: 'bell', weight: 7 },
  { emoji: '💎', name: 'diamond', weight: 2 },
  { emoji: '7️⃣', name: 'seven', weight: 1 },
];

// Payouts for matching symbols (multiplier)
const PAYOUTS: Record<string, number> = {
  cherry: 2,      // 3x cherry = 2x
  lemon: 3,       // 3x lemon = 3x
  orange: 4,      // 3x orange = 4x
  grape: 5,       // 3x grape = 5x
  bell: 10,       // 3x bell = 10x
  diamond: 25,    // 3x diamond = 25x
  seven: 50,      // 3x seven = 50x (jackpot!)
};

// Partial match payouts (2 matching + 1 different)
const PARTIAL_PAYOUTS: Record<string, number> = {
  cherry: 1,      // 2x cherry = 1x (break even)
  lemon: 1,
  orange: 1.5,
  grape: 2,
  bell: 3,
  diamond: 5,
  seven: 10,
};

/**
 * Get a weighted random symbol
 */
function getRandomSymbol(): typeof SYMBOLS[number] {
  const totalWeight = SYMBOLS.reduce((sum, s) => sum + s.weight, 0);
  let random = Math.random() * totalWeight;

  for (const symbol of SYMBOLS) {
    random -= symbol.weight;
    if (random <= 0) {
      return symbol;
    }
  }

  // Fallback to first symbol (should never reach here)
  return SYMBOLS[0]!;
}

/**
 * Spin the slot machine reels
 */
function spinReels(): typeof SYMBOLS[number][] {
  return [getRandomSymbol(), getRandomSymbol(), getRandomSymbol()];
}

/**
 * Calculate the payout for a spin result
 */
function calculatePayout(reels: typeof SYMBOLS[number][], betAmount: number): { multiplier: number; payout: number } {
  const names = reels.map(r => r.name);
  const uniqueNames = [...new Set(names)];

  // Three of a kind - full payout
  if (uniqueNames.length === 1 && names[0]) {
    const multiplier = PAYOUTS[names[0]] ?? 0;
    return { multiplier, payout: Math.floor(betAmount * multiplier) };
  }

  // Two of a kind - partial payout
  if (uniqueNames.length === 2) {
    // Find which symbol appears twice
    const counts: Record<string, number> = {};
    for (const name of names) {
      counts[name] = (counts[name] || 0) + 1;
    }

    const matchedSymbol = Object.entries(counts).find(([, count]) => count === 2)?.[0];
    if (matchedSymbol && PARTIAL_PAYOUTS[matchedSymbol]) {
      const multiplier = PARTIAL_PAYOUTS[matchedSymbol];
      return { multiplier, payout: Math.floor(betAmount * multiplier) };
    }
  }

  // No match
  return { multiplier: 0, payout: 0 };
}

/**
 * Play a slots game
 */
export function playSlots(betAmount: number): GameResult {
  const reels = spinReels();
  const { multiplier, payout } = calculatePayout(reels, betAmount);

  const gameData: SlotsGameData = {
    reels: reels.map(r => r.emoji),
    payline: reels.map(r => r.name).join('-'),
  };

  if (payout > betAmount) {
    return {
      outcome: 'win',
      payout,
      multiplier,
      gameData,
    };
  } else if (payout === betAmount) {
    // Break even counts as a push
    return {
      outcome: 'push',
      payout,
      multiplier: 1,
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
 * Create an animated spinning embed (for visual effect)
 */
export function createSpinningEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('🎰 Spinning...')
    .setDescription(
      '```\n' +
      '╔═══════════════╗\n' +
      '║  ❓  ❓  ❓  ║\n' +
      '╚═══════════════╝\n' +
      '```'
    )
    .setColor(0xFFD700);
}

/**
 * Create the slots result embed
 */
export function createSlotsResultEmbed(
  result: GameResult,
  betAmount: number,
  newBalance: number
): EmbedBuilder {
  const gameData = result.gameData as SlotsGameData;
  const [r1, r2, r3] = gameData.reels;

  let title: string;
  let color: number;

  if (result.multiplier >= 50) {
    title = '🎰 JACKPOT!!! 🎰';
    color = 0xFFD700;
  } else if (result.outcome === 'win') {
    title = '🎰 You Won!';
    color = 0x00FF00;
  } else if (result.outcome === 'push') {
    title = '🎰 Break Even';
    color = 0xFFFF00;
  } else {
    title = '🎰 You Lost';
    color = 0xFF0000;
  }

  let resultText = '';
  if (result.outcome === 'win') {
    resultText = `You won **${result.payout.toLocaleString()}** points! (${result.multiplier}x)`;
  } else if (result.outcome === 'push') {
    resultText = `You got your bet back!`;
  } else {
    resultText = `You lost **${betAmount.toLocaleString()}** points.`;
  }

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(
      '```\n' +
      '╔═══════════════╗\n' +
      `║  ${r1}  ${r2}  ${r3}  ║\n` +
      '╚═══════════════╝\n' +
      '```\n' +
      resultText +
      `\n\n**New Balance:** ${newBalance.toLocaleString()} points`
    )
    .setColor(color);

  // Add jackpot celebration
  if (result.multiplier >= 50) {
    embed.setFooter({ text: '🎉 CONGRATULATIONS! 🎉' });
  }

  return embed;
}

/**
 * Create the paytable embed
 */
export function createPaytableEmbed(): EmbedBuilder {
  const paylines = SYMBOLS.map(s => {
    const fullPay = PAYOUTS[s.name];
    const partialPay = PARTIAL_PAYOUTS[s.name];
    return `${s.emoji}${s.emoji}${s.emoji} = **${fullPay}x** | ${s.emoji}${s.emoji}❓ = **${partialPay}x**`;
  }).join('\n');

  return new EmbedBuilder()
    .setTitle('🎰 Slots Paytable')
    .setDescription(paylines)
    .setColor(0xFFD700)
    .setFooter({ text: 'Good luck!' });
}
