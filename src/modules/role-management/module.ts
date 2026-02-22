import { BaseModule, ModuleMetadata, ModuleContext } from '../../types/module.types.js';
import { command as rolesCommand, setRoleService as setCommandRoleService } from './commands/roles.js';
import { interactionCreateEvent, setRoleService as setInteractionRoleService } from './events/interactionCreate.js';
import { RoleService } from './services/RoleService.js';
import { DatabaseService } from '../../core/database/mysql.js';
import { Logger } from '../../shared/utils/logger.js';

const logger = new Logger('RoleManagement');

/**
 * Role Management Module - Self-assignable roles via dropdown menus
 */
export class RoleManagementModule extends BaseModule {
  readonly metadata: ModuleMetadata = {
    id: 'role-management',
    name: 'Role Management',
    description: 'Self-assignable roles - users select roles from dropdown menus',
    version: '2.0.0',
    author: 'QuadsLab',
    isCore: false,
    isPublic: true,
    dependencies: [],
    priority: 50,
  };

  readonly migrationsPath = 'migrations';

  private roleService: RoleService | null = null;

  constructor() {
    super();

    this.commands = [rolesCommand];

    this.events = [
      interactionCreateEvent,
    ];
  }

  async onLoad(context: ModuleContext): Promise<void> {
    await super.onLoad(context);

    const dbService = new DatabaseService();
    this.roleService = new RoleService(dbService);

    // Inject service into commands and events
    setCommandRoleService(this.roleService);
    setInteractionRoleService(this.roleService);

    logger.info('Role Management module loaded');
  }

  async onEnable(guildId: string): Promise<void> {
    logger.info(`Role Management enabled for guild ${guildId}`);
  }

  async onDisable(guildId: string): Promise<void> {
    logger.info(`Role Management disabled for guild ${guildId}`);
  }

  async onUnload(): Promise<void> {
    this.roleService = null;
    logger.info('Role Management module unloaded');
  }
}
