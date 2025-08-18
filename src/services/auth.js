/**
 * Authentication service for user management and access control
 */

import { sha256, generateAPIKey } from '../utils/crypto.js';
import { DatabaseService } from './database.js';

export class AuthService {
  constructor(db) {
    this.db = new DatabaseService(db);
  }

  /**
   * Create a new user account
   */
  async createUser(email, password, username = null) {
    // Check if user already exists
    const existingUser = await this.db.getUserByEmail(email);
    if (existingUser) {
      throw new Error('User with this email already exists');
    }

    if (username) {
      const existingUsername = await this.db.getUserByUsername(username);
      if (existingUsername) {
        throw new Error('Username already taken');
      }
    }

    // Hash the password using PBKDF2 (since bcrypt isn't available in Workers)
    const passwordHash = await this.hashPassword(password);
    
    // Generate verification token
    const verificationToken = generateAPIKey();
    
    // Create user
    const userId = crypto.randomUUID();
    const user = await this.db.createUser({
      id: userId,
      email,
      username,
      password_hash: passwordHash,
      verification_token: verificationToken
    });

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      verificationToken
    };
  }

  /**
   * Authenticate user with email and password
   */
  async authenticateUser(email, password) {
    const user = await this.db.getUserByEmail(email);
    
    if (!user || !user.is_active) {
      throw new Error('Invalid credentials');
    }

    const isValid = await this.verifyPassword(password, user.password_hash);
    if (!isValid) {
      throw new Error('Invalid credentials');
    }

    if (!user.is_verified) {
      throw new Error('Email not verified');
    }

    // Update last login
    await this.db.updateUserLastLogin(user.id);

    // Create session token
    const sessionToken = generateAPIKey();
    const sessionTokenHash = await sha256(sessionToken);
    
    // Store session (expires in 24 hours by default)
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);
    
    await this.db.createSession({
      user_id: user.id,
      token_hash: sessionTokenHash,
      expires_at: expiresAt.toISOString()
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        username: user.username
      },
      sessionToken
    };
  }

  /**
   * Validate session token
   */
  async validateSession(sessionToken) {
    const tokenHash = await sha256(sessionToken);
    const session = await this.db.getSessionByTokenHash(tokenHash);
    
    if (!session || !session.is_active) {
      return null;
    }

    if (new Date(session.expires_at) < new Date()) {
      await this.db.deactivateSession(session.id);
      return null;
    }

    const user = await this.db.getUserById(session.user_id);
    if (!user || !user.is_active) {
      return null;
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        username: user.username
      },
      session
    };
  }

  /**
   * Create API key for user
   */
  async createAPIKey(userId, name, permissions = ['webhook:trigger']) {
    const apiKey = `wc_${generateAPIKey()}`; // Prefix for identification
    const keyHash = await sha256(apiKey);
    const keyPrefix = apiKey.substring(0, 11); // wc_ + first 8 chars
    
    await this.db.createUserAPIKey({
      user_id: userId,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      name,
      permissions: JSON.stringify(permissions)
    });

    return apiKey; // Return the full key only once
  }

  /**
   * Validate API key and check permissions
   */
  async validateAPIKey(apiKey, requiredPermission = null) {
    const keyHash = await sha256(apiKey);
    const keyData = await this.db.getUserAPIKeyByHash(keyHash);
    
    if (!keyData || !keyData.is_active) {
      return null;
    }

    if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
      await this.db.deactivateAPIKey(keyData.id);
      return null;
    }

    const user = await this.db.getUserById(keyData.user_id);
    if (!user || !user.is_active) {
      return null;
    }

    // Check permission if required
    if (requiredPermission) {
      const permissions = JSON.parse(keyData.permissions);
      if (!permissions.includes(requiredPermission) && !permissions.includes('*')) {
        return null;
      }
    }

    // Update last used
    await this.db.updateAPIKeyLastUsed(keyData.id);

    return {
      user: {
        id: user.id,
        email: user.email,
        username: user.username
      },
      apiKey: keyData
    };
  }

  /**
   * Verify webhook ownership
   */
  async verifyWebhookOwnership(webhookId, userId) {
    const webhook = await this.db.getShortcutByWebhook(webhookId);
    
    if (!webhook) {
      return false;
    }

    // Check if the webhook belongs to the user
    return webhook.user_id === userId;
  }

  /**
   * Hash password using PBKDF2 (Workers-compatible)
   */
  async hashPassword(password) {
    const encoder = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    );

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      256
    );

    const hashArray = new Uint8Array(derivedBits);
    const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
    const hashHex = Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
    
    return `pbkdf2:${saltHex}:${hashHex}`;
  }

  /**
   * Verify password against hash
   */
  async verifyPassword(password, storedHash) {
    const [algorithm, saltHex, hashHex] = storedHash.split(':');
    
    if (algorithm !== 'pbkdf2') {
      throw new Error('Unsupported hash algorithm');
    }

    const encoder = new TextEncoder();
    const salt = new Uint8Array(saltHex.match(/.{2}/g).map(byte => parseInt(byte, 16)));
    
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    );

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      256
    );

    const hashArray = new Uint8Array(derivedBits);
    const computedHashHex = Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
    
    return computedHashHex === hashHex;
  }

  /**
   * Log audit event
   */
  async logAudit(userId, action, resourceType, resourceId, details, ipAddress = null) {
    await this.db.createAuditLog({
      user_id: userId,
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      details: JSON.stringify(details),
      ip_address: ipAddress
    });
  }
}