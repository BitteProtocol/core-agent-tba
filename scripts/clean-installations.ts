import { Agent } from "@xmtp/agent-sdk";
import { createSigner, getEncryptionKeyFromHex } from "@/helpers/client.ts";
import {
	XMTP_DB_ENCRYPTION_KEY,
	XMTP_ENV,
	XMTP_WALLET_KEY,
} from "@/helpers/config";

/**
 * Standalone Installation Cleaner
 *
 * This script cleans ALL XMTP installations to start completely fresh.
 * Use this when you get "too many installations" errors that prevent server startup.
 */

async function cleanAllInstallations() {
	try {
		console.log(
			"🧹 Starting complete installation cleanup (removing ALL installations)...",
		);

		// Create signer
		const signer = createSigner(XMTP_WALLET_KEY);
		const identifier = await signer.getIdentifier();
		console.log(`📧 Wallet address: ${identifier.identifier}`);

		// We need to get the InboxID first - create a temporary client to get it
		console.log("🔍 Getting InboxID...");

		let inboxId: string;
		try {
			// Try to create client to get InboxID (this might fail due to installations)
			const tempAgent = await Agent.create(signer, {
				dbEncryptionKey: getEncryptionKeyFromHex(XMTP_DB_ENCRYPTION_KEY),
				env: XMTP_ENV,
				dbPath: null,
			});

			inboxId = tempAgent.client.inboxId;
			console.log(`📦 InboxID: ${inboxId}`);
		} catch (error) {
			// If client creation fails, extract InboxID from error message
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			console.log(`🔍 Error message: ${errorMessage}`);
			const inboxIdMatch = errorMessage.match(/InboxID ([a-f0-9]+)/);

			if (!inboxIdMatch) {
				console.log("❌ Could not find InboxID pattern in error message");
				console.log("   Looking for pattern: /InboxID ([a-f0-9]+)/");
				throw new Error("Could not extract InboxID from error message");
			}

			inboxId = inboxIdMatch[1];
			console.log(`📦 InboxID (from error): ${inboxId}`);
		}

		// Get current installations using static method
		console.log("📊 Getting current installations...");
		const tempAgent = await Agent.create(signer, {
			dbEncryptionKey: getEncryptionKeyFromHex(XMTP_DB_ENCRYPTION_KEY),
			env: XMTP_ENV,
			dbPath: null,
		});

		const tempClient = tempAgent.client;

		await tempClient.revokeAllOtherInstallations();

		console.log(`\n✅ Successfully revoked ALL installations`);
	} catch (error) {
		console.error(
			"❌ Cleanup failed:",
			error instanceof Error ? error.message : String(error),
		);
		console.error("\nTroubleshooting:");
		console.error(
			"1. Check your .env file has correct WALLET_KEY, ENCRYPTION_KEY, and XMTP_ENV",
		);
		console.error("2. Make sure you have network connectivity");
		console.error("3. Try running the script again");
		process.exit(1);
	}
}

// Run the cleanup
cleanAllInstallations().catch((error) => {
	console.error("💥 Unexpected error:", error);
	process.exit(1);
});
