import { Client, type XmtpEnv } from "@xmtp/node-sdk";
import { BitteAPIClient } from "@/helpers/bitte-client";
import {
	createSigner,
	getEncryptionKeyFromHex,
	logAgentDetails,
} from "@/helpers/client";
import { ENCRYPTION_KEY, WALLET_KEY, XMTP_ENV } from "@/helpers/config";

/**
 * Main function to run the agent
 */
async function main() {
	/* Create the signer using viem and parse the encryption key for the local db */
	const signer = createSigner(WALLET_KEY);
	const dbEncryptionKey = getEncryptionKeyFromHex(ENCRYPTION_KEY);

	const client = await Client.create(signer, {
		dbEncryptionKey,
		env: XMTP_ENV as XmtpEnv,
		// don't create local db files during development
		dbPath: process.env.NODE_ENV === "production" ? undefined : null,
	});

	void logAgentDetails(client);

	/* Sync the conversations from the network to update the local db */
	await client.conversations.sync();
	await client.revokeAllOtherInstallations();

	// Stream all messages for GPT responses
	const messageStream = () => {
		void client.conversations.streamAllMessages((error, message) => {
			if (error) {
				console.error("Error in message stream:", error);
				return;
			}
			if (!message) {
				return;
			}

			void (async () => {
				/* Ignore messages from the same agent or non-text messages */
				if (
					message.senderInboxId.toLowerCase() ===
						client.inboxId.toLowerCase() ||
					message.contentType?.typeId !== "text"
				) {
					return;
				}
				/* Get the conversation from the local db */
				const conversation = await client.conversations.getConversationById(
					message.conversationId,
				);

				/* If the conversation is not found, skip the message */
				if (!conversation) {
					return;
				}

				const bitteClient = new BitteAPIClient();

				const inboxState = await client.preferences.inboxStateFromInboxIds([
					message.senderInboxId,
				]);
				const addressFromInboxId = inboxState[0].identifiers[0].identifier;

				const messageString =
					typeof message.content === "string"
						? message.content
						: JSON.stringify(message.content);

				try {
					/* Get the AI response */
					const completion = await bitteClient.sendToAgent({
						message: messageString,
						walletInfo: {
							evm: {
								address: addressFromInboxId,
							},
						},
					});

					const content = completion.content;

					/* Send the AI response to the conversation */
					await conversation.send(content);
				} catch (error) {
					console.error("Error getting AI response:", error);
					await conversation.send(
						"Sorry, I encountered an error processing your message.",
					);
				}
			})();
		});
	};

	// Start the message stream
	messageStream();
}

main().catch(console.error);
