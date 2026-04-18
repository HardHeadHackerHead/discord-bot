/**
 * Ngrok Service
 * Automatically creates an ngrok tunnel for the webhook server
 *
 * This allows running the bot locally while receiving webhooks from the website.
 * The public ngrok URL is logged on startup.
 *
 * Uses the system ngrok binary directly instead of the npm package for reliability.
 */

import { spawn, ChildProcess, exec } from 'child_process';
import { promisify } from 'util';
import { Logger } from '../../../shared/utils/logger.js';

const execAsync = promisify(exec);
const logger = new Logger('WebsiteIntegration:Ngrok');

export interface NgrokConfig {
  authToken?: string;     // Optional - for authenticated tunnels
  port: number;           // Local port to tunnel
  region?: string;        // Region: us, eu, ap, au, sa, jp, in
}

export class NgrokService {
  private config: NgrokConfig;
  private publicUrl: string | null = null;
  private isRunning = false;
  private ngrokProcess: ChildProcess | null = null;

  constructor(config: NgrokConfig) {
    this.config = config;
  }

  /**
   * Start the ngrok tunnel
   * Returns the public URL
   */
  async start(): Promise<string | null> {
    if (this.isRunning) {
      logger.warn('Ngrok tunnel already running');
      return this.publicUrl;
    }

    try {
      // Kill any existing ngrok process at the system level
      await this.killExistingNgrok();

      logger.info('Starting ngrok tunnel...');

      // Build ngrok command args
      const args = ['http', this.config.port.toString(), '--pooling-enabled'];
      if (this.config.region) {
        args.push('--region', this.config.region);
      }

      // Spawn ngrok process
      this.ngrokProcess = spawn('ngrok', args, {
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // Wait for ngrok to start and get the URL from the API
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Get the public URL from ngrok's API
      this.publicUrl = await this.getNgrokUrl();

      if (!this.publicUrl) {
        throw new Error('Failed to get ngrok public URL');
      }

      this.isRunning = true;

      // Handle process exit
      this.ngrokProcess.on('exit', (code) => {
        logger.warn(`Ngrok process exited with code ${code}`);
        this.isRunning = false;
        this.publicUrl = null;
        this.ngrokProcess = null;
      });

      logger.info('='.repeat(60));
      logger.info('NGROK TUNNEL STARTED');
      logger.info(`Public URL: ${this.publicUrl}`);
      logger.info(`Forwarding to: localhost:${this.config.port}`);
      logger.info('='.repeat(60));
      logger.info('');
      logger.info('Configure your website to send webhooks to:');
      logger.info(`  Poke: ${this.publicUrl}/api/interactions/poke`);
      logger.info(`  Wave: ${this.publicUrl}/api/interactions/wave`);
      logger.info(`  Bell: ${this.publicUrl}/api/interactions/lab-bell`);
      logger.info('');
      logger.info('Data endpoints available at:');
      logger.info(`  Voice: ${this.publicUrl}/api/status/voice`);
      logger.info(`  Online: ${this.publicUrl}/api/status/online`);
      logger.info(`  Server: ${this.publicUrl}/api/status/server`);
      logger.info('='.repeat(60));

      return this.publicUrl;
    } catch (error) {
      logger.error('Failed to start ngrok tunnel:', error);
      await this.stop();
      return null;
    }
  }

  /**
   * Get the ngrok public URL from the local API
   */
  private async getNgrokUrl(): Promise<string | null> {
    const maxAttempts = 10;
    const delayMs = 1000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await fetch('http://127.0.0.1:4040/api/tunnels');
        const data = await response.json() as { tunnels: Array<{ public_url: string; proto: string }> };

        if (data.tunnels && data.tunnels.length > 0) {
          // Prefer https tunnel
          const httpsTunnel = data.tunnels.find(t => t.proto === 'https');
          const tunnel = httpsTunnel || data.tunnels[0];
          if (tunnel) {
            return tunnel.public_url;
          }
        }
      } catch {
        // API not ready yet, wait and retry
      }

      if (attempt < maxAttempts - 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    return null;
  }

  /**
   * Stop the ngrok tunnel
   */
  async stop(): Promise<void> {
    if (this.ngrokProcess) {
      this.ngrokProcess.kill();
      this.ngrokProcess = null;
    }

    await this.killExistingNgrok();

    this.isRunning = false;
    this.publicUrl = null;
    logger.info('Ngrok tunnel stopped');
  }

  /**
   * Get the public URL of the tunnel
   */
  getPublicUrl(): string | null {
    return this.publicUrl;
  }

  /**
   * Check if the tunnel is running
   */
  isTunnelRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Kill any existing ngrok processes at the system level
   */
  private async killExistingNgrok(): Promise<void> {
    const isWindows = process.platform === 'win32';
    const killCommand = isWindows
      ? 'taskkill /F /IM ngrok.exe 2>nul'
      : 'pkill -f ngrok 2>/dev/null || true';

    try {
      await execAsync(killCommand);
      logger.debug('Killed existing ngrok process via OS');
      // Wait for the process to fully terminate
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch {
      // No process to kill, that's fine
    }
  }
}
