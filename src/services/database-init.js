/**
 * Database initialization service
 * Automatically creates tables if they don't exist
 */

export class DatabaseInitializer {
  constructor(db) {
    this.db = db;
  }

  async initialize() {
    try {
      // Check if tables exist by trying a simple query
      await this.db.prepare('SELECT 1 FROM devices LIMIT 1').first();
      console.log('✅ Database tables already exist');
      return true;
    } catch (error) {
      console.log('📦 Database tables not found, creating...');
      await this.createTables();
      return true;
    }
  }

  async createTables() {
    const statements = [
      // Devices table
      `CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        device_token TEXT UNIQUE NOT NULL,
        device_name TEXT,
        bundle_id TEXT DEFAULT 'com.webcuts.app',
        registration_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT 1,
        push_environment TEXT DEFAULT 'sandbox' CHECK(push_environment IN ('sandbox', 'production')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // Shortcuts table
      `CREATE TABLE IF NOT EXISTS shortcuts (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        device_id TEXT NOT NULL,
        shortcut_id TEXT NOT NULL,
        shortcut_name TEXT NOT NULL,
        webhook_id TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_triggered DATETIME,
        trigger_count INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT 1,
        FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
        UNIQUE(device_id, shortcut_id)
      )`,

      // Webhook executions log
      `CREATE TABLE IF NOT EXISTS webhook_executions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        webhook_id TEXT NOT NULL,
        shortcut_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        payload TEXT,
        status TEXT CHECK(status IN ('success', 'failed', 'pending')),
        error_message TEXT,
        notification_id TEXT,
        apns_id TEXT,
        executed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        response_time_ms INTEGER,
        FOREIGN KEY (webhook_id) REFERENCES shortcuts(webhook_id) ON DELETE CASCADE
      )`,

      // Rate limiting table
      `CREATE TABLE IF NOT EXISTS rate_limits (
        id TEXT PRIMARY KEY,
        identifier TEXT NOT NULL,
        window_start DATETIME NOT NULL,
        request_count INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(identifier, window_start)
      )`,

      // API keys table
      `CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        key_hash TEXT UNIQUE NOT NULL,
        device_id TEXT,
        name TEXT,
        permissions TEXT DEFAULT 'basic',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME,
        last_used DATETIME,
        is_active BOOLEAN DEFAULT 1,
        FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
      )`,

      // Analytics table
      `CREATE TABLE IF NOT EXISTS analytics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        webhook_id TEXT NOT NULL,
        date DATE NOT NULL,
        trigger_count INTEGER DEFAULT 0,
        success_count INTEGER DEFAULT 0,
        failure_count INTEGER DEFAULT 0,
        avg_response_time_ms INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(webhook_id, date)
      )`,

      // Push notification tokens cache
      `CREATE TABLE IF NOT EXISTS push_tokens_cache (
        id TEXT PRIMARY KEY,
        token TEXT NOT NULL,
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // Create indexes
      'CREATE INDEX IF NOT EXISTS idx_devices_token ON devices(device_token)',
      'CREATE INDEX IF NOT EXISTS idx_devices_active ON devices(is_active)',
      'CREATE INDEX IF NOT EXISTS idx_shortcuts_device ON shortcuts(device_id)',
      'CREATE INDEX IF NOT EXISTS idx_shortcuts_webhook ON shortcuts(webhook_id)',
      'CREATE INDEX IF NOT EXISTS idx_shortcuts_active ON shortcuts(is_active)',
      'CREATE INDEX IF NOT EXISTS idx_executions_webhook ON webhook_executions(webhook_id)',
      'CREATE INDEX IF NOT EXISTS idx_executions_date ON webhook_executions(executed_at)',
      'CREATE INDEX IF NOT EXISTS idx_rate_limits_identifier ON rate_limits(identifier, window_start)',
      'CREATE INDEX IF NOT EXISTS idx_analytics_webhook_date ON analytics(webhook_id, date)',
      'CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash)',
    ];

    // Execute all statements
    for (const statement of statements) {
      try {
        await this.db.prepare(statement).run();
      } catch (error) {
        console.error(`Failed to execute: ${statement.substring(0, 50)}...`, error);
        throw error;
      }
    }

    console.log('✅ Database tables created successfully');
  }

  // Helper method to check if a specific table exists
  async tableExists(tableName) {
    try {
      await this.db.prepare(`SELECT 1 FROM ${tableName} LIMIT 1`).first();
      return true;
    } catch {
      return false;
    }
  }

  // Method to drop all tables (for testing/reset)
  async dropAllTables() {
    const tables = [
      'webhook_executions',
      'analytics',
      'rate_limits',
      'api_keys',
      'push_tokens_cache',
      'shortcuts',
      'devices'
    ];

    for (const table of tables) {
      try {
        await this.db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
        console.log(`Dropped table: ${table}`);
      } catch (error) {
        console.error(`Failed to drop table ${table}:`, error);
      }
    }
  }
}