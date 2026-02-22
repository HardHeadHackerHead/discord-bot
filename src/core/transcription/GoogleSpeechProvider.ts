/**
 * Google Cloud Speech-to-Text Provider
 *
 * Uses Google's Speech-to-Text API for transcription.
 * Free tier: 60 minutes/month
 *
 * Required environment variable:
 * - GOOGLE_SPEECH_API_KEY or GOOGLE_APPLICATION_CREDENTIALS
 */

import { readFileSync } from 'fs';
import { Logger } from '../../shared/utils/logger.js';
import {
  TranscriptionProvider,
  TranscriptionResult,
  TranscriptionOptions,
  getTranscriptionRegistry,
} from './TranscriptionProvider.js';

const logger = new Logger('GoogleSpeech');

export class GoogleSpeechProvider implements TranscriptionProvider {
  readonly name = 'Google Speech-to-Text';
  private apiKey: string | null = null;

  constructor() {
    this.apiKey = process.env['GOOGLE_SPEECH_API_KEY'] || null;

    if (this.apiKey) {
      logger.info('Google Speech-to-Text provider initialized with API key');
    } else {
      logger.warn('GOOGLE_SPEECH_API_KEY not set - Google Speech provider disabled');
    }
  }

  isConfigured(): boolean {
    return this.apiKey !== null;
  }

  async transcribe(audioPath: string, options?: TranscriptionOptions): Promise<TranscriptionResult> {
    if (!this.apiKey) {
      throw new Error('Google Speech API key not configured');
    }

    // Read the audio file and convert to base64
    const audioBuffer = readFileSync(audioPath);
    const audioBase64 = audioBuffer.toString('base64');

    // Determine encoding based on file extension
    const encoding = this.getEncodingFromPath(audioPath);

    return this.doTranscribe(audioBase64, encoding, options);
  }

  async transcribeBuffer(
    buffer: Buffer,
    mimeType: string,
    options?: TranscriptionOptions
  ): Promise<TranscriptionResult> {
    if (!this.apiKey) {
      throw new Error('Google Speech API key not configured');
    }

    const audioBase64 = buffer.toString('base64');
    const encoding = this.getEncodingFromMimeType(mimeType);

    return this.doTranscribe(audioBase64, encoding, options);
  }

  private async doTranscribe(
    audioBase64: string,
    encoding: string,
    options?: TranscriptionOptions
  ): Promise<TranscriptionResult> {
    const languageCode = options?.language || 'en-US';

    // Build the request body
    const requestBody = {
      config: {
        encoding,
        sampleRateHertz: 48000, // Discord audio is 48kHz
        languageCode,
        enableAutomaticPunctuation: options?.enablePunctuation ?? true,
        profanityFilter: options?.profanityFilter ?? false,
        model: 'latest_short', // Optimized for short audio clips
      },
      audio: {
        content: audioBase64,
      },
    };

    const url = `https://speech.googleapis.com/v1/speech:recognize?key=${this.apiKey}`;

    logger.debug(`Sending transcription request (${Math.round(audioBase64.length / 1024)}KB)`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Google Speech API error:', errorText);
      throw new Error(`Google Speech API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as GoogleSpeechResponse;

    // Extract the transcription
    if (!data.results || data.results.length === 0) {
      logger.debug('No speech detected in audio');
      return {
        text: '',
        confidence: 0,
        language: languageCode,
        provider: this.name,
      };
    }

    // Combine all results
    const fullText = data.results
      .map((result) => result.alternatives?.[0]?.transcript || '')
      .join(' ')
      .trim();

    // Get average confidence
    const confidences = data.results
      .map((result) => result.alternatives?.[0]?.confidence || 0)
      .filter((c) => c > 0);
    const avgConfidence =
      confidences.length > 0
        ? confidences.reduce((a, b) => a + b, 0) / confidences.length
        : undefined;

    logger.debug(`Transcription complete: "${fullText.substring(0, 50)}..."`);

    return {
      text: fullText,
      confidence: avgConfidence,
      language: languageCode,
      provider: this.name,
    };
  }

  private getEncodingFromPath(path: string): string {
    const ext = path.toLowerCase().split('.').pop();
    switch (ext) {
      case 'mp3':
        return 'MP3';
      case 'wav':
        return 'LINEAR16';
      case 'flac':
        return 'FLAC';
      case 'ogg':
        return 'OGG_OPUS';
      case 'pcm':
        return 'LINEAR16';
      default:
        return 'MP3'; // Default to MP3
    }
  }

  private getEncodingFromMimeType(mimeType: string): string {
    switch (mimeType) {
      case 'audio/mp3':
      case 'audio/mpeg':
        return 'MP3';
      case 'audio/wav':
      case 'audio/x-wav':
        return 'LINEAR16';
      case 'audio/flac':
        return 'FLAC';
      case 'audio/ogg':
        return 'OGG_OPUS';
      case 'audio/pcm':
      case 'audio/l16':
        return 'LINEAR16';
      default:
        return 'MP3';
    }
  }
}

// Google Speech API response types
interface GoogleSpeechResponse {
  results?: Array<{
    alternatives?: Array<{
      transcript?: string;
      confidence?: number;
    }>;
  }>;
}

/**
 * Initialize and register the Google Speech provider
 */
export function initGoogleSpeechProvider(): GoogleSpeechProvider {
  const provider = new GoogleSpeechProvider();
  getTranscriptionRegistry().register('google', provider);
  return provider;
}
