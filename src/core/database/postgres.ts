import pg from 'pg';
import { parseDatabaseUrl } from '../../config/environment.js';

/**
 * Type alias for backward compatibility with mysql2 RowDataPacket.
 * Modules use this in generic type parameters for query results.
 * Uses `any` to match mysql2's permissive typing for row data.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RowDataPacket = Record<string, any>;

/**
 * Result type for execute operations (insert/update/delete).
 * Provides `affectedRows` for backward compatibility with mysql2 ResultSetHeader.
 */
export interface ExecuteResult {
  affectedRows: number;
  rows: Record<string, unknown>[];
}

/**
 * Transaction client wrapper providing execute/query on a single connection.
 */
export interface TransactionClient {
  execute(sql: string, params?: unknown[]): Promise<pg.QueryResult>;
  query(sql: string, params?: unknown[]): Promise<pg.QueryResult>;
}

/**
 * Convert MySQL-style ? placeholders to PostgreSQL $1, $2, ... format.
 * Handles quoted strings so ?s inside string literals are not replaced.
 */
function convertPlaceholders(sql: string): string {
  let index = 0;
  let inString = false;
  let stringChar = '';
  let result = '';

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];

    if (!inString && (char === "'" || char === '"')) {
      inString = true;
      stringChar = char;
      result += char;
      continue;
    }

    if (inString && char === stringChar) {
      if (sql[i + 1] === stringChar) {
        result += char + stringChar;
        i++;
        continue;
      }
      inString = false;
      result += char;
      continue;
    }

    if (inString) {
      result += char;
      continue;
    }

    if (char === '?') {
      result += `$${++index}`;
      continue;
    }

    result += char;
  }

  return result;
}

/**
 * PostgreSQL connection pool for module table operations.
 * Used for runtime SQL migrations and module-specific queries.
 */
class PostgresService {
  private static pool: pg.Pool | null = null;

  static getPool(): pg.Pool {
    if (!PostgresService.pool) {
      const dbConfig = parseDatabaseUrl();

      PostgresService.pool = new pg.Pool({
        host: dbConfig.host,
        port: dbConfig.port,
        user: dbConfig.user,
        password: dbConfig.password,
        database: dbConfig.database,
        max: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
        ssl: dbConfig.ssl ? { rejectUnauthorized: false } : undefined,
      });
    }
    return PostgresService.pool;
  }

  static async testConnection(): Promise<boolean> {
    try {
      const pool = PostgresService.getPool();
      const client = await pool.connect();
      await client.query('SELECT 1');
      client.release();
      return true;
    } catch (error) {
      console.error('PostgreSQL connection test failed:', error);
      return false;
    }
  }

  static async close(): Promise<void> {
    if (PostgresService.pool) {
      await PostgresService.pool.end();
      PostgresService.pool = null;
    }
  }
}

/**
 * Export connection management.
 */
export const testConnection = PostgresService.testConnection;
export const closePool = PostgresService.close;

/**
 * Database service for modules to use for their custom tables.
 * Provides a simple interface for raw SQL queries.
 *
 * MySQL ? placeholders are auto-converted to PostgreSQL $1, $2, ...
 * so existing query strings work without modification.
 */
export class DatabaseService {
  private pool: pg.Pool;

  constructor() {
    this.pool = PostgresService.getPool();
  }

  /**
   * Execute a query and return rows
   */
  async query<T = RowDataPacket[]>(
    sql: string,
    params?: unknown[]
  ): Promise<T> {
    const result = await this.pool.query(convertPlaceholders(sql), params);
    return result.rows as T;
  }

  /**
   * Execute an insert/update/delete and return the result
   */
  async execute(
    sql: string,
    params?: unknown[]
  ): Promise<ExecuteResult> {
    const result = await this.pool.query(convertPlaceholders(sql), params);
    return {
      affectedRows: result.rowCount ?? 0,
      rows: result.rows,
    };
  }

  /**
   * Get a raw pool client for advanced use
   */
  async getConnection(): Promise<pg.PoolClient> {
    return this.pool.connect();
  }

  /**
   * Execute multiple queries in a transaction.
   * The callback receives a TransactionClient with execute() and query() methods.
   */
  async transaction<T>(
    callback: (connection: TransactionClient) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect();

    const wrappedClient: TransactionClient = {
      execute: (sql: string, params?: unknown[]) =>
        client.query(convertPlaceholders(sql), params),
      query: (sql: string, params?: unknown[]) =>
        client.query(convertPlaceholders(sql), params),
    };

    try {
      await client.query('BEGIN');
      const result = await callback(wrappedClient);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Check if a table exists in the public schema
   */
  async tableExists(tableName: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT COUNT(*) as count FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1`,
      [tableName]
    );
    return parseInt(result.rows[0]?.count as string, 10) > 0;
  }
}

/**
 * Singleton database service instance
 */
export const db = new DatabaseService();
