/**
 * OpenAI Text-to-Speech Provider
 *
 * Uses OpenAI's TTS API to convert text to speech.
 * Requires OPENAI_API_KEY environment variable.
 */

import { Logger } from '../../shared/utils/logger.js';
import type { TTSProvider, TTSResult, TTSOptions, TTSVoice } from './TTSProvider.js';
import { getTTSRegistry } from './TTSProvider.js';

const logger = new Logger('OpenAI-TTS');

// OpenAI TTS voices
const OPENAI_VOICES: TTSVoice[] = [
  { id: 'alloy', name: 'Alloy', gender: 'neutral' },
  { id: 'echo', name: 'Echo', gender: 'male' },
  { id: 'fable', name: 'Fable', gender: 'neutral' },
  { id: 'onyx', name: 'Onyx', gender: 'male' },
  { id: 'nova', name: 'Nova', gender: 'female' },
  { id: 'shimmer', name: 'Shimmer', gender: 'female' },
];

export interface OpenAITTSOptions {
  apiKey?: string;
  defaultVoice?: string;
  defaultModel?: 'tts-1' | 'tts-1-hd';
}

export class OpenAITTSProvider implements TTSProvider {
  readonly name = 'OpenAI TTS';
  private apiKey: string | null;
  private defaultVoice: string;
  private defaultModel: string;

  constructor(options: OpenAITTSOptions = {}) {
    this.apiKey = options.apiKey || process.env['OPENAI_API_KEY'] || null;
    this.defaultVoice = options.defaultVoice || 'nova';
    this.defaultModel = options.defaultModel || 'tts-1';
  }

  isConfigured(): boolean {
    return this.apiKey !== null && this.apiKey.length > 0;
  }

  getVoices(): TTSVoice[] {
    return OPENAI_VOICES;
  }

  getDefaultVoice(): string {
    return this.defaultVoice;
  }

  async synthesize(text: string, options?: TTSOptions): Promise<TTSResult> {
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const voice = options?.voice || this.defaultVoice;
    const speed = options?.speed || 1.0;
    const format = options?.format || 'mp3';

    // Map our format to OpenAI's response_format
    const responseFormat = this.mapFormat(format);

    logger.debug(`Synthesizing speech: "${text.substring(0, 50)}..." with voice ${voice}`);

    try {
      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.defaultModel,
          input: text,
          voice: voice,
          speed: speed,
          response_format: responseFormat,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI TTS API error: ${response.status} - ${errorText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const audio = Buffer.from(arrayBuffer);

      logger.debug(`TTS complete: ${audio.length} bytes (${format})`);

      return {
        audio,
        format: format,
        provider: this.name,
      };
    } catch (error) {
      logger.error('OpenAI TTS error:', error);
      throw error;
    }
  }

  private mapFormat(format: string): string {
    // OpenAI supports: mp3, opus, aac, flac, wav, pcm
    const validFormats = ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'];
    if (validFormats.includes(format)) {
      return format;
    }
    return 'mp3'; // Default fallback
  }
}

/**
 * Initialize and register the OpenAI TTS provider
 */
export function initOpenAITTSProvider(options?: OpenAITTSOptions): OpenAITTSProvider {
  const provider = new OpenAITTSProvider(options);
  getTTSRegistry().register('openai', provider);

  if (provider.isConfigured()) {
    logger.info('OpenAI TTS provider initialized');
  } else {
    logger.debug('OpenAI TTS provider not configured (missing OPENAI_API_KEY)');
  }

  return provider;
}
