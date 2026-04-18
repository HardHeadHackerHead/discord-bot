import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  AttachmentBuilder,
  GuildMember,
  TextChannel,
} from 'discord.js';
import { SlashCommand } from '../../../types/command.types.js';
import { WelcomeService } from '../services/WelcomeService.js';
import { WelcomeImageService, getPromptByIndex, getTotalPromptCount } from '../services/ImageService.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('Welcome:Command');

let welcomeService: WelcomeService | null = null;
let imageService: WelcomeImageService | null = null;

export function setServices(ws: WelcomeService, is: WelcomeImageService): void {
  welcomeService = ws;
  imageService = is;
}

export const command: SlashCommand = {
  type: 'slash',
  data: new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Configure welcome messages for new members')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    // Quick setup
    .addSubcommand(sub =>
      sub
        .setName('setup')
        .setDescription('Quick setup for welcome messages')
        .addChannelOption(opt =>
          opt
            .setName('channel')
            .setDescription('Channel to send welcome messages')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
    )
    // Toggle enable/disable
    .addSubcommand(sub =>
      sub.setName('toggle').setDescription('Enable or disable welcome messages')
    )
    // Set channel
    .addSubcommand(sub =>
      sub
        .setName('channel')
        .setDescription('Set the welcome channel')
        .addChannelOption(opt =>
          opt
            .setName('channel')
            .setDescription('Channel for welcome messages')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
    )
    // Set color
    .addSubcommand(sub =>
      sub
        .setName('color')
        .setDescription('Set the embed and glow color')
        .addStringOption(opt =>
          opt
            .setName('color')
            .setDescription('Hex color code (e.g., #00D4FF)')
            .setRequired(true)
        )
    )
    // Toggle DM
    .addSubcommand(sub =>
      sub.setName('dm').setDescription('Toggle sending DM to new members')
    )
    // Toggle image
    .addSubcommand(sub =>
      sub.setName('image').setDescription('Toggle custom welcome image generation')
    )
    // Toggle AI text messages
    .addSubcommand(sub =>
      sub.setName('ai').setDescription('Toggle AI-generated welcome messages')
    )
    // Set AI text prompt
    .addSubcommand(sub =>
      sub
        .setName('prompt')
        .setDescription('Set custom AI prompt template for messages')
        .addStringOption(opt =>
          opt
            .setName('prompt')
            .setDescription('AI prompt (use {username} and {server} as placeholders)')
            .setRequired(true)
        )
    )
    // Toggle AI image generation
    .addSubcommand(sub =>
      sub.setName('aiimage').setDescription('Toggle AI-generated welcome images (DALL-E)')
    )
    // Set AI image prompt
    .addSubcommand(sub =>
      sub
        .setName('imageprompt')
        .setDescription('Set custom AI prompt for image generation')
        .addStringOption(opt =>
          opt
            .setName('prompt')
            .setDescription('Describe the style of image to generate')
            .setRequired(true)
        )
    )
    // Test on any user
    .addSubcommand(sub =>
      sub
        .setName('test')
        .setDescription('Test the welcome message')
        .addUserOption(opt =>
          opt
            .setName('user')
            .setDescription('User to test welcome on (defaults to yourself)')
            .setRequired(false)
        )
    )
    // Test all prompts
    .addSubcommand(sub =>
      sub
        .setName('testall')
        .setDescription('Generate images for ALL prompts to preview each style (~$1.36)')
        .addUserOption(opt =>
          opt
            .setName('user')
            .setDescription('User to test welcome on (defaults to yourself)')
            .setRequired(false)
        )
    )
    // Backfill existing members
    .addSubcommand(sub =>
      sub
        .setName('backfill')
        .setDescription('Send welcome messages to existing members who haven\'t been welcomed')
        .addIntegerOption(opt =>
          opt
            .setName('limit')
            .setDescription('Maximum number of members to process (default: all)')
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(1000)
        )
        .addBooleanOption(opt =>
          opt
            .setName('dryrun')
            .setDescription('Preview without actually sending messages')
            .setRequired(false)
        )
    )
    // Regenerate a user's welcome image
    .addSubcommand(sub =>
      sub
        .setName('regenerate')
        .setDescription('Regenerate a user\'s welcome image and update their message (~$0.02)')
        .addUserOption(opt =>
          opt
            .setName('user')
            .setDescription('User to regenerate welcome image for')
            .setRequired(true)
        )
        .addIntegerOption(opt =>
          opt
            .setName('prompt')
            .setDescription('Specific prompt style (96 total, showing 25 favorites)')
            .setRequired(false)
            .addChoices(
              // Mad Scientist (1-8)
              { name: '1. Mad Scientist - Underground Lab', value: 0 },
              { name: '2. Mad Scientist - Explosion', value: 1 },
              { name: '6. Mad Scientist - Giant Robot', value: 5 },
              // Futuristic (9-16)
              { name: '9. Futuristic - Sleek Lab', value: 8 },
              { name: '10. Futuristic - Quantum Physicist', value: 9 },
              { name: '15. Futuristic - Crystal Energy', value: 14 },
              // Space (17-26)
              { name: '17. Space - Station Scientist', value: 16 },
              { name: '20. Space - Black Hole', value: 19 },
              { name: '24. Space - First Contact', value: 23 },
              // Cyberpunk (27-36)
              { name: '27. Cyberpunk - Hacker Lab', value: 26 },
              { name: '28. Cyberpunk - Robotics Engineer', value: 27 },
              { name: '34. Cyberpunk - Mech Pilot', value: 33 },
              // Biotech (37-46)
              { name: '37. Biotech - Geneticist', value: 36 },
              { name: '38. Biotech - Deep Sea', value: 37 },
              { name: '42. Biotech - Mushroom Cave', value: 41 },
              // Mystical (47-56)
              { name: '47. Mystical - Potion Master', value: 46 },
              { name: '48. Mystical - Dimension Portal', value: 47 },
              { name: '52. Mystical - Ghost Hunter', value: 51 },
              // Steampunk (57-64)
              { name: '57. Steampunk - Victorian Inventor', value: 56 },
              { name: '59. Steampunk - Steam Lab', value: 58 },
              // Horror (65-72)
              { name: '67. Horror - Eldritch Experimenter', value: 66 },
              { name: '68. Horror - Vampire Scientist', value: 67 },
              // Retro (73-80)
              { name: '73. Retro - 1950s Atomic Age', value: 72 },
              { name: '74. Retro - 1980s Computer Lab', value: 73 },
              // Elemental (81-88)
              { name: '81. Elemental - Storm Chaser', value: 80 }
            )
        )
    )
    // View settings
    .addSubcommand(sub =>
      sub.setName('settings').setDescription('View current welcome settings')
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!welcomeService || !imageService) {
      await interaction.reply({
        content: 'Welcome service is not initialized.',
        ephemeral: true,
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'setup':
        await handleSetup(interaction);
        break;
      case 'toggle':
        await handleToggle(interaction);
        break;
      case 'channel':
        await handleChannel(interaction);
        break;
      case 'color':
        await handleColor(interaction);
        break;
      case 'dm':
        await handleDm(interaction);
        break;
      case 'image':
        await handleImage(interaction);
        break;
      case 'ai':
        await handleAi(interaction);
        break;
      case 'prompt':
        await handlePrompt(interaction);
        break;
      case 'aiimage':
        await handleAiImage(interaction);
        break;
      case 'imageprompt':
        await handleImagePrompt(interaction);
        break;
      case 'test':
        await handleTest(interaction);
        break;
      case 'testall':
        await handleTestAll(interaction);
        break;
      case 'backfill':
        await handleBackfill(interaction);
        break;
      case 'regenerate':
        await handleRegenerate(interaction);
        break;
      case 'settings':
        await handleSettings(interaction);
        break;
    }
  },
};

/**
 * Quick setup - sets channel and enables
 */
async function handleSetup(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = interaction.options.getChannel('channel', true);

  await welcomeService!.updateSettings(interaction.guildId!, {
    enabled: true,
    welcome_channel_id: channel.id,
  });

  await interaction.reply({
    content: `Welcome messages enabled! New members will be welcomed in <#${channel.id}>.`,
    ephemeral: true,
  });

  logger.info(`Welcome setup for guild ${interaction.guildId} - channel: ${channel.id}`);
}

/**
 * Toggle enable/disable
 */
async function handleToggle(interaction: ChatInputCommandInteraction): Promise<void> {
  const settings = await welcomeService!.getSettings(interaction.guildId!);
  const newEnabled = !settings.enabled;

  await welcomeService!.updateSettings(interaction.guildId!, {
    enabled: newEnabled,
  });

  await interaction.reply({
    content: newEnabled
      ? 'Welcome messages **enabled**.'
      : 'Welcome messages **disabled**.',
    ephemeral: true,
  });
}

/**
 * Set welcome channel
 */
async function handleChannel(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = interaction.options.getChannel('channel', true);

  await welcomeService!.updateSettings(interaction.guildId!, {
    welcome_channel_id: channel.id,
  });

  await interaction.reply({
    content: `Welcome channel set to <#${channel.id}>.`,
    ephemeral: true,
  });
}

/**
 * Set embed/glow color
 */
async function handleColor(interaction: ChatInputCommandInteraction): Promise<void> {
  const colorInput = interaction.options.getString('color', true);

  // Validate hex color
  const hexRegex = /^#?([0-9A-Fa-f]{6})$/;
  const match = colorInput.match(hexRegex);

  if (!match || !match[1]) {
    await interaction.reply({
      content: 'Invalid color format. Please use a hex color code like `#00D4FF` or `00D4FF`.',
      ephemeral: true,
    });
    return;
  }

  const color = `#${match[1].toUpperCase()}`;

  await welcomeService!.updateSettings(interaction.guildId!, {
    embed_color: color,
  });

  await interaction.reply({
    content: `Glow color set to \`${color}\`.`,
    ephemeral: true,
  });
}

/**
 * Toggle DM welcome
 */
async function handleDm(interaction: ChatInputCommandInteraction): Promise<void> {
  const settings = await welcomeService!.getSettings(interaction.guildId!);
  const newSendDm = !settings.send_dm;

  await welcomeService!.updateSettings(interaction.guildId!, {
    send_dm: newSendDm,
  });

  await interaction.reply({
    content: newSendDm
      ? 'DM welcome **enabled**. New members will also receive a DM.'
      : 'DM welcome **disabled**.',
    ephemeral: true,
  });
}

/**
 * Toggle image generation
 */
async function handleImage(interaction: ChatInputCommandInteraction): Promise<void> {
  const settings = await welcomeService!.getSettings(interaction.guildId!);
  const newIncludeImage = !settings.include_image;

  await welcomeService!.updateSettings(interaction.guildId!, {
    include_image: newIncludeImage,
  });

  await interaction.reply({
    content: newIncludeImage
      ? 'Welcome images **enabled**. New members will get a custom welcome image.'
      : 'Welcome images **disabled**.',
    ephemeral: true,
  });
}

/**
 * Toggle AI text messages
 */
async function handleAi(interaction: ChatInputCommandInteraction): Promise<void> {
  const settings = await welcomeService!.getSettings(interaction.guildId!);
  const newUseAi = !settings.use_ai_message;

  // Check if AI is available
  if (newUseAi && !welcomeService!.isAIAvailable()) {
    await interaction.reply({
      content: 'AI is not available. Please configure an AI provider (OpenAI or Claude) first.',
      ephemeral: true,
    });
    return;
  }

  await welcomeService!.updateSettings(interaction.guildId!, {
    use_ai_message: newUseAi,
  });

  await interaction.reply({
    content: newUseAi
      ? 'AI welcome messages **enabled**. Each welcome will have a unique AI-generated message.'
      : 'AI welcome messages **disabled**. Using template message.',
    ephemeral: true,
  });
}

/**
 * Set AI text prompt template
 */
async function handlePrompt(interaction: ChatInputCommandInteraction): Promise<void> {
  const prompt = interaction.options.getString('prompt', true);

  await welcomeService!.updateSettings(interaction.guildId!, {
    ai_prompt_template: prompt,
  });

  await interaction.reply({
    content: `AI message prompt updated.\n\n**New prompt:**\n\`\`\`${prompt}\`\`\``,
    ephemeral: true,
  });
}

/**
 * Toggle AI image generation
 */
async function handleAiImage(interaction: ChatInputCommandInteraction): Promise<void> {
  const settings = await welcomeService!.getSettings(interaction.guildId!);
  const newUseAiImage = !settings.use_ai_image;

  // Check if AI image is available
  if (newUseAiImage && !imageService!.isAIImageAvailable()) {
    await interaction.reply({
      content: 'AI image generation is not available. Please configure `OPENAI_API_KEY` first.',
      ephemeral: true,
    });
    return;
  }

  await welcomeService!.updateSettings(interaction.guildId!, {
    use_ai_image: newUseAiImage,
  });

  await interaction.reply({
    content: newUseAiImage
      ? 'AI image generation **enabled**. Each welcome will have a unique DALL-E generated image.'
      : 'AI image generation **disabled**. Using programmatic neon glow effect.',
    ephemeral: true,
  });
}

/**
 * Set AI image prompt
 */
async function handleImagePrompt(interaction: ChatInputCommandInteraction): Promise<void> {
  const prompt = interaction.options.getString('prompt', true);

  await welcomeService!.updateSettings(interaction.guildId!, {
    ai_image_prompt: prompt,
  });

  await interaction.reply({
    content: `AI image prompt updated.\n\n**New prompt:**\n\`\`\`${prompt}\`\`\``,
    ephemeral: true,
  });
}

/**
 * Test welcome on any user
 */
async function handleTest(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const settings = await welcomeService!.getSettings(interaction.guildId!);

  // Get target user (or self)
  const targetUser = interaction.options.getUser('user') || interaction.user;
  const targetMember = interaction.options.getMember('user') as GuildMember | null
    || interaction.member as GuildMember;

  if (!targetMember || !interaction.guild) {
    await interaction.editReply('Could not get member information.');
    return;
  }

  try {
    let attachment: AttachmentBuilder | null = null;
    let imageNote = '';
    let generatedImageBuffer: Buffer | null = null; // Store for reuse in DM

    // Generate image if enabled
    if (settings.include_image) {
      const avatarUrl = targetUser.displayAvatarURL({
        extension: 'png',
        size: 512,
      });

      let imageBuffer: Buffer;
      let imageModel: string = 'programmatic';
      let imageCost: number = 0;
      let imagePromptIndex: number | null = null;
      let imagePromptText: string | null = null;

      // Use AI image if enabled, otherwise use programmatic
      if (settings.use_ai_image && imageService!.isAIImageAvailable()) {
        try {
          const aiResult = await imageService!.generateAIWelcomeImage(
            targetMember.displayName,
            settings.ai_image_prompt,
            avatarUrl
          );
          imageBuffer = aiResult.image;
          imageModel = aiResult.model;
          imageCost = aiResult.estimatedCost;
          imagePromptIndex = aiResult.promptIndex;
          imagePromptText = aiResult.promptUsed;
          const promptNum = aiResult.promptIndex !== null ? `#${aiResult.promptIndex + 1}` : 'custom';
          imageNote = `\n\n*AI-generated (${aiResult.model}, prompt ${promptNum}, ~$${aiResult.estimatedCost.toFixed(2)})*`;
        } catch (error) {
          logger.error('AI image generation failed, falling back to programmatic:', error);
          // Fall back to programmatic
          imageBuffer = await imageService!.generateWelcomeImage(
            avatarUrl,
            targetMember.displayName,
            settings.embed_color
          );
          imageNote = '\n\n*AI image failed, using programmatic fallback*';
        }
      } else {
        imageBuffer = await imageService!.generateWelcomeImage(
          avatarUrl,
          targetMember.displayName,
          settings.embed_color
        );
        imageNote = '\n\n*Programmatic neon glow image (free)*';
      }

      attachment = new AttachmentBuilder(imageBuffer, { name: 'welcome.png' });
      generatedImageBuffer = imageBuffer; // Store for DM reuse

      // Save image to storage and database (but not to welcome_history)
      try {
        const imagePath = await imageService!.saveImage(
          imageBuffer,
          interaction.guildId!,
          targetUser.id,
          imageModel !== 'programmatic'
        );

        await welcomeService!.saveImage({
          guild_id: interaction.guildId!,
          user_id: targetUser.id,
          image_path: imagePath,
          prompt_index: imagePromptIndex,
          prompt_text: imagePromptText,
          model: imageModel,
          cost: imageCost,
        });

        logger.debug(`Saved test image for ${targetUser.username}`);
      } catch (saveError) {
        logger.warn('Failed to save test image:', saveError);
      }
    }

    // Generate AI message if enabled
    let description = settings.embed_description || 'Welcome to the server!';
    let messageNote = '';

    if (settings.use_ai_message) {
      const aiResult = await welcomeService!.generateAIMessage(
        targetMember.displayName,
        interaction.guild.name,
        settings.ai_prompt_template
      );

      if (aiResult) {
        description = aiResult.text;
        messageNote = `\n*AI message (${aiResult.tokensUsed} tokens)*`;
      } else {
        messageNote = '\n*AI unavailable, using template*';
      }
    }

    // Build embed for channel preview
    const embed = new EmbedBuilder()
      .setTitle(settings.embed_title || 'Welcome!')
      .setDescription(description + messageNote + imageNote)
      .setColor(parseInt(settings.embed_color.replace('#', ''), 16))
      .setThumbnail(targetUser.displayAvatarURL({ size: 128 }))
      .setFooter({ text: `Test preview for ${targetUser.username}` })
      .setTimestamp();

    if (attachment) {
      embed.setImage('attachment://welcome.png');
    }

    await interaction.editReply({
      content: settings.mention_user ? `${targetUser}` : undefined,
      embeds: [embed],
      files: attachment ? [attachment] : [],
    });

    // Also send a test DM if DM setting is enabled
    if (settings.send_dm) {
      try {
        // Build DM embed with mini guide
        const dmEmbed = new EmbedBuilder()
          .setTitle(`Welcome to ${interaction.guild.name}!`)
          .setDescription(description)
          .setColor(parseInt(settings.embed_color.replace('#', ''), 16))
          .setThumbnail(interaction.guild.iconURL({ size: 128 }) || targetUser.displayAvatarURL({ size: 128 }))
          .addFields([
            {
              name: '🚀 Get Started',
              value: 'Check out <#1460713578066608189> for everything you need to know!',
              inline: false,
            },
          ])
          .setFooter({ text: `Test DM preview` })
          .setTimestamp();

        // Reuse the same generated image for the DM
        let dmAttachment: AttachmentBuilder | null = null;
        if (generatedImageBuffer) {
          dmAttachment = new AttachmentBuilder(generatedImageBuffer, { name: 'welcome.png' });
          dmEmbed.setImage('attachment://welcome.png');
        }

        await targetUser.send({
          embeds: [dmEmbed],
          files: dmAttachment ? [dmAttachment] : [],
        });

        // Follow up to let them know DM was sent
        await interaction.followUp({
          content: `✅ Test DM also sent to ${targetUser.username}!`,
          ephemeral: true,
        });

        logger.debug(`Sent test DM to ${targetUser.username}`);
      } catch (dmError) {
        logger.warn(`Failed to send test DM to ${targetUser.username}:`, dmError);
        await interaction.followUp({
          content: `⚠️ Could not send test DM to ${targetUser.username} (DMs may be disabled)`,
          ephemeral: true,
        });
      }
    }

  } catch (error) {
    logger.error('Test welcome failed:', error);
    await interaction.editReply(`Test failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Test all prompts - generates an image for each prompt style
 */
async function handleTestAll(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!imageService!.isAIImageAvailable()) {
    await interaction.reply({
      content: 'AI image generation is not available. Please configure `OPENAI_API_KEY` first.',
      ephemeral: true,
    });
    return;
  }

  // Need a text channel to send results (interaction tokens expire after 15 mins)
  const channel = interaction.channel;
  if (!channel || !channel.isTextBased() || channel.isDMBased()) {
    await interaction.reply({
      content: 'This command must be used in a server text channel.',
      ephemeral: true,
    });
    return;
  }

  const totalPrompts = getTotalPromptCount();
  const estimatedCost = totalPrompts * 0.08;

  // Get target user (or self)
  const targetUser = interaction.options.getUser('user') || interaction.user;
  const targetMember = interaction.options.getMember('user') as GuildMember | null
    || interaction.member as GuildMember;

  if (!targetMember || !interaction.guild) {
    await interaction.reply({
      content: 'Could not get member information.',
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content: `Starting generation of **${totalPrompts}** images for ${targetUser.username}...\nEstimated cost: ~$${estimatedCost.toFixed(2)}\nThis will take a while. Each image will be posted as it completes.`,
    ephemeral: false,
  });

  const avatarUrl = targetUser.displayAvatarURL({
    extension: 'png',
    size: 512,
  });

  let successCount = 0;
  let failCount = 0;
  let totalCost = 0;

  // Loop through all prompts
  for (let i = 0; i < totalPrompts; i++) {
    const promptText = getPromptByIndex(i);
    if (!promptText) continue;

    // Extract a short name from the prompt (first ~50 chars or first sentence)
    const shortName = promptText.slice(0, 80).split('.')[0] || `Prompt ${i + 1}`;

    try {
      logger.info(`[TestAll] Generating image ${i + 1}/${totalPrompts} for ${targetUser.username}`);

      // Generate the image with this specific prompt
      const aiResult = await imageService!.generateAIWelcomeImage(
        targetMember.displayName,
        promptText, // Force this specific prompt
        avatarUrl
      );

      const attachment = new AttachmentBuilder(aiResult.image, { name: `welcome_prompt_${i + 1}.png` });

      // Create embed with prompt info
      const embed = new EmbedBuilder()
        .setTitle(`Prompt #${i + 1}: ${shortName}...`)
        .setDescription(`**Full prompt:**\n\`\`\`${promptText.slice(0, 1000)}${promptText.length > 1000 ? '...' : ''}\`\`\``)
        .setColor(0x00D4FF)
        .setImage(`attachment://welcome_prompt_${i + 1}.png`)
        .setFooter({ text: `Model: ${aiResult.model} | Cost: ~$${aiResult.estimatedCost.toFixed(2)}` })
        .setTimestamp();

      // Send directly to channel (interaction tokens expire after 15 mins)
      await (channel as TextChannel).send({
        embeds: [embed],
        files: [attachment],
      });

      totalCost += aiResult.estimatedCost;
      successCount++;

      // Save image to storage and database
      try {
        const imagePath = await imageService!.saveImage(
          aiResult.image,
          interaction.guildId!,
          targetUser.id,
          true
        );

        await welcomeService!.saveImage({
          guild_id: interaction.guildId!,
          user_id: targetUser.id,
          image_path: imagePath,
          prompt_index: i,
          prompt_text: promptText,
          model: aiResult.model,
          cost: aiResult.estimatedCost,
        });
      } catch (saveError) {
        logger.warn(`Failed to save testall image ${i + 1}:`, saveError);
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      logger.error(`[TestAll] Failed to generate image ${i + 1}:`, error);
      failCount++;

      await (channel as TextChannel).send({
        content: `**Prompt #${i + 1} failed:** ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  }

  // Final summary
  await (channel as TextChannel).send({
    content: `**Test Complete!**\n✅ Success: ${successCount}/${totalPrompts}\n❌ Failed: ${failCount}\n💰 Total cost: ~$${totalCost.toFixed(2)}`,
  });

  logger.info(`[TestAll] Completed for ${targetUser.username}: ${successCount} success, ${failCount} failed, $${totalCost.toFixed(2)}`);
}

/**
 * Backfill welcome messages to existing members who haven't been welcomed
 */
async function handleBackfill(interaction: ChatInputCommandInteraction): Promise<void> {
  const limit = interaction.options.getInteger('limit') ?? null;
  const dryRun = interaction.options.getBoolean('dryrun') ?? false;

  // Need a text channel to send results
  const channel = interaction.channel;
  if (!channel || !channel.isTextBased() || channel.isDMBased()) {
    await interaction.reply({
      content: 'This command must be used in a server text channel.',
      ephemeral: true,
    });
    return;
  }

  if (!interaction.guild) {
    await interaction.reply({
      content: 'This command must be used in a server.',
      ephemeral: true,
    });
    return;
  }

  const settings = await welcomeService!.getSettings(interaction.guildId!);

  // Check if welcome is configured
  if (!settings.welcome_channel_id) {
    await interaction.reply({
      content: 'Welcome channel is not configured. Use `/welcome setup` first.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: false });

  try {
    // Fetch all guild members with retry logic for rate limits
    logger.info(`[Backfill] Fetching members for guild ${interaction.guildId}`);
    await interaction.editReply('Fetching guild members...');

    let members;
    let retryCount = 0;
    const maxRetries = 3;

    while (retryCount < maxRetries) {
      try {
        members = await interaction.guild.members.fetch();
        break; // Success, exit loop
      } catch (fetchError: unknown) {
        // Check if it's a rate limit error
        if (fetchError && typeof fetchError === 'object' && 'data' in fetchError) {
          const errorData = fetchError as { data?: { retry_after?: number } };
          const retryAfter = errorData.data?.retry_after;
          if (retryAfter && retryCount < maxRetries - 1) {
            const waitTime = Math.ceil(retryAfter * 1000) + 1000; // Add 1 second buffer
            logger.warn(`[Backfill] Rate limited, waiting ${waitTime}ms before retry ${retryCount + 1}/${maxRetries}`);
            await interaction.editReply(`Rate limited by Discord. Waiting ${Math.ceil(retryAfter + 1)} seconds before retry...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            retryCount++;
            continue;
          }
        }
        throw fetchError; // Re-throw if not a rate limit or max retries reached
      }
    }

    if (!members) {
      await interaction.editReply('Failed to fetch guild members after retries.');
      return;
    }

    logger.info(`[Backfill] Fetched ${members.size} members`);

    // Get already welcomed user IDs
    const welcomedUserIds = await welcomeService!.getWelcomedUserIds(interaction.guildId!);
    logger.info(`[Backfill] Found ${welcomedUserIds.size} already welcomed users`);

    // Filter to non-bot, non-welcomed members and sort by join date
    const eligibleMembers = Array.from(members.values())
      .filter(member => !member.user.bot && !welcomedUserIds.has(member.user.id))
      .sort((a, b) => {
        const aTime = a.joinedTimestamp ?? 0;
        const bTime = b.joinedTimestamp ?? 0;
        return aTime - bTime; // Oldest first
      });

    const totalEligible = eligibleMembers.length;
    const toProcess = limit ? eligibleMembers.slice(0, limit) : eligibleMembers;

    if (toProcess.length === 0) {
      await interaction.editReply('No members to welcome. All non-bot members have already been welcomed!');
      return;
    }

    // Estimate cost if using AI images (low quality = ~$0.02 per image)
    const estimatedCost = settings.use_ai_image ? toProcess.length * 0.02 : 0;
    const costNote = estimatedCost > 0 ? `\nEstimated cost: ~$${estimatedCost.toFixed(2)}` : '';

    // Dry run mode - just list who would be welcomed
    if (dryRun) {
      const memberList = toProcess.slice(0, 20).map((m, i) => {
        const joinDate = m.joinedAt ? m.joinedAt.toLocaleDateString() : 'Unknown';
        return `${i + 1}. ${m.user.username} (joined ${joinDate})`;
      }).join('\n');

      const moreNote = toProcess.length > 20 ? `\n...and ${toProcess.length - 20} more` : '';

      await interaction.editReply(
        `**Dry Run - Would welcome ${toProcess.length} members** (${totalEligible} total eligible${limit ? `, limited to ${limit}` : ''})${costNote}\n\n${memberList}${moreNote}\n\nRun without \`dryrun\` to actually send welcome messages.`
      );
      return;
    }

    // Actual backfill
    await interaction.editReply(
      `Starting backfill of **${toProcess.length}** members...${costNote}\nProgress will be posted to <#${settings.welcome_channel_id}>.`
    );

    // Get the welcome channel
    const welcomeChannel = await interaction.guild.channels.fetch(settings.welcome_channel_id);
    if (!welcomeChannel || !welcomeChannel.isTextBased()) {
      await interaction.editReply('Welcome channel not found or is not a text channel.');
      return;
    }

    let successCount = 0;
    let failCount = 0;
    let totalCost = 0;

    // Process members in join order
    for (let i = 0; i < toProcess.length; i++) {
      const member = toProcess[i];
      if (!member) continue; // TypeScript guard

      try {
        logger.info(`[Backfill] Processing ${i + 1}/${toProcess.length}: ${member.user.username}`);

        // Track results for this member
        let attachment: AttachmentBuilder | null = null;
        let imageGenerated = false;
        let imageId: string | null = null;
        let imagePath: string | null = null;
        let imagePromptIndex: number | null = null;
        let imagePromptText: string | null = null;
        let imageModel: string | null = null;
        let imageCost: number | null = null;
        let aiMessageGenerated = false;
        let aiTokensUsed = 0;
        let aiWelcomeText: string | null = null;

        // Generate welcome image if enabled
        if (settings.include_image) {
          try {
            const avatarUrl = member.user.displayAvatarURL({
              extension: 'png',
              size: 512,
            });

            let imageBuffer: Buffer;

            // Use AI image if enabled and available
            if (settings.use_ai_image && imageService!.isAIImageAvailable()) {
              try {
                const aiResult = await imageService!.generateAIWelcomeImage(
                  member.displayName,
                  settings.ai_image_prompt,
                  avatarUrl
                );
                imageBuffer = aiResult.image;
                imagePromptIndex = aiResult.promptIndex;
                imagePromptText = aiResult.promptUsed;
                imageModel = aiResult.model;
                imageCost = aiResult.estimatedCost;
                totalCost += imageCost;
              } catch (aiError) {
                // Stop backfill entirely on AI failure - don't fall back to programmatic
                logger.error(`[Backfill] AI image failed for ${member.user.username}, stopping backfill:`, aiError);

                const errorMsg = aiError instanceof Error ? aiError.message : 'Unknown error';
                const costNote2 = totalCost > 0 ? `\n💰 Cost so far: ~$${totalCost.toFixed(2)}` : '';

                await (welcomeChannel as TextChannel).send(
                  `**Backfill Stopped - AI Image Generation Failed**\n❌ Error: ${errorMsg}\n✅ Completed: ${successCount}/${toProcess.length}${costNote2}\n\nPlease check your OpenAI API key and try again.`
                );

                await interaction.editReply(
                  `Backfill stopped due to AI image generation failure.\nCompleted ${successCount} of ${toProcess.length} members before error.`
                );

                return; // Exit the function entirely
              }
            } else {
              imageBuffer = await imageService!.generateWelcomeImage(
                avatarUrl,
                member.displayName,
                settings.embed_color
              );
              imageModel = 'programmatic';
              imageCost = 0;
            }

            // Save image to storage
            try {
              imagePath = await imageService!.saveImage(
                imageBuffer,
                interaction.guildId!,
                member.user.id,
                imageModel !== 'programmatic'
              );

              imageId = await welcomeService!.saveImage({
                guild_id: interaction.guildId!,
                user_id: member.user.id,
                image_path: imagePath,
                prompt_index: imagePromptIndex,
                prompt_text: imagePromptText,
                model: imageModel || 'programmatic',
                cost: imageCost || 0,
              });
            } catch (saveError) {
              logger.warn(`[Backfill] Failed to save image:`, saveError);
            }

            attachment = new AttachmentBuilder(imageBuffer, { name: 'welcome.png' });
            imageGenerated = true;
          } catch (error) {
            logger.error(`[Backfill] Failed to generate image for ${member.user.id}:`, error);
          }
        }

        // Generate AI message if enabled
        if (settings.use_ai_message) {
          try {
            const aiResult = await welcomeService!.generateAIMessage(
              member.displayName,
              interaction.guild.name,
              settings.ai_prompt_template
            );

            if (aiResult) {
              aiWelcomeText = aiResult.text;
              aiTokensUsed = aiResult.tokensUsed;
              aiMessageGenerated = true;
            }
          } catch (error) {
            logger.error(`[Backfill] Failed to generate AI message for ${member.user.id}:`, error);
          }
        }

        // Build embed
        const memberCount = interaction.guild.memberCount;
        const embedDescription = aiWelcomeText
          || (settings.embed_description || 'Welcome to the server!')
            .replace(/{user}/g, `<@${member.user.id}>`)
            .replace(/{username}/g, member.user.username)
            .replace(/{displayName}/g, member.displayName)
            .replace(/{server}/g, interaction.guild.name)
            .replace(/{memberCount}/g, memberCount.toString());

        const embed = new EmbedBuilder()
          .setTitle(settings.embed_title || 'Welcome!')
          .setDescription(embedDescription)
          .setColor(parseInt(settings.embed_color.replace('#', ''), 16))
          .setThumbnail(member.user.displayAvatarURL({ size: 128 }))
          .setTimestamp();

        if (attachment) {
          embed.setImage('attachment://welcome.png');
        }

        // Send to welcome channel
        const messageContent = settings.mention_user ? `${member}` : undefined;
        const msg = await (welcomeChannel as TextChannel).send({
          content: messageContent,
          embeds: [embed],
          files: attachment ? [attachment] : [],
        });

        // Log to history
        await welcomeService!.logWelcome({
          guild_id: interaction.guildId!,
          user_id: member.user.id,
          channel_id: welcomeChannel.id,
          message_id: msg.id,
          sent_dm: false,
          image_generated: imageGenerated,
          image_id: imageId,
          image_path: imagePath,
          image_prompt_index: imagePromptIndex,
          image_prompt_text: imagePromptText,
          image_model: imageModel,
          image_cost: imageCost,
          ai_message_generated: aiMessageGenerated,
          ai_tokens_used: aiTokensUsed,
          error_message: null,
        });

        successCount++;
        logger.info(`[Backfill] Welcomed ${member.user.username} (${successCount}/${toProcess.length})`);

        // Rate limit: delay between messages
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error) {
        logger.error(`[Backfill] Failed to welcome ${member.user.username}:`, error);
        failCount++;

        // Log error to history
        await welcomeService!.logWelcome({
          guild_id: interaction.guildId!,
          user_id: member.user.id,
          channel_id: null,
          message_id: null,
          sent_dm: false,
          image_generated: false,
          image_id: null,
          image_path: null,
          image_prompt_index: null,
          image_prompt_text: null,
          image_model: null,
          image_cost: null,
          ai_message_generated: false,
          ai_tokens_used: 0,
          error_message: error instanceof Error ? error.message : 'Unknown error',
        });
      }

      // Progress update every 10 members
      if ((i + 1) % 10 === 0) {
        await (channel as TextChannel).send(
          `**Backfill progress:** ${i + 1}/${toProcess.length} processed (${successCount} success, ${failCount} failed)`
        );
      }
    }

    // Final summary
    const costNote2 = totalCost > 0 ? `\n💰 Total cost: ~$${totalCost.toFixed(2)}` : '';
    await (channel as TextChannel).send(
      `**Backfill Complete!**\n✅ Success: ${successCount}/${toProcess.length}\n❌ Failed: ${failCount}${costNote2}`
    );

    logger.info(`[Backfill] Completed: ${successCount} success, ${failCount} failed, $${totalCost.toFixed(2)}`);

  } catch (error) {
    logger.error('[Backfill] Error:', error);
    await interaction.editReply(`Backfill failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Regenerate a user's welcome image with a specific prompt
 */
async function handleRegenerate(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!imageService!.isAIImageAvailable()) {
    await interaction.reply({
      content: 'AI image generation is not available. Please configure `OPENAI_API_KEY` first.',
      ephemeral: true,
    });
    return;
  }

  const targetUser = interaction.options.getUser('user', true);
  const promptIndex = interaction.options.getInteger('prompt'); // null if not specified
  const targetMember = interaction.options.getMember('user') as GuildMember | null;

  if (!targetMember || !interaction.guild) {
    await interaction.reply({
      content: 'Could not find that member in this server.',
      ephemeral: true,
    });
    return;
  }

  // Check if user has been welcomed
  const recentWelcomes = await welcomeService!.getRecentWelcomes(interaction.guildId!, 100);
  const userWelcome = recentWelcomes.find(w => w.user_id === targetUser.id && w.error_message === null);

  if (!userWelcome) {
    await interaction.reply({
      content: `${targetUser.username} hasn't been welcomed yet. Use \`/welcome test @${targetUser.username}\` first.`,
      ephemeral: true,
    });
    return;
  }

  if (!userWelcome.channel_id || !userWelcome.message_id) {
    await interaction.reply({
      content: `Could not find the original welcome message for ${targetUser.username}. The message may have been deleted.`,
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const settings = await welcomeService!.getSettings(interaction.guildId!);

    // Get the prompt to use
    let promptText: string | null = null;
    if (promptIndex !== null) {
      promptText = getPromptByIndex(promptIndex) || null;
      if (!promptText) {
        await interaction.editReply(`Invalid prompt index: ${promptIndex}`);
        return;
      }
    }

    // Generate new image
    const avatarUrl = targetUser.displayAvatarURL({
      extension: 'png',
      size: 512,
    });

    logger.info(`[Regenerate] Generating new image for ${targetUser.username} with prompt ${promptIndex !== null ? `#${promptIndex + 1}` : 'random'}`);

    const aiResult = await imageService!.generateAIWelcomeImage(
      targetMember.displayName,
      promptText, // Pass specific prompt or null for random
      avatarUrl
    );

    // Save new image to storage
    const imagePath = await imageService!.saveImage(
      aiResult.image,
      interaction.guildId!,
      targetUser.id,
      true
    );

    // Save new image record to database
    const imageId = await welcomeService!.saveImage({
      guild_id: interaction.guildId!,
      user_id: targetUser.id,
      image_path: imagePath,
      prompt_index: aiResult.promptIndex,
      prompt_text: aiResult.promptUsed,
      model: aiResult.model,
      cost: aiResult.estimatedCost,
    });

    // Fetch the original message and update it
    try {
      const channel = await interaction.guild.channels.fetch(userWelcome.channel_id);
      if (!channel || !channel.isTextBased()) {
        await interaction.editReply('Could not find the welcome channel.');
        return;
      }

      const originalMessage = await (channel as TextChannel).messages.fetch(userWelcome.message_id);

      // Create new attachment
      const attachment = new AttachmentBuilder(aiResult.image, { name: 'welcome.png' });

      // Rebuild the embed with the new image
      const oldEmbed = originalMessage.embeds[0];
      const newEmbed = new EmbedBuilder()
        .setTitle(oldEmbed?.title || settings.embed_title || 'Welcome!')
        .setDescription(oldEmbed?.description || settings.embed_description || 'Welcome to the server!')
        .setColor(parseInt(settings.embed_color.replace('#', ''), 16))
        .setThumbnail(targetUser.displayAvatarURL({ size: 128 }))
        .setImage('attachment://welcome.png')
        .setTimestamp(oldEmbed?.timestamp ? new Date(oldEmbed.timestamp) : new Date());

      // Edit the original message
      await originalMessage.edit({
        content: originalMessage.content || undefined,
        embeds: [newEmbed],
        files: [attachment],
      });

      const promptNum = aiResult.promptIndex !== null ? `#${aiResult.promptIndex + 1}` : 'custom';
      await interaction.editReply(
        `Regenerated welcome image for ${targetUser.username}!\n` +
        `**Prompt:** ${promptNum}\n` +
        `**Cost:** ~$${aiResult.estimatedCost.toFixed(2)}\n` +
        `**Image ID:** \`${imageId}\``
      );

      logger.info(`[Regenerate] Updated welcome for ${targetUser.username} with prompt ${promptNum}, cost: $${aiResult.estimatedCost.toFixed(2)}`);

    } catch (msgError) {
      logger.error('[Regenerate] Failed to update original message:', msgError);
      await interaction.editReply(
        `Generated new image but couldn't update the original message (may have been deleted).\n` +
        `**Image ID:** \`${imageId}\`\n` +
        `**Cost:** ~$${aiResult.estimatedCost.toFixed(2)}`
      );
    }

  } catch (error) {
    logger.error('[Regenerate] Error:', error);
    await interaction.editReply(`Regeneration failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * View current settings
 */
async function handleSettings(interaction: ChatInputCommandInteraction): Promise<void> {
  const settings = await welcomeService!.getSettings(interaction.guildId!);

  const embed = new EmbedBuilder()
    .setTitle('Welcome Settings')
    .setColor(parseInt(settings.embed_color.replace('#', ''), 16))
    .addFields([
      {
        name: 'Status',
        value: settings.enabled ? '**Enabled**' : 'Disabled',
        inline: true,
      },
      {
        name: 'Channel',
        value: settings.welcome_channel_id ? `<#${settings.welcome_channel_id}>` : 'Not set',
        inline: true,
      },
      {
        name: 'DM Welcome',
        value: settings.send_dm ? 'Yes' : 'No',
        inline: true,
      },
      {
        name: 'Image',
        value: settings.include_image ? 'Yes' : 'No',
        inline: true,
      },
      {
        name: 'AI Image',
        value: settings.use_ai_image
          ? `Yes ${imageService!.isAIImageAvailable() ? '' : '(unavailable)'}`
          : 'No',
        inline: true,
      },
      {
        name: 'Mention User',
        value: settings.mention_user ? 'Yes' : 'No',
        inline: true,
      },
      {
        name: 'Glow Color',
        value: `\`${settings.embed_color}\``,
        inline: true,
      },
      {
        name: 'AI Messages',
        value: settings.use_ai_message
          ? `Yes ${welcomeService!.isAIAvailable() ? '' : '(unavailable)'}`
          : 'No',
        inline: true,
      },
      {
        name: 'Embed Title',
        value: settings.embed_title || 'Welcome!',
        inline: true,
      },
    ])
    .setFooter({ text: 'Use /welcome test [@user] to preview' })
    .setTimestamp();

  await interaction.reply({
    embeds: [embed],
    ephemeral: true,
  });
}
