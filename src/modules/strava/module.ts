import { BaseModule, ModuleMetadata, ModuleContext } from '../../types/module.types.js';
import { Logger } from '../../shared/utils/logger.js';
import { command as stravaCommand, injectStravaCommandDeps } from './commands/strava.js';
import { StravaService } from './services/StravaService.js';
import { StravaListenService } from './services/StravaListenService.js';
import { StravaEventDispatcher } from './services/StravaEventDispatcher.js';

const logger = new Logger('Strava');

/**
 * Strava Module — posts linked members' activities into a configured
 * Discord channel.
 *
 * All Strava API traffic lives on quadslab.io. This module:
 *   - Owns the per-guild "which channel?" mapping (strava_guild_channels).
 *   - LISTENs to the website's Postgres `strava_activity` channel.
 *   - Renders incoming activity payloads as Discord embeds and posts.
 *
 * Required env (see src/config/environment.ts):
 *   WEBSITE_DATABASE_URL — connection string to quadslab.io's Postgres.
 *                          A read-only role is sufficient (we only
 *                          SELECT and LISTEN).
 *   WEBSITE_URL          — base URL for the link DMs (defaults to
 *                          https://quadslab.io).
 */
export class StravaModule extends BaseModule {
  readonly metadata: ModuleMetadata = {
    id: 'strava',
    name: 'Strava',
    description: "Posts linked members' Strava activities to a configured channel",
    version: '1.0.0',
    author: 'QuadsLab',
    isCore: false,
    isPublic: true,
    dependencies: [],
    optionalDependencies: [],
    priority: 50,
  };

  readonly migrationsPath = './migrations';

  private stravaService: StravaService | null = null;
  private listenService: StravaListenService | null = null;
  private dispatcher: StravaEventDispatcher | null = null;

  constructor() {
    super();
    this.commands = [stravaCommand];
    this.events = [];
  }

  async onLoad(context: ModuleContext): Promise<void> {
    await super.onLoad(context);

    // Captured-by-closure so the listen handlers (declared before the
    // dispatcher exists) can reach it once we've wired it up.
    const moduleRef = this;

    const websiteDbUrl = process.env['WEBSITE_DATABASE_URL'];
    if (!websiteDbUrl) {
      logger.error(
        'WEBSITE_DATABASE_URL is not set — Strava module loaded with commands only; activity posting disabled.',
      );
    }
    const websiteUrl = (process.env['WEBSITE_URL'] ?? 'https://quadslab.io').replace(/\/+$/, '');

    this.stravaService = new StravaService(context.db);

    if (websiteDbUrl) {
      this.listenService = new StravaListenService(websiteDbUrl, {
        async handleEvent(id) {
          await moduleRef.dispatcher?.handleEvent(id);
        },
        async catchUp() {
          await moduleRef.dispatcher?.catchUp();
        },
      });

      this.dispatcher = new StravaEventDispatcher(
        context.client,
        this.stravaService,
        this.listenService,
      );

      try {
        await this.listenService.start();
      } catch (err) {
        logger.error('Failed to start LISTEN service:', err);
      }
    }

    injectStravaCommandDeps({
      service: this.stravaService,
      // command code tolerates a null listen service for the basic
      // commands; status/lookup degrades but link/setchannel still work.
      listen: this.listenService ?? (null as unknown as StravaListenService),
      dispatcher: this.dispatcher,
      websiteUrl,
    });

    logger.info('Strava module loaded');
  }

  async onUnload(): Promise<void> {
    if (this.listenService) {
      await this.listenService.stop().catch((err) => {
        logger.error('Error stopping LISTEN service:', err);
      });
    }
    this.listenService = null;
    this.dispatcher = null;
    this.stravaService = null;
    await super.onUnload();
    logger.info('Strava module unloaded');
  }
}
