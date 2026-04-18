import { EmbedBuilder, TextChannel, ButtonInteraction, ChatInputCommandInteraction, ModalSubmitInteraction } from 'discord.js';
import { GamblingStatsService } from '../services/GamblingStatsService.js';
import { PointsService } from '../../points/services/PointsService.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('Gambling:Bankruptcy');

/**
 * Check if a user just went bankrupt after a game and announce it publicly.
 * A user is considered bankrupt when their balance reaches 0 or below.
 */
export async function checkAndAnnounceBankruptcy(
  interaction: ButtonInteraction | ChatInputCommandInteraction | ModalSubmitInteraction,
  userId: string,
  guildId: string,
  statsService: GamblingStatsService,
  pointsService: PointsService
): Promise<void> {
  const points = await pointsService.getPoints(userId, guildId);
  const balance = points?.balance ?? 0;

  if (balance > 0) return;

  // They're bankrupt — record it and announce
  const bankruptcyCount = await statsService.recordBankruptcy(userId, guildId);

  const embed = new EmbedBuilder()
    .setTitle('\uD83D\uDCB8 BANKRUPT!')
    .setDescription(
      `<@${userId}> just went **BANKRUPT!** They've lost everything!\n\n` +
      `This is bankruptcy **#${bankruptcyCount}** for them.`
    )
    .setColor(0xFF0000)
    .setTimestamp();

  if (bankruptcyCount >= 5) {
    embed.setFooter({ text: `Down bad... ${bankruptcyCount} bankruptcies and counting` });
  }

  try {
    const channel = interaction.channel as TextChannel;
    if (channel) {
      await channel.send({ embeds: [embed] });
    }
  } catch (error) {
    logger.error('Failed to send bankruptcy announcement:', error);
  }
}
