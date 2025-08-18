/**
 * Cryptographic utilities for token generation and signing
 */

/**
 * Generate a unique webhook ID for a shortcut
 */
export async function generateWebhookId(deviceToken, shortcutId) {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${deviceToken}:${shortcutId}:${Date.now()}`);
  
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  
  // Convert to URL-safe base64-like string
  const webhookId = hashArray
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .substring(0, 32); // Take first 32 characters for reasonable length
  
  return webhookId;
}

/**
 * Sign a JWT for APNs authentication
 */
export async function signJWT(header, claims, privateKey) {
  try {
    // Encode header and claims
    const encodedHeader = base64urlEncode(JSON.stringify(header));
    const encodedClaims = base64urlEncode(JSON.stringify(claims));
    const message = `${encodedHeader}.${encodedClaims}`;

    // Import the private key
    const key = await importPrivateKey(privateKey);
    
    // Sign the message
    const encoder = new TextEncoder();
    const signature = await crypto.subtle.sign(
      {
        name: 'ECDSA',
        hash: 'SHA-256'
      },
      key,
      encoder.encode(message)
    );
    
    // Encode signature
    const encodedSignature = base64urlEncode(signature);
    
    return `${message}.${encodedSignature}`;
  } catch (error) {
    console.error('JWT signing error:', error);
    throw error;
  }
}

/**
 * Import a P-256 private key for ECDSA signing
 */
async function importPrivateKey(pemKey) {
  // Remove PEM headers and decode base64
  const pemContents = pemKey
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  
  const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  
  return await crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    {
      name: 'ECDSA',
      namedCurve: 'P-256'
    },
    false,
    ['sign']
  );
}

/**
 * Base64 URL encoding
 */
function base64urlEncode(input) {
  let base64;
  
  if (typeof input === 'string') {
    base64 = btoa(input);
  } else if (input instanceof ArrayBuffer || input instanceof Uint8Array) {
    const bytes = new Uint8Array(input);
    const binary = String.fromCharCode(...bytes);
    base64 = btoa(binary);
  } else {
    throw new Error('Invalid input type for base64url encoding');
  }
  
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Generate a secure random API key
 */
export function generateAPIKey() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  
  return Array.from(array)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Hash a value using SHA-256
 */
export async function sha256(value) {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verify HMAC signature
 */
export async function verifyHMAC(message, signature, secret) {
  const encoder = new TextEncoder();
  
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  
  const signatureBuffer = Uint8Array.from(
    signature.match(/.{2}/g).map(byte => parseInt(byte, 16))
  );
  
  return await crypto.subtle.verify(
    'HMAC',
    key,
    signatureBuffer,
    encoder.encode(message)
  );
}