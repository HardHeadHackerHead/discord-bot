import {
  BaseModule,
  ModuleMetadata,
  ModuleContext,
} from '../../types/module.types.js';
import { ModuleCommand } from '../../types/command.types.js';
import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  TextChannel,
  ChannelType,
  AttachmentBuilder,
  Client,
} from 'discord.js';
import { Logger } from '../../shared/utils/logger.js';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';

const logger = new Logger('ServerGuide');

/** Path to assets folder - use process.cwd() for reliability */
const ASSETS_PATH = join(process.cwd(), 'assets/server-guide');

/** Path to image cache file */
const CACHE_PATH = join(process.cwd(), 'assets/server-guide/.image-cache.json');

/** Path to config file */
const CONFIG_PATH = join(process.cwd(), 'src/config/server-guide.json');

/** Supported image extensions */
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

/**
 * Embed field structure
 */
interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

/**
 * Embed footer structure
 */
interface EmbedFooter {
  text: string;
  iconURL?: string;
}

/**
 * Server guide embed configuration
 */
interface GuideEmbed {
  id: string;
  order: number;
  title?: string;
  description?: string;
  color?: string;
  thumbnail?: string;
  image?: string;
  fields?: EmbedField[];
  footer?: EmbedFooter;
}

/**
 * Server guide configuration
 */
interface ServerGuideConfig {
  metadata: {
    name: string;
    description: string;
    version: string;
    lastUpdated: string;
  };
  channelId: string;
  imageUploadChannelId?: string;
  embeds: GuideEmbed[];
}

/**
 * Image cache entry
 */
interface ImageCacheEntry {
  localPath: string;
  discordUrl: string;
  uploadedAt: string;
  messageId: string;
  channelId: string;
}

/**
 * Image cache structure
 */
interface ImageCache {
  [embedId: string]: ImageCacheEntry;
}

/**
 * Load the server guide configuration from JSON
 */
function loadConfig(): ServerGuideConfig {
  const configData = readFileSync(CONFIG_PATH, 'utf-8');
  return JSON.parse(configData) as ServerGuideConfig;
}

/**
 * Load the image cache
 */
function loadImageCache(): ImageCache {
  try {
    if (existsSync(CACHE_PATH)) {
      const cacheData = readFileSync(CACHE_PATH, 'utf-8');
      return JSON.parse(cacheData) as ImageCache;
    }
  } catch (error) {
    logger.warn('Failed to load image cache:', error);
  }
  return {};
}

/**
 * Save the image cache
 */
function saveImageCache(cache: ImageCache): void {
  try {
    writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
  } catch (error) {
    logger.error('Failed to save image cache:', error);
  }
}

/**
 * Find a local image file for an embed
 */
function findLocalImage(embedId: string): string | null {
  for (const ext of IMAGE_EXTENSIONS) {
    const imagePath = join(ASSETS_PATH, `${embedId}${ext}`);
    if (existsSync(imagePath)) {
      return imagePath;
    }
  }
  return null;
}

/**
 * Check if a cached image URL is still valid
 */
async function isImageUrlValid(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Upload an image to Discord and return the URL
 */
async function uploadImage(
  client: Client,
  channelId: string,
  imagePath: string,
  embedId: string
): Promise<{ url: string; messageId: string } | null> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !(channel instanceof TextChannel)) {
      logger.error(`Upload channel ${channelId} not found or not a text channel`);
      return null;
    }

    const imageBuffer = readFileSync(imagePath);
    const fileName = imagePath.split(/[/\\]/).pop() || `${embedId}.png`;
    const attachment = new AttachmentBuilder(imageBuffer, { name: fileName });

    const message = await channel.send({
      content: `Server Guide Image: \`${embedId}\``,
      files: [attachment],
    });

    const attachmentUrl = message.attachments.first()?.url;
    if (!attachmentUrl) {
      logger.error('No attachment URL returned');
      return null;
    }

    return { url: attachmentUrl, messageId: message.id };
  } catch (error) {
    logger.error(`Failed to upload image for ${embedId}:`, error);
    return null;
  }
}

/**
 * Get or upload image URL for an embed
 */
async function getImageUrl(
  client: Client,
  uploadChannelId: string,
  embedId: string,
  cache: ImageCache
): Promise<string | null> {
  const localPath = findLocalImage(embedId);
  if (!localPath) {
    return null; // No local image exists
  }

  // Check if we have a cached URL
  const cached = cache[embedId];
  if (cached && cached.localPath === localPath) {
    // Verify the URL is still valid
    const isValid = await isImageUrlValid(cached.discordUrl);
    if (isValid) {
      logger.debug(`Using cached image URL for ${embedId}`);
      return cached.discordUrl;
    }
    logger.info(`Cached image URL for ${embedId} is no longer valid, re-uploading`);
  }

  // Upload the image
  logger.info(`Uploading image for ${embedId}...`);
  const result = await uploadImage(client, uploadChannelId, localPath, embedId);
  if (!result) {
    return null;
  }

  // Update cache
  cache[embedId] = {
    localPath,
    discordUrl: result.url,
    uploadedAt: new Date().toISOString(),
    messageId: result.messageId,
    channelId: uploadChannelId,
  };
  saveImageCache(cache);

  return result.url;
}

/**
 * Convert hex color string to number
 */
function hexToColor(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

/**
 * Build a Discord embed from config
 */
function buildEmbed(embedConfig: GuideEmbed, imageUrl?: string | null): EmbedBuilder {
  const embed = new EmbedBuilder();

  if (embedConfig.title) {
    embed.setTitle(embedConfig.title);
  }

  if (embedConfig.description) {
    embed.setDescription(embedConfig.description);
  }

  if (embedConfig.color) {
    embed.setColor(hexToColor(embedConfig.color));
  }

  // Use local image URL as thumbnail if available, otherwise use config thumbnail
  if (imageUrl) {
    embed.setThumbnail(imageUrl);
  } else if (embedConfig.thumbnail) {
    embed.setThumbnail(embedConfig.thumbnail);
  }

  // Large image at bottom (only from config, not local files)
  if (embedConfig.image) {
    embed.setImage(embedConfig.image);
  }

  if (embedConfig.fields) {
    for (const field of embedConfig.fields) {
      embed.addFields({
        name: field.name,
        value: field.value,
        inline: field.inline ?? false,
      });
    }
  }

  if (embedConfig.footer) {
    embed.setFooter({
      text: embedConfig.footer.text,
      iconURL: embedConfig.footer.iconURL,
    });
  }

  return embed;
}

/** Store client reference */
let clientRef: Client | null = null;

/**
 * Server Guide command
 */
const serverGuideCommand: ModuleCommand = {
  type: 'slash',
  data: new SlashCommandBuilder()
    .setName('server-guide')
    .setDescription('Manage the server guide embeds')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('post')
        .setDescription('Post all server guide embeds to the configured channel')
        .addBooleanOption((option) =>
          option
            .setName('clear')
            .setDescription('Clear existing messages in the channel first')
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('post-one')
        .setDescription('Post a single embed by ID')
        .addStringOption((option) =>
          option
            .setName('embed-id')
            .setDescription('The ID of the embed to post')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('Channel to post to (defaults to configured channel)')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('list')
        .setDescription('List all configured embeds')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('preview')
        .setDescription('Preview an embed without posting it publicly')
        .addStringOption((option) =>
          option
            .setName('embed-id')
            .setDescription('The ID of the embed to preview')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('refresh-images')
        .setDescription('Re-upload all local images to Discord')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('set-upload-channel')
        .setDescription('Set the channel where images are uploaded for hosting')
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('The channel to use for image uploads')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'post':
        await handlePost(interaction);
        break;
      case 'post-one':
        await handlePostOne(interaction);
        break;
      case 'list':
        await handleList(interaction);
        break;
      case 'preview':
        await handlePreview(interaction);
        break;
      case 'refresh-images':
        await handleRefreshImages(interaction);
        break;
      case 'set-upload-channel':
        await handleSetUploadChannel(interaction);
        break;
    }
  },

  async autocomplete(interaction): Promise<void> {
    const focusedOption = interaction.options.getFocused(true);

    if (focusedOption.name === 'embed-id') {
      try {
        const config = loadConfig();
        const choices = config.embeds
          .sort((a, b) => a.order - b.order)
          .map((embed) => ({
            name: `${embed.order}. ${embed.title || embed.id}`,
            value: embed.id,
          }))
          .filter((choice) =>
            choice.name.toLowerCase().includes(focusedOption.value.toLowerCase()) ||
            choice.value.toLowerCase().includes(focusedOption.value.toLowerCase())
          )
          .slice(0, 25);

        await interaction.respond(choices);
      } catch {
        await interaction.respond([]);
      }
    }
  },
};

/**
 * Handle /server-guide post
 */
async function handlePost(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  try {
    const config = loadConfig();
    const clearFirst = interaction.options.getBoolean('clear') ?? false;

    // Get the target channel
    const channel = await interaction.client.channels.fetch(config.channelId);
    if (!channel || !(channel instanceof TextChannel)) {
      await interaction.editReply({
        content: `Could not find text channel with ID \`${config.channelId}\`. Update the channelId in server-guide.json.`,
      });
      return;
    }

    // Check for upload channel
    const uploadChannelId = config.imageUploadChannelId;
    if (!uploadChannelId) {
      await interaction.editReply({
        content: 'No image upload channel configured. Use `/server-guide set-upload-channel` first.',
      });
      return;
    }

    // Load image cache
    const imageCache = loadImageCache();

    // Clear existing messages if requested
    if (clearFirst) {
      await interaction.editReply({ content: 'Clearing existing messages...' });
      try {
        const messages = await channel.messages.fetch({ limit: 100 });
        const botMessages = messages.filter((m) => m.author.id === interaction.client.user?.id);

        for (const msg of botMessages.values()) {
          await msg.delete().catch(() => {});
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      } catch (error) {
        logger.warn('Could not clear messages:', error);
      }
    }

    // Sort embeds by order and post them
    const sortedEmbeds = [...config.embeds].sort((a, b) => a.order - b.order);
    let posted = 0;

    await interaction.editReply({ content: `Posting embeds (0/${sortedEmbeds.length})...` });

    for (const embedConfig of sortedEmbeds) {
      try {
        // Get image URL (from cache or upload)
        const imageUrl = await getImageUrl(
          interaction.client,
          uploadChannelId,
          embedConfig.id,
          imageCache
        );

        const embed = buildEmbed(embedConfig, imageUrl);
        await channel.send({ embeds: [embed] });
        posted++;

        await interaction.editReply({
          content: `Posting embeds (${posted}/${sortedEmbeds.length})...`,
        });

        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        logger.error(`Failed to post embed ${embedConfig.id}:`, error);
      }
    }

    await interaction.editReply({
      content: `Posted ${posted}/${sortedEmbeds.length} embeds to <#${config.channelId}>.`,
    });

  } catch (error) {
    logger.error('Error posting server guide:', error);
    await interaction.editReply({
      content: 'Failed to post server guide. Check the logs for details.',
    });
  }
}

/**
 * Handle /server-guide post-one
 */
async function handlePostOne(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  try {
    const config = loadConfig();
    const embedId = interaction.options.getString('embed-id', true);
    const targetChannel = interaction.options.getChannel('channel') as TextChannel | null;

    const embedConfig = config.embeds.find((e) => e.id === embedId);
    if (!embedConfig) {
      await interaction.editReply({
        content: `Embed with ID \`${embedId}\` not found in configuration.`,
      });
      return;
    }

    const channel = targetChannel || (await interaction.client.channels.fetch(config.channelId));
    if (!channel || !(channel instanceof TextChannel)) {
      await interaction.editReply({
        content: 'Could not find the target channel.',
      });
      return;
    }

    // Get image URL if upload channel is configured
    let imageUrl: string | null = null;
    if (config.imageUploadChannelId) {
      const imageCache = loadImageCache();
      imageUrl = await getImageUrl(
        interaction.client,
        config.imageUploadChannelId,
        embedConfig.id,
        imageCache
      );
    }

    const embed = buildEmbed(embedConfig, imageUrl);
    await channel.send({ embeds: [embed] });

    await interaction.editReply({
      content: `Posted embed "${embedConfig.title || embedConfig.id}" to <#${channel.id}>.`,
    });

  } catch (error) {
    logger.error('Error posting single embed:', error);
    await interaction.editReply({
      content: 'Failed to post embed. Check the logs for details.',
    });
  }
}

/**
 * Handle /server-guide list
 */
async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    const config = loadConfig();
    const sortedEmbeds = [...config.embeds].sort((a, b) => a.order - b.order);
    const imageCache = loadImageCache();

    const embed = new EmbedBuilder()
      .setTitle('Server Guide Configuration')
      .setDescription(
        `**Channel:** <#${config.channelId}>\n` +
        `**Upload Channel:** ${config.imageUploadChannelId ? `<#${config.imageUploadChannelId}>` : 'Not set'}\n` +
        `**Version:** ${config.metadata.version}\n` +
        `**Last Updated:** ${config.metadata.lastUpdated}`
      )
      .setColor(0x5865f2);

    const embedList = sortedEmbeds
      .map((e) => {
        const hasLocalImage = findLocalImage(e.id) !== null;
        const hasCachedUrl = imageCache[e.id] !== undefined;
        const imageStatus = hasLocalImage
          ? hasCachedUrl ? '🖼️' : '📁'
          : '';
        return `\`${e.order}\` **${e.title || 'Untitled'}** (\`${e.id}\`) ${imageStatus}`;
      })
      .join('\n');

    embed.addFields({
      name: `Embeds (${sortedEmbeds.length})`,
      value: embedList || 'No embeds configured',
      inline: false,
    });

    embed.setFooter({
      text: '🖼️ = image cached | 📁 = local image (not uploaded yet)',
    });

    await interaction.reply({ embeds: [embed], ephemeral: true });

  } catch (error) {
    logger.error('Error listing embeds:', error);
    await interaction.reply({
      content: 'Failed to load configuration. Check the logs for details.',
      ephemeral: true,
    });
  }
}

/**
 * Handle /server-guide preview
 */
async function handlePreview(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  try {
    const config = loadConfig();
    const embedId = interaction.options.getString('embed-id', true);

    const embedConfig = config.embeds.find((e) => e.id === embedId);
    if (!embedConfig) {
      await interaction.editReply({
        content: `Embed with ID \`${embedId}\` not found in configuration.`,
      });
      return;
    }

    // Get image URL if upload channel is configured
    let imageUrl: string | null = null;
    if (config.imageUploadChannelId) {
      const imageCache = loadImageCache();
      imageUrl = await getImageUrl(
        interaction.client,
        config.imageUploadChannelId,
        embedConfig.id,
        imageCache
      );
    }

    const embed = buildEmbed(embedConfig, imageUrl);
    await interaction.editReply({
      content: `**Preview of embed \`${embedId}\`:**`,
      embeds: [embed],
    });

  } catch (error) {
    logger.error('Error previewing embed:', error);
    await interaction.editReply({
      content: 'Failed to preview embed. Check the logs for details.',
    });
  }
}

/**
 * Handle /server-guide refresh-images
 */
async function handleRefreshImages(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  try {
    const config = loadConfig();

    if (!config.imageUploadChannelId) {
      await interaction.editReply({
        content: 'No image upload channel configured. Use `/server-guide set-upload-channel` first.',
      });
      return;
    }

    // Clear the cache to force re-upload
    saveImageCache({});
    const imageCache: ImageCache = {};

    let uploaded = 0;
    let skipped = 0;

    for (const embedConfig of config.embeds) {
      const localPath = findLocalImage(embedConfig.id);
      if (localPath) {
        await interaction.editReply({
          content: `Uploading image for \`${embedConfig.id}\`...`,
        });

        const result = await uploadImage(
          interaction.client,
          config.imageUploadChannelId,
          localPath,
          embedConfig.id
        );

        if (result) {
          imageCache[embedConfig.id] = {
            localPath,
            discordUrl: result.url,
            uploadedAt: new Date().toISOString(),
            messageId: result.messageId,
            channelId: config.imageUploadChannelId,
          };
          uploaded++;
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
      } else {
        skipped++;
      }
    }

    saveImageCache(imageCache);

    await interaction.editReply({
      content: `Image refresh complete!\n• Uploaded: ${uploaded}\n• Skipped (no local image): ${skipped}`,
    });

  } catch (error) {
    logger.error('Error refreshing images:', error);
    await interaction.editReply({
      content: 'Failed to refresh images. Check the logs for details.',
    });
  }
}

/**
 * Handle /server-guide set-upload-channel
 */
async function handleSetUploadChannel(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    const channel = interaction.options.getChannel('channel', true) as TextChannel;

    // Load and update config
    const config = loadConfig();
    config.imageUploadChannelId = channel.id;

    // Save config
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

    await interaction.reply({
      content: `Image upload channel set to <#${channel.id}>. Images will be uploaded there and cached for embed use.`,
      ephemeral: true,
    });

  } catch (error) {
    logger.error('Error setting upload channel:', error);
    await interaction.reply({
      content: 'Failed to set upload channel. Check the logs for details.',
      ephemeral: true,
    });
  }
}

/**
 * Server Guide Module
 * Manages server guide embeds from a JSON configuration file
 */
export class ServerGuideModule extends BaseModule {
  readonly metadata: ModuleMetadata = {
    id: 'server-guide',
    name: 'Server Guide',
    description: 'Manage and post server guide embeds from a JSON configuration',
    version: '1.1.0',
    author: 'QuadsLab',
    isCore: false,
    isPublic: true,
    dependencies: [],
    optionalDependencies: [],
    priority: 50,
  };

  constructor() {
    super();
    this.commands = [serverGuideCommand];
    this.events = [];
    this.migrationsPath = null;
  }

  async onLoad(context: ModuleContext): Promise<void> {
    await super.onLoad(context);
    clientRef = context.client;

    try {
      const config = loadConfig();
      const imageCache = loadImageCache();
      const localImages = config.embeds.filter((e) => findLocalImage(e.id) !== null).length;
      const cachedImages = Object.keys(imageCache).length;

      logger.info(
        `Server Guide loaded: ${config.embeds.length} embeds, ` +
        `${localImages} local images, ${cachedImages} cached URLs`
      );
    } catch (error) {
      logger.error('Failed to load server-guide.json:', error);
    }
  }

  async onUnload(): Promise<void> {
    clientRef = null;
    await super.onUnload();
  }
}
