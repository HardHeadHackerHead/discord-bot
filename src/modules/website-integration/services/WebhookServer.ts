/**
 * Webhook Server Service
 * HTTP server that receives webhooks from the website and serves data endpoints
 */

import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { Client, Guild, ChannelType, PresenceStatus } from 'discord.js';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../../../shared/utils/logger.js';
import { PokeHandler } from './PokeHandler.js';
import { WaveHandler } from './WaveHandler.js';
import { WebsiteApiService } from './WebsiteApiService.js';
import type {
  WebhookInteractionRequest,
  WebhookInteractionResponse,
  VoiceStatusResponse,
  VoiceChannelInfo,
  VoiceChannelMember,
  OnlineStatusResponse,
  ServerInfoResponse,
  LeaderboardResponse,
  PendingInteraction,
} from '../types/website.types.js';

const logger = new Logger('WebsiteIntegration:Webhook');

export interface WebhookServerConfig {
  port: number;
  secret: string;
  rateLimit: number; // requests per minute
}

export class WebhookServer {
  private server: FastifyInstance | null = null;
  private config: WebhookServerConfig;
  private client: Client;
  private guild: Guild | null = null;
  private pokeHandler: PokeHandler;
  private waveHandler: WaveHandler;
  private channelId: string;
  private isRunning = false;

  constructor(
    client: Client,
    apiService: WebsiteApiService,
    config: WebhookServerConfig,
    channelId: string
  ) {
    this.client = client;
    this.config = config;
    this.channelId = channelId;

    // Create handlers (same as InteractionPoller used to do)
    this.pokeHandler = new PokeHandler(client, apiService, channelId);
    this.waveHandler = new WaveHandler(client, apiService, channelId);
  }

  /**
   * Set the guild for interaction handling
   */
  setGuild(guild: Guild): void {
    this.guild = guild;
  }

  /**
   * Get the poke handler for button interaction handling
   */
  getPokeHandler(): PokeHandler {
    return this.pokeHandler;
  }

  /**
   * Get the wave handler for button interaction handling
   */
  getWaveHandler(): WaveHandler {
    return this.waveHandler;
  }

  /**
   * Update handler settings
   */
  updateHandlerSettings(settings: {
    channelId?: string;
    responderRoleId?: string;
    pointsReward?: number;
  }): void {
    if (settings.channelId !== undefined) {
      this.channelId = settings.channelId;
    }
    this.pokeHandler.updateSettings(settings);
    this.waveHandler.updateSettings({
      channelId: settings.channelId,
      responderRoleId: settings.responderRoleId,
    });
  }

  /**
   * Start the webhook server
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Webhook server already running');
      return;
    }

    this.server = Fastify({
      logger: false, // We use our own logger
    });

    // Register rate limiting
    await this.server.register(rateLimit, {
      max: this.config.rateLimit,
      timeWindow: '1 minute',
      errorResponseBuilder: () => ({
        success: false,
        error: 'Rate limit exceeded. Please slow down.',
      }),
    });

    // Authentication hook
    this.server.addHook('onRequest', async (request, reply) => {
      // Skip auth for health check
      if (request.url === '/health') return;

      const auth = request.headers.authorization;
      if (!auth || auth !== `Bearer ${this.config.secret}`) {
        return reply.status(401).send({ success: false, error: 'Unauthorized' });
      }
    });

    // Register routes
    this.registerRoutes();

    // Start listening
    try {
      await this.server.listen({ port: this.config.port, host: '0.0.0.0' });
      this.isRunning = true;
      logger.info(`Webhook server started on port ${this.config.port}`);
    } catch (error) {
      logger.error('Failed to start webhook server:', error);
      throw error;
    }
  }

  /**
   * Stop the webhook server
   */
  async stop(): Promise<void> {
    if (!this.isRunning || !this.server) {
      return;
    }

    // Stop handlers
    this.pokeHandler.stop();
    this.waveHandler.stop();

    // Close server
    await this.server.close();
    this.server = null;
    this.isRunning = false;
    logger.info('Webhook server stopped');
  }

  /**
   * Check if server is running
   */
  isServerRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Register all routes
   */
  private registerRoutes(): void {
    if (!this.server) return;

    // Health check (no auth required)
    this.server.get('/health', async () => ({
      success: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
    }));

    // ========== Incoming Webhooks (Website -> Bot) ==========

    // Poke interaction
    this.server.post<{ Body: WebhookInteractionRequest }>(
      '/api/interactions/poke',
      async (request, reply) => this.handlePoke(request, reply)
    );

    // Wave interaction
    this.server.post<{ Body: WebhookInteractionRequest }>(
      '/api/interactions/wave',
      async (request, reply) => this.handleWave(request, reply)
    );

    // Lab bell interaction
    this.server.post<{ Body: WebhookInteractionRequest }>(
      '/api/interactions/lab-bell',
      async (request, reply) => this.handleLabBell(request, reply)
    );

    // ========== Data Endpoints (Website queries Bot) ==========

    // Voice channel status
    this.server.get('/api/status/voice', async () => this.getVoiceStatus());

    // Online member count
    this.server.get('/api/status/online', async () => this.getOnlineStatus());

    // Server info
    this.server.get('/api/status/server', async () => this.getServerInfo());

    // Leaderboard by category
    this.server.get<{ Params: { category: string } }>(
      '/api/leaderboard/:category',
      async (request) => this.getLeaderboard(request.params.category)
    );
  }

  // ========== Webhook Handlers ==========

  private async handlePoke(
    request: FastifyRequest<{ Body: WebhookInteractionRequest }>,
    reply: FastifyReply
  ): Promise<WebhookInteractionResponse> {
    if (!this.guild) {
      return reply.status(503).send({
        success: false,
        error: 'Bot not ready - guild not set',
      });
    }

    const { visitorId, timestamp } = request.body || {};

    if (!visitorId) {
      return reply.status(400).send({
        success: false,
        error: 'Missing visitorId',
      });
    }

    const interactionId = uuidv4();
    const pendingInteraction: PendingInteraction = {
      id: interactionId,
      type: 'poke',
      createdAt: timestamp || new Date().toISOString(),
    };

    logger.info(`Poke webhook received from visitor ${visitorId}, ID: ${interactionId}`);

    const handled = await this.pokeHandler.handlePoke(pendingInteraction, this.guild);

    if (handled) {
      return { success: true, interactionId };
    } else {
      return reply.status(500).send({
        success: false,
        error: 'Failed to process poke interaction',
      });
    }
  }

  private async handleWave(
    request: FastifyRequest<{ Body: WebhookInteractionRequest }>,
    reply: FastifyReply
  ): Promise<WebhookInteractionResponse> {
    if (!this.guild) {
      return reply.status(503).send({
        success: false,
        error: 'Bot not ready - guild not set',
      });
    }

    const { visitorId, timestamp } = request.body || {};

    if (!visitorId) {
      return reply.status(400).send({
        success: false,
        error: 'Missing visitorId',
      });
    }

    const interactionId = uuidv4();
    const pendingInteraction: PendingInteraction = {
      id: interactionId,
      type: 'wave',
      createdAt: timestamp || new Date().toISOString(),
    };

    logger.info(`Wave webhook received from visitor ${visitorId}, ID: ${interactionId}`);

    const handled = await this.waveHandler.handleWave(pendingInteraction, this.guild);

    if (handled) {
      return { success: true, interactionId };
    } else {
      return reply.status(500).send({
        success: false,
        error: 'Failed to process wave interaction',
      });
    }
  }

  private async handleLabBell(
    request: FastifyRequest<{ Body: WebhookInteractionRequest }>,
    reply: FastifyReply
  ): Promise<WebhookInteractionResponse> {
    if (!this.guild) {
      return reply.status(503).send({
        success: false,
        error: 'Bot not ready - guild not set',
      });
    }

    const { visitorId } = request.body || {};

    if (!visitorId) {
      return reply.status(400).send({
        success: false,
        error: 'Missing visitorId',
      });
    }

    // Send lab bell message to channel
    const channel = this.guild.channels.cache.get(this.channelId);
    if (!channel || !channel.isTextBased()) {
      return reply.status(500).send({
        success: false,
        error: 'Interaction channel not configured',
      });
    }

    try {
      await channel.send(
        '🔔 **DING DING!** Someone rang the Lab Bell from the website! A visitor is checking out the lab!'
      );
      logger.info(`Lab bell webhook received from visitor ${visitorId}`);
      return { success: true };
    } catch (error) {
      logger.error('Failed to send lab bell message:', error);
      return reply.status(500).send({
        success: false,
        error: 'Failed to send message to Discord',
      });
    }
  }

  // ========== Data Endpoints ==========

  private getVoiceStatus(): VoiceStatusResponse {
    if (!this.guild) {
      return { success: false, channels: [], totalInVoice: 0 };
    }

    const channels: VoiceChannelInfo[] = [];
    let totalInVoice = 0;

    for (const channel of this.guild.channels.cache.values()) {
      if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice) {
        continue;
      }

      const members: VoiceChannelMember[] = [];

      for (const member of channel.members.values()) {
        if (member.user.bot) continue;

        const voiceState = member.voice;
        members.push({
          id: member.id,
          username: member.user.username,
          displayName: member.displayName,
          avatar: member.user.displayAvatarURL({ extension: 'png', size: 128 }),
          streaming: voiceState.streaming ?? false,
          camera: voiceState.selfVideo ?? false,
          muted: voiceState.mute ?? false,
          deafened: voiceState.deaf ?? false,
        });
        totalInVoice++;
      }

      if (members.length > 0) {
        channels.push({
          id: channel.id,
          name: channel.name,
          members,
        });
      }
    }

    return { success: true, channels, totalInVoice };
  }

  private getOnlineStatus(): OnlineStatusResponse {
    if (!this.guild) {
      return { success: false, online: 0, idle: 0, dnd: 0, total: 0 };
    }

    let online = 0;
    let idle = 0;
    let dnd = 0;

    for (const presence of this.guild.presences.cache.values()) {
      switch (presence.status) {
        case 'online':
          online++;
          break;
        case 'idle':
          idle++;
          break;
        case 'dnd':
          dnd++;
          break;
      }
    }

    return {
      success: true,
      online,
      idle,
      dnd,
      total: this.guild.memberCount,
    };
  }

  private getServerInfo(): ServerInfoResponse {
    if (!this.guild) {
      return {
        success: false,
        server: {
          id: '',
          name: '',
          icon: null,
          memberCount: 0,
          boostLevel: 0,
          boostCount: 0,
        },
      };
    }

    return {
      success: true,
      server: {
        id: this.guild.id,
        name: this.guild.name,
        icon: this.guild.iconURL({ extension: 'png', size: 256 }),
        memberCount: this.guild.memberCount,
        boostLevel: this.guild.premiumTier,
        boostCount: this.guild.premiumSubscriptionCount ?? 0,
      },
    };
  }

  private getLeaderboard(_category: string): LeaderboardResponse {
    // TODO: Implement on-demand leaderboard fetching
    // This would need access to the leaderboard registry and database
    // For now, return a placeholder
    return {
      success: false,
      error: 'Leaderboard endpoint not yet implemented - use periodic sync for now',
    };
  }
}
