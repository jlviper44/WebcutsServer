/**
 * Enhanced Database service layer with user authentication and ownership verification
 */

export class DatabaseServiceV2 {
  constructor(db) {
    this.db = db;
  }

  // ============ USER OPERATIONS ============
  
  async createUser(userData) {
    const { id, email, username, password_hash, verification_token } = userData;
    
    return await this.db.prepare(`
      INSERT INTO users (id, email, username, password_hash, verification_token)
      VALUES (?, ?, ?, ?, ?)
      RETURNING id, email, username, created_at
    `).bind(id, email, username, password_hash, verification_token).first();
  }

  async getUserById(userId) {
    return await this.db.prepare(`
      SELECT * FROM users WHERE id = ?
    `).bind(userId).first();
  }

  async getUserByEmail(email) {
    return await this.db.prepare(`
      SELECT * FROM users WHERE email = ?
    `).bind(email).first();
  }

  async getUserByUsername(username) {
    return await this.db.prepare(`
      SELECT * FROM users WHERE username = ?
    `).bind(username).first();
  }

  async updateUserLastLogin(userId) {
    return await this.db.prepare(`
      UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(userId).run();
  }

  async verifyUserEmail(userId) {
    return await this.db.prepare(`
      UPDATE users SET is_verified = 1, verification_token = NULL WHERE id = ?
    `).bind(userId).run();
  }

  // ============ DEVICE OPERATIONS WITH USER CONTEXT ============
  
  async createDevice(userId, deviceTokenEncrypted, deviceTokenHash, deviceName, bundleId) {
    const id = crypto.randomUUID();
    
    return await this.db.prepare(`
      INSERT INTO devices (id, user_id, device_token_encrypted, device_token_hash, device_name, bundle_id)
      VALUES (?, ?, ?, ?, ?, ?)
      RETURNING *
    `).bind(id, userId, deviceTokenEncrypted, deviceTokenHash, deviceName, bundleId).first();
  }

  async getDevice(deviceTokenHash, userId) {
    return await this.db.prepare(`
      SELECT * FROM devices 
      WHERE device_token_hash = ? AND user_id = ? AND is_active = 1
    `).bind(deviceTokenHash, userId).first();
  }

  async getUserDevices(userId) {
    return await this.db.prepare(`
      SELECT id, device_name, bundle_id, last_seen, is_trusted, push_environment 
      FROM devices 
      WHERE user_id = ? AND is_active = 1
      ORDER BY last_seen DESC
    `).bind(userId).all();
  }

  async updateDevice(deviceId, userId, updates) {
    const { deviceName } = updates;
    return await this.db.prepare(`
      UPDATE devices 
      SET device_name = ?, last_updated = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
      RETURNING *
    `).bind(deviceName, deviceId, userId).first();
  }

  async deactivateDevice(deviceId, userId) {
    return await this.db.prepare(`
      UPDATE devices SET is_active = 0 
      WHERE id = ? AND user_id = ?
    `).bind(deviceId, userId).run();
  }

  // ============ SHORTCUT OPERATIONS WITH OWNERSHIP ============
  
  async createShortcut(deviceId, userId, shortcutId, shortcutName, webhookId, webhookSecret) {
    const id = crypto.randomUUID();
    
    return await this.db.prepare(`
      INSERT INTO shortcuts (id, device_id, user_id, shortcut_id, shortcut_name, webhook_id, webhook_secret)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).bind(id, deviceId, userId, shortcutId, shortcutName, webhookId, webhookSecret).first();
  }

  async getShortcutByWebhook(webhookId) {
    return await this.db.prepare(`
      SELECT 
        s.*,
        d.device_token_encrypted,
        d.device_token_hash,
        d.device_name,
        d.push_environment,
        u.id as user_id,
        u.email as user_email
      FROM shortcuts s
      JOIN devices d ON s.device_id = d.id
      JOIN users u ON s.user_id = u.id
      WHERE s.webhook_id = ? AND s.is_active = 1 AND d.is_active = 1 AND u.is_active = 1
    `).bind(webhookId).first();
  }

  async getShortcutByWebhookAndUser(webhookId, userId) {
    return await this.db.prepare(`
      SELECT 
        s.*,
        d.device_token_encrypted,
        d.device_name,
        d.push_environment
      FROM shortcuts s
      JOIN devices d ON s.device_id = d.id
      WHERE s.webhook_id = ? AND s.user_id = ? AND s.is_active = 1 AND d.is_active = 1
    `).bind(webhookId, userId).first();
  }

  async getUserShortcuts(userId) {
    return await this.db.prepare(`
      SELECT 
        s.*,
        d.device_name
      FROM shortcuts s
      JOIN devices d ON s.device_id = d.id
      WHERE s.user_id = ? AND s.is_active = 1 AND d.is_active = 1
      ORDER BY s.shortcut_name
    `).bind(userId).all();
  }

  async rotateWebhookId(shortcutId, userId, newWebhookId, newWebhookSecret, reason = 'manual') {
    // Get current webhook ID
    const current = await this.db.prepare(`
      SELECT webhook_id FROM shortcuts 
      WHERE id = ? AND user_id = ?
    `).bind(shortcutId, userId).first();
    
    if (!current) return null;
    
    // Start transaction
    const batch = [];
    
    // Log rotation
    batch.push(this.db.prepare(`
      INSERT INTO webhook_rotations (id, shortcut_id, old_webhook_id, new_webhook_id, rotated_by, reason)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(crypto.randomUUID(), shortcutId, current.webhook_id, newWebhookId, userId, reason));
    
    // Update shortcut
    batch.push(this.db.prepare(`
      UPDATE shortcuts 
      SET webhook_id = ?, webhook_secret = ?
      WHERE id = ? AND user_id = ?
    `).bind(newWebhookId, newWebhookSecret, shortcutId, userId));
    
    await this.db.batch(batch);
    
    return { oldWebhookId: current.webhook_id, newWebhookId };
  }

  // ============ SESSION MANAGEMENT ============
  
  async createSession(sessionData) {
    const { user_id, token_hash, expires_at, ip_address, user_agent } = sessionData;
    const id = crypto.randomUUID();
    
    return await this.db.prepare(`
      INSERT INTO sessions (id, user_id, token_hash, expires_at, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?)
      RETURNING id
    `).bind(id, user_id, token_hash, expires_at, ip_address, user_agent).first();
  }

  async getSessionByTokenHash(tokenHash) {
    return await this.db.prepare(`
      SELECT * FROM sessions 
      WHERE token_hash = ? AND is_active = 1
    `).bind(tokenHash).first();
  }

  async deactivateSession(sessionId) {
    return await this.db.prepare(`
      UPDATE sessions SET is_active = 0 WHERE id = ?
    `).bind(sessionId).run();
  }

  async deactivateUserSessions(userId) {
    return await this.db.prepare(`
      UPDATE sessions SET is_active = 0 WHERE user_id = ?
    `).bind(userId).run();
  }

  // ============ API KEY MANAGEMENT ============
  
  async createUserAPIKey(keyData) {
    const { user_id, key_hash, key_prefix, name, permissions } = keyData;
    const id = crypto.randomUUID();
    
    return await this.db.prepare(`
      INSERT INTO user_api_keys (id, user_id, key_hash, key_prefix, name, permissions)
      VALUES (?, ?, ?, ?, ?, ?)
      RETURNING id, key_prefix, name
    `).bind(id, user_id, key_hash, key_prefix, name, permissions).first();
  }

  async getUserAPIKeyByHash(keyHash) {
    return await this.db.prepare(`
      SELECT * FROM user_api_keys 
      WHERE key_hash = ? AND is_active = 1
    `).bind(keyHash).first();
  }

  async getUserAPIKeys(userId) {
    return await this.db.prepare(`
      SELECT id, key_prefix, name, permissions, created_at, last_used, expires_at
      FROM user_api_keys 
      WHERE user_id = ? AND is_active = 1
      ORDER BY created_at DESC
    `).bind(userId).all();
  }

  async updateAPIKeyLastUsed(keyId, ipAddress = null) {
    return await this.db.prepare(`
      UPDATE user_api_keys 
      SET last_used = CURRENT_TIMESTAMP, last_used_ip = ?
      WHERE id = ?
    `).bind(ipAddress, keyId).run();
  }

  async deactivateAPIKey(keyId) {
    return await this.db.prepare(`
      UPDATE user_api_keys SET is_active = 0 WHERE id = ?
    `).bind(keyId).run();
  }

  // ============ WEBHOOK EXECUTION WITH USER CONTEXT ============
  
  async logWebhookExecution(executionData) {
    const { 
      webhook_id, shortcut_id, device_id, user_id, 
      payload, status, error_message, notification_id, 
      apns_id, response_time_ms, ip_address, user_agent, api_key_id 
    } = executionData;
    
    return await this.db.prepare(`
      INSERT INTO webhook_executions 
      (webhook_id, shortcut_id, device_id, user_id, payload, status, error_message, 
       notification_id, apns_id, response_time_ms, ip_address, user_agent, api_key_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      webhook_id, shortcut_id, device_id, user_id,
      JSON.stringify(payload), status, error_message,
      notification_id, apns_id, response_time_ms,
      ip_address, user_agent, api_key_id
    ).run();
  }

  async getUserWebhookExecutions(userId, limit = 10) {
    return await this.db.prepare(`
      SELECT 
        we.*,
        s.shortcut_name,
        d.device_name
      FROM webhook_executions we
      JOIN shortcuts s ON we.webhook_id = s.webhook_id
      JOIN devices d ON we.device_id = d.id
      WHERE we.user_id = ? 
      ORDER BY we.executed_at DESC 
      LIMIT ?
    `).bind(userId, limit).all();
  }

  // ============ RATE LIMITING WITH USER CONTEXT ============
  
  async checkRateLimit(identifier, windowMinutes = 1, maxRequests = 10) {
    const windowStart = new Date();
    windowStart.setSeconds(0, 0);
    windowStart.setMinutes(Math.floor(windowStart.getMinutes() / windowMinutes) * windowMinutes);
    
    const result = await this.db.prepare(`
      SELECT request_count FROM rate_limits 
      WHERE identifier = ? AND window_start = ?
    `).bind(identifier, windowStart.toISOString()).first();
    
    if (!result) {
      await this.db.prepare(`
        INSERT INTO rate_limits (id, identifier, window_start, request_count)
        VALUES (?, ?, ?, 1)
      `).bind(crypto.randomUUID(), identifier, windowStart.toISOString()).run();
      return { allowed: true, remaining: maxRequests - 1 };
    }
    
    if (result.request_count >= maxRequests) {
      return { allowed: false, remaining: 0 };
    }
    
    await this.db.prepare(`
      UPDATE rate_limits 
      SET request_count = request_count + 1 
      WHERE identifier = ? AND window_start = ?
    `).bind(identifier, windowStart.toISOString()).run();
    
    return { allowed: true, remaining: maxRequests - result.request_count - 1 };
  }

  // ============ AUDIT LOGGING ============
  
  async createAuditLog(auditData) {
    const { user_id, action, resource_type, resource_id, details, ip_address, user_agent } = auditData;
    
    return await this.db.prepare(`
      INSERT INTO audit_log (user_id, action, resource_type, resource_id, details, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(user_id, action, resource_type, resource_id, details, ip_address, user_agent).run();
  }

  async getUserAuditLog(userId, limit = 50) {
    return await this.db.prepare(`
      SELECT * FROM audit_log 
      WHERE user_id = ? 
      ORDER BY created_at DESC 
      LIMIT ?
    `).bind(userId, limit).all();
  }

  // ============ ANALYTICS WITH USER CONTEXT ============
  
  async updateAnalytics(webhookId, success, responseTime) {
    const date = new Date().toISOString().split('T')[0];
    
    const existing = await this.db.prepare(`
      SELECT * FROM analytics WHERE webhook_id = ? AND date = ?
    `).bind(webhookId, date).first();
    
    if (existing) {
      const updates = success 
        ? `success_count = success_count + 1`
        : `failure_count = failure_count + 1`;
      
      await this.db.prepare(`
        UPDATE analytics 
        SET trigger_count = trigger_count + 1,
            ${updates},
            avg_response_time_ms = ((avg_response_time_ms * trigger_count) + ?) / (trigger_count + 1)
        WHERE webhook_id = ? AND date = ?
      `).bind(responseTime, webhookId, date).run();
    } else {
      await this.db.prepare(`
        INSERT INTO analytics (webhook_id, date, trigger_count, success_count, failure_count, avg_response_time_ms)
        VALUES (?, ?, 1, ?, ?, ?)
      `).bind(webhookId, date, success ? 1 : 0, success ? 0 : 1, responseTime).run();
    }
  }

  async getUserAnalytics(userId, days = 7) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    return await this.db.prepare(`
      SELECT 
        a.*,
        s.shortcut_name
      FROM analytics a
      JOIN shortcuts s ON a.webhook_id = s.webhook_id
      WHERE s.user_id = ? AND a.date >= ?
      ORDER BY a.date DESC
    `).bind(userId, startDate.toISOString().split('T')[0]).all();
  }

  // ============ CLEANUP OPERATIONS ============
  
  async cleanupExpiredSessions() {
    return await this.db.prepare(`
      UPDATE sessions 
      SET is_active = 0 
      WHERE expires_at < CURRENT_TIMESTAMP AND is_active = 1
    `).run();
  }

  async cleanupOldRateLimits() {
    const cutoff = new Date();
    cutoff.setMinutes(cutoff.getMinutes() - 5);
    
    return await this.db.prepare(`
      DELETE FROM rate_limits WHERE window_start < ?
    `).bind(cutoff.toISOString()).run();
  }
}