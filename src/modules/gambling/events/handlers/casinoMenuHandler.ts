import {
  ButtonInteraction,
  ModalSubmitInteraction,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
} from 'discord.js';
import { GamblingStatsService } from '../../services/GamblingStatsService.js';
import { BlackjackService } from '../../services/BlackjackService.js';
import { PointsService } from '../../../points/services/PointsService.js';
import { createPaytableEmbed } from '../../games/slots.js';

export async function handleCasinoButton(
  interaction: ButtonInteraction,
  statsService: GamblingStatsService,
  blackjackService: BlackjackService,
  pointsService: PointsService
): Promise<void> {
  const parts = interaction.customId.split(':');
  const action = parts[1] ?? '';

  switch (action) {
    case 'play': {
      const game = parts[2] ?? '';
      // Open a modal asking for bet amount
      const modal = new ModalBuilder()
        .setCustomId(`casino:betmodal:${game}`)
        .setTitle(`${gameTitle(game)} — Place Your Bet`)
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId('bet_amount')
              .setLabel('How many points?')
              .setPlaceholder('e.g. 100')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setMinLength(1)
              .setMaxLength(15)
          )
        );
      await interaction.showModal(modal);
      break;
    }

    case 'stats': {
      const stats = await statsService.getStats(interaction.user.id, interaction.guildId!);

      if (!stats || stats.total_bets === 0) {
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle(`${interaction.user.displayName}'s Stats`)
              .setDescription('No gambling history yet — go play something!')
              .setColor(0x808080)
          ],
          ephemeral: true,
        });
        return;
      }

      const totalWins = stats.coinflip_wins + stats.slots_wins + stats.roulette_wins + stats.blackjack_wins + (stats.rps_wins ?? 0);
      const divisor = stats.total_bets - stats.blackjack_pushes;
      const winRate = divisor > 0 ? ((totalWins / divisor) * 100).toFixed(1) : '0.0';

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`${interaction.user.displayName}'s Gambling Stats`)
            .setColor(stats.net_profit >= 0 ? 0x00c853 : 0xe53935)
            .addFields(
              {
                name: 'Overview',
                value: [
                  `**Bets:** ${stats.total_bets.toLocaleString()}`,
                  `**Wagered:** ${stats.total_wagered.toLocaleString()} pts`,
                  `**Net:** ${stats.net_profit >= 0 ? '+' : ''}${stats.net_profit.toLocaleString()} pts`,
                  `**Win Rate:** ${winRate}%`,
                ].join('\n'),
                inline: true,
              },
              {
                name: 'Records',
                value: [
                  `**Best Win:** +${stats.biggest_win.toLocaleString()} pts`,
                  `**Worst Loss:** ${stats.biggest_loss.toLocaleString()} pts`,
                  `**Win Streak:** ${stats.best_win_streak}`,
                  `**Loss Streak:** ${Math.abs(stats.worst_loss_streak)}`,
                ].join('\n'),
                inline: true,
              },
              {
                name: 'Games',
                value: [
                  `\u{1FA99} Coinflip: ${stats.coinflip_wins}W / ${stats.coinflip_losses}L`,
                  `\u{1F3B0} Slots: ${stats.slots_wins}W / ${stats.slots_losses}L`,
                  `\u{1F0CF} Blackjack: ${stats.blackjack_wins}W / ${stats.blackjack_losses}L / ${stats.blackjack_pushes}P`,
                  `\u{1F3B0} Roulette: ${stats.roulette_wins}W / ${stats.roulette_losses}L`,
                  `\u270A RPS: ${stats.rps_wins ?? 0}W / ${stats.rps_losses ?? 0}L`,
                ].join('\n'),
                inline: false,
              }
            )
        ],
        ephemeral: true,
      });
      break;
    }

    case 'paytable': {
      await interaction.reply({
        embeds: [createPaytableEmbed()],
        ephemeral: true,
      });
      break;
    }
  }
}

export async function handleCasinoModal(
  interaction: ModalSubmitInteraction,
  statsService: GamblingStatsService,
  blackjackService: BlackjackService,
  pointsService: PointsService
): Promise<void> {
  const parts = interaction.customId.split(':');
  const game = parts[2] ?? '';
  const betAmountStr = interaction.fields.getTextInputValue('bet_amount');
  const betAmount = parseInt(betAmountStr);

  if (isNaN(betAmount) || betAmount < 1) {
    await interaction.reply({
      embeds: [new EmbedBuilder().setDescription('Enter a valid bet amount (at least **1**).').setColor(0xe53935)],
      ephemeral: true,
    });
    return;
  }

  const userId = interaction.user.id;
  const guildId = interaction.guildId!;

  // Check balance
  const pts = await pointsService.getPoints(userId, guildId);
  const balance = pts?.balance ?? 0;

  if (balance < betAmount) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setDescription(`Not enough points.\n**Balance:** ${balance.toLocaleString()} pts\n**Bet:** ${betAmount.toLocaleString()} pts`)
          .setColor(0xe53935)
      ],
      ephemeral: true,
    });
    return;
  }

  switch (game) {
    case 'coinflip': {
      // Deduct bet, then show coinflip selection
      await pointsService.removePoints(userId, guildId, betAmount, 'Coinflip bet', userId);
      const { createCoinflipSelectionEmbed } = await import('../../games/coinflip.js');
      const freshPts = await pointsService.getPoints(userId, guildId);
      const { embed, row } = createCoinflipSelectionEmbed(betAmount, freshPts?.balance ?? 0);
      await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      break;
    }

    case 'slots': {
      // Deduct bet, show spinning, resolve
      const { playSlots, createSlotsResultEmbed, createSpinningEmbed } = await import('../../games/slots.js');
      await pointsService.removePoints(userId, guildId, betAmount, 'Slots bet', userId);

      await interaction.reply({ embeds: [createSpinningEmbed()], ephemeral: true });
      await new Promise(resolve => setTimeout(resolve, 1500));

      const result = playSlots(betAmount);
      await statsService.recordGameResult(userId, guildId, 'slots', betAmount, result);

      if (result.payout > 0) {
        await pointsService.addPoints(userId, guildId, result.payout, 'Slots winnings', 'other');
      }

      const updatedPts = await pointsService.getPoints(userId, guildId);
      await interaction.editReply({
        embeds: [createSlotsResultEmbed(result, betAmount, updatedPts?.balance ?? 0)],
      });
      break;
    }

    case 'blackjack': {
      const { startBlackjackGame } = await import('../../commands/handlers/blackjackHandler.js');
      await startBlackjackGame(interaction as unknown as import('discord.js').ButtonInteraction, betAmount, statsService, blackjackService, pointsService);
      break;
    }
  }
}

function gameTitle(game: string): string {
  switch (game) {
    case 'coinflip': return 'Coinflip';
    case 'slots': return 'Slots';
    case 'blackjack': return 'Blackjack';
    default: return 'Game';
  }
}
