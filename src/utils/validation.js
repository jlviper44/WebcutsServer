/**
 * Validation utilities for request verification
 */

/**
 * Validate device token format (APNs token)
 */
export function validateDeviceToken(token) {
  // APNs device tokens are 64 hexadecimal characters
  const tokenRegex = /^[a-fA-F0-9]{64}$/;
  return tokenRegex.test(token);
}

/**
 * Validate webhook signature for secure webhook calls
 */
export async function validateWebhookSignature(request, signature, secret) {
  if (!secret) {
    return true; // Skip validation if no secret configured
  }

  try {
    // Get request body
    const body = await request.text();
    
    // Create HMAC signature
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    
    const signatureBuffer = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(body)
    );
    
    // Convert to hex string
    const computedSignature = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    // Compare signatures
    return signature === computedSignature;
  } catch (error) {
    console.error('Signature validation error:', error);
    return false;
  }
}

/**
 * Validate request authentication token
 */
export async function validateAuthToken(request, db) {
  const authHeader = request.headers.get('authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { valid: false, error: 'Missing or invalid authorization header' };
  }
  
  const token = authHeader.substring(7);
  
  // Hash the token for secure storage comparison
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const keyHash = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  
  // Validate against database
  const apiKey = await db.validateApiKey(keyHash);
  
  if (!apiKey) {
    return { valid: false, error: 'Invalid API key' };
  }
  
  // Update last used timestamp
  await db.updateApiKeyLastUsed(keyHash);
  
  return { valid: true, apiKey };
}

/**
 * Validate shortcut ID format
 */
export function validateShortcutId(shortcutId) {
  // Shortcut IDs should be alphanumeric with hyphens/underscores
  const idRegex = /^[a-zA-Z0-9_-]+$/;
  return idRegex.test(shortcutId) && shortcutId.length <= 100;
}

/**
 * Sanitize user input to prevent injection attacks
 */
export function sanitizeInput(input) {
  if (typeof input !== 'string') {
    return input;
  }
  
  // Remove control characters and excessive whitespace
  return input
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
    .trim()
    .substring(0, 1000); // Limit length
}

/**
 * Validate webhook payload size
 */
export function validatePayloadSize(payload) {
  const payloadString = JSON.stringify(payload);
  const sizeInBytes = new TextEncoder().encode(payloadString).length;
  
  // APNs has a 4KB limit for notification payloads
  const maxSize = 4096;
  
  return {
    valid: sizeInBytes <= maxSize,
    size: sizeInBytes,
    maxSize
  };
}