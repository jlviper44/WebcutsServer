-- Webcuts D1 Database Schema V2 - Security Enhanced
-- This schema includes user authentication, ownership verification, and improved security

-- Users table (NEW)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE,
  password_hash TEXT NOT NULL, -- bcrypt/scrypt hash
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login DATETIME,
  is_active BOOLEAN DEFAULT 1,
  is_verified BOOLEAN DEFAULT 0,
  verification_token TEXT,
  reset_token TEXT,
  reset_token_expires DATETIME,
  mfa_secret TEXT, -- Optional 2FA
  mfa_enabled BOOLEAN DEFAULT 0
);

-- Devices table (UPDATED with user ownership)
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL, -- NEW: Link to user
  device_token_encrypted TEXT UNIQUE NOT NULL, -- ENCRYPTED device token
  device_token_hash TEXT UNIQUE NOT NULL, -- For lookups without decryption
  device_name TEXT,
  bundle_id TEXT DEFAULT 'com.webcuts.app',
  registration_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT 1,
  is_trusted BOOLEAN DEFAULT 0, -- NEW: Trusted device flag
  push_environment TEXT DEFAULT 'sandbox' CHECK(push_environment IN ('sandbox', 'production')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Shortcuts table (UPDATED with better webhook IDs)
CREATE TABLE IF NOT EXISTS shortcuts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  device_id TEXT NOT NULL,
  user_id TEXT NOT NULL, -- NEW: Direct user reference for faster queries
  shortcut_id TEXT NOT NULL,
  shortcut_name TEXT NOT NULL,
  webhook_id TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(32)))), -- FULL random UUID
  webhook_secret TEXT, -- NEW: Per-webhook HMAC secret
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_triggered DATETIME,
  trigger_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT 1,
  expires_at DATETIME, -- NEW: Optional webhook expiration
  max_uses INTEGER, -- NEW: Optional usage limit
  allowed_ips TEXT, -- NEW: Optional IP whitelist (JSON array)
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(device_id, shortcut_id)
);

-- Webhook rotation history (NEW)
CREATE TABLE IF NOT EXISTS webhook_rotations (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  shortcut_id TEXT NOT NULL,
  old_webhook_id TEXT NOT NULL,
  new_webhook_id TEXT NOT NULL,
  rotated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  rotated_by TEXT, -- user_id or 'system'
  reason TEXT,
  FOREIGN KEY (shortcut_id) REFERENCES shortcuts(id) ON DELETE CASCADE
);

-- User API keys (UPDATED)
CREATE TABLE IF NOT EXISTS user_api_keys (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL,
  key_hash TEXT UNIQUE NOT NULL,
  key_prefix TEXT NOT NULL, -- First 8 chars for identification
  name TEXT,
  permissions TEXT DEFAULT '["webhook:trigger"]', -- JSON array of permissions
  rate_limit_override INTEGER, -- Custom rate limit for this key
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME,
  last_used DATETIME,
  last_used_ip TEXT,
  is_active BOOLEAN DEFAULT 1,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Webhook executions log (UPDATED with user tracking)
CREATE TABLE IF NOT EXISTS webhook_executions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  webhook_id TEXT NOT NULL,
  shortcut_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  user_id TEXT NOT NULL, -- NEW: Track which user's webhook was triggered
  payload TEXT,
  status TEXT CHECK(status IN ('success', 'failed', 'pending', 'unauthorized')),
  error_message TEXT,
  notification_id TEXT,
  apns_id TEXT,
  executed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  response_time_ms INTEGER,
  ip_address TEXT, -- NEW: Track source IP
  user_agent TEXT, -- NEW: Track user agent
  api_key_id TEXT, -- NEW: Track which API key was used
  FOREIGN KEY (webhook_id) REFERENCES shortcuts(webhook_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Rate limiting table (UPDATED with user context)
CREATE TABLE IF NOT EXISTS rate_limits (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL, -- Can be user:id, ip:address, webhook:id, etc.
  window_start DATETIME NOT NULL,
  request_count INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(identifier, window_start)
);

-- Session tokens (NEW - for web dashboard)
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  is_active BOOLEAN DEFAULT 1,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Audit log (NEW - for security tracking)
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  action TEXT NOT NULL, -- 'login', 'webhook_trigger', 'device_register', etc.
  resource_type TEXT, -- 'webhook', 'device', 'user', etc.
  resource_id TEXT,
  details TEXT, -- JSON with additional context
  ip_address TEXT,
  user_agent TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Analytics table (unchanged but included for completeness)
CREATE TABLE IF NOT EXISTS analytics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  webhook_id TEXT NOT NULL,
  date DATE NOT NULL,
  trigger_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  unauthorized_count INTEGER DEFAULT 0, -- NEW
  avg_response_time_ms INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(webhook_id, date)
);

-- Push notification tokens cache (unchanged)
CREATE TABLE IF NOT EXISTS push_tokens_cache (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);
CREATE INDEX IF NOT EXISTS idx_devices_token_hash ON devices(device_token_hash);
CREATE INDEX IF NOT EXISTS idx_devices_active ON devices(is_active, user_id);
CREATE INDEX IF NOT EXISTS idx_shortcuts_user ON shortcuts(user_id);
CREATE INDEX IF NOT EXISTS idx_shortcuts_device ON shortcuts(device_id);
CREATE INDEX IF NOT EXISTS idx_shortcuts_webhook ON shortcuts(webhook_id);
CREATE INDEX IF NOT EXISTS idx_shortcuts_active ON shortcuts(is_active, user_id);
CREATE INDEX IF NOT EXISTS idx_executions_webhook ON webhook_executions(webhook_id);
CREATE INDEX IF NOT EXISTS idx_executions_user ON webhook_executions(user_id);
CREATE INDEX IF NOT EXISTS idx_executions_date ON webhook_executions(executed_at);
CREATE INDEX IF NOT EXISTS idx_rate_limits_identifier ON rate_limits(identifier, window_start);
CREATE INDEX IF NOT EXISTS idx_analytics_webhook_date ON analytics(webhook_id, date);
CREATE INDEX IF NOT EXISTS idx_user_api_keys_hash ON user_api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_user_api_keys_user ON user_api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_date ON audit_log(created_at);

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

-- Views for common queries (UPDATED with user context)
CREATE VIEW IF NOT EXISTS user_active_webhooks AS
SELECT 
  s.webhook_id,
  s.shortcut_id,
  s.shortcut_name,
  s.user_id,
  u.email as user_email,
  d.device_name,
  d.push_environment,
  s.trigger_count,
  s.last_triggered,
  s.expires_at,
  s.max_uses
FROM shortcuts s
JOIN devices d ON s.device_id = d.id
JOIN users u ON s.user_id = u.id
WHERE s.is_active = 1 AND d.is_active = 1 AND u.is_active = 1;

CREATE VIEW IF NOT EXISTS daily_user_analytics AS
SELECT 
  a.date,
  we.user_id,
  u.email,
  COUNT(DISTINCT a.webhook_id) as unique_webhooks,
  SUM(a.trigger_count) as total_triggers,
  SUM(a.success_count) as total_successes,
  SUM(a.failure_count) as total_failures,
  SUM(a.unauthorized_count) as total_unauthorized,
  AVG(a.avg_response_time_ms) as avg_response_time
FROM analytics a
JOIN shortcuts s ON a.webhook_id = s.webhook_id
JOIN webhook_executions we ON we.webhook_id = a.webhook_id
JOIN users u ON we.user_id = u.id
GROUP BY a.date, we.user_id
ORDER BY a.date DESC;