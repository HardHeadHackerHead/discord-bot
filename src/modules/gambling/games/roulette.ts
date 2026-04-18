import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { RouletteGame, RouletteBet } from '../types.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export type RouletteBetType =
  | 'red' | 'black' | 'green'
  | 'odd' | 'even'
  | 'low' | 'high'
  | 'dozen1' | 'dozen2' | 'dozen3'
  | 'column1' | 'column2' | 'column3'
  | 'straight';

export interface SpinRecord {
  number: number;
  color: 'red' | 'black' | 'green';
}

// ─── Constants ──────────────────────────────────────────────────────────────

const RED_NUMBERS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
const SPINNING_GIF_URL = 'https://media.tenor.com/4fB2KBXU6hIAAAAd/roulette-casino.gif';

export const BET_PAYOUTS: Record<RouletteBetType, number> = {
  red: 2, black: 2, odd: 2, even: 2, low: 2, high: 2,
  dozen1: 3, dozen2: 3, dozen3: 3, column1: 3, column2: 3, column3: 3,
  green: 36, straight: 36,
};

export const BET_LABELS: Record<RouletteBetType, string> = {
  red: 'Red', black: 'Black', green: 'Green (0)',
  odd: 'Odd', even: 'Even', low: '1\u201318', high: '19\u201336',
  dozen1: '1st 12', dozen2: '2nd 12', dozen3: '3rd 12',
  column1: 'Col 1', column2: 'Col 2', column3: 'Col 3',
  straight: 'Straight Up',
};

// ─── Core game logic ────────────────────────────────────────────────────────

export function getNumberColor(num: number): 'red' | 'black' | 'green' {
  if (num === 0) return 'green';
  if (RED_NUMBERS.includes(num)) return 'red';
  return 'black';
}

export function getColorEmoji(color: 'red' | 'black' | 'green'): string {
  return color === 'red' ? '\u{1F534}' : color === 'black' ? '\u26AB' : '\u{1F7E2}';
}

export function spin(): number {
  return Math.floor(Math.random() * 37);
}

export function checkWin(betType: string, betNumber: number | null, resultNumber: number): boolean {
  const color = getNumberColor(resultNumber);
  switch (betType) {
    case 'red': return color === 'red';
    case 'black': return color === 'black';
    case 'green': return color === 'green';
    case 'odd': return resultNumber > 0 && resultNumber % 2 === 1;
    case 'even': return resultNumber > 0 && resultNumber % 2 === 0;
    case 'low': return resultNumber >= 1 && resultNumber <= 18;
    case 'high': return resultNumber >= 19 && resultNumber <= 36;
    case 'dozen1': return resultNumber >= 1 && resultNumber <= 12;
    case 'dozen2': return resultNumber >= 13 && resultNumber <= 24;
    case 'dozen3': return resultNumber >= 25 && resultNumber <= 36;
    case 'column1': return resultNumber > 0 && resultNumber % 3 === 1;
    case 'column2': return resultNumber > 0 && resultNumber % 3 === 2;
    case 'column3': return resultNumber > 0 && resultNumber % 3 === 0;
    case 'straight': return betNumber === resultNumber;
    default: return false;
  }
}

export function calculateBetPayout(
  betType: string, betNumber: number | null, betAmount: number, resultNumber: number
): { won: boolean; payout: number } {
  const won = checkWin(betType, betNumber, resultNumber);
  if (!won) return { won: false, payout: 0 };
  const multiplier = BET_PAYOUTS[betType as RouletteBetType] ?? 2;
  return { won: true, payout: Math.floor(betAmount * multiplier) };
}

// ─── Bet amount cycling ─────────────────────────────────────────────────────

/** Get the preset amounts for a player based on their balance */
export function getBetAmounts(balance: number): number[] {
  if (balance < 1000) {
    return [5, 10, 25, 50, 100].filter(a => a <= balance);
  }

  // Percentage-based for richer players
  const raw = [
    Math.max(100, Math.floor(balance * 0.01)),
    Math.floor(balance * 0.25),
    Math.floor(balance * 0.50),
    Math.floor(balance * 0.75),
    balance,
  ];

  // Deduplicate and sort
  const unique = [...new Set(raw)].filter(a => a > 0 && a <= balance).sort((a, b) => a - b);
  return unique.length > 0 ? unique : [balance];
}

/** Format a number compactly for button labels */
export function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return n.toLocaleString();
}

// ─── Display helpers ────────────────────────────────────────────────────────

function formatBet(bet: RouletteBet): string {
  if (bet.bet_type === 'straight' && bet.bet_number !== null) {
    const color = getColorEmoji(getNumberColor(bet.bet_number));
    return `${color} **#${bet.bet_number}** \u2014 ${Number(bet.bet_amount).toLocaleString()} pts`;
  }
  const label = BET_LABELS[bet.bet_type as RouletteBetType] ?? bet.bet_type;
  return `**${label}** \u2014 ${Number(bet.bet_amount).toLocaleString()} pts`;
}

function timerBar(secondsLeft: number, totalSeconds: number): string {
  const filled = Math.max(0, Math.round((secondsLeft / totalSeconds) * 10));
  const empty = 10 - filled;
  return `\`${'█'.repeat(filled)}${'░'.repeat(empty)}\` **${secondsLeft}s**`;
}

function formatHistory(history: SpinRecord[]): string {
  if (history.length === 0) return '*No spins yet*';
  return history.slice(0, 15).map(s => `${getColorEmoji(s.color)}${s.number}`).join('  ');
}

function groupBetsByUser(bets: RouletteBet[]): Map<string, RouletteBet[]> {
  const grouped = new Map<string, RouletteBet[]>();
  for (const bet of bets) {
    const existing = grouped.get(bet.user_id) || [];
    existing.push(bet);
    grouped.set(bet.user_id, existing);
  }
  return grouped;
}

// ─── Main table embed (public) ──────────────────────────────────────────────

export function createTableEmbed(
  game: RouletteGame,
  bets: RouletteBet[],
  usernames: Map<string, string>,
  history: SpinRecord[],
  timeRemaining?: number,
  totalDuration?: number
): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle('\u{1F3B0} Roulette').setColor(0x1a6b35);

  const total = totalDuration ?? timeRemaining ?? 30;
  const timer = timeRemaining !== undefined ? timerBar(timeRemaining, total) : '**Place your bets!**';

  let desc = `${timer}\n`;

  if (bets.length > 0) {
    const pot = bets.reduce((s, b) => s + Number(b.bet_amount), 0);
    desc += `\n**${bets.length}** bet${bets.length !== 1 ? 's' : ''} \u2014 **${pot.toLocaleString()}** pts on the table\n\n`;

    const grouped = groupBetsByUser(bets);
    for (const [userId, userBets] of grouped) {
      const name = usernames.get(userId) || 'Unknown';
      const userTotal = userBets.reduce((s, b) => s + Number(b.bet_amount), 0);
      desc += `**${name}** (${userTotal.toLocaleString()} pts)\n`;
      for (const bet of userBets) {
        desc += `\u2003\u2022 ${formatBet(bet)}\n`;
      }
    }
  } else {
    desc += '\n*Waiting for bets\u2026*\n';
  }

  if (history.length > 0) {
    desc += `\n\u2500\u2500\u2500 Previous Spins \u2500\u2500\u2500\n${formatHistory(history)}\n`;
  }

  embed.setDescription(desc);
  embed.setFooter({ text: '\u{1F534} 2x  \u2502  \u{1F522} 3x  \u2502  \u{1F3AF} 36x' });
  return embed;
}

// ─── Main table button (public) ─────────────────────────────────────────────

export function createTableButtons(gameId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`roulette:join:${gameId}`)
        .setLabel('Place Bet')
        .setEmoji('\u{1F4B0}')
        .setStyle(ButtonStyle.Success),
    ),
  ];
}

// ─── Ephemeral betting interface (per player) ───────────────────────────────

export function createBettingEmbed(
  bets: RouletteBet[],
  balance: number,
  currentAmount: number
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle('\u{1F3B0} Your Bets')
    .setColor(0x1a6b35);

  if (bets.length === 0) {
    embed.setDescription(
      `**Balance:** ${balance.toLocaleString()} pts\n` +
      `**Bet amount:** ${currentAmount.toLocaleString()} pts\n\n` +
      'Click any bet type below to place a bet.\n' +
      'Use the **\u{1F504}** button to change your bet amount.'
    );
  } else {
    const totalBet = bets.reduce((s, b) => s + Number(b.bet_amount), 0);
    let desc = `**Balance:** ${balance.toLocaleString()} pts\n`;
    desc += `**Bet amount:** ${currentAmount.toLocaleString()} pts\n\n`;

    for (const bet of bets) {
      desc += `\u2022 ${formatBet(bet)}\n`;
    }
    desc += `\n**Total wagered:** ${totalBet.toLocaleString()} pts`;

    embed.setDescription(desc);
  }

  return embed;
}

export function createBettingButtons(gameId: string, currentAmount: number, hasBets: boolean, hasLastBets: boolean = false): ActionRowBuilder<ButtonBuilder>[] {
  // Row 1: Colors + number pick
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`roulette:bet:${gameId}:red`).setLabel('Red').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`roulette:bet:${gameId}:black`).setLabel('Black').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`roulette:bet:${gameId}:green`).setLabel('0 Green').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`roulette:bet:${gameId}:straight`).setLabel('# Number').setStyle(ButtonStyle.Primary),
  );

  // Row 2: Even money
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`roulette:bet:${gameId}:odd`).setLabel('Odd').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`roulette:bet:${gameId}:even`).setLabel('Even').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`roulette:bet:${gameId}:low`).setLabel('1-18').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`roulette:bet:${gameId}:high`).setLabel('19-36').setStyle(ButtonStyle.Secondary),
  );

  // Row 3: Dozens + Columns
  const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`roulette:bet:${gameId}:dozen1`).setLabel('1st 12').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`roulette:bet:${gameId}:dozen2`).setLabel('2nd 12').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`roulette:bet:${gameId}:dozen3`).setLabel('3rd 12').setStyle(ButtonStyle.Primary),
  );

  const row4 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`roulette:bet:${gameId}:column1`).setLabel('Col 1').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`roulette:bet:${gameId}:column2`).setLabel('Col 2').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`roulette:bet:${gameId}:column3`).setLabel('Col 3').setStyle(ButtonStyle.Primary),
  );

  // Row 5: Controls — cycle amount, repeat, clear
  const row5 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`roulette:cycle:${gameId}`)
      .setLabel(`Bet: ${formatCompact(currentAmount)}`)
      .setEmoji('\u{1F504}')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`roulette:repeat:${gameId}`)
      .setLabel('Repeat')
      .setEmoji('\u{1F501}')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!hasLastBets),
    new ButtonBuilder()
      .setCustomId(`roulette:clear:${gameId}`)
      .setLabel('Clear')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!hasBets),
  );

  return [row1, row2, row3, row4, row5];
}

// ─── Result embed ───────────────────────────────────────────────────────────

export function createResultEmbed(
  game: RouletteGame,
  bets: RouletteBet[],
  usernames: Map<string, string>,
  playerResults: Map<string, { totalBet: number; totalWon: number; netProfit: number }>,
  history: SpinRecord[]
): EmbedBuilder {
  const num = game.result_number!;
  const color = game.result_color!;
  const emoji = getColorEmoji(color);
  const colorName = color.charAt(0).toUpperCase() + color.slice(1);

  const embed = new EmbedBuilder()
    .setTitle(`${emoji}  ${num}  ${colorName}`)
    .setColor(color === 'green' ? 0x00c853 : color === 'red' ? 0xe53935 : 0x212121);

  let desc = '';

  if (playerResults.size > 0) {
    for (const [userId, result] of playerResults) {
      const name = usernames.get(userId) || 'Unknown';
      if (result.netProfit > 0) {
        desc += `\u{1F389} **${name}** won **+${result.netProfit.toLocaleString()}** pts\n`;
      } else if (result.netProfit === 0) {
        desc += `\u{1F91D} **${name}** broke even\n`;
      } else {
        desc += `\u274C **${name}** lost **${Math.abs(result.netProfit).toLocaleString()}** pts\n`;
      }

      const userBets = bets.filter(b => b.user_id === userId);
      for (const bet of userBets) {
        const won = bet.outcome === 'win';
        const icon = won ? '\u2705' : '\u2716';
        const payoutText = won ? ` \u2192 +${bet.payout.toLocaleString()}` : '';
        desc += `\u2003${icon} ${formatBet(bet)}${payoutText}\n`;
      }
      desc += '\n';
    }
  } else {
    desc = '*No bets were placed this round.*\n\n';
  }

  if (history.length > 0) {
    desc += `\u2500\u2500\u2500 History \u2500\u2500\u2500\n${formatHistory(history)}\n`;
  }

  embed.setDescription(desc.trimEnd());
  embed.setFooter({ text: 'Next round starting soon\u2026' });
  return embed;
}

// ─── Spinning embed ─────────────────────────────────────────────────────────

export function createSpinningEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('\u{1F3B0} No more bets!')
    .setDescription('*The wheel is spinning\u2026*')
    .setImage(SPINNING_GIF_URL)
    .setColor(0x1a6b35);
}

// ─── Table closed embed ─────────────────────────────────────────────────────

export function createTableClosedEmbed(history: SpinRecord[]): EmbedBuilder {
  let desc = 'No bets were placed. The table has been closed.\n\nUse `/roulette` to start a new session.';
  if (history.length > 0) {
    desc += `\n\n\u2500\u2500\u2500 Final History \u2500\u2500\u2500\n${formatHistory(history)}`;
  }
  return new EmbedBuilder().setTitle('\u{1F3B0} Table Closed').setDescription(desc).setColor(0x546e7a);
}

// ─── Number picker modal (straight up bets only) ────────────────────────────

export function createNumberPickerModal(gameId: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`roulette:numbermodal:${gameId}`)
    .setTitle('Straight Up Bet (36x)')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('number')
          .setLabel('Pick a number (0\u201336)')
          .setPlaceholder('e.g. 17')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(2)
      )
    );
}
