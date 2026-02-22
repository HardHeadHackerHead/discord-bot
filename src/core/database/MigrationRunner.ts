import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { createHash } from 'crypto';
import { prisma } from './prisma.js';
import { db } from './mysql.js';
import { Logger } from '../../shared/utils/logger.js';

const logger = new Logger('MigrationRunner');

/**
 * Migration file information
 */
interface MigrationFile {
  filename: string;
  path: string;
  content: string;
  checksum: string;
}

/**
 * Runs SQL migrations for modules.
 * Each module can have a migrations/ folder with numbered SQL files.
 * Migrations are tracked in the module_migrations table.
 */
export class MigrationRunner {
  /**
   * Run all pending migrations for a module
   * @param moduleId - The module identifier
   * @param migrationsPath - Absolute path to the migrations folder
   * @returns Number of migrations run
   */
  async runMigrations(moduleId: string, migrationsPath: string): Promise<number> {
    logger.debug(`Checking migrations for module: ${moduleId}`);

    // Get list of migration files
    const migrationFiles = await this.getMigrationFiles(migrationsPath);

    if (migrationFiles.length === 0) {
      logger.debug(`No migrations found for module: ${moduleId}`);
      return 0;
    }

    // Get already executed migrations from database
    const executedMigrations = await prisma.moduleMigration.findMany({
      where: { moduleId },
      select: { filename: true, checksum: true },
    });

    const executedMap = new Map(
      executedMigrations.map(m => [m.filename, m.checksum])
    );

    // Find pending migrations
    const pendingMigrations: MigrationFile[] = [];

    for (const migration of migrationFiles) {
      const existingChecksum = executedMap.get(migration.filename);

      if (!existingChecksum) {
        // New migration
        pendingMigrations.push(migration);
      } else if (existingChecksum !== migration.checksum) {
        // Migration file was modified - this is a warning
        logger.warn(
          `Migration ${migration.filename} for module ${moduleId} has been modified since execution. ` +
          `Expected checksum: ${existingChecksum}, got: ${migration.checksum}`
        );
      }
    }

    if (pendingMigrations.length === 0) {
      logger.debug(`All migrations up to date for module: ${moduleId}`);
      return 0;
    }

    logger.info(`Running ${pendingMigrations.length} migration(s) for module: ${moduleId}`);

    // Run each pending migration
    let successCount = 0;

    for (const migration of pendingMigrations) {
      const success = await this.executeMigration(moduleId, migration);
      if (success) {
        successCount++;
      } else {
        // Stop on first failure
        break;
      }
    }

    return successCount;
  }

  /**
   * Get all migration files from a directory, sorted by filename
   */
  private async getMigrationFiles(migrationsPath: string): Promise<MigrationFile[]> {
    try {
      const files = await readdir(migrationsPath);

      // Filter for .sql files and sort by name (001_, 002_, etc.)
      const sqlFiles = files
        .filter(f => f.endsWith('.sql'))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

      const migrationFiles: MigrationFile[] = [];

      for (const filename of sqlFiles) {
        const path = join(migrationsPath, filename);
        const content = await readFile(path, 'utf-8');
        const checksum = this.calculateChecksum(content);

        migrationFiles.push({
          filename,
          path,
          content,
          checksum,
        });
      }

      return migrationFiles;
    } catch (error) {
      // Directory doesn't exist - no migrations
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Execute a single migration file
   */
  private async executeMigration(
    moduleId: string,
    migration: MigrationFile
  ): Promise<boolean> {
    logger.info(`Executing migration: ${migration.filename}`);

    try {
      // Split content into individual statements
      // Handle semicolons within strings and comments
      const statements = this.splitStatements(migration.content);

      // Execute each statement
      await db.transaction(async (connection) => {
        for (const statement of statements) {
          const trimmed = statement.trim();
          if (trimmed) {
            await connection.execute(trimmed);
          }
        }
      });

      // Record successful migration
      await prisma.moduleMigration.create({
        data: {
          moduleId,
          filename: migration.filename,
          checksum: migration.checksum,
          success: true,
        },
      });

      logger.info(`Migration ${migration.filename} completed successfully`);
      return true;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Migration ${migration.filename} failed: ${errorMessage}`);

      // Record failed migration
      await prisma.moduleMigration.create({
        data: {
          moduleId,
          filename: migration.filename,
          checksum: migration.checksum,
          success: false,
          errorMessage,
        },
      });

      return false;
    }
  }

  /**
   * Split SQL content into individual statements
   * Handles semicolons within strings and comments
   */
  private splitStatements(content: string): string[] {
    const statements: string[] = [];
    let current = '';
    let inString = false;
    let stringChar = '';
    let inComment = false;
    let inBlockComment = false;

    for (let i = 0; i < content.length; i++) {
      const char = content[i];
      const nextChar = content[i + 1];

      // Handle block comments /* */
      if (!inString && !inComment && char === '/' && nextChar === '*') {
        inBlockComment = true;
        current += char;
        continue;
      }

      if (inBlockComment && char === '*' && nextChar === '/') {
        inBlockComment = false;
        current += char + nextChar;
        i++;
        continue;
      }

      if (inBlockComment) {
        current += char;
        continue;
      }

      // Handle line comments --
      if (!inString && char === '-' && nextChar === '-') {
        inComment = true;
        current += char;
        continue;
      }

      if (inComment && char === '\n') {
        inComment = false;
        current += char;
        continue;
      }

      if (inComment) {
        current += char;
        continue;
      }

      // Handle strings
      if (!inString && (char === "'" || char === '"')) {
        inString = true;
        stringChar = char;
        current += char;
        continue;
      }

      if (inString && char === stringChar) {
        // Check for escaped quote
        if (nextChar === stringChar) {
          current += char + nextChar;
          i++;
          continue;
        }
        inString = false;
        current += char;
        continue;
      }

      if (inString) {
        current += char;
        continue;
      }

      // Handle statement terminator
      if (char === ';') {
        if (current.trim()) {
          statements.push(current.trim());
        }
        current = '';
        continue;
      }

      current += char;
    }

    // Add any remaining content
    if (current.trim()) {
      statements.push(current.trim());
    }

    return statements;
  }

  /**
   * Calculate MD5 checksum of content
   */
  private calculateChecksum(content: string): string {
    return createHash('md5').update(content).digest('hex');
  }

  /**
   * Check if a module has any failed migrations
   */
  async hasFailedMigrations(moduleId: string): Promise<boolean> {
    const failed = await prisma.moduleMigration.findFirst({
      where: { moduleId, success: false },
    });
    return failed !== null;
  }

  /**
   * Get migration status for a module
   */
  async getMigrationStatus(moduleId: string): Promise<{
    total: number;
    success: number;
    failed: number;
  }> {
    const migrations = await prisma.moduleMigration.findMany({
      where: { moduleId },
      select: { success: true },
    });

    return {
      total: migrations.length,
      success: migrations.filter(m => m.success).length,
      failed: migrations.filter(m => !m.success).length,
    };
  }
}

/**
 * Singleton instance
 */
export const migrationRunner = new MigrationRunner();
