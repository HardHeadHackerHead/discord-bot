/**
 * OpenAI Whisper Transcription Provider
 *
 * Uses OpenAI's Whisper API for speech-to-text transcription.
 * Generally more accurate than Google Speech-to-Text.
 *
 * Required environment variable:
 * - OPENAI_API_KEY
 */

import { readFileSync } from 'fs';
import { Logger } from '../../shared/utils/logger.js';
import {
  TranscriptionProvider,
  TranscriptionResult,
  TranscriptionOptions,
  getTranscriptionRegistry,
} from './TranscriptionProvider.js';
import path from 'path';

const logger = new Logger('Whisper');

export class WhisperProvider implements TranscriptionProvider {
  readonly name = 'OpenAI Whisper';
  private apiKey: string | null = null;

  constructor() {
    this.apiKey = process.env['OPENAI_API_KEY'] || null;

    if (this.apiKey) {
      logger.info('OpenAI Whisper provider initialized');
    } else {
      logger.warn('OPENAI_API_KEY not set - Whisper provider disabled');
    }
  }

  isConfigured(): boolean {
    return this.apiKey !== null;
  }

  async transcribe(audioPath: string, options?: TranscriptionOptions): Promise<TranscriptionResult> {
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    // Read the audio file
    const audioBuffer = readFileSync(audioPath);
    const filename = path.basename(audioPath);

    return this.doTranscribe(audioBuffer, filename, options);
  }

  async transcribeBuffer(
    buffer: Buffer,
    mimeType: string,
    options?: TranscriptionOptions
  ): Promise<TranscriptionResult> {
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    // Determine file extension from mime type
    const ext = this.getExtensionFromMimeType(mimeType);
    const filename = `audio.${ext}`;

    return this.doTranscribe(buffer, filename, options);
  }

  private async doTranscribe(
    audioBuffer: Buffer,
    filename: string,
    options?: TranscriptionOptions
  ): Promise<TranscriptionResult> {
    const language = options?.language?.split('-')[0] || 'en'; // Whisper uses 2-letter codes

    // Create form data
    const formData = new FormData();
    const blob = new Blob([audioBuffer], { type: this.getMimeTypeFromFilename(filename) });
    formData.append('file', blob, filename);
    formData.append('model', 'whisper-1');
    formData.append('language', language);
    formData.append('response_format', 'verbose_json');

    logger.debug(`Sending transcription request (${Math.round(audioBuffer.length / 1024)}KB)`);

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Whisper API error:', errorText);
      throw new Error(`Whisper API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as WhisperResponse;

    if (!data.text || data.text.trim().length === 0) {
      logger.debug('No speech detected in audio');
      return {
        text: '',
        confidence: 0,
        language,
        provider: this.name,
      };
    }

    logger.debug(`Transcription complete: "${data.text.substring(0, 50)}..."`);

    return {
      text: data.text.trim(),
      language: data.language || language,
      durationSeconds: data.duration,
      provider: this.name,
    };
  }

  private getExtensionFromMimeType(mimeType: string): string {
    switch (mimeType) {
      case 'audio/mp3':
      case 'audio/mpeg':
        return 'mp3';
      case 'audio/wav':
      case 'audio/x-wav':
        return 'wav';
      case 'audio/flac':
        return 'flac';
      case 'audio/ogg':
        return 'ogg';
      case 'audio/webm':
        return 'webm';
      case 'audio/mp4':
      case 'audio/m4a':
        return 'm4a';
      default:
        return 'mp3';
    }
  }

  private getMimeTypeFromFilename(filename: string): string {
    const ext = filename.toLowerCase().split('.').pop();
    switch (ext) {
      case 'mp3':
        return 'audio/mpeg';
      case 'wav':
        return 'audio/wav';
      case 'flac':
        return 'audio/flac';
      case 'ogg':
        return 'audio/ogg';
      case 'webm':
        return 'audio/webm';
      case 'm4a':
        return 'audio/m4a';
      default:
        return 'audio/mpeg';
    }
  }
}

// Whisper API response types
interface WhisperResponse {
  text: string;
  language?: string;
  duration?: number;
  segments?: Array<{
    text: string;
    start: number;
    end: number;
  }>;
}

/**
 * Initialize and register the Whisper provider
 */
export function initWhisperProvider(): WhisperProvider {
  const provider = new WhisperProvider();
  getTranscriptionRegistry().register('whisper', provider);
  return provider;
}
