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
	console.log("🚀 Starting XMTP agent...");
	console.log("📋 Environment:", IS_PRODUCTION ? "PRODUCTION" : "DEVELOPMENT");
	console.log("🌐 XMTP Environment:", XMTP_ENV);
	console.log("💬 Agent Chat ID:", AGENT_CHAT_ID);

	/* Create the signer using viem and parse the encryption key for the local db */
	console.log("🔑 Creating signer and encryption key...");
	const signer = createSigner(WALLET_KEY);
	const dbEncryptionKey = getEncryptionKeyFromHex(ENCRYPTION_KEY);
	console.log("✅ Signer created successfully");

	console.log("📡 Creating XMTP client...");
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
	console.log("✅ XMTP client created successfully");
	console.log("📧 Client inbox ID:", client.inboxId);

	void logAgentDetails(client);

	/* Sync the conversations from the network to update the local db */
	console.log("🔄 Syncing conversations...");
	await client.conversations.sync();
	console.log("✅ Conversations synced successfully");

	// Stream all messages
	const messageStream = () => {
		console.log("📨 Starting message stream...");
		void client.conversations.streamAllMessages((error, message) => {
			if (error) {
				console.error("❌ Error in message stream:", error);
				return;
			}
			if (!message) {
				console.log("⚠️ Received empty message, skipping");
				return;
			}

			void (async () => {
				console.log("📩 New message received:");
				console.log("   - Message ID:", message.id);
				console.log("   - Conversation ID:", message.conversationId);
				console.log("   - Sender Inbox ID:", message.senderInboxId);
				console.log("   - Content Type:", message.contentType?.typeId);
				console.log(
					"   - Content:",
					typeof message.content === "string"
						? message.content
						: JSON.stringify(message.content),
				);

				const isTextMessage = message.contentType?.sameAs(ContentTypeText);
				const isReplyMessage = message.contentType?.sameAs(ContentTypeReply);

				// ignore non-text and non-reply messages
				if (!isTextMessage && !isReplyMessage) {
					console.log(
						"Non-text and non-reply message",
						JSON.stringify(message, null, 2),
					);
					return;
				}

				// ignore messages from the agent
				if (
					message.senderInboxId.toLowerCase() === client.inboxId.toLowerCase()
				) {
					console.log(
						"message from agent itself",
						JSON.stringify(message, null, 2),
					);
					return;
				}

				// handle reply messages
				if (isReplyMessage) {
					console.log("🔄 Processing reply message");
					const replyReference = message.parameters?.reference;
					const clientInboxId = client.inboxId;
					const referenceMessage =
						client.conversations.getMessageById(replyReference);
					const isReplyToAgent =
						referenceMessage?.senderInboxId === clientInboxId;
					console.log("   - Reply reference:", replyReference);
					console.log("   - Is reply to agent:", isReplyToAgent);
					if (!isReplyToAgent) {
						console.log("⏭️ Reply is not to agent, skipping");
						return;
					}
				}

				/* Get the conversation from the local db */
				console.log("🔍 Getting conversation from local db...");
				const conversation = await client.conversations.getConversationById(
					message.conversationId,
				);

				/* If the conversation is not found, skip the message */
				if (!conversation) {
					console.error("❌ Conversation not found:", message.conversationId);
					return;
				}
				console.log("✅ Conversation found");

				const conversationMembers = await conversation.members();
				const isGroup = conversationMembers.length > 2;
				console.log("👥 Conversation members:", conversationMembers.length);
				console.log("   - Is group:", isGroup);

				// ignore text messages not mentioning or replying to the agent in a group
				if (isGroup && isTextMessage) {
					console.log("🔍 Checking if agent is mentioned in group message...");
					const isMentioningAgent = message.content?.includes(
						`@${AGENT_CHAT_ID}`,
					);
					console.log("   - Agent mentioned:", isMentioningAgent);
					if (!isMentioningAgent) {
						console.log("⏭️ Agent not mentioned in group message, skipping");
						return;
					}
				}

				console.log("🔍 Getting inbox state for sender...");
				const inboxState = await client.preferences.inboxStateFromInboxIds([
					message.senderInboxId,
				]);
				const addressFromInboxId = inboxState[0].identifiers[0].identifier;
				console.log("   - Sender address:", addressFromInboxId);

				const messageString =
					typeof message.content === "string"
						? message.content
						: JSON.stringify(message.content);

				console.log("😊 Generating emoji reaction...");
				const emoji = await generateText({
					model: openai("gpt-4.1-nano"),
					prompt: `Return only a single emoji that matches the sentiment of this message: ${messageString}. Do not include any other text or explanation.`,
				});
				console.log("   - Generated emoji:", emoji.text);

				try {
					// Add a reaction to the received message
					console.log("⚡ Sending reaction...");
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
					console.log("✅ Reaction sent successfully");

					const chatId = `xmtp-${addressFromInboxId}`;
					console.log("🤖 Creating Bitte API client for chat ID:", chatId);
					const bitteClient = new BitteAPIClient(chatId);

					/* Get the AI response */
					console.log("🧠 Sending message to AI agent...");
					const completion = await bitteClient.sendToAgent({
						systemMessage: `You are running in a DM chat. Keep responses super brief - like texting. Use emojis 👍. No markdown, just plain text. Think quick replies, not essays. If something needs multiple steps, just say what's next.

- **IMPORTANT** ALWAYS USE 'generate-evm-tx' tool to render transactions, especially after the 'swap' tool.

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

					console.log("ENTIRE COMPLETION", JSON.stringify(completion, null, 2));
					// Process tool calls and group generate-evm-tx calls
					if (completion?.toolCalls) {
						// First, collect all generate-evm-tx calls
						const evmTxCalls = completion.toolCalls
							.filter((toolCall) => toolCall?.toolName === "generate-evm-tx")
							.map((toolCall) =>
								extractEvmTxCall(toolCall, addressFromInboxId),
							);

						// If no generate-evm-tx calls found, look for swap calls
						if (evmTxCalls.length === 0) {
							console.log(
								"🔄 No generate-evm-tx calls found, checking for swap calls...",
							);

							// Find swap tool calls and their results
							const swapCalls = completion.toolCalls.filter(
								(toolCall) => toolCall?.toolName === "swap",
							);

							if (swapCalls.length > 0) {
								console.log(`   - Found ${swapCalls.length} swap calls`);

								// Process each swap call
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
										if (txData) {
											console.log(
												"   - Processing swap transaction:",
												txData.method,
											);

											// Extract transaction parameters
											const params = txData.params?.[0];
											if (params) {
												const chainId = toHex(txData.chainId || 8453);

												// Generate swap description from token parameters
												const sellToken = swapCall.args?.sellToken || "Token A";
												const buyToken = swapCall.args?.buyToken || "Token B";
												const swapDescription = `Swap ${sellToken} for ${buyToken}`;

												// Extract CowSwap order URL if available
												const cowswapOrderUrl =
													result.data?.orderUrl || result.data?.cowswapOrderUrl;

												const txCall = {
													version: "1.0.0" as const,
													chainId: chainId,
													from: params.from || addressFromInboxId,
													calls: [
														{
															to: params.to,
															data: params.data,
															value: params.value || "0x0",
															metadata: {
																description: swapDescription,
																transactionType: "swap",
																...(cowswapOrderUrl && { cowswapOrderUrl }),
															},
														},
													],
												};
												evmTxCalls.push(txCall);
												console.log("   - Converted swap to transaction call");
											}
										}
									}
								}
							}
						}

						// Group by chainId, from, and version
						const groupedTxs = new Map<string, WalletSendCallsParams>();

						for (const txCall of evmTxCalls) {
							const groupKey = `${txCall.chainId}-${txCall.from}-${txCall.version}`;
							console.log(
								"   - Processing transaction for group key:",
								groupKey,
							);

							if (groupedTxs.has(groupKey)) {
								// Add to existing group
								const existingGroup = groupedTxs.get(groupKey);
								if (existingGroup) {
									existingGroup.calls.push(...txCall.calls);
									console.log(
										"   - Added to existing group, total calls:",
										existingGroup.calls.length,
									);
								}
							} else {
								// Create new group
								groupedTxs.set(groupKey, {
									version: txCall.version,
									chainId: txCall.chainId,
									from: txCall.from,
									calls: txCall.calls,
								});
								console.log(
									"   - Created new group with calls:",
									txCall.calls.length,
								);
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

					console.log("📤 Sending AI response message...");
					await sendMessage(conversation, {
						content: completion.content,
						reference: message.id,
						contentType: ContentTypeText,
						isGroup,
					});
					console.log("✅ AI response message sent successfully");
				} catch (error) {
					console.error("❌ Error getting AI response:", error);
					console.log("📤 Sending error message to user...");
					await sendMessage(conversation, {
						content: "Sorry, I encountered an error processing your message.",
						reference: message.id,
						contentType: ContentTypeText,
						isGroup,
					});
					console.log("✅ Error message sent to user");
				}
			})();
		});
	};

	// Start the message stream
	messageStream();
	console.log("✅ Agent is now running and listening for messages");
}

main().catch(console.error);
