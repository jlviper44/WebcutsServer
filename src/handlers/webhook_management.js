/**
 * Webhook management endpoints for rotation and configuration
 */

import { corsHeaders } from '../config/constants.js';
import { DatabaseServiceV2 } from '../services/database_v2.js';
import { AuthService } from '../services/auth.js';
import { requireAuth, getClientIp } from '../middleware/auth.js';
import { generateWebhookId, generateWebhookSecret } from '../utils/crypto.js';

/**
 * Rotate webhook ID for a shortcut
 * POST /api/webhooks/:webhookId/rotate
 */
export async function handleWebhookRotation(request, env, webhookId) {
  // Require authentication
  const authResult = await requireAuth(request, env, 'webhook:manage');
  if (!authResult.success) {
    return authResult.response;
  }
  
  const { user } = authResult;
  const db = new DatabaseServiceV2(env.DB);
  const authService = new AuthService(env.DB);
  
  try {
    // Get the webhook/shortcut
    const webhook = await db.getShortcutByWebhookAndUser(webhookId, user.id);
    
    if (!webhook) {
      return new Response(JSON.stringify({ 
        error: 'Webhook not found or access denied' 
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // Parse request for rotation reason
    const body = await request.json();
    const reason = body.reason || 'manual_rotation';
    
    // Generate new webhook ID and secret
    const newWebhookId = await generateWebhookId();
    const newWebhookSecret = generateWebhookSecret();
    
    // Perform rotation
    const rotationResult = await db.rotateWebhookId(
      webhook.id,
      user.id,
      newWebhookId,
      newWebhookSecret,
      reason
    );
    
    if (!rotationResult) {
      throw new Error('Failed to rotate webhook');
    }
    
    // Log the rotation
    await authService.logAudit(
      user.id,
      'webhook_rotate',
      'webhook',
      webhookId,
      {
        old_webhook_id: rotationResult.oldWebhookId,
        new_webhook_id: rotationResult.newWebhookId,
        reason,
        shortcut_name: webhook.shortcut_name
      },
      getClientIp(request)
    );
    
    // Return new webhook details
    const baseUrl = new URL(request.url).origin;
    
    return new Response(JSON.stringify({
      success: true,
      message: 'Webhook rotated successfully',
      oldWebhookUrl: `${baseUrl}/webhook/${rotationResult.oldWebhookId}`,
      newWebhookUrl: `${baseUrl}/webhook/${rotationResult.newWebhookId}`,
      newWebhookId: rotationResult.newWebhookId,
      webhookSecret: newWebhookSecret, // Only return this once
      shortcutName: webhook.shortcut_name,
      rotatedAt: new Date().toISOString()
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Webhook rotation error:', error);
    
    return new Response(JSON.stringify({ 
      error: 'Failed to rotate webhook',
      message: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Update webhook configuration
 * PATCH /api/webhooks/:webhookId
 */
export async function handleWebhookUpdate(request, env, webhookId) {
  // Require authentication
  const authResult = await requireAuth(request, env, 'webhook:manage');
  if (!authResult.success) {
    return authResult.response;
  }
  
  const { user } = authResult;
  const db = new DatabaseServiceV2(env.DB);
  const authService = new AuthService(env.DB);
  
  try {
    // Get the webhook/shortcut
    const webhook = await db.getShortcutByWebhookAndUser(webhookId, user.id);
    
    if (!webhook) {
      return new Response(JSON.stringify({ 
        error: 'Webhook not found or access denied' 
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // Parse update request
    const updates = await request.json();
    const allowedUpdates = ['expires_at', 'max_uses', 'allowed_ips', 'is_active'];
    
    // Build update query
    const updateFields = [];
    const updateValues = [];
    
    for (const field of allowedUpdates) {
      if (field in updates) {
        updateFields.push(`${field} = ?`);
        
        if (field === 'allowed_ips' && Array.isArray(updates[field])) {
          updateValues.push(JSON.stringify(updates[field]));
        } else {
          updateValues.push(updates[field]);
        }
      }
    }
    
    if (updateFields.length === 0) {
      return new Response(JSON.stringify({ 
        error: 'No valid updates provided' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // Update webhook
    updateValues.push(webhookId, user.id);
    
    await env.DB.prepare(`
      UPDATE shortcuts 
      SET ${updateFields.join(', ')}
      WHERE webhook_id = ? AND user_id = ?
    `).bind(...updateValues).run();
    
    // Log the update
    await authService.logAudit(
      user.id,
      'webhook_update',
      'webhook',
      webhookId,
      {
        updates,
        shortcut_name: webhook.shortcut_name
      },
      getClientIp(request)
    );
    
    // Get updated webhook
    const updatedWebhook = await db.getShortcutByWebhookAndUser(webhookId, user.id);
    
    return new Response(JSON.stringify({
      success: true,
      message: 'Webhook updated successfully',
      webhook: {
        webhookId: updatedWebhook.webhook_id,
        shortcutName: updatedWebhook.shortcut_name,
        isActive: updatedWebhook.is_active,
        expiresAt: updatedWebhook.expires_at,
        maxUses: updatedWebhook.max_uses,
        currentUses: updatedWebhook.trigger_count,
        allowedIps: updatedWebhook.allowed_ips ? JSON.parse(updatedWebhook.allowed_ips) : null
      }
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Webhook update error:', error);
    
    return new Response(JSON.stringify({ 
      error: 'Failed to update webhook',
      message: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Get webhook statistics
 * GET /api/webhooks/:webhookId/stats
 */
export async function handleWebhookStats(request, env, webhookId) {
  // Require authentication
  const authResult = await requireAuth(request, env);
  if (!authResult.success) {
    return authResult.response;
  }
  
  const { user } = authResult;
  const db = new DatabaseServiceV2(env.DB);
  
  try {
    // Verify webhook ownership
    const webhook = await db.getShortcutByWebhookAndUser(webhookId, user.id);
    
    if (!webhook) {
      return new Response(JSON.stringify({ 
        error: 'Webhook not found or access denied' 
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // Get execution history
    const executions = await db.getUserWebhookExecutions(user.id, 20);
    const webhookExecutions = executions.filter(e => e.webhook_id === webhookId);
    
    // Get analytics
    const analytics = await db.getUserAnalytics(user.id, 30);
    const webhookAnalytics = analytics.filter(a => a.webhook_id === webhookId);
    
    // Calculate stats
    const totalTriggers = webhook.trigger_count;
    const successfulTriggers = webhookExecutions.filter(e => e.status === 'success').length;
    const failedTriggers = webhookExecutions.filter(e => e.status === 'failed').length;
    const avgResponseTime = webhookExecutions.reduce((sum, e) => sum + (e.response_time_ms || 0), 0) / 
                           (webhookExecutions.length || 1);
    
    return new Response(JSON.stringify({
      webhook: {
        id: webhook.webhook_id,
        name: webhook.shortcut_name,
        deviceName: webhook.device_name,
        createdAt: webhook.created_at,
        lastTriggered: webhook.last_triggered,
        isActive: webhook.is_active,
        expiresAt: webhook.expires_at,
        maxUses: webhook.max_uses
      },
      stats: {
        totalTriggers,
        successfulTriggers,
        failedTriggers,
        successRate: totalTriggers > 0 ? (successfulTriggers / totalTriggers * 100).toFixed(1) : 0,
        avgResponseTimeMs: Math.round(avgResponseTime),
        remainingUses: webhook.max_uses ? webhook.max_uses - totalTriggers : null
      },
      recentExecutions: webhookExecutions.slice(0, 10).map(e => ({
        executedAt: e.executed_at,
        status: e.status,
        responseTimeMs: e.response_time_ms,
        errorMessage: e.error_message,
        ipAddress: e.ip_address
      })),
      dailyAnalytics: webhookAnalytics.map(a => ({
        date: a.date,
        triggers: a.trigger_count,
        successes: a.success_count,
        failures: a.failure_count,
        avgResponseTimeMs: a.avg_response_time_ms
      }))
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Webhook stats error:', error);
    
    return new Response(JSON.stringify({ 
      error: 'Failed to get webhook statistics',
      message: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}