/**
 * Device management handler - Updates device information and shortcuts
 */

import { generateWebhookId } from '../utils/crypto.js';
import { corsHeaders } from '../config/constants.js';
import { DatabaseService } from '../services/database.js';

export async function handleDeviceUpdate(request, env, deviceToken) {
  const db = new DatabaseService(env.DB);
  
  try {
    // Get existing device data
    const device = await db.getDevice(deviceToken);
    
    if (!device) {
      return new Response(JSON.stringify({ 
        error: 'Device not found' 
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Parse update request
    const updates = await request.json();
    const { shortcuts, deviceName, removeShortcuts = [] } = updates;

    // Update device info if name changed
    if (deviceName && deviceName !== device.device_name) {
      await db.updateDevice(deviceToken, { deviceName });
    }

    // Handle shortcut removals
    if (removeShortcuts.length > 0) {
      await db.removeDeviceShortcuts(device.id, removeShortcuts);
    }

    // Handle new/updated shortcuts
    const newWebhooks = {};
    const url = new URL(request.url);
    
    if (shortcuts && shortcuts.length > 0) {
      // Get existing shortcuts
      const existingShortcuts = await db.getDeviceShortcuts(device.id);
      const existingMap = new Map(
        existingShortcuts.results.map(s => [s.shortcut_id, s])
      );
      
      for (const shortcut of shortcuts) {
        if (!shortcut.id || !shortcut.name) {
          continue;
        }
        
        const existing = existingMap.get(shortcut.id);
        
        if (existing) {
          // Update existing shortcut if name changed
          if (shortcut.name !== existing.shortcut_name) {
            await db.updateShortcut(device.id, shortcut.id, {
              shortcutName: shortcut.name
            });
          }
          
          // Reactivate if it was deactivated
          if (!existing.is_active) {
            await db.db.prepare(`
              UPDATE shortcuts SET is_active = 1 
              WHERE device_id = ? AND shortcut_id = ?
            `).bind(device.id, shortcut.id).run();
          }
          
          newWebhooks[shortcut.id] = `${url.origin}/webhook/${existing.webhook_id}`;
        } else {
          // Add new shortcut
          const webhookId = await generateWebhookId(deviceToken, shortcut.id);
          
          await db.createShortcut(
            device.id,
            shortcut.id,
            shortcut.name,
            webhookId
          );
          
          newWebhooks[shortcut.id] = `${url.origin}/webhook/${webhookId}`;
        }
      }
    }

    // Get updated shortcut count
    const updatedShortcuts = await db.getDeviceShortcuts(device.id);

    // Return updated information
    return new Response(JSON.stringify({
      success: true,
      deviceId: device.id,
      totalShortcuts: updatedShortcuts.results.length,
      newWebhooks,
      removedCount: removeShortcuts.length,
      message: 'Device updated successfully'
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Device update error:', error);
    return new Response(JSON.stringify({ 
      error: 'Update failed',
      message: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}