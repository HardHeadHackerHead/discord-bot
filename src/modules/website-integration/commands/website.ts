/**
 * Website Integration Command
 * Provides status info, manual controls, and poke subscription management
 */

import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  GuildMember,
} from 'discord.js';
import type { SlashCommand } from '../../../types/command.types.js';
import type { WebsiteApiService } from '../services/WebsiteApiService.js';
import type { ActivityBatcher } from '../services/ActivityBatcher.js';
import type { LeaderboardSync } from '../services/LeaderboardSync.js';
import type { InteractionPoller } from '../services/InteractionPoller.js';
import { getModuleSettingsService } from '../../../core/settings/ModuleSettingsService.js';
import type { WebsiteIntegrationSettings } from '../types/website.types.js';

// Services injected by module
let apiService: WebsiteApiService | null = null;
let activityBatcher: ActivityBatcher | null = null;
let leaderboardSync: LeaderboardSync | null = null;
let interactionPoller: InteractionPoller | null = null;

export function setServices(
  api: WebsiteApiService,
  batcher: ActivityBatcher,
  leaderboard: LeaderboardSync,
  poller: InteractionPoller | null // Can be null if using webhook server
): void {
  apiService = api;
  activityBatcher = batcher;
  leaderboardSync = leaderboard;
  interactionPoller = poller;
}

export const websiteCommand: SlashCommand = {
  type: 'slash',
  data: new SlashCommandBuilder()
    .setName('website')
    .setDescription('Website integration management')
    .addSubcommand(sub =>
      sub
        .setName('subscribe')
        .setDescription('Subscribe/unsubscribe from poke notifications')
    )
    .addSubcommand(sub =>
      sub
        .setName('status')
        .setDescription('View website integration status')
    )
    .addSubcommand(sub =>
      sub
        .setName('sync')
        .setDescription('Force sync leaderboard to website now')
    )
    .addSubcommand(sub =>
      sub
        .setName('flush')
        .setDescription('Flush pending activity events now')
    )
    .addSubcommand(sub =>
      sub
        .setName('test')
        .setDescription('Test website connection')
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();

    // Subscribe is available to all users, other commands require admin
    if (subcommand !== 'subscribe') {
      const member = interaction.member as GuildMember;
      if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({
          content: 'You need Administrator permission to use this command.',
          ephemeral: true,
        });
        return;
      }
    }

    switch (subcommand) {
      case 'subscribe':
        await handleSubscribe(interaction);
        break;
      case 'status':
        await handleStatus(interaction);
        break;
      case 'sync':
        await handleSync(interaction);
        break;
      case 'flush':
        await handleFlush(interaction);
        break;
      case 'test':
        await handleTest(interaction);
        break;
    }
  },
};

async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!apiService) {
    await interaction.reply({ content: 'Website integration not initialized.', ephemeral: true });
    return;
  }

  const status = apiService.getStatus();
  const lastSync = leaderboardSync?.getLastSyncTime();
  const queueSize = activityBatcher?.getQueueSize() ?? 0;
  const isPolling = interactionPoller?.isPolling() ?? false;

  // Check if any services are paused due to errors
  const batcherPaused = activityBatcher?.isPausedDueToError() ?? false;
  const leaderboardPaused = leaderboardSync?.isPausedDueToError() ?? false;
  const pollerPaused = interactionPoller?.isPausedDueToError() ?? false;
  const anyPaused = batcherPaused || leaderboardPaused || pollerPaused;

  // Determine status text for each service
  const getPollingStatus = () => {
    if (pollerPaused) return '⏸️ Paused (errors)';
    return isPolling ? '✅ Active' : '❌ Inactive';
  };

  const getBatcherStatus = () => {
    if (batcherPaused) return '⏸️ Paused (errors)';
    return `${queueSize} event(s) queued`;
  };

  const getLeaderboardStatus = () => {
    if (leaderboardPaused) return '⏸️ Paused (errors)';
    if (lastSync) return `<t:${Math.floor(lastSync.getTime() / 1000)}:R>`;
    return 'Never';
  };

  const embed = new EmbedBuilder()
    .setTitle('🌐 Website Integration Status')
    .setColor(anyPaused ? 0xffaa00 : (status.connected ? 0x00ff00 : 0xff0000))
    .addFields(
      {
        name: 'Connection',
        value: status.connected ? '✅ Connected' : '❌ Disconnected',
        inline: true,
      },
      {
        name: 'Activity Events',
        value: getBatcherStatus(),
        inline: true,
      },
      {
        name: 'Interaction Polling',
        value: getPollingStatus(),
        inline: true,
      },
      {
        name: 'Last Successful Sync',
        value: status.lastSuccessfulSync
          ? `<t:${Math.floor(status.lastSuccessfulSync.getTime() / 1000)}:R>`
          : 'Never',
        inline: true,
      },
      {
        name: 'Last Leaderboard Sync',
        value: getLeaderboardStatus(),
        inline: true,
      },
      {
        name: 'Last Error',
        value: status.lastError || 'None',
        inline: false,
      }
    );

  if (anyPaused) {
    embed.setFooter({ text: '⏸️ Some services paused due to errors. Restart bot to retry.' });
  }

  embed.setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleSync(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!leaderboardSync) {
    await interaction.reply({ content: 'Leaderboard sync not initialized.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const success = await leaderboardSync.sync();

  if (success) {
    await interaction.editReply('✅ Leaderboard synced to website successfully!');
  } else {
    await interaction.editReply('❌ Failed to sync leaderboard. Check the logs for details.');
  }
}

async function handleFlush(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!activityBatcher) {
    await interaction.reply({ content: 'Activity batcher not initialized.', ephemeral: true });
    return;
  }

  const queueSize = activityBatcher.getQueueSize();

  if (queueSize === 0) {
    await interaction.reply({ content: 'No pending events to flush.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  await activityBatcher.flush();

  await interaction.editReply(`✅ Flushed ${queueSize} activity event(s) to website.`);
}

async function handleTest(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!apiService) {
    await interaction.reply({ content: 'Website API service not initialized.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const isHealthy = await apiService.healthCheck();

  if (isHealthy) {
    await interaction.editReply('✅ Website is reachable and responding!');
  } else {
    const status = apiService.getStatus();
    await interaction.editReply(`❌ Cannot reach website. Error: ${status.lastError || 'Unknown'}`);
  }
}

async function handleSubscribe(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({
      content: 'This command can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  // Get settings to find the role ID
  const settingsService = getModuleSettingsService();
  const settings = await settingsService?.getSettings<WebsiteIntegrationSettings>(
    'website-integration',
    interaction.guildId
  );

  if (!settings?.poke_responder_role_id) {
    await interaction.reply({
      content: '⚠️ The Poke Responder role is not configured. Ask an admin to set it up in the module settings.',
      ephemeral: true,
    });
    return;
  }

  const member = interaction.member as GuildMember;
  const roleId = settings.poke_responder_role_id;

  // Check if the role exists
  const role = interaction.guild?.roles.cache.get(roleId);
  if (!role) {
    await interaction.reply({
      content: '⚠️ The configured Poke Responder role no longer exists. Ask an admin to reconfigure it.',
      ephemeral: true,
    });
    return;
  }

  try {
    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId);
      await interaction.reply({
        content: `🔕 You've unsubscribed from poke notifications. You will no longer be pinged when website visitors poke the lab.`,
        ephemeral: true,
      });
    } else {
      await member.roles.add(roleId);
      await interaction.reply({
        content: `🔔 You've subscribed to poke notifications! You'll be pinged when someone pokes the lab from the website.\n\n` +
                 `**Tip:** Responding to pokes earns you ${settings.poke_points_reward ?? 50} points!`,
        ephemeral: true,
      });
    }
  } catch (error) {
    await interaction.reply({
      content: '❌ Failed to update your subscription. The bot may not have permission to manage roles.',
      ephemeral: true,
    });
  }
}
