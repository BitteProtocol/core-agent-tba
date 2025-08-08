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
import { generateText } from "ai";
import type { Address, Hex, Signature, TypedDataDomain } from "viem";
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
			| ({ evmSignRequest: EvmSignRequest } & { ui?: Record<string, unknown> })
			| ({ swapArgs: SwapArgs } & { ui?: Record<string, unknown> });
		error?: string;
	};
	ui?: Record<string, unknown>;
}

type ToolCall = ToolCallWithArgs | ToolCallWithResult;

interface EvmSignRequest {
	method: string;
	chainId: number;
	params: SessionRequestParams;
	meta?: {
		orderUrl?: string;
	};
}

interface SwapArgs {
	sellToken: string;
	buyToken: string;
}

// interface SwapResult {
// 	data: {
// 		transaction: {
// 			chainId: number;
// 			params: Array<{
// 				to: string;
// 				data: string;
// 				value: string;
// 				from: string;
// 			}>;
// 		};
// 		meta?: {
// 			orderUrl?: string;
// 		};
// 	};
// }

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

export const WELCOME_MESSAGE = `
👋 Hey, I'm Bitte DeFi Agent!

I help you:
💰 Check balances across all your wallets
📤 Transfer tokens to Basenames, ENS, ETH addresses
🔄 Swap tokens with CowSwap (MEV protected)
🔗 Multi-chain support - Base, Ethereum, Arbitrum & more

Simply type:
→ "What tokens do I have?"
→ "Swap 10 USDC for ZORA on Base"
→ "Send 0.0001 ETH to bitte.base.eth on Base"

Powered by Bitte.ai`.trim();

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

				console.log("Received message", message);

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
					const hasAgentReplied = messages.some(
						(msg) => msg.senderInboxId === clientInboxId,
					);

					// Send welcome message if it's the agent's first interaction
					if (!hasAgentReplied) {
						await conversation.send(WELCOME_MESSAGE, ContentTypeText);
						continue; // Skip AI response generation for welcome messages
					}

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
					const addressFromInboxId =
						inboxState?.[0]?.identifiers?.[0]?.identifier;

					const chatId = `xmtp-${conversation.id}`;

					// Get AI response
					const completion: CompletionResponse = await sendToAgent({
						chatId,
						message: messageContent,
						evmAddress: addressFromInboxId,
						instructionsOverride: `This is a ${isGroup ? "group" : "DM"} chat from The Base App (wallet) using XMTP. Keep responses brief when possible. Use plain text, with
            occasional emojis. No links, no markdown, no html formatting. Here is your welcome message / persona that has already been sent to the user: ${WELCOME_MESSAGE}.  

The user's EVM address is ${addressFromInboxId}.

** Important Rules **

- ALWAYS fetch the user's portfolio for context & for up to date information.

- Remember the active chain - default to BASE (chainId: 8453). Only change the active chain for the following reasons:
  - User has no assets on the current chain
  - User asked for a specific chain in their prompt
  - A tool has failed due to the wrong chainId

These are the only supported chains for CowSwap orders:
Ethereum (chainId: 1), Gnosis (chainId: 100), Polygon (chainId: 137), Arbitrum (chainId: 42161), Base (chainId: 8453), Avalanche (chainId: 43114), and Sepolia (chainId: 11155111)

- Your are an agent built by the Bitte Protocol Team (Bitte.ai). Do not mention OpenAI or any other LLMs.

TOOLS:
Use as many tool calls as possible to fulfill the user's requests.  

- Get portfolio information with "get-portfolio".
- Fetch quotes and transaction payloads with "swap" tool, then use "generate-evm-tx" to process and show the transaction requests.
- Use "generate-evm-tx" EVERYTIME AFTER performing swaps, transfers, and basic transactions.

** CRITICAL FOR TOKEN TRANSFERS **
When generating ERC20 token transfers:
- The "to" field MUST be the TOKEN CONTRACT ADDRESS, not the recipient address
- The recipient address goes in the transfer function data
- For native ETH transfers, the "to" field is the recipient and value contains the amount
- ALWAYS verify you have the correct token contract address before generating the transaction
- If unsure about token contract address, fetch it from the user's portfolio first
- Provide order URLs for cowswap orders (as plain text not markdown! i.e. "https://explorer.cow.fi/orders/{orderId}") and use 'generate-evm-tx' after all swap toolcalls.`,
					});

					const completionContent = completion?.content;
					if (completionContent) {
						console.log("Bitte Completion Content", completionContent);
					}

					// Handle tool calls and transaction references
					if (completion.toolCalls && completion.toolCalls.length > 0) {
						for (const toolCall of completion.toolCalls) {
							if ("result" in toolCall && toolCall.result?.data) {
								const data = toolCall.result.data;

								// Only process if data is an object (not string, number, etc.)
								if (typeof data === "object" && data !== null) {
									// Handle EVM sign requests
									if ("evmSignRequest" in data && data.evmSignRequest) {
										const signRequest = data.evmSignRequest;

										console.log("Processing EVM sign request:", {
											method: signRequest.method,
											chainId: signRequest.chainId,
											paramsLength: Array.isArray(signRequest.params)
												? signRequest.params.length
												: 0,
										});

										// For eth_signTypedData_v4, params are [address, typedDataJson]
										if (signRequest.method === "eth_signTypedData_v4") {
											console.log(
												"SIGN REQUEST",
												JSON.stringify(signRequest, null, 2),
											);

											// Convert typed data signing to wallet send calls
											if (
												Array.isArray(signRequest.params) &&
												signRequest.params.length >= 2
											) {
												try {
													const typedDataJson = signRequest.params[1] as string;
													const typedData = JSON.parse(typedDataJson);

													// Extract verifying contract from domain as the target address
													const verifyingContract =
														typedData.domain?.verifyingContract;

													if (verifyingContract) {
														console.log("VERIFING CONTRACT", verifyingContract);
														const walletSendCalls: WalletSendCallsParams = {
															version: "1.0",
															from: addressFromInboxId as `0x${string}`,
															chainId: `0x${signRequest.chainId.toString(16)}`,
															calls: [
																{
																	to: verifyingContract,
																	data: "0x", // Typed data signing doesn't have transaction data
																	value: "0x0", // No value for signature operations
																},
															],
														};

														console.log(
															"Sending wallet send calls for eth_signTypedData_v4:",
															walletSendCalls,
														);
														try {
															await conversation.send(
																walletSendCalls,
																ContentTypeWalletSendCalls,
															);
															console.log(
																"✅ Wallet send calls sent successfully for typed data",
															);
														} catch (error) {
															console.error(
																"❌ Failed to send wallet send calls for typed data:",
																error,
															);
														}
													} else {
														console.log(
															"No verifying contract found in typed data, skipping wallet send calls",
														);
													}
												} catch (error) {
													console.error(
														"❌ Failed to parse typed data:",
														error,
													);
												}
											}
											continue;
										}

										// For transaction methods like eth_sendTransaction
										if (
											Array.isArray(signRequest.params) &&
											signRequest.params.length > 0 &&
											typeof signRequest.params[0] === "object" &&
											"to" in signRequest.params[0]
										) {
											const walletSendCalls: WalletSendCallsParams = {
												version: "1.0",
												from: addressFromInboxId as `0x${string}`,
												chainId: `0x${signRequest.chainId.toString(16)}`,
												calls: (
													signRequest.params as EthTransactionParams[]
												).map((param) => {
													console.log("PARAM", param);
													return {
														to: param.to as `0x${string}`,
														data: param.data || "0x",
														value: param.value || "0x0",
													};
												}),
											};

											console.log(
												"Sending wallet send calls:",
												walletSendCalls,
											);
											try {
												await conversation.send(
													walletSendCalls,
													ContentTypeWalletSendCalls,
												);
											} catch (error) {
												console.error(
													"❌ Failed to send wallet send calls:",
													error,
												);
											}
										}
									}
								}
								// Silently ignore other data types (strings, numbers, etc.)
							}
						}
					}

					// Send AI response as a reply (ignore transaction references)
					if (
						completion.content &&
						!message.contentType.sameAs(ContentTypeTransactionReference)
					) {
						const reply: Reply = {
							reference: message.id,
							contentType: ContentTypeText,
							content: completion.content,
						};

						await conversation.send(reply, ContentTypeReply);
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
