import { PrismaClient } from '@prisma/client';
import { env } from '../../config/environment.js';

/**
 * Prisma client singleton for core database operations.
 * Used for type-safe queries on core tables (users, guilds, modules, etc.)
 */
class PrismaService {
  private static instance: PrismaClient | null = null;

  /**
   * Get the Prisma client singleton
   */
  static getClient(): PrismaClient {
    if (!PrismaService.instance) {
      PrismaService.instance = new PrismaClient({
        log: env.LOG_LEVEL === 'debug'
          ? ['query', 'info', 'warn', 'error']
          : ['warn', 'error'],
      });
    }
    return PrismaService.instance;
  }

  /**
   * Connect to the database
   */
  static async connect(): Promise<void> {
    const client = PrismaService.getClient();
    await client.$connect();
  }

  /**
   * Disconnect from the database
   */
  static async disconnect(): Promise<void> {
    if (PrismaService.instance) {
      await PrismaService.instance.$disconnect();
      PrismaService.instance = null;
    }
  }
}

/**
 * Export the Prisma client singleton
 */
export const prisma = PrismaService.getClient();

/**
 * Export connection management functions
 */
export const connectPrisma = PrismaService.connect;
export const disconnectPrisma = PrismaService.disconnect;
