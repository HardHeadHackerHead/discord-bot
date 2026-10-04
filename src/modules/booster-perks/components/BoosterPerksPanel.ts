import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { COLORS } from '../../../shared/utils/embed.js';
import { BoosterAsset, AssetType } from '../services/BoosterPerksService.js';

const ASSET_LABELS: Record<AssetType, { singular: string; plural: string; icon: string }> = {
  sound: { singular: 'Sound', plural: 'Sounds', icon: '🔊' },
  emoji: { singular: 'Emoji', plural: 'Emojis', icon: '😀' },
};

export class BoosterPerksPanel {
  // ==================== Promo Embed (non-boosters) ====================

  static createPromoEmbed(serverName: string): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle('🚀 Server Booster Perks')
      .setDescription(
        `Boost **${serverName}** to unlock exclusive perks!\n\n` +
        'Here\'s what you get as a Server Booster:'
      )
      .addFields(
        {
          name: '🔊 Custom Soundboard Sounds',
          value: 'Upload your own sounds to the server soundboard. Bring your favorite sound effects!',
          inline: false,
        },
        {
          name: '😀 Custom Emojis',
          value: 'Add your own custom emojis to the server for everyone to use.',
          inline: false,
        },
      )
      .setFooter({ text: 'Boost the server and use /booster to get started!' })
      .setColor(0xF47FFF); // Nitro pink
  }

  // ==================== Overview (boosters) ====================

  static createOverviewEmbed(
    soundCount: number,
    maxSounds: number,
    emojiCount: number,
    maxEmojis: number,
    username: string,
  ): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle(`🚀 ${username}'s Booster Perks`)
      .setDescription('Thanks for boosting! Manage your perks below.')
      .addFields(
        {
          name: `${ASSET_LABELS.sound.icon} Soundboard Sounds`,
          value: `**${soundCount}/${maxSounds}** slots used`,
          inline: true,
        },
        {
          name: `${ASSET_LABELS.emoji.icon} Custom Emojis`,
          value: `**${emojiCount}/${maxEmojis}** slots used`,
          inline: true,
        },
      )
      .setColor(0xF47FFF);
  }

  static createOverviewComponents(): ActionRowBuilder<ButtonBuilder>[] {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('boosterperks:view:sound')
          .setLabel('Manage Sounds')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('boosterperks:view:emoji')
          .setLabel('Manage Emojis')
          .setStyle(ButtonStyle.Primary),
      ),
    ];
  }

  // ==================== Asset List ====================

  static createAssetListEmbed(
    assets: BoosterAsset[],
    type: AssetType,
    max: number,
  ): EmbedBuilder {
    const label = ASSET_LABELS[type];
    const embed = new EmbedBuilder()
      .setTitle(`${label.icon} Your ${label.plural}`)
      .setColor(COLORS.primary)
      .setFooter({ text: `${assets.length}/${max} slots used` });

    if (assets.length === 0) {
      embed.setDescription(
        `You have no custom ${label.plural.toLowerCase()} yet!\n\n` +
        `Click **Upload ${label.singular}** below to add one.`
      );
    } else {
      const list = assets.map((a, i) => {
        const timestamp = Math.floor(a.created_at.getTime() / 1000);
        return `**${i + 1}.** \`${a.asset_name}\` - <t:${timestamp}:R>`;
      }).join('\n');
      embed.setDescription(list);
    }

    return embed;
  }

  static createAssetListComponents(
    assets: BoosterAsset[],
    type: AssetType,
    max: number,
  ): ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] {
    const label = ASSET_LABELS[type];
    const components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];

    // Delete select menu (only if assets exist)
    if (assets.length > 0) {
      const select = new StringSelectMenuBuilder()
        .setCustomId(`boosterperks:select_delete:${type}`)
        .setPlaceholder(`Select a ${label.singular.toLowerCase()} to delete...`)
        .addOptions(
          assets.map(a =>
            new StringSelectMenuOptionBuilder()
              .setLabel(a.asset_name)
              .setDescription(`Created ${new Date(a.created_at).toLocaleDateString()}`)
              .setValue(a.id)
          )
        );

      components.push(
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)
      );
    }

    // Action buttons
    const canUpload = assets.length < max;
    const buttons = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`boosterperks:upload:${type}`)
          .setLabel(`Upload ${label.singular}`)
          .setStyle(ButtonStyle.Success)
          .setDisabled(!canUpload),
        new ButtonBuilder()
          .setCustomId('boosterperks:back')
          .setLabel('Back')
          .setStyle(ButtonStyle.Secondary),
      );

    components.push(buttons);
    return components;
  }

  // ==================== Result Embeds ====================

  static createUploadSuccessEmbed(type: AssetType, name: string, remaining: number): EmbedBuilder {
    const label = ASSET_LABELS[type];
    return new EmbedBuilder()
      .setTitle(`${label.singular} Uploaded!`)
      .setDescription(
        `Successfully created ${label.singular.toLowerCase()} **${name}**!\n\n` +
        `You have **${remaining}** slot(s) remaining.`
      )
      .setColor(COLORS.success);
  }

  static createDeleteSuccessEmbed(type: AssetType, name: string): EmbedBuilder {
    const label = ASSET_LABELS[type];
    return new EmbedBuilder()
      .setTitle(`${label.singular} Deleted`)
      .setDescription(`Removed ${label.singular.toLowerCase()} **${name}**.`)
      .setColor(COLORS.success);
  }

  static createErrorEmbed(title: string, description: string): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor(COLORS.error);
  }

  // ==================== Confirm Delete ====================

  static createConfirmDeleteEmbed(asset: BoosterAsset): EmbedBuilder {
    const label = ASSET_LABELS[asset.asset_type];
    return new EmbedBuilder()
      .setTitle('Confirm Delete')
      .setDescription(
        `Are you sure you want to delete ${label.singular.toLowerCase()} **${asset.asset_name}**?\n\n` +
        `This will remove it from the server.`
      )
      .setColor(COLORS.warning);
  }

  static createConfirmDeleteComponents(assetId: string, type: AssetType): ActionRowBuilder<ButtonBuilder>[] {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`boosterperks:confirm_delete:${type}:${assetId}`)
          .setLabel('Delete')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`boosterperks:cancel_delete:${type}`)
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary),
      ),
    ];
  }

  // ==================== Cleanup (admin) ====================

  static readonly CLEANUP_MAX_OPTIONS = 25;

  static createCleanupEmbed(
    groups: { userId: string; label: string; inGuild: boolean; assets: BoosterAsset[] }[],
    truncated: boolean,
  ): EmbedBuilder {
    const totalSounds = groups.reduce((sum, g) => sum + g.assets.length, 0);
    const embed = new EmbedBuilder()
      .setTitle('🧹 Booster Sound Cleanup')
      .setColor(COLORS.warning)
      .setFooter({
        text: `${groups.length} former booster(s) • ${totalSounds} sound(s) total`,
      });

    const lines = groups.map((g) => {
      const names = g.assets.map((a) => `\`${a.asset_name}\``).join(', ');
      const who = g.inGuild ? `<@${g.userId}>` : `${g.label} \`(${g.userId})\``;
      return `**${who}** — ${g.assets.length} sound(s): ${names}`;
    });

    embed.setDescription(
      'These soundboard sounds belong to members who are **no longer boosting** the server.\n\n' +
      lines.join('\n') +
      (truncated
        ? `\n\n⚠️ Only the first ${BoosterPerksPanel.CLEANUP_MAX_OPTIONS} people are shown. Run the command again after cleaning these up to see the rest.`
        : '') +
      '\n\nSelect the people whose sounds you want to delete. Anyone you leave unselected is spared.'
    );

    return embed;
  }

  static createCleanupComponents(
    groups: { userId: string; label: string; assets: BoosterAsset[] }[],
  ): ActionRowBuilder<StringSelectMenuBuilder>[] {
    const options = groups.slice(0, BoosterPerksPanel.CLEANUP_MAX_OPTIONS).map((g) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(g.label.slice(0, 100))
        .setDescription(`${g.assets.length} sound(s) • ${g.userId}`.slice(0, 100))
        .setValue(g.userId)
    );

    const select = new StringSelectMenuBuilder()
      .setCustomId('boostercleanup:select')
      .setPlaceholder('Select the people to delete sounds for...')
      .setMinValues(1)
      .setMaxValues(options.length)
      .addOptions(options);

    return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
  }

  static createCleanupConfirmEmbed(
    groups: { userId: string; label: string; inGuild: boolean; assets: BoosterAsset[] }[],
  ): EmbedBuilder {
    const totalSounds = groups.reduce((sum, g) => sum + g.assets.length, 0);
    const lines = groups.map((g) => {
      const who = g.inGuild ? `<@${g.userId}>` : `${g.label} \`(${g.userId})\``;
      return `**${who}** — ${g.assets.length} sound(s)`;
    });

    return new EmbedBuilder()
      .setTitle('⚠️ Confirm Sound Cleanup')
      .setColor(COLORS.error)
      .setDescription(
        `You're about to permanently delete **${totalSounds} sound(s)** from **${groups.length} person(s)**:\n\n` +
        lines.join('\n') +
        '\n\nThis removes them from the server soundboard and cannot be undone.'
      );
  }

  static createCleanupConfirmComponents(): ActionRowBuilder<ButtonBuilder>[] {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('boostercleanup:confirm')
          .setLabel('Delete Selected')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('boostercleanup:cancel')
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary),
      ),
    ];
  }

  static createCleanupEmptyEmbed(): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle('🧹 Booster Sound Cleanup')
      .setColor(COLORS.success)
      .setDescription('All tracked soundboard sounds belong to current boosters. Nothing to clean up! 🎉');
  }

  static createCleanupResultEmbed(deletedCount: number, userCount: number, failed: number): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle('🧹 Cleanup Complete')
      .setColor(COLORS.success)
      .setDescription(
        `Deleted **${deletedCount} sound(s)** from **${userCount} person(s)**.`
      );

    if (failed > 0) {
      embed.addFields({
        name: '⚠️ Note',
        value: `${failed} sound(s) were already gone from the server soundboard and were only removed from tracking.`,
      });
    }

    return embed;
  }

  // ==================== Modals ====================

  static createSoundUploadModal(): ModalBuilder {
    const modal = new ModalBuilder()
      .setCustomId('boosterperks:modal_upload:sound')
      .setTitle('Upload Soundboard Sound');

    const nameInput = new TextInputBuilder()
      .setCustomId('boosterperks:input_name')
      .setLabel('Sound Name (2-32 characters)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(2)
      .setMaxLength(32)
      .setPlaceholder('e.g. airhorn');

    const urlInput = new TextInputBuilder()
      .setCustomId('boosterperks:input_url')
      .setLabel('Sound URL (.mp3, .wav, .ogg, or .m4a)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder('https://example.com/sound.mp3');

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(urlInput),
    );

    return modal;
  }

  static createEmojiUploadModal(): ModalBuilder {
    const modal = new ModalBuilder()
      .setCustomId('boosterperks:modal_upload:emoji')
      .setTitle('Upload Custom Emoji');

    const nameInput = new TextInputBuilder()
      .setCustomId('boosterperks:input_name')
      .setLabel('Emoji Name (2-32 characters, no spaces)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(2)
      .setMaxLength(32)
      .setPlaceholder('e.g. my_cool_emoji');

    const urlInput = new TextInputBuilder()
      .setCustomId('boosterperks:input_url')
      .setLabel('Image URL (.png, .jpg, .gif, .webp)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder('https://example.com/emoji.png');

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(urlInput),
    );

    return modal;
  }
}
