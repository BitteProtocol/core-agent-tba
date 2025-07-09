import { Client, type Signer, type XmtpEnv } from "@xmtp/node-sdk";
import { BitteAPIClient } from "./helpers/bitte-client.js";
import { createSigner } from "./helpers/client.js";
import { config } from 'dotenv';

config();

const { WALLET_KEY, ENCRYPTION_KEY } = process.env;

// Global variables for XMTP client management
let xmtpClient: Client | null = null;
let isListening = false;

// Inbox management functions to handle "inbox log is full" errors
async function checkInboxState(client: Client): Promise<void> {
	try {
		// Get detailed inbox state
		const inboxState = await client.preferences.inboxState();
		
		console.log("=== INBOX DIAGNOSTICS ===");
		console.log(`Inbox ID: ${inboxState.inboxId}`);
		console.log(`Recovery Identifier: ${inboxState.recoveryIdentifier}`);
		console.log(`Total Identifiers: ${inboxState.identifiers.length}`);
		console.log(`Total Installations: ${inboxState.installations.length}`);
		
		// List all identifiers
		console.log("\n=== IDENTIFIERS ===");
		inboxState.identifiers.forEach((identifier: any, index: number) => {
			console.log(`${index + 1}. Kind: ${identifier.kind}, Identifier: ${identifier.identifier}`);
		});
		
		// List all installations
		console.log("\n=== INSTALLATIONS ===");
		inboxState.installations.forEach((installation: any, index: number) => {
			console.log(`${index + 1}. ID: ${installation.id}`);
		});
		
		// Check if approaching limits
		const installationCount = inboxState.installations.length;
		if (installationCount >= 5) {
			console.log("\n⚠️  WARNING: You have 5+ installations. Consider revoking unused ones.");
		}
		
		if (installationCount >= 200) {
			console.log("\n🚨 CRITICAL: Very high installation count. Inbox log may be approaching limit.");
		}
		
	} catch (error: any) {
		console.error("❌ Error checking inbox state:", error.message);
		
		if (error.message.includes("inbox log is full")) {
			console.log("\n🔧 SOLUTION REQUIRED:");
			console.log("1. Use static revocation to remove installations");
			console.log("2. Or rotate to a new inbox ID (loses conversations)");
		}
		throw error;
	}
}

async function revokeUnusedInstallations(client: Client): Promise<void> {
	try {
		// Get current inbox state to see all installations
		const inboxState = await client.preferences.inboxState();
		console.log(`Current installations: ${inboxState.installations.length}`);
		
		// List all installations
		inboxState.installations.forEach((installation: any, index: number) => {
			console.log(`Installation ${index + 1}: ${installation.id}`);
		});

		// Revoke ALL other installations (keep only current one)
		await client.revokeAllOtherInstallations();
		console.log("✅ All other installations revoked");
		
	} catch (error: any) {
		console.error("❌ Error revoking installations:", error.message);
		throw error;
	}
}

// For cases where you can't create a client due to the "inbox log is full" error
async function staticRevocation(inboxId: string, recoveryWalletKey: string, env: XmtpEnv = "production"): Promise<void> {
	try {
		const recoveryWallet = createSigner(recoveryWalletKey);
		
		// Get inbox state without logging in
		const inboxStates = await Client.inboxStateFromInboxIds([inboxId], env);
		const installations = inboxStates[0].installations;
		
		console.log(`Found ${installations.length} installations to potentially revoke`);
		
		// Get installation IDs to revoke
		const toRevokeInstallationBytes = installations.map((i) => i.bytes);
		
		// Static revocation using recovery address
		await Client.revokeInstallations(
			recoveryWallet,
			inboxId,
			toRevokeInstallationBytes,
			env
		);
		
		console.log("✅ Installations revoked using recovery address");
	} catch (error: any) {
		console.error("❌ Error in static revocation:", error.message);
		throw error;
	}
}

// For external inbox checking without client
async function checkInboxStateWithoutClient(inboxId: string, env: XmtpEnv = "production"): Promise<void> {
	try {
		const inboxStates = await Client.inboxStateFromInboxIds([inboxId], env);
		const state = inboxStates[0];
		
		console.log("=== EXTERNAL INBOX CHECK ===");
		console.log(`Inbox ID: ${state.inboxId}`);
		console.log(`Total Installations: ${state.installations.length}`);
		
		// This will help you identify which installations to revoke
		state.installations.forEach((installation, index) => {
			console.log(`${index + 1}. Installation: ${installation.id}`);
		});
		
	} catch (error: any) {
		console.error("❌ Error:", error.message);
		throw error;
	}
}

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

		// Convert encryption key string to Uint8Array
		const encryptionKeyBytes = new Uint8Array(Buffer.from(ENCRYPTION_KEY, 'hex'));

		xmtpClient = await Client.create(signer, { env, dbEncryptionKey: encryptionKeyBytes });
		console.log("✅ XMTP client created successfully");

		// Check inbox state for diagnostics
		await checkInboxState(xmtpClient);

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
	} catch (error: any) {
		console.error("❌ XMTP listener failed:", error);
		isListening = false;
		
		// Handle specific "inbox log is full" error
		if (error.message && error.message.includes("inbox log is full")) {
			console.log("\n🚨 INBOX LOG IS FULL ERROR DETECTED!");
			console.log("This means you've reached the 256 inbox update limit.");
			console.log("\n🔧 SOLUTIONS:");
			console.log("1. Use the revokeUnusedInstallations() function to clean up installations");
			console.log("2. Use staticRevocation() if you can't log in due to this error");
			console.log("3. As last resort, rotate to a new inbox ID (loses all conversations)");
			console.log("\n📞 Contact support if you need help with inbox rotation.");
			
			// Don't retry automatically for this error - requires manual intervention
			return;
		}
		
		// Retry after 5 seconds for other errors
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

// Manual function to fix "inbox log is full" error
async function fixInboxLogFull(): Promise<void> {
	if (!WALLET_KEY || !ENCRYPTION_KEY) {
		throw new Error("MISSING ENV VARIABLES: WALLET_KEY and ENCRYPTION_KEY are required");
	}

	try {
		console.log("🔧 Attempting to fix inbox log full error...");
		
		const signer: Signer = createSigner(WALLET_KEY);
		const env: XmtpEnv = "production";
		const encryptionKeyBytes = new Uint8Array(Buffer.from(ENCRYPTION_KEY, 'hex'));

		// Try to create client and revoke installations
		try {
			const client = await Client.create(signer, { env, dbEncryptionKey: encryptionKeyBytes });
			console.log("✅ Client created successfully - can revoke installations normally");
			
			await checkInboxState(client);
			await revokeUnusedInstallations(client);
			
		} catch (clientError: any) {
			if (clientError.message.includes("inbox log is full")) {
				console.log("❌ Can't create client - using static revocation method");
				
				// Get inbox ID first by attempting to get inbox state
				const tempSigner = createSigner(WALLET_KEY);
				const tempIdentity = await tempSigner.getIdentifier();
				
				// You'll need to manually provide your inbox ID here
				console.log("📝 You need to provide your inbox ID for static revocation");
				console.log("To find your inbox ID, check your previous logs or use a different method");
				
				// Uncomment and provide your inbox ID to use static revocation:
				// await staticRevocation("YOUR_INBOX_ID_HERE", WALLET_KEY, env);
			} else {
				throw clientError;
			}
		}
		
	} catch (error: any) {
		console.error("❌ Error fixing inbox log:", error.message);
		throw error;
	}
}

// Export functions for manual use if needed
// Uncomment the line below to manually fix inbox log issues:
// fixInboxLogFull().catch(console.error);

// Start the XMTP listener
console.log("🚀 Starting XMTP message listener...");
startXmtpListener(); 