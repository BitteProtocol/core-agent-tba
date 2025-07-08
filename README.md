# XMTP Bitte Agent Proxy

This is a Vercel-deployed XMTP agent proxy that processes messages through the Bitte AI API using cron jobs.

## Features

- **XMTP Integration**: Connects to XMTP network to receive and send messages
- **Bitte AI Processing**: Routes messages through Bitte AI agents for intelligent responses
- **Cron Job Architecture**: Processes messages in batches every 5 minutes
- **Health Monitoring**: Includes health check endpoint for monitoring

## Use Cases

1. **XMTP Message Processing**: Automated response to XMTP messages
2. **AI Agent Proxy**: Bridge between XMTP and Bitte AI agents
3. **Batch Processing**: Efficient message handling in serverless environment

## Setup

1. **Environment Variables**: Create a `.env` file with:
   ```
   WALLET_KEY=your_wallet_private_key
   ENCRYPTION_KEY=your_encryption_key
   BITTE_API_KEY=your_bitte_api_key
   ```

2. **Deploy to Vercel**: 
   ```bash
   vercel deploy
   ```

3. **Cron Job**: The cron job runs every 5 minutes (`*/5 * * * *`) and processes new messages

## Scripts

- `pnpm run gen-keys`: Generate wallet and encryption keys
- `pnpm run test-cron`: Test the cron job functionality locally

## Endpoints

- `GET /api` - Cron job endpoint (processes messages)
- `GET /api/health` - Health check endpoint

## How It Works

1. **Cron Trigger**: Vercel cron job triggers every 5 minutes
2. **XMTP Sync**: Syncs with XMTP network to get latest conversations
3. **Message Processing**: Processes recent messages (last 5 minutes)
4. **AI Response**: Sends messages to Bitte AI agent for processing
5. **Reply**: Sends AI response back to XMTP conversation
6. **Status Return**: Returns processing status and metrics

## Troubleshooting

- **Check Environment Variables**: Ensure all required env vars are set
- **Test Locally**: Use `pnpm run test-cron` to test functionality
- **Monitor Logs**: Check Vercel function logs for detailed execution info
- **Health Check**: Use `/api/health` to verify service status
