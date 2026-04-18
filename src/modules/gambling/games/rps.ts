import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { RPSChoice, RPSChallenge } from '../types.js';

const CHOICE_EMOJI: Record<RPSChoice, string> = {
  rock: '\u270A',
  paper: '\u270B',
  scissors: '\u2702\uFE0F',
};

const CHOICE_DISPLAY: Record<RPSChoice, string> = {
  rock: 'Rock',
  paper: 'Paper',
  scissors: 'Scissors',
};

export function determineRPSWinner(
  challengerChoice: RPSChoice,
  opponentChoice: RPSChoice
): 'challenger' | 'opponent' | 'draw' {
  if (challengerChoice === opponentChoice) return 'draw';

  const beats: Record<RPSChoice, RPSChoice> = {
    rock: 'scissors',
    paper: 'rock',
    scissors: 'paper',
  };

  return beats[challengerChoice] === opponentChoice ? 'challenger' : 'opponent';
}

export function createChallengeEmbed(
  challengerId: string,
  opponentId: string,
  betAmount: number,
  challengeId: string,
  expiresAt: Date
): { embed: EmbedBuilder; row: ActionRowBuilder<ButtonBuilder> } {
  const timestamp = Math.floor(expiresAt.getTime() / 1000);

  const embed = new EmbedBuilder()
    .setTitle('\u270A\u270B\u2702\uFE0F Rock Paper Scissors Challenge!')
    .setDescription(
      `<@${challengerId}> has challenged <@${opponentId}> to Rock Paper Scissors!\n\n` +
      `**Bet:** ${betAmount.toLocaleString()} points each\n` +
      `**Prize:** ${(betAmount * 2).toLocaleString()} points to the winner!\n\n` +
      `<@${opponentId}>, do you accept? Expires <t:${timestamp}:R>`
    )
    .setColor(0xFFD700);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`rps:accept:${challengeId}`)
      .setLabel('Accept Challenge')
      .setEmoji('\u2705')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`rps:decline:${challengeId}`)
      .setLabel('Decline')
      .setEmoji('\u274C')
      .setStyle(ButtonStyle.Danger),
  );

  return { embed, row };
}

export function createAcceptedEmbed(
  challengerId: string,
  opponentId: string,
  betAmount: number,
  challengeId: string,
  choiceDeadline: Date
): { embed: EmbedBuilder; row: ActionRowBuilder<ButtonBuilder> } {
  const timestamp = Math.floor(choiceDeadline.getTime() / 1000);

  const embed = new EmbedBuilder()
    .setTitle('\u270A\u270B\u2702\uFE0F Challenge Accepted!')
    .setDescription(
      `<@${opponentId}> accepted <@${challengerId}>'s challenge!\n\n` +
      `**Bet:** ${betAmount.toLocaleString()} points each\n` +
      `**Prize:** ${(betAmount * 2).toLocaleString()} points\n\n` +
      `Both players, pick your weapon! Time expires <t:${timestamp}:R>`
    )
    .setColor(0x3498DB);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`rps:rock:${challengeId}`)
      .setLabel('Rock')
      .setEmoji('\u270A')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`rps:paper:${challengeId}`)
      .setLabel('Paper')
      .setEmoji('\u270B')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`rps:scissors:${challengeId}`)
      .setLabel('Scissors')
      .setEmoji('\u2702\uFE0F')
      .setStyle(ButtonStyle.Primary),
  );

  return { embed, row };
}

export function createResultEmbed(challenge: RPSChallenge): EmbedBuilder {
  const challengerChoice = challenge.challenger_choice!;
  const opponentChoice = challenge.opponent_choice!;
  const result = determineRPSWinner(challengerChoice, opponentChoice);

  if (result === 'draw') {
    return new EmbedBuilder()
      .setTitle('\u{1F91D} It\'s a Draw!')
      .setDescription(
        `${CHOICE_EMOJI[challengerChoice]} <@${challenge.challenger_id}> chose **${CHOICE_DISPLAY[challengerChoice]}**\n` +
        `${CHOICE_EMOJI[opponentChoice]} <@${challenge.opponent_id}> chose **${CHOICE_DISPLAY[opponentChoice]}**\n\n` +
        `Both players get their **${challenge.bet_amount.toLocaleString()}** points back!`
      )
      .setColor(0xFFFF00)
      .setTimestamp();
  }

  const winnerId = result === 'challenger' ? challenge.challenger_id : challenge.opponent_id;
  const winnerChoice = result === 'challenger' ? challengerChoice : opponentChoice;
  const loserChoice = result === 'challenger' ? opponentChoice : challengerChoice;

  return new EmbedBuilder()
    .setTitle(`${CHOICE_EMOJI[winnerChoice]} <@${winnerId}> Wins!`)
    .setDescription(
      `${CHOICE_EMOJI[challengerChoice]} <@${challenge.challenger_id}> chose **${CHOICE_DISPLAY[challengerChoice]}**\n` +
      `${CHOICE_EMOJI[opponentChoice]} <@${challenge.opponent_id}> chose **${CHOICE_DISPLAY[opponentChoice]}**\n\n` +
      `**${CHOICE_DISPLAY[winnerChoice]}** beats **${CHOICE_DISPLAY[loserChoice]}**!\n` +
      `<@${winnerId}> wins **${(challenge.bet_amount * 2).toLocaleString()}** points!`
    )
    .setColor(0x00FF00)
    .setTimestamp();
}

export function createDeclinedEmbed(
  challengerId: string,
  opponentId: string,
  betAmount: number
): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('\u274C Challenge Declined')
    .setDescription(
      `<@${opponentId}> declined <@${challengerId}>'s challenge.\n` +
      `**${betAmount.toLocaleString()}** points have been refunded.`
    )
    .setColor(0x808080);
}

export function createExpiredEmbed(
  challengerId: string,
  opponentId: string,
  betAmount: number
): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('\u23F0 Challenge Expired')
    .setDescription(
      `<@${opponentId}> didn't respond to <@${challengerId}>'s challenge in time.\n` +
      `**${betAmount.toLocaleString()}** points have been refunded.`
    )
    .setColor(0x808080);
}

export function createTimeoutEmbed(challenge: RPSChallenge): EmbedBuilder {
  const challengerChose = !!challenge.challenger_choice;
  const opponentChose = !!challenge.opponent_choice;

  if (!challengerChose && !opponentChose) {
    return new EmbedBuilder()
      .setTitle('\u23F0 Time\'s Up!')
      .setDescription(
        `Neither <@${challenge.challenger_id}> nor <@${challenge.opponent_id}> chose in time.\n` +
        `Both players get their **${challenge.bet_amount.toLocaleString()}** points back.`
      )
      .setColor(0xFF8C00)
      .setTimestamp();
  }

  const winnerId = challengerChose ? challenge.challenger_id : challenge.opponent_id;
  const forfeiterId = challengerChose ? challenge.opponent_id : challenge.challenger_id;

  return new EmbedBuilder()
    .setTitle('\u23F0 Forfeit!')
    .setDescription(
      `<@${forfeiterId}> didn't choose in time and forfeits!\n\n` +
      `<@${winnerId}> wins **${(challenge.bet_amount * 2).toLocaleString()}** points!`
    )
    .setColor(0xFF8C00)
    .setTimestamp();
}
