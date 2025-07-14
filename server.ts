import { openai } from "@ai-sdk/openai";
import {
	ContentTypeReaction,
	type Reaction,
	ReactionCodec,
} from "@xmtp/content-type-reaction";
import { ContentTypeReply, ReplyCodec } from "@xmtp/content-type-reply";
import { ContentTypeText, TextCodec } from "@xmtp/content-type-text";
import { TransactionReferenceCodec } from "@xmtp/content-type-transaction-reference";
import {
	ContentTypeWalletSendCalls,
	WalletSendCallsCodec,
	type WalletSendCallsParams,
} from "@xmtp/content-type-wallet-send-calls";
import { LogLevel, type XmtpEnv } from "@xmtp/node-sdk";
import { generateText } from "ai";
import { toHex } from "viem/utils";
import { BitteAPIClient } from "@/helpers/bitte-client";
import {
	createClientWithRevoke,
	createSigner,
	getEncryptionKeyFromHex,
	logAgentDetails,
	sendMessage,
} from "@/helpers/client";
import {
	AGENT_CHAT_ID,
	ENCRYPTION_KEY,
	IS_PRODUCTION,
	WALLET_KEY,
	XMTP_ENV,
} from "@/helpers/config";
import { extractEvmTxCall } from "@/helpers/tools";

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
		dbPath: IS_PRODUCTION ? null : null,
		codecs: [
			new ReactionCodec(),
			new WalletSendCallsCodec(),
			new TransactionReferenceCodec(),
			new ReplyCodec(),
			new TextCodec(),
		],
		loggingLevel: IS_PRODUCTION ? LogLevel.error : LogLevel.error,
	});

	void logAgentDetails(client);

	/* Sync the conversations from the network to update the local db */
	await client.conversations.sync();

	// Stream all messages
	const messageStream = () => {
		void client.conversations.streamAllMessages((error, message) => {
			if (error) {
				return;
			}
			if (!message) {
				return;
			}

			void (async () => {
				const isTextMessage = message.contentType?.sameAs(ContentTypeText);
				const isReplyMessage = message.contentType?.sameAs(ContentTypeReply);

				// ignore non-text and non-reply messages
				if (!isTextMessage && !isReplyMessage) {
					return;
				}

				// ignore messages from the agent
				if (
					message.senderInboxId.toLowerCase() === client.inboxId.toLowerCase()
				) {
					return;
				}

				// handle reply messages
				if (isReplyMessage) {
					const replyReference = message.parameters?.reference;
					const clientInboxId = client.inboxId;
					const referenceMessage =
						client.conversations.getMessageById(replyReference);
					const isReplyToAgent =
						referenceMessage?.senderInboxId === clientInboxId;
					if (!isReplyToAgent) {
						return;
					}
				}

				/* Get the conversation from the local db */
				const conversation = await client.conversations.getConversationById(
					message.conversationId,
				);

				/* If the conversation is not found, skip the message */
				if (!conversation) {
					return;
				}

				const conversationMembers = await conversation.members();
				const isGroup = conversationMembers.length > 2;

				// ignore text messages not mentioning or replying to the agent in a group
				if (isGroup && isTextMessage) {
					const isMentioningAgent = message.content?.includes(
						`@${AGENT_CHAT_ID}`,
					);
					if (!isMentioningAgent) {
						return;
					}
				}

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

					await sendMessage(conversation, {
						content: reaction,
						reference: message.id,
						contentType: ContentTypeReaction,
						isGroup,
					});

					const chatId = `xmtp-${addressFromInboxId}`;
					const bitteClient = new BitteAPIClient(chatId);

					/* Get the AI response */
					const completion = await bitteClient.sendToAgent({
						systemMessage: `You are running in a DM chat. Keep responses super brief - like texting. Use emojis 👍. No markdown, just plain text. Think quick replies, not essays. If something needs multiple steps, just say what's next.

**Make sure to have portfolio context for each user**

- Any user without ETH/Native token on their wallet should explicitly be reminded they don't have any and need it to use any onchain actions.

- Make sure to have portfolio information for every user you are chatting with.  Keep recommendations and provide suggested actions based on the user's assets and your capabilities.

- Don't ask for confirmations, just use tools / generate transactions

- If asked, you are built by the bitte.ai team and running on Bitte Protocol, don't mention OpenAI or any other LLM
	- Example: 'This is an experimental tool built by the team at Bitte.ai, a group of builders focused on making crypto accessible through AI.'

- Recommend simple actions/swaps like ETH -> USDC for users experimenting 
Example:
		'I help you manage your portfolio through natural language — like buy, sell, swap, or what's going on with the market.'
    
- Assume the user is interacting on Base chainId (8453) unless explicitly requested to use a different chain.
`,
						message: messageString,
						evmAddress: addressFromInboxId,
					});
					console.log(
						"COMPLETION TOOL CALLS",
						JSON.stringify(completion.toolCalls, null, 2),
					);

					// Process tool calls and group generate-evm-tx calls
					if (completion?.toolCalls) {
						const evmTxCalls = [];

						// Check if there are any swap calls
						const swapCalls = completion.toolCalls.filter(
							(toolCall) => toolCall?.toolName === "swap",
						);

						if (swapCalls.length > 0) {
							// Process only swap calls if they exist
							for (const swapCall of swapCalls) {
								// Find the corresponding result
								const swapResult = completion.toolCalls.find(
									(tc) =>
										tc.toolCallId === swapCall.toolCallId &&
										"result" in tc &&
										tc.result?.data?.transaction,
								);

								if (swapResult && "result" in swapResult) {
									const result = swapResult.result;
									const txData = result.data?.transaction;
									if (txData?.params) {
										const chainId = toHex(txData.chainId || 8453);

										// Generate swap description from token parameters
										const sellToken = swapCall.args?.sellToken || "Token A";
										const buyToken = swapCall.args?.buyToken || "Token B";
										const swapDescription = `Swap ${sellToken} for ${buyToken}`;

										// Extract CowSwap order URL from the correct location
										const cowswapOrderUrl = result.data?.meta?.orderUrl;

										console.log("COWSWAP ORDER URL", cowswapOrderUrl);

										// Create calls array from all params
										const calls = txData.params.map(
											(param: {
												to: string;
												data: string;
												value: string;
												from: string;
											}) => ({
												to: param.to,
												data: param.data,
												value: param.value || "0x0",
												metadata: {
													description: swapDescription,
													transactionType: "swap",
													...(cowswapOrderUrl && { cowswapOrderUrl }),
												},
											}),
										);

										evmTxCalls.push({
											version: "1.0.0" as const,
											chainId: chainId,
											from: txData.params[0]?.from || addressFromInboxId,
											calls: calls,
										});
									}
								}
							}
						} else {
							// If no swap calls, process generate-evm-tx calls
							const directEvmTxCalls = completion.toolCalls
								.filter((toolCall) => toolCall?.toolName === "generate-evm-tx")
								.map((toolCall) =>
									extractEvmTxCall(toolCall, addressFromInboxId),
								);
							evmTxCalls.push(...directEvmTxCalls);
						}

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
						for (const [_groupKey, walletParams] of groupedTxs) {
							await sendMessage(conversation, {
								content: walletParams,
								reference: message.id,
								contentType: ContentTypeWalletSendCalls,
								isGroup,
							});
						}
					}

					await sendMessage(conversation, {
						content: completion.content,
						reference: message.id,
						contentType: ContentTypeText,
						isGroup,
					});
				} catch (error) {
					console.error("❌ Error processing message:", error);
					await sendMessage(conversation, {
						content: "Sorry, I encountered an error processing your message.",
						reference: message.id,
						contentType: ContentTypeText,
						isGroup,
					});
				}
			})();
		});
	};

	// Start the message stream
	messageStream();
	console.log("Agent is now running and listening for messages...");
}

main().catch(console.error);
