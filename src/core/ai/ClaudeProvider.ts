/**
 * Claude AI Provider
 *
 * Uses Anthropic's Claude API for AI responses.
 *
 * Required environment variable:
 * - ANTHROPIC_API_KEY
 */

import { Logger } from '../../shared/utils/logger.js';
import {
  AIProvider,
  AIMessage,
  AIResponse,
  AIRequestOptions,
  getAIRegistry,
} from './AIProvider.js';

const logger = new Logger('Claude');

export interface ClaudeProviderOptions {
  /** Default model to use */
  model?: string;
  /** Default max tokens */
  maxTokens?: number;
  /** Default temperature */
  temperature?: number;
}

export class ClaudeProvider implements AIProvider {
  readonly name = 'Claude (Anthropic)';
  private apiKey: string | null = null;
  private defaultModel: string;
  private defaultMaxTokens: number;
  private defaultTemperature: number;

  constructor(options?: ClaudeProviderOptions) {
    this.apiKey = process.env['ANTHROPIC_API_KEY'] || null;
    this.defaultModel = options?.model || 'claude-sonnet-4-20250514';
    this.defaultMaxTokens = options?.maxTokens || 1024;
    this.defaultTemperature = options?.temperature || 0.7;

    if (this.apiKey) {
      logger.info(`Claude provider initialized (model: ${this.defaultModel})`);
    } else {
      logger.warn('ANTHROPIC_API_KEY not set - Claude provider disabled');
    }
  }

  isConfigured(): boolean {
    return this.apiKey !== null;
  }

  async chat(userMessage: string, options?: AIRequestOptions): Promise<AIResponse> {
    const messages: AIMessage[] = [];

    // Add history if provided
    if (options?.history) {
      messages.push(...options.history);
    }

    // Add the user's message
    messages.push({ role: 'user', content: userMessage });

    return this.chatWithHistory(messages, options);
  }

  async chatWithHistory(messages: AIMessage[], options?: AIRequestOptions): Promise<AIResponse> {
    if (!this.apiKey) {
      throw new Error('Anthropic API key not configured');
    }

    const model = this.defaultModel;
    const maxTokens = options?.maxTokens || this.defaultMaxTokens;
    const temperature = options?.temperature ?? this.defaultTemperature;

    // Separate system message from conversation
    const systemPrompt = options?.systemPrompt || this.getDefaultSystemPrompt();

    // Convert messages to Anthropic format (filter out system messages from history)
    const anthropicMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    const requestBody = {
      model,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: anthropicMessages,
    };

    logger.debug(`Sending request to Claude (${anthropicMessages.length} messages)`);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Claude API error:', errorText);
      throw new Error(`Claude API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as ClaudeResponse;

    // Extract the response text
    const text = data.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    logger.debug(`Claude response: "${text.substring(0, 50)}..."`);

    return {
      text,
      usage: {
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
      },
      provider: this.name,
      model: data.model,
    };
  }

  private getDefaultSystemPrompt(): string {
    return `You are a helpful AI assistant in a Discord voice channel. Users are speaking to you verbally, and their speech has been transcribed to text.

Keep your responses:
- Concise and conversational (this will be read in chat or spoken back)
- Friendly and natural
- Under 200 words unless more detail is needed

If the transcription seems garbled or unclear, politely ask for clarification.`;
  }
}

// Claude API response types
interface ClaudeResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{
    type: string;
    text: string;
  }>;
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

/**
 * Initialize and register the Claude provider
 */
export function initClaudeProvider(options?: ClaudeProviderOptions): ClaudeProvider {
  const provider = new ClaudeProvider(options);
  getAIRegistry().register('claude', provider);
  return provider;
}
