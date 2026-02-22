import mysql, { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { parseDatabaseUrl, env } from '../../config/environment.js';

/**
 * MySQL connection pool for module table operations.
 * Used for runtime SQL migrations and module-specific queries.
 */
class MySQLService {
  private static pool: Pool | null = null;

  /**
   * Get or create the connection pool
   */
  static getPool(): Pool {
    if (!MySQLService.pool) {
      const dbConfig = parseDatabaseUrl(env.DATABASE_URL);

      MySQLService.pool = mysql.createPool({
        host: dbConfig.host,
        port: dbConfig.port,
        user: dbConfig.user,
        password: dbConfig.password,
        database: dbConfig.database,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        enableKeepAlive: true,
        keepAliveInitialDelay: 0,
      });
    }
    return MySQLService.pool;
  }

  /**
   * Test the database connection
   */
  static async testConnection(): Promise<boolean> {
    try {
      const pool = MySQLService.getPool();
      const connection = await pool.getConnection();
      await connection.ping();
      connection.release();
      return true;
    } catch (error) {
      console.error('MySQL connection test failed:', error);
      return false;
    }
  }

  /**
   * Close the connection pool
   */
  static async close(): Promise<void> {
    if (MySQLService.pool) {
      await MySQLService.pool.end();
      MySQLService.pool = null;
    }
  }
}

/**
 * Export the MySQL pool
 */
export const mysqlPool = MySQLService.getPool();

/**
 * Export connection management
 */
export const testMySQLConnection = MySQLService.testConnection;
export const closeMySQLPool = MySQLService.close;

/**
 * Database service for modules to use for their custom tables.
 * Provides a simple interface for raw SQL queries.
 */
export class DatabaseService {
  private pool: Pool;

  constructor() {
    this.pool = MySQLService.getPool();
  }

  /**
   * Execute a query and return rows
   */
  async query<T extends RowDataPacket[]>(
    sql: string,
    params?: unknown[]
  ): Promise<T> {
    const [rows] = await this.pool.execute<T>(sql, params);
    return rows;
  }

  /**
   * Execute an insert/update/delete and return the result
   */
  async execute(
    sql: string,
    params?: unknown[]
  ): Promise<ResultSetHeader> {
    const [result] = await this.pool.execute<ResultSetHeader>(sql, params);
    return result;
  }

  /**
   * Get a connection for transactions
   */
  async getConnection(): Promise<PoolConnection> {
    return this.pool.getConnection();
  }

  /**
   * Execute multiple queries in a transaction
   */
  async transaction<T>(
    callback: (connection: PoolConnection) => Promise<T>
  ): Promise<T> {
    const connection = await this.pool.getConnection();

    try {
      await connection.beginTransaction();
      const result = await callback(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Check if a table exists
   */
  async tableExists(tableName: string): Promise<boolean> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) as count FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = ?`,
      [tableName]
    );
    return (rows[0]?.['count'] as number) > 0;
  }
}

/**
 * Singleton database service instance
 */
export const db = new DatabaseService();
