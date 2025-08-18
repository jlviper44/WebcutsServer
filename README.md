# Webcuts Server - Cloudflare Worker

A Cloudflare Worker that bridges iOS Shortcuts with webhooks, allowing external services to trigger shortcuts via globally accessible URLs.

## Features

- 🚀 **Auto-discovery** of iOS shortcuts
- 🌍 **Global webhook URLs** via Cloudflare's edge network
- 📱 **Push notification** triggered execution
- 🔒 **Secure** with optional webhook signatures
- ⚡ **Fast** with Cloudflare's global CDN
- 💰 **Cost-effective** using Cloudflare's free tier

## Setup

### Prerequisites

1. Cloudflare account
2. Apple Developer account (for APNs)
3. Node.js 18+ installed
4. Wrangler CLI installed (`npm install -g wrangler`)

### Installation

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure your Cloudflare account:
   ```bash
   wrangler login
   ```

4. Create KV namespace:
   ```bash
   npm run kv:create
   ```
   Update the KV namespace ID in `wrangler.jsonc`

5. Set required secrets:
   ```bash
   # APNs Authentication Key (contents of .p8 file)
   wrangler secret put APNS_AUTH_KEY
   
   # APNs Key ID
   wrangler secret put APNS_KEY_ID
   
   # Apple Developer Team ID
   wrangler secret put APNS_TEAM_ID
   
   # Optional: Webhook signature secret
   wrangler secret put WEBHOOK_SECRET
   ```

### Configuration

Edit `wrangler.jsonc`:
- Replace `YOUR_KV_NAMESPACE_ID` with actual KV namespace ID
- Replace `YOUR_CLOUDFLARE_ACCOUNT_ID` with your account ID
- Update `APNS_BUNDLE_ID` to match your iOS app
- Set `APNS_PRODUCTION` to `"true"` for production

## Development

Start local development server:
```bash
npm run dev
```

The worker will be available at `http://localhost:8787`

## API Endpoints

### Register Device
```http
POST /register
Content-Type: application/json

{
  "deviceToken": "abc123...",
  "deviceName": "John's iPhone",
  "bundleId": "com.webcuts.app",
  "shortcuts": [
    {"id": "shortcut1", "name": "Good Morning"},
    {"id": "shortcut2", "name": "Lights Off"}
  ]
}
```

Response:
```json
{
  "success": true,
  "deviceId": "uuid",
  "webhooks": {
    "shortcut1": "https://worker.domain.com/webhook/abc123",
    "shortcut2": "https://worker.domain.com/webhook/def456"
  }
}
```

### Trigger Webhook
```http
POST /webhook/{webhook-id}
Content-Type: application/json
X-Webhook-Signature: optional-hmac-signature

{
  "payload": {
    "custom": "data"
  }
}
```

### Update Device
```http
PUT /device/{device-token}
Content-Type: application/json

{
  "shortcuts": [
    {"id": "newShortcut", "name": "New Shortcut"}
  ],
  "removeShortcuts": ["oldShortcut"]
}
```

### Health Check
```http
GET /health
```

## Deployment

Deploy to Cloudflare Workers:
```bash
npm run deploy
```

For production deployment:
```bash
npm run deploy:production
```

Monitor logs:
```bash
npm run tail
```

## Security

- Device tokens are validated before storage
- Optional HMAC signature validation for webhooks
- Rate limiting per shortcut/device
- HTTPS-only communication
- Secure APNs JWT authentication

## Cost Structure

### Cloudflare Workers
- **Free Tier**: 100,000 requests/day
- **Paid Tier**: $5/month for 10 million requests
- **KV Storage**: $0.50/month per million operations

### Apple Developer
- **Developer Account**: $99/year
- **Push Notifications**: Free (included)

## Architecture

```
External Service → Cloudflare Worker → APNs → iOS Device → Shortcut
     (API)          (Global Edge)    (Push)   (App)      (Execute)
```

## Troubleshooting

### Common Issues

1. **Push notifications not received**
   - Verify APNs credentials are correct
   - Check if using sandbox vs production APNs
   - Ensure device token is valid

2. **Webhook returns 404**
   - Verify the webhook ID exists
   - Check if device is still registered

3. **Rate limit errors**
   - Default limit is 10 requests/minute per webhook
   - Adjust `RATE_LIMIT_PER_MINUTE` in wrangler.jsonc

## License

MIT