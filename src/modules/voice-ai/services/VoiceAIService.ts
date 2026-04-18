/**
 * Voice AI Service
 *
 * Manages voice-to-AI conversations:
 * 1. Records user speech
 * 2. Transcribes to text
 * 3. Sends to AI
 * 4. Returns response
 */

import { TextChannel, User } from 'discord.js';
import { Logger } from '../../../shared/utils/logger.js';
import { VoiceRecorder } from '../../../core/voice/VoiceRecorder.js';
import { transcribe, getTranscriptionRegistry } from '../../../core/transcription/index.js';
import { chat, getAIRegistry, AIMessage } from '../../../core/ai/index.js';
import { synthesize, getTTSRegistry } from '../../../core/tts/index.js';
import { getModuleSettingsService } from '../../../core/settings/ModuleSettingsService.js';
import path from 'path';
import { unlinkSync } from 'fs';

const MODULE_ID = 'voice-ai';

const logger = new Logger('VoiceAI');

/**
 * Get a setting value for the voice-ai module
 */
async function getSetting<T>(guildId: string, key: string, defaultValue: T): Promise<T> {
  const settingsService = getModuleSettingsService();
  if (!settingsService) {
    return defaultValue;
  }

  // Note: getSetting expects (moduleId, guildId, key)
  const value = await settingsService.getSetting(MODULE_ID, guildId, key);
  return (value as T) ?? defaultValue;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface ConversationSession {
  id: string;
  guildId: string;
  channelId: string;
  userId: string;
  user: User;
  textChannel: TextChannel;
  recorder: VoiceRecorder;
  history: AIMessage[];
  chatLog: ChatMessage[];
  startedAt: Date;
  clipCount: number;
  isProcessing: boolean;
  startMessageId?: string; // ID of the "conversation started" message to delete later
}

// Active conversation sessions per guild
const activeSessions: Map<string, ConversationSession> = new Map();

/**
 * Start a voice AI conversation session
 */
export async function startConversation(
  user: User,
  guildId: string,
  textChannel: TextChannel,
  recorder: VoiceRecorder
): Promise<ConversationSession | null> {
  // Check if there's already an active session in this guild
  if (activeSessions.has(guildId)) {
    logger.warn(`Conversation already active in guild ${guildId}`);
    return null;
  }

  // Check if providers are configured
  if (!getTranscriptionRegistry().hasConfiguredProvider()) {
    logger.error('No transcription provider configured');
    return null;
  }

  if (!getAIRegistry().hasConfiguredProvider()) {
    logger.error('No AI provider configured');
    return null;
  }

  const sessionId = `${guildId}_${user.id}_${Date.now()}`;
  const outputDir = path.join(process.cwd(), 'temp', 'voice-ai', sessionId);

  const session: ConversationSession = {
    id: sessionId,
    guildId,
    channelId: textChannel.id,
    userId: user.id,
    user,
    textChannel,
    recorder,
    history: [],
    chatLog: [],
    startedAt: new Date(),
    clipCount: 0,
    isProcessing: false,
  };

  activeSessions.set(guildId, session);

  // Get silence duration setting
  const silenceDuration = await getSetting<number>(guildId, 'silence_duration', 1500);

  // Start listening to the user
  const started = recorder.startListening({
    userId: user.id,
    outputDir,
    format: 'mp3',
    silenceDuration, // Configurable silence duration
    onAudioCaptured: async (filePath, userId, durationMs) => {
      await handleAudioCaptured(session, filePath, durationMs);
    },
  });

  if (!started) {
    activeSessions.delete(guildId);
    logger.error('Failed to start listening');
    return null;
  }

  logger.info(`Started voice AI conversation for ${user.tag} in guild ${guildId}`);
  return session;
}

/**
 * Stop a voice AI conversation session
 */
export function stopConversation(guildId: string): ConversationSession | null {
  const session = activeSessions.get(guildId);
  if (!session) {
    return null;
  }

  // Stop listening
  session.recorder.stopListening();

  // Don't disconnect - let the caller handle that

  activeSessions.delete(guildId);

  logger.info(`Stopped voice AI conversation in guild ${guildId}. Clips processed: ${session.clipCount}`);
  return session;
}

/**
 * Get active session for a guild
 */
export function getConversation(guildId: string): ConversationSession | null {
  return activeSessions.get(guildId) || null;
}

/**
 * Check if there's an active conversation in a guild
 */
export function hasActiveConversation(guildId: string): boolean {
  return activeSessions.has(guildId);
}

/**
 * Handle when audio is captured from the user
 */
async function handleAudioCaptured(
  session: ConversationSession,
  filePath: string,
  durationMs: number
): Promise<void> {
  // Skip very short clips (likely noise)
  if (durationMs < 500) {
    logger.debug(`Skipping short audio clip (${durationMs}ms)`);
    cleanupFile(filePath);
    return;
  }

  // Prevent overlapping processing
  if (session.isProcessing) {
    logger.debug('Already processing, queueing...');
    // For now, just skip if already processing
    // Could implement a queue in the future
    cleanupFile(filePath);
    return;
  }

  session.isProcessing = true;
  session.clipCount++;

  try {
    // Send "thinking" indicator
    await session.textChannel.sendTyping();

    // Step 1: Transcribe the audio
    logger.debug(`Transcribing audio (${durationMs}ms)...`);
    const transcription = await transcribe(filePath);

    // Clean up the audio file
    cleanupFile(filePath);

    if (!transcription.text || transcription.text.trim().length === 0) {
      logger.debug('No speech detected in audio');
      session.isProcessing = false;
      return;
    }

    const userText = transcription.text.trim();
    logger.debug(`Transcribed: "${userText}"`);

    // Add to chat log (for end-of-conversation summary)
    session.chatLog.push({
      role: 'user',
      content: userText,
      timestamp: new Date(),
    });

    // Add to AI conversation history
    session.history.push({
      role: 'user',
      content: userText,
    });

    // Get AI response
    logger.debug('Getting AI response...');
    await session.textChannel.sendTyping();

    const aiResponse = await chat(userText, {
      history: session.history.slice(-10), // Keep last 10 messages for context
      maxTokens: 500, // Keep responses concise
      temperature: 0.7,
    });

    // Add AI response to history
    session.history.push({
      role: 'assistant',
      content: aiResponse.text,
    });

    // Add to chat log
    session.chatLog.push({
      role: 'assistant',
      content: aiResponse.text,
      timestamp: new Date(),
    });

    // Get settings for response handling
    const postToChat = await getSetting<boolean>(session.guildId, 'post_responses_to_chat', true);
    const ttsEnabled = await getSetting<boolean>(session.guildId, 'tts_enabled', true);
    const ttsVoice = await getSetting<string>(session.guildId, 'tts_voice', 'nova');
    const ttsSpeed = await getSetting<number>(session.guildId, 'tts_speed', 1.0);

    // Send response to chat, mentioning the user (if enabled)
    if (postToChat) {
      await session.textChannel.send({
        content: `<@${session.userId}> ${aiResponse.text}`,
      });
    }

    // Speak the response if TTS is available and enabled
    if (ttsEnabled && getTTSRegistry().hasConfiguredProvider()) {
      try {
        logger.debug(`Synthesizing speech with voice: ${ttsVoice}, speed: ${ttsSpeed}...`);
        const ttsResult = await synthesize(aiResponse.text, {
          voice: ttsVoice,
          speed: ttsSpeed,
          format: 'mp3',
        });

        logger.debug(`TTS complete: ${ttsResult.audio.length} bytes`);

        // Play the audio in voice channel
        await session.recorder.playAudioBuffer(ttsResult.audio, ttsResult.format);
        logger.debug('Audio playback complete');
      } catch (ttsError) {
        logger.error('TTS error:', ttsError);
        // Don't fail the whole response if TTS fails
      }
    }

    logger.debug(`Response sent (${aiResponse.usage?.outputTokens || '?'} tokens)`);
  } catch (error) {
    logger.error('Error processing audio:', error);

    try {
      await session.textChannel.send({
        content: `Sorry, I had trouble processing that. Please try again.`,
      });
    } catch {
      // Ignore send errors
    }

    // Clean up on error
    cleanupFile(filePath);
  } finally {
    session.isProcessing = false;
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
 * Get info about configured providers
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

/**
 * Format a chat log into a readable string for posting
 */
export function formatChatLog(chatLog: ChatMessage[], userName: string): string {
  if (chatLog.length === 0) {
    return '*No messages exchanged*';
  }

  const lines: string[] = [];
  for (const msg of chatLog) {
    const speaker = msg.role === 'user' ? userName : 'Nimrod';
    lines.push(`**${speaker}:** ${msg.content}`);
  }

  return lines.join('\n');
}
