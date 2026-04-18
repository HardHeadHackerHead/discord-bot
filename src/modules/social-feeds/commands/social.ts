import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  ChannelType,
  TextChannel,
  EmbedBuilder,
  AutocompleteInteraction,
} from 'discord.js';
import { SlashCommand } from '../../../types/command.types.js';
import { SocialFeedsService, SocialPlatform } from '../services/SocialFeedsService.js';
import { FeedChecker } from '../services/FeedChecker.js';
import { youtubeFetcher } from '../services/YouTubeFetcher.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('SocialFeeds:Command');

let feedsService: SocialFeedsService | null = null;
let feedChecker: FeedChecker | null = null;

export function setFeedsService(service: SocialFeedsService): void {
  feedsService = service;
}

export function setFeedChecker(checker: FeedChecker): void {
  feedChecker = checker;
}

/**
 * Platform display info
 */
const PLATFORM_INFO: Record<SocialPlatform, { name: string; emoji: string; color: number }> = {
  youtube: { name: 'YouTube', emoji: '📺', color: 0xFF0000 },
};

export const command: SlashCommand = {
  type: 'slash',
  data: new SlashCommandBuilder()
    .setName('social')
    .setDescription('Configure social media feed notifications')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    // Add YouTube feed
    .addSubcommand(subcommand =>
      subcommand
        .setName('youtube')
        .setDescription('Add a YouTube channel feed')
        .addStringOption(option =>
          option
            .setName('channel')
            .setDescription('YouTube channel URL or ID (e.g., @ChannelName or UC...)')
            .setRequired(true)
        )
        .addChannelOption(option =>
          option
            .setName('post_channel')
            .setDescription('Discord channel to post new videos to')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
    )
    // List feeds
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('List all configured social feeds')
    )
    // Remove feed
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('Remove a social feed')
        .addStringOption(option =>
          option
            .setName('feed')
            .setDescription('The feed to remove')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    // Enable/disable feed
    .addSubcommand(subcommand =>
      subcommand
        .setName('toggle')
        .setDescription('Enable or disable a feed')
        .addStringOption(option =>
          option
            .setName('feed')
            .setDescription('The feed to toggle')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    // Update feed channel
    .addSubcommand(subcommand =>
      subcommand
        .setName('channel')
        .setDescription('Change where a feed posts')
        .addStringOption(option =>
          option
            .setName('feed')
            .setDescription('The feed to update')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addChannelOption(option =>
          option
            .setName('post_channel')
            .setDescription('New Discord channel to post to')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
    )
    // Test feed
    .addSubcommand(subcommand =>
      subcommand
        .setName('test')
        .setDescription('Test a feed by showing the latest item')
        .addStringOption(option =>
          option
            .setName('feed')
            .setDescription('The feed to test')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    // Manual check
    .addSubcommand(subcommand =>
      subcommand
        .setName('check')
        .setDescription('Manually check all feeds for new posts now')
    )
    // Sync feed - post latest if missing
    .addSubcommand(subcommand =>
      subcommand
        .setName('sync')
        .setDescription('Post the latest video if it was missed (e.g., bot was offline)')
        .addStringOption(option =>
          option
            .setName('feed')
            .setDescription('The feed to sync')
            .setRequired(true)
            .setAutocomplete(true)
        )
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!feedsService) {
      await interaction.reply({
        content: '❌ Social feeds service is not initialized.',
        ephemeral: true,
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'youtube':
        await handleAddYouTube(interaction, feedsService);
        break;
      case 'list':
        await handleList(interaction, feedsService);
        break;
      case 'remove':
        await handleRemove(interaction, feedsService);
        break;
      case 'toggle':
        await handleToggle(interaction, feedsService);
        break;
      case 'channel':
        await handleChannel(interaction, feedsService);
        break;
      case 'test':
        await handleTest(interaction, feedsService);
        break;
      case 'check':
        await handleCheck(interaction);
        break;
      case 'sync':
        await handleSync(interaction, feedsService);
        break;
    }
  },

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    if (!feedsService) {
      await interaction.respond([]);
      return;
    }

    const focusedOption = interaction.options.getFocused(true);

    if (focusedOption.name === 'feed') {
      const feeds = await feedsService.getGuildFeeds(interaction.guildId!);
      const query = focusedOption.value.toLowerCase();

      const choices = feeds
        .filter(feed => {
          const name = feed.platform_name || feed.platform_id;
          return name.toLowerCase().includes(query) ||
                 feed.platform.toLowerCase().includes(query);
        })
        .slice(0, 25)
        .map(feed => ({
          name: `${PLATFORM_INFO[feed.platform]?.emoji || '📡'} ${feed.platform_name || feed.platform_id} (${feed.platform})`,
          value: feed.id,
        }));

      await interaction.respond(choices);
    }
  },
};

// ==================== Command Handlers ====================

/**
 * Handle /social youtube - Add a YouTube channel feed
 */
async function handleAddYouTube(
  interaction: ChatInputCommandInteraction,
  service: SocialFeedsService
): Promise<void> {
  const channelInput = interaction.options.getString('channel', true);
  const postChannel = interaction.options.getChannel('post_channel', true) as TextChannel;

  await interaction.deferReply({ ephemeral: true });

  // Resolve channel ID
  const channelInfo = await youtubeFetcher.resolveChannelId(channelInput);

  if (!channelInfo) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setDescription('❌ Could not find that YouTube channel. Please check the URL or channel ID.')
          .setColor(0xED4245),
      ],
    });
    return;
  }

  // Check if feed already exists
  if (await service.feedExists(interaction.guildId!, 'youtube', channelInfo.id)) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setDescription(`⚠️ A feed for **${channelInfo.name}** already exists in this server.`)
          .setColor(0xFEE75C),
      ],
    });
    return;
  }

  // Add the feed
  const feed = await service.addFeed(
    interaction.guildId!,
    'youtube',
    channelInfo.id,
    postChannel.id,
    channelInfo.name
  );

  // Fetch recent videos
  const recentVideos = await youtubeFetcher.fetchVideos(channelInfo.id, 5);

  // Mark all videos as "posted" in the database to prevent duplicates on future checks
  for (const video of recentVideos) {
    await service.markItemPosted(feed.id, video.id, video.title, video.url);
  }

  // Post the most recent video to the channel right away
  let postedLatest = false;
  if (recentVideos.length > 0) {
    const latestVideo = recentVideos[0]!;
    try {
      const embed = new EmbedBuilder()
        .setAuthor({
          name: latestVideo.author || channelInfo.name,
          url: channelInfo.url,
        })
        .setTitle(latestVideo.title)
        .setURL(latestVideo.url)
        .setColor(0xFF0000)
        .setTimestamp(latestVideo.publishedAt)
        .setFooter({ text: '📺 New YouTube Upload' });

      if (latestVideo.thumbnail) {
        embed.setImage(latestVideo.thumbnail);
      }

      await postChannel.send({
        content: `🔔 **${latestVideo.author || channelInfo.name}** just uploaded a new video!`,
        embeds: [embed],
      });
      postedLatest = true;
    } catch (error) {
      logger.error(`Failed to post latest video for new feed:`, error);
    }
  }

  logger.info(`YouTube feed added: ${channelInfo.name} -> #${postChannel.name} in ${interaction.guild?.name}`);

  const description = postedLatest
    ? `New videos from **${channelInfo.name}** will be posted to ${postChannel}.\n\n✅ The latest video has been posted!`
    : `New videos from **${channelInfo.name}** will be posted to ${postChannel}.`;

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle('📺 YouTube Feed Added')
        .setDescription(description)
        .setColor(0xFF0000)
        .addFields(
          { name: 'Channel', value: `[${channelInfo.name}](${channelInfo.url})`, inline: true },
          { name: 'Posts To', value: `${postChannel}`, inline: true },
        ),
    ],
  });
}

/**
 * Handle /social list - List all feeds
 */
async function handleList(
  interaction: ChatInputCommandInteraction,
  service: SocialFeedsService
): Promise<void> {
  const feeds = await service.getGuildFeeds(interaction.guildId!);

  if (feeds.length === 0) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('📡 Social Feeds')
          .setDescription('No social feeds have been configured yet.\n\nUse `/social youtube` to add a YouTube channel.')
          .setColor(0x5865F2),
      ],
      ephemeral: true,
    });
    return;
  }

  const feedList = feeds.map(feed => {
    const info = PLATFORM_INFO[feed.platform] || { name: feed.platform, emoji: '📡' };
    const status = feed.enabled ? '🟢' : '🔴';
    const name = feed.platform_name || feed.platform_id;
    return `${status} ${info.emoji} **${name}**\n└ Posts to: <#${feed.channel_id}>`;
  }).join('\n\n');

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle('📡 Social Feeds')
        .setDescription(feedList)
        .setColor(0x5865F2)
        .setFooter({ text: `${feeds.length} feed(s) configured | 🟢 = Enabled, 🔴 = Disabled` }),
    ],
    ephemeral: true,
  });
}

/**
 * Handle /social remove - Remove a feed
 */
async function handleRemove(
  interaction: ChatInputCommandInteraction,
  service: SocialFeedsService
): Promise<void> {
  const feedId = interaction.options.getString('feed', true);

  const feed = await service.getFeed(feedId);
  if (!feed || feed.guild_id !== interaction.guildId) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setDescription('❌ Feed not found.')
          .setColor(0xED4245),
      ],
      ephemeral: true,
    });
    return;
  }

  await service.removeFeed(feedId);

  const info = PLATFORM_INFO[feed.platform] || { emoji: '📡' };
  logger.info(`Feed removed: ${feed.platform_name} in ${interaction.guild?.name}`);

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setDescription(`✅ Removed ${info.emoji} **${feed.platform_name || feed.platform_id}** feed.`)
        .setColor(0x57F287),
    ],
    ephemeral: true,
  });
}

/**
 * Handle /social toggle - Enable/disable a feed
 */
async function handleToggle(
  interaction: ChatInputCommandInteraction,
  service: SocialFeedsService
): Promise<void> {
  const feedId = interaction.options.getString('feed', true);

  const feed = await service.getFeed(feedId);
  if (!feed || feed.guild_id !== interaction.guildId) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setDescription('❌ Feed not found.')
          .setColor(0xED4245),
      ],
      ephemeral: true,
    });
    return;
  }

  const newState = !feed.enabled;
  await service.setFeedEnabled(feedId, newState);

  const info = PLATFORM_INFO[feed.platform] || { emoji: '📡' };
  const stateEmoji = newState ? '🟢' : '🔴';
  const stateText = newState ? 'enabled' : 'disabled';

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setDescription(`${stateEmoji} ${info.emoji} **${feed.platform_name || feed.platform_id}** feed has been ${stateText}.`)
        .setColor(newState ? 0x57F287 : 0xED4245),
    ],
    ephemeral: true,
  });
}

/**
 * Handle /social channel - Update feed post channel
 */
async function handleChannel(
  interaction: ChatInputCommandInteraction,
  service: SocialFeedsService
): Promise<void> {
  const feedId = interaction.options.getString('feed', true);
  const postChannel = interaction.options.getChannel('post_channel', true) as TextChannel;

  const feed = await service.getFeed(feedId);
  if (!feed || feed.guild_id !== interaction.guildId) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setDescription('❌ Feed not found.')
          .setColor(0xED4245),
      ],
      ephemeral: true,
    });
    return;
  }

  await service.updateFeedChannel(feedId, postChannel.id);

  const info = PLATFORM_INFO[feed.platform] || { emoji: '📡' };

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setDescription(`✅ ${info.emoji} **${feed.platform_name || feed.platform_id}** will now post to ${postChannel}.`)
        .setColor(0x57F287),
    ],
    ephemeral: true,
  });
}

/**
 * Handle /social test - Test a feed by showing latest item
 */
async function handleTest(
  interaction: ChatInputCommandInteraction,
  service: SocialFeedsService
): Promise<void> {
  const feedId = interaction.options.getString('feed', true);

  const feed = await service.getFeed(feedId);
  if (!feed || feed.guild_id !== interaction.guildId) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setDescription('❌ Feed not found.')
          .setColor(0xED4245),
      ],
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const info = PLATFORM_INFO[feed.platform] || { name: feed.platform, emoji: '📡', color: 0x5865F2 };

  if (feed.platform === 'youtube') {
    const videos = await youtubeFetcher.fetchVideos(feed.platform_id, 1);

    if (videos.length === 0) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setDescription(`⚠️ No videos found for **${feed.platform_name || feed.platform_id}**.`)
            .setColor(0xFEE75C),
        ],
      });
      return;
    }

    const video = videos[0]!;

    await interaction.editReply({
      content: '**Preview of what will be posted:**',
      embeds: [
        new EmbedBuilder()
          .setTitle(video.title)
          .setURL(video.url)
          .setColor(info.color)
          .setAuthor({ name: video.author || feed.platform_name || 'Unknown' })
          .setImage(video.thumbnail || null)
          .setTimestamp(video.publishedAt)
          .setFooter({ text: `${info.emoji} ${info.name}` }),
      ],
    });
  }
}

/**
 * Handle /social check - Manually trigger a feed check
 */
async function handleCheck(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  if (!feedChecker) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setDescription('❌ Feed checker is not initialized.')
          .setColor(0xED4245),
      ],
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  // Trigger the check
  await feedChecker.checkAllFeeds();

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setDescription('✅ Feed check completed! Any new posts have been sent to their configured channels.')
        .setColor(0x57F287),
    ],
  });
}

/**
 * Handle /social sync - Post the latest video if it's not in the Discord channel
 */
async function handleSync(
  interaction: ChatInputCommandInteraction,
  service: SocialFeedsService
): Promise<void> {
  const feedId = interaction.options.getString('feed', true);

  const feed = await service.getFeed(feedId);
  if (!feed || feed.guild_id !== interaction.guildId) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setDescription('❌ Feed not found.')
          .setColor(0xED4245),
      ],
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const info = PLATFORM_INFO[feed.platform] || { name: feed.platform, emoji: '📡', color: 0x5865F2 };

  if (feed.platform === 'youtube') {
    // Fetch the latest video from RSS
    const videos = await youtubeFetcher.fetchVideos(feed.platform_id, 1);

    if (videos.length === 0) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setDescription(`⚠️ No videos found for **${feed.platform_name || feed.platform_id}**.`)
            .setColor(0xFEE75C),
        ],
      });
      return;
    }

    const latestVideo = videos[0]!;

    // Check if already in our database
    const isTracked = await service.isItemPosted(feed.id, latestVideo.id);

    // Get the Discord channel and check recent messages for this video URL
    try {
      const channel = await interaction.client.channels.fetch(feed.channel_id);
      if (!channel || !channel.isTextBased() || !('messages' in channel)) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setDescription('❌ Could not access the post channel.')
              .setColor(0xED4245),
          ],
        });
        return;
      }

      const textChannel = channel as TextChannel;

      // Check recent messages for this video
      const recentMessages = await textChannel.messages.fetch({ limit: 50 });
      const alreadyPosted = recentMessages.some(msg =>
        msg.author.id === interaction.client.user?.id &&
        (msg.content.includes(latestVideo.url) ||
         msg.embeds.some(embed => embed.url === latestVideo.url))
      );

      if (alreadyPosted) {
        // Make sure it's in our database too
        if (!isTracked) {
          await service.markItemPosted(feed.id, latestVideo.id, latestVideo.title, latestVideo.url);
        }

        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setDescription(`✅ The latest video is already posted in ${textChannel}.\n\n**${latestVideo.title}**`)
              .setColor(0x57F287),
          ],
        });
        return;
      }

      // Post the video
      const embed = new EmbedBuilder()
        .setAuthor({
          name: latestVideo.author || feed.platform_name || 'Unknown',
          url: `https://www.youtube.com/channel/${feed.platform_id}`,
        })
        .setTitle(latestVideo.title)
        .setURL(latestVideo.url)
        .setColor(info.color)
        .setTimestamp(latestVideo.publishedAt)
        .setFooter({ text: `${info.emoji} New ${info.name} Upload` });

      if (latestVideo.thumbnail) {
        embed.setImage(latestVideo.thumbnail);
      }

      await textChannel.send({
        content: `🔔 **${latestVideo.author || feed.platform_name || 'Unknown'}** just uploaded a new video!`,
        embeds: [embed],
      });

      // Mark as posted in database
      if (!isTracked) {
        await service.markItemPosted(feed.id, latestVideo.id, latestVideo.title, latestVideo.url);
      }

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setDescription(`✅ Posted the latest video to ${textChannel}!\n\n**${latestVideo.title}**`)
            .setColor(0x57F287),
        ],
      });

    } catch (error) {
      logger.error(`Error syncing feed ${feedId}:`, error);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setDescription('❌ An error occurred while syncing the feed.')
            .setColor(0xED4245),
        ],
      });
    }
  }
}
