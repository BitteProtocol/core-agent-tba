import { Client, type Signer, type XmtpEnv } from "@xmtp/node-sdk";
import { BitteAPIClient } from "./helpers/bitte-client.js";
import { createSigner } from "./helpers/client.js";

const { CRON_SECRET, WALLET_KEY, ENCRYPTION_KEY } = process.env;

// Global variables for XMTP client management
let xmtpClient: Client | null = null;
let isListening = false;

async function startXmtpListener() {
	try {
		if (isListening) {
			console.log("⚠️ XMTP listener is already running");
			return;
		}

		console.log("🚀 Starting XMTP listener...");
		
		// Check required environment variables
		if (!WALLET_KEY || !ENCRYPTION_KEY) {
			throw new Error("MISSING ENV VARIABLES: WALLET_KEY and ENCRYPTION_KEY are required");
		}

		// --- XMTP Setup ---
		const signer: Signer = createSigner(WALLET_KEY);
		const env: XmtpEnv = "production";
		const bitteClient = new BitteAPIClient();

		xmtpClient = await Client.create(signer, { env, dbPath: null });
		console.log("✅ XMTP client created successfully");

		await xmtpClient.revokeAllOtherInstallations();
		console.log("🔌 Revoked any other installations successfully");

		await xmtpClient.conversations.syncAll();
		console.log("✅ Conversations synced successfully");

		isListening = true;
		
		// Listen to all messages
		const stream = await xmtpClient.conversations.streamAllMessages();
		console.log("👂 Started listening for messages...");

		for await (const message of stream) {
			// Check if we should stop listening
			if (!isListening) {
				console.log("🛑 Stopping XMTP listener...");
				break;
			}

			if (!message) continue;
			
			// Ignore messages from the agent
			if (message?.senderInboxId === xmtpClient.inboxId) continue;
			
			try {
				console.log(`📨 Received message from ${message.senderInboxId}`);
				
				// Get the conversation by id
				const conversation = await xmtpClient.conversations.getConversationById(
					message.conversationId,
				);

				const messageContent = message.content;
				const inboxState = await xmtpClient.preferences.inboxStateFromInboxIds([
					message.senderInboxId,
				]);

				const userAddressFromInboxId = inboxState[0].identifiers[0].identifier;

				const messageContentString =
					typeof messageContent === "string"
						? messageContent
						: JSON.stringify(messageContent);

				console.log(`💬 Processing message: "${messageContentString}"`);

				// Send message to Bitte agent
				const response = await bitteClient.sendToAgent(
					"bitte-defi-agent.mastra.cloud",
					messageContentString,
					{
						evmAddress: userAddressFromInboxId,
					},
				);

				console.log(`🤖 Agent response: "${response.content}"`);

				// Send response back to conversation
				await conversation?.send(
					response.content || "Sorry, I couldn't process that message.",
				);

				console.log("✅ Response sent successfully");
			} catch (messageError) {
				console.error("❌ Error processing message:", messageError);
				
				// Try to send error response to conversation
				try {
					const conversation = await xmtpClient?.conversations.getConversationById(
						message.conversationId,
					);
					await conversation?.send("Sorry, I encountered an error processing your message.");
				} catch (responseError) {
					console.error("❌ Error sending error response:", responseError);
				}
			}
		}
		
		console.log("🛑 XMTP listener stopped");
		isListening = false;
	} catch (error) {
		console.error("❌ XMTP listener failed:", error);
		isListening = false;
		// Retry after 5 seconds
		console.log("🔄 Retrying in 5 seconds...");
		setTimeout(() => {
			startXmtpListener();
		}, 5000);
	}
}

// Graceful shutdown
process.on("SIGINT", () => {
	console.log("🛑 Received SIGINT, shutting down gracefully...");
	isListening = false;
	process.exit(0);
});

process.on("SIGTERM", () => {
	console.log("🛑 Received SIGTERM, shutting down gracefully...");
	isListening = false;
	process.exit(0);
});

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
	console.error("❌ Uncaught exception:", error);
	isListening = false;
	// Retry after 5 seconds
	console.log("🔄 Retrying in 5 seconds...");
	setTimeout(() => {
		startXmtpListener();
	}, 5000);
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
	console.error("❌ Unhandled rejection at:", promise, "reason:", reason);
	isListening = false;
	// Retry after 5 seconds
	console.log("🔄 Retrying in 5 seconds...");
	setTimeout(() => {
		startXmtpListener();
	}, 5000);
});

// Start the XMTP listener
console.log("🚀 Starting XMTP message listener...");
startXmtpListener(); 