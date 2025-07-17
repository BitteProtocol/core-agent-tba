# XMTP Bitte Agent Message Listener

A Bun-based Node.js service that continuously listens for XMTP messages and processes them through the Bitte AI API.
a
## Features

- **Real-time XMTP Integration**: Continuously listens for new XMTP messages
- **Bitte AI Processing**: Routes messages through Bitte AI agents for intelligent responses
- **Automatic Error Handling**: Handles errors gracefully and sends fallback responses
- **Key Generation Utility**: Script to generate wallet and encryption keys for setup

## Use Cases

- **XMTP Message Processing**: Real-time automated response to XMTP messages
- **AI Agent Proxy**: Bridge between XMTP and Bitte AI agents
- **Continuous Service**: Long-running service for persistent message handling

## Requirements

- [Bun](https://bun.sh/) (v1.0+)
- Node.js v20+

## Setup

1. **Install Dependencies**:
   ```bash
   bun install
   ```

2. **Generate Keys (Optional, for first-time setup)**:
   ```bash
   bun scripts/gen-keys.ts
   ```
   This will create or append to a `.env` file in your project directory with generated `WALLET_KEY` and `ENCRYPTION_KEY`. You may need to manually add the other required variables (see below).

3. **Configure Environment Variables**:
   Create a `.env` file in the project root with the following variables:
   ```env
   WALLET_KEY=your_wallet_private_key
   ENCRYPTION_KEY=your_encryption_key
   BITTE_API_KEY=your_bitte_api_key
   BITTE_AGENT_ID=your_bitte_agent_id
   XMTP_ENV=dev # or 'production', 'staging', etc. (as required)
   ```
   - `WALLET_KEY`: EVM private key (hex string, with or without 0x prefix)
   - `ENCRYPTION_KEY`: 32-byte hex string for local DB encryption
   - `BITTE_API_KEY`: Your Bitte API key (get from Bitte platform)
   - `BITTE_AGENT_ID`: The agent ID to route messages to (e.g. `coingecko-ai.vercel.app`)
   - `XMTP_ENV`: XMTP environment (`dev`, `production`, etc.)

4. **Run the Service**:
   ```bash
   bun start
   ```
   or for development:
   ```bash
   bun dev
   ```

## Scripts

- `bun start` / `bun dev`: Start the XMTP message listener (production/development)
- `bun scripts/gen-keys.ts`: Generate wallet and encryption keys and append to `.env`

## How It Works

1. **XMTP Setup**: Creates an XMTP client using your wallet and encryption key, and syncs conversations
2. **Message Streaming**: Listens for new messages via XMTP's streaming API
3. **Message Processing**: For each incoming message, checks sender and content type, then processes
4. **AI Response**: Sends the message to the configured Bitte AI agent and receives a response
5. **Reply**: Sends the AI response back to the XMTP conversation
6. **Error Handling**: Logs errors and sends a fallback message if processing fails

## Deployment

This service is designed to run as a long-running process. You can deploy it to:
- VPS or dedicated server
- Docker container
- Cloud services like Railway, Fly.io, or DigitalOcean App Platform

## Troubleshooting

- **Check Environment Variables**: Ensure all required env vars are set in your `.env` file
- **Key Generation**: Use `bun scripts/gen-keys.ts` to generate keys if you don't have them
- **Monitor Logs**: Check console output for detailed execution info
- **API Errors**: If you see errors from Bitte API, check your API key and agent ID
- **Restart on Errors**: The service will log errors and continue running, but you may need to restart if persistent issues occur

## Notes

- This project uses Bun as the runtime. All scripts and commands assume Bun is installed.
- The `.env.example` file can be used as a template for your environment variables.
- For more details on XMTP, see the included `XMTP_docs.md`.
