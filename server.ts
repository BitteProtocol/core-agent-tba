import { openai } from "@ai-sdk/openai";
import {
	ContentTypeReaction,
	type Reaction,
	ReactionCodec,
} from "@xmtp/content-type-reaction";
import { TransactionReferenceCodec } from "@xmtp/content-type-transaction-reference";
import {
	ContentTypeWalletSendCalls,
	WalletSendCallsCodec,
	type WalletSendCallsParams,
} from "@xmtp/content-type-wallet-send-calls";

import { LogLevel, type XmtpEnv } from "@xmtp/node-sdk";
import { generateText, type ToolInvocation } from "ai";
import { parseEther, toHex } from "viem";
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
		loggingLevel: IS_PRODUCTION ? LogLevel.error : LogLevel.error,
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
					prompt: `Return only a single emoji that matches the sentiment of this message: ${messageString}. Do not include any other text or explanation.`,
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

					const extractEvmTxCall = (toolCall: ToolInvocation) => {
						const params = toolCall?.args?.params || [];
						const chainId = toolCall?.args?.chainId;
						const chainIdHex = toHex(Number.parseInt(chainId || "8453"));
						const method = toolCall?.args?.method;

						// Extract all calls from the params array
						const calls = params.map(
							(param: {
								to?: string;
								data?: string;
								value?: string;
								gas?: string;
								from?: string;
							}) => {
								const valueParam = param?.value;
								const valueHex = valueParam?.startsWith("0x")
									? valueParam
									: toHex(parseEther(valueParam || "0"));

								return {
									to: param?.to,
									data: param?.data,
									value: valueHex,
									gas: param?.gas,
									metadata: {
										description: `bitte agent tx from xmtp`,
										transactionType: method || "transfer",
									},
								};
							},
						);

						// Get the 'from' address from the first param or use default
						const fromParam = params[0]?.from;

						return {
							version: "1.0.0",
							chainId: chainIdHex,
							from: fromParam || addressFromInboxId,
							calls: calls,
						} as const;
					};

					// Process tool calls and group generate-evm-tx calls
					if (completion?.toolCalls) {
						console.log(
							"completion.toolCalls",
							JSON.stringify(completion.toolCalls, null, 2),
						);
						// First, collect all generate-evm-tx calls
						const evmTxCalls = completion.toolCalls
							.filter((toolCall) => toolCall?.toolName === "generate-evm-tx")
							.map(extractEvmTxCall);

						// Group by chainId, from, and version
						const groupedTxs = new Map<string, WalletSendCallsParams>();

						for (const txCall of evmTxCalls) {
							const groupKey = `${txCall.chainId}-${txCall.from}-${txCall.version}`;

							if (groupedTxs.has(groupKey)) {
								// Add to existing group
								const existingGroup = groupedTxs.get(groupKey);
								if (existingGroup) {
									existingGroup.calls.push(...txCall.calls);
								}
							} else {
								// Create new group
								groupedTxs.set(groupKey, {
									version: txCall.version,
									chainId: txCall.chainId,
									from: txCall.from,
									calls: txCall.calls,
								});
							}
						}

						// Send each grouped transaction
						for (const [groupKey, walletParams] of groupedTxs) {
							console.log(
								`sending grouped tx params for ${groupKey}:`,
								walletParams,
							);
							await conversation.send(walletParams, ContentTypeWalletSendCalls);
						}
					}

					// send the final response
					await conversation.send(completion.content);
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
