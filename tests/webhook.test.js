import { describe, it, expect, beforeAll } from 'vitest';
import worker from '../src/index.js';

describe('Webhook Endpoints', () => {
  let env;

  beforeAll(() => {
    env = {
      DEVICES: {
        get: async (key) => {
          if (key === 'webhook:test123') {
            return JSON.stringify({
              deviceToken: 'abc123',
              deviceId: 'device-uuid',
              shortcutId: 'shortcut1',
              shortcutName: 'Test Shortcut'
            });
          }
          return null;
        },
        put: async () => {},
        delete: async () => {}
      },
      WEBHOOK_SECRET: 'test-secret',
      RATE_LIMIT_PER_MINUTE: 10,
      APNS_PRODUCTION: 'false',
      APNS_BUNDLE_ID: 'com.test.app',
      APNS_AUTH_KEY: 'test-key',
      APNS_KEY_ID: 'test-key-id',
      APNS_TEAM_ID: 'test-team'
    };
  });

  it('should return health check', async () => {
    const request = new Request('http://localhost/health', {
      method: 'GET'
    });

    const response = await worker.fetch(request, env);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe('healthy');
    expect(data.version).toBe('1.0.0');
  });

  it('should handle webhook trigger', async () => {
    const request = new Request('http://localhost/webhook/test123', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        payload: { test: 'data' }
      })
    });

    const response = await worker.fetch(request, env);
    
    expect(response.status).toBeLessThan(500);
  });

  it('should return 404 for unknown webhook', async () => {
    const request = new Request('http://localhost/webhook/unknown', {
      method: 'POST'
    });

    const response = await worker.fetch(request, env);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Webhook not found');
  });

  it('should handle CORS preflight', async () => {
    const request = new Request('http://localhost/webhook/test', {
      method: 'OPTIONS'
    });

    const response = await worker.fetch(request, env);

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});