import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
} from 'discord.js';
import { defineSlashCommand } from '../../../types/command.types.js';
import { errorEmbed, successEmbed, createEmbed, COLORS } from '../../../shared/utils/embed.js';
import { Logger } from '../../../shared/utils/logger.js';
import type { StravaService } from '../services/StravaService.js';
import type { StravaListenService } from '../services/StravaListenService.js';
import type { StravaEventDispatcher } from '../services/StravaEventDispatcher.js';

const logger = new Logger('Strava:Command');

// Module-level service handles. Injected from module.ts so the
// command file stays import-cycle-free.
let stravaService: StravaService | null = null;
let listenService: StravaListenService | null = null;
let dispatcher: StravaEventDispatcher | null = null;
let websiteUrl: string = 'https://quadslab.io';

export function injectStravaCommandDeps(opts: {
  service: StravaService;
  listen: StravaListenService;
  dispatcher: StravaEventDispatcher | null;
  websiteUrl: string;
}): void {
  stravaService = opts.service;
  listenService = opts.listen;
  dispatcher = opts.dispatcher;
  websiteUrl = opts.websiteUrl;
}

export const command = defineSlashCommand(
  new SlashCommandBuilder()
    .setName('strava')
    .setDescription('Connect Strava and configure activity announcements')
    .addSubcommand((sub) =>
      sub
        .setName('link')
        .setDescription("DMs you a link to connect your Strava account"),
    )
    .addSubcommand((sub) =>
      sub
        .setName('unlink')
        .setDescription("DMs you a link to disconnect your Strava account"),
    )
    .addSubcommand((sub) =>
      sub
        .setName('status')
        .setDescription('Show whether your Strava is linked and the current channel'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('setchannel')
        .setDescription('Set the channel where Strava activities are posted (admin only)')
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('Text channel to post activities into')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('clearchannel')
        .setDescription('Stop posting activities in this server (admin only)'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('replay')
        .setDescription('Re-post your most recent Strava activity (useful for testing).'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('backfill')
        .setDescription('Pull a specific past Strava activity and post it (works for activities Strava never webhooked us).')
        .addStringOption((opt) =>
          opt
            .setName('activity')
            .setDescription('Strava activity URL or numeric ID')
            .setRequired(true),
        ),
    ) as SlashCommandBuilder,

  async (interaction: ChatInputCommandInteraction) => {
    if (!stravaService) {
      await interaction.reply({
        embeds: [errorEmbed('Strava module not ready', 'Please try again in a moment.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const sub = interaction.options.getSubcommand();
    switch (sub) {
      case 'link':
        return handleLink(interaction);
      case 'unlink':
        return handleUnlink(interaction);
      case 'status':
        return handleStatus(interaction);
      case 'setchannel':
        return handleSetChannel(interaction);
      case 'clearchannel':
        return handleClearChannel(interaction);
      case 'replay':
        return handleReplay(interaction);
      case 'backfill':
        return handleBackfill(interaction);
      default:
        await interaction.reply({
          embeds: [errorEmbed('Unknown subcommand', sub)],
          flags: MessageFlags.Ephemeral,
        });
    }
  },
  { guildOnly: true },
);

// ─── /strava link ───────────────────────────────────────────────────

async function handleLink(interaction: ChatInputCommandInteraction): Promise<void> {
  const url = `${websiteUrl}/api/strava/start`;
  const embed = createEmbed(COLORS.primary)
    .setTitle('Connect your Strava account')
    .setDescription(
      `Open this link to connect Strava:\n\n${url}\n\n` +
        "If you haven't signed into quadslab.io yet, you'll be prompted to log in with Discord first. " +
        "Then you'll be redirected to Strava to approve access. Read-only — we'll never modify your activities.",
    );

  // Try to DM the user; fall back to ephemeral if DMs are closed.
  try {
    const dm = await interaction.user.createDM();
    await dm.send({ embeds: [embed] });
    await interaction.reply({
      content: 'Check your DMs for the connect link.',
      flags: MessageFlags.Ephemeral,
    });
  } catch {
    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
  }
}

// ─── /strava unlink ─────────────────────────────────────────────────

async function handleUnlink(interaction: ChatInputCommandInteraction): Promise<void> {
  const url = `${websiteUrl}/account/integrations`;
  const embed = createEmbed(COLORS.primary)
    .setTitle('Disconnect your Strava account')
    .setDescription(
      `Open this link, sign in with Discord if needed, and click **Disconnect Strava**:\n\n${url}\n\n` +
        `You can also revoke access directly at https://www.strava.com/settings/apps`,
    );

  try {
    const dm = await interaction.user.createDM();
    await dm.send({ embeds: [embed] });
    await interaction.reply({
      content: 'Check your DMs for the disconnect link.',
      flags: MessageFlags.Ephemeral,
    });
  } catch {
    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
  }
}

// ─── /strava status ─────────────────────────────────────────────────

async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!stravaService || !listenService) {
    await interaction.reply({
      embeds: [errorEmbed('Not ready', 'Try again in a moment.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guildId = interaction.guildId!;
  const channel = await stravaService.getGuildChannel(guildId);

  // Look up the user's link state from the website DB.
  let linked = false;
  let athleteName: string | null = null;
  try {
    const rows = await listenService.query<{
      athleteId: string;
      athleteFirstName: string | null;
      athleteLastName: string | null;
      athleteUsername: string | null;
    }>(
      `SELECT i."athleteId",
              i."athleteFirstName",
              i."athleteLastName",
              i."athleteUsername"
         FROM "user" u
         JOIN strava_integration i ON i."userId" = u.id
        WHERE u."discordId" = $1
        LIMIT 1`,
      [interaction.user.id],
    );
    const r = rows[0];
    if (r) {
      linked = true;
      const full = [r.athleteFirstName, r.athleteLastName].filter(Boolean).join(' ').trim();
      athleteName = full || r.athleteUsername || `Athlete #${r.athleteId}`;
    }
  } catch (err) {
    logger.error('status lookup failed:', err);
  }

  const lines: string[] = [];
  lines.push(linked
    ? `**Your Strava:** ✅ linked (${athleteName})`
    : `**Your Strava:** ❌ not linked — run \`/strava link\``);
  lines.push(channel
    ? `**This server's channel:** <#${channel.channel_id}>`
    : `**This server's channel:** not set — an admin can run \`/strava setchannel\``);

  await interaction.editReply({
    embeds: [createEmbed(COLORS.primary).setTitle('Strava status').setDescription(lines.join('\n'))],
  });
}

// ─── /strava setchannel ─────────────────────────────────────────────

async function handleSetChannel(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isManageGuild(interaction)) {
    await interaction.reply({
      embeds: [errorEmbed('Insufficient permissions', 'Requires **Manage Server**.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const channel = interaction.options.getChannel('channel', true);
  await stravaService!.setGuildChannel(interaction.guildId!, channel.id);

  await interaction.reply({
    embeds: [
      successEmbed(
        'Channel set',
        `Linked members' Strava activities will be posted in <#${channel.id}>.`,
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

// ─── /strava clearchannel ───────────────────────────────────────────

async function handleClearChannel(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isManageGuild(interaction)) {
    await interaction.reply({
      embeds: [errorEmbed('Insufficient permissions', 'Requires **Manage Server**.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await stravaService!.clearGuildChannel(interaction.guildId!);
  await interaction.reply({
    embeds: [successEmbed('Channel cleared', 'Strava activities will no longer be posted in this server.')],
    flags: MessageFlags.Ephemeral,
  });
}

// ─── /strava replay ────────────────────────────────────────────────

async function handleReplay(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!dispatcher) {
    await interaction.reply({
      embeds: [errorEmbed('Not available', 'The event dispatcher is not running. Check WEBSITE_DATABASE_URL.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let eventId: string | null = null;
  try {
    eventId = await dispatcher.findLatestEventForDiscordUser(interaction.user.id);
  } catch (err) {
    logger.error('findLatestEventForDiscordUser failed:', err);
    await interaction.editReply({
      embeds: [errorEmbed('Lookup failed', err instanceof Error ? err.message : 'unknown error')],
    });
    return;
  }

  if (!eventId) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          'No activity to replay',
          'No processed activity event found for your linked Strava account. ' +
            'Try `/strava link` or upload an activity on Strava first.',
        ),
      ],
    });
    return;
  }

  try {
    await dispatcher.handleEvent(eventId, { force: true });
    await interaction.editReply({
      embeds: [
        successEmbed(
          'Replay posted',
          `Re-posted event \`${eventId}\` to the configured channel.`,
        ),
      ],
    });
  } catch (err) {
    logger.error('replay handleEvent failed:', err);
    await interaction.editReply({
      embeds: [
        errorEmbed(
          'Replay failed',
          err instanceof Error ? err.message : 'unknown error',
        ),
      ],
    });
  }
}

// ─── /strava backfill ──────────────────────────────────────────────

async function handleBackfill(interaction: ChatInputCommandInteraction): Promise<void> {
  const secret = process.env['STRAVA_BOT_SECRET'];
  if (!secret) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          'Not configured',
          'Bot is missing STRAVA_BOT_SECRET. Set it on both bot and website (same value).',
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const raw = interaction.options.getString('activity', true);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const res = await fetch(`${websiteUrl}/api/strava/synthesize-event`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-bot-secret': secret,
      },
      body: JSON.stringify({
        discordId: interaction.user.id,
        activityId: raw,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      eventId?: string;
      error?: string;
    };
    if (!res.ok || !json.ok) {
      await interaction.editReply({
        embeds: [
          errorEmbed(
            'Backfill failed',
            json.error ?? `HTTP ${res.status}`,
          ),
        ],
      });
      return;
    }
    await interaction.editReply({
      embeds: [
        successEmbed(
          'Backfill queued',
          `Activity has been fetched from Strava and queued — it should appear in the configured channel within a few seconds.\n\nEvent id: \`${json.eventId}\``,
        ),
      ],
    });
  } catch (err) {
    logger.error('backfill request failed:', err);
    await interaction.editReply({
      embeds: [
        errorEmbed(
          'Network error',
          err instanceof Error ? err.message : 'unknown error',
        ),
      ],
    });
  }
}

function isManageGuild(interaction: ChatInputCommandInteraction): boolean {
  if (!interaction.guild) return false;
  const member = interaction.member;
  if (!member || typeof member.permissions === 'string') return false;
  return member.permissions.has(PermissionFlagsBits.ManageGuild);
}
