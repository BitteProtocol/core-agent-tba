import { openai } from "@ai-sdk/openai";
import {
	ContentTypeReaction,
	type Reaction,
	ReactionCodec,
} from "@xmtp/content-type-reaction";
import { TransactionReferenceCodec } from "@xmtp/content-type-transaction-reference";
import { WalletSendCallsCodec } from "@xmtp/content-type-wallet-send-calls";
import { LogLevel, type XmtpEnv } from "@xmtp/node-sdk";
import { generateText } from "ai";
import { BitteAPIClient } from "@/helpers/bitte-client";
import {
	createClientWithRevoke,
	createSigner,
	getEncryptionKeyFromHex,
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

	const client = await createClientWithRevoke(signer, {
		dbEncryptionKey,
		env: XMTP_ENV as XmtpEnv,
		// don't create local db files during development
		dbPath: IS_PRODUCTION ? undefined : null,
		codecs: [
			new ReactionCodec(),
			new WalletSendCallsCodec(),
			new TransactionReferenceCodec(),
		],
		loggingLevel: LogLevel.debug,
	});

	void logAgentDetails(client);

	/* Sync the conversations from the network to update the local db */
	await client.conversations.sync();

	// Stream all messages
	const messageStream = () => {
		console.log("Starting message stream");
		void client.conversations.streamAllMessages((error, message) => {
			console.log("Message received", message);
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
				console.log("Message received", message.content);
				/* Get the conversation from the local db */
				const conversation = await client.conversations.getConversationById(
					message.conversationId,
				);

				/* If the conversation is not found, skip the message */
				if (!conversation) {
					console.error("Conversation not found", message.conversationId);
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
					const reaction: Reaction = {
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
