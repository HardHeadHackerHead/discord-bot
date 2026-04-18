import { VoiceState } from 'discord.js';
import type { AnyModuleEvent } from '../../../types/event.types.js';
import type { PlaybackManager } from '../services/PlaybackManager.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('MusicVoiceState');

let getPlaybackManager: ((guildId: string) => PlaybackManager | undefined) | null = null;
let removePlaybackManager: ((guildId: string) => void) | null = null;
let getBotId: (() => string | null) | null = null;

/** Timer tracking for alone-in-channel detection */
const aloneTimers = new Map<string, NodeJS.Timeout>();

const ALONE_TIMEOUT_MS = 30_000; // 30 seconds

export function setVoiceStateServices(
  getManager: (guildId: string) => PlaybackManager | undefined,
  removeManager: (guildId: string) => void,
  botIdGetter: () => string | null
): void {
  getPlaybackManager = getManager;
  removePlaybackManager = removeManager;
  getBotId = botIdGetter;
}

export const voiceStateUpdateEvent: AnyModuleEvent = {
  name: 'voiceStateUpdate',
  once: false,

  async execute(...args: unknown[]): Promise<void> {
    const oldState = args[0] as VoiceState;
    const newState = args[1] as VoiceState;

    if (!getPlaybackManager || !removePlaybackManager || !getBotId) return;

    const guildId = newState.guild.id;
    const manager = getPlaybackManager(guildId);
    if (!manager) return;

    const botId = getBotId();
    if (!botId) return;

    const botChannelId = manager.getVoiceChannelId();
    if (!botChannelId) return;

    // Check if the bot itself was moved or disconnected
    if (oldState.member?.id === botId || newState.member?.id === botId) {
      // Bot was disconnected from voice
      if (oldState.channelId && !newState.channelId && newState.member?.id === botId) {
        logger.debug(`Bot was disconnected from voice in guild ${guildId}`);
        manager.destroy();
        removePlaybackManager(guildId);
        clearAloneTimer(guildId);
        return;
      }

      // Bot was moved to another channel
      if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId && newState.member?.id === botId) {
        logger.debug(`Bot was moved to channel ${newState.channelId} in guild ${guildId}`);
        // The connection should automatically reconnect; check if alone in new channel
        checkIfAlone(guildId, newState, botId, botChannelId);
        return;
      }
    }

    // Someone else left or joined the bot's channel
    if (oldState.channelId === botChannelId || newState.channelId === botChannelId) {
      checkIfAlone(guildId, newState, botId, botChannelId);
    }
  },
};

function checkIfAlone(guildId: string, state: VoiceState, botId: string, botChannelId: string): void {
  const channel = state.guild.channels.cache.get(botChannelId);
  if (!channel || !channel.isVoiceBased()) {
    // Channel was deleted or is not voice
    const manager = getPlaybackManager!(guildId);
    if (manager) {
      manager.destroy();
      removePlaybackManager!(guildId);
    }
    clearAloneTimer(guildId);
    return;
  }

  const members = channel.members.filter((m) => !m.user.bot);
  if (members.size === 0) {
    // Bot is alone — start timer
    if (!aloneTimers.has(guildId)) {
      logger.debug(`Bot is alone in voice channel in guild ${guildId}, starting ${ALONE_TIMEOUT_MS / 1000}s timer`);
      const timer = setTimeout(() => {
        aloneTimers.delete(guildId);
        const manager = getPlaybackManager!(guildId);
        if (manager) {
          logger.info(`Auto-disconnecting from guild ${guildId} — alone for ${ALONE_TIMEOUT_MS / 1000}s`);
          manager.destroy();
          removePlaybackManager!(guildId);
        }
      }, ALONE_TIMEOUT_MS);
      aloneTimers.set(guildId, timer);
    }
  } else {
    // Not alone — clear timer
    clearAloneTimer(guildId);
  }
}

function clearAloneTimer(guildId: string): void {
  const timer = aloneTimers.get(guildId);
  if (timer) {
    clearTimeout(timer);
    aloneTimers.delete(guildId);
  }
}
