import { VoiceState, ChannelType, VoiceChannel, GuildMember } from 'discord.js';
import { AnyModuleEvent } from '../../../types/event.types.js';
import { LabService, LabChannel } from '../services/LabService.js';
import { LabControlPanel } from '../components/LabControlPanel.js';
import { Logger } from '../../../shared/utils/logger.js';
import { getPollsService } from '../../polls/index.js';

const logger = new Logger('DynamicLab:VoiceState');

// Store the service instance (will be set by module)
let labService: LabService | null = null;

export function setLabService(service: LabService): void {
  labService = service;
}

export const voiceStateUpdateEvent: AnyModuleEvent = {
  name: 'voiceStateUpdate',
  once: false,

  async execute(...args: unknown[]): Promise<void> {
    const [oldState, newState] = args as [VoiceState, VoiceState];
    if (!labService) {
      logger.warn('LabService not initialized');
      return;
    }

    const member = newState.member || oldState.member;
    if (!member || member.user.bot) return;

    const guild = newState.guild;

    // Handle channel join
    if (newState.channelId && newState.channelId !== oldState.channelId) {
      await handleChannelJoin(newState, labService);
    }

    // Handle channel leave (cleanup empty labs)
    if (oldState.channelId && oldState.channelId !== newState.channelId) {
      await handleChannelLeave(oldState, labService);
    }
  },
};

/**
 * Handle a user joining a voice channel
 */
async function handleChannelJoin(state: VoiceState, service: LabService): Promise<void> {
  const { channel, member, guild } = state;
  if (!channel || !member) return;

  // Check if this is a creator channel
  const creator = await service.getCreatorByChannel(channel.id);
  if (!creator) return;

  logger.debug(`${member.user.username} joined creator channel in ${guild.name}`);

  // Check if user already has a lab in this guild
  const existingLab = await service.getUserLab(member.id, guild.id);
  if (existingLab) {
    // Move them to their existing lab
    const existingChannel = guild.channels.cache.get(existingLab.channel_id);
    if (existingChannel && existingChannel.type === ChannelType.GuildVoice) {
      try {
        await member.voice.setChannel(existingChannel as VoiceChannel);
        logger.debug(`Moved ${member.user.username} to existing lab`);
      } catch (error) {
        logger.error('Failed to move member to existing lab:', error);
      }
      return;
    } else {
      // Lab channel was deleted, clean up database
      await service.deleteLab(existingLab.channel_id, guild);
    }
  }

  // Create a new lab for the user
  const result = await service.createLab(guild, member, creator);
  if (!result) {
    logger.error(`Failed to create lab for ${member.user.username}`);
    return;
  }

  const { channel: labChannel, lab } = result;

  // If the lab is locked by default (from user settings), apply the permit list
  if (lab.is_locked) {
    await service.applyPermitListToChannel(member.id, guild.id, labChannel);
  }

  // Move the user to their new lab
  try {
    await member.voice.setChannel(labChannel);
  } catch (error) {
    logger.error('Failed to move member to new lab:', error);
    // Clean up the channel we just created
    await service.deleteLab(labChannel.id, guild);
    return;
  }

  // Add flask emoji prefix to owner's nickname
  await service.addFlaskToNickname(member);

  // Send the control panel
  await sendControlPanel(labChannel, lab, service);
}

/**
 * Send the control panel message to the lab channel
 */
async function sendControlPanel(
  channel: VoiceChannel,
  lab: ReturnType<typeof Object.assign> & { id: string; owner_id: string; guild_id: string; name: string; is_locked: boolean },
  service: LabService
): Promise<void> {
  try {
    const owner = await channel.guild.members.fetch(lab.owner_id);
    const permitList = await service.getUserPermitList(lab.owner_id, lab.guild_id);

    const embed = LabControlPanel.createEmbed(lab, channel, owner.user, permitList);
    const mainButtons = LabControlPanel.createMainButtons(lab);
    const userButtons = LabControlPanel.createUserButtons(lab.is_locked);

    const message = await channel.send({
      embeds: [embed],
      components: [mainButtons, userButtons],
    });

    // Save the control message ID
    await service.setControlMessage(lab.id, message.id);

    logger.debug(`Sent control panel to lab ${lab.name}`);
  } catch (error) {
    logger.error('Failed to send control panel:', error);
  }
}

/**
 * Handle a user leaving a voice channel
 */
async function handleChannelLeave(state: VoiceState, service: LabService): Promise<void> {
  const { channel, guild, member } = state;
  if (!channel || !member) return;

  // Check if this was a lab channel
  const lab = await service.getLabByChannel(channel.id);
  if (!lab) return;

  // Check if the channel is now empty
  const voiceChannel = guild.channels.cache.get(channel.id);
  if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
    // Channel doesn't exist anymore, clean up database
    await service.checkAndCleanupLab(channel.id, guild);
    return;
  }

  const vc = voiceChannel as VoiceChannel;

  if (vc.members.size === 0) {
    // Lab is empty, delete it
    logger.debug(`Lab ${lab.name} is empty, deleting...`);
    await service.deleteLab(channel.id, guild);
  } else {
    // Check if the owner just left
    const isOwnerLeaving = member.id === lab.owner_id;

    if (isOwnerLeaving) {
      // Owner is leaving but there are still members in the channel
      logger.info(`Lab owner ${member.user.username} left lab with ${vc.members.size} members remaining`);

      // Remove flask from the leaving owner
      await service.removeFlaskFromNickname(member);

      // Remove owner's special permissions from the channel
      try {
        await vc.permissionOverwrites.delete(member.id);
      } catch (error) {
        logger.debug('Could not remove owner permissions:', error);
      }

      // Get remaining non-bot members
      const eligibleMembers = vc.members.filter(m => !m.user.bot);

      if (eligibleMembers.size === 1) {
        // Only one person left, they automatically become the owner
        const newOwner = eligibleMembers.first()!;
        await handleOwnershipTransfer(vc, lab, newOwner, service);
      } else if (eligibleMembers.size > 1) {
        // Multiple people, start a poll
        await startOwnershipPoll(vc, lab, eligibleMembers, service);
      }
      // If no eligible members (all bots?), the lab will be cleaned up when they leave
    } else {
      // Non-owner left, just update the control panel
      await updateControlPanel(vc, lab, service);
    }
  }
}

/**
 * Transfer lab ownership to a new member
 */
async function handleOwnershipTransfer(
  channel: VoiceChannel,
  lab: LabChannel,
  newOwner: GuildMember,
  service: LabService
): Promise<void> {
  try {
    // Update the database ownership
    await service.transferOwnership(lab.id, newOwner.id);

    // Add flask to new owner's nickname
    await service.addFlaskToNickname(newOwner);

    // Get the creator config for default settings
    const creator = await service.getCreatorForLab(lab.id);
    if (!creator) {
      logger.warn(`No creator found for lab ${lab.id}, using basic transfer`);
      // Fallback: just give permissions without applying full settings
      await channel.permissionOverwrites.create(newOwner.id, {
        ManageChannels: true,
        MoveMembers: true,
        MuteMembers: true,
        DeafenMembers: true,
        Connect: true,
        Speak: true,
      });
    } else {
      // Apply the new owner's full settings (name, lock state, permit list, etc.)
      await service.applyNewOwnerSettings(lab, channel, newOwner, creator);
    }

    // Update the lab record
    const updatedLab = await service.getLabByChannel(channel.id);
    if (updatedLab) {
      // Update control panel
      await updateControlPanel(channel, updatedLab, service);

      // Send a message about the transfer
      try {
        await channel.send({
          content: `🧪 **${newOwner.displayName}** is now the lab owner!`,
        });
      } catch (error) {
        logger.debug('Could not send ownership transfer message:', error);
      }
    }

    logger.info(`Lab ownership transferred to ${newOwner.user.username}`);
  } catch (error) {
    logger.error('Failed to transfer lab ownership:', error);
  }
}

/**
 * Start a poll to determine the new lab owner
 */
async function startOwnershipPoll(
  channel: VoiceChannel,
  lab: LabChannel,
  eligibleMembers: Map<string, GuildMember>,
  service: LabService
): Promise<void> {
  const pollsService = getPollsService();
  const membersArray = Array.from(eligibleMembers.values());

  const fallbackToFirst = async () => {
    const firstMember = membersArray[0];
    if (firstMember) {
      await handleOwnershipTransfer(channel, lab, firstMember, service);
    }
  };

  if (!pollsService) {
    // Polls module not loaded, just pick the first member
    logger.warn('Polls module not available, selecting first member as owner');
    await fallbackToFirst();
    return;
  }

  try {
    // Create the ownership poll
    const result = await pollsService.createLabOwnershipPoll(
      channel.guild,
      channel,
      lab.owner_id,
      membersArray
    );

    if (!result) {
      // Poll creation failed, pick the first member
      logger.warn('Failed to create ownership poll, selecting first member');
      await fallbackToFirst();
      return;
    }

    logger.info(`Started lab ownership poll in ${channel.name}`);

    // The poll module will emit an event when the poll ends
    // We need to subscribe to that event to handle the result
  } catch (error) {
    logger.error('Error starting ownership poll:', error);
    // Fallback: pick first member
    await fallbackToFirst();
  }
}

/**
 * Update the control panel message
 */
async function updateControlPanel(
  channel: VoiceChannel,
  lab: ReturnType<typeof Object.assign> & { id: string; owner_id: string; guild_id: string; name: string; is_locked: boolean; control_message_id: string | null },
  service: LabService
): Promise<void> {
  if (!lab.control_message_id) return;

  try {
    const message = await channel.messages.fetch(lab.control_message_id);
    const owner = await channel.guild.members.fetch(lab.owner_id);
    const permitList = await service.getUserPermitList(lab.owner_id, lab.guild_id);

    const embed = LabControlPanel.createEmbed(lab, channel, owner.user, permitList);
    const mainButtons = LabControlPanel.createMainButtons(lab);
    const userButtons = LabControlPanel.createUserButtons(lab.is_locked);

    await message.edit({
      embeds: [embed],
      components: [mainButtons, userButtons],
    });
  } catch (error) {
    // Message might have been deleted, that's okay
    logger.debug('Could not update control panel:', error);
  }
}
