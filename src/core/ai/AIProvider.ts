/**
 * AI Provider Interface
 *
 * Abstraction layer for AI/LLM services.
 * Implementations can use Claude, OpenAI GPT, etc.
 */

import { Logger } from '../../shared/utils/logger.js';

const logger = new Logger('AI');

export interface AIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AIResponse {
  /** The generated response text */
  text: string;
  /** Token usage information if available */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  /** Provider that was used */
  provider: string;
  /** Model that was used */
  model: string;
}

export interface AIRequestOptions {
  /** System prompt to set context */
  systemPrompt?: string;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Temperature (0-1, lower = more deterministic) */
  temperature?: number;
  /** Conversation history for context */
  history?: AIMessage[];
}

export interface AIProvider {
  /** Provider name for logging/display */
  readonly name: string;

  /** Check if the provider is properly configured */
  isConfigured(): boolean;

  /** Generate a response to a user message */
  chat(userMessage: string, options?: AIRequestOptions): Promise<AIResponse>;

  /** Generate a response with full message history */
  chatWithHistory(messages: AIMessage[], options?: AIRequestOptions): Promise<AIResponse>;
}

/**
 * Registry of available AI providers
 */
class AIRegistry {
  private providers: Map<string, AIProvider> = new Map();
  private defaultProviderId: string | null = null;

  register(id: string, provider: AIProvider): void {
    this.providers.set(id, provider);
    logger.debug(`Registered AI provider: ${id} (${provider.name})`);

    // Set as default if it's the first configured provider
    if (!this.defaultProviderId && provider.isConfigured()) {
      this.defaultProviderId = id;
      logger.info(`Default AI provider: ${provider.name}`);
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

  get(id: string): AIProvider | undefined {
    return this.providers.get(id);
  }

  getDefault(): AIProvider | undefined {
    if (this.defaultProviderId) {
      return this.providers.get(this.defaultProviderId);
    }
    return undefined;
  }

  setDefault(id: string): boolean {
    const provider = this.providers.get(id);
    if (provider && provider.isConfigured()) {
      this.defaultProviderId = id;
      logger.info(`Default AI provider changed to: ${provider.name}`);
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
let registry: AIRegistry | null = null;

export function getAIRegistry(): AIRegistry {
  if (!registry) {
    registry = new AIRegistry();
  }
  return registry;
}

/**
 * Convenience function to chat using the default provider
 */
export async function chat(userMessage: string, options?: AIRequestOptions): Promise<AIResponse> {
  const provider = getAIRegistry().getDefault();
  if (!provider) {
    throw new Error('No AI provider configured');
  }
  return provider.chat(userMessage, options);
}

/**
 * Convenience function to chat with history using the default provider
 */
export async function chatWithHistory(
  messages: AIMessage[],
  options?: AIRequestOptions
): Promise<AIResponse> {
  const provider = getAIRegistry().getDefault();
  if (!provider) {
    throw new Error('No AI provider configured');
  }
  return provider.chatWithHistory(messages, options);
}
