import { BaseModule, ModuleMetadata, ModuleContext } from '../../types/module.types.js';
import {
  command as creditsCommand,
  setCreditsService,
  setRenderService,
  setGrowthDataService,
  setYouTubeService,
  setActivityStatsService,
} from './commands/credits.js';
import { CreditsService } from './services/CreditsService.js';
import { RenderService } from './services/RenderService.js';
import { GrowthDataService } from './services/GrowthDataService.js';
import { YouTubeService } from './services/YouTubeService.js';
import { ActivityStatsService } from './services/ActivityStatsService.js';
import { Logger } from '../../shared/utils/logger.js';

const logger = new Logger('StreamCredits');

export class StreamCreditsModule extends BaseModule {
  readonly metadata: ModuleMetadata = {
    id: 'stream-credits',
    name: 'Stream Credits',
    description: 'Export server boosters and tag wearers for stream outro credits',
    version: '1.0.0',
    author: 'QuadsLab',
    isCore: false,
    isPublic: true,
    dependencies: [],
    priority: 50,
  };

  readonly migrationsPath = null;

  constructor() {
    super();
    this.commands = [creditsCommand];
  }

  async onLoad(context: ModuleContext): Promise<void> {
    await super.onLoad(context);

    const service = new CreditsService(context.client);
    setCreditsService(service);

    const renderer = new RenderService();
    setRenderService(renderer);

    const growthService = new GrowthDataService(context.prisma);
    setGrowthDataService(growthService);

    // YouTube integration
    const ytService = new YouTubeService();
    await ytService.loadApiKey();
    setYouTubeService(ytService);

    // Activity stats
    const activityService = new ActivityStatsService(context.db);
    setActivityStatsService(activityService);

    logger.info('Stream Credits module loaded');
  }
}
