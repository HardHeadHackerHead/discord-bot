import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  VoiceBasedChannel,
  GuildMember,
  User,
} from 'discord.js';
import { LabChannel } from '../services/LabService.js';

/**
 * Creates the lab control panel embed and buttons
 */
export class LabControlPanel {
  /**
   * Create the main control panel embed
   * @param lab - The lab channel data
   * @param channel - The Discord voice channel
   * @param owner - The lab owner
   * @param permitList - Array of permitted user IDs (only shown when locked)
   */
  static createEmbed(
    lab: LabChannel,
    channel: VoiceBasedChannel,
    owner: User,
    permitList: string[] = []
  ): EmbedBuilder {
    const memberCount = channel.members.size;
    const userLimit = channel.userLimit === 0 ? 'Unlimited' : channel.userLimit.toString();
    const lockStatus = lab.is_locked ? '🔒 Locked' : '🔓 Unlocked';

    const embed = new EmbedBuilder()
      .setTitle(`🧪 ${lab.name}`)
      .setDescription('Use the buttons below to manage your lab.')
      .setColor(lab.is_locked ? 0xFF6B6B : 0x4ECDC4)
      .addFields(
        { name: 'Owner', value: `<@${owner.id}>`, inline: true },
        { name: 'Status', value: lockStatus, inline: true },
        { name: 'Members', value: `${memberCount}/${userLimit}`, inline: true },
      )
      .setFooter({ text: 'Your lab will be deleted when everyone leaves' })
      .setTimestamp();

    // Show permit list when locked
    if (lab.is_locked && permitList.length > 0) {
      const permitListStr = permitList.map(id => `<@${id}>`).join(', ');
      embed.addFields({
        name: '✅ Permitted Users',
        value: permitListStr,
        inline: false,
      });
    }

    return embed;
  }

  /**
   * Create the main control buttons (row 1)
   */
  static createMainButtons(lab: LabChannel): ActionRowBuilder<ButtonBuilder> {
    const lockButton = new ButtonBuilder()
      .setCustomId('lab:lock')
      .setLabel(lab.is_locked ? 'Unlock' : 'Lock')
      .setEmoji(lab.is_locked ? '🔓' : '🔒')
      .setStyle(lab.is_locked ? ButtonStyle.Success : ButtonStyle.Danger);

    const renameButton = new ButtonBuilder()
      .setCustomId('lab:rename')
      .setLabel('Rename')
      .setEmoji('✏️')
      .setStyle(ButtonStyle.Secondary);

    const limitButton = new ButtonBuilder()
      .setCustomId('lab:limit')
      .setLabel('Set Limit')
      .setEmoji('👥')
      .setStyle(ButtonStyle.Secondary);

    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      lockButton,
      renameButton,
      limitButton,
    );
  }

  /**
   * Create the user management buttons (row 2)
   * @param isLocked - Whether the lab is locked (permit button only shows when locked)
   */
  static createUserButtons(isLocked: boolean = false): ActionRowBuilder<ButtonBuilder> {
    const buttons: ButtonBuilder[] = [];

    // Only show permit button when lab is locked
    if (isLocked) {
      const permitButton = new ButtonBuilder()
        .setCustomId('lab:permit')
        .setLabel('Permit User')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success);
      buttons.push(permitButton);
    }

    const kickButton = new ButtonBuilder()
      .setCustomId('lab:kick')
      .setLabel('Kick User')
      .setEmoji('👢')
      .setStyle(ButtonStyle.Danger);
    buttons.push(kickButton);

    const transferButton = new ButtonBuilder()
      .setCustomId('lab:transfer')
      .setLabel('Transfer Ownership')
      .setEmoji('👑')
      .setStyle(ButtonStyle.Primary);
    buttons.push(transferButton);

    return new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);
  }

  /**
   * Create a user select menu for kick/permit/transfer actions
   */
  static createUserSelectMenu(
    action: 'kick' | 'permit' | 'transfer',
    members: GuildMember[],
    ownerId: string
  ): ActionRowBuilder<StringSelectMenuBuilder> {
    const actionLabels = {
      kick: 'Select a user to kick',
      permit: 'Select a user to permit',
      transfer: 'Select new owner',
    };

    const options = members
      .filter(member => !member.user.bot && member.id !== ownerId)
      .slice(0, 25) // Discord limit
      .map(member =>
        new StringSelectMenuOptionBuilder()
          .setLabel(member.displayName)
          .setDescription(`@${member.user.username}`)
          .setValue(member.id)
      );

    if (options.length === 0) {
      options.push(
        new StringSelectMenuOptionBuilder()
          .setLabel('No users available')
          .setValue('none')
          .setDefault(true)
      );
    }

    const select = new StringSelectMenuBuilder()
      .setCustomId(`lab:${action}:select`)
      .setPlaceholder(actionLabels[action])
      .addOptions(options);

    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
  }

  /**
   * Create user limit selection menu
   */
  static createLimitSelectMenu(): ActionRowBuilder<StringSelectMenuBuilder> {
    const options = [
      { label: 'No Limit', value: '0', description: 'Anyone can join (unlimited)' },
      { label: '2 Users', value: '2', description: 'Limit to 2 users' },
      { label: '3 Users', value: '3', description: 'Limit to 3 users' },
      { label: '4 Users', value: '4', description: 'Limit to 4 users' },
      { label: '5 Users', value: '5', description: 'Limit to 5 users' },
      { label: '6 Users', value: '6', description: 'Limit to 6 users' },
      { label: '8 Users', value: '8', description: 'Limit to 8 users' },
      { label: '10 Users', value: '10', description: 'Limit to 10 users' },
      { label: '15 Users', value: '15', description: 'Limit to 15 users' },
      { label: '20 Users', value: '20', description: 'Limit to 20 users' },
    ];

    const select = new StringSelectMenuBuilder()
      .setCustomId('lab:limit:select')
      .setPlaceholder('Select user limit')
      .addOptions(options.map(opt =>
        new StringSelectMenuOptionBuilder()
          .setLabel(opt.label)
          .setValue(opt.value)
          .setDescription(opt.description)
      ));

    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
  }

  /**
   * Create a cancel button row
   */
  static createCancelButton(): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('lab:cancel')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
    );
  }

  /**
   * Create a confirmation embed for actions
   */
  static createConfirmEmbed(
    action: string,
    description: string,
    color: number = 0x5865F2
  ): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle(action)
      .setDescription(description)
      .setColor(color)
      .setTimestamp();
  }

  /**
   * Create success embed
   */
  static createSuccessEmbed(message: string): EmbedBuilder {
    return new EmbedBuilder()
      .setDescription(`✅ ${message}`)
      .setColor(0x57F287);
  }

  /**
   * Create error embed
   */
  static createErrorEmbed(message: string): EmbedBuilder {
    return new EmbedBuilder()
      .setDescription(`❌ ${message}`)
      .setColor(0xED4245);
  }

  /**
   * Create the permit user waiting embed
   */
  static createPermitWaitingEmbed(): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle('✅ Permit User')
      .setDescription(
        '**Mention the user you want to permit** in your next message.\n\n' +
        'Example: `@username`\n\n' +
        '*This will timeout in 60 seconds.*'
      )
      .setColor(0x57F287);
  }
}
