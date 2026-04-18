import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  GuildMember,
} from 'discord.js';
import { SlashCommand } from '../../../types/command.types.js';
import { IdeasService, IdeaStatus } from '../services/IdeasService.js';
import { IdeasPanel } from '../components/IdeasPanel.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('Ideas:Command');

let ideasService: IdeasService | null = null;

export function setIdeasService(service: IdeasService): void {
  ideasService = service;
}

const ITEMS_PER_PAGE = 10;

export const command: SlashCommand = {
  type: 'slash',
  data: new SlashCommandBuilder()
    .setName('ideas')
    .setDescription('View and manage community ideas')
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('List all ideas')
        .addStringOption(option =>
          option
            .setName('status')
            .setDescription('Filter by status')
            .setRequired(false)
            .addChoices(
              { name: 'All', value: 'all' },
              { name: 'Pending', value: 'pending' },
              { name: 'Approved', value: 'approved' },
              { name: 'Rejected', value: 'rejected' },
              { name: 'Implemented', value: 'implemented' }
            )
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('view')
        .setDescription('View a specific idea')
        .addStringOption(option =>
          option
            .setName('id')
            .setDescription('The idea ID (first 8 characters are enough)')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('status')
        .setDescription('Change an idea\'s status (admin only)')
        .addStringOption(option =>
          option
            .setName('id')
            .setDescription('The idea ID')
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('new_status')
            .setDescription('The new status')
            .setRequired(true)
            .addChoices(
              { name: 'Pending', value: 'pending' },
              { name: 'Approved', value: 'approved' },
              { name: 'Rejected', value: 'rejected' },
              { name: 'Implemented', value: 'implemented' }
            )
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('stats')
        .setDescription('Show ideas statistics for this server')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('suggestions')
        .setDescription('Review pending suggestions for an idea (admin only)')
        .addStringOption(option =>
          option
            .setName('id')
            .setDescription('The idea ID')
            .setRequired(true)
        )
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!ideasService) {
      await interaction.reply({
        content: '❌ Ideas service is not initialized.',
        ephemeral: true,
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'list':
        await handleList(interaction, ideasService);
        break;
      case 'view':
        await handleView(interaction, ideasService);
        break;
      case 'status':
        await handleStatus(interaction, ideasService);
        break;
      case 'stats':
        await handleStats(interaction, ideasService);
        break;
      case 'suggestions':
        await handleSuggestions(interaction, ideasService);
        break;
    }
  },
};

/**
 * Handle /ideas list
 */
async function handleList(
  interaction: ChatInputCommandInteraction,
  service: IdeasService
): Promise<void> {
  const statusFilter = interaction.options.getString('status');
  const status = statusFilter && statusFilter !== 'all' ? statusFilter as IdeaStatus : undefined;

  const totalCount = await service.getIdeasCount(interaction.guildId!, status);
  const totalPages = Math.max(1, Math.ceil(totalCount / ITEMS_PER_PAGE));
  const ideas = await service.getIdeasByGuild(interaction.guildId!, status, ITEMS_PER_PAGE, 0);

  const embed = IdeasPanel.createListEmbed(ideas, 0, totalPages, status);
  const components = [];

  if (totalPages > 1) {
    components.push(IdeasPanel.createListButtons(0, totalPages, status));
  }
  components.push(IdeasPanel.createStatusFilter(status));

  await interaction.reply({
    embeds: [embed],
    components,
    ephemeral: true,
  });
}

/**
 * Handle /ideas view
 */
async function handleView(
  interaction: ChatInputCommandInteraction,
  service: IdeasService
): Promise<void> {
  const ideaId = interaction.options.getString('id', true);

  // Try to find the idea (support partial ID)
  let idea = await service.getIdea(ideaId);

  // If not found, try searching by partial ID
  if (!idea) {
    const allIdeas = await service.getIdeasByGuild(interaction.guildId!, undefined, 100, 0);
    idea = allIdeas.find(i => i.id.startsWith(ideaId)) || null;
  }

  if (!idea) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed('Not Found', `Could not find an idea with ID starting with \`${ideaId}\`.`)],
      ephemeral: true,
    });
    return;
  }

  const suggestions = await service.getSuggestionsForIdea(idea.id);
  const embed = IdeasPanel.createIdeaEmbed(idea, suggestions);

  // Check if user is admin
  const member = interaction.member as GuildMember;
  const isAdmin = member.permissions.has(PermissionFlagsBits.ManageMessages);

  const components = [];
  if (isAdmin) {
    components.push(IdeasPanel.createAdminButtons(idea));
  }

  await interaction.reply({
    embeds: [embed],
    components,
    ephemeral: true,
  });
}

/**
 * Handle /ideas status
 */
async function handleStatus(
  interaction: ChatInputCommandInteraction,
  service: IdeasService
): Promise<void> {
  // Check admin permission
  const member = interaction.member as GuildMember;
  if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed(
        'Permission Denied',
        'You need the **Manage Messages** permission to change idea status.'
      )],
      ephemeral: true,
    });
    return;
  }

  const ideaId = interaction.options.getString('id', true);
  const newStatus = interaction.options.getString('new_status', true) as IdeaStatus;

  // Find the idea
  let idea = await service.getIdea(ideaId);
  if (!idea) {
    const allIdeas = await service.getIdeasByGuild(interaction.guildId!, undefined, 100, 0);
    idea = allIdeas.find(i => i.id.startsWith(ideaId)) || null;
  }

  if (!idea) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed('Not Found', `Could not find an idea with ID starting with \`${ideaId}\`.`)],
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  // Update status
  const updatedIdea = await service.updateStatus(idea.id, newStatus, interaction.user.id);

  // Lock/unlock thread based on status
  if (newStatus === 'approved' || newStatus === 'rejected' || newStatus === 'implemented') {
    await service.lockThread(interaction.client, idea.thread_id);
  } else if (newStatus === 'pending') {
    await service.unlockThread(interaction.client, idea.thread_id);
  }

  // Send notification to the thread
  try {
    const thread = await interaction.client.channels.fetch(idea.thread_id);
    if (thread?.isThread()) {
      const statusMessages: Record<IdeaStatus, string> = {
        pending: '📝 This idea has been **reopened** for discussion.',
        submitted: '📬 This idea has been **submitted** for review.',
        under_review: '👀 This idea is now **under review**.',
        approved: '✅ This idea has been **approved**! The thread is now locked.',
        rejected: '❌ This idea has been **rejected**. The thread is now locked.',
        in_progress: '🔨 This idea is now **in progress**!',
        implemented: '🎉 This idea has been **implemented**! The thread is now locked.',
      };

      await thread.send({
        embeds: [IdeasPanel.createInfoEmbed(
          'Status Updated',
          `${statusMessages[newStatus]}\n\nUpdated by <@${interaction.user.id}>`
        )],
      });
    }
  } catch (error) {
    logger.warn('Could not send status update to thread:', error);
  }

  const suggestions = await service.getSuggestionsForIdea(idea.id);
  const embed = IdeasPanel.createIdeaEmbed(updatedIdea!, suggestions);

  await interaction.editReply({
    embeds: [
      IdeasPanel.createSuccessEmbed('Status Updated', `Idea status changed to **${newStatus}**.`),
      embed,
    ],
  });

  logger.info(`Idea ${idea.id} status changed to ${newStatus} by ${interaction.user.username}`);
}

/**
 * Handle /ideas stats
 */
async function handleStats(
  interaction: ChatInputCommandInteraction,
  service: IdeasService
): Promise<void> {
  const [pending, approved, rejected, implemented] = await Promise.all([
    service.getIdeasCount(interaction.guildId!, 'pending'),
    service.getIdeasCount(interaction.guildId!, 'approved'),
    service.getIdeasCount(interaction.guildId!, 'rejected'),
    service.getIdeasCount(interaction.guildId!, 'implemented'),
  ]);

  const total = pending + approved + rejected + implemented;

  const embed = IdeasPanel.createInfoEmbed(
    '📊 Ideas Statistics',
    `**Total Ideas:** ${total}\n\n` +
    `⏳ Pending: **${pending}**\n` +
    `✅ Approved: **${approved}**\n` +
    `❌ Rejected: **${rejected}**\n` +
    `🚀 Implemented: **${implemented}**`
  );

  if (total > 0) {
    const approvalRate = Math.round(((approved + implemented) / total) * 100);
    const implementationRate = approved > 0 ? Math.round((implemented / (approved + implemented)) * 100) : 0;

    embed.addFields(
      { name: 'Approval Rate', value: `${approvalRate}%`, inline: true },
      { name: 'Implementation Rate', value: `${implementationRate}%`, inline: true }
    );
  }

  await interaction.reply({
    embeds: [embed],
    ephemeral: true,
  });
}

/**
 * Handle /ideas suggestions - Review pending suggestions for an idea
 */
async function handleSuggestions(
  interaction: ChatInputCommandInteraction,
  service: IdeasService
): Promise<void> {
  // Check admin permission
  const member = interaction.member as GuildMember;
  if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed(
        'Permission Denied',
        'You need the **Manage Messages** permission to review suggestions.'
      )],
      ephemeral: true,
    });
    return;
  }

  const ideaId = interaction.options.getString('id', true);

  // Find the idea
  let idea = await service.getIdea(ideaId);
  if (!idea) {
    const allIdeas = await service.getIdeasByGuild(interaction.guildId!, undefined, 100, 0);
    idea = allIdeas.find(i => i.id.startsWith(ideaId)) || null;
  }

  if (!idea) {
    await interaction.reply({
      embeds: [IdeasPanel.createErrorEmbed('Not Found', `Could not find an idea with ID starting with \`${ideaId}\`.`)],
      ephemeral: true,
    });
    return;
  }

  // Get pending suggestions
  const pendingSuggestions = await service.getPendingSuggestionsForIdea(idea.id);

  if (pendingSuggestions.length === 0) {
    await interaction.reply({
      embeds: [IdeasPanel.createInfoEmbed(
        '📋 No Pending Suggestions',
        `There are no pending suggestions for "${idea.title}".\n\nAll suggestions have been reviewed.`
      )],
      ephemeral: true,
    });
    return;
  }

  // Show the first pending suggestion with approve/reject buttons
  const suggestion = pendingSuggestions[0]!;
  const embed = IdeasPanel.createSuggestionReviewEmbed(suggestion, idea.title, 1, pendingSuggestions.length);
  const buttons = IdeasPanel.createSuggestionApprovalButtons(suggestion.id);

  await interaction.reply({
    embeds: [embed],
    components: [buttons],
    ephemeral: true,
  });
}
