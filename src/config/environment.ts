import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

/**
 * Environment variable schema with validation
 */
const envSchema = z.object({
  // Discord
  BOT_TOKEN: z.string().min(1, 'BOT_TOKEN is required'),
  CLIENT_ID: z.string().min(1, 'CLIENT_ID is required'),
  DEV_GUILD_ID: z.string().optional(),
  BOT_OWNER_IDS: z.string().optional(), // Comma-separated list of owner user IDs

  // Environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Database
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),

  // Logging
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

/**
 * Validated environment type
 */
export type Environment = z.infer<typeof envSchema>;

/**
 * Parse and validate environment variables
 */
function parseEnvironment(): Environment {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('Environment validation failed:');
    for (const error of result.error.errors) {
      console.error(`  - ${error.path.join('.')}: ${error.message}`);
    }
    process.exit(1);
  }

  return result.data;
}

/**
 * Validated environment variables
 */
export const env: Environment = parseEnvironment();

/**
 * Helper flags for environment checks
 */
export const isDevelopment = env.NODE_ENV === 'development';
export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/**
 * Parse bot owner IDs from comma-separated string
 */
export const botOwnerIds: string[] = env.BOT_OWNER_IDS
  ? env.BOT_OWNER_IDS.split(',').map(id => id.trim()).filter(id => id.length > 0)
  : [];

/**
 * Check if a user ID is a bot owner
 */
export function isBotOwner(userId: string): boolean {
  return botOwnerIds.includes(userId);
}

/**
 * Parse MySQL connection URL into components
 */
export function parseDatabaseUrl(url: string): {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
} {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || '3306', 10),
    user: parsed.username,
    password: parsed.password,
    database: parsed.pathname.slice(1), // Remove leading slash
  };
}
