/**
 * Enhanced device and shortcut registration with user authentication
 */

import { corsHeaders } from '../config/constants.js';
import { DatabaseServiceV2 } from '../services/database_v2.js';
import { AuthService } from '../services/auth.js';
import { requireAuth, getClientIp } from '../middleware/auth.js';
import { 
  generateWebhookId, 
  generateWebhookSecret,
  encryptData,
  sha256 
} from '../utils/crypto.js';
import { validateDeviceToken } from '../utils/validation.js';

/**
 * Register device and shortcuts for authenticated user
 * POST /api/register
 */
export async function handleRegistrationV2(request, env) {
  // Require authentication
  const authResult = await requireAuth(request, env);
  if (!authResult.success) {
    return authResult.response;
  }
  
  const { user } = authResult;
  const db = new DatabaseServiceV2(env.DB);
  const authService = new AuthService(env.DB);
  
  try {
    const body = await request.json();
    const { deviceToken, deviceName, shortcuts = [], bundleId = 'com.webcuts.app' } = body;
    
    // Validate device token format
    if (!validateDeviceToken(deviceToken)) {
      return new Response(JSON.stringify({ 
        error: 'Invalid device token format',
        details: 'Device token must be 64 hexadecimal characters'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // Validate shortcuts
    if (!Array.isArray(shortcuts) || shortcuts.length === 0) {
      return new Response(JSON.stringify({ 
        error: 'At least one shortcut is required' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // Validate each shortcut
    for (const shortcut of shortcuts) {
      if (!shortcut.id || !shortcut.name) {
        return new Response(JSON.stringify({ 
          error: 'Each shortcut must have an id and name' 
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }
    
    // Encrypt device token for storage
    const deviceTokenEncrypted = await encryptData(
      deviceToken,
      env.DEVICE_TOKEN_ENCRYPTION_KEY
    );
    
    // Create hash for lookups (can't decrypt for searches)
    const deviceTokenHash = await sha256(deviceToken);
    
    // Check if device already exists for this user
    let device = await db.getDevice(deviceTokenHash, user.id);
    
    if (device) {
      // Update existing device
      device = await db.updateDevice(device.id, user.id, { deviceName });
      
      // Log device update
      await authService.logAudit(
        user.id,
        'device_update',
        'device',
        device.id,
        { device_name: deviceName },
        getClientIp(request)
      );
    } else {
      // Create new device
      device = await db.createDevice(
        user.id,
        deviceTokenEncrypted,
        deviceTokenHash,
        deviceName,
        bundleId
      );
      
      // Log device registration
      await authService.logAudit(
        user.id,
        'device_register',
        'device',
        device.id,
        { 
          device_name: deviceName,
          bundle_id: bundleId 
        },
        getClientIp(request)
      );
    }
    
    // Process shortcuts
    const webhookUrls = [];
    const baseUrl = new URL(request.url).origin;
    
    for (const shortcut of shortcuts) {
      // Check if shortcut already exists
      const existingShortcuts = await db.getUserShortcuts(user.id);
      const existing = existingShortcuts.find(
        s => s.device_id === device.id && s.shortcut_id === shortcut.id
      );
      
      if (existing && existing.is_active) {
        // Shortcut already exists and is active
        webhookUrls.push({
          shortcutId: shortcut.id,
          shortcutName: shortcut.name,
          webhookUrl: `${baseUrl}/webhook/${existing.webhook_id}`,
          webhookId: existing.webhook_id,
          status: 'existing'
        });
        continue;
      }
      
      if (existing && !existing.is_active) {
        // Reactivate existing shortcut
        await env.DB.prepare(`
          UPDATE shortcuts 
          SET is_active = 1, shortcut_name = ?
          WHERE id = ?
        `).bind(shortcut.name, existing.id).run();
        
        webhookUrls.push({
          shortcutId: shortcut.id,
          shortcutName: shortcut.name,
          webhookUrl: `${baseUrl}/webhook/${existing.webhook_id}`,
          webhookId: existing.webhook_id,
          status: 'reactivated'
        });
        continue;
      }
      
      // Generate new webhook ID and secret
      const webhookId = await generateWebhookId();
      const webhookSecret = generateWebhookSecret();
      
      // Create new shortcut
      await db.createShortcut(
        device.id,
        user.id,
        shortcut.id,
        shortcut.name,
        webhookId,
        webhookSecret
      );
      
      webhookUrls.push({
        shortcutId: shortcut.id,
        shortcutName: shortcut.name,
        webhookUrl: `${baseUrl}/webhook/${webhookId}`,
        webhookId: webhookId,
        webhookSecret: webhookSecret, // Only return this during creation
        status: 'created'
      });
      
      // Log shortcut creation
      await authService.logAudit(
        user.id,
        'shortcut_create',
        'shortcut',
        shortcut.id,
        { 
          shortcut_name: shortcut.name,
          webhook_id: webhookId 
        },
        getClientIp(request)
      );
    }
    
    // Create or get API key for the device
    let apiKey = null;
    const existingKeys = await db.getUserAPIKeys(user.id);
    const deviceKey = existingKeys.find(k => k.name === `Device: ${deviceName}`);
    
    if (!deviceKey) {
      // Create new API key for this device
      apiKey = await authService.createAPIKey(
        user.id,
        `Device: ${deviceName}`,
        ['webhook:trigger', 'webhook:read']
      );
    }
    
    return new Response(JSON.stringify({
      success: true,
      message: 'Registration successful',
      device: {
        id: device.id,
        name: deviceName,
        bundleId: bundleId,
        registeredAt: device.created_at
      },
      webhooks: webhookUrls,
      apiKey: apiKey || undefined, // Only return if newly created
      user: {
        email: user.email,
        username: user.username
      }
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Registration error:', error);
    
    return new Response(JSON.stringify({ 
      error: 'Registration failed',
      message: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Get user's registered devices and shortcuts
 * GET /api/devices
 */
export async function handleGetDevices(request, env) {
  // Require authentication
  const authResult = await requireAuth(request, env);
  if (!authResult.success) {
    return authResult.response;
  }
  
  const { user } = authResult;
  const db = new DatabaseServiceV2(env.DB);
  
  try {
    // Get user's devices
    const devices = await db.getUserDevices(user.id);
    
    // Get shortcuts for each device
    const devicesWithShortcuts = await Promise.all(devices.map(async (device) => {
      const shortcuts = await env.DB.prepare(`
        SELECT 
          id,
          shortcut_id,
          shortcut_name,
          webhook_id,
          created_at,
          last_triggered,
          trigger_count,
          is_active,
          expires_at,
          max_uses
        FROM shortcuts 
        WHERE device_id = ? AND user_id = ? AND is_active = 1
        ORDER BY shortcut_name
      `).bind(device.id, user.id).all();
      
      const baseUrl = new URL(request.url).origin;
      
      return {
        ...device,
        shortcuts: shortcuts.results.map(s => ({
          id: s.shortcut_id,
          name: s.shortcut_name,
          webhookUrl: `${baseUrl}/webhook/${s.webhook_id}`,
          webhookId: s.webhook_id,
          createdAt: s.created_at,
          lastTriggered: s.last_triggered,
          triggerCount: s.trigger_count,
          expiresAt: s.expires_at,
          maxUses: s.max_uses,
          remainingUses: s.max_uses ? s.max_uses - s.trigger_count : null
        }))
      };
    }));
    
    return new Response(JSON.stringify({
      devices: devicesWithShortcuts,
      user: {
        email: user.email,
        username: user.username
      }
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Get devices error:', error);
    
    return new Response(JSON.stringify({ 
      error: 'Failed to get devices',
      message: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}