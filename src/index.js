/**
 * Webcuts - Cloudflare Worker for iOS Shortcut Webhooks
 * Main entry point for handling webhook requests and device management
 */

import { handleWebhookRequest } from './handlers/webhook.js';
import { handleRegistration } from './handlers/registration.js';
import { handleDeviceUpdate } from './handlers/device.js';
import { corsHeaders } from './config/constants.js';
import { DatabaseService } from './services/database.js';
import { DatabaseInitializer } from './services/database-init.js';

// Track if database has been initialized in this worker instance
let dbInitialized = false;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Initialize database on first request
    if (!dbInitialized) {
      try {
        const dbInit = new DatabaseInitializer(env.DB);
        await dbInit.initialize();
        dbInitialized = true;
      } catch (error) {
        console.error('Database initialization failed:', error);
        return new Response(JSON.stringify({ 
          error: 'Database initialization failed',
          details: error.message 
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // Handle CORS preflight requests
    if (method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders
      });
    }

    try {
      // Route: POST /register - Register device and shortcuts
      if (path === '/register' && method === 'POST') {
        return await handleRegistration(request, env);
      }

      // Route: POST /webhook/:shortcutId - Execute webhook for shortcut
      if (path.startsWith('/webhook/') && method === 'POST') {
        const shortcutId = path.split('/')[2];
        if (!shortcutId) {
          return new Response(JSON.stringify({ error: 'Missing shortcut ID' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        return await handleWebhookRequest(request, env, shortcutId);
      }

      // Route: PUT /device/:deviceToken - Update device info
      if (path.startsWith('/device/') && method === 'PUT') {
        const deviceToken = path.split('/')[2];
        if (!deviceToken) {
          return new Response(JSON.stringify({ error: 'Missing device token' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        return await handleDeviceUpdate(request, env, deviceToken);
      }

      // Route: GET /health - Health check
      if (path === '/health' && method === 'GET') {
        return new Response(JSON.stringify({ 
          status: 'healthy',
          timestamp: new Date().toISOString(),
          version: '1.0.0',
          database: dbInitialized ? 'ready' : 'not initialized'
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Route: POST /admin/init-db - Initialize database (protected)
      if (path === '/admin/init-db' && method === 'POST') {
        // Check for admin key in header
        const adminKey = request.headers.get('x-admin-key');
        if (adminKey !== env.ADMIN_KEY) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        try {
          const dbInit = new DatabaseInitializer(env.DB);
          await dbInit.initialize();
          dbInitialized = true;
          
          return new Response(JSON.stringify({ 
            success: true,
            message: 'Database initialized successfully'
          }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } catch (error) {
          return new Response(JSON.stringify({ 
            error: 'Database initialization failed',
            details: error.message
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      }

      // Route: GET /webhook/:webhookId/info - Get webhook info
      if (path.startsWith('/webhook/') && path.endsWith('/info') && method === 'GET') {
        const webhookId = path.split('/')[2];
        const db = new DatabaseService(env.DB);
        const webhookData = await db.getShortcutByWebhook(webhookId);
        
        if (!webhookData) {
          return new Response(JSON.stringify({ error: 'Webhook not found' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const executions = await db.getWebhookExecutions(webhookId, 5);
        const analytics = await db.getAnalytics(webhookId, 7);

        return new Response(JSON.stringify({
          webhookId,
          shortcutId: webhookData.shortcut_id,
          shortcutName: webhookData.shortcut_name,
          webhookUrl: `${url.origin}/webhook/${webhookId}`,
          active: webhookData.is_active,
          triggerCount: webhookData.trigger_count,
          lastTriggered: webhookData.last_triggered,
          recentExecutions: executions.results,
          analytics: analytics.results
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // 404 for unmatched routes
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({ 
        error: 'Internal server error',
        message: error.message 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};