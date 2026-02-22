import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
} from 'discord.js';
import { defineSlashCommand } from '../../../types/command.types.js';
import { createEmbed, COLORS, errorEmbed, successEmbed } from '../../../shared/utils/embed.js';
import { PointsService } from '../services/PointsService.js';

let pointsService: PointsService | null = null;

export function setPointsService(service: PointsService): void {
  pointsService = service;
}

export const command = defineSlashCommand(
  new SlashCommandBuilder()
    .setName('points')
    .setDescription('Manage and view points')
    .addSubcommand((sub) =>
      sub
        .setName('balance')
        .setDescription('Check your or another user\'s point balance')
        .addUserOption((opt) =>
          opt
            .setName('user')
            .setDescription('User to check (defaults to yourself)')
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('give')
        .setDescription('Give points to a user (Admin only)')
        .addUserOption((opt) =>
          opt
            .setName('user')
            .setDescription('User to give points to')
            .setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('amount')
            .setDescription('Amount of points to give')
            .setRequired(true)
            .setMinValue(1)
        )
        .addStringOption((opt) =>
          opt
            .setName('reason')
            .setDescription('Reason for giving points')
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('take')
        .setDescription('Take points from a user (Admin only)')
        .addUserOption((opt) =>
          opt
            .setName('user')
            .setDescription('User to take points from')
            .setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('amount')
            .setDescription('Amount of points to take')
            .setRequired(true)
            .setMinValue(1)
        )
        .addStringOption((opt) =>
          opt
            .setName('reason')
            .setDescription('Reason for taking points')
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Set a user\'s points to a specific amount (Admin only)')
        .addUserOption((opt) =>
          opt
            .setName('user')
            .setDescription('User to set points for')
            .setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('amount')
            .setDescription('Amount to set points to')
            .setRequired(true)
            .setMinValue(0)
        )
        .addStringOption((opt) =>
          opt
            .setName('reason')
            .setDescription('Reason for setting points')
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('history')
        .setDescription('View your recent point transactions')
        .addIntegerOption((opt) =>
          opt
            .setName('limit')
            .setDescription('Number of transactions to show (default: 10)')
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(25)
        )
    ) as SlashCommandBuilder,

  async (interaction: ChatInputCommandInteraction) => {
    if (!pointsService) {
      await interaction.reply({
        embeds: [errorEmbed('Error', 'Points service not available')],
        ephemeral: true,
      });
      return;
    }

    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({
        embeds: [errorEmbed('Error', 'This command can only be used in a server')],
        ephemeral: true,
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'balance':
        await handleBalance(interaction, pointsService, guildId);
        break;
      case 'give':
        await handleGive(interaction, pointsService, guildId);
        break;
      case 'take':
        await handleTake(interaction, pointsService, guildId);
        break;
      case 'set':
        await handleSet(interaction, pointsService, guildId);
        break;
      case 'history':
        await handleHistory(interaction, pointsService, guildId);
        break;
    }
  },
  {
    guildOnly: true,
  }
);

async function handleBalance(
  interaction: ChatInputCommandInteraction,
  service: PointsService,
  guildId: string
): Promise<void> {
  const targetUser = interaction.options.getUser('user') || interaction.user;

  const points = await service.getPoints(targetUser.id, guildId);
  const balance = points?.balance ?? 0;
  const lifetime = points?.lifetime_earned ?? 0;
  const rank = await service.getUserRank(targetUser.id, guildId);
  const totalUsers = await service.getTotalUsers(guildId);

  const embed = createEmbed(COLORS.primary)
    .setTitle(`💰 ${targetUser.displayName}'s Points`)
    .setThumbnail(targetUser.displayAvatarURL({ size: 128 }))
    .addFields(
      { name: 'Balance', value: `**${balance.toLocaleString()}** points`, inline: true },
      { name: 'Lifetime Earned', value: `${lifetime.toLocaleString()} points`, inline: true },
      { name: 'Rank', value: totalUsers > 0 ? `#${rank} of ${totalUsers}` : 'N/A', inline: true }
    );

  await interaction.reply({ embeds: [embed] });
}

async function handleGive(
  interaction: ChatInputCommandInteraction,
  service: PointsService,
  guildId: string
): Promise<void> {
  // Check permissions
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      embeds: [errorEmbed('Permission Denied', 'You need the Manage Server permission to give points')],
      ephemeral: true,
    });
    return;
  }

  const targetUser = interaction.options.getUser('user', true);
  const amount = interaction.options.getInteger('amount', true);
  const reason = interaction.options.getString('reason') || 'Admin gift';

  if (targetUser.bot) {
    await interaction.reply({
      embeds: [errorEmbed('Error', 'Cannot give points to bots')],
      ephemeral: true,
    });
    return;
  }

  const result = await service.addPoints(
    targetUser.id,
    guildId,
    amount,
    reason,
    'manual',
    interaction.user.id
  );

  const embed = successEmbed(
    'Points Given',
    `Gave **${amount.toLocaleString()}** points to ${targetUser}\n` +
    `**Reason:** ${reason}\n` +
    `**New Balance:** ${result.newBalance.toLocaleString()} points`
  );

  await interaction.reply({ embeds: [embed] });
}

async function handleTake(
  interaction: ChatInputCommandInteraction,
  service: PointsService,
  guildId: string
): Promise<void> {
  // Check permissions
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      embeds: [errorEmbed('Permission Denied', 'You need the Manage Server permission to take points')],
      ephemeral: true,
    });
    return;
  }

  const targetUser = interaction.options.getUser('user', true);
  const amount = interaction.options.getInteger('amount', true);
  const reason = interaction.options.getString('reason') || 'Admin action';

  const result = await service.removePoints(
    targetUser.id,
    guildId,
    amount,
    reason,
    interaction.user.id
  );

  const embed = successEmbed(
    'Points Taken',
    `Took **${amount.toLocaleString()}** points from ${targetUser}\n` +
    `**Reason:** ${reason}\n` +
    `**New Balance:** ${result.newBalance.toLocaleString()} points`
  );

  await interaction.reply({ embeds: [embed] });
}

async function handleSet(
  interaction: ChatInputCommandInteraction,
  service: PointsService,
  guildId: string
): Promise<void> {
  // Check permissions
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      embeds: [errorEmbed('Permission Denied', 'You need the Manage Server permission to set points')],
      ephemeral: true,
    });
    return;
  }

  const targetUser = interaction.options.getUser('user', true);
  const amount = interaction.options.getInteger('amount', true);
  const reason = interaction.options.getString('reason') || 'Admin set';

  const result = await service.setPoints(
    targetUser.id,
    guildId,
    amount,
    reason,
    interaction.user.id
  );

  const embed = successEmbed(
    'Points Set',
    `Set ${targetUser}'s points to **${amount.toLocaleString()}**\n` +
    `**Reason:** ${reason}`
  );

  await interaction.reply({ embeds: [embed] });
}

async function handleHistory(
  interaction: ChatInputCommandInteraction,
  service: PointsService,
  guildId: string
): Promise<void> {
  const limit = interaction.options.getInteger('limit') || 10;

  const transactions = await service.getTransactions(interaction.user.id, guildId, limit);

  if (transactions.length === 0) {
    await interaction.reply({
      embeds: [createEmbed(COLORS.neutral)
        .setTitle('📜 Point History')
        .setDescription('No transactions found.')],
      ephemeral: true,
    });
    return;
  }

  const lines = transactions.map((t) => {
    const sign = t.amount >= 0 ? '+' : '';
    const emoji = t.amount >= 0 ? '🟢' : '🔴';
    const time = `<t:${Math.floor(t.created_at.getTime() / 1000)}:R>`;
    return `${emoji} **${sign}${t.amount}** - ${t.reason || 'No reason'} (${time})`;
  });

  const embed = createEmbed(COLORS.primary)
    .setTitle('📜 Point History')
    .setDescription(lines.join('\n'));

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
