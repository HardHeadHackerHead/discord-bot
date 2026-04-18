import { BaseModule, ModuleMetadata, ModuleContext } from '../../types/module.types.js';
import { command as convoCommand } from './commands/convo.js';
import { Logger } from '../../shared/utils/logger.js';
import { initGoogleSpeechProvider, initWhisperProvider } from '../../core/transcription/index.js';
import { initClaudeProvider, initOpenAIProvider } from '../../core/ai/index.js';
import { initOpenAITTSProvider } from '../../core/tts/index.js';
import { stopConversation } from './services/VoiceAIService.js';
import { destroyVoiceRecorder } from '../../core/voice/VoiceRecorder.js';
import { getModuleSettingsService } from '../../core/settings/ModuleSettingsService.js';
import type { ModuleSettingsSchema } from '../../core/settings/SettingsDefinition.js';

const logger = new Logger('VoiceAI');

/**
 * Voice AI Settings Schema
 */
const VOICE_AI_SETTINGS: ModuleSettingsSchema = {
  moduleId: 'voice-ai',
  moduleName: 'Voice AI',
  settings: [
    {
      key: 'tts_voice',
      name: 'TTS Voice',
      description: 'The voice used for text-to-speech responses',
      type: 'select',
      defaultValue: 'nova',
      category: 'tts',
      options: [
        { value: 'alloy', label: 'Alloy', description: 'Neutral voice' },
        { value: 'echo', label: 'Echo', description: 'Male voice' },
        { value: 'fable', label: 'Fable', description: 'Neutral voice' },
        { value: 'onyx', label: 'Onyx', description: 'Male voice' },
        { value: 'nova', label: 'Nova', description: 'Female voice (default)' },
        { value: 'shimmer', label: 'Shimmer', description: 'Female voice' },
      ],
    },
    {
      key: 'tts_speed',
      name: 'TTS Speed',
      description: 'Speech speed (0.25 to 4.0, default 1.0)',
      type: 'number',
      defaultValue: 1.0,
      min: 0.25,
      max: 4.0,
      category: 'tts',
    },
    {
      key: 'tts_enabled',
      name: 'TTS Enabled',
      description: 'Whether to speak responses in voice channel',
      type: 'boolean',
      defaultValue: true,
      category: 'tts',
    },
    {
      key: 'silence_duration',
      name: 'Silence Duration',
      description: 'Milliseconds of silence before speech is considered finished',
      type: 'number',
      defaultValue: 1500,
      min: 500,
      max: 5000,
      category: 'recording',
    },
    {
      key: 'post_responses_to_chat',
      name: 'Post to Chat',
      description: 'Whether to post AI responses in the text channel',
      type: 'boolean',
      defaultValue: true,
      category: 'chat',
    },
  ],
};

/**
 * Voice AI Module - EXPERIMENTAL
 *
 * Allows users to have voice conversations with AI:
 * 1. User speaks in voice channel
 * 2. Speech is transcribed to text
 * 3. Text is sent to AI
 * 4. Response is posted in chat
 *
 * Supported providers (set API key to enable):
 *
 * Transcription:
 * - OPENAI_API_KEY -> OpenAI Whisper (recommended)
 * - GOOGLE_SPEECH_API_KEY -> Google Speech-to-Text
 *
 * AI:
 * - OPENAI_API_KEY -> OpenAI GPT
 * - ANTHROPIC_API_KEY -> Anthropic Claude
 *
 * Text-to-Speech:
 * - OPENAI_API_KEY -> OpenAI TTS
 */
export class VoiceAIModule extends BaseModule {
  readonly metadata: ModuleMetadata = {
    id: 'voice-ai',
    name: 'Voice AI',
    description: 'Voice conversations with AI using speech-to-text and Claude',
    version: '0.1.0',
    author: 'QuadsLab',
    isCore: false,
    isPublic: false, // Hidden until stable
    dependencies: [],
    priority: 100,
  };

  constructor() {
    super();
    this.commands = [convoCommand];
  }

  async onLoad(context: ModuleContext): Promise<void> {
    await super.onLoad(context);

    // Register settings schema
    const settingsService = getModuleSettingsService();
    if (settingsService) {
      settingsService.registerSchema(VOICE_AI_SETTINGS);
    }

    // Initialize all available providers
    // The first configured provider becomes the default
    // OpenAI providers are initialized first (preferred if available)

    // Transcription providers
    initWhisperProvider();
    initGoogleSpeechProvider();

    // AI providers
    initOpenAIProvider();
    initClaudeProvider();

    // TTS providers
    initOpenAITTSProvider();

    logger.info('Voice AI module loaded (EXPERIMENTAL)');
  }

  async onUnload(): Promise<void> {
    // Stop any active conversations
    if (this.context) {
      for (const guild of this.context.client.guilds.cache.values()) {
        stopConversation(guild.id);
      }
    }

    // Unregister settings schema
    const settingsService = getModuleSettingsService();
    if (settingsService) {
      settingsService.unregisterSchema(this.metadata.id);
    }

    // Clean up voice recorder
    destroyVoiceRecorder();

    logger.info('Voice AI module unloaded');
  }
}
