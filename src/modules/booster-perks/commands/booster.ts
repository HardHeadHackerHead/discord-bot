import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  GuildMember,
} from 'discord.js';
import { SlashCommand } from '../../../types/command.types.js';
import { BoosterPerksService } from '../services/BoosterPerksService.js';
import { BoosterPerksPanel } from '../components/BoosterPerksPanel.js';
import { getModuleSettingsService } from '../../../core/settings/ModuleSettingsService.js';
import type { BoosterPerksSettings } from '../module.js';

let service: BoosterPerksService | null = null;

export function setService(s: BoosterPerksService): void {
  service = s;
}

export async function getSettings(guildId: string): Promise<BoosterPerksSettings> {
  const settingsService = getModuleSettingsService();
  const settings = await settingsService?.getSettings<BoosterPerksSettings>(
    'booster-perks',
    guildId
  );
  return settings ?? { max_sounds_per_user: 5, max_emojis_per_user: 3 };
}

export const command: SlashCommand = {
  type: 'slash',
  data: new SlashCommandBuilder()
    .setName('booster')
    .setDescription('View and manage your Server Booster perks') as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!service) {
      await interaction.reply({ content: 'Service not available.', ephemeral: true });
      return;
    }

    if (!interaction.guildId || !interaction.guild) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    const member = interaction.member as GuildMember;

    // Non-boosters get a promo embed explaining the perks
    if (!service.isBooster(member)) {
      await interaction.reply({
        embeds: [BoosterPerksPanel.createPromoEmbed(interaction.guild.name)],
        ephemeral: true,
      });
      return;
    }

    // Boosters get the interactive overview panel
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const settings = await getSettings(guildId);

    const soundCount = await service.getUserAssetCount(guildId, userId, 'sound');
    const emojiCount = await service.getUserAssetCount(guildId, userId, 'emoji');

    await interaction.reply({
      embeds: [BoosterPerksPanel.createOverviewEmbed(
        soundCount,
        settings.max_sounds_per_user,
        emojiCount,
        settings.max_emojis_per_user,
        interaction.user.username,
      )],
      components: BoosterPerksPanel.createOverviewComponents(),
      ephemeral: true,
    });
  },
};
