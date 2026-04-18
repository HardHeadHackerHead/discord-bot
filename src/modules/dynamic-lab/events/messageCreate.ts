import { Message, ChannelType, VoiceChannel, User } from 'discord.js';
import { AnyModuleEvent } from '../../../types/event.types.js';
import { LabService } from '../services/LabService.js';
import { LabControlPanel } from '../components/LabControlPanel.js';
import { getPermitWaitingState, clearPermitWaitingState } from './interactionCreate.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('DynamicLab:MessageCreate');

/**
 * Send an announcement message to the voice channel's text chat
 */
async function announceAction(
  channel: VoiceChannel,
  message: string
): Promise<void> {
  try {
    await channel.send({ content: message });
  } catch (error) {
    logger.debug('Could not send announcement to channel:', error);
  }
}

/**
 * Send a DM to a user about a lab action
 */
async function sendActionDM(
  user: User,
  message: string
): Promise<boolean> {
  try {
    await user.send({ content: message });
    return true;
  } catch (error) {
    logger.debug(`Could not send DM to ${user.username}:`, error);
    return false;
  }
}

let labService: LabService | null = null;

export function setLabService(service: LabService): void {
  labService = service;
}

export const messageCreateEvent: AnyModuleEvent = {
  name: 'messageCreate',
  once: false,

  async execute(...args: unknown[]): Promise<void> {
    const message = args[0] as Message;
    if (!labService) return;

    // Ignore bot messages
    if (message.author.bot) return;

    // Check if the user is in permit waiting state
    const waitingState = getPermitWaitingState(message.author.id);
    if (!waitingState) return;

    // Check if the message is in the same channel as the lab
    if (message.channel.id !== waitingState.channelId) return;

    // Check if the message has user mentions
    const mentionedUser = message.mentions.users.first();
    if (!mentionedUser) {
      // Delete the message and ignore (user didn't mention anyone)
      try {
        await message.delete();
      } catch {
        // Might not have permission to delete
      }
      return;
    }

    // Clear the waiting state
    clearPermitWaitingState(message.author.id);

    // Delete the user's message
    try {
      await message.delete();
    } catch {
      // Might not have permission to delete
    }

    // Get the lab
    const lab = await labService.getLabByChannel(waitingState.channelId);
    if (!lab) return;

    // Make sure the user is still the owner
    if (lab.owner_id !== message.author.id) return;

    const channel = message.channel;
    if (channel.type !== ChannelType.GuildVoice) return;
    const voiceChannel = channel as VoiceChannel;

    // Don't allow permitting yourself
    if (mentionedUser.id === message.author.id) {
      try {
        const permitList = await labService.getUserPermitList(lab.owner_id, lab.guild_id);
        const controlMessage = await voiceChannel.messages.fetch(waitingState.messageId);
        await controlMessage.edit({
          embeds: [LabControlPanel.createErrorEmbed('You cannot permit yourself.')],
          components: [
            LabControlPanel.createMainButtons(lab),
            LabControlPanel.createUserButtons(lab.is_locked),
          ],
        });

        // Revert to normal embed after 3 seconds
        setTimeout(async () => {
          try {
            const currentLab = await labService!.getLabByChannel(voiceChannel.id);
            if (currentLab) {
              const currentPermitList = await labService!.getUserPermitList(currentLab.owner_id, currentLab.guild_id);
              await controlMessage.edit({
                embeds: [LabControlPanel.createEmbed(currentLab, voiceChannel, message.author, currentPermitList)],
                components: [
                  LabControlPanel.createMainButtons(currentLab),
                  LabControlPanel.createUserButtons(currentLab.is_locked),
                ],
              });
            }
          } catch {
            // Message might have been deleted
          }
        }, 3000);
      } catch {
        // Message might have been deleted
      }
      return;
    }

    // Don't allow permitting bots
    if (mentionedUser.bot) {
      try {
        const controlMessage = await voiceChannel.messages.fetch(waitingState.messageId);
        await controlMessage.edit({
          embeds: [LabControlPanel.createErrorEmbed('You cannot permit bots.')],
          components: [
            LabControlPanel.createMainButtons(lab),
            LabControlPanel.createUserButtons(lab.is_locked),
          ],
        });

        // Revert to normal embed after 3 seconds
        setTimeout(async () => {
          try {
            const currentLab = await labService!.getLabByChannel(voiceChannel.id);
            if (currentLab) {
              const currentPermitList = await labService!.getUserPermitList(currentLab.owner_id, currentLab.guild_id);
              await controlMessage.edit({
                embeds: [LabControlPanel.createEmbed(currentLab, voiceChannel, message.author, currentPermitList)],
                components: [
                  LabControlPanel.createMainButtons(currentLab),
                  LabControlPanel.createUserButtons(currentLab.is_locked),
                ],
              });
            }
          } catch {
            // Message might have been deleted
          }
        }, 3000);
      } catch {
        // Message might have been deleted
      }
      return;
    }

    try {
      // Add to the user's persistent permit list
      await labService.addToUserPermitList(lab.owner_id, lab.guild_id, mentionedUser.id);

      // Also apply the permission to the current channel
      await voiceChannel.permissionOverwrites.create(mentionedUser.id, {
        Connect: true,
        Speak: true,
      });

      // Get updated permit list
      const permitList = await labService.getUserPermitList(lab.owner_id, lab.guild_id);

      // Update the control panel message
      const controlMessage = await voiceChannel.messages.fetch(waitingState.messageId);
      await controlMessage.edit({
        embeds: [LabControlPanel.createSuccessEmbed(`<@${mentionedUser.id}> has been added to your permit list.`)],
        components: [
          LabControlPanel.createMainButtons(lab),
          LabControlPanel.createUserButtons(lab.is_locked),
        ],
      });

      // Announce the permit in the channel
      await announceAction(
        voiceChannel,
        `✅ **${message.author.displayName}** added **${mentionedUser.displayName}** to the permit list.`
      );

      // DM the permitted user
      const guild = message.guild;
      if (guild) {
        await sendActionDM(
          mentionedUser,
          `✅ **${message.author.displayName}** has added you to their permit list for labs in **${guild.name}**. You can now join their locked labs!`
        );
      }

      // Revert to normal embed after 3 seconds
      setTimeout(async () => {
        try {
          const currentLab = await labService!.getLabByChannel(voiceChannel.id);
          if (currentLab) {
            const currentPermitList = await labService!.getUserPermitList(currentLab.owner_id, currentLab.guild_id);
            await controlMessage.edit({
              embeds: [LabControlPanel.createEmbed(currentLab, voiceChannel, message.author, currentPermitList)],
              components: [
                LabControlPanel.createMainButtons(currentLab),
                LabControlPanel.createUserButtons(currentLab.is_locked),
              ],
            });
          }
        } catch {
          // Message might have been deleted
        }
      }, 3000);

      logger.info(`${message.author.username} permitted ${mentionedUser.username} in lab ${lab.name}`);
    } catch (error) {
      logger.error('Failed to permit user:', error);

      try {
        const permitList = await labService.getUserPermitList(lab.owner_id, lab.guild_id);
        const controlMessage = await voiceChannel.messages.fetch(waitingState.messageId);
        await controlMessage.edit({
          embeds: [LabControlPanel.createErrorEmbed('Failed to permit user.')],
          components: [
            LabControlPanel.createMainButtons(lab),
            LabControlPanel.createUserButtons(lab.is_locked),
          ],
        });

        // Revert to normal embed after 3 seconds
        setTimeout(async () => {
          try {
            const currentLab = await labService!.getLabByChannel(voiceChannel.id);
            if (currentLab) {
              const currentPermitList = await labService!.getUserPermitList(currentLab.owner_id, currentLab.guild_id);
              await controlMessage.edit({
                embeds: [LabControlPanel.createEmbed(currentLab, voiceChannel, message.author, currentPermitList)],
                components: [
                  LabControlPanel.createMainButtons(currentLab),
                  LabControlPanel.createUserButtons(currentLab.is_locked),
                ],
              });
            }
          } catch {
            // Message might have been deleted
          }
        }, 3000);
      } catch {
        // Message might have been deleted
      }
    }
  },
};
