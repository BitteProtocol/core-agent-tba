import { Client, LogLevel } from "@xmtp/node-sdk";
import { config } from "dotenv";
import { createSigner, getDbPath, getEncryptionKeyFromHex } from "@/helpers/client";

// Load environment variables
config();

async function testConnection() {
	const { WALLET_KEY, ENCRYPTION_KEY, XMTP_ENV } = process.env;

	if (!WALLET_KEY || !ENCRYPTION_KEY || !XMTP_ENV) {
		console.error("❌ Missing required environment variables");
		console.log("Required: WALLET_KEY, ENCRYPTION_KEY, XMTP_ENV");
		process.exit(1);
	}

	console.log("🔧 Testing XMTP connection...");
	console.log(`Environment: ${XMTP_ENV}`);

	try {
		// Create signer
		const signer = createSigner(WALLET_KEY);
		const identifier = await signer.getIdentifier();
		console.log(`✅ Created signer for address: ${identifier.identifier}`);

		// Create client
		const dbEncryptionKey = getEncryptionKeyFromHex(ENCRYPTION_KEY);
		const client = await Client.create(signer, {
			dbEncryptionKey,
			env: XMTP_ENV as any,
			dbPath: getDbPath(XMTP_ENV),
			loggingLevel: LogLevel.info,
		});

		console.log(`✅ Client created successfully`);
		console.log(`InboxId: ${client.inboxId}`);
		console.log(`InstallationId: ${client.installationId}`);

		// Check inbox state
		const inboxState = await client.preferences.inboxState();
		console.log(`\n📊 Inbox State:`);
		console.log(`Identities: ${inboxState.identities.length}`);
		console.log(`Installations: ${inboxState.installations.length}`);

		// List conversations
		const conversations = await client.conversations.list();
		console.log(`\n💬 Conversations: ${conversations.length}`);

		// Sync conversations
		console.log("\n🔄 Syncing conversations...");
		await client.conversations.sync();
		console.log("✅ Sync complete");

		console.log("\n✅ All tests passed! XMTP connection is working correctly.");
		process.exit(0);
	} catch (error) {
		console.error("\n❌ Test failed:", error);
		process.exit(1);
	}
}

testConnection();