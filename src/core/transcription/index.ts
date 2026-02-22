/**
 * Transcription Module Exports
 */

export type {
  TranscriptionProvider,
  TranscriptionResult,
  TranscriptionOptions,
} from './TranscriptionProvider.js';

export { getTranscriptionRegistry, transcribe, transcribeBuffer } from './TranscriptionProvider.js';

export { GoogleSpeechProvider, initGoogleSpeechProvider } from './GoogleSpeechProvider.js';
export { WhisperProvider, initWhisperProvider } from './WhisperProvider.js';
