import { Client, type Signer, type XmtpEnv } from "@xmtp/node-sdk";
import { BitteAPIClient } from "../../helpers/bitte-client.js";
import { createSigner } from "../../helpers/client.js";

export const runtime = "nodejs";
export const maxDuration = 600;

const { CRON_SECRET, WALLET_KEY, ENCRYPTION_KEY } = process.env;

async function handler(_req: Request) {
	try {
		const authHeader = _req.headers.get("Authorization");
		const authToken = authHeader?.split(" ")[1];
		if (authToken !== CRON_SECRET) {
			return new Response("Unauthorized", { status: 401 });
		}

		if (!CRON_SECRET || !WALLET_KEY || !ENCRYPTION_KEY) {
			throw new Error("MISSING ENV VARIABLES");
		}
		// --- XMTP Setup ---
		const signer: Signer = createSigner(WALLET_KEY);
		const env: XmtpEnv = "production";
		const bitteClient = new BitteAPIClient();

		const client = await Client.create(signer, { env, dbPath: null });
		console.log("✅ XMTP client created successfully");

		await client.revokeAllOtherInstallations();
		console.log("🔌 Revoked any other installations successfully");

		await client.conversations.syncAll();
		console.log("✅ Conversations synced successfully");

		// listen to all messages
		const stream = await client.conversations.streamAllMessages();
		for await (const message of stream) {
			if (!message) continue;
			// ignore messages from the agent
			if (message?.senderInboxId === client.inboxId) continue;
			// get the conversation by id
			const conversation = await client.conversations.getConversationById(
				message.conversationId,
			);
			// send a message from the agent

			const messageContent = message.content;

			const inboxState = await client.preferences.inboxStateFromInboxIds([
				message.senderInboxId,
			]);

			const userAddressFromInboxId = inboxState[0].identifiers[0].identifier;

			const messageContentString =
				typeof messageContent === "string"
					? messageContent
					: JSON.stringify(messageContent);

			// Send message to Bitte agent
			const response = await bitteClient.sendToAgent(
				"bitte-defi-agent.mastra.cloud",
				messageContentString,
				{
					evmAddress: userAddressFromInboxId,
				},
			);

			// Send response back to conversation
			await conversation?.send(
				response.content || "Sorry, I couldn't process that message.",
			);
		}
	} catch (error) {
		console.error("❌ Cron job failed:", error);

		return new Response(
			JSON.stringify({
				success: false,
				timestamp: new Date().toISOString(),
				error: error instanceof Error ? error.message : "Unknown error",
				message: "Cron job failed",
			}),
			{ status: 500 },
		);
	}
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
export const OPTIONS = handler;
export const HEAD = handler;