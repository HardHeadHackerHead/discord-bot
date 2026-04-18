import { BaseModule, ModuleMetadata, ModuleContext } from '../../types/module.types.js';
import { command as meetingCommand } from './commands/meeting.js';
import { Logger } from '../../shared/utils/logger.js';
import { initGoogleSpeechProvider, initWhisperProvider } from '../../core/transcription/index.js';
import { initClaudeProvider, initOpenAIProvider } from '../../core/ai/index.js';
import { initOpenAITTSProvider } from '../../core/tts/index.js';
import { stopMeeting, getActiveMeetings } from './services/MeetingService.js';
import { getModuleSettingsService } from '../../core/settings/ModuleSettingsService.js';
import type { ModuleSettingsSchema } from '../../core/settings/SettingsDefinition.js';

const logger = new Logger('Meeting');

/**
 * Meeting Module Settings Schema
 */
const MEETING_SETTINGS: ModuleSettingsSchema = {
  moduleId: 'meeting',
  moduleName: 'Meeting Recording',
  settings: [
    {
      key: 'announcement_enabled',
      name: 'Recording Announcement',
      description: 'Play an audio announcement when recording starts',
      type: 'boolean',
      defaultValue: true,
      category: 'recording',
    },
    {
      key: 'announcement_voice',
      name: 'Announcement Voice',
      description: 'Voice used for recording announcements',
      type: 'select',
      defaultValue: 'nova',
      category: 'recording',
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
      key: 'summary_enabled',
      name: 'AI Summary',
      description: 'Generate an AI summary at the end of the meeting',
      type: 'boolean',
      defaultValue: true,
      category: 'summary',
    },
    {
      key: 'transcript_enabled',
      name: 'Full Transcript',
      description: 'Include the full transcript in the meeting summary',
      type: 'boolean',
      defaultValue: true,
      category: 'summary',
    },
    {
      key: 'silence_duration',
      name: 'Silence Duration',
      description: 'Milliseconds of silence before speech segment ends',
      type: 'number',
      defaultValue: 1500,
      min: 500,
      max: 5000,
      category: 'recording',
    },
  ],
};

/**
 * Meeting Recording Module
 *
 * Records all participants in a voice channel, transcribes
 * the conversation, and provides an AI-generated summary.
 */
export class MeetingModule extends BaseModule {
  readonly metadata: ModuleMetadata = {
    id: 'meeting',
    name: 'Meeting Recording',
    description: 'Record voice meetings with transcription and AI summaries',
    version: '0.1.0',
    author: 'QuadsLab',
    isCore: false,
    isPublic: false, // Hidden until stable
    dependencies: [],
    priority: 100,
  };

  constructor() {
    super();
    this.commands = [meetingCommand];
  }

  async onLoad(context: ModuleContext): Promise<void> {
    await super.onLoad(context);

    // Register settings schema
    const settingsService = getModuleSettingsService();
    if (settingsService) {
      settingsService.registerSchema(MEETING_SETTINGS);
    }

    // Initialize all available providers
    // Transcription providers
    initWhisperProvider();
    initGoogleSpeechProvider();

    // AI providers (for summaries)
    initOpenAIProvider();
    initClaudeProvider();

    // TTS providers (for announcements)
    initOpenAITTSProvider();

    logger.info('Meeting module loaded (EXPERIMENTAL)');
  }

  async onUnload(): Promise<void> {
    // Stop any active meetings
    const activeMeetings = getActiveMeetings();
    for (const [guildId] of activeMeetings) {
      stopMeeting(guildId);
    }

    // Unregister settings schema
    const settingsService = getModuleSettingsService();
    if (settingsService) {
      settingsService.unregisterSchema(this.metadata.id);
    }

    logger.info('Meeting module unloaded');
  }
}
