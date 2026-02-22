/**
 * TTS Module Exports
 */

export type { TTSProvider, TTSResult, TTSOptions, TTSVoice } from './TTSProvider.js';

export { getTTSRegistry, synthesize, getVoices } from './TTSProvider.js';

export type { OpenAITTSOptions } from './OpenAITTSProvider.js';
export { OpenAITTSProvider, initOpenAITTSProvider } from './OpenAITTSProvider.js';
