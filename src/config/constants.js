/**
 * Configuration constants for the Webcuts worker
 */

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Webhook-Signature',
  'Access-Control-Max-Age': '86400'
};

export const DEFAULT_RATE_LIMITS = {
  webhooksPerMinute: 10,
  registrationsPerHour: 100,
  devicesPerIP: 10
};

export const APNS_CONFIG = {
  productionHost: 'api.push.apple.com',
  sandboxHost: 'api.sandbox.push.apple.com',
  port: 443,
  defaultTopic: 'com.webcuts.app',
  tokenTTL: 3000 // 50 minutes (tokens valid for 1 hour)
};

export const WEBHOOK_CONFIG = {
  maxPayloadSize: 4096, // 4KB limit for APNs
  signatureHeader: 'x-webhook-signature',
  idLength: 32
};

export const KV_NAMESPACES = {
  devices: 'DEVICES',
  analytics: 'ANALYTICS',
  rateLimits: 'RATE_LIMITS'
};

export const ERROR_MESSAGES = {
  INVALID_TOKEN: 'Invalid device token format',
  DEVICE_NOT_FOUND: 'Device not found',
  WEBHOOK_NOT_FOUND: 'Webhook not found',
  RATE_LIMIT_EXCEEDED: 'Rate limit exceeded',
  INVALID_SIGNATURE: 'Invalid webhook signature',
  REGISTRATION_FAILED: 'Device registration failed',
  PUSH_FAILED: 'Failed to send push notification',
  INVALID_PAYLOAD: 'Invalid request payload',
  UNAUTHORIZED: 'Unauthorized request'
};

export const SUCCESS_MESSAGES = {
  DEVICE_REGISTERED: 'Device registered successfully',
  WEBHOOK_TRIGGERED: 'Shortcut triggered successfully',
  DEVICE_UPDATED: 'Device updated successfully',
  HEALTH_CHECK: 'Service is healthy'
};