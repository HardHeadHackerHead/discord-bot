import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { RPSService } from '../../services/RPSService.js';
import { PointsService } from '../../../points/services/PointsService.js';
import { createChallengeEmbed } from '../../games/rps.js';

export async function handleRPS(
  interaction: ChatInputCommandInteraction,
  rpsService: RPSService,
  pointsService: PointsService
): Promise<void> {
  const betAmount = interaction.options.getInteger('bet', true);
  const opponent = interaction.options.getUser('opponent', true);
  const userId = interaction.user.id;
  const guildId = interaction.guildId!;
  const channelId = interaction.channelId;

  if (opponent.id === userId) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Invalid Challenge')
          .setDescription("You can't challenge yourself!")
          .setColor(0xFF0000)
      ],
      ephemeral: true,
    });
    return;
  }

  if (opponent.bot) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Invalid Challenge')
          .setDescription("You can't challenge a bot!")
          .setColor(0xFF0000)
      ],
      ephemeral: true,
    });
    return;
  }

  const points = await pointsService.getPoints(userId, guildId);
  const balance = points?.balance ?? 0;

  if (balance < betAmount) {
    await interaction.reply({
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
      ephemeral: true,
    });
    return;
  }

  // Deduct bet from challenger immediately
  await pointsService.removePoints(userId, guildId, betAmount, 'RPS challenge bet', userId);

  // Create challenge in DB
  const challenge = await rpsService.createChallenge(guildId, channelId, userId, opponent.id, betAmount);

  // Send public challenge embed
  const { embed, row } = createChallengeEmbed(userId, opponent.id, betAmount, challenge.id, challenge.expires_at);
  const reply = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });

  // Store message ID for later updates
  await rpsService.setMessageId(challenge.id, reply.id);
}
