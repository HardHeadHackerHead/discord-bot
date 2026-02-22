import { DatabaseService } from '../../../core/database/mysql.js';
import { Logger } from '../../../shared/utils/logger.js';
import { RowDataPacket } from 'mysql2';
import { readdirSync, readFileSync, statSync } from 'fs';
import { createHash } from 'crypto';
import path from 'path';

const logger = new Logger('CodeStats');

export interface CodeStats {
  totalLines: number;
  codeLines: number;
  commentLines: number;
  blankLines: number;
  fileCount: number;
  moduleCount: number;
}

export interface CodeStatsRecord extends CodeStats {
  id: number;
  recorded_at: Date;
  stats_hash: string;
}

export class CodeStatsService {
  constructor(private db: DatabaseService) {}

  /**
   * Check if we're running in production (Docker) without source files
   */
  private isProductionWithoutSource(): boolean {
    const srcPath = path.join(process.cwd(), 'src');
    try {
      statSync(srcPath);
      return false; // src exists, we can count
    } catch {
      return true; // src doesn't exist (production Docker build)
    }
  }

  /**
   * Count lines of code in the src directory
   * Returns null if running in production without source files
   */
  countLines(): CodeStats | null {
    // Skip counting in production builds where src doesn't exist
    if (this.isProductionWithoutSource()) {
      logger.debug('Skipping code stats - running in production without source files');
      return null;
    }

    const srcPath = path.join(process.cwd(), 'src');
    const stats: CodeStats = {
      totalLines: 0,
      codeLines: 0,
      commentLines: 0,
      blankLines: 0,
      fileCount: 0,
      moduleCount: this.countModules(),
    };

    this.processDirectory(srcPath, stats);
    return stats;
  }

  /**
   * Count the number of modules in src/modules
   */
  private countModules(): number {
    const modulesPath = path.join(process.cwd(), 'src', 'modules');
    try {
      const entries = readdirSync(modulesPath);
      let count = 0;
      for (const entry of entries) {
        const fullPath = path.join(modulesPath, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          // Check if it has a module.ts file (valid module)
          const moduleFile = path.join(fullPath, 'module.ts');
          try {
            statSync(moduleFile);
            count++;
          } catch {
            // No module.ts, not a valid module
          }
        }
      }
      return count;
    } catch {
      return 0;
    }
  }

  private processDirectory(dirPath: string, stats: CodeStats): void {
    try {
      const entries = readdirSync(dirPath);

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry);
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
          if (entry !== 'node_modules' && entry !== 'dist' && entry !== '.git') {
            this.processDirectory(fullPath, stats);
          }
        } else if (entry.endsWith('.ts') || entry.endsWith('.js')) {
          stats.fileCount++;
          const content = readFileSync(fullPath, 'utf-8');
          const lines = content.split('\n');

          let inBlockComment = false;

          for (const line of lines) {
            const trimmed = line.trim();
            stats.totalLines++;

            if (trimmed === '') {
              stats.blankLines++;
            } else if (inBlockComment) {
              stats.commentLines++;
              if (trimmed.includes('*/')) {
                inBlockComment = false;
              }
            } else if (trimmed.startsWith('/*')) {
              stats.commentLines++;
              if (!trimmed.includes('*/')) {
                inBlockComment = true;
              }
            } else if (trimmed.startsWith('//')) {
              stats.commentLines++;
            } else if (trimmed.startsWith('*')) {
              stats.commentLines++;
            } else {
              stats.codeLines++;
            }
          }
        }
      }
    } catch (error) {
      logger.error(`Error processing directory ${dirPath}:`, error);
    }
  }

  /**
   * Generate a hash for the stats to detect duplicates
   */
  private generateHash(stats: CodeStats): string {
    const data = `${stats.totalLines}-${stats.codeLines}-${stats.commentLines}-${stats.blankLines}-${stats.fileCount}-${stats.moduleCount}`;
    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * Record current stats to database (only if different from last entry)
   * In production without source files, returns the latest stats from database
   */
  async recordStats(): Promise<{ recorded: boolean; stats: CodeStats | null }> {
    const stats = this.countLines();

    // In production without source files, just return latest from database
    if (stats === null) {
      const latest = await this.getLatestStats();
      if (latest) {
        logger.info(`Production mode - using last recorded stats: ${latest.totalLines.toLocaleString()} lines`);
      } else {
        logger.info('Production mode - no previous stats recorded');
      }
      return { recorded: false, stats: latest };
    }

    const hash = this.generateHash(stats);

    try {
      // Try to insert - will fail silently if hash already exists (duplicate)
      await this.db.execute(
        `INSERT IGNORE INTO admin_code_stats
         (total_lines, code_lines, comment_lines, blank_lines, file_count, module_count, stats_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [stats.totalLines, stats.codeLines, stats.commentLines, stats.blankLines, stats.fileCount, stats.moduleCount, hash]
      );

      // Check if it was actually inserted
      const rows = await this.db.query<(RowDataPacket & { cnt: number })[]>(
        'SELECT COUNT(*) as cnt FROM admin_code_stats WHERE stats_hash = ?',
        [hash]
      );

      const recorded = rows[0]?.cnt === 1;

      if (recorded) {
        logger.info(`Recorded code stats: ${stats.totalLines.toLocaleString()} total lines, ${stats.fileCount} files, ${stats.moduleCount} modules`);
      } else {
        logger.debug('Code stats unchanged, skipping record');
      }

      return { recorded, stats };
    } catch (error) {
      logger.error('Failed to record code stats:', error);
      return { recorded: false, stats };
    }
  }

  /**
   * Get the most recent stats record
   */
  async getLatestStats(): Promise<CodeStatsRecord | null> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT
        id,
        recorded_at,
        total_lines AS totalLines,
        code_lines AS codeLines,
        comment_lines AS commentLines,
        blank_lines AS blankLines,
        file_count AS fileCount,
        COALESCE(module_count, 0) AS moduleCount,
        stats_hash
       FROM admin_code_stats
       ORDER BY recorded_at DESC
       LIMIT 1`
    );
    return (rows[0] as CodeStatsRecord) || null;
  }

  /**
   * Get stats history (most recent first)
   */
  async getHistory(limit: number = 30): Promise<CodeStatsRecord[]> {
    // Sanitize limit to ensure it's a positive integer
    const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT
        id,
        recorded_at,
        total_lines AS totalLines,
        code_lines AS codeLines,
        comment_lines AS commentLines,
        blank_lines AS blankLines,
        file_count AS fileCount,
        COALESCE(module_count, 0) AS moduleCount,
        stats_hash
       FROM admin_code_stats
       ORDER BY recorded_at DESC
       LIMIT ${safeLimit}`
    );
    return rows as CodeStatsRecord[];
  }

  /**
   * Get total count of stats records
   */
  async getRecordCount(): Promise<number> {
    const rows = await this.db.query<(RowDataPacket & { cnt: number })[]>(
      'SELECT COUNT(*) as cnt FROM admin_code_stats'
    );
    return rows[0]?.cnt || 0;
  }

  /**
   * Get the first recorded stats (oldest)
   */
  async getFirstStats(): Promise<CodeStatsRecord | null> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT
        id,
        recorded_at,
        total_lines AS totalLines,
        code_lines AS codeLines,
        comment_lines AS commentLines,
        blank_lines AS blankLines,
        file_count AS fileCount,
        COALESCE(module_count, 0) AS moduleCount,
        stats_hash
       FROM admin_code_stats
       ORDER BY recorded_at ASC
       LIMIT 1`
    );
    return (rows[0] as CodeStatsRecord) || null;
  }

  /**
   * Calculate growth since first record
   */
  async getGrowthStats(): Promise<{
    firstRecord: CodeStatsRecord | null;
    latestRecord: CodeStatsRecord | null;
    linesDiff: number;
    filesDiff: number;
    modulesDiff: number;
    daysSinceFirst: number;
  } | null> {
    const first = await this.getFirstStats();
    const latest = await this.getLatestStats();

    if (!first || !latest) {
      return null;
    }

    const daysSinceFirst = Math.floor(
      (latest.recorded_at.getTime() - first.recorded_at.getTime()) / (1000 * 60 * 60 * 24)
    );

    return {
      firstRecord: first,
      latestRecord: latest,
      linesDiff: latest.totalLines - first.totalLines,
      filesDiff: latest.fileCount - first.fileCount,
      modulesDiff: (latest.moduleCount || 0) - (first.moduleCount || 0),
      daysSinceFirst,
    };
  }
}

// Singleton instance
let codeStatsService: CodeStatsService | null = null;

export function initCodeStatsService(db: DatabaseService): CodeStatsService {
  codeStatsService = new CodeStatsService(db);
  return codeStatsService;
}

export function getCodeStatsService(): CodeStatsService | null {
  return codeStatsService;
}
