import { openai } from "@ai-sdk/openai";
import {
	ContentTypeGroupUpdated,
	GroupUpdatedCodec,
} from "@xmtp/content-type-group-updated";
import {
	ContentTypeReaction,
	type Reaction,
	ReactionCodec,
} from "@xmtp/content-type-reaction";
import {
	ContentTypeReply,
	type Reply,
	ReplyCodec,
} from "@xmtp/content-type-reply";
import { ContentTypeText, TextCodec } from "@xmtp/content-type-text";
import {
	ContentTypeTransactionReference,
	TransactionReferenceCodec,
} from "@xmtp/content-type-transaction-reference";
import {
	ContentTypeWalletSendCalls,
	WalletSendCallsCodec,
	type WalletSendCallsParams,
} from "@xmtp/content-type-wallet-send-calls";
import {
	Client,
	ConsentState,
	type DecodedMessage,
	Dm,
	type ExtractCodecContentTypes,
	Group,
	LogLevel,
} from "@xmtp/node-sdk";
import { generateObject, generateText } from "ai";
import type { Address, Hex, Signature, TypedDataDomain } from "viem";
import z from "zod";
import { sendToAgent } from "@/helpers/bitte-client";
import {
	createSigner,
	extractMessageContent,
	getDbPath,
	getEncryptionKeyFromHex,
	logAgentDetails,
} from "@/helpers/client";
import {
	AGENT_CHAT_ID,
	ENCRYPTION_KEY,
	WALLET_KEY,
	XMTP_ENV,
} from "@/helpers/config";
// Import the transaction helpers
import { convertEvmTxToWalletSendCalls } from "@/helpers/transaction-helpers";

// [All your existing type definitions remain the same]
export interface TypedDataTypes {
	name: string;
	type: string;
}
export type TypedMessageTypes = {
	[key: string]: TypedDataTypes[];
};
export type EIP712TypedData = {
	domain: TypedDataDomain;
	types: TypedMessageTypes;
	message: Record<string, unknown>;
	primaryType: string;
};
export interface TransactionWithSignature {
	transaction: Hex;
	signature: Signature;
}
export interface EthTransactionParams {
	from: Hex;
	to: Hex;
	gas?: Hex;
	value?: Hex;
	data?: Hex;
}
export type PersonalSignParams = [Hex, Address];
export type EthSignParams = [Address, Hex];
export type TypedDataParams = [Hex, string];
export type SessionRequestParams =
	| EthTransactionParams[]
	| Hex
	| PersonalSignParams
	| EthSignParams
	| TypedDataParams;
export declare const signMethods: readonly [
	"eth_sign",
	"personal_sign",
	"eth_sendTransaction",
	"eth_signTypedData",
	"eth_signTypedData_v4",
];
export type SignMethod = (typeof signMethods)[number];
export type SignRequestData = {
	method: SignMethod;
	chainId: number;
	params: SessionRequestParams;
};
export type KeyPairString = `ed25519:${string}` | `secp256k1:${string}`;
export interface SetupConfig {
	accountId: string;
	mpcContractId: string;
	privateKey?: string;
	derivationPath?: string;
	rootPublicKey?: string;
}

// Type definitions for tool calls
interface ToolCallWithArgs {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
}

interface ToolCallWithResult {
	toolCallId: string;
	result: {
		data?:
			| ({ evmSignRequest: SignRequestData } & { ui?: Record<string, unknown> })
			| ({ swapArgs: SwapArgs } & { ui?: Record<string, unknown> });
		error?: string;
	};
	ui?: Record<string, unknown>;
}

type ToolCall = ToolCallWithArgs | ToolCallWithResult;

interface SwapArgs {
	sellToken: string;
	buyToken: string;
}

interface CompletionResponse {
	toolCalls?: ToolCall[];
	content: string;
	raw?: string;
	finishReason?: string;
	usage?: {
		promptTokens: number;
		completionTokens: number;
	} | null;
	isContinued?: boolean;
	isError?: boolean;
}
// [All your existing constants and helper functions remain the same]
export const generateReaction = async ({
	messageContent,
	reference,
	referenceInboxId,
}: {
	messageContent: string;
	reference: string;
	referenceInboxId?: string;
}): Promise<Reaction> => {
	const emoji = await generateText({
		model: openai("gpt-4.1-nano"),
		prompt: `Return only a single emoji that matches the sentiment of this message: ${messageContent}. Do not include any other text or explanation.`,
	});

	return {
		reference,
		action: "added",
		content: emoji.text,
		schema: "unicode",
		referenceInboxId,
	};
};

const CODECS = [
	new ReactionCodec(),
	new WalletSendCallsCodec(),
	new TransactionReferenceCodec(),
	new ReplyCodec(),
	new TextCodec(),
	new GroupUpdatedCodec(),
];

export type ClientContentTypes = ExtractCodecContentTypes<typeof CODECS>;

// Create the signer and client
const signer = createSigner(WALLET_KEY);
const dbEncryptionKey = getEncryptionKeyFromHex(ENCRYPTION_KEY);

const client = await Client.create(signer, {
	dbEncryptionKey,
	env: XMTP_ENV,
	dbPath: getDbPath(XMTP_ENV),
	codecs: CODECS,
	loggingLevel: LogLevel.error,
});

// Log agent details
void logAgentDetails(client);

// Retry configuration
const MAX_RETRIES = 5;
const RETRY_INTERVAL = 5000; // 5 seconds

let retries = MAX_RETRIES;

const retry = () => {
	console.log(`Retrying in ${RETRY_INTERVAL / 1000}s, ${retries} retries left`);
	if (retries > 0) {
		retries--;
		setTimeout(() => {
			handleStream();
		}, RETRY_INTERVAL);
	} else {
		console.log("Max retries reached, ending process");
		process.exit(1);
	}
};

const onFail = () => {
	console.log("Stream failed");
	retry();
};

// Main stream handling function
const handleStream = async () => {
	try {
		const clientIdentifier = await client.signer?.getIdentifier();
		const clientEvmAddress = clientIdentifier?.identifier;
		const clientInboxId = client.inboxId;

		await client.conversations.syncAll([ConsentState.Allowed]);
		console.log("Synced all conversations");

		const stream = await client.conversations.streamAllMessages({
			consentStates: [ConsentState.Allowed],
			onValue: undefined,
			onError: undefined,
			onFail,
		});

		console.log("Waiting for messages...");

		// Process messages from the stream
		for await (const message of stream) {
			try {
				// skip if the message is not valid
				if (!message || !message.contentType) continue;

				const senderInboxId = message.senderInboxId;

				// skip if the message is from the agent
				if (senderInboxId === clientInboxId) continue;

				// skip if the message is a reaction
				if (message.contentType.sameAs(ContentTypeReaction)) continue;

				const conversation = await client.conversations.getConversationById(
					message.conversationId,
				);
				// skip if the conversation is not found
				if (!conversation) {
					console.log(
						`Conversation with id ${message.conversationId} not found`,
					);
					continue;
				}

				// skip if message content is not valid
				const messageContent = extractMessageContent(message);
				console.log("Extracted message content:", {
					contentType: message.contentType?.typeId,
					content: messageContent,
					hasContent: !!messageContent,
					messageId: message.id,
				});
				if (!messageContent || messageContent === "") continue;

				const isDm = conversation instanceof Dm;
				const isGroup = conversation instanceof Group;
				const isSync = !isDm && !isGroup;

				console.log({
					isDm,
					isGroup,
					isSync,
					content: messageContent,
				});

				// Skip group update messages
				if (message.contentType.sameAs(ContentTypeGroupUpdated)) {
					continue;
				}

				// if is DM or Group message, handle the conversation
				if ((isDm || isGroup) && messageContent) {
					// Check if this is the agent's first message in the conversation
					const messages = await conversation.messages();
					// const hasAgentReplied = messages.some(
					// 	(msg) => msg.senderInboxId === clientInboxId,
					// );

					// TODO: fix welcome message
					// if (!hasAgentReplied) {
					// 	await conversation.send(WELCOME_MESSAGE, ContentTypeText);
					// 	continue; // Skip AI response generation for welcome messages
					// }

					// Helper functions for group chat filtering
					const isReplyToAgent = (message: DecodedMessage) => {
						if (!message.contentType?.sameAs(ContentTypeReply)) return false;
						const replyContent = message.content as Reply;
						return messages.some(
							(msg) =>
								msg.id === replyContent.reference &&
								msg.senderInboxId === clientInboxId,
						);
					};

					const isTaggingClient = (messageContent: string) => {
						const clientTags = [
							`@${clientEvmAddress}`,
							`@${AGENT_CHAT_ID}`,
							"@bitte",
						];
						return clientTags.some((tag) =>
							messageContent.toLowerCase().includes(tag.toLowerCase()),
						);
					};

					// Skip group messages with no mention or reply to client
					if (
						isGroup &&
						!isTaggingClient(messageContent) &&
						!isReplyToAgent(message)
					) {
						continue;
					}

					// if not a transaction reference message, generate a reaction
					if (!message.contentType.sameAs(ContentTypeTransactionReference)) {
						// Generate and send a reaction
						const reaction = await generateReaction({
							messageContent,
							reference: message.id,
							referenceInboxId: senderInboxId,
						});

						await conversation.send(reaction, ContentTypeReaction);
					}

					// Get sender's EVM address
					const inboxState = await client.preferences.inboxStateFromInboxIds([
						senderInboxId,
					]);
					const userAddress = inboxState?.[0]?.identifiers?.[0]?.identifier;

					const completion: CompletionResponse = await sendToAgent({
						chatId: `xmtp-${conversation.id}`,
						message: messageContent,
						evmAddress: userAddress,
						contextMessage: `This is a ${
							isGroup ? "group" : "DM"
						} chat from within The Base App using XMTP. The user's EVM address is ${userAddress}.
						
CRITICAL: Never send transaction data, signature requests, or permit2 data as plain text messages. 
Always return these as structured tool calls that can be converted to wallet_sendCalls format.
The UI needs properly formatted wallet_sendCalls to show transaction UX, not text descriptions.`,
					});

					// 2. Process tool calls, if any exist.
					if (completion.toolCalls && completion.toolCalls.length > 0) {
						// Filter for transaction-related tool calls only
						const transactionToolCalls = completion.toolCalls
							.map((toolCall) => {
								if ("result" in toolCall && toolCall.result?.data) {
									const data = toolCall.result.data;
									if (typeof data === "object" && data !== null) {
										// Check if this is transaction data (has evmSignRequest or swapArgs)
										const hasEvmSignRequest = "evmSignRequest" in data;
										const hasSwapArgs = "swapArgs" in data;

										if (hasEvmSignRequest || hasSwapArgs) {
											return data;
										}
									}
								}
								return null;
							})
							.filter((data) => data !== null);

						// Only proceed if we have actual transaction data
						if (transactionToolCalls.length > 0) {
							console.log(
								"📦 Received transaction data from agent:",
								JSON.stringify(transactionToolCalls, null, 2),
							);

							let walletSendCallsObject: WalletSendCallsParams | null = null;

							// Process each transaction tool call
							for (const txData of transactionToolCalls) {
								// Handle direct EVM sign requests (already formatted transactions)
								if ("evmSignRequest" in txData && txData.evmSignRequest) {
									try {
										const converted = await convertEvmTxToWalletSendCalls(
											txData as {
												evmSignRequest: SignRequestData;
												ui?: Record<string, unknown>;
											},
											userAddress as `0x${string}`,
										);
										walletSendCallsObject = converted;

										// Log what type of request this is
										const method = (txData.evmSignRequest as SignRequestData)
											.method;
										console.log(`📝 Processing ${method} request`);

										// For permit2 or typed data, ensure proper handling
										if (
											method === "eth_signTypedData_v4" ||
											method === "eth_signTypedData"
										) {
											console.log("🔐 Processing permit2/typed data signature");
										}
									} catch (error) {
										console.error("Failed to convert evmSignRequest:", error);
									}
								}

								// Handle swap data - need to build transactions
								else if ("swapArgs" in txData && txData.swapArgs) {
									const swapData = txData.swapArgs as SwapArgs;
									const _ui = txData.ui;

									console.log("🔄 Processing swap data:", swapData);

									// Generate the swap transaction using AI to properly format it
									const swapTxResult = await generateObject({
										model: openai("gpt-4o"),
										schema: z.object({
											version: z.string().default("1.0"),
											chainId: z
												.custom<`0x${string}`>(
													(val) =>
														typeof val === "string" &&
														/^0x[a-fA-F0-9]+$/.test(val),
													{ message: "Invalid chainId format" },
												)
												.default("0x2105" as `0x${string}`),
											from: z.custom<`0x${string}`>(
												(val) =>
													typeof val === "string" &&
													/^0x[a-fA-F0-9]{40}$/.test(val),
												{ message: "Invalid from address format" },
											),
											calls: z.array(
												z.object({
													to: z.custom<`0x${string}`>(
														(val) =>
															typeof val === "string" &&
															/^0x[a-fA-F0-9]{40}$/.test(val),
														{ message: "Invalid to address format" },
													),
													value: z
														.custom<`0x${string}`>(
															(val) =>
																typeof val === "string" &&
																/^0x[a-fA-F0-9]+$/.test(val),
															{ message: "Invalid value format" },
														)
														.optional()
														.default("0x0" as `0x${string}`),
													data: z
														.custom<`0x${string}`>(
															(val) =>
																typeof val === "string" &&
																/^0x[a-fA-F0-9]*$/.test(val),
															{ message: "Invalid data format" },
														)
														.optional()
														.default("0x" as `0x${string}`),
												}),
											),
										}),
										prompt: `
You are a DeFi transaction expert. Create a wallet_sendCalls object for a token swap on Base chain.

User's wallet address: ${userAddress}
Chain: Base (chainId: 0x2105)
Swap details: ${JSON.stringify(swapData)} 

IMPORTANT RULES:
1. The 'from' field MUST be the user's address: ${userAddress}
2. The 'chainId' MUST be '0x2105' (Base)
3. If the swap requires token approval (not ETH/native token), create TWO calls:
   - First call: Approve the router/DEX to spend sellToken
   - Second call: Execute the swap

Generate the complete wallet_sendCalls object with proper contract addresses and calldata.
                    `,
									});

									if (swapTxResult?.object) {
										walletSendCallsObject =
											swapTxResult.object as WalletSendCallsParams;

										// Check if we need to add an approval transaction
										// This is indicated by having multiple calls
										if (
											walletSendCallsObject &&
											walletSendCallsObject.calls.length > 1
										) {
											console.log("💳 Swap includes approval transaction");
										}
									}
								}
							}

							// Only send wallet_sendCalls if we successfully created one
							if (walletSendCallsObject) {
								console.log(
									"✅ Sending wallet_sendCalls to user:",
									JSON.stringify(walletSendCallsObject, null, 2),
								);
								await conversation.send(
									walletSendCallsObject,
									ContentTypeWalletSendCalls,
								);
							} else {
								console.log("⚠️ No valid transaction data to send");
							}
						}
					}

					// 5. Send the conversational text part ONLY if it's not transaction data

					const isTransactionReference = message?.contentType?.sameAs(
						ContentTypeTransactionReference,
					);

					// Check if the content contains transaction-related data that shouldn't be sent as text
					const containsTransactionData = (text: string): boolean => {
						const transactionIndicators = [
							"permit2",
							"signature request",
							"sign this",
							"verifyingcontract",
							"domain:",
							"message:",
							"nonce:",
							"deadline:",
							"0x000000000022d473030f116ddee9f6b43ac78ba3", // Permit2 contract
							"eth_signTypedData",
							"wallet_sendCalls",
							"transaction data",
							"please sign",
						];

						const lowerText = text.toLowerCase();
						return transactionIndicators.some((indicator) =>
							lowerText.includes(indicator.toLowerCase()),
						);
					};

					if (completion.content && !isTransactionReference) {
						// Only send as text if it doesn't contain transaction data
						if (!containsTransactionData(completion.content)) {
							if (isGroup) {
								const reply: Reply = {
									reference: message.id,
									contentType: ContentTypeText,
									content: completion.content,
								};
								await conversation.send(reply, ContentTypeReply);
							} else {
								await conversation.send(completion.content, ContentTypeText);
							}
						} else {
							// Log that we're blocking transaction data from being sent as text
							console.warn(
								"⚠️ Blocked sending transaction data as plain text. Agent should return this as tool calls.",
								{ contentPreview: completion.content.substring(0, 100) },
							);

							// Send an error message to the user
							const errorMessage =
								"I need to prepare a transaction for you. Please try your request again, and I'll format it properly for your wallet.";

							if (isGroup) {
								const reply: Reply = {
									reference: message.id,
									contentType: ContentTypeText,
									content: errorMessage,
								};
								await conversation.send(reply, ContentTypeReply);
							} else {
								await conversation.send(errorMessage, ContentTypeText);
							}
						}
					}
				}
			} catch (error) {
				console.error("❌ Error processing message:", error);
			}
		}
	} catch (error) {
		console.error("❌ Stream error:", error);
		onFail();
	}
};

// Start the stream handling
handleStream();
