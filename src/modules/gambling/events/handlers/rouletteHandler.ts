import {
  ButtonInteraction,
  ModalSubmitInteraction,
  EmbedBuilder,
} from 'discord.js';
import { RouletteService } from '../../services/RouletteService.js';
import { PointsService } from '../../../points/services/PointsService.js';
import { Logger } from '../../../../shared/utils/logger.js';
import {
  createBettingEmbed,
  createBettingButtons,
  createNumberPickerModal,
  createTableEmbed,
  createTableButtons,
  getBetAmounts,
  BET_LABELS,
  BET_PAYOUTS,
  RouletteBetType,
} from '../../games/roulette.js';
import { sessionContexts, fetchUsernames, lastPlayerBets } from '../../commands/handlers/rouletteHandler.js';

const logger = new Logger('Gambling:RouletteEvent');

// ─── Per-player bet amount state ────────────────────────────────────────────

interface PlayerAmountState {
  amounts: number[];
  index: number;
}

const playerAmounts = new Map<string, PlayerAmountState>();

// Store the join interaction per player so we can clear their ephemeral betting
// interface when the wheel starts spinning.
const playerJoinInteractions = new Map<string, ButtonInteraction>();

function getPlayerKey(gameId: string, userId: string): string {
  return `${gameId}:${userId}`;
}

/**
 * Called by the command handler when the spin starts.
 * Edits every player's ephemeral betting message to remove buttons.
 */
export async function closeBettingInterfaces(gameId: string): Promise<void> {
  const closed = new EmbedBuilder()
    .setTitle('\u{1F3B0} Betting Closed')
    .setDescription('The wheel is spinning \u2014 good luck!')
    .setColor(0xffa000);

  for (const [key, inter] of playerJoinInteractions) {
    if (!key.startsWith(gameId + ':')) continue;

    try {
      await inter.editReply({ embeds: [closed], components: [] });
    } catch {
      // Interaction token may have expired — that's fine
    }

    playerJoinInteractions.delete(key);
  }
}

function getCurrentAmount(gameId: string, userId: string, balance: number): number {
  const key = getPlayerKey(gameId, userId);
  let state = playerAmounts.get(key);

  if (!state) {
    const amounts = getBetAmounts(balance);
    state = { amounts, index: 0 };
    playerAmounts.set(key, state);
  }

  return state.amounts[state.index] ?? state.amounts[0] ?? 10;
}

function cycleAmount(gameId: string, userId: string, balance: number): number {
  const key = getPlayerKey(gameId, userId);
  const amounts = getBetAmounts(balance);
  let state = playerAmounts.get(key);

  if (!state) {
    state = { amounts, index: 0 };
  } else {
    state.amounts = amounts;
    state.index = (state.index + 1) % amounts.length;
  }

  playerAmounts.set(key, state);
  return state.amounts[state.index] ?? amounts[0] ?? 10;
}

// ─── Button handler ─────────────────────────────────────────────────────────

export async function handleRouletteButton(
  interaction: ButtonInteraction,
  rouletteService: RouletteService,
  pointsService: PointsService
): Promise<void> {
  const parts = interaction.customId.split(':');
  const action = parts[1] ?? '';
  const gameId = parts[2] ?? '';

  if (!gameId) return;

  const game = await rouletteService.getGameById(gameId);

  if (!game) {
    await interaction.reply({
      embeds: [new EmbedBuilder().setDescription('This roulette table no longer exists.').setColor(0xe53935)],
      ephemeral: true,
    });
    return;
  }

  const userId = interaction.user.id;
  const guildId = interaction.guildId!;

  switch (action) {
    // ── Join / Place Bet: send ephemeral betting interface ──────────────
    case 'join': {
      if (game.status !== 'betting') {
        await interaction.reply({
          embeds: [new EmbedBuilder().setDescription('Betting is closed \u2014 the wheel is spinning!').setColor(0xffa000)],
          ephemeral: true,
        });
        return;
      }

      const pts = await pointsService.getPoints(userId, guildId);
      const balance = pts?.balance ?? 0;

      if (balance <= 0) {
        await interaction.reply({
          embeds: [new EmbedBuilder().setDescription('You have no points to bet!').setColor(0xe53935)],
          ephemeral: true,
        });
        return;
      }

      const amount = getCurrentAmount(gameId, userId, balance);
      const bets = await rouletteService.getPlayerBets(gameId, userId);

      await interaction.reply({
        embeds: [createBettingEmbed(bets, balance, amount)],
        components: createBettingButtons(gameId, amount, bets.length > 0, lastPlayerBets.has(userId)),
        ephemeral: true,
      });

      // Store so we can clear this ephemeral message when the spin starts
      playerJoinInteractions.set(getPlayerKey(gameId, userId), interaction);
      break;
    }

    // ── Bet: one-click place bet at current amount ──────────────────────
    case 'bet': {
      const betType = (parts[3] ?? 'red') as RouletteBetType;

      if (game.status !== 'betting') {
        await interaction.update({
          embeds: [new EmbedBuilder().setDescription('Betting closed \u2014 the wheel is spinning!').setColor(0xffa000)],
          components: [],
        });
        return;
      }

      // Straight up: open number modal
      if (betType === 'straight') {
        await interaction.showModal(createNumberPickerModal(gameId));
        return;
      }

      const pts = await pointsService.getPoints(userId, guildId);
      const balance = pts?.balance ?? 0;
      const betAmount = getCurrentAmount(gameId, userId, balance);

      if (balance < betAmount) {
        await interaction.update({
          embeds: [new EmbedBuilder().setDescription(`Not enough points! **Balance:** ${balance.toLocaleString()} pts`).setColor(0xe53935)],
          components: [],
        });
        return;
      }

      // Deduct and place bet
      await pointsService.removePoints(userId, guildId, betAmount, 'Roulette bet', userId);
      await rouletteService.addBet(gameId, userId, betType, betAmount, null);

      // Refresh ephemeral betting interface
      const freshPts = await pointsService.getPoints(userId, guildId);
      const freshBalance = freshPts?.balance ?? 0;
      const currentAmount = getCurrentAmount(gameId, userId, freshBalance);
      const bets = await rouletteService.getPlayerBets(gameId, userId);

      await interaction.update({
        embeds: [createBettingEmbed(bets, freshBalance, currentAmount)],
        components: createBettingButtons(gameId, currentAmount, bets.length > 0, lastPlayerBets.has(userId)),
      });

      // Refresh public table message
      await refreshTableMessage(gameId, rouletteService);
      break;
    }

    // ── Cycle bet amount ────────────────────────────────────────────────
    case 'cycle': {
      const pts = await pointsService.getPoints(userId, guildId);
      const balance = pts?.balance ?? 0;
      const newAmount = cycleAmount(gameId, userId, balance);
      const bets = await rouletteService.getPlayerBets(gameId, userId);

      await interaction.update({
        embeds: [createBettingEmbed(bets, balance, newAmount)],
        components: createBettingButtons(gameId, newAmount, bets.length > 0, lastPlayerBets.has(userId)),
      });
      break;
    }

    // ── Clear bets ──────────────────────────────────────────────────────
    case 'clear': {
      if (game.status !== 'betting') {
        await interaction.update({
          embeds: [new EmbedBuilder().setDescription('Betting is closed \u2014 can\'t clear bets now.').setColor(0xffa000)],
          components: [],
        });
        return;
      }

      const bets = await rouletteService.getPlayerBets(gameId, userId);

      if (bets.length === 0) {
        // Just acknowledge — no-op
        await interaction.deferUpdate();
        return;
      }

      const totalRefund = bets.reduce((s, b) => s + Number(b.bet_amount), 0);
      await rouletteService.clearPlayerBets(gameId, userId);
      await pointsService.addPoints(userId, guildId, totalRefund, 'Roulette bets cleared', 'other');

      const freshPts = await pointsService.getPoints(userId, guildId);
      const freshBalance = freshPts?.balance ?? 0;
      const currentAmount = getCurrentAmount(gameId, userId, freshBalance);

      await interaction.update({
        embeds: [createBettingEmbed([], freshBalance, currentAmount)],
        components: createBettingButtons(gameId, currentAmount, false, lastPlayerBets.has(userId)),
      });

      await refreshTableMessage(gameId, rouletteService);
      break;
    }

    // ── Repeat last round's bets ────────────────────────────────────────
    case 'repeat': {
      if (game.status !== 'betting') {
        await interaction.update({
          embeds: [new EmbedBuilder().setDescription('Betting is closed!').setColor(0xffa000)],
          components: [],
        });
        return;
      }

      const saved = lastPlayerBets.get(userId);
      if (!saved || saved.length === 0) {
        await interaction.deferUpdate();
        return;
      }

      // Calculate total cost of repeating
      const totalCost = saved.reduce((s, b) => s + b.betAmount, 0);
      const pts = await pointsService.getPoints(userId, guildId);
      const balance = pts?.balance ?? 0;

      if (balance < totalCost) {
        await interaction.update({
          embeds: [new EmbedBuilder().setDescription(`Not enough points to repeat!\n**Need:** ${totalCost.toLocaleString()} pts\n**Balance:** ${balance.toLocaleString()} pts`).setColor(0xe53935)],
          components: createBettingButtons(gameId, getCurrentAmount(gameId, userId, balance), false, true),
        });
        return;
      }

      // Clear any current bets first (refund them)
      const currentBets = await rouletteService.getPlayerBets(gameId, userId);
      if (currentBets.length > 0) {
        const refund = currentBets.reduce((s, b) => s + Number(b.bet_amount), 0);
        await rouletteService.clearPlayerBets(gameId, userId);
        await pointsService.addPoints(userId, guildId, refund, 'Roulette bets cleared for repeat', 'other');
      }

      // Place all saved bets
      for (const bet of saved) {
        await pointsService.removePoints(userId, guildId, bet.betAmount, 'Roulette bet', userId);
        await rouletteService.addBet(gameId, userId, bet.betType, bet.betAmount, bet.betNumber);
      }

      // Refresh UI
      const freshPts = await pointsService.getPoints(userId, guildId);
      const freshBalance = freshPts?.balance ?? 0;
      const currentAmount = getCurrentAmount(gameId, userId, freshBalance);
      const bets = await rouletteService.getPlayerBets(gameId, userId);

      await interaction.update({
        embeds: [createBettingEmbed(bets, freshBalance, currentAmount)],
        components: createBettingButtons(gameId, currentAmount, bets.length > 0, true),
      });

      await refreshTableMessage(gameId, rouletteService);
      break;
    }
  }
}

// ─── Modal handler (number picker only) ─────────────────────────────────────

export async function handleRouletteModal(
  interaction: ModalSubmitInteraction,
  rouletteService: RouletteService,
  pointsService: PointsService
): Promise<void> {
  const parts = interaction.customId.split(':');
  const modalType = parts[1] ?? '';
  const gameId = parts[2] ?? '';

  if (!gameId || modalType !== 'numbermodal') return;

  const game = await rouletteService.getGameById(gameId);

  if (!game || game.status !== 'betting') {
    await interaction.reply({
      embeds: [new EmbedBuilder().setDescription('Betting is closed!').setColor(0xffa000)],
      ephemeral: true,
    });
    return;
  }

  const userId = interaction.user.id;
  const guildId = interaction.guildId!;

  const number = parseInt(interaction.fields.getTextInputValue('number'));

  if (isNaN(number) || number < 0 || number > 36) {
    await interaction.reply({
      embeds: [new EmbedBuilder().setDescription('Enter a number between **0** and **36**.').setColor(0xe53935)],
      ephemeral: true,
    });
    return;
  }

  const pts = await pointsService.getPoints(userId, guildId);
  const balance = pts?.balance ?? 0;
  const betAmount = getCurrentAmount(gameId, userId, balance);

  if (balance < betAmount) {
    await interaction.reply({
      embeds: [new EmbedBuilder().setDescription(`Not enough points! **Balance:** ${balance.toLocaleString()} pts`).setColor(0xe53935)],
      ephemeral: true,
    });
    return;
  }

  // Deduct and place bet
  await pointsService.removePoints(userId, guildId, betAmount, 'Roulette bet', userId);
  await rouletteService.addBet(gameId, userId, 'straight', betAmount, number);

  // Send fresh betting interface (modal responses need reply, not update)
  const freshPts = await pointsService.getPoints(userId, guildId);
  const freshBalance = freshPts?.balance ?? 0;
  const currentAmount = getCurrentAmount(gameId, userId, freshBalance);
  const bets = await rouletteService.getPlayerBets(gameId, userId);

  await interaction.reply({
    embeds: [createBettingEmbed(bets, freshBalance, currentAmount)],
    components: createBettingButtons(gameId, currentAmount, bets.length > 0, lastPlayerBets.has(userId)),
    ephemeral: true,
  });

  await refreshTableMessage(gameId, rouletteService);
}

// ─── Refresh public table message ───────────────────────────────────────────

async function refreshTableMessage(gameId: string, rouletteService: RouletteService): Promise<void> {
  const ctx = sessionContexts.get(gameId);
  if (!ctx) return;

  try {
    const game = await rouletteService.getGameById(gameId);
    if (!game || game.status !== 'betting') return;

    const bets = await rouletteService.getAllBets(gameId);
    const usernames = await fetchUsernames(ctx.guild, bets);
    const timeRemaining = Math.max(0, Math.floor((game.betting_ends_at.getTime() - Date.now()) / 1000));

    await ctx.message.edit({
      embeds: [createTableEmbed(game, bets, usernames, ctx.history, timeRemaining, ctx.duration)],
      components: createTableButtons(gameId),
    });
  } catch (error) {
    logger.error('Error refreshing table message:', error);
  }
}
