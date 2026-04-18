import { GuildMember, TextChannel, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { defineEvent } from '../../../types/event.types.js';
import { Logger } from '../../../shared/utils/logger.js';
import { WelcomeService } from '../services/WelcomeService.js';
import { WelcomeImageService } from '../services/ImageService.js';
import { DEFAULT_MESSAGE_TEMPLATE, DEFAULT_EMBED_DESCRIPTION } from '../types.js';

const logger = new Logger('Welcome:MemberAdd');

let welcomeService: WelcomeService | null = null;
let imageService: WelcomeImageService | null = null;

/**
 * Inject services into the event handler
 */
export function setServices(ws: WelcomeService, is: WelcomeImageService): void {
  welcomeService = ws;
  imageService = is;
}

/**
 * Replace template variables in message text
 */
function replaceTemplateVars(template: string, member: GuildMember, memberCount: number): string {
  return template
    .replace(/{user}/g, `<@${member.user.id}>`)
    .replace(/{username}/g, member.user.username)
    .replace(/{displayName}/g, member.displayName)
    .replace(/{server}/g, member.guild.name)
    .replace(/{memberCount}/g, memberCount.toString());
}

/**
 * Event handler for when a new member joins
 */
export const guildMemberAddEvent = defineEvent(
  'guildMemberAdd',
  async (member: GuildMember) => {
    if (!welcomeService || !imageService) {
      logger.warn('Welcome services not initialized');
      return;
    }

    // Don't welcome bots
    if (member.user.bot) return;

    try {
      const settings = await welcomeService.getSettings(member.guild.id);

      // Check if welcome is enabled
      if (!settings.enabled) return;

      // Check if we have somewhere to send the welcome
      if (!settings.welcome_channel_id && !settings.send_dm) return;

      logger.debug(`Welcoming ${member.user.username} to ${member.guild.name}`);

      // Track results
      let attachment: AttachmentBuilder | null = null;
      let generatedImageBuffer: Buffer | null = null; // Store for DM reuse
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
          if (settings.use_ai_image && imageService.isAIImageAvailable()) {
            try {
              const aiResult = await imageService.generateAIWelcomeImage(
                member.displayName,
                settings.ai_image_prompt,
                avatarUrl
              );
              imageBuffer = aiResult.image;
              imagePromptIndex = aiResult.promptIndex;
              imagePromptText = aiResult.promptUsed;
              imageModel = aiResult.model;
              imageCost = aiResult.estimatedCost;
              logger.info(`Generated AI image for ${member.user.username} (prompt #${(imagePromptIndex ?? -1) + 1}, model: ${imageModel}, cost: $${imageCost.toFixed(4)})`);
            } catch (aiError) {
              logger.warn(`AI image generation failed, falling back to programmatic:`, aiError);
              // Fall back to programmatic image
              imageBuffer = await imageService.generateWelcomeImage(
                avatarUrl,
                member.displayName,
                settings.embed_color
              );
              imageModel = 'programmatic';
              imageCost = 0;
            }
          } else {
            // Use programmatic image
            imageBuffer = await imageService.generateWelcomeImage(
              avatarUrl,
              member.displayName,
              settings.embed_color
            );
            imageModel = 'programmatic';
            imageCost = 0;
          }

          // Save image to local storage
          try {
            imagePath = await imageService.saveImage(
              imageBuffer,
              member.guild.id,
              member.user.id,
              imageModel !== 'programmatic'
            );

            // Save image record to database
            imageId = await welcomeService.saveImage({
              guild_id: member.guild.id,
              user_id: member.user.id,
              image_path: imagePath,
              prompt_index: imagePromptIndex,
              prompt_text: imagePromptText,
              model: imageModel || 'programmatic',
              cost: imageCost || 0,
            });
          } catch (saveError) {
            logger.warn(`Failed to save welcome image:`, saveError);
          }

          attachment = new AttachmentBuilder(imageBuffer, {
            name: 'welcome.png',
          });
          generatedImageBuffer = imageBuffer; // Store for DM reuse
          imageGenerated = true;
        } catch (error) {
          logger.error(`Failed to generate welcome image for ${member.user.id}:`, error);
        }
      }

      // Generate AI message if enabled
      if (settings.use_ai_message) {
        try {
          const aiResult = await welcomeService.generateAIMessage(
            member.displayName,
            member.guild.name,
            settings.ai_prompt_template
          );

          if (aiResult) {
            aiWelcomeText = aiResult.text;
            aiTokensUsed = aiResult.tokensUsed;
            aiMessageGenerated = true;
          }
        } catch (error) {
          logger.error(`Failed to generate AI welcome message for ${member.user.id}:`, error);
        }
      }

      // Build embed
      const memberCount = member.guild.memberCount;
      const embedDescription = aiWelcomeText
        || replaceTemplateVars(settings.embed_description || DEFAULT_EMBED_DESCRIPTION, member, memberCount);

      const embed = new EmbedBuilder()
        .setTitle(settings.embed_title || 'Welcome!')
        .setDescription(embedDescription)
        .setColor(parseInt(settings.embed_color.replace('#', ''), 16))
        .setThumbnail(member.user.displayAvatarURL({ size: 128 }))
        .setTimestamp();

      if (attachment) {
        embed.setImage('attachment://welcome.png');
      }

      // Build message content
      const messageContent = settings.mention_user ? `${member}` : undefined;

      // Send to channel
      let messageId: string | null = null;
      let channelId: string | null = null;
      let sentDm = false;

      if (settings.welcome_channel_id) {
        try {
          const channel = await member.guild.channels.fetch(settings.welcome_channel_id);
          if (channel && channel.isTextBased()) {
            const msg = await (channel as TextChannel).send({
              content: messageContent,
              embeds: [embed],
              files: attachment ? [attachment] : [],
            });
            messageId = msg.id;
            channelId = channel.id;
            logger.debug(`Sent welcome message to channel ${channel.name}`);
          }
        } catch (error) {
          logger.error(`Failed to send welcome to channel:`, error);
        }
      }

      // Send DM if enabled
      if (settings.send_dm) {
        try {
          // Reuse the same generated image for DM (create fresh attachment from stored buffer)
          let dmAttachment: AttachmentBuilder | null = null;
          if (generatedImageBuffer) {
            dmAttachment = new AttachmentBuilder(generatedImageBuffer, {
              name: 'welcome.png',
            });
          }

          const dmEmbed = new EmbedBuilder()
            .setTitle(`Welcome to ${member.guild.name}!`)
            .setDescription(embedDescription)
            .setColor(parseInt(settings.embed_color.replace('#', ''), 16))
            .setThumbnail(member.guild.iconURL({ size: 128 }) || member.user.displayAvatarURL({ size: 128 }))
            .addFields([
              {
                name: '🚀 Get Started',
                value: 'Check out <#1460713578066608189> for everything you need to know!',
                inline: false,
              },
            ])
            .setTimestamp();

          if (dmAttachment) {
            dmEmbed.setImage('attachment://welcome.png');
          }

          await member.send({
            embeds: [dmEmbed],
            files: dmAttachment ? [dmAttachment] : [],
          });
          sentDm = true;
          logger.debug(`Sent welcome DM to ${member.user.username}`);
        } catch (error) {
          logger.debug(`Could not DM ${member.user.username} (DMs likely disabled)`);
        }
      }

      // Log to history
      await welcomeService.logWelcome({
        guild_id: member.guild.id,
        user_id: member.user.id,
        channel_id: channelId,
        message_id: messageId,
        sent_dm: sentDm,
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

      const costStr = imageCost ? ` cost: $${imageCost.toFixed(4)}` : '';
      logger.info(`Welcomed ${member.user.username} to ${member.guild.name} (image: ${imageGenerated}, model: ${imageModel || 'none'}${costStr})`);

    } catch (error) {
      logger.error(`Error welcoming member ${member.user.id}:`, error);

      // Log error to history
      await welcomeService?.logWelcome({
        guild_id: member.guild.id,
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
  }
);
