/**
 * Cryptographic utilities for token generation and signing
 */

/**
 * Generate a cryptographically secure random webhook ID
 * Uses full 256-bit randomness for maximum security
 */
export async function generateWebhookId() {
  // Generate 32 random bytes (256 bits) for maximum entropy
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  
  // Convert to hexadecimal string (64 characters)
  const webhookId = Array.from(randomBytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  
  return webhookId;
}

/**
 * Generate a webhook-specific HMAC secret
 */
export function generateWebhookSecret() {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  
  return Array.from(randomBytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
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

/**
 * Encrypt sensitive data (like device tokens)
 * Uses AES-GCM for authenticated encryption
 */
export async function encryptData(plaintext, encryptionKey) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);
  
  // Generate a random IV for each encryption
  const iv = crypto.getRandomValues(new Uint8Array(12));
  
  // Import the encryption key
  const key = await crypto.subtle.importKey(
    'raw',
    hexToBytes(encryptionKey),
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  
  // Encrypt the data
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );
  
  // Combine IV and ciphertext for storage
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);
  
  // Return as hex string
  return bytesToHex(combined);
}

/**
 * Decrypt sensitive data
 */
export async function decryptData(encryptedHex, encryptionKey) {
  const encrypted = hexToBytes(encryptedHex);
  
  // Extract IV and ciphertext
  const iv = encrypted.slice(0, 12);
  const ciphertext = encrypted.slice(12);
  
  // Import the encryption key
  const key = await crypto.subtle.importKey(
    'raw',
    hexToBytes(encryptionKey),
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
  
  // Decrypt the data
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );
  
  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}

/**
 * Generate an encryption key for AES-256-GCM
 */
export function generateEncryptionKey() {
  const key = new Uint8Array(32); // 256 bits
  crypto.getRandomValues(key);
  return bytesToHex(key);
}

// Helper functions
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}