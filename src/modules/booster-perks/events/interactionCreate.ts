import {
  Interaction,
  ButtonInteraction,
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
  GuildMember,
} from 'discord.js';
import { AnyModuleEvent } from '../../../types/event.types.js';
import { BoosterPerksService, AssetType } from '../services/BoosterPerksService.js';
import { BoosterPerksPanel } from '../components/BoosterPerksPanel.js';
import { Logger } from '../../../shared/utils/logger.js';
import { getSettings } from '../commands/booster.js';
import type { BoosterPerksSettings } from '../module.js';

const logger = new Logger('BoosterPerks:Event');

let service: BoosterPerksService | null = null;

export function setService(s: BoosterPerksService): void {
  service = s;
}

function getMaxForType(settings: BoosterPerksSettings, type: AssetType): number {
  return type === 'sound' ? settings.max_sounds_per_user : settings.max_emojis_per_user;
}

export const interactionCreateEvent: AnyModuleEvent = {
  name: 'interactionCreate',
  once: false,

  async execute(...args: unknown[]): Promise<void> {
    const interaction = args[0] as Interaction;
    if (!service || !interaction.guildId) return;

    if (interaction.isButton() && interaction.customId.startsWith('boosterperks:')) {
      await handleButton(interaction);
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('boosterperks:')) {
      await handleSelectMenu(interaction);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('boosterperks:')) {
      await handleModal(interaction);
    }
  },
};

async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const parts = interaction.customId.split(':');
  const action = parts[1] ?? '';
  const type = (parts[2] ?? 'sound') as AssetType;

  const member = interaction.member as GuildMember;
  if (!service!.isBooster(member)) {
    await interaction.reply({
      embeds: [BoosterPerksPanel.createPromoEmbed(interaction.guild!.name)],
      ephemeral: true,
    });
    return;
  }

  const guildId = interaction.guildId!;
  const userId = interaction.user.id;
  const settings = await getSettings(guildId);

  switch (action) {
    // Navigate from overview to asset list
    case 'view': {
      const max = getMaxForType(settings, type);
      const assets = await service!.getUserAssets(guildId, userId, type);

      await interaction.update({
        embeds: [BoosterPerksPanel.createAssetListEmbed(assets, type, max)],
        components: BoosterPerksPanel.createAssetListComponents(assets, type, max),
      });
      break;
    }

    // Navigate back to overview
    case 'back': {
      const soundCount = await service!.getUserAssetCount(guildId, userId, 'sound');
      const emojiCount = await service!.getUserAssetCount(guildId, userId, 'emoji');

      await interaction.update({
        embeds: [BoosterPerksPanel.createOverviewEmbed(
          soundCount,
          settings.max_sounds_per_user,
          emojiCount,
          settings.max_emojis_per_user,
          interaction.user.username,
        )],
        components: BoosterPerksPanel.createOverviewComponents(),
      });
      break;
    }

    // Open upload modal
    case 'upload': {
      if (type === 'sound') {
        await interaction.showModal(BoosterPerksPanel.createSoundUploadModal());
      } else {
        await interaction.showModal(BoosterPerksPanel.createEmojiUploadModal());
      }
      break;
    }

    // Confirm deletion
    case 'confirm_delete': {
      const assetDbId = parts[3];
      if (!assetDbId) return;

      const asset = await service!.getAssetById(assetDbId);
      if (!asset || asset.user_id !== userId) {
        await interaction.update({
          embeds: [BoosterPerksPanel.createErrorEmbed('Not Found', 'Asset not found or not yours.')],
          components: [],
        });
        return;
      }

      const max = getMaxForType(settings, asset.asset_type);

      try {
        if (asset.asset_type === 'sound') {
          await service!.deleteSoundboardSound(interaction.guild!, asset.asset_id);
        } else {
          await service!.deleteCustomEmoji(interaction.guild!, asset.asset_id);
        }
        await service!.removeAsset(asset.id);

        const assets = await service!.getUserAssets(guildId, userId, asset.asset_type);

        await interaction.update({
          embeds: [
            BoosterPerksPanel.createDeleteSuccessEmbed(asset.asset_type, asset.asset_name),
            BoosterPerksPanel.createAssetListEmbed(assets, asset.asset_type, max),
          ],
          components: BoosterPerksPanel.createAssetListComponents(assets, asset.asset_type, max),
        });

        logger.info(`User ${interaction.user.username} deleted ${asset.asset_type} "${asset.asset_name}"`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        await interaction.update({
          embeds: [BoosterPerksPanel.createErrorEmbed('Delete Failed', message)],
          components: [],
        });
      }
      break;
    }

    // Cancel deletion, go back to asset list
    case 'cancel_delete': {
      const max = getMaxForType(settings, type);
      const assets = await service!.getUserAssets(guildId, userId, type);

      await interaction.update({
        embeds: [BoosterPerksPanel.createAssetListEmbed(assets, type, max)],
        components: BoosterPerksPanel.createAssetListComponents(assets, type, max),
      });
      break;
    }
  }
}

async function handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  const parts = interaction.customId.split(':');
  const action = parts[1];
  const type = (parts[2] ?? 'sound') as AssetType;
  const selectedValue = interaction.values[0];
  if (!selectedValue) return;

  const member = interaction.member as GuildMember;
  if (!service!.isBooster(member)) {
    await interaction.reply({
      embeds: [BoosterPerksPanel.createPromoEmbed(interaction.guild!.name)],
      ephemeral: true,
    });
    return;
  }

  if (action === 'select_delete') {
    const asset = await service!.getAssetById(selectedValue);
    if (!asset || asset.user_id !== interaction.user.id) {
      await interaction.reply({
        embeds: [BoosterPerksPanel.createErrorEmbed('Not Found', 'Asset not found or not yours.')],
        ephemeral: true,
      });
      return;
    }

    await interaction.update({
      embeds: [BoosterPerksPanel.createConfirmDeleteEmbed(asset)],
      components: BoosterPerksPanel.createConfirmDeleteComponents(asset.id, type),
    });
  }
}

async function handleModal(interaction: ModalSubmitInteraction): Promise<void> {
  const parts = interaction.customId.split(':');
  const action = parts[1];
  const type = (parts[2] ?? 'sound') as AssetType;

  if (action === 'modal_upload') {
    const name = interaction.fields.getTextInputValue('boosterperks:input_name');
    const url = interaction.fields.getTextInputValue('boosterperks:input_url');
    const guildId = interaction.guildId!;
    const userId = interaction.user.id;

    // Validate emoji name
    if (type === 'emoji' && !/^[a-zA-Z0-9_]+$/.test(name)) {
      await interaction.reply({
        embeds: [BoosterPerksPanel.createErrorEmbed(
          'Invalid Emoji Name',
          'Emoji names can only contain letters, numbers, and underscores.'
        )],
        ephemeral: true,
      });
      return;
    }

    const settings = await getSettings(guildId);
    const max = getMaxForType(settings, type);
    const currentCount = await service!.getUserAssetCount(guildId, userId, type);

    if (currentCount >= max) {
      await interaction.reply({
        embeds: [BoosterPerksPanel.createErrorEmbed(
          'Limit Reached',
          `You already have **${currentCount}/${max}** ${type === 'sound' ? 'sounds' : 'emojis'}.`
        )],
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const fileBuffer = await service!.downloadFile(url, type);

      let assetId: string;
      if (type === 'sound') {
        assetId = await service!.createSoundboardSound(interaction.guild!, name, fileBuffer);
      } else {
        assetId = await service!.createCustomEmoji(interaction.guild!, name, fileBuffer);
      }

      await service!.trackAsset(guildId, userId, type, assetId, name, url);

      const remaining = max - currentCount - 1;
      await interaction.editReply({
        embeds: [BoosterPerksPanel.createUploadSuccessEmbed(type, name, remaining)],
      });

      logger.info(`User ${interaction.user.username} uploaded ${type} "${name}" in guild ${interaction.guild!.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error occurred';
      logger.error(`Modal upload ${type} failed for user ${userId}:`, error);

      await interaction.editReply({
        embeds: [BoosterPerksPanel.createErrorEmbed('Upload Failed', message)],
      });
    }
  }
}
