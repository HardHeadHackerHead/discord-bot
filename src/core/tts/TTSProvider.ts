/**
 * Text-to-Speech Provider Interface
 *
 * Abstraction layer for TTS services.
 * Implementations can use OpenAI TTS, Google Cloud TTS, ElevenLabs, etc.
 */

import { Logger } from '../../shared/utils/logger.js';

const logger = new Logger('TTS');

export interface TTSResult {
  /** The audio data as a Buffer */
  audio: Buffer;
  /** Audio format (mp3, wav, opus, etc.) */
  format: string;
  /** Duration in seconds (if known) */
  durationSeconds?: number;
  /** Provider that was used */
  provider: string;
}

export interface TTSOptions {
  /** Voice ID or name to use */
  voice?: string;
  /** Speech speed (0.25 to 4.0, default 1.0) */
  speed?: number;
  /** Output format preference */
  format?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm';
}

export interface TTSVoice {
  id: string;
  name: string;
  language?: string;
  gender?: 'male' | 'female' | 'neutral';
}

export interface TTSProvider {
  /** Provider name for logging/display */
  readonly name: string;

  /** Check if the provider is properly configured */
  isConfigured(): boolean;

  /** Get available voices */
  getVoices(): TTSVoice[];

  /** Get the default voice ID */
  getDefaultVoice(): string;

  /** Convert text to speech */
  synthesize(text: string, options?: TTSOptions): Promise<TTSResult>;
}

/**
 * Registry of available TTS providers
 */
class TTSRegistry {
  private providers: Map<string, TTSProvider> = new Map();
  private defaultProviderId: string | null = null;

  register(id: string, provider: TTSProvider): void {
    this.providers.set(id, provider);
    logger.debug(`Registered TTS provider: ${id} (${provider.name})`);

    // Set as default if it's the first configured provider
    if (!this.defaultProviderId && provider.isConfigured()) {
      this.defaultProviderId = id;
      logger.info(`Default TTS provider: ${provider.name}`);
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

  get(id: string): TTSProvider | undefined {
    return this.providers.get(id);
  }

  getDefault(): TTSProvider | undefined {
    if (this.defaultProviderId) {
      return this.providers.get(this.defaultProviderId);
    }
    return undefined;
  }

  setDefault(id: string): boolean {
    const provider = this.providers.get(id);
    if (provider && provider.isConfigured()) {
      this.defaultProviderId = id;
      logger.info(`Default TTS provider changed to: ${provider.name}`);
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
let registry: TTSRegistry | null = null;

export function getTTSRegistry(): TTSRegistry {
  if (!registry) {
    registry = new TTSRegistry();
  }
  return registry;
}

/**
 * Convenience function to synthesize speech using the default provider
 */
export async function synthesize(text: string, options?: TTSOptions): Promise<TTSResult> {
  const provider = getTTSRegistry().getDefault();
  if (!provider) {
    throw new Error('No TTS provider configured');
  }
  return provider.synthesize(text, options);
}

/**
 * Convenience function to get available voices from the default provider
 */
export function getVoices(): TTSVoice[] {
  const provider = getTTSRegistry().getDefault();
  if (!provider) {
    return [];
  }
  return provider.getVoices();
}
