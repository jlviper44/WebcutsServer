/**
 * Webhook handler - Processes incoming webhook requests and triggers push notifications
 */

import { sendPushNotification } from './push.js';
import { validateWebhookSignature } from '../utils/validation.js';
import { corsHeaders } from '../config/constants.js';
import { DatabaseService } from '../services/database.js';

export async function handleWebhookRequest(request, env, webhookId) {
  const startTime = Date.now();
  const db = new DatabaseService(env.DB);
  
  try {
    // Get request body
    const contentType = request.headers.get('content-type');
    let payload = {};
    
    if (contentType?.includes('application/json')) {
      try {
        payload = await request.json();
      } catch (e) {
        payload = {};
      }
    }

    // Optional: Validate webhook signature if provided
    const signature = request.headers.get('x-webhook-signature');
    if (signature) {
      const isValid = await validateWebhookSignature(request, signature, env.WEBHOOK_SECRET);
      if (!isValid) {
        return new Response(JSON.stringify({ error: 'Invalid signature' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // Get webhook data from database
    const webhookData = await db.getShortcutByWebhook(webhookId);
    
    if (!webhookData) {
      return new Response(JSON.stringify({ 
        error: 'Webhook not found',
        webhookId 
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { device_token, shortcut_id, shortcut_name, device_id, push_environment } = webhookData;

    // Check rate limiting
    const rateLimitResult = await db.checkRateLimit(
      `webhook:${webhookId}`,
      1, // 1 minute window
      env.RATE_LIMIT_PER_MINUTE || 10
    );
    
    if (!rateLimitResult.allowed) {
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

    // Send push notification to trigger shortcut
    const notificationResult = await sendPushNotification({
      deviceToken: device_token,
      shortcutId: shortcut_id,
      shortcutName: shortcut_name,
      payload,
      pushEnvironment: push_environment,
      env,
      db
    });

    const responseTime = Date.now() - startTime;

    // Log webhook execution
    await db.logWebhookExecution(
      webhookId,
      shortcut_id,
      device_id,
      payload,
      notificationResult.success ? 'success' : 'failed',
      notificationResult.error || null,
      notificationResult.notificationId,
      notificationResult.apnsId || null,
      responseTime
    );

    // Update analytics
    await db.updateAnalytics(webhookId, notificationResult.success, responseTime);

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
      shortcutId: shortcut_id,
      shortcutName: shortcut_name,
      timestamp: new Date().toISOString(),
      notificationId: notificationResult.notificationId,
      remaining: rateLimitResult.remaining
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Webhook handler error:', error);
    
    // Log failed execution
    try {
      await db.logWebhookExecution(
        webhookId,
        null,
        null,
        {},
        'failed',
        error.message,
        null,
        null,
        Date.now() - startTime
      );
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