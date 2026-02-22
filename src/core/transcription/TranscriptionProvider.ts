/**
 * Transcription Provider Interface
 *
 * Abstraction layer for speech-to-text services.
 * Implementations can use Google Speech-to-Text, OpenAI Whisper, etc.
 */

import { Logger } from '../../shared/utils/logger.js';

const logger = new Logger('Transcription');

export interface TranscriptionResult {
  /** The transcribed text */
  text: string;
  /** Confidence score (0-1) if available */
  confidence?: number;
  /** Language detected/used */
  language?: string;
  /** Duration of audio in seconds */
  durationSeconds?: number;
  /** Provider that was used */
  provider: string;
}

export interface TranscriptionOptions {
  /** Language code (e.g., 'en-US', 'es-ES') */
  language?: string;
  /** Enable profanity filter */
  profanityFilter?: boolean;
  /** Enable punctuation */
  enablePunctuation?: boolean;
}

export interface TranscriptionProvider {
  /** Provider name for logging/display */
  readonly name: string;

  /** Check if the provider is properly configured */
  isConfigured(): boolean;

  /** Transcribe audio from a file path */
  transcribe(audioPath: string, options?: TranscriptionOptions): Promise<TranscriptionResult>;

  /** Transcribe audio from a buffer */
  transcribeBuffer(buffer: Buffer, mimeType: string, options?: TranscriptionOptions): Promise<TranscriptionResult>;
}

/**
 * Registry of available transcription providers
 */
class TranscriptionRegistry {
  private providers: Map<string, TranscriptionProvider> = new Map();
  private defaultProviderId: string | null = null;

  register(id: string, provider: TranscriptionProvider): void {
    this.providers.set(id, provider);
    logger.debug(`Registered transcription provider: ${id} (${provider.name})`);

    // Set as default if it's the first configured provider
    if (!this.defaultProviderId && provider.isConfigured()) {
      this.defaultProviderId = id;
      logger.info(`Default transcription provider: ${provider.name}`);
    }
  }

  unregister(id: string): void {
    this.providers.delete(id);
    if (this.defaultProviderId === id) {
      // Find next configured provider
      this.defaultProviderId = null;
      for (const [pid, p] of this.providers) {
        if (p.isConfigured()) {
          this.defaultProviderId = pid;
          break;
        }
      }
    }
  }

  get(id: string): TranscriptionProvider | undefined {
    return this.providers.get(id);
  }

  getDefault(): TranscriptionProvider | undefined {
    if (this.defaultProviderId) {
      return this.providers.get(this.defaultProviderId);
    }
    return undefined;
  }

  setDefault(id: string): boolean {
    const provider = this.providers.get(id);
    if (provider && provider.isConfigured()) {
      this.defaultProviderId = id;
      logger.info(`Default transcription provider changed to: ${provider.name}`);
      return true;
    }
    return false;
  }

  listProviders(): Array<{ id: string; name: string; configured: boolean; isDefault: boolean }> {
    return Array.from(this.providers.entries()).map(([id, provider]) => ({
      id,
      name: provider.name,
      configured: provider.isConfigured(),
      isDefault: id === this.defaultProviderId,
    }));
  }

  hasConfiguredProvider(): boolean {
    return this.defaultProviderId !== null;
  }
}

// Singleton registry
let registry: TranscriptionRegistry | null = null;

export function getTranscriptionRegistry(): TranscriptionRegistry {
  if (!registry) {
    registry = new TranscriptionRegistry();
  }
  return registry;
}

/**
 * Convenience function to transcribe using the default provider
 */
export async function transcribe(
  audioPath: string,
  options?: TranscriptionOptions
): Promise<TranscriptionResult> {
  const provider = getTranscriptionRegistry().getDefault();
  if (!provider) {
    throw new Error('No transcription provider configured');
  }
  return provider.transcribe(audioPath, options);
}

/**
 * Convenience function to transcribe a buffer using the default provider
 */
export async function transcribeBuffer(
  buffer: Buffer,
  mimeType: string,
  options?: TranscriptionOptions
): Promise<TranscriptionResult> {
  const provider = getTranscriptionRegistry().getDefault();
  if (!provider) {
    throw new Error('No transcription provider configured');
  }
  return provider.transcribeBuffer(buffer, mimeType, options);
}
