import { ButtonInteraction, EmbedBuilder, Client, TextChannel } from 'discord.js';
import { RPSService } from '../../services/RPSService.js';
import { GamblingStatsService } from '../../services/GamblingStatsService.js';
import { PointsService } from '../../../points/services/PointsService.js';
import { RPSChoice, GameResult } from '../../types.js';
import {
  determineRPSWinner,
  createAcceptedEmbed,
  createDeclinedEmbed,
  createResultEmbed,
  createTimeoutEmbed,
} from '../../games/rps.js';
import { checkAndAnnounceBankruptcy } from '../../utils/bankruptcy.js';
import { Logger } from '../../../../shared/utils/logger.js';

const logger = new Logger('Gambling:RPS:Events');

export async function handleRPSButton(
  interaction: ButtonInteraction,
  statsService: GamblingStatsService,
  rpsService: RPSService,
  pointsService: PointsService
): Promise<void> {
  const parts = interaction.customId.split(':');
  const action = parts[1] ?? '';
  const challengeId = parts[2] ?? '';
  const userId = interaction.user.id;
  const guildId = interaction.guildId!;

  switch (action) {
    case 'accept':
      await handleAccept(interaction, challengeId, userId, guildId, rpsService, pointsService, statsService);
      break;
    case 'decline':
      await handleDecline(interaction, challengeId, userId, guildId, rpsService, pointsService);
      break;
    case 'rock':
    case 'paper':
    case 'scissors':
      await handleChoice(interaction, challengeId, userId, guildId, action as RPSChoice, rpsService, statsService, pointsService);
      break;
  }
}

async function handleAccept(
  interaction: ButtonInteraction,
  challengeId: string,
  userId: string,
  guildId: string,
  rpsService: RPSService,
  pointsService: PointsService,
  statsService: GamblingStatsService
): Promise<void> {
  const challenge = await rpsService.getChallenge(challengeId);
  if (!challenge) {
    await interaction.reply({ content: 'This challenge no longer exists.', ephemeral: true });
    return;
  }

  if (userId !== challenge.opponent_id) {
    await interaction.reply({ content: 'Only the challenged player can accept!', ephemeral: true });
    return;
  }

  // Check opponent's balance
  const points = await pointsService.getPoints(userId, guildId);
  const balance = points?.balance ?? 0;

  if (balance < challenge.bet_amount) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Insufficient Points')
          .setDescription(
            `You don't have enough points to accept!\n` +
            `**Your Balance:** ${balance.toLocaleString()} points\n` +
            `**Required:** ${challenge.bet_amount.toLocaleString()} points`
          )
          .setColor(0xFF0000)
      ],
      ephemeral: true,
    });
    return;
  }

  // Atomically accept (checks status is still 'pending')
  const accepted = await rpsService.acceptChallenge(challengeId);
  if (!accepted) {
    await interaction.reply({ content: 'This challenge is no longer available.', ephemeral: true });
    return;
  }

  // Deduct bet from opponent
  await pointsService.removePoints(userId, guildId, challenge.bet_amount, 'RPS challenge accepted', userId);

  // Get updated challenge for the choice deadline
  const updatedChallenge = await rpsService.getChallenge(challengeId);
  if (!updatedChallenge || !updatedChallenge.choice_deadline) return;

  // Update the message with choice buttons
  const { embed, row } = createAcceptedEmbed(
    challenge.challenger_id,
    challenge.opponent_id,
    challenge.bet_amount,
    challengeId,
    updatedChallenge.choice_deadline
  );
  await interaction.update({ embeds: [embed], components: [row] });

  // Start 30-second choice timer
  const client = interaction.client;
  rpsService.startChoiceTimer(challengeId, async () => {
    await handleChoiceTimeout(challengeId, rpsService, statsService, pointsService, client);
  });
}

async function handleDecline(
  interaction: ButtonInteraction,
  challengeId: string,
  userId: string,
  guildId: string,
  rpsService: RPSService,
  pointsService: PointsService
): Promise<void> {
  const challenge = await rpsService.getChallenge(challengeId);
  if (!challenge) {
    await interaction.reply({ content: 'This challenge no longer exists.', ephemeral: true });
    return;
  }

  if (userId !== challenge.opponent_id) {
    await interaction.reply({ content: 'Only the challenged player can decline!', ephemeral: true });
    return;
  }

  const declined = await rpsService.declineChallenge(challengeId);
  if (!declined) {
    await interaction.reply({ content: 'This challenge is no longer available.', ephemeral: true });
    return;
  }

  // Refund challenger
  await pointsService.addPoints(
    challenge.challenger_id, guildId, challenge.bet_amount,
    'RPS challenge declined - refund', 'other'
  );

  const embed = createDeclinedEmbed(challenge.challenger_id, challenge.opponent_id, challenge.bet_amount);
  await interaction.update({ embeds: [embed], components: [] });
}

async function handleChoice(
  interaction: ButtonInteraction,
  challengeId: string,
  userId: string,
  guildId: string,
  choice: RPSChoice,
  rpsService: RPSService,
  statsService: GamblingStatsService,
  pointsService: PointsService
): Promise<void> {
  const challenge = await rpsService.getChallenge(challengeId);
  if (!challenge || challenge.status !== 'accepted') {
    await interaction.reply({ content: 'This challenge is no longer active.', ephemeral: true });
    return;
  }

  // Verify participant
  if (userId !== challenge.challenger_id && userId !== challenge.opponent_id) {
    await interaction.reply({ content: "This isn't your challenge!", ephemeral: true });
    return;
  }

  // Check if already chose
  const alreadyChose = userId === challenge.challenger_id
    ? challenge.challenger_choice
    : challenge.opponent_choice;

  if (alreadyChose) {
    const display = alreadyChose.charAt(0).toUpperCase() + alreadyChose.slice(1);
    await interaction.reply({
      content: `You already chose **${display}**! Waiting for your opponent...`,
      ephemeral: true,
    });
    return;
  }

  // Record choice
  const updated = await rpsService.recordChoice(challengeId, userId, choice);
  if (!updated) {
    await interaction.reply({ content: 'Failed to record your choice. Try again.', ephemeral: true });
    return;
  }

  const bothChosen = !!updated.challenger_choice && !!updated.opponent_choice;

  if (!bothChosen) {
    const display = choice.charAt(0).toUpperCase() + choice.slice(1);
    await interaction.reply({
      content: `You chose **${display}**! Waiting for your opponent...`,
      ephemeral: true,
    });
    return;
  }

  // Both have chosen - resolve the game
  rpsService.clearChoiceTimer(challengeId);

  const result = determineRPSWinner(updated.challenger_choice!, updated.opponent_choice!);

  let winnerId: string | null = null;
  let loserId: string | null = null;

  if (result === 'challenger') {
    winnerId = updated.challenger_id;
    loserId = updated.opponent_id;
  } else if (result === 'opponent') {
    winnerId = updated.opponent_id;
    loserId = updated.challenger_id;
  }

  // Atomically mark as completed (prevents double-resolution race)
  const completed = await rpsService.completeChallenge(challengeId, winnerId);
  if (!completed) {
    // Another handler already resolved this
    await interaction.deferUpdate();
    return;
  }

  // Handle payouts and stats
  if (result === 'draw') {
    await pointsService.addPoints(updated.challenger_id, guildId, updated.bet_amount, 'RPS draw - refund', 'other');
    await pointsService.addPoints(updated.opponent_id, guildId, updated.bet_amount, 'RPS draw - refund', 'other');

    const pushResult: GameResult = { outcome: 'push', payout: updated.bet_amount, multiplier: 1 };
    await statsService.recordGameResult(updated.challenger_id, guildId, 'rps', updated.bet_amount, pushResult);
    await statsService.recordGameResult(updated.opponent_id, guildId, 'rps', updated.bet_amount, pushResult);
  } else {
    const totalPrize = updated.bet_amount * 2;
    await pointsService.addPoints(winnerId!, guildId, totalPrize, 'RPS winner', 'other');

    const winResult: GameResult = { outcome: 'win', payout: totalPrize, multiplier: 2 };
    await statsService.recordGameResult(winnerId!, guildId, 'rps', updated.bet_amount, winResult);

    const lossResult: GameResult = { outcome: 'loss', payout: 0, multiplier: 0 };
    await statsService.recordGameResult(loserId!, guildId, 'rps', updated.bet_amount, lossResult);

    await checkAndAnnounceBankruptcy(interaction, loserId!, guildId, statsService, pointsService);
  }

  // Update the public message with results
  const finalChallenge = await rpsService.getChallenge(challengeId);
  if (finalChallenge) {
    const embed = createResultEmbed(finalChallenge);
    await interaction.update({ embeds: [embed], components: [] });
  }
}

export async function handleChoiceTimeout(
  challengeId: string,
  rpsService: RPSService,
  statsService: GamblingStatsService,
  pointsService: PointsService,
  client: Client
): Promise<void> {
  const challenge = await rpsService.getChallenge(challengeId);
  if (!challenge || challenge.status !== 'accepted') return;

  const challengerChose = !!challenge.challenger_choice;
  const opponentChose = !!challenge.opponent_choice;

  // If both chose, the button handler should have resolved it already
  if (challengerChose && opponentChose) return;

  let winnerId: string | null = null;
  let loserId: string | null = null;

  if (challengerChose && !opponentChose) {
    winnerId = challenge.challenger_id;
    loserId = challenge.opponent_id;
  } else if (!challengerChose && opponentChose) {
    winnerId = challenge.opponent_id;
    loserId = challenge.challenger_id;
  }

  const forfeited = await rpsService.forfeitChallenge(challengeId, winnerId);
  if (!forfeited) return;

  if (winnerId && loserId) {
    // One player wins by forfeit
    const totalPrize = challenge.bet_amount * 2;
    await pointsService.addPoints(winnerId, challenge.guild_id, totalPrize, 'RPS forfeit win', 'other');

    const winResult: GameResult = { outcome: 'win', payout: totalPrize, multiplier: 2 };
    await statsService.recordGameResult(winnerId, challenge.guild_id, 'rps', challenge.bet_amount, winResult);

    const lossResult: GameResult = { outcome: 'loss', payout: 0, multiplier: 0 };
    await statsService.recordGameResult(loserId, challenge.guild_id, 'rps', challenge.bet_amount, lossResult);
  } else {
    // Neither chose - refund both
    await pointsService.addPoints(
      challenge.challenger_id, challenge.guild_id, challenge.bet_amount,
      'RPS timeout - refund', 'other'
    );
    await pointsService.addPoints(
      challenge.opponent_id, challenge.guild_id, challenge.bet_amount,
      'RPS timeout - refund', 'other'
    );
  }

  // Update the challenge message
  try {
    const channel = await client.channels.fetch(challenge.channel_id);
    if (channel && challenge.message_id) {
      const textChannel = channel as TextChannel;
      const message = await textChannel.messages.fetch(challenge.message_id);
      const embed = createTimeoutEmbed(challenge);
      await message.edit({ embeds: [embed], components: [] });
    }
  } catch (error) {
    logger.error(`Failed to update RPS message for challenge ${challengeId}:`, error);
  }
}
