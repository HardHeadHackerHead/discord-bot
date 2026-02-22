# Module Development Guide

This guide covers everything you need to know to create modules for QuadsLabBot.

## Table of Contents

1. [Module Structure](#module-structure)
2. [Creating a New Module](#creating-a-new-module)
3. [Database & Migrations](#database--migrations)
4. [Commands](#commands)
5. [Event Handlers](#event-handlers)
6. [Services](#services)
7. [UI Components (Panels)](#ui-components-panels)
8. [Interaction Handling](#interaction-handling)
9. [Inter-Module Communication](#inter-module-communication)
10. [Module Lifecycle](#module-lifecycle)
11. [Best Practices](#best-practices)
12. [Common Patterns](#common-patterns)

---

## Module Structure

Every module follows this folder structure:

```
src/modules/<module-name>/
├── index.ts              # Module export (MUST export instance, not class)
├── module.ts             # Module class with metadata and lifecycle hooks
├── migrations/           # SQL migration files (numbered)
│   ├── 001_initial.sql
│   └── 002_add_feature.sql
├── commands/             # Slash commands
│   └── <command>.ts
├── events/               # Discord event handlers
│   └── interactionCreate.ts
├── services/             # Business logic
│   └── <Name>Service.ts
└── components/           # UI builders (embeds, buttons, modals)
    └── <Name>Panel.ts
```

---

## Creating a New Module

### Step 1: Create the Module Class (`module.ts`)

```typescript
import { BaseModule, ModuleMetadata, ModuleContext } from '../../types/module.types.js';
import { command as myCommand, setService } from './commands/mycommand.js';
import { interactionCreateEvent, setService as setInteractionService } from './events/interactionCreate.js';
import { MyService } from './services/MyService.js';
import { DatabaseService } from '../../core/database/mysql.js';
import { Logger } from '../../shared/utils/logger.js';

const logger = new Logger('MyModule');

export class MyModule extends BaseModule {
  readonly metadata: ModuleMetadata = {
    id: 'my-module',              // Unique ID, used for DB table prefixes
    name: 'My Module',            // Display name
    description: 'What it does',  // Short description
    version: '1.0.0',
    author: 'Your Name',
    isCore: false,                // true = cannot be disabled
    isPublic: true,               // true = visible in /modules command
    dependencies: [],             // Other module IDs this depends on
    priority: 50,                 // Load order (lower = earlier)
  };

  readonly migrationsPath = 'migrations';  // Relative to module folder

  private service: MyService | null = null;

  constructor() {
    super();
    this.commands = [myCommand];
    this.events = [interactionCreateEvent];
  }

  async onLoad(context: ModuleContext): Promise<void> {
    await super.onLoad(context);

    // Initialize services
    const dbService = new DatabaseService();
    this.service = new MyService(dbService);

    // Inject service into commands and events
    setService(this.service);
    setInteractionService(this.service);

    logger.info('My Module loaded');
  }

  async onEnable(guildId: string): Promise<void> {
    logger.info(`My Module enabled for guild ${guildId}`);
  }

  async onDisable(guildId: string): Promise<void> {
    logger.info(`My Module disabled for guild ${guildId}`);
  }

  async onUnload(): Promise<void> {
    this.service = null;
    logger.info('My Module unloaded');
  }
}
```

### Step 2: Create the Export (`index.ts`)

**IMPORTANT**: Export an instance, not the class!

```typescript
import { MyModule } from './module.js';

// CORRECT - export instance
export default new MyModule();
export { MyModule };

// WRONG - this won't work!
// export { MyModule as default };
```

### Step 3: Module Metadata Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier, used for DB prefixes (e.g., `mymod_tablename`) |
| `name` | string | Human-readable display name |
| `description` | string | Brief description of functionality |
| `version` | string | Semantic version (e.g., `1.0.0`) |
| `author` | string | Module author |
| `isCore` | boolean | If true, cannot be disabled by users |
| `isPublic` | boolean | If true, appears in `/modules` command |
| `dependencies` | string[] | Array of module IDs this module requires |
| `priority` | number | Load order (lower loads first, default: 50) |

---

## Database & Migrations

### Migration Files

Place SQL files in `migrations/` folder with numbered prefixes:

```
migrations/
├── 001_initial.sql
├── 002_add_column.sql
└── 003_create_index.sql
```

### Migration File Format

```sql
-- migrations/001_initial.sql
-- Description of what this migration does

CREATE TABLE IF NOT EXISTS mymod_items (
  id VARCHAR(36) PRIMARY KEY,
  guild_id VARCHAR(20) NOT NULL,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_guild (guild_id)
);
```

### Table Naming Convention

**Always prefix tables with your module ID** to avoid conflicts:

- `roles_reaction_messages` (role-management module)
- `voice_sessions` (voice-tracking module)
- `points_user_points` (points module)

### Migration Limitations

The migration runner splits SQL by semicolons. These features are **NOT supported**:

- `DELIMITER` statements (MySQL client command, not SQL)
- Stored procedures with `BEGIN...END` blocks
- Multi-statement triggers

**Workaround for conditional columns**: Just add the column and handle errors in code, or create a new migration.

### DatabaseService Usage

```typescript
import { DatabaseService } from '../../../core/database/mysql.js';
import { RowDataPacket } from 'mysql2';

interface MyItem {
  id: string;
  guild_id: string;
  name: string;
}

export class MyService {
  constructor(private db: DatabaseService) {}

  // Query (SELECT) - returns array
  async getItems(guildId: string): Promise<MyItem[]> {
    return this.db.query<(MyItem & RowDataPacket)[]>(
      'SELECT * FROM mymod_items WHERE guild_id = ?',
      [guildId]
    );
  }

  // Single item query
  async getItem(id: string): Promise<MyItem | null> {
    const rows = await this.db.query<(MyItem & RowDataPacket)[]>(
      'SELECT * FROM mymod_items WHERE id = ?',
      [id]
    );
    return rows[0] || null;
  }

  // Execute (INSERT, UPDATE, DELETE)
  async createItem(id: string, guildId: string, name: string): Promise<void> {
    await this.db.execute(
      'INSERT INTO mymod_items (id, guild_id, name) VALUES (?, ?, ?)',
      [id, guildId, name]
    );
  }

  // Check affected rows
  async deleteItem(id: string): Promise<boolean> {
    const result = await this.db.execute(
      'DELETE FROM mymod_items WHERE id = ?',
      [id]
    );
    return (result as { affectedRows: number }).affectedRows > 0;
  }
}
```

---

## Commands

### Slash Command Structure

```typescript
// commands/mycommand.ts
import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
} from 'discord.js';
import { SlashCommand } from '../../../types/command.types.js';
import { MyService } from '../services/MyService.js';
import { MyPanel } from '../components/MyPanel.js';

let service: MyService | null = null;

export function setService(s: MyService): void {
  service = s;
}

export const command: SlashCommand = {
  type: 'slash',
  data: new SlashCommandBuilder()
    .setName('mycommand')
    .setDescription('Does something cool')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild) // Optional
    as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!service) {
      await interaction.reply({
        content: 'Service not initialized',
        ephemeral: true,
      });
      return;
    }

    // Your command logic here
    await interaction.reply({
      embeds: [MyPanel.createEmbed()],
      components: MyPanel.createComponents(),
      ephemeral: true,
    });
  },
};
```

### Command with Subcommands

```typescript
data: new SlashCommandBuilder()
  .setName('config')
  .setDescription('Configuration commands')
  .addSubcommand(sub =>
    sub.setName('set')
      .setDescription('Set a value')
      .addStringOption(opt =>
        opt.setName('key')
          .setDescription('The setting key')
          .setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub.setName('get')
      .setDescription('Get a value')
  ) as SlashCommandBuilder,

async execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'set':
      const key = interaction.options.getString('key', true);
      // Handle set
      break;
    case 'get':
      // Handle get
      break;
  }
}
```

---

## Event Handlers

### Basic Event Handler

```typescript
// events/interactionCreate.ts
import { Interaction } from 'discord.js';
import { AnyModuleEvent } from '../../../types/event.types.js';
import { MyService } from '../services/MyService.js';

let service: MyService | null = null;

export function setService(s: MyService): void {
  service = s;
}

export const interactionCreateEvent: AnyModuleEvent = {
  name: 'interactionCreate',
  once: false,  // false = on(), true = once()

  async execute(...args: unknown[]): Promise<void> {
    const interaction = args[0] as Interaction;
    if (!service) return;

    // Filter for your module's interactions
    if (interaction.isButton() && interaction.customId.startsWith('mymod:')) {
      await handleButton(interaction, service);
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('mymod:')) {
      await handleSelectMenu(interaction, service);
    }
  },
};
```

### Custom ID Conventions

Use a prefix to identify your module's interactions:

```
<module>:<action>:<optional-data>

Examples:
- roles:create
- roles:select_message
- roles:delete:abc123
- selfrole:select:1234567890
```

---

## Services

Services contain business logic and database operations.

### Service Pattern

```typescript
// services/MyService.ts
import { Guild, GuildMember } from 'discord.js';
import { DatabaseService } from '../../../core/database/mysql.js';
import { Logger } from '../../../shared/utils/logger.js';
import { RowDataPacket } from 'mysql2';
import { randomUUID } from 'crypto';

const logger = new Logger('MyModule:Service');

export interface MyItem {
  id: string;
  guild_id: string;
  // ... other fields
}

export class MyService {
  constructor(private db: DatabaseService) {}

  // Group related methods with comments
  // ==================== Items ====================

  async createItem(guildId: string, data: Partial<MyItem>): Promise<MyItem | null> {
    try {
      const id = randomUUID();
      await this.db.execute(
        'INSERT INTO mymod_items (id, guild_id, name) VALUES (?, ?, ?)',
        [id, guildId, data.name]
      );

      logger.info(`Created item ${id} in guild ${guildId}`);
      return { id, guild_id: guildId, ...data } as MyItem;
    } catch (error) {
      logger.error('Failed to create item:', error);
      return null;
    }
  }

  // ... more methods
}
```

---

## UI Components (Panels)

Panels are static classes that build embeds, buttons, and modals.

### Panel Structure

```typescript
// components/MyPanel.ts
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { COLORS } from '../../../shared/utils/embed.js';

export interface MyPanelState {
  view: 'list' | 'detail';
  page: number;
  selectedId: string | null;
}

export class MyPanel {
  // ==================== Embeds ====================

  static createListEmbed(items: Item[], page: number): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle('My Items')
      .setDescription(items.length ? 'Select an item' : 'No items yet')
      .setColor(COLORS.primary);
  }

  // ==================== Components ====================

  static createListComponents(items: Item[]): ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] {
    const components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];

    // Select menu
    if (items.length > 0) {
      const select = new StringSelectMenuBuilder()
        .setCustomId('mymod:select_item')
        .setPlaceholder('Select an item...')
        .addOptions(
          items.map(item =>
            new StringSelectMenuOptionBuilder()
              .setLabel(item.name)
              .setValue(item.id)
          )
        );

      components.push(
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)
      );
    }

    // Buttons
    const buttons = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('mymod:create')
          .setLabel('Create')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('mymod:refresh')
          .setLabel('Refresh')
          .setStyle(ButtonStyle.Secondary)
      );

    components.push(buttons);
    return components;
  }

  // ==================== Modals ====================

  static createInputModal(): ModalBuilder {
    const modal = new ModalBuilder()
      .setCustomId('mymod:modal_create')
      .setTitle('Create Item');

    const nameInput = new TextInputBuilder()
      .setCustomId('mymod:input_name')
      .setLabel('Name')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(100);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput)
    );

    return modal;
  }

  // ==================== Result Embeds ====================

  static createSuccessEmbed(title: string, description: string): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor(COLORS.success);
  }

  static createErrorEmbed(title: string, description: string): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor(COLORS.error);
  }
}
```

---

## Interaction Handling

### Panel State Management

Track state per message for multi-step flows:

```typescript
const panelStates = new Map<string, MyPanelState>();

function getState(messageId: string): MyPanelState {
  let state = panelStates.get(messageId);
  if (!state) {
    state = { view: 'list', page: 0, selectedId: null };
    panelStates.set(messageId, state);
  }
  return state;
}
```

### Button Handler

```typescript
async function handleButton(
  interaction: ButtonInteraction,
  service: MyService
): Promise<void> {
  const [, action, data] = interaction.customId.split(':');
  const state = getState(interaction.message.id);

  switch (action) {
    case 'create':
      await interaction.showModal(MyPanel.createInputModal());
      break;

    case 'back':
      state.view = 'list';
      state.selectedId = null;
      await updateListView(interaction, service, state);
      break;

    case 'delete':
      await service.deleteItem(data);
      await updateListView(interaction, service, state);
      break;
  }
}
```

### Select Menu Handler

```typescript
async function handleSelectMenu(
  interaction: StringSelectMenuInteraction,
  service: MyService
): Promise<void> {
  const [, action] = interaction.customId.split(':');
  const state = getState(interaction.message.id);
  const selectedValue = interaction.values[0];

  if (!selectedValue) return;

  switch (action) {
    case 'select_item':
      state.view = 'detail';
      state.selectedId = selectedValue;
      await updateDetailView(interaction, service, state);
      break;
  }
}
```

### Modal Handler

```typescript
async function handleModal(
  interaction: ModalSubmitInteraction,
  service: MyService
): Promise<void> {
  const [, action] = interaction.customId.split(':');

  switch (action) {
    case 'modal_create':
      const name = interaction.fields.getTextInputValue('mymod:input_name');

      await interaction.deferUpdate();

      const result = await service.createItem(interaction.guildId!, { name });

      if (result) {
        await interaction.editReply({
          embeds: [MyPanel.createSuccessEmbed('Created', `Item "${name}" created!`)],
          components: [],
        });
      } else {
        await interaction.editReply({
          embeds: [MyPanel.createErrorEmbed('Failed', 'Could not create item.')],
          components: [],
        });
      }
      break;
  }
}
```

### View Update Helpers

```typescript
async function updateListView(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  service: MyService,
  state: MyPanelState
): Promise<void> {
  const items = await service.getItems(interaction.guildId!);

  await interaction.update({
    embeds: [MyPanel.createListEmbed(items, state.page)],
    components: MyPanel.createListComponents(items),
  });
}
```

---

## Inter-Module Communication

Modules can communicate with each other through an event bus. This enables loose coupling - modules don't need to know about each other directly.

### Event Bus Overview

The `ModuleEventBus` allows modules to:
- **Emit events** when something happens (e.g., "user earned points")
- **Subscribe to events** from other modules (e.g., "when voice session ends, award points")

### Event Naming Convention

Events follow the format: `<module-id>:<event-name>`

Examples:
- `points:awarded` - Points were given to a user
- `voice-tracking:session-ended` - A voice session ended
- `user-tracking:user-joined` - A user joined a guild

### Defining Event Types

Define event payload types in `src/types/module-events.types.ts`:

```typescript
// src/types/module-events.types.ts

export interface VoiceSessionEndedEvent {
  userId: string;
  guildId: string;
  channelId: string;
  duration: number; // seconds
  startTime: Date;
  endTime: Date;
}

export interface PointsAwardedEvent {
  userId: string;
  guildId: string;
  amount: number;
  reason: string;
  source: 'manual' | 'voice' | 'message' | 'other';
  newBalance: number;
}

// Event name constants
export const MODULE_EVENTS = {
  VOICE_SESSION_ENDED: 'voice-tracking:session-ended',
  POINTS_AWARDED: 'points:awarded',
} as const;
```

### Emitting Events

In your service or module, emit events when actions occur:

```typescript
import { ModuleEventBus } from '../../../core/modules/ModuleEventBus.js';
import { MODULE_EVENTS, PointsAwardedEvent } from '../../../types/module-events.types.js';

export class PointsService {
  constructor(
    private db: DatabaseService,
    private eventBus: ModuleEventBus
  ) {}

  async addPoints(userId: string, guildId: string, amount: number): Promise<void> {
    // ... add points to database ...

    // Emit event
    const eventData: PointsAwardedEvent = {
      userId,
      guildId,
      amount,
      reason: 'Voice time reward',
      source: 'voice',
      newBalance: newBalance,
    };

    // Fire-and-forget (doesn't wait for handlers)
    this.eventBus.emitAsync(MODULE_EVENTS.POINTS_AWARDED, 'points', eventData);

    // Or wait for all handlers to complete
    await this.eventBus.emit(MODULE_EVENTS.POINTS_AWARDED, 'points', eventData);
  }
}
```

### Subscribing to Events

In your module's `onLoad`, subscribe to events from other modules:

```typescript
import { BaseModule, ModuleContext } from '../../types/module.types.js';
import { MODULE_EVENTS, VoiceSessionEndedEvent } from '../../types/module-events.types.js';
import type { EventSubscription } from '../../core/modules/ModuleEventBus.js';

export class PointsModule extends BaseModule {
  private eventSubscriptions: EventSubscription[] = [];

  async onLoad(context: ModuleContext): Promise<void> {
    await super.onLoad(context);

    // Subscribe to voice session events
    const voiceSub = context.events.on<VoiceSessionEndedEvent>(
      MODULE_EVENTS.VOICE_SESSION_ENDED,
      this.metadata.id,  // subscriber ID
      async (payload) => {
        // payload.sourceModule = 'voice-tracking'
        // payload.data = VoiceSessionEndedEvent
        // payload.timestamp = Date

        const { userId, guildId, duration } = payload.data;
        const minutes = Math.floor(duration / 60);

        if (minutes > 0) {
          await this.pointsService.addPoints(
            userId,
            guildId,
            minutes,
            'Voice time reward',
            'voice'
          );
        }
      }
    );

    this.eventSubscriptions.push(voiceSub);
  }

  async onUnload(): Promise<void> {
    // Clean up subscriptions
    for (const sub of this.eventSubscriptions) {
      sub.unsubscribe();
    }
    this.eventSubscriptions = [];

    await super.onUnload();
  }
}
```

### Optional Dependencies

Use optional dependencies when a feature only works if another module is loaded:

```typescript
readonly metadata: ModuleMetadata = {
  id: 'voice-tracking',
  // ...
  dependencies: [],  // Required - module won't load without these
  optionalDependencies: ['points'],  // Optional - feature degrades gracefully
};
```

Check if an optional dependency is loaded:

```typescript
async onLoad(context: ModuleContext): Promise<void> {
  await super.onLoad(context);

  // Check if points module is available
  if (context.isModuleLoaded('points')) {
    this.subscribeToPointsEvents(context);
  }
}

// Or in BaseModule subclass, use the helper:
if (this.isModuleLoaded('points')) {
  // Points module is loaded, enable points integration
}
```

### Event Handler Best Practices

1. **Don't block** - Use `emitAsync` for fire-and-forget scenarios
2. **Handle errors** - Wrap handlers in try/catch
3. **Clean up** - Always unsubscribe in `onUnload`
4. **Type safety** - Use generic types: `events.on<VoiceSessionEndedEvent>(...)`
5. **Document events** - List emitted/consumed events in module comments

### Available Context Properties

The `ModuleContext` provides these for inter-module communication:

```typescript
interface ModuleContext {
  client: Client;              // Discord.js client
  prisma: PrismaClient;        // Core database
  db: DatabaseService;         // Module database queries
  events: ModuleEventBus;      // Event bus for module communication
  isModuleLoaded(id: string): boolean;  // Check if another module is loaded
}
```

In `BaseModule` subclasses, use the shortcuts:

```typescript
this.eventBus         // Same as context.events
this.isModuleLoaded() // Same as context.isModuleLoaded()
```

---

## Module Lifecycle

### Load Order

1. Module discovered in `src/modules/` folder
2. Dependencies resolved (topological sort)
3. `onLoad()` called - initialize services, inject dependencies
4. Commands registered with Discord API
5. Event listeners attached

### Runtime Loading/Unloading

When a module is loaded at runtime (after bot startup):
- Commands are **immediately deployed** to Discord API
- Event listeners are attached

When a module is unloaded:
- Event listeners are removed
- Commands are unregistered and re-deployed

### Enable/Disable vs Load/Unload

| Action | Effect |
|--------|--------|
| **Load** | Module code is loaded, services initialized, commands/events registered |
| **Unload** | Module code is unloaded, services destroyed, commands/events removed |
| **Enable** | Module is active for a specific guild (events will fire) |
| **Disable** | Module is inactive for a guild (events are skipped) |

A module must be **loaded** before it can be **enabled**.

---

## Best Practices

### 1. Always Check Service Initialization

```typescript
if (!service) {
  await interaction.reply({
    content: 'Service not available',
    ephemeral: true,
  });
  return;
}
```

### 2. Use Ephemeral Messages for Admin Panels

```typescript
await interaction.reply({
  embeds: [embed],
  components,
  ephemeral: true,  // Only the user sees this
});
```

### 3. Handle Errors Gracefully

```typescript
try {
  await riskyOperation();
} catch (error) {
  logger.error('Operation failed:', error);
  await interaction.reply({
    embeds: [Panel.createErrorEmbed('Error', 'Something went wrong.')],
    ephemeral: true,
  });
}
```

### 4. Reset UI State After Actions

For select menus, edit the message to reset the dropdown:

```typescript
// After user selects something, update the message to reset dropdown
await service.updateMessage(guild, record);

await interaction.reply({
  content: 'Action completed!',
  ephemeral: true,
});

// Auto-delete confirmation
setTimeout(() => interaction.deleteReply().catch(() => {}), 3000);
```

### 5. Use Consistent Custom ID Prefixes

```
<module>:<action>:<data>

Good: roles:select_message, roles:delete:123
Bad:  select_message, deleteRole
```

### 6. Validate Permissions

```typescript
const member = interaction.member as GuildMember;
if (!member.permissions.has(PermissionFlagsBits.ManageRoles)) {
  await interaction.reply({
    embeds: [Panel.createErrorEmbed('Permission Denied', 'You need Manage Roles.')],
    ephemeral: true,
  });
  return;
}
```

### 7. Log Important Actions

```typescript
logger.info(`User ${member.user.username} created item in guild ${guild.name}`);
logger.warn(`Failed to assign role - higher than bot's highest role`);
logger.error('Database error:', error);
```

---

## Common Patterns

### Pagination

```typescript
const ITEMS_PER_PAGE = 10;

static createListComponents(items: Item[], page: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / ITEMS_PER_PAGE));
  const start = page * ITEMS_PER_PAGE;
  const pageItems = items.slice(start, start + ITEMS_PER_PAGE);

  // Navigation buttons
  const nav = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('mymod:prev')
        .setEmoji('◀')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId('mymod:next')
        .setEmoji('▶')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1)
    );

  // ...
}
```

### Auto-Deleting Messages

```typescript
const reply = await interaction.reply({
  content: 'Success!',
  ephemeral: true,
});

setTimeout(() => {
  interaction.deleteReply().catch(() => {});
}, 3000);
```

### Two-Tier Interactions (Admin vs User)

Use different prefixes for admin panel vs user-facing:

```typescript
// Admin interactions
if (interaction.customId.startsWith('roles:')) {
  await handleAdminInteraction(interaction);
}

// User-facing interactions (public messages)
if (interaction.customId.startsWith('selfrole:')) {
  await handleUserInteraction(interaction);
}
```

### Service Injection Pattern

```typescript
// In module.ts
async onLoad(context: ModuleContext): Promise<void> {
  const service = new MyService(new DatabaseService());

  // Inject into all commands and events
  setCommandService(service);
  setEventService(service);
}

// In command/event files
let service: MyService | null = null;

export function setService(s: MyService): void {
  service = s;
}
```

---

## Centralized Settings System

If your module has configurable options per guild, register a settings schema with the centralized settings service.

### Defining Settings

```typescript
import { getModuleSettingsService } from '../../core/settings/ModuleSettingsService.js';
import type { ModuleSettingsSchema } from '../../core/settings/SettingsDefinition.js';

const MY_SETTINGS_SCHEMA: ModuleSettingsSchema = {
  moduleId: 'my-module',
  moduleName: 'My Module',
  settings: [
    {
      key: 'some_option',
      name: 'Some Option',
      description: 'Description shown in settings panel',
      type: 'number', // 'number' | 'string' | 'boolean' | 'channel' | 'role'
      defaultValue: 10,
      min: 1,
      max: 100,
      category: 'general',
    },
    {
      key: 'enabled_feature',
      name: 'Enable Feature',
      description: 'Toggle this feature on/off',
      type: 'boolean',
      defaultValue: true,
      category: 'features',
    },
  ],
};
```

### Registering/Unregistering Settings

```typescript
async onLoad(context: ModuleContext): Promise<void> {
  await super.onLoad(context);

  // Register settings schema
  const settingsService = getModuleSettingsService();
  if (settingsService) {
    settingsService.registerSchema(MY_SETTINGS_SCHEMA);
  }
}

async onUnload(): Promise<void> {
  // Unregister settings schema
  const settingsService = getModuleSettingsService();
  if (settingsService) {
    settingsService.unregisterSchema(this.metadata.id);
  }

  await super.onUnload();
}
```

### Reading Settings

```typescript
import { getModuleSettingsService } from '../../core/settings/ModuleSettingsService.js';

interface MySettings extends Record<string, unknown> {
  some_option: number;
  enabled_feature: boolean;
}

async function doSomething(guildId: string): Promise<void> {
  const settingsService = getModuleSettingsService();
  const settings = await settingsService?.getSettings<MySettings>(
    'my-module',
    guildId
  ) ?? { some_option: 10, enabled_feature: true };

  if (!settings.enabled_feature) {
    return; // Feature disabled for this guild
  }

  // Use settings.some_option
}
```

Settings are managed through the `/settings` admin command which provides a UI for server admins.

---

## Centralized Leaderboard System

If your module tracks per-user stats that could be displayed in a leaderboard, register with the central leaderboard system.

### Implementing a Leaderboard Provider

```typescript
import {
  getLeaderboardRegistry,
  LeaderboardProvider,
  LeaderboardEntry,
  UserRankInfo,
} from '../../core/leaderboards/LeaderboardRegistry.js';
```

### Registering a Leaderboard

```typescript
private registerLeaderboard(): void {
  if (!this.myService) return;

  const service = this.myService;
  const provider: LeaderboardProvider = {
    async getEntries(guildId: string, limit: number, offset: number): Promise<LeaderboardEntry[]> {
      const entries = await service.getLeaderboard(guildId, limit, offset);
      return entries.map((e) => ({
        userId: e.user_id,
        value: e.score,           // Primary value to display
        secondaryValue: e.count,  // Optional secondary value
      }));
    },

    async getUserRank(userId: string, guildId: string): Promise<UserRankInfo | null> {
      const stats = await service.getStats(userId, guildId);
      if (!stats) return null;

      const rank = await service.getUserRank(userId, guildId);
      return {
        rank,
        value: stats.score,
        secondaryValue: stats.count,
      };
    },

    async getTotalUsers(guildId: string): Promise<number> {
      return service.getTotalUsers(guildId);
    },
  };

  getLeaderboardRegistry().register({
    id: 'my-stats',                     // Unique leaderboard ID
    name: 'My Stats',                   // Display name in dropdown
    description: 'Top users by score',  // Description in dropdown
    emoji: '📊',                        // Emoji shown next to name
    moduleId: this.metadata.id,         // Your module ID
    unit: 'points',                     // Unit name (for reference)
    formatValue: (value: number) => `**${value.toLocaleString()}** points`,
    provider,
  });
}
```

### Format Value Examples

```typescript
// Points
formatValue: (value) => `**${value.toLocaleString()}** points`
// Output: **1,234** points

// Duration (seconds to hours/minutes)
formatValue: (seconds) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `**${hours}h ${minutes}m**`;
  return `**${minutes}m**`;
}
// Output: **2h 30m** or **45m**

// Count
formatValue: (value) => `**${value.toLocaleString()}** messages`
// Output: **5,678** messages
```

### Registering in Module Lifecycle

```typescript
async onLoad(context: ModuleContext): Promise<void> {
  await super.onLoad(context);

  // Initialize service first
  this.myService = new MyService(context.db, context.events);

  // Then register leaderboard
  this.registerLeaderboard();
}

async onUnload(): Promise<void> {
  // Unregister leaderboard
  getLeaderboardRegistry().unregister('my-stats');

  this.myService = null;
  await super.onUnload();
}
```

Users access all registered leaderboards through the `/leaderboard [type]` command, which shows a dropdown to switch between different leaderboards.

---

## Scheduled Tasks (Cron Jobs)

If your module needs to run periodic tasks (daily resets, cleanup, etc.), use the core cron service.

### Registering a Cron Job

```typescript
import { getCronService } from '../../core/cron/index.js';

async onLoad(context: ModuleContext): Promise<void> {
  await super.onLoad(context);

  // Register cron jobs
  const cron = getCronService();
  if (cron) {
    cron.registerJob(this.metadata.id, {
      id: 'daily-reset',
      schedule: 'daily',
      handler: async () => {
        await this.myService.resetDailyData();
      },
      description: 'Reset daily counters at midnight UTC',
    });

    // Run immediately on startup if needed
    cron.registerJob(this.metadata.id, {
      id: 'cleanup',
      schedule: 'hourly',
      handler: async () => {
        await this.myService.cleanupOldData();
      },
      description: 'Clean up expired data',
      runOnStart: true,  // Run immediately when registered
    });
  }
}
```

### Unregistering Cron Jobs

Always clean up cron jobs when your module unloads:

```typescript
async onUnload(): Promise<void> {
  // Unregister all cron jobs for this module
  const cron = getCronService();
  if (cron) {
    cron.unregisterAllForModule(this.metadata.id);
  }

  await super.onUnload();
}
```

### Schedule Options

| Schedule | Description |
|----------|-------------|
| `'minutely'` | Every minute |
| `'hourly'` | Every hour at :00 |
| `'daily'` | Every day at midnight UTC |
| `'weekly'` | Every Sunday at midnight UTC |
| `{ hours: 6 }` | Every day at 6:00 UTC |
| `{ hours: 12, minutes: 30 }` | Every day at 12:30 UTC |
| `{ dayOfWeek: 1, hours: 9 }` | Every Monday at 9:00 UTC |

### Custom Schedule Examples

```typescript
// Every day at 6 AM UTC
cron.registerJob(this.metadata.id, {
  id: 'morning-task',
  schedule: { hours: 6 },
  handler: async () => { /* ... */ },
});

// Every Monday at 9 AM UTC
cron.registerJob(this.metadata.id, {
  id: 'weekly-report',
  schedule: { dayOfWeek: 1, hours: 9 },
  handler: async () => { /* ... */ },
});

// Every hour at 30 minutes past (e.g., 1:30, 2:30, 3:30...)
cron.registerJob(this.metadata.id, {
  id: 'half-hour-task',
  schedule: { minutes: 30 },
  handler: async () => { /* ... */ },
});
```

### Managing Jobs at Runtime

```typescript
const cron = getCronService();

// Disable a job temporarily
cron.setJobEnabled('my-module', 'daily-reset', false);

// Re-enable it
cron.setJobEnabled('my-module', 'daily-reset', true);

// Manually trigger a job
await cron.triggerJob('my-module', 'daily-reset');

// Get job info
const job = cron.getJob('my-module', 'daily-reset');
console.log(`Last run: ${job?.lastRun}, Next run: ${job?.nextRun}`);

// Get all jobs for your module
const myJobs = cron.getJobsForModule('my-module');
```

### Best Practices

1. **Use descriptive IDs** - Make job IDs clear about what they do
2. **Handle errors** - Wrap handler logic in try/catch
3. **Keep jobs fast** - Long-running jobs block the next run
4. **Log important events** - Log when jobs start/complete/fail
5. **Clean up** - Always unregister in `onUnload()`

---

## Checklist for New Modules

- [ ] Create folder structure under `src/modules/<name>/`
- [ ] Create `module.ts` with proper metadata
- [ ] Create `index.ts` that exports an **instance** (not class)
- [ ] Create `migrations/001_initial.sql` with prefixed table names
- [ ] Create service class with database operations
- [ ] Create panel class for UI components
- [ ] Create command(s) with service injection
- [ ] Create `interactionCreate` event handler
- [ ] Use consistent custom ID prefixes (`<module>:<action>`)
- [ ] Add proper error handling and logging
- [ ] Test enable/disable functionality
- [ ] Test loading at runtime (commands should register)
- [ ] Register settings schema if module has configurable options
- [ ] Register leaderboard if module tracks per-user stats
