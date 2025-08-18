# Webcuts Server Setup Guide

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Login to Cloudflare
```bash
wrangler login
```

### 3. Create D1 Database
```bash
npm run db:create
```
Note the database ID from the output and update it in `wrangler.jsonc`

### 4. Initialize Database Schema
```bash
# For production database
npm run db:migrate

# For local development
npm run db:migrate:local
```

### 5. Configure Secrets

Set your APNs credentials:
```bash
# APNs Authentication Key (contents of .p8 file)
wrangler secret put APNS_AUTH_KEY

# APNs Key ID (from Apple Developer Portal)
wrangler secret put APNS_KEY_ID

# Apple Developer Team ID
wrangler secret put APNS_TEAM_ID

# Optional: Webhook signature secret for enhanced security
wrangler secret put WEBHOOK_SECRET
```

### 6. Update Configuration

Edit `wrangler.jsonc`:
- Replace `YOUR_D1_DATABASE_ID` with the ID from step 3
- Replace `YOUR_CLOUDFLARE_ACCOUNT_ID` with your account ID
- Update `APNS_BUNDLE_ID` if needed

### 7. Run Development Server
```bash
npm run dev
# or
npm run preview
```

The worker will be available at `http://localhost:8787`

## Database Management

### View Database Console
```bash
# Production
npm run db:console

# Local
npm run db:console:local
```

### Example Queries
```sql
-- View all devices
SELECT * FROM devices;

-- View all active webhooks
SELECT * FROM active_webhooks;

-- Check recent webhook executions
SELECT * FROM webhook_executions ORDER BY executed_at DESC LIMIT 10;

-- View daily analytics
SELECT * FROM daily_analytics LIMIT 7;
```

## Deployment

### Deploy to Cloudflare
```bash
# Deploy to Cloudflare Workers
npm run deploy
```

### Monitor Logs
```bash
npm run tail
```

## Testing

### Test Registration
```bash
curl -X POST http://localhost:8787/register \
  -H "Content-Type: application/json" \
  -d '{
    "deviceToken": "YOUR_64_CHAR_HEX_TOKEN",
    "deviceName": "Test iPhone",
    "shortcuts": [
      {"id": "shortcut1", "name": "Test Shortcut"}
    ]
  }'
```

### Test Webhook
```bash
curl -X POST http://localhost:8787/webhook/YOUR_WEBHOOK_ID \
  -H "Content-Type: application/json" \
  -d '{"payload": {"test": "data"}}'
```

## Troubleshooting

### Database Issues
- Ensure D1 database is created and ID is correct in wrangler.jsonc
- Run migrations if tables don't exist
- Check database console for data

### APNs Issues
- Verify APNs credentials are set correctly
- Check if using correct environment (sandbox vs production)
- Ensure device tokens are valid 64-character hex strings

### Rate Limiting
- Default is 10 requests per minute per webhook
- Adjust `RATE_LIMIT_PER_MINUTE` in wrangler.jsonc if needed

## Migration from KV to D1

This project now uses Cloudflare D1 SQL database instead of KV storage for:
- Better relational data management
- Advanced querying capabilities
- Built-in analytics and logging
- Improved performance for complex operations

The D1 database provides:
- Structured data storage with foreign keys
- Automatic indexing for performance
- Views for common queries
- Triggers for automatic updates
- Full SQL query support