import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AttachmentBuilder,
  PermissionFlagsBits,
} from 'discord.js';
import { defineSlashCommand } from '../../../types/command.types.js';
import { createEmbed, COLORS, errorEmbed } from '../../../shared/utils/embed.js';
import { CreditsService, CreditsData } from '../services/CreditsService.js';
import { RenderService, NewMemberData } from '../services/RenderService.js';
import { GrowthDataService } from '../services/GrowthDataService.js';
import { YouTubeService } from '../services/YouTubeService.js';
import { ActivityStatsService } from '../services/ActivityStatsService.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('StreamCredits:Command');

let creditsService: CreditsService | null = null;
let renderService: RenderService | null = null;
let growthDataService: GrowthDataService | null = null;
let youtubeService: YouTubeService | null = null;
let activityStatsService: ActivityStatsService | null = null;

export function setCreditsService(service: CreditsService): void {
  creditsService = service;
}

export function setRenderService(service: RenderService): void {
  renderService = service;
}

export function setGrowthDataService(service: GrowthDataService): void {
  growthDataService = service;
}

export function setYouTubeService(service: YouTubeService): void {
  youtubeService = service;
}

export function setActivityStatsService(service: ActivityStatsService): void {
  activityStatsService = service;
}

export const command = defineSlashCommand(
  new SlashCommandBuilder()
    .setName('credits')
    .setDescription('Stream credits - export boosters and tag wearers')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('export')
        .setDescription('Export server boosters and tag wearers as JSON data')
    )
    .addSubcommand((sub) =>
      sub
        .setName('preview')
        .setDescription('Preview who will appear in the stream credits')
    )
    .addSubcommand((sub) =>
      sub
        .setName('render')
        .setDescription('Render an MP4 credits video for stream outro')
    ) as SlashCommandBuilder,

  async (interaction: ChatInputCommandInteraction) => {
    if (!creditsService) {
      await interaction.reply({ embeds: [errorEmbed('Service Error', 'Credits service not initialized.')], ephemeral: true });
      return;
    }

    if (!interaction.guild) {
      await interaction.reply({ embeds: [errorEmbed('Error', 'This command can only be used in a server.')], ephemeral: true });
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'export') {
      await handleExport(interaction);
    } else if (subcommand === 'preview') {
      await handlePreview(interaction);
    } else if (subcommand === 'render') {
      await handleRender(interaction);
    }
  },
  {
    guildOnly: true,
    defer: true,
  }
);

async function handleExport(interaction: ChatInputCommandInteraction): Promise<void> {
  const data = await creditsService!.fetchCreditsData(interaction.guild!);

  const exportData = {
    guild: data.guildName,
    guildIcon: data.guildIconUrl,
    exportedAt: data.fetchedAt.toISOString(),
    summary: {
      totalBoosters: data.boosters.length,
      totalTagWearers: data.tagWearers.length,
      totalUnique: data.combined.length,
    },
    boosters: data.boosters.map(formatMember),
    tagWearers: data.tagWearers.map(formatMember),
    combined: data.combined.map(formatMember),
  };

  const jsonBuffer = Buffer.from(JSON.stringify(exportData, null, 2), 'utf-8');
  const attachment = new AttachmentBuilder(jsonBuffer, {
    name: `credits-${interaction.guild!.id}-${Date.now()}.json`,
  });

  const embed = createEmbed(COLORS.success)
    .setTitle('Stream Credits Export')
    .setDescription('Credits data exported successfully.')
    .addFields(
      { name: 'Boosters', value: `${data.boosters.length}`, inline: true },
      { name: 'Tag Wearers', value: `${data.tagWearers.length}`, inline: true },
      { name: 'Total Unique', value: `${data.combined.length}`, inline: true },
    );

  await interaction.editReply({ embeds: [embed], files: [attachment] });
}

async function handlePreview(interaction: ChatInputCommandInteraction): Promise<void> {
  const data = await creditsService!.fetchCreditsData(interaction.guild!);

  const embed = createEmbed(COLORS.primary)
    .setTitle('Stream Credits Preview')
    .setDescription(buildPreviewDescription(data));

  if (data.guildIconUrl) {
    embed.setThumbnail(data.guildIconUrl);
  }

  embed.addFields(
    { name: 'Boosters', value: `${data.boosters.length}`, inline: true },
    { name: 'Tag Wearers', value: `${data.tagWearers.length}`, inline: true },
    { name: 'Total Unique', value: `${data.combined.length}`, inline: true },
  );

  await interaction.editReply({ embeds: [embed] });
}

function formatMember(m: { userId: string; username: string; displayName: string; avatarUrl: string; isBooster: boolean; isTagWearer: boolean; serverTag: string | null }) {
  return {
    userId: m.userId,
    username: m.username,
    displayName: m.displayName,
    avatarUrl: m.avatarUrl,
    isBooster: m.isBooster,
    isTagWearer: m.isTagWearer,
    serverTag: m.serverTag,
  };
}

async function handleRender(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!renderService) {
    await interaction.editReply({ embeds: [errorEmbed('Service Error', 'Render service not initialized.')] });
    return;
  }

  const guildId = interaction.guild!.id;

  if (renderService.isRendering(guildId)) {
    await interaction.editReply({
      embeds: [errorEmbed('Render In Progress', 'A credits video is already being rendered for this server. Please wait.')],
    });
    return;
  }

  const data = await creditsService!.fetchCreditsData(interaction.guild!);

  if (data.allMembers.length === 0) {
    await interaction.editReply({
      embeds: [errorEmbed('No Members', 'No members found to include in the credits video.')],
    });
    return;
  }

  // Fetch growth data
  const growthData = growthDataService
    ? await growthDataService.fetchGrowthData(guildId)
    : { timeline: [], totalMembers: 0, oldestJoinDate: null, newestJoinDate: null };

  // Fetch activity stats (if service available)
  let activityStats;
  if (activityStatsService) {
    const memberMap = new Map<string, { displayName: string; avatarUrl: string }>();
    for (const m of data.allMembers) {
      memberMap.set(m.userId, { displayName: m.displayName, avatarUrl: m.avatarUrl });
    }
    activityStats = await activityStatsService.fetchActivityStats(guildId, memberMap);
  }

  // Fetch YouTube data (if service available)
  let youtubeData = null;
  if (youtubeService) {
    logger.info('Fetching YouTube data...');
    youtubeData = await youtubeService.fetchChannelData('UCvRibuOhtInWPz8Yaf3DjTw');
    logger.info(`YouTube data result: ${youtubeData ? `${youtubeData.channel.channelName} (${youtubeData.recentVideos.length} videos)` : 'null'}`);
  } else {
    logger.warn('YouTube service not available');
  }

  // Find new members this week
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const newMembers: NewMemberData[] = [];

  const members = interaction.guild!.members.cache;
  for (const [, member] of members) {
    if (member.user.bot) continue;
    if (member.joinedAt && member.joinedAt >= oneWeekAgo) {
      newMembers.push({
        userId: member.id,
        displayName: member.displayName,
        avatarUrl: member.displayAvatarURL({ size: 256, extension: 'png' }),
        joinedAt: member.joinedAt.toISOString(),
      });
    }
  }
  newMembers.sort((a, b) => new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime());

  // Show loading embed
  const loadingEmbed = createEmbed(COLORS.primary)
    .setTitle('Rendering Credits Video')
    .setDescription('Preparing render...')
    .addFields(
      { name: 'Members', value: `${data.allMembers.length}`, inline: true },
      { name: 'Boosters', value: `${data.boosters.length}`, inline: true },
      { name: 'Progress', value: '0%', inline: true },
    );

  await interaction.editReply({ embeds: [loadingEmbed] });

  let lastProgressUpdate = 0;

  try {
    const result = await renderService.render({
      data,
      growthData,
      guildId,
      activityStats,
      youtubeData,
      newMembers,
      onProgress: async (percent) => {
        // Throttle progress updates to avoid rate limits (every 10%)
        const rounded = Math.floor(percent / 10) * 10;
        if (rounded > lastProgressUpdate) {
          lastProgressUpdate = rounded;
          const progressEmbed = createEmbed(COLORS.primary)
            .setTitle('Rendering Credits Video')
            .setDescription(`Rendering frames... ${rounded}%`)
            .addFields(
              { name: 'Members', value: `${data.allMembers.length}`, inline: true },
              { name: 'Boosters', value: `${data.boosters.length}`, inline: true },
              { name: 'Progress', value: `${rounded}%`, inline: true },
            );
          await interaction.editReply({ embeds: [progressEmbed] }).catch(() => {});
        }
      },
    });

    const fileSizeMB = (result.fileSize / (1024 * 1024)).toFixed(1);
    const successEmbed = createEmbed(COLORS.success)
      .setTitle('Credits Video Ready')
      .setDescription('Your stream credits video has been rendered successfully.')
      .addFields(
        { name: 'Duration', value: `${result.durationSec.toFixed(1)}s`, inline: true },
        { name: 'Members', value: `${result.memberCount}`, inline: true },
        { name: 'File Size', value: `${fileSizeMB} MB`, inline: true },
      );

    const attachment = new AttachmentBuilder(result.filePath, {
      name: `credits-${guildId}.mp4`,
    });
    await interaction.editReply({ embeds: [successEmbed], files: [attachment] });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    await interaction.editReply({
      embeds: [errorEmbed('Render Failed', `The video render failed:\n\`\`\`${message.slice(0, 1000)}\`\`\``)],
    });
  }
}

function buildPreviewDescription(data: CreditsData): string {
  const lines: string[] = [];

  if (data.boosters.length > 0) {
    lines.push('**Server Boosters:**');
    for (const m of data.boosters.slice(0, 15)) {
      lines.push(`> ${m.displayName}`);
    }
    if (data.boosters.length > 15) {
      lines.push(`> *...and ${data.boosters.length - 15} more*`);
    }
    lines.push('');
  }

  if (data.tagWearers.length > 0) {
    lines.push('**Tag Wearers:**');
    for (const m of data.tagWearers.slice(0, 15)) {
      const tag = m.serverTag ? ` [${m.serverTag}]` : '';
      lines.push(`> ${m.displayName}${tag}`);
    }
    if (data.tagWearers.length > 15) {
      lines.push(`> *...and ${data.tagWearers.length - 15} more*`);
    }
    lines.push('');
  }

  if (data.combined.length === 0) {
    lines.push('*No boosters or tag wearers found.*');
  }

  return lines.join('\n');
}
