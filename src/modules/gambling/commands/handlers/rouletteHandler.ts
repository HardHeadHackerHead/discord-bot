import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
  TextChannel,
  Message,
  Guild,
} from 'discord.js';
import { GamblingStatsService } from '../../services/GamblingStatsService.js';
import { RouletteService } from '../../services/RouletteService.js';
import { PointsService } from '../../../points/services/PointsService.js';
import { Logger } from '../../../../shared/utils/logger.js';
import { RouletteBet } from '../../types.js';
import { closeBettingInterfaces } from '../../events/handlers/rouletteHandler.js';
import {
  createTableEmbed,
  createResultEmbed,
  createSpinningEmbed,
  createTableClosedEmbed,
  createTableButtons,
  spin,
  getNumberColor,
  calculateBetPayout,
  SpinRecord,
} from '../../games/roulette.js';

const logger = new Logger('Gambling:RouletteCommand');

const activeSessions = new Map<string, NodeJS.Timeout>();

/** Exported so the event handler can look up history for a game */
export const sessionHistories = new Map<string, SpinRecord[]>();

export interface SessionContext {
  gameId: string;
  guildId: string;
  guild: Guild;
  channel: TextChannel;
  message: Message;
  duration: number;
  history: SpinRecord[];
  emptyRounds: number;
  statsService: GamblingStatsService;
  rouletteService: RouletteService;
  pointsService: PointsService;
}

/** Exported so event handler can refresh the table embed after a bet is placed */
export const sessionContexts = new Map<string, SessionContext>();

/** Last bets per player — persists across rounds for the Repeat Bet feature */
export const lastPlayerBets = new Map<string, Array<{ betType: string; betNumber: number | null; betAmount: number }>>();

// ─── Entry point ────────────────────────────────────────────────────────────

export async function handleRoulette(
  interaction: ChatInputCommandInteraction,
  statsService: GamblingStatsService,
  rouletteService: RouletteService,
  pointsService: PointsService
): Promise<void> {
  const duration = interaction.options.getInteger('duration') ?? 30;
  const guildId = interaction.guildId!;
  const channelId = interaction.channelId;

  const member = interaction.member as GuildMember;
  const voiceChannel = member.voice.channel;

  if (!voiceChannel) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setDescription('You must be in a **voice channel** to start a roulette table.\nJoin a voice channel and try again.')
          .setColor(0xe53935)
      ],
      ephemeral: true,
    });
    return;
  }

  const existingGame = await rouletteService.getActiveGame(voiceChannel.id);
  if (existingGame) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setDescription('There\'s already a roulette table running in your voice channel!\nUse the **Place Bet** button on the existing table.')
          .setColor(0xe53935)
      ],
      ephemeral: true,
    });
    return;
  }

  const game = await rouletteService.createGame(guildId, channelId, voiceChannel.id, duration);

  const history: SpinRecord[] = [];
  const embed = createTableEmbed(game, [], new Map(), history, duration, duration);
  const buttons = createTableButtons(game.id);

  const reply = await interaction.reply({
    embeds: [embed],
    components: buttons,
    fetchReply: true,
  });

  await rouletteService.updateGame(game.id, { message_id: reply.id });

  const ctx: SessionContext = {
    gameId: game.id,
    guildId,
    guild: interaction.guild!,
    channel: interaction.channel as TextChannel,
    message: reply,
    duration,
    history,
    emptyRounds: 0,
    statsService,
    rouletteService,
    pointsService,
  };

  sessionContexts.set(game.id, ctx);
  sessionHistories.set(game.id, history);
  startBettingCountdown(ctx);
}

// ─── Betting Countdown ──────────────────────────────────────────────────────

function startBettingCountdown(ctx: SessionContext): void {
  const tickMs = (ctx.duration > 60 ? 10 : 5) * 1000;

  const intervalId = setInterval(async () => {
    try {
      const game = await ctx.rouletteService.getGameById(ctx.gameId);

      // If the game is gone, stop — but DON'T stop on a transient DB hiccup.
      // Only stop if we got a real response and the game is missing or finished.
      if (!game) {
        logger.warn(`Roulette countdown: game ${ctx.gameId} not found, stopping`);
        clearInterval(intervalId);
        activeSessions.delete(ctx.gameId);
        return;
      }

      // If something else changed the status (e.g., manual cleanup), stop.
      if (game.status !== 'betting') return;

      // Calculate time from the DB timestamp — resilient to skipped ticks
      const timeRemaining = Math.max(0, Math.floor(
        (game.betting_ends_at.getTime() - Date.now()) / 1000
      ));

      if (timeRemaining <= 0) {
        clearInterval(intervalId);
        activeSessions.delete(ctx.gameId);
        await onBettingEnded(ctx);
        return;
      }

      const bets = await ctx.rouletteService.getAllBets(ctx.gameId);
      const usernames = await fetchUsernames(ctx.guild, bets);
      const embed = createTableEmbed(game, bets, usernames, ctx.history, timeRemaining, ctx.duration);

      await ctx.message.edit({ embeds: [embed], components: createTableButtons(ctx.gameId) });
    } catch (error) {
      // Log but DON'T clear the interval — let it retry on the next tick
      logger.error('Error updating roulette countdown (will retry):', error);
    }
  }, tickMs);

  activeSessions.set(ctx.gameId, intervalId);
}

// ─── Betting ended ──────────────────────────────────────────────────────────

async function onBettingEnded(ctx: SessionContext): Promise<void> {
  try {
    const betCount = await ctx.rouletteService.getBetCount(ctx.gameId);

    if (betCount === 0) {
      ctx.emptyRounds++;

      // Close after 3 consecutive rounds with no bets
      if (ctx.emptyRounds >= 3) {
        await ctx.message.edit({
          embeds: [createTableClosedEmbed(ctx.history)],
          components: [],
        });
        cleanup(ctx.gameId);
        await ctx.rouletteService.deleteGame(ctx.gameId);
        return;
      }

      // Otherwise restart the countdown — table stays open
      await ctx.rouletteService.resetForNewRound(ctx.gameId, ctx.duration);

      const freshGame = await ctx.rouletteService.getGameById(ctx.gameId);
      if (!freshGame) return;

      await ctx.message.edit({
        embeds: [createTableEmbed(freshGame, [], new Map(), ctx.history, ctx.duration, ctx.duration)],
        components: createTableButtons(ctx.gameId),
      });

      startBettingCountdown(ctx);
      return;
    }

    // Bets exist — reset the empty counter and spin
    ctx.emptyRounds = 0;
    await spinAndResolve(ctx);
  } catch (error) {
    logger.error('Error at betting end:', error);
  }
}

// ─── Spin ───────────────────────────────────────────────────────────────────

async function spinAndResolve(ctx: SessionContext): Promise<void> {
  try {
    // ── At-spin-time validation: re-check balances and remove invalid bets ──
    const playersToValidate = await ctx.rouletteService.getUniquePlayersInGame(ctx.gameId);
    for (const playerId of playersToValidate) {
      const playerBets = await ctx.rouletteService.getPlayerBets(ctx.gameId, playerId);
      const totalBet = playerBets.reduce((s, b) => s + Number(b.bet_amount), 0);
      const pts = await ctx.pointsService.getPoints(playerId, ctx.guildId);
      const balance = pts?.balance ?? 0;

      // Points were already deducted when bets were placed, so balance should be fine.
      // But if something went wrong (e.g., points spent elsewhere), remove their bets and refund.
      // This is a safety net, not the normal path.
      if (balance < 0) {
        await ctx.rouletteService.clearPlayerBets(ctx.gameId, playerId);
        logger.warn(`Removed bets for ${playerId} — negative balance detected`);
      }

      // Save bets for Repeat Bet feature (before spin, while bets are still pending)
      if (playerBets.length > 0) {
        lastPlayerBets.set(playerId, playerBets.map(b => ({
          betType: b.bet_type,
          betNumber: b.bet_number,
          betAmount: Number(b.bet_amount),
        })));
      }
    }

    // Re-check if any bets remain after validation
    const betCount = await ctx.rouletteService.getBetCount(ctx.gameId);
    if (betCount === 0) {
      // All bets were invalidated — restart round
      await ctx.rouletteService.resetForNewRound(ctx.gameId, ctx.duration);
      const freshGame = await ctx.rouletteService.getGameById(ctx.gameId);
      if (!freshGame) return;
      await ctx.message.edit({
        embeds: [createTableEmbed(freshGame, [], new Map(), ctx.history, ctx.duration, ctx.duration)],
        components: createTableButtons(ctx.gameId),
      });
      startBettingCountdown(ctx);
      return;
    }

    await ctx.rouletteService.updateGame(ctx.gameId, { status: 'spinning' });

    // Close all players' ephemeral betting interfaces
    await closeBettingInterfaces(ctx.gameId);

    // Show spinning GIF
    await ctx.message.edit({
      embeds: [createSpinningEmbed()],
      components: [],
    });

    await new Promise(resolve => setTimeout(resolve, 4000));

    // Spin the wheel
    const resultNumber = spin();
    const resultColor = getNumberColor(resultNumber);

    // Record in session history
    ctx.history.unshift({ number: resultNumber, color: resultColor });

    // Store the result but keep status as 'spinning' through the results display.
    // This prevents a race where someone runs /roulette during the 8s window
    // and getActiveGame (which filters status != 'finished') can't find this game.
    await ctx.rouletteService.updateGame(ctx.gameId, {
      result_number: resultNumber,
      result_color: resultColor,
    });

    // Calculate payouts
    await ctx.rouletteService.updateBetOutcomes(
      ctx.gameId, resultNumber,
      (betType, betNumber, betAmount) => calculateBetPayout(betType, betNumber, betAmount, resultNumber)
    );

    const updatedGame = await ctx.rouletteService.getGameById(ctx.gameId);
    if (!updatedGame) return;

    const bets = await ctx.rouletteService.getAllBets(ctx.gameId);
    const usernames = await fetchUsernames(ctx.guild, bets);
    const uniquePlayers = await ctx.rouletteService.getUniquePlayersInGame(ctx.gameId);

    const playerResults = new Map<string, { totalBet: number; totalWon: number; netProfit: number }>();

    for (const playerId of uniquePlayers) {
      const playerBets = bets.filter(b => b.user_id === playerId);
      const totalBet = playerBets.reduce((s, b) => s + Number(b.bet_amount), 0);
      const totalWon = playerBets.reduce((s, b) => s + Number(b.payout), 0);

      playerResults.set(playerId, { totalBet, totalWon, netProfit: totalWon - totalBet });

      if (totalWon > 0) {
        await ctx.pointsService.addPoints(playerId, ctx.guildId, totalWon, 'Roulette winnings', 'other');
      }

      for (const bet of playerBets) {
        await ctx.statsService.recordGameResult(bet.user_id, ctx.guildId, 'roulette', Number(bet.bet_amount), {
          outcome: bet.outcome === 'win' ? 'win' : 'loss',
          payout: Number(bet.payout),
          multiplier: Number(bet.payout) / Number(bet.bet_amount) || 0,
          gameData: { resultNumber, resultColor, betType: bet.bet_type, betNumber: bet.bet_number },
        });
      }
    }

    // Show results
    await ctx.message.edit({
      embeds: [createResultEmbed(updatedGame, bets, usernames, playerResults, ctx.history)],
      components: [],
    });

    // Pause for results, then start next round
    await new Promise(resolve => setTimeout(resolve, 8000));

    await ctx.rouletteService.resetForNewRound(ctx.gameId, ctx.duration);

    const freshGame = await ctx.rouletteService.getGameById(ctx.gameId);
    if (!freshGame) return;

    await ctx.message.edit({
      embeds: [createTableEmbed(freshGame, [], new Map(), ctx.history, ctx.duration, ctx.duration)],
      components: createTableButtons(ctx.gameId),
    });

    startBettingCountdown(ctx);
  } catch (error) {
    logger.error('Error during roulette spin:', error);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function cleanup(gameId: string): void {
  sessionContexts.delete(gameId);
  sessionHistories.delete(gameId);
  const timer = activeSessions.get(gameId);
  if (timer) {
    clearInterval(timer);
    activeSessions.delete(gameId);
  }
}

export async function fetchUsernames(guild: Guild, bets: RouletteBet[]): Promise<Map<string, string>> {
  const usernames = new Map<string, string>();
  const uniqueUserIds = [...new Set(bets.map(b => b.user_id))];

  for (const userId of uniqueUserIds) {
    try {
      const member = await guild.members.fetch(userId);
      if (member) usernames.set(userId, member.displayName);
    } catch {
      usernames.set(userId, 'Unknown');
    }
  }

  return usernames;
}
