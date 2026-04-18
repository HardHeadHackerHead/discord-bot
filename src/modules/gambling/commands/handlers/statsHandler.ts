import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { GamblingStatsService } from '../../services/GamblingStatsService.js';

export async function handleStats(
  interaction: ChatInputCommandInteraction,
  statsService: GamblingStatsService
): Promise<void> {
  const targetUser = interaction.options.getUser('user') ?? interaction.user;
  const guildId = interaction.guildId!;

  const stats = await statsService.getStats(targetUser.id, guildId);

  if (!stats || stats.total_bets === 0) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle(`${targetUser.displayName}'s Gambling Stats`)
          .setDescription('No gambling history found!')
          .setColor(0x808080)
          .setThumbnail(targetUser.displayAvatarURL())
      ],
      ephemeral: true,
    });
    return;
  }

  const totalWins = stats.coinflip_wins + stats.slots_wins + stats.roulette_wins + stats.blackjack_wins + stats.rps_wins;
  const winRate = (totalWins / (stats.total_bets - stats.blackjack_pushes) * 100).toFixed(1);

  const embed = new EmbedBuilder()
    .setTitle(`${targetUser.displayName}'s Gambling Stats`)
    .setColor(stats.net_profit >= 0 ? 0x00FF00 : 0xFF0000)
    .setThumbnail(targetUser.displayAvatarURL())
    .addFields(
      {
        name: '\u{1F4CA} Overall Stats',
        value: [
          `**Total Bets:** ${stats.total_bets.toLocaleString()}`,
          `**Total Wagered:** ${stats.total_wagered.toLocaleString()} points`,
          `**Net Profit:** ${stats.net_profit >= 0 ? '+' : ''}${stats.net_profit.toLocaleString()} points`,
          `**Win Rate:** ${winRate}%`,
        ].join('\n'),
        inline: false,
      },
      {
        name: '\u{1F3C6} Records',
        value: [
          `**Biggest Win:** +${stats.biggest_win.toLocaleString()} points`,
          `**Biggest Loss:** ${stats.biggest_loss.toLocaleString()} points`,
          `**Best Win Streak:** ${stats.best_win_streak}`,
          `**Worst Loss Streak:** ${Math.abs(stats.worst_loss_streak)}`,
          `**Bankruptcies:** ${stats.bankruptcies}`,
        ].join('\n'),
        inline: false,
      },
      {
        name: '\u{1FA99} Coinflip',
        value: `${stats.coinflip_wins}W / ${stats.coinflip_losses}L`,
        inline: true,
      },
      {
        name: '\u{1F3B0} Slots',
        value: `${stats.slots_wins}W / ${stats.slots_losses}L`,
        inline: true,
      },
      {
        name: '\u{1F3A1} Roulette',
        value: `${stats.roulette_wins}W / ${stats.roulette_losses}L`,
        inline: true,
      },
      {
        name: '\u{1F0CF} Blackjack',
        value: `${stats.blackjack_wins}W / ${stats.blackjack_losses}L / ${stats.blackjack_pushes}P`,
        inline: true,
      },
      {
        name: '\u270A Rock Paper Scissors',
        value: `${stats.rps_wins}W / ${stats.rps_losses}L`,
        inline: true,
      }
    )
    .setFooter({ text: `Current Streak: ${stats.current_streak >= 0 ? '+' : ''}${stats.current_streak}` });

  await interaction.reply({
    embeds: [embed],
    ephemeral: true,
  });
}
