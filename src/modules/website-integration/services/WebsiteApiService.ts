/**
 * Website API Service
 * Handles HTTP communication with the website with retry logic and error handling
 */

import { Logger } from '../../../shared/utils/logger.js';
import type {
  WebsiteApiResponse,
  ActivityPayload,
  DynamicLeaderboardPayload,
  PendingInteractionsResponse,
  ProcessedInteractionsPayload,
  ConnectionStatus,
  PokeResponsePayload,
  WaveBackPayload,
  BotUrlRegistrationPayload,
} from '../types/website.types.js';

const logger = new Logger('WebsiteIntegration:API');

interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
};

export class WebsiteApiService {
  private baseUrl: string;
  private secret: string;
  private retryConfig: RetryConfig;
  private connectionStatus: ConnectionStatus = {
    connected: false,
    lastSuccessfulSync: null,
    lastError: null,
    pendingEvents: 0,
  };

  constructor(baseUrl: string, secret: string, retryConfig?: Partial<RetryConfig>) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.secret = secret;
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
  }

  /**
   * Update configuration
   */
  updateConfig(baseUrl: string, secret: string): void {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.secret = secret;
  }

  /**
   * Get current connection status
   */
  getStatus(): ConnectionStatus {
    return { ...this.connectionStatus };
  }

  /**
   * Set pending events count (for status tracking)
   */
  setPendingEvents(count: number): void {
    this.connectionStatus.pendingEvents = count;
  }

  /**
   * Get default headers with auth
   */
  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.secret}`,
    };
  }

  /**
   * Check if website is reachable
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/health`, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000),
      });

      const isHealthy = response.ok;
      this.connectionStatus.connected = isHealthy;

      if (isHealthy) {
        this.connectionStatus.lastSuccessfulSync = new Date();
        this.connectionStatus.lastError = null;
      }

      return isHealthy;
    } catch (error) {
      this.connectionStatus.connected = false;
      this.connectionStatus.lastError = error instanceof Error ? error.message : 'Unknown error';
      return false;
    }
  }

  /**
   * Send activity events to website
   */
  async sendActivityEvents(payload: ActivityPayload): Promise<WebsiteApiResponse> {
    return this.postWithRetry('/api/discord/webhook', payload);
  }

  /**
   * Send leaderboard data to website (dynamic format with categories)
   */
  async sendLeaderboard(payload: DynamicLeaderboardPayload): Promise<WebsiteApiResponse> {
    return this.postWithRetry('/api/discord/leaderboard', payload);
  }

  /**
   * Get pending interactions from website
   */
  async getPendingInteractions(): Promise<PendingInteractionsResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/api/discord/interact?pending=true`, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as PendingInteractionsResponse;
      this.connectionStatus.connected = true;
      this.connectionStatus.lastSuccessfulSync = new Date();
      this.connectionStatus.lastError = null;

      return data;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to get pending interactions:', error);
      this.connectionStatus.lastError = errorMessage;

      return { success: false, interactions: [] };
    }
  }

  /**
   * Mark interactions as processed
   */
  async markInteractionsProcessed(payload: ProcessedInteractionsPayload): Promise<WebsiteApiResponse> {
    return this.postWithRetry('/api/discord/interact', payload);
  }

  /**
   * Send a response to a poke interaction
   * This sends the response back to the website visitor who poked
   */
  async sendPokeResponse(interactionId: string, payload: PokeResponsePayload): Promise<WebsiteApiResponse> {
    return this.postWithRetry(`/api/discord/interact/${interactionId}/respond`, payload);
  }

  /**
   * Send a wave back response to a wave interaction
   * Multiple users can wave back to the same interaction
   */
  async sendWaveBack(interactionId: string, payload: WaveBackPayload): Promise<WebsiteApiResponse> {
    return this.postWithRetry(`/api/discord/interact/${interactionId}/wave-back`, payload);
  }

  /**
   * Register the bot's webhook URL with the website
   * This tells the website where to send interactions and fetch data
   */
  async registerBotUrl(botUrl: string): Promise<WebsiteApiResponse> {
    const payload: BotUrlRegistrationPayload = {
      botUrl,
      endpoints: {
        poke: `${botUrl}/api/interactions/poke`,
        wave: `${botUrl}/api/interactions/wave`,
        labBell: `${botUrl}/api/interactions/lab-bell`,
        voiceStatus: `${botUrl}/api/status/voice`,
        onlineStatus: `${botUrl}/api/status/online`,
        serverInfo: `${botUrl}/api/status/server`,
        health: `${botUrl}/api/health`,
      },
      registeredAt: new Date().toISOString(),
    };

    logger.info(`Registering bot URL with website: ${botUrl}`);
    const result = await this.postWithRetry('/api/discord/register-bot', payload);

    if (result.success) {
      logger.info('Bot URL registered successfully with website');
    } else {
      logger.error('Failed to register bot URL with website:', result.error);
    }

    return result;
  }

  /**
   * POST request with retry logic and exponential backoff
   */
  private async postWithRetry<T>(endpoint: string, data: T): Promise<WebsiteApiResponse> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        const response = await fetch(`${this.baseUrl}${endpoint}`, {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify(data),
          signal: AbortSignal.timeout(30000),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const result = await response.json() as WebsiteApiResponse;

        // Update connection status on success
        this.connectionStatus.connected = true;
        this.connectionStatus.lastSuccessfulSync = new Date();
        this.connectionStatus.lastError = null;

        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');

        if (attempt < this.retryConfig.maxRetries) {
          const delay = Math.min(
            this.retryConfig.baseDelay * Math.pow(2, attempt),
            this.retryConfig.maxDelay
          );

          logger.warn(`Request to ${endpoint} failed (attempt ${attempt + 1}/${this.retryConfig.maxRetries + 1}), retrying in ${delay}ms...`);
          await this.sleep(delay);
        }
      }
    }

    // All retries failed
    const errorMessage = lastError?.message || 'Unknown error';
    logger.error(`All retries failed for ${endpoint}:`, lastError);

    this.connectionStatus.connected = false;
    this.connectionStatus.lastError = errorMessage;

    return { success: false, error: errorMessage };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
