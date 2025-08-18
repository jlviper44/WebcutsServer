/**
 * Push notification service - Handles APNs communication
 */

import { signJWT } from '../utils/crypto.js';

/**
 * Send push notification via Apple Push Notification service
 */
export async function sendPushNotification({ deviceToken, shortcutId, shortcutName, payload, pushEnvironment = 'sandbox', env, db }) {
  try {
    // Generate JWT for APNs authentication
    const token = await generateAPNsToken(env, db);
    
    // Construct notification payload
    const notification = {
      aps: {
        alert: {
          title: 'Webcuts',
          body: `Executing: ${shortcutName}`,
          subtitle: 'Shortcut Triggered'
        },
        sound: 'default',
        'content-available': 1,
        'mutable-content': 1
      },
      shortcutId,
      shortcutName,
      webhookPayload: payload || {},
      timestamp: new Date().toISOString(),
      notificationId: crypto.randomUUID()
    };

    // Determine APNs endpoint (production vs sandbox)
    const apnsHost = pushEnvironment === 'production'
      ? 'api.push.apple.com' 
      : 'api.sandbox.push.apple.com';
    
    const url = `https://${apnsHost}/3/device/${deviceToken}`;

    // Send notification to APNs
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'authorization': `bearer ${token}`,
        'apns-topic': env.APNS_BUNDLE_ID || 'com.webcuts.app',
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'apns-expiration': '0'
      },
      body: JSON.stringify(notification)
    });

    // Handle APNs response
    if (response.status === 200) {
      const apnsId = response.headers.get('apns-id');
      return {
        success: true,
        notificationId: notification.notificationId,
        apnsId
      };
    }

    // Handle various APNs error responses
    const errorData = await response.text();
    let errorMessage = 'Failed to send notification';
    
    switch (response.status) {
      case 400:
        errorMessage = 'Bad request - Invalid notification payload';
        break;
      case 403:
        errorMessage = 'Forbidden - Certificate or token issue';
        break;
      case 404:
        errorMessage = 'Device token not found or invalid';
        break;
      case 410:
        errorMessage = 'Device token is no longer valid';
        // Could mark device as inactive here
        break;
      case 413:
        errorMessage = 'Notification payload too large';
        break;
      case 429:
        errorMessage = 'Too many requests - Rate limited';
        break;
      case 500:
      case 503:
        errorMessage = 'APNs server error - Try again later';
        break;
    }

    return {
      success: false,
      error: errorMessage,
      statusCode: response.status,
      details: errorData
    };

  } catch (error) {
    console.error('Push notification error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Generate JWT token for APNs authentication
 */
async function generateAPNsToken(env, db) {
  // Check if we have a cached token that's still valid
  const cachedToken = await db?.getCachedToken('apns:token');
  if (cachedToken) {
    return cachedToken;
  }

  // Generate new JWT token
  const header = {
    alg: 'ES256',
    kid: env.APNS_KEY_ID,
    typ: 'JWT'
  };

  const claims = {
    iss: env.APNS_TEAM_ID,
    iat: Math.floor(Date.now() / 1000)
  };

  const token = await signJWT(header, claims, env.APNS_AUTH_KEY);

  // Cache token for 50 minutes (tokens are valid for 1 hour)
  if (db) {
    await db.setCachedToken('apns:token', token, 3000); // 50 minutes
  }

  return token;
}

/**
 * Send silent push notification for background execution
 */
export async function sendSilentPush({ deviceToken, shortcutId, payload, pushEnvironment = 'sandbox', env, db }) {
  try {
    const token = await generateAPNsToken(env, db);
    
    const notification = {
      aps: {
        'content-available': 1
      },
      shortcutId,
      webhookPayload: payload || {},
      timestamp: new Date().toISOString(),
      notificationId: crypto.randomUUID()
    };

    const apnsHost = pushEnvironment === 'production'
      ? 'api.push.apple.com' 
      : 'api.sandbox.push.apple.com';
    
    const url = `https://${apnsHost}/3/device/${deviceToken}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'authorization': `bearer ${token}`,
        'apns-topic': env.APNS_BUNDLE_ID || 'com.webcuts.app',
        'apns-push-type': 'background',
        'apns-priority': '5',
        'apns-expiration': '0'
      },
      body: JSON.stringify(notification)
    });

    return {
      success: response.status === 200,
      notificationId: notification.notificationId,
      statusCode: response.status
    };

  } catch (error) {
    console.error('Silent push error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}