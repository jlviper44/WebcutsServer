-- Webcuts D1 Database Schema

-- Devices table
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  device_token TEXT UNIQUE NOT NULL,
  device_name TEXT,
  bundle_id TEXT DEFAULT 'com.webcuts.app',
  registration_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT 1,
  push_environment TEXT DEFAULT 'sandbox' CHECK(push_environment IN ('sandbox', 'production')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Shortcuts table
CREATE TABLE IF NOT EXISTS shortcuts (
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
);

-- Webhook executions log
CREATE TABLE IF NOT EXISTS webhook_executions (
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
);

-- Rate limiting table
CREATE TABLE IF NOT EXISTS rate_limits (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  window_start DATETIME NOT NULL,
  request_count INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(identifier, window_start)
);

-- API keys table (for authenticated requests)
CREATE TABLE IF NOT EXISTS api_keys (
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
);

-- Analytics table
CREATE TABLE IF NOT EXISTS analytics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  webhook_id TEXT NOT NULL,
  date DATE NOT NULL,
  trigger_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  avg_response_time_ms INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(webhook_id, date)
);

-- Push notification tokens cache
CREATE TABLE IF NOT EXISTS push_tokens_cache (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_devices_token ON devices(device_token);
CREATE INDEX IF NOT EXISTS idx_devices_active ON devices(is_active);
CREATE INDEX IF NOT EXISTS idx_shortcuts_device ON shortcuts(device_id);
CREATE INDEX IF NOT EXISTS idx_shortcuts_webhook ON shortcuts(webhook_id);
CREATE INDEX IF NOT EXISTS idx_shortcuts_active ON shortcuts(is_active);
CREATE INDEX IF NOT EXISTS idx_executions_webhook ON webhook_executions(webhook_id);
CREATE INDEX IF NOT EXISTS idx_executions_date ON webhook_executions(executed_at);
CREATE INDEX IF NOT EXISTS idx_rate_limits_identifier ON rate_limits(identifier, window_start);
CREATE INDEX IF NOT EXISTS idx_analytics_webhook_date ON analytics(webhook_id, date);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

-- Triggers for auto-updating timestamps
CREATE TRIGGER IF NOT EXISTS update_device_timestamp 
  AFTER UPDATE ON devices
  BEGIN
    UPDATE devices SET last_updated = CURRENT_TIMESTAMP WHERE id = NEW.id;
  END;

CREATE TRIGGER IF NOT EXISTS update_shortcut_trigger_count
  AFTER INSERT ON webhook_executions
  WHEN NEW.status = 'success'
  BEGIN
    UPDATE shortcuts 
    SET trigger_count = trigger_count + 1,
        last_triggered = NEW.executed_at
    WHERE webhook_id = NEW.webhook_id;
  END;

-- Views for common queries
CREATE VIEW IF NOT EXISTS active_webhooks AS
SELECT 
  s.webhook_id,
  s.shortcut_id,
  s.shortcut_name,
  d.device_token,
  d.device_name,
  d.push_environment,
  s.trigger_count,
  s.last_triggered
FROM shortcuts s
JOIN devices d ON s.device_id = d.id
WHERE s.is_active = 1 AND d.is_active = 1;

CREATE VIEW IF NOT EXISTS daily_analytics AS
SELECT 
  date,
  COUNT(DISTINCT webhook_id) as unique_webhooks,
  SUM(trigger_count) as total_triggers,
  SUM(success_count) as total_successes,
  SUM(failure_count) as total_failures,
  AVG(avg_response_time_ms) as avg_response_time
FROM analytics
GROUP BY date
ORDER BY date DESC;