import {
  Interaction,
  ButtonInteraction,
  EmbedBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { AnyModuleEvent } from '../../../types/event.types.js';
import { Logger } from '../../../shared/utils/logger.js';
import { getCodeStatsService } from '../services/CodeStatsService.js';
import { generateChart, ChartType } from '../services/ChartService.js';

const logger = new Logger('CodeStats:Interaction');

export const interactionCreateEvent: AnyModuleEvent = {
  name: 'interactionCreate',
  once: false,

  async execute(...args: unknown[]): Promise<void> {
    const interaction = args[0] as Interaction;

    // Handle lines chart buttons
    if (interaction.isButton() && interaction.customId.startsWith('lines_chart_')) {
      await handleLinesChartButton(interaction);
    }
  },
};

// ==========================================
// Lines Chart Handlers
// ==========================================

/**
 * Handle lines chart button clicks - updates the original message with the chart
 */
async function handleLinesChartButton(interaction: ButtonInteraction): Promise<void> {
  const chartType = interaction.customId.replace('lines_chart_', '') as ChartType;

  const codeStatsService = getCodeStatsService();
  if (!codeStatsService) {
    await interaction.reply({
      content: 'Code stats service is not available.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferUpdate();

  try {
    // Get history data
    const history = await codeStatsService.getHistory(1000);

    if (history.length < 2) {
      await interaction.followUp({
        content: 'Not enough data to generate a chart. Need at least 2 snapshots.',
        ephemeral: true,
      });
      return;
    }

    // Generate the chart
    const chartBuffer = await generateChart(chartType, history);

    // Create attachment
    const attachment = new AttachmentBuilder(chartBuffer, {
      name: `code-stats-${chartType}.png`,
    });

    // Create embed with chart title
    const titles: Record<ChartType, string> = {
      lines: 'Lines of Code Over Time',
      files: 'File Count Over Time',
      modules: 'Module Count Over Time',
      breakdown: 'Current Code Breakdown',
    };

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(titles[chartType])
      .setImage(`attachment://code-stats-${chartType}.png`)
      .setFooter({ text: `Based on ${history.length} snapshots` })
      .setTimestamp();

    // Build buttons with the current one highlighted
    const row = buildChartButtons(chartType);

    await interaction.editReply({
      embeds: [embed],
      files: [attachment],
      components: [row],
    });
  } catch (error) {
    logger.error('Failed to generate chart:', error);
    await interaction.followUp({
      content: `Failed to generate chart: ${error instanceof Error ? error.message : 'Unknown error'}`,
      ephemeral: true,
    });
  }
}

/**
 * Build chart button row with the active button highlighted
 */
function buildChartButtons(activeType: ChartType): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('lines_chart_lines')
      .setLabel('Lines Graph')
      .setEmoji('📈')
      .setStyle(activeType === 'lines' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('lines_chart_files')
      .setLabel('Files Graph')
      .setEmoji('📁')
      .setStyle(activeType === 'files' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('lines_chart_modules')
      .setLabel('Modules Graph')
      .setEmoji('📦')
      .setStyle(activeType === 'modules' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('lines_chart_breakdown')
      .setLabel('Breakdown')
      .setEmoji('🍩')
      .setStyle(activeType === 'breakdown' ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );
}
