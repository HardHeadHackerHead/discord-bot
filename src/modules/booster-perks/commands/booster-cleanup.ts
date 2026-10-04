import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  Guild,
  GuildMember,
} from 'discord.js';
import { SlashCommand } from '../../../types/command.types.js';
import { BoosterPerksService, BoosterAsset } from '../services/BoosterPerksService.js';
import { BoosterPerksPanel } from '../components/BoosterPerksPanel.js';

let service: BoosterPerksService | null = null;

export function setService(s: BoosterPerksService): void {
  service = s;
}

export interface ExBoosterGroup {
  userId: string;
  label: string;
  inGuild: boolean;
  assets: BoosterAsset[];
}

/**
 * Find every tracked soundboard sound whose owner is no longer boosting the
 * server, grouped by person. Owners who left the guild count as ex-boosters.
 */
export async function getExBoosterSoundGroups(
  guild: Guild,
  svc: BoosterPerksService,
): Promise<ExBoosterGroup[]> {
  const assets = await svc.getGuildAssets(guild.id, 'sound');

  const byUser = new Map<string, BoosterAsset[]>();
  for (const asset of assets) {
    const list = byUser.get(asset.user_id) ?? [];
    list.push(asset);
    byUser.set(asset.user_id, list);
  }

  const groups: ExBoosterGroup[] = [];
  for (const [userId, userAssets] of byUser) {
    let member: GuildMember | null = null;
    try {
      member = await guild.members.fetch(userId);
    } catch {
      member = null; // left the server
    }

    // Still boosting — leave their sounds alone
    if (member && svc.isBooster(member)) continue;

    let label: string;
    if (member) {
      label = member.displayName;
    } else {
      try {
        const user = await guild.client.users.fetch(userId);
        label = `${user.username} (left server)`;
      } catch {
        label = 'Unknown user (left server)';
      }
    }

    groups.push({ userId, label, inGuild: !!member, assets: userAssets });
  }

  return groups;
}

export const command: SlashCommand = {
  type: 'slash',
  guildOnly: true,
  data: new SlashCommandBuilder()
    .setName('booster-cleanup')
    .setDescription('Review and delete soundboard sounds owned by former boosters')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!service) {
      await interaction.reply({ content: 'Service not available.', ephemeral: true });
      return;
    }

    if (!interaction.guildId || !interaction.guild) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const groups = await getExBoosterSoundGroups(interaction.guild, service);

    if (groups.length === 0) {
      await interaction.editReply({
        embeds: [BoosterPerksPanel.createCleanupEmptyEmbed()],
      });
      return;
    }

    const truncated = groups.length > BoosterPerksPanel.CLEANUP_MAX_OPTIONS;

    await interaction.editReply({
      embeds: [BoosterPerksPanel.createCleanupEmbed(groups, truncated)],
      components: BoosterPerksPanel.createCleanupComponents(groups),
    });
  },
};
