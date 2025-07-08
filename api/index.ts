import { Hono } from 'hono';
import { Client, type XmtpEnv, type Signer } from "@xmtp/node-sdk";
import { createSigner } from '../helpers/client.js';
import { config } from 'dotenv';
import { BitteAPIClient } from '../helpers/bitte-client.js';
config();

export const runtime = 'nodejs'

const app = new Hono();

// Add logging middleware
app.use('*', async (c, next) => {
    const start = Date.now();
    const method = c.req.method;
    const url = c.req.url;
    const userAgent = c.req.header('user-agent') || 'unknown';
    const contentType = c.req.header('content-type') || 'unknown';

    console.log(`[${new Date().toISOString()}] Incoming ${method} request to ${url}`);
    console.log(`  User-Agent: ${userAgent}`);
    console.log(`  Content-Type: ${contentType}`);

    // Log request headers
    console.log('  Headers:', Object.fromEntries(c.req.raw.headers.entries()));

    await next();

    const duration = Date.now() - start;
    const status = c.res.status;

    console.log(`[${new Date().toISOString()}] ${method} ${url} - ${status} (${duration}ms)`);
});

// Cron job endpoint
app.get('/api', async (c) => {
    try {
        console.log('🔄 Starting cron job execution...');
        
        // --- XMTP Setup ---
        const walletKey = process.env.WALLET_KEY || "";
        if (!walletKey) {
            throw new Error('WALLET_KEY is not set');
        }

        const encryptionKey = process.env.ENCRYPTION_KEY || "";
        if (!encryptionKey) {
            throw new Error('ENCRYPTION_KEY is not set');
        }

        const signer: Signer = createSigner(walletKey);
        const env: XmtpEnv = "dev";
        const bitteClient = new BitteAPIClient();

        console.log('🔌 Creating XMTP client...');
        const client = await Client.create(signer, { env, dbPath: null });
        console.log('✅ XMTP client created successfully');

        console.log('🔄 Syncing conversations...');
        await client.conversations.sync();
        console.log('✅ Conversations synced successfully');

        // Get all conversations
        const conversations = await client.conversations.list();
        console.log(`📋 Found ${conversations.length} conversations`);

        let processedCount = 0;
        let errorCount = 0;

        // Process messages from all conversations
        for (const conversation of conversations) {
            try {
                console.log(`🔍 Checking conversation ${conversation.id} for new messages...`);
                
                // Sync messages for this conversation
                await conversation.sync();
                
                // Get recent messages (last 10 to avoid overwhelming the function)
                const messages = await conversation.messages({ limit: 10 });
                
                // Process messages from others (not from our agent)
                const newMessages = messages.filter(msg => 
                    msg.senderInboxId !== client.inboxId && 
                    isRecentMessage(msg.sentAt)
                );

                console.log(`📨 Found ${newMessages.length} new messages in conversation ${conversation.id}`);

                for (const message of newMessages) {
                    try {
                        console.log(`💬 Processing message from ${message.senderInboxId}`);
                        
                        // Send message to Bitte agent
                        const response = await bitteClient.sendToAgent(
                            "bitte-defi-agent.mastra.cloud", 
                            message.content?.toString() || "", 
                            {}
                        );

                        // Send response back to conversation
                        await conversation.send(response.content || "Sorry, I couldn't process that message.");
                        
                        processedCount++;
                        console.log(`✅ Processed message ${processedCount}`);
                        
                    } catch (msgError) {
                        console.error(`❌ Error processing message:`, msgError);
                        errorCount++;
                    }
                }
                
            } catch (convError) {
                console.error(`❌ Error processing conversation ${conversation.id}:`, convError);
                errorCount++;
            }
        }

        const result = {
            success: true,
            timestamp: new Date().toISOString(),
            processed: processedCount,
            errors: errorCount,
            totalConversations: conversations.length,
            message: `Processed ${processedCount} messages with ${errorCount} errors`
        };

        console.log('✅ Cron job completed successfully:', result);
        return c.json(result);

    } catch (error) {
        console.error('❌ Cron job failed:', error);
        
        return c.json({
            success: false,
            timestamp: new Date().toISOString(),
            error: error instanceof Error ? error.message : 'Unknown error',
            message: 'Cron job failed'
        }, 500);
    }
});

// Health check endpoint
app.get('/api/health', async (c) => {
    return c.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        message: 'XMTP Cron Service is running'
    });
});

// Helper function to check if message is recent (within last 5 minutes)
function isRecentMessage(sentAt: Date): boolean {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    return sentAt > fiveMinutesAgo;
}

// Export Hono handlers
export default app.fetch
