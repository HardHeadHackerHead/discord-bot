import { Logger } from '../../shared/utils/logger.js';

const logger = new Logger('SettingsDefinition');

/**
 * Supported setting value types
 */
export type SettingType = 'number' | 'string' | 'boolean' | 'channel' | 'role' | 'select';

/**
 * Option for select-type settings
 */
export interface SelectOption {
  value: string;
  label: string;
  description?: string;
}

/**
 * Definition of a single setting
 */
export interface SettingDefinition {
  /** Unique key for this setting within the module */
  key: string;

  /** Display name for UI */
  name: string;

  /** Description of what this setting does */
  description: string;

  /** Data type */
  type: SettingType;

  /** Default value */
  defaultValue: unknown;

  /** Minimum value (for numbers) */
  min?: number;

  /** Maximum value (for numbers) */
  max?: number;

  /** Whether this setting is required */
  required?: boolean;

  /** Category for grouping in UI */
  category?: string;

  /** Options for select type */
  options?: SelectOption[];
}

/**
 * Module settings schema - defines all settings a module supports
 */
export interface ModuleSettingsSchema {
  /** Module ID this schema belongs to */
  moduleId: string;

  /** Display name for the module */
  moduleName: string;

  /** Setting definitions */
  settings: SettingDefinition[];
}

/**
 * Registered setting with its current value
 */
export interface RegisteredSetting extends SettingDefinition {
  moduleId: string;
  moduleName: string;
}

/**
 * Central registry for module settings definitions.
 * Modules register their settings schema here so the system
 * knows what settings exist and how to validate/display them.
 */
export class SettingsRegistry {
  /** Map of moduleId -> settings schema */
  private schemas: Map<string, ModuleSettingsSchema> = new Map();

  /**
   * Register a module's settings schema
   */
  register(schema: ModuleSettingsSchema): void {
    // Validate schema
    for (const setting of schema.settings) {
      this.validateDefinition(setting);
    }

    this.schemas.set(schema.moduleId, schema);
    logger.debug(`Registered settings schema for module: ${schema.moduleId}`);
  }

  /**
   * Unregister a module's settings schema
   */
  unregister(moduleId: string): void {
    this.schemas.delete(moduleId);
    logger.debug(`Unregistered settings schema for module: ${moduleId}`);
  }

  /**
   * Get a module's settings schema
   */
  getSchema(moduleId: string): ModuleSettingsSchema | undefined {
    return this.schemas.get(moduleId);
  }

  /**
   * Get all registered schemas
   */
  getAllSchemas(): ModuleSettingsSchema[] {
    return Array.from(this.schemas.values());
  }

  /**
   * Get all modules that have registered settings
   */
  getModulesWithSettings(): { moduleId: string; moduleName: string }[] {
    return Array.from(this.schemas.values()).map((s) => ({
      moduleId: s.moduleId,
      moduleName: s.moduleName,
    }));
  }

  /**
   * Get a specific setting definition
   */
  getSetting(moduleId: string, key: string): SettingDefinition | undefined {
    const schema = this.schemas.get(moduleId);
    return schema?.settings.find((s) => s.key === key);
  }

  /**
   * Get all settings for a module
   */
  getModuleSettings(moduleId: string): RegisteredSetting[] {
    const schema = this.schemas.get(moduleId);
    if (!schema) return [];

    return schema.settings.map((s) => ({
      ...s,
      moduleId: schema.moduleId,
      moduleName: schema.moduleName,
    }));
  }

  /**
   * Get all settings across all modules, optionally filtered by category
   */
  getAllSettings(category?: string): RegisteredSetting[] {
    const result: RegisteredSetting[] = [];

    for (const schema of this.schemas.values()) {
      for (const setting of schema.settings) {
        if (!category || setting.category === category) {
          result.push({
            ...setting,
            moduleId: schema.moduleId,
            moduleName: schema.moduleName,
          });
        }
      }
    }

    return result;
  }

  /**
   * Get default values for a module's settings
   */
  getDefaultValues(moduleId: string): Record<string, unknown> {
    const schema = this.schemas.get(moduleId);
    if (!schema) return {};

    const defaults: Record<string, unknown> = {};
    for (const setting of schema.settings) {
      defaults[setting.key] = setting.defaultValue;
    }
    return defaults;
  }

  /**
   * Validate a value against a setting definition
   */
  validateValue(
    moduleId: string,
    key: string,
    value: unknown
  ): { valid: boolean; error?: string } {
    const setting = this.getSetting(moduleId, key);
    if (!setting) {
      return { valid: false, error: `Unknown setting: ${key}` };
    }

    return this.validateAgainstDefinition(setting, value);
  }

  /**
   * Validate a value against a definition
   */
  private validateAgainstDefinition(
    definition: SettingDefinition,
    value: unknown
  ): { valid: boolean; error?: string } {
    // Check required
    if (definition.required && (value === null || value === undefined)) {
      return { valid: false, error: `${definition.name} is required` };
    }

    // Allow null/undefined for non-required
    if (value === null || value === undefined) {
      return { valid: true };
    }

    // Type validation
    switch (definition.type) {
      case 'number':
        if (typeof value !== 'number' || isNaN(value)) {
          return { valid: false, error: `${definition.name} must be a number` };
        }
        if (definition.min !== undefined && value < definition.min) {
          return {
            valid: false,
            error: `${definition.name} must be at least ${definition.min}`,
          };
        }
        if (definition.max !== undefined && value > definition.max) {
          return {
            valid: false,
            error: `${definition.name} must be at most ${definition.max}`,
          };
        }
        break;

      case 'string':
        if (typeof value !== 'string') {
          return { valid: false, error: `${definition.name} must be a string` };
        }
        break;

      case 'boolean':
        if (typeof value !== 'boolean') {
          return { valid: false, error: `${definition.name} must be true or false` };
        }
        break;

      case 'channel':
      case 'role':
        // These are stored as snowflake strings
        if (typeof value !== 'string' || !/^\d{17,20}$/.test(value)) {
          return {
            valid: false,
            error: `${definition.name} must be a valid ${definition.type} ID`,
          };
        }
        break;

      case 'select':
        if (typeof value !== 'string') {
          return { valid: false, error: `${definition.name} must be a string` };
        }
        if (definition.options && !definition.options.some((o) => o.value === value)) {
          const validOptions = definition.options.map((o) => o.value).join(', ');
          return {
            valid: false,
            error: `${definition.name} must be one of: ${validOptions}`,
          };
        }
        break;
    }

    return { valid: true };
  }

  /**
   * Validate a setting definition
   */
  private validateDefinition(definition: SettingDefinition): void {
    if (!definition.key) {
      throw new Error('Setting definition must have a key');
    }
    if (!definition.name) {
      throw new Error(`Setting ${definition.key} must have a name`);
    }
    if (!definition.type) {
      throw new Error(`Setting ${definition.key} must have a type`);
    }
    if (definition.defaultValue === undefined) {
      throw new Error(`Setting ${definition.key} must have a defaultValue`);
    }
  }

  /**
   * Parse a string value to the correct type
   */
  parseValue(moduleId: string, key: string, stringValue: string): unknown {
    const setting = this.getSetting(moduleId, key);
    if (!setting) return stringValue;

    switch (setting.type) {
      case 'number':
        const num = parseFloat(stringValue);
        return isNaN(num) ? setting.defaultValue : num;

      case 'boolean':
        return stringValue.toLowerCase() === 'true' || stringValue === '1';

      case 'channel':
      case 'role':
        // Extract ID from mention format if needed
        const match = stringValue.match(/\d{17,20}/);
        return match ? match[0] : stringValue;

      default:
        return stringValue;
    }
  }

  /**
   * Format a value for display
   */
  formatValue(moduleId: string, key: string, value: unknown): string {
    const setting = this.getSetting(moduleId, key);
    if (!setting) return String(value);

    if (value === null || value === undefined) {
      return '*not set*';
    }

    switch (setting.type) {
      case 'boolean':
        return value ? 'Enabled' : 'Disabled';

      case 'channel':
        return `<#${value}>`;

      case 'role':
        return `<@&${value}>`;

      default:
        return String(value);
    }
  }
}

/**
 * Singleton instance
 */
export const settingsRegistry = new SettingsRegistry();
