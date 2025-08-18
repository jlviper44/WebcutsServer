/**
 * Device registration handler - Manages device and shortcut registration
 */

import { generateWebhookId } from '../utils/crypto.js';
import { validateDeviceToken } from '../utils/validation.js';
import { corsHeaders } from '../config/constants.js';
import { DatabaseService } from '../services/database.js';

export async function handleRegistration(request, env) {
  const db = new DatabaseService(env.DB);
  
  try {
    // Parse request body
    const body = await request.json();
    const { deviceToken, shortcuts = [], deviceName, bundleId, pushEnvironment = 'sandbox' } = body;

    // Validate required fields
    if (!deviceToken) {
      return new Response(JSON.stringify({ 
        error: 'Device token is required' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Validate device token format
    if (!validateDeviceToken(deviceToken)) {
      return new Response(JSON.stringify({ 
        error: 'Invalid device token format' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Check if device already exists
    let device = await db.getDevice(deviceToken);
    
    if (device) {
      // Update existing device
      device = await db.updateDevice(deviceToken, { deviceName });
      
      // Deactivate all existing shortcuts for clean re-registration
      const existingShortcuts = await db.getDeviceShortcuts(device.id);
      for (const shortcut of existingShortcuts.results) {
        await db.deactivateShortcut(shortcut.webhook_id);
      }
    } else {
      // Create new device
      device = await db.createDevice(
        deviceToken,
        deviceName || 'Unknown Device',
        bundleId || 'com.webcuts.app'
      );
    }

    // Generate webhook URLs for each shortcut
    const webhooks = {};
    const shortcutsToCreate = [];
    const url = new URL(request.url);

    for (const shortcut of shortcuts) {
      if (!shortcut.id || !shortcut.name) {
        continue; // Skip invalid shortcuts
      }

      // Generate unique webhook ID
      const webhookId = await generateWebhookId(deviceToken, shortcut.id);
      
      shortcutsToCreate.push({
        id: shortcut.id,
        name: shortcut.name,
        webhookId
      });

      // Build webhook URL response
      webhooks[shortcut.id] = `${url.origin}/webhook/${webhookId}`;
    }

    // Batch create shortcuts
    if (shortcutsToCreate.length > 0) {
      await db.createShortcutsBatch(device.id, shortcutsToCreate);
    }

    // Return webhook URLs
    return new Response(JSON.stringify({
      success: true,
      deviceId: device.id,
      webhooks,
      registeredShortcuts: shortcutsToCreate.length,
      message: 'Device and shortcuts registered successfully'
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