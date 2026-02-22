import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { SlashCommand } from '../../../types/command.types.js';
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { getCodeStatsService } from '../services/CodeStatsService.js';

export const command: SlashCommand = {
  type: 'slash',
  data: new SlashCommandBuilder()
    .setName('lines')
    .setDescription('See how many lines of code the bot has'),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    const srcPath = path.join(process.cwd(), 'src');
    const stats = countLines(srcPath);

    let description =
      `I'm made up of **${stats.totalLines.toLocaleString()}** lines of TypeScript!\n\n` +
      `📦 **${stats.moduleCount}** modules\n` +
      `📁 **${stats.fileCount.toLocaleString()}** files\n` +
      `📝 **${stats.codeLines.toLocaleString()}** lines of code\n` +
      `💬 **${stats.commentLines.toLocaleString()}** comment lines\n` +
      `📭 **${stats.blankLines.toLocaleString()}** blank lines`;

    // Try to get growth stats from database
    const codeStatsService = getCodeStatsService();
    if (codeStatsService) {
      try {
        const growth = await codeStatsService.getGrowthStats();
        if (growth && growth.daysSinceFirst > 0) {
          const linesDiff = growth.linesDiff;
          const filesDiff = growth.filesDiff;
          const modulesDiff = growth.modulesDiff;
          const linesSign = linesDiff >= 0 ? '+' : '';
          const filesSign = filesDiff >= 0 ? '+' : '';
          const modulesSign = modulesDiff >= 0 ? '+' : '';

          description += `\n\n**Growth over ${growth.daysSinceFirst} days:**\n`;
          description += `${linesSign}${linesDiff.toLocaleString()} lines | ${filesSign}${filesDiff.toLocaleString()} files | ${modulesSign}${modulesDiff} modules`;
        }

        const recordCount = await codeStatsService.getRecordCount();
        if (recordCount > 1) {
          description += `\n\n*${recordCount} snapshots recorded*`;
        }
      } catch {
        // Silently ignore database errors - just show current stats
      }
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('Lines of Code')
      .setDescription(description)
      .setFooter({ text: 'Counted from src/' })
      .setTimestamp();

    // Add chart buttons if we have historical data
    const recordCount = codeStatsService ? await codeStatsService.getRecordCount().catch(() => 0) : 0;

    if (recordCount >= 2) {
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('lines_chart_lines')
          .setLabel('Lines Graph')
          .setEmoji('📈')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('lines_chart_files')
          .setLabel('Files Graph')
          .setEmoji('📁')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('lines_chart_modules')
          .setLabel('Modules Graph')
          .setEmoji('📦')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('lines_chart_breakdown')
          .setLabel('Breakdown')
          .setEmoji('🍩')
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.editReply({ embeds: [embed], components: [row] });
    } else {
      await interaction.editReply({ embeds: [embed] });
    }
  },
};

interface LineStats {
  totalLines: number;
  codeLines: number;
  commentLines: number;
  blankLines: number;
  fileCount: number;
  moduleCount: number;
}

function countModules(): number {
  const modulesPath = path.join(process.cwd(), 'src', 'modules');
  try {
    const entries = readdirSync(modulesPath);
    let count = 0;
    for (const entry of entries) {
      const fullPath = path.join(modulesPath, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        // Check if it has a module.ts file (valid module)
        const moduleFile = path.join(fullPath, 'module.ts');
        try {
          statSync(moduleFile);
          count++;
        } catch {
          // No module.ts, not a valid module
        }
      }
    }
    return count;
  } catch {
    return 0;
  }
}

function countLines(dir: string): LineStats {
  const stats: LineStats = {
    totalLines: 0,
    codeLines: 0,
    commentLines: 0,
    blankLines: 0,
    fileCount: 0,
    moduleCount: countModules(),
  };

  function processDirectory(dirPath: string): void {
    const entries = readdirSync(dirPath);

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        // Skip node_modules and other non-source directories
        if (entry !== 'node_modules' && entry !== 'dist' && entry !== '.git') {
          processDirectory(fullPath);
        }
      } else if (entry.endsWith('.ts') || entry.endsWith('.js')) {
        stats.fileCount++;
        const content = readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n');

        let inBlockComment = false;

        for (const line of lines) {
          const trimmed = line.trim();
          stats.totalLines++;

          if (trimmed === '') {
            stats.blankLines++;
          } else if (inBlockComment) {
            stats.commentLines++;
            if (trimmed.includes('*/')) {
              inBlockComment = false;
            }
          } else if (trimmed.startsWith('/*')) {
            stats.commentLines++;
            if (!trimmed.includes('*/')) {
              inBlockComment = true;
            }
          } else if (trimmed.startsWith('//')) {
            stats.commentLines++;
          } else if (trimmed.startsWith('*')) {
            // Line inside JSDoc or block comment
            stats.commentLines++;
          } else {
            stats.codeLines++;
          }
        }
      }
    }
  }

  processDirectory(dir);
  return stats;
}
