/**
 * OpenAI GPT Provider
 *
 * Uses OpenAI's Chat Completions API for AI responses.
 *
 * Required environment variable:
 * - OPENAI_API_KEY
 */

import { Logger } from '../../shared/utils/logger.js';
import {
  AIProvider,
  AIMessage,
  AIResponse,
  AIRequestOptions,
  getAIRegistry,
} from './AIProvider.js';

const logger = new Logger('OpenAI');

export interface OpenAIProviderOptions {
  /** Default model to use */
  model?: string;
  /** Default max tokens */
  maxTokens?: number;
  /** Default temperature */
  temperature?: number;
}

export class OpenAIProvider implements AIProvider {
  readonly name = 'OpenAI GPT';
  private apiKey: string | null = null;
  private defaultModel: string;
  private defaultMaxTokens: number;
  private defaultTemperature: number;

  constructor(options?: OpenAIProviderOptions) {
    this.apiKey = process.env['OPENAI_API_KEY'] || null;
    this.defaultModel = options?.model || 'gpt-4o-mini';
    this.defaultMaxTokens = options?.maxTokens || 1024;
    this.defaultTemperature = options?.temperature || 0.7;

    if (this.apiKey) {
      logger.info(`OpenAI provider initialized (model: ${this.defaultModel})`);
    } else {
      logger.warn('OPENAI_API_KEY not set - OpenAI provider disabled');
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
      throw new Error('OpenAI API key not configured');
    }

    const model = this.defaultModel;
    const maxTokens = options?.maxTokens || this.defaultMaxTokens;
    const temperature = options?.temperature ?? this.defaultTemperature;

    // Build messages array with system prompt
    const systemPrompt = options?.systemPrompt || this.getDefaultSystemPrompt();
    const openaiMessages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    // Add conversation messages (filter out any system messages from history)
    for (const msg of messages) {
      if (msg.role !== 'system') {
        openaiMessages.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }

    const requestBody = {
      model,
      max_tokens: maxTokens,
      temperature,
      messages: openaiMessages,
    };

    logger.debug(`Sending request to OpenAI (${openaiMessages.length} messages)`);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('OpenAI API error:', errorText);
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as OpenAIResponse;

    // Extract the response text
    const text = data.choices[0]?.message?.content || '';

    logger.debug(`OpenAI response: "${text.substring(0, 50)}..."`);

    return {
      text,
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
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

// OpenAI API response types
interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Initialize and register the OpenAI provider
 */
export function initOpenAIProvider(options?: OpenAIProviderOptions): OpenAIProvider {
  const provider = new OpenAIProvider(options);
  getAIRegistry().register('openai', provider);
  return provider;
}
