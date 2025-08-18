/**
 * Authentication middleware for request validation
 */

import { AuthService } from '../services/auth.js';
import { corsHeaders } from '../config/constants.js';

/**
 * Extract authentication credentials from request
 */
export function getAuthFromRequest(request) {
  // Check for API key in header
  const apiKey = request.headers.get('x-api-key');
  if (apiKey) {
    return { type: 'api-key', credential: apiKey };
  }

  // Check for Bearer token (session)
  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return { type: 'session', credential: authHeader.substring(7) };
  }

  // Check for API key in query parameter (less secure, but convenient for webhooks)
  const url = new URL(request.url);
  const queryApiKey = url.searchParams.get('api_key');
  if (queryApiKey) {
    return { type: 'api-key', credential: queryApiKey };
  }

  return null;
}

/**
 * Middleware to require authentication
 */
export async function requireAuth(request, env, requiredPermission = null) {
  const authService = new AuthService(env.DB);
  const auth = getAuthFromRequest(request);

  if (!auth) {
    return {
      success: false,
      response: new Response(JSON.stringify({ error: 'Authentication required' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    };
  }

  try {
    let authResult;
    
    if (auth.type === 'session') {
      authResult = await authService.validateSession(auth.credential);
      if (!authResult) {
        return {
          success: false,
          response: new Response(JSON.stringify({ error: 'Invalid or expired session' }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        };
      }
    } else if (auth.type === 'api-key') {
      authResult = await authService.validateAPIKey(auth.credential, requiredPermission);
      if (!authResult) {
        return {
          success: false,
          response: new Response(JSON.stringify({ 
            error: requiredPermission 
              ? 'Invalid API key or insufficient permissions' 
              : 'Invalid API key' 
          }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        };
      }
    }

    return {
      success: true,
      user: authResult.user,
      authType: auth.type,
      apiKeyId: authResult.apiKey?.id
    };
  } catch (error) {
    console.error('Auth middleware error:', error);
    return {
      success: false,
      response: new Response(JSON.stringify({ error: 'Authentication failed' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    };
  }
}

/**
 * Middleware to validate webhook access
 */
export async function validateWebhookAccess(request, env, webhookId) {
  const authService = new AuthService(env.DB);
  
  // First, check if webhook exists and get its details
  const db = new (await import('../services/database_v2.js')).DatabaseServiceV2(env.DB);
  const webhook = await db.getShortcutByWebhook(webhookId);
  
  if (!webhook) {
    return {
      success: false,
      response: new Response(JSON.stringify({ 
        error: 'Webhook not found',
        webhookId 
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    };
  }

  // Check if webhook has expired
  if (webhook.expires_at && new Date(webhook.expires_at) < new Date()) {
    return {
      success: false,
      response: new Response(JSON.stringify({ 
        error: 'Webhook has expired' 
      }), {
        status: 410, // Gone
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    };
  }

  // Check usage limit
  if (webhook.max_uses && webhook.trigger_count >= webhook.max_uses) {
    return {
      success: false,
      response: new Response(JSON.stringify({ 
        error: 'Webhook usage limit exceeded' 
      }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    };
  }

  // Check IP whitelist if configured
  if (webhook.allowed_ips) {
    const allowedIps = JSON.parse(webhook.allowed_ips);
    const clientIp = request.headers.get('cf-connecting-ip') || 
                     request.headers.get('x-forwarded-for') || 
                     request.headers.get('x-real-ip');
    
    if (allowedIps.length > 0 && !allowedIps.includes(clientIp)) {
      return {
        success: false,
        response: new Response(JSON.stringify({ 
          error: 'Access denied from this IP address' 
        }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      };
    }
  }

  // Check webhook-specific HMAC signature if secret is configured
  if (webhook.webhook_secret) {
    const signature = request.headers.get('x-webhook-signature');
    if (!signature) {
      return {
        success: false,
        response: new Response(JSON.stringify({ 
          error: 'Webhook signature required' 
        }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      };
    }

    const { verifyHMAC } = await import('../utils/crypto.js');
    const body = await request.clone().text();
    const isValid = await verifyHMAC(body, signature, webhook.webhook_secret);
    
    if (!isValid) {
      return {
        success: false,
        response: new Response(JSON.stringify({ 
          error: 'Invalid webhook signature' 
        }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      };
    }
  }

  // Try to authenticate the request to get user context (optional)
  const auth = getAuthFromRequest(request);
  let user = null;
  let apiKeyId = null;
  
  if (auth) {
    try {
      if (auth.type === 'session') {
        const authResult = await authService.validateSession(auth.credential);
        if (authResult) {
          user = authResult.user;
        }
      } else if (auth.type === 'api-key') {
        const authResult = await authService.validateAPIKey(auth.credential, 'webhook:trigger');
        if (authResult) {
          user = authResult.user;
          apiKeyId = authResult.apiKey.id;
        }
      }
    } catch (error) {
      // Authentication is optional for webhooks, so we don't fail here
      console.warn('Optional auth failed for webhook:', error);
    }
  }

  return {
    success: true,
    webhook,
    user,
    apiKeyId
  };
}

/**
 * Get client IP address from request
 */
export function getClientIp(request) {
  return request.headers.get('cf-connecting-ip') || 
         request.headers.get('x-forwarded-for')?.split(',')[0] || 
         request.headers.get('x-real-ip') ||
         'unknown';
}

/**
 * Get user agent from request
 */
export function getUserAgent(request) {
  return request.headers.get('user-agent') || 'unknown';
}