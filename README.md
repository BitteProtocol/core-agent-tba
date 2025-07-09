# XMTP Bitte Agent Message Listener

A Node.js service that continuously listens for XMTP messages and processes them through the Bitte AI API.

## Features

- **Real-time XMTP Integration**: Continuously listens for new XMTP messages
- **Bitte AI Processing**: Routes messages through Bitte AI agents for intelligent responses
- **Automatic Retry**: Handles errors gracefully with automatic retry logic
- **Graceful Shutdown**: Properly handles shutdown signals

## Use Cases

1. **XMTP Message Processing**: Real-time automated response to XMTP messages
2. **AI Agent Proxy**: Bridge between XMTP and Bitte AI agents
3. **Continuous Service**: Long-running service for persistent message handling

## Setup

1. **Install Dependencies**:
   ```bash
   pnpm install
   ```

2. **Environment Variables**: Create a `.env` file with:
   ```
   WALLET_KEY=your_wallet_private_key
   ENCRYPTION_KEY=your_encryption_key
   BITTE_API_KEY=your_bitte_api_key
   ```

3. **Run the Service**:
   ```bash
   pnpm start
   ```

## Scripts

- `pnpm start`: Start the XMTP message listener
- `pnpm dev`: Start the service in development mode
- `pnpm run gen-keys`: Generate wallet and encryption keys
- `pnpm run test-cron`: Test the message processing functionality

## How It Works

1. **XMTP Setup**: Creates XMTP client and syncs conversations
2. **Message Streaming**: Continuously listens for new messages via streaming
3. **Message Processing**: Processes each incoming message immediately
4. **AI Response**: Sends messages to Bitte AI agent for processing
5. **Reply**: Sends AI response back to XMTP conversation
6. **Error Handling**: Handles errors gracefully and retries on failures

## Deployment

This service is designed to run as a long-running process. You can deploy it to:
- VPS or dedicated server
- Docker container
- Cloud services like Railway, Fly.io, or DigitalOcean App Platform

## Troubleshooting

- **Check Environment Variables**: Ensure all required env vars are set
- **Test Locally**: Use `pnpm run test-cron` to test functionality
- **Monitor Logs**: Check console output for detailed execution info
- **Restart on Errors**: The service automatically retries on failures
