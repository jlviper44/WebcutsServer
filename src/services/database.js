/**
 * Database service layer for D1 operations
 */

export class DatabaseService {
  constructor(db) {
    this.db = db;
  }

  // Device operations
  async createDevice(deviceToken, deviceName, bundleId) {
    const id = crypto.randomUUID();
    const result = await this.db.prepare(`
      INSERT INTO devices (id, device_token, device_name, bundle_id)
      VALUES (?, ?, ?, ?)
      RETURNING *
    `).bind(id, deviceToken, deviceName, bundleId).first();
    
    return result;
  }

  async getDevice(deviceToken) {
    return await this.db.prepare(`
      SELECT * FROM devices WHERE device_token = ? AND is_active = 1
    `).bind(deviceToken).first();
  }

  async updateDevice(deviceToken, updates) {
    const { deviceName } = updates;
    return await this.db.prepare(`
      UPDATE devices 
      SET device_name = ?, last_updated = CURRENT_TIMESTAMP
      WHERE device_token = ?
      RETURNING *
    `).bind(deviceName, deviceToken).first();
  }

  async deactivateDevice(deviceToken) {
    return await this.db.prepare(`
      UPDATE devices SET is_active = 0 WHERE device_token = ?
    `).bind(deviceToken).run();
  }

  // Shortcut operations
  async createShortcut(deviceId, shortcutId, shortcutName, webhookId) {
    const id = crypto.randomUUID();
    return await this.db.prepare(`
      INSERT INTO shortcuts (id, device_id, shortcut_id, shortcut_name, webhook_id)
      VALUES (?, ?, ?, ?, ?)
      RETURNING *
    `).bind(id, deviceId, shortcutId, shortcutName, webhookId).first();
  }

  async createShortcutsBatch(deviceId, shortcuts) {
    const batch = [];
    for (const shortcut of shortcuts) {
      const id = crypto.randomUUID();
      batch.push(
        this.db.prepare(`
          INSERT OR REPLACE INTO shortcuts (id, device_id, shortcut_id, shortcut_name, webhook_id)
          VALUES (?, ?, ?, ?, ?)
        `).bind(id, deviceId, shortcut.id, shortcut.name, shortcut.webhookId)
      );
    }
    
    await this.db.batch(batch);
    return { success: true, count: shortcuts.length };
  }

  async getShortcutByWebhook(webhookId) {
    return await this.db.prepare(`
      SELECT s.*, d.device_token, d.device_name, d.push_environment
      FROM shortcuts s
      JOIN devices d ON s.device_id = d.id
      WHERE s.webhook_id = ? AND s.is_active = 1 AND d.is_active = 1
    `).bind(webhookId).first();
  }

  async getDeviceShortcuts(deviceId) {
    return await this.db.prepare(`
      SELECT * FROM shortcuts 
      WHERE device_id = ? AND is_active = 1
      ORDER BY shortcut_name
    `).bind(deviceId).all();
  }

  async updateShortcut(deviceId, shortcutId, updates) {
    const { shortcutName } = updates;
    return await this.db.prepare(`
      UPDATE shortcuts 
      SET shortcut_name = ?
      WHERE device_id = ? AND shortcut_id = ?
      RETURNING *
    `).bind(shortcutName, deviceId, shortcutId).first();
  }

  async deactivateShortcut(webhookId) {
    return await this.db.prepare(`
      UPDATE shortcuts SET is_active = 0 WHERE webhook_id = ?
    `).bind(webhookId).run();
  }

  async removeDeviceShortcuts(deviceId, shortcutIds) {
    const placeholders = shortcutIds.map(() => '?').join(',');
    return await this.db.prepare(`
      UPDATE shortcuts 
      SET is_active = 0 
      WHERE device_id = ? AND shortcut_id IN (${placeholders})
    `).bind(deviceId, ...shortcutIds).run();
  }

  // Webhook execution logging
  async logWebhookExecution(webhookId, shortcutId, deviceId, payload, status, error, notificationId, apnsId, responseTime) {
    return await this.db.prepare(`
      INSERT INTO webhook_executions 
      (webhook_id, shortcut_id, device_id, payload, status, error_message, notification_id, apns_id, response_time_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      webhookId, 
      shortcutId, 
      deviceId, 
      JSON.stringify(payload), 
      status, 
      error, 
      notificationId, 
      apnsId, 
      responseTime
    ).run();
  }

  async getWebhookExecutions(webhookId, limit = 10) {
    return await this.db.prepare(`
      SELECT * FROM webhook_executions 
      WHERE webhook_id = ? 
      ORDER BY executed_at DESC 
      LIMIT ?
    `).bind(webhookId, limit).all();
  }

  // Rate limiting
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

  // Analytics
  async updateAnalytics(webhookId, success, responseTime) {
    const today = new Date().toISOString().split('T')[0];
    
    const existing = await this.db.prepare(`
      SELECT * FROM analytics WHERE webhook_id = ? AND date = ?
    `).bind(webhookId, today).first();
    
    if (!existing) {
      await this.db.prepare(`
        INSERT INTO analytics (webhook_id, date, trigger_count, success_count, failure_count, avg_response_time_ms)
        VALUES (?, ?, 1, ?, ?, ?)
      `).bind(webhookId, today, success ? 1 : 0, success ? 0 : 1, responseTime).run();
    } else {
      const newTriggerCount = existing.trigger_count + 1;
      const newSuccessCount = existing.success_count + (success ? 1 : 0);
      const newFailureCount = existing.failure_count + (success ? 0 : 1);
      const newAvgResponseTime = Math.round(
        (existing.avg_response_time_ms * existing.trigger_count + responseTime) / newTriggerCount
      );
      
      await this.db.prepare(`
        UPDATE analytics 
        SET trigger_count = ?, success_count = ?, failure_count = ?, avg_response_time_ms = ?
        WHERE webhook_id = ? AND date = ?
      `).bind(newTriggerCount, newSuccessCount, newFailureCount, newAvgResponseTime, webhookId, today).run();
    }
  }

  async getAnalytics(webhookId, days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    return await this.db.prepare(`
      SELECT * FROM analytics 
      WHERE webhook_id = ? AND date >= ? 
      ORDER BY date DESC
    `).bind(webhookId, startDate.toISOString().split('T')[0]).all();
  }

  // Token caching for APNs
  async getCachedToken(key) {
    const result = await this.db.prepare(`
      SELECT token FROM push_tokens_cache 
      WHERE id = ? AND expires_at > CURRENT_TIMESTAMP
    `).bind(key).first();
    
    return result?.token;
  }

  async setCachedToken(key, token, ttlSeconds) {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    
    await this.db.prepare(`
      INSERT OR REPLACE INTO push_tokens_cache (id, token, expires_at)
      VALUES (?, ?, ?)
    `).bind(key, token, expiresAt.toISOString()).run();
  }

  // API key management
  async validateApiKey(keyHash) {
    return await this.db.prepare(`
      SELECT * FROM api_keys 
      WHERE key_hash = ? AND is_active = 1 
      AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
    `).bind(keyHash).first();
  }

  async updateApiKeyLastUsed(keyHash) {
    await this.db.prepare(`
      UPDATE api_keys SET last_used = CURRENT_TIMESTAMP WHERE key_hash = ?
    `).bind(keyHash).run();
  }

  // Batch operations
  async createShortcutsBatch(deviceId, shortcuts) {
    const stmt = this.db.prepare(`
      INSERT INTO shortcuts (id, device_id, shortcut_id, shortcut_name, webhook_id)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    const batch = shortcuts.map(shortcut => 
      stmt.bind(
        crypto.randomUUID(),
        deviceId,
        shortcut.id,
        shortcut.name,
        shortcut.webhookId
      )
    );
    
    return await this.db.batch(batch);
  }

  // Cleanup operations
  async cleanupOldRateLimits(hoursOld = 1) {
    const cutoff = new Date(Date.now() - hoursOld * 3600 * 1000);
    
    return await this.db.prepare(`
      DELETE FROM rate_limits WHERE window_start < ?
    `).bind(cutoff.toISOString()).run();
  }

  async cleanupOldExecutions(daysOld = 30) {
    const cutoff = new Date(Date.now() - daysOld * 24 * 3600 * 1000);
    
    return await this.db.prepare(`
      DELETE FROM webhook_executions WHERE executed_at < ?
    `).bind(cutoff.toISOString()).run();
  }
}