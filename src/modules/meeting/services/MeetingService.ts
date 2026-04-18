/**
 * Meeting Service
 *
 * Manages meeting recording sessions:
 * 1. Records all participants in a voice channel
 * 2. Transcribes each speaker's audio
 * 3. Generates an AI summary at the end
 */

import { TextChannel, User, VoiceChannel, GuildMember, Client } from 'discord.js';
import { Logger } from '../../../shared/utils/logger.js';
import { VoiceRecorder } from '../../../core/voice/VoiceRecorder.js';
import { transcribe, getTranscriptionRegistry } from '../../../core/transcription/index.js';
import { chat, getAIRegistry } from '../../../core/ai/index.js';
import { synthesize, getTTSRegistry } from '../../../core/tts/index.js';
import { getModuleSettingsService } from '../../../core/settings/ModuleSettingsService.js';
import path from 'path';
import { mkdirSync, existsSync, unlinkSync } from 'fs';

const MODULE_ID = 'meeting';

const logger = new Logger('Meeting');

/**
 * Get a setting value for the meeting module
 */
async function getSetting<T>(guildId: string, key: string, defaultValue: T): Promise<T> {
  const settingsService = getModuleSettingsService();
  if (!settingsService) {
    return defaultValue;
  }

  const value = await settingsService.getSetting(MODULE_ID, guildId, key);
  return (value as T) ?? defaultValue;
}

export interface TranscriptEntry {
  userId: string;
  username: string;
  text: string;
  timestamp: Date;
}

export interface MeetingSession {
  id: string;
  guildId: string;
  channelId: string;
  voiceChannelName: string;
  hostId: string;
  host: User;
  textChannel: TextChannel;
  recorder: VoiceRecorder;
  participants: Map<string, { user: GuildMember; joinedAt: Date }>;
  transcript: TranscriptEntry[];
  startedAt: Date;
  outputDir: string;
  isProcessing: boolean;
  startMessageId?: string;
  client: Client;
}

// Active meeting sessions per guild
const activeSessions: Map<string, MeetingSession> = new Map();

/**
 * Start a meeting recording session
 */
export async function startMeeting(
  host: User,
  guildId: string,
  voiceChannel: VoiceChannel,
  textChannel: TextChannel,
  recorder: VoiceRecorder,
  client: Client
): Promise<MeetingSession | null> {
  // Check if there's already an active session in this guild
  if (activeSessions.has(guildId)) {
    logger.warn(`Meeting already active in guild ${guildId}`);
    return null;
  }

  // Check if providers are configured
  if (!getTranscriptionRegistry().hasConfiguredProvider()) {
    logger.error('No transcription provider configured');
    return null;
  }

  const sessionId = `meeting_${guildId}_${Date.now()}`;
  const outputDir = path.join(process.cwd(), 'temp', 'meetings', sessionId);

  // Create output directory
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // Get current participants
  const participants = new Map<string, { user: GuildMember; joinedAt: Date }>();
  for (const [memberId, member] of voiceChannel.members) {
    if (!member.user.bot) {
      participants.set(memberId, { user: member, joinedAt: new Date() });
    }
  }

  const session: MeetingSession = {
    id: sessionId,
    guildId,
    channelId: voiceChannel.id,
    voiceChannelName: voiceChannel.name,
    hostId: host.id,
    host,
    textChannel,
    recorder,
    participants,
    transcript: [],
    startedAt: new Date(),
    outputDir,
    isProcessing: false,
    client,
  };

  activeSessions.set(guildId, session);

  // Get settings
  const silenceDuration = await getSetting<number>(guildId, 'silence_duration', 1500);

  // Start recording all users with callback for each audio segment
  const started = recorder.startRecording({
    outputDir,
    separateUsers: true,
    format: 'mp3',
    deleteOriginal: true,
    silenceDuration,
    onAudioCaptured: async (filePath, userId, durationMs) => {
      await handleAudioCaptured(session, filePath, userId, durationMs);
    },
  });

  if (!started) {
    activeSessions.delete(guildId);
    logger.error('Failed to start recording');
    return null;
  }

  logger.info(`Started meeting recording for ${host.tag} in guild ${guildId} with ${participants.size} participants`);
  return session;
}

/**
 * Handle when an audio segment is captured from a user
 */
async function handleAudioCaptured(
  session: MeetingSession,
  filePath: string,
  userId: string,
  durationMs: number
): Promise<void> {
  // Skip very short clips (likely noise)
  if (durationMs < 500) {
    logger.debug(`Skipping short audio clip (${durationMs}ms)`);
    cleanupFile(filePath);
    return;
  }

  try {
    const result = await transcribe(filePath);

    if (result.text && result.text.trim().length > 0) {
      // Get username
      let username = 'Unknown User';
      const participant = session.participants.get(userId);
      if (participant) {
        username = participant.user.displayName;
      } else {
        // Try to fetch the user
        try {
          const user = await session.client.users.fetch(userId);
          username = user.displayName || user.username;
          // Add them to participants for future reference
          const guild = session.client.guilds.cache.get(session.guildId);
          if (guild) {
            const member = await guild.members.fetch(userId).catch(() => null);
            if (member) {
              session.participants.set(userId, { user: member, joinedAt: new Date() });
            }
          }
        } catch {
          // Use ID as fallback
          username = `User ${userId.slice(-4)}`;
        }
      }

      // Add to transcript
      session.transcript.push({
        userId,
        username,
        text: result.text.trim(),
        timestamp: new Date(),
      });

      logger.debug(`Transcribed [${username}]: ${result.text.trim().slice(0, 50)}...`);
    }

    // Clean up the file
    cleanupFile(filePath);
  } catch (error) {
    logger.error(`Failed to transcribe ${filePath}:`, error);
    cleanupFile(filePath);
  }
}

/**
 * Clean up a temporary file
 */
function cleanupFile(filePath: string): void {
  try {
    unlinkSync(filePath);
  } catch {
    // Ignore deletion errors
  }
}

/**
 * Stop a meeting recording session
 */
export async function stopMeeting(guildId: string): Promise<{
  session: MeetingSession;
  duration: number;
  summary?: string;
} | null> {
  const session = activeSessions.get(guildId);
  if (!session) {
    return null;
  }

  // Stop recording
  await session.recorder.stopRecording();

  // Wait a bit for any pending transcriptions to complete
  await new Promise(resolve => setTimeout(resolve, 3000));

  activeSessions.delete(guildId);

  const duration = Math.floor((Date.now() - session.startedAt.getTime()) / 1000);

  // Generate AI summary if enabled
  const summaryEnabled = await getSetting<boolean>(guildId, 'summary_enabled', true);
  let summary: string | undefined;

  if (summaryEnabled && session.transcript.length > 0 && getAIRegistry().hasConfiguredProvider()) {
    try {
      summary = await generateMeetingSummary(session);
    } catch (error) {
      logger.error('Failed to generate meeting summary:', error);
    }
  }

  logger.info(`Stopped meeting in guild ${guildId}. Duration: ${duration}s, Transcript entries: ${session.transcript.length}`);

  return { session, duration, summary };
}

/**
 * Generate an AI summary of the meeting
 */
async function generateMeetingSummary(session: MeetingSession): Promise<string> {
  // Build the transcript for the AI
  const transcriptText = session.transcript
    .map(entry => `[${entry.username}]: ${entry.text}`)
    .join('\n');

  const prompt = `You are a meeting assistant. Below is a transcript of a voice meeting. Please provide:

1. A brief summary (2-3 sentences) of what was discussed
2. Key points or decisions made (bullet points)
3. Any action items mentioned (if any)

Keep the response concise and focused on the most important information.

Meeting Transcript:
${transcriptText}`;

  const response = await chat(prompt, {
    maxTokens: 1000,
    temperature: 0.3, // Lower temperature for more focused summaries
  });

  return response.text;
}

/**
 * Play recording announcement in voice channel
 */
export async function playRecordingAnnouncement(
  session: MeetingSession,
  message: string = 'This meeting is now being recorded.'
): Promise<void> {
  const announcementEnabled = await getSetting<boolean>(session.guildId, 'announcement_enabled', true);
  const voice = await getSetting<string>(session.guildId, 'announcement_voice', 'nova');

  if (!announcementEnabled) {
    return;
  }

  if (!getTTSRegistry().hasConfiguredProvider()) {
    logger.warn('TTS not configured, skipping announcement');
    return;
  }

  try {
    const ttsResult = await synthesize(message, {
      voice,
      speed: 1.0,
      format: 'mp3',
    });

    await session.recorder.playAudioBuffer(ttsResult.audio, ttsResult.format);
    logger.debug('Played recording announcement');
  } catch (error) {
    logger.error('Failed to play announcement:', error);
  }
}

/**
 * Get active session for a guild
 */
export function getMeeting(guildId: string): MeetingSession | null {
  return activeSessions.get(guildId) || null;
}

/**
 * Check if there's an active meeting in a guild
 */
export function hasActiveMeeting(guildId: string): boolean {
  return activeSessions.has(guildId);
}

/**
 * Get all active meetings
 */
export function getActiveMeetings(): Map<string, MeetingSession> {
  return activeSessions;
}

/**
 * Check if all required providers are configured
 */
export function checkProviders(): { transcription: boolean; ai: boolean; tts: boolean } {
  return {
    transcription: getTranscriptionRegistry().hasConfiguredProvider(),
    ai: getAIRegistry().hasConfiguredProvider(),
    tts: getTTSRegistry().hasConfiguredProvider(),
  };
}

/**
 * Format meeting transcript for display (markdown)
 */
export function formatTranscript(transcript: TranscriptEntry[]): string {
  if (transcript.length === 0) {
    return '*No speech was recorded*';
  }

  const lines: string[] = [];
  for (const entry of transcript) {
    lines.push(`**${entry.username}:** ${entry.text}`);
  }

  return lines.join('\n');
}

/**
 * Format meeting transcript as plain text (for file export)
 */
export function formatTranscriptPlain(transcript: TranscriptEntry[]): string {
  if (transcript.length === 0) {
    return 'No speech was recorded';
  }

  const lines: string[] = [];
  lines.push('=== Meeting Transcript ===');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');

  for (const entry of transcript) {
    const time = entry.timestamp.toLocaleTimeString();
    lines.push(`[${time}] ${entry.username}: ${entry.text}`);
  }

  lines.push('');
  lines.push('=== End of Transcript ===');

  return lines.join('\n');
}

/**
 * Get provider info
 */
export function getProviderInfo(): {
  transcription: { configured: boolean; provider: string | null };
  ai: { configured: boolean; provider: string | null };
  tts: { configured: boolean; provider: string | null };
} {
  const transcriptionRegistry = getTranscriptionRegistry();
  const aiRegistry = getAIRegistry();
  const ttsRegistry = getTTSRegistry();

  const defaultTranscription = transcriptionRegistry.getDefault();
  const defaultAI = aiRegistry.getDefault();
  const defaultTTS = ttsRegistry.getDefault();

  return {
    transcription: {
      configured: transcriptionRegistry.hasConfiguredProvider(),
      provider: defaultTranscription?.name || null,
    },
    ai: {
      configured: aiRegistry.hasConfiguredProvider(),
      provider: defaultAI?.name || null,
    },
    tts: {
      configured: ttsRegistry.hasConfiguredProvider(),
      provider: defaultTTS?.name || null,
    },
  };
}
