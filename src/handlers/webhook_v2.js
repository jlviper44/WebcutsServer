/**
 * Enhanced webhook handler with security features
 */

import { sendPushNotification } from './push.js';
import { corsHeaders } from '../config/constants.js';
import { DatabaseServiceV2 } from '../services/database_v2.js';
import { AuthService } from '../services/auth.js';
import { validateWebhookAccess, getClientIp, getUserAgent } from '../middleware/auth.js';
import { decryptData } from '../utils/crypto.js';

export async function handleWebhookRequestV2(request, env, webhookId) {
  const startTime = Date.now();
  const db = new DatabaseServiceV2(env.DB);
  const authService = new AuthService(env.DB);
  
  // Get request metadata
  const clientIp = getClientIp(request);
  const userAgent = getUserAgent(request);
  
  try {
    // Validate webhook access (includes existence check, expiry, IP whitelist, signature)
    const accessResult = await validateWebhookAccess(request, env, webhookId);
    
    if (!accessResult.success) {
      // Log unauthorized attempt
      await db.createAuditLog({
        user_id: null,
        action: 'webhook_trigger_unauthorized',
        resource_type: 'webhook',
        resource_id: webhookId,
        details: JSON.stringify({ 
          reason: 'access_validation_failed',
          ip: clientIp 
        }),
        ip_address: clientIp,
        user_agent: userAgent
      });
      
      return accessResult.response;
    }
    
    const { webhook, user, apiKeyId } = accessResult;
    
    // Parse request payload
    let payload = {};
    const contentType = request.headers.get('content-type');
    
    if (contentType?.includes('application/json')) {
      try {
        payload = await request.json();
      } catch (e) {
        console.warn('Failed to parse JSON payload:', e);
        payload = {};
      }
    }
    
    // Check payload size (APNs limit is 4KB)
    const payloadSize = JSON.stringify(payload).length;
    if (payloadSize > 4096) {
      return new Response(JSON.stringify({ 
        error: 'Payload too large',
        maxSize: '4KB',
        currentSize: `${Math.round(payloadSize / 1024 * 10) / 10}KB`
      }), {
        status: 413,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // Apply rate limiting
    // Use user-specific rate limit if authenticated, otherwise use webhook rate limit
    const rateLimitIdentifier = user 
      ? `user:${user.id}:webhook`
      : `webhook:${webhookId}`;
    
    const rateLimitResult = await db.checkRateLimit(
      rateLimitIdentifier,
      1, // 1 minute window
      user ? (env.USER_RATE_LIMIT_PER_MINUTE || 30) : (env.RATE_LIMIT_PER_MINUTE || 10)
    );
    
    if (!rateLimitResult.allowed) {
      // Log rate limit exceeded
      await db.createAuditLog({
        user_id: user?.id || null,
        action: 'webhook_trigger_rate_limited',
        resource_type: 'webhook',
        resource_id: webhookId,
        details: JSON.stringify({ ip: clientIp }),
        ip_address: clientIp,
        user_agent: userAgent
      });
      
      return new Response(JSON.stringify({ 
        error: 'Rate limit exceeded',
        retryAfter: 60 
      }), {
        status: 429,
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json',
          'Retry-After': '60'
        }
      });
    }
    
    // Decrypt device token for push notification
    const deviceToken = await decryptData(
      webhook.device_token_encrypted,
      env.DEVICE_TOKEN_ENCRYPTION_KEY
    );
    
    // Send push notification to trigger shortcut
    const notificationResult = await sendPushNotification({
      deviceToken,
      shortcutId: webhook.shortcut_id,
      shortcutName: webhook.shortcut_name,
      payload,
      pushEnvironment: webhook.push_environment,
      env,
      db
    });
    
    const responseTime = Date.now() - startTime;
    
    // Log webhook execution with full context
    await db.logWebhookExecution({
      webhook_id: webhookId,
      shortcut_id: webhook.shortcut_id,
      device_id: webhook.device_id,
      user_id: webhook.user_id,
      payload,
      status: notificationResult.success ? 'success' : 'failed',
      error_message: notificationResult.error || null,
      notification_id: notificationResult.notificationId,
      apns_id: notificationResult.apnsId || null,
      response_time_ms: responseTime,
      ip_address: clientIp,
      user_agent: userAgent,
      api_key_id: apiKeyId
    });
    
    // Update analytics
    await db.updateAnalytics(webhookId, notificationResult.success, responseTime);
    
    // Log successful trigger
    await authService.logAudit(
      webhook.user_id,
      'webhook_trigger',
      'webhook',
      webhookId,
      {
        success: notificationResult.success,
        shortcut_name: webhook.shortcut_name,
        device_name: webhook.device_name,
        triggered_by: user?.email || 'anonymous',
        ip: clientIp
      },
      clientIp
    );
    
    if (!notificationResult.success) {
      return new Response(JSON.stringify({ 
        error: 'Failed to send notification',
        details: notificationResult.error 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // Return success response
    return new Response(JSON.stringify({
      success: true,
      message: 'Shortcut triggered successfully',
      webhookId,
      shortcutId: webhook.shortcut_id,
      shortcutName: webhook.shortcut_name,
      timestamp: new Date().toISOString(),
      notificationId: notificationResult.notificationId,
      remaining: rateLimitResult.remaining,
      user: user ? { email: user.email } : null
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Webhook handler error:', error);
    
    // Log error
    try {
      await db.createAuditLog({
        user_id: null,
        action: 'webhook_trigger_error',
        resource_type: 'webhook',
        resource_id: webhookId,
        details: JSON.stringify({ 
          error: error.message,
          ip: clientIp 
        }),
        ip_address: clientIp,
        user_agent: userAgent
      });
    } catch (logError) {
      console.error('Failed to log webhook error:', logError);
    }
    
    return new Response(JSON.stringify({ 
      error: 'Internal server error',
      message: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}