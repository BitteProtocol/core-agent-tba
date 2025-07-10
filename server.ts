import { openai } from "@ai-sdk/openai";
import {
	ContentTypeReaction,
	ReactionCodec,
} from "@xmtp/content-type-reaction";
import type { ClientOptions, XmtpEnv } from "@xmtp/node-sdk";
import { generateText } from "ai";
import { BitteAPIClient } from "@/helpers/bitte-client";
import {
	createSigner,
	getEncryptionKeyFromHex,
	getOrCreateClient,
	logAgentDetails,
} from "@/helpers/client";
import {
	ENCRYPTION_KEY,
	IS_PRODUCTION,
	WALLET_KEY,
	XMTP_ENV,
} from "@/helpers/config";

/**
 * Main function to run the agent
 */
async function main() {
	/* Create the signer using viem and parse the encryption key for the local db */
	const signer = createSigner(WALLET_KEY);
	const dbEncryptionKey = getEncryptionKeyFromHex(ENCRYPTION_KEY);

	const config: ClientOptions = {
		dbEncryptionKey,
		env: XMTP_ENV as XmtpEnv,
		// don't create local db files during development
		dbPath: IS_PRODUCTION ? undefined : null,
		codecs: [new ReactionCodec()],
		disableAutoRegister: true,
	};

	const client = await getOrCreateClient(signer, config);

	if (client.isRegistered) {
		await client.revokeAllOtherInstallations();
		console.log("Revoked all other installations");
	} else {
		await client.register();
		console.log("Registered client");
	}

	void logAgentDetails(client);

	/* Sync the conversations from the network to update the local db */
	await client.conversations.sync();

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

				const emoji = await generateText({
					model: openai("gpt-4.1-nano"),
					prompt: `Return only a single emoji that matches the sentiment of this message: ${messageString.substring(0, 100)}. Do not include any other text or explanation.`,
				});

				try {
					// Add a reaction to the received message
					const reaction = {
						reference: message.id,
						action: "added",
						content: emoji.text,
						schema: "unicode",
					};

					await conversation.send(reaction, ContentTypeReaction);

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
