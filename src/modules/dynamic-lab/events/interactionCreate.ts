import {
  Interaction,
  ButtonInteraction,
  StringSelectMenuInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ModalActionRowComponentBuilder,
  ChannelType,
  VoiceChannel,
  GuildMember,
  User,
} from 'discord.js';
import { AnyModuleEvent } from '../../../types/event.types.js';
import { LabService, LabChannel } from '../services/LabService.js';
import { LabControlPanel } from '../components/LabControlPanel.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('DynamicLab:Interaction');

/**
 * Send an announcement message to the voice channel's text chat
 */
async function announceAction(
  channel: VoiceChannel,
  message: string
): Promise<void> {
  try {
    logger.debug(`Attempting to send announcement to channel ${channel.id}: "${message}"`);
    await channel.send({ content: message });
    logger.debug('Announcement sent successfully');
  } catch (error) {
    logger.error('Could not send announcement to channel:', error);
  }
}

/**
 * Send a DM to a user about a lab action
 */
async function sendActionDM(
  user: User | GuildMember,
  message: string
): Promise<boolean> {
  try {
    const targetUser = user instanceof GuildMember ? user.user : user;
    logger.debug(`Attempting to send DM to ${targetUser.username}: "${message}"`);
    await targetUser.send({ content: message });
    logger.debug('DM sent successfully');
    return true;
  } catch (error) {
    logger.error(`Could not send DM to ${user instanceof GuildMember ? user.user.username : user.username}:`, error);
    return false;
  }
}

let labService: LabService | null = null;

// Track users who are in the permit waiting state
const permitWaitingUsers: Map<string, { labId: string; channelId: string; messageId: string }> = new Map();

export function setLabService(service: LabService): void {
  labService = service;
}

/**
 * Get the permit waiting state for a user
 */
export function getPermitWaitingState(userId: string) {
  return permitWaitingUsers.get(userId);
}

/**
 * Clear the permit waiting state for a user
 */
export function clearPermitWaitingState(userId: string) {
  permitWaitingUsers.delete(userId);
}

export const interactionCreateEvent: AnyModuleEvent = {
  name: 'interactionCreate',
  once: false,

  async execute(...args: unknown[]): Promise<void> {
    const interaction = args[0] as Interaction;
    if (!labService) return;

    // Handle button interactions
    if (interaction.isButton() && interaction.customId.startsWith('lab:')) {
      await handleButton(interaction, labService);
      return;
    }

    // Handle select menu interactions
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('lab:')) {
      await handleSelectMenu(interaction, labService);
      return;
    }

    // Handle modal submissions
    if (interaction.isModalSubmit() && interaction.customId.startsWith('lab:')) {
      await handleModal(interaction, labService);
      return;
    }
  },
};

/**
 * Handle button interactions
 */
async function handleButton(interaction: ButtonInteraction, service: LabService): Promise<void> {
  const [, action] = interaction.customId.split(':');

  // Get the lab for this channel
  const channel = interaction.channel;
  if (!channel || channel.type !== ChannelType.GuildVoice) {
    await interaction.reply({
      embeds: [LabControlPanel.createErrorEmbed('This can only be used in a lab channel.')],
      ephemeral: true,
    });
    return;
  }

  const lab = await service.getLabByChannel(channel.id);
  if (!lab) {
    await interaction.reply({
      embeds: [LabControlPanel.createErrorEmbed('This channel is not a lab.')],
      ephemeral: true,
    });
    return;
  }

  // Check if user is the owner
  if (interaction.user.id !== lab.owner_id) {
    await interaction.reply({
      embeds: [LabControlPanel.createErrorEmbed('Only the lab owner can use these controls.')],
      ephemeral: true,
    });
    return;
  }

  const voiceChannel = channel as VoiceChannel;

  switch (action) {
    case 'lock':
      await handleLock(interaction, lab, voiceChannel, service);
      break;

    case 'rename':
      await showRenameModal(interaction);
      break;

    case 'limit':
      await showLimitMenu(interaction);
      break;

    case 'permit':
      await handlePermitButton(interaction, lab, voiceChannel, service);
      break;

    case 'kick':
      await showKickMenu(interaction, voiceChannel, lab);
      break;

    case 'transfer':
      await showUserMenu(interaction, voiceChannel, lab, 'transfer');
      break;

    case 'cancel':
      // Clear any pending permit state
      clearPermitWaitingState(interaction.user.id);
      const permitList = await service.getUserPermitList(lab.owner_id, lab.guild_id);
      await interaction.update({
        embeds: [LabControlPanel.createEmbed(lab, voiceChannel, interaction.user, permitList)],
        components: [
          LabControlPanel.createMainButtons(lab),
          LabControlPanel.createUserButtons(lab.is_locked),
        ],
      });
      break;
  }
}

/**
 * Handle permit button - show message waiting for user mention
 */
async function handlePermitButton(
  interaction: ButtonInteraction,
  lab: LabChannel,
  channel: VoiceChannel,
  service: LabService
): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  // Update the message to show the permit waiting state
  await interaction.update({
    embeds: [LabControlPanel.createPermitWaitingEmbed()],
    components: [LabControlPanel.createCancelButton()],
  });

  // Store the waiting state
  permitWaitingUsers.set(interaction.user.id, {
    labId: lab.id,
    channelId: channel.id,
    messageId: interaction.message.id,
  });

  // Set a timeout to cancel the waiting state
  setTimeout(async () => {
    const state = permitWaitingUsers.get(interaction.user.id);
    if (state && state.labId === lab.id) {
      permitWaitingUsers.delete(interaction.user.id);

      // Try to update the message back to normal
      try {
        const currentLab = await service.getLabByChannel(channel.id);
        if (currentLab) {
          const currentPermitList = await service.getUserPermitList(currentLab.owner_id, currentLab.guild_id);
          const message = await channel.messages.fetch(state.messageId);
          const owner = await guild.members.fetch(currentLab.owner_id);
          await message.edit({
            embeds: [LabControlPanel.createEmbed(currentLab, channel, owner.user, currentPermitList)],
            components: [
              LabControlPanel.createMainButtons(currentLab),
              LabControlPanel.createUserButtons(currentLab.is_locked),
            ],
          });
        }
      } catch {
        // Message might have been deleted or we lost permissions
      }
    }
  }, 60000); // 60 second timeout
}

/**
 * Handle lock/unlock button
 */
async function handleLock(
  interaction: ButtonInteraction,
  lab: LabChannel,
  channel: VoiceChannel,
  service: LabService
): Promise<void> {
  const newLockState = !lab.is_locked;

  await service.updateLabChannel(lab, channel, { isLocked: newLockState });

  // Update the local lab object
  lab.is_locked = newLockState;

  // Get the permit list for display
  const permitList = await service.getUserPermitList(lab.owner_id, lab.guild_id);

  // If locking the channel, apply the permit list permissions
  if (newLockState) {
    await service.applyPermitListToChannel(lab.owner_id, lab.guild_id, channel);
  }

  // Update the control panel
  await interaction.update({
    embeds: [LabControlPanel.createEmbed(lab, channel, interaction.user, permitList)],
    components: [
      LabControlPanel.createMainButtons(lab),
      LabControlPanel.createUserButtons(lab.is_locked),
    ],
  });

  // Announce the action in the channel
  const actionText = newLockState ? '🔒 locked' : '🔓 unlocked';
  await announceAction(channel, `**${interaction.user.displayName}** has ${actionText} the lab.`);

  logger.debug(`Lab ${lab.name} ${newLockState ? 'locked' : 'unlocked'} by ${interaction.user.username}`);
}

/**
 * Show the rename modal
 */
async function showRenameModal(interaction: ButtonInteraction): Promise<void> {
  const modal = new ModalBuilder()
    .setCustomId('lab:rename:modal')
    .setTitle('Rename Your Lab');

  const nameInput = new TextInputBuilder()
    .setCustomId('lab:rename:input')
    .setLabel('New Lab Name')
    .setPlaceholder('Enter a new name for your lab')
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(100)
    .setRequired(true);

  const row = new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(nameInput);
  modal.addComponents(row);

  await interaction.showModal(modal);
}

/**
 * Show the user limit selection menu
 */
async function showLimitMenu(interaction: ButtonInteraction): Promise<void> {
  await interaction.update({
    embeds: [LabControlPanel.createConfirmEmbed('Set User Limit', 'Select the maximum number of users for your lab.')],
    components: [
      LabControlPanel.createLimitSelectMenu(),
      LabControlPanel.createCancelButton(),
    ],
  });
}

/**
 * Show user selection menu for transfer only (permit now uses mention-based flow)
 */
async function showUserMenu(
  interaction: ButtonInteraction,
  channel: VoiceChannel,
  lab: LabChannel,
  action: 'transfer'
): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const members = Array.from(channel.members.values());

  await interaction.update({
    embeds: [LabControlPanel.createConfirmEmbed(
      'Transfer Ownership',
      'Select a member to transfer ownership to.'
    )],
    components: [
      LabControlPanel.createUserSelectMenu(action, members, lab.owner_id),
      LabControlPanel.createCancelButton(),
    ],
  });
}

/**
 * Show kick user menu
 */
async function showKickMenu(
  interaction: ButtonInteraction,
  channel: VoiceChannel,
  lab: LabChannel
): Promise<void> {
  const members = Array.from(channel.members.values());

  await interaction.update({
    embeds: [LabControlPanel.createConfirmEmbed('Kick User', 'Select a user to kick from your lab.')],
    components: [
      LabControlPanel.createUserSelectMenu('kick', members, lab.owner_id),
      LabControlPanel.createCancelButton(),
    ],
  });
}

/**
 * Handle select menu interactions
 */
async function handleSelectMenu(
  interaction: StringSelectMenuInteraction,
  service: LabService
): Promise<void> {
  const [, action] = interaction.customId.split(':');

  const channel = interaction.channel;
  if (!channel || channel.type !== ChannelType.GuildVoice) return;

  const lab = await service.getLabByChannel(channel.id);
  if (!lab || interaction.user.id !== lab.owner_id) return;

  const voiceChannel = channel as VoiceChannel;
  const selectedValue = interaction.values[0];

  // Get permit list for display
  const permitList = await service.getUserPermitList(lab.owner_id, lab.guild_id);

  if (!selectedValue || selectedValue === 'none') {
    await interaction.update({
      embeds: [LabControlPanel.createEmbed(lab, voiceChannel, interaction.user, permitList)],
      components: [
        LabControlPanel.createMainButtons(lab),
        LabControlPanel.createUserButtons(lab.is_locked),
      ],
    });
    return;
  }

  switch (action) {
    case 'limit':
      if (interaction.guildId) {
        await handleLimitSelect(interaction, lab, voiceChannel, service, selectedValue);
      }
      break;

    case 'kick':
      await handleKickSelect(interaction, lab, voiceChannel, service, selectedValue);
      break;

    case 'transfer':
      await handleTransferSelect(interaction, lab, voiceChannel, service, selectedValue);
      break;
  }
}

/**
 * Handle user limit selection
 */
async function handleLimitSelect(
  interaction: StringSelectMenuInteraction,
  lab: LabChannel,
  channel: VoiceChannel,
  service: LabService,
  value: string
): Promise<void> {
  const limit = parseInt(value, 10);

  await service.updateLabChannel(lab, channel, { userLimit: limit });

  // Also save to user settings
  await service.updateUserSettings(interaction.user.id, interaction.guildId!, {
    user_limit: limit,
  });

  const permitList = await service.getUserPermitList(lab.owner_id, lab.guild_id);

  await interaction.update({
    embeds: [LabControlPanel.createEmbed(lab, channel, interaction.user, permitList)],
    components: [
      LabControlPanel.createMainButtons(lab),
      LabControlPanel.createUserButtons(lab.is_locked),
    ],
  });

  // Announce the limit change in the channel
  const limitText = limit === 0 ? 'unlimited' : `${limit} users`;
  await announceAction(
    channel,
    `👥 **${interaction.user.displayName}** set the user limit to **${limitText}**.`
  );
}

/**
 * Handle kick user selection
 */
async function handleKickSelect(
  interaction: StringSelectMenuInteraction,
  lab: LabChannel,
  channel: VoiceChannel,
  service: LabService,
  userId: string
): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  try {
    const member = await guild.members.fetch(userId);
    const memberDisplayName = member.displayName;
    const success = await service.kickUser(member, channel);

    if (success) {
      await interaction.update({
        embeds: [LabControlPanel.createSuccessEmbed(`Kicked <@${userId}> from your lab.`)],
        components: [
          LabControlPanel.createMainButtons(lab),
          LabControlPanel.createUserButtons(lab.is_locked),
        ],
      });

      // Announce the kick in the channel
      logger.info(`Announcing kick in channel ${channel.id}`);
      await announceAction(
        channel,
        `👢 **${memberDisplayName}** was kicked from the lab by **${interaction.user.displayName}**.`
      );

      // DM the kicked user
      logger.info(`Sending kick DM to user ${member.user.username}`);
      const dmSent = await sendActionDM(
        member,
        `👢 You were kicked from **${lab.name}** in **${guild.name}** by **${interaction.user.displayName}**.`
      );
      logger.info(`DM sent result: ${dmSent}`);
    } else {
      await interaction.update({
        embeds: [LabControlPanel.createErrorEmbed('Failed to kick user. They may have already left.')],
        components: [
          LabControlPanel.createMainButtons(lab),
          LabControlPanel.createUserButtons(lab.is_locked),
        ],
      });
    }
  } catch (error) {
    logger.error('Failed to kick user:', error);
    await interaction.update({
      embeds: [LabControlPanel.createErrorEmbed('Failed to kick user.')],
      components: [
        LabControlPanel.createMainButtons(lab),
        LabControlPanel.createUserButtons(lab.is_locked),
      ],
    });
  }
}

/**
 * Handle transfer ownership selection
 */
async function handleTransferSelect(
  interaction: StringSelectMenuInteraction,
  lab: LabChannel,
  channel: VoiceChannel,
  service: LabService,
  userId: string
): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  try {
    const newOwner = await guild.members.fetch(userId);
    const previousOwner = await guild.members.fetch(interaction.user.id);
    const previousOwnerName = interaction.user.displayName;

    // Transfer ownership in database
    await service.transferOwnership(lab.id, userId);

    // Remove flask emoji from previous owner
    await service.removeFlaskFromNickname(previousOwner);

    // Add flask emoji to new owner
    await service.addFlaskToNickname(newOwner);

    // Remove old owner's special permissions from the channel
    try {
      await channel.permissionOverwrites.delete(interaction.user.id);
    } catch (error) {
      logger.debug('Could not remove old owner permissions:', error);
    }

    // Get the creator config for default settings and apply full new owner settings
    const creator = await service.getCreatorForLab(lab.id);
    if (!creator) {
      logger.warn(`No creator found for lab ${lab.id}, using basic transfer`);
      // Fallback: just give permissions without applying full settings
      await channel.permissionOverwrites.create(userId, {
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

    // Get updated lab info
    const updatedLab = await service.getLabByChannel(channel.id);
    if (updatedLab) {
      // Update lab object for UI
      lab.owner_id = updatedLab.owner_id;
      lab.name = updatedLab.name;
      lab.is_locked = updatedLab.is_locked;
    }

    // Get updated permit list for UI
    const permitList = await service.getUserPermitList(userId, guild.id);

    await interaction.update({
      embeds: [LabControlPanel.createEmbed(updatedLab || lab, channel, newOwner.user, permitList)],
      components: [
        LabControlPanel.createMainButtons(updatedLab || lab),
        LabControlPanel.createUserButtons((updatedLab || lab).is_locked),
      ],
    });

    // Announce the transfer in the channel
    await announceAction(
      channel,
      `🔄 **${previousOwnerName}** transferred lab ownership to **${newOwner.displayName}**.`
    );

    // DM the new owner
    await sendActionDM(
      newOwner,
      `🧪 **${previousOwnerName}** has transferred ownership of the lab **${lab.name}** to you in **${guild.name}**!`
    );

    logger.info(`Lab ${lab.name} transferred from ${interaction.user.username} to ${newOwner.user.username}`);
  } catch (error) {
    logger.error('Failed to transfer ownership:', error);
    await interaction.update({
      embeds: [LabControlPanel.createErrorEmbed('Failed to transfer ownership.')],
      components: [
        LabControlPanel.createMainButtons(lab),
        LabControlPanel.createUserButtons(lab.is_locked),
      ],
    });
  }
}

/**
 * Handle modal submissions
 */
async function handleModal(
  interaction: Interaction,
  service: LabService
): Promise<void> {
  if (!interaction.isModalSubmit()) return;

  const [, action] = interaction.customId.split(':');

  if (action === 'rename') {
    await handleRenameModal(interaction, service);
  }
}

/**
 * Handle rename modal submission
 */
async function handleRenameModal(
  interaction: Interaction,
  service: LabService
): Promise<void> {
  if (!interaction.isModalSubmit()) return;

  const channel = interaction.channel;
  if (!channel || channel.type !== ChannelType.GuildVoice) {
    await interaction.reply({
      embeds: [LabControlPanel.createErrorEmbed('This can only be used in a lab channel.')],
      ephemeral: true,
    });
    return;
  }

  const lab = await service.getLabByChannel(channel.id);
  if (!lab || interaction.user.id !== lab.owner_id) {
    await interaction.reply({
      embeds: [LabControlPanel.createErrorEmbed('You are not the owner of this lab.')],
      ephemeral: true,
    });
    return;
  }

  if (!interaction.guildId) return;

  const newName = interaction.fields.getTextInputValue('lab:rename:input');
  const oldName = lab.name;
  const voiceChannel = channel as VoiceChannel;

  try {
    const result = await service.updateLabChannel(lab, voiceChannel, { name: newName });

    // Also save to user settings
    await service.updateUserSettings(interaction.user.id, interaction.guildId, {
      lab_name: newName,
    });

    lab.name = newName;

    // If name change was queued due to rate limit, let the user know
    if (result.nameChangeQueued) {
      await interaction.reply({
        embeds: [LabControlPanel.createSuccessEmbed(`Lab will be renamed to "${newName}" shortly (rate limit in effect).`)],
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        embeds: [LabControlPanel.createSuccessEmbed(`Lab renamed to "${newName}".`)],
        ephemeral: true,
      });
    }

    // Announce the rename in the channel
    await announceAction(
      voiceChannel,
      `✏️ **${interaction.user.displayName}** renamed the lab from "${oldName}" to "${newName}".`
    );

    // Update the control panel
    if (lab.control_message_id) {
      try {
        const permitList = await service.getUserPermitList(lab.owner_id, lab.guild_id);
        const message = await voiceChannel.messages.fetch(lab.control_message_id);
        await message.edit({
          embeds: [LabControlPanel.createEmbed(lab, voiceChannel, interaction.user, permitList)],
          components: [
            LabControlPanel.createMainButtons(lab),
            LabControlPanel.createUserButtons(lab.is_locked),
          ],
        });
      } catch {
        // Message might not exist
      }
    }
  } catch (error) {
    logger.error('Failed to rename lab:', error);
    await interaction.reply({
      embeds: [LabControlPanel.createErrorEmbed('Failed to rename lab.')],
      ephemeral: true,
    });
  }
}
