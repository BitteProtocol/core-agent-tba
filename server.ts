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
import { type Reply, ReplyCodec } from "@xmtp/content-type-reply";
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
	type DecodedMessage,
	Dm,
	type ExtractCodecContentTypes,
	Group,
	LogLevel,
} from "@xmtp/node-sdk";
import { generateText } from "ai";
import type { Address, Hex, Signature, TypedDataDomain } from "viem";
import { toHex } from "viem/utils";
import { sendToAgent } from "@/helpers/bitte-client";
import {
	createSigner,
	extractMessageContent,
	getDbPath,
	getEncryptionKeyFromHex,
	logAgentDetails,
	sendMessage,
} from "@/helpers/client";
import {
	AGENT_CHAT_ID,
	ENCRYPTION_KEY,
	WALLET_KEY,
	XMTP_ENV,
} from "@/helpers/config";

export interface TypedDataTypes {
	name: string;
	type: string;
}
export type TypedMessageTypes = {
	[key: string]: TypedDataTypes[];
};
/** Represents the data for a typed message */
export type EIP712TypedData = {
	/** The domain of the message */
	domain: TypedDataDomain;
	/** The types of the message */
	types: TypedMessageTypes;
	/** The message itself */
	message: Record<string, unknown>;
	/** The primary type of the message */
	primaryType: string;
};
/** Sufficient data required to construct a signed Ethereum Transaction */
export interface TransactionWithSignature {
	/** Unsigned Ethereum transaction data */
	transaction: Hex;
	/** Representation of the transaction's signature */
	signature: Signature;
}
/** Interface representing the parameters required for an Ethereum transaction */
export interface EthTransactionParams {
	/** The sender's Ethereum address in hexadecimal format */
	from: Hex;
	/** The recipient's Ethereum address in hexadecimal format */
	to: Hex;
	/** Optional gas limit for the transaction in hexadecimal format */
	gas?: Hex;
	/** Optional amount of Ether to send in hexadecimal format */
	value?: Hex;
	/** Optional data payload for the transaction in hexadecimal format, often used for contract interactions */
	data?: Hex;
}
/**
 * Parameters for a personal_sign request
 * Tuple of [message: Hex, signer: Address]
 */
export type PersonalSignParams = [Hex, Address];
/**
 * Parameters for an eth_sign request
 * Tuple of [signer: Address, message: Hex]
 */
export type EthSignParams = [Address, Hex];
/**
 * Parameters for signing complex structured data (like EIP-712)
 * Tuple of [signer: Hex, structuredData: string]
 */
export type TypedDataParams = [Hex, string];
/** Type representing the possible request parameters for a signing session */
export type SessionRequestParams =
	| EthTransactionParams[]
	| Hex
	| PersonalSignParams
	| EthSignParams
	| TypedDataParams;
/** An array of supported signing methods */
export declare const signMethods: readonly [
	"eth_sign",
	"personal_sign",
	"eth_sendTransaction",
	"eth_signTypedData",
	"eth_signTypedData_v4",
];
/** Type representing one of the supported signing methods */
export type SignMethod = (typeof signMethods)[number];
/** Interface representing the data required for a signature request */
export type SignRequestData = {
	/** The signing method to be used */
	method: SignMethod;
	/** The ID of the Ethereum chain where the transaction or signing is taking place */
	chainId: number;
	/** The parameters required for the signing request, which vary depending on the method */
	params: SessionRequestParams;
};
/** Template literal type for NEAR key pair strings */
export type KeyPairString = `ed25519:${string}` | `secp256k1:${string}`;
/**
 * Configuration for setting up the adapter
 */
export interface SetupConfig {
	/** The NEAR account ID */
	accountId: string;
	/** The MPC contract ID */
	mpcContractId: string;
	/** The NEAR network configuration */
	/** The private key for the account */
	privateKey?: string;
	/** The derivation path for the Ethereum account. Defaults to "ethereum,1" */
	derivationPath?: string;
	/** The root public key for the account. If not available it will be fetched from the MPC contract */
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
}

type ToolCall = ToolCallWithArgs | ToolCallWithResult;

interface EvmSignRequest {
	method: string;
	chainId: number;
	params: Array<{
		to: string;
		data: string;
		value: string;
		from: string;
	}>;
	meta?: {
		orderUrl?: string;
	};
}

interface SwapArgs {
	sellToken: string;
	buyToken: string;
	// Add other swap-specific args as needed
}

interface SwapResult {
	data: {
		transaction: {
			chainId: number;
			params: Array<{
				to: string;
				data: string;
				value: string;
				from: string;
			}>;
		};
		meta?: {
			orderUrl?: string;
		};
	};
}

interface CompletionResponse {
	toolCalls?: ToolCall[];
	content: string;
	raw?: string;
	finishReason?: string;
	usage?: {
		promptTokens: number;
		completionTokens: number;
	};
	isContinued?: boolean;
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

interface EvmSignRequest {
	method: string;
	chainId: number;
	params: Array<{
		to: string;
		data: string;
		value: string;
		from: string;
	}>;
}

interface SwapArgs {
	sellToken: string;
	buyToken: string;
	// Add other swap-specific args as needed
}

// Example tool call response from the actual API
const _EXAMPLE_TOOL_CALL_RESPONSE: CompletionResponse = {
	toolCalls: [
		{
			toolCallId: "call_saJel2W4p3cbkYeChZpDky8k",
			toolName: "generate-evm-tx",
			args: {
				method: "eth_sendTransaction",
				chainId: 8453,
				params: [
					{
						to: "0x42e9c498135431a48796B5fFe2CBC3d7A1811927",
						data: "0x",
						value: "0.00035",
						from: "0x68e08371d1d0311b7c81961c431d71f71a94dd1a",
					},
				],
				meta: {
					ui: {},
				},
			},
		},
		{
			toolCallId: "call_saJel2W4p3cbkYeChZpDky8k",
			result: {
				data: {
					evmSignRequest: {
						method: "eth_sendTransaction",
						chainId: 8453,
						params: [
							{
								to: "0x42e9c498135431a48796B5fFe2CBC3d7A1811927",
								data: "0x",
								value: "0x13e52b9abe000",
								from: "0x68e08371d1d0311b7c81961c431d71f71a94dd1a",
							},
						],
					},
					ui: {},
				},
			},
		},
	],
	content:
		"Transaction is ready once more! Please check your wallet and sign to send 0.00035 ETH to soko.base.eth.\n\nIf you're having trouble signing, let me know—happy to help troubleshoot or suggest another way to send. What would you like to do next?",
	raw: 'f:{"messageId":"msg-an3i2pIjuoemIo9nRHY41KKQ"}\n9:{"toolCallId":"call_saJel2W4p3cbkYeChZpDky8k","toolName":"generate-evm-tx","args":{"method":"eth_sendTransaction","chainId":8453,"params":[{"to":"0x42e9c498135431a48796B5fFe2CBC3d7A1811927","data":"0x","value":"0.00035","from":"0x68e08371d1d0311b7c81961c431d71f71a94dd1a"}],"meta":{"ui":{}}}}\na:{"toolCallId":"call_saJel2W4p3cbkYeChZpDky8k","result":{"data":{"evmSignRequest":{"method":"eth_sendTransaction","chainId":8453,"params":[{"to":"0x42e9c498135431a48796B5fFe2CBC3d7A1811927","data":"0x","value":"0x13e52b9abe000","from":"0x68e08371d1d0311b7c81961c431d71f71a94dd1a"}]},"ui":{}}}}\ne:{"finishReason":"tool-calls","usage":{"promptTokens":4602,"completionTokens":107},"isContinued":false}\nf:{"messageId":"msg-IdCfb6DvO1UqVCIr4KzrfiYC"}\n0:"Transaction"\n0:" is"\n0:" ready"\n0:" once"\n0:" more"\n0:"!"\n0:" Please"\n0:" check"\n0:" your"\n0:" wallet"\n0:" and"\n0:" sign"\n0:" to"\n0:" send"\n0:" "\n0:"0"\n0:"."\n0:"000"\n0:"35"\n0:" ETH"\n0:" to"\n0:" s"\n0:"oko"\n0:".base"\n0:".eth"\n0:".\\n\\n"\n0:"If"\n0:" you"\n0:"\'re"\n0:" having"\n0:" trouble"\n0:" signing"\n0:","\n0:" let"\n0:" me"\n0:" know"\n0:"—"\n0:"happy"\n0:" to"\n0:" help"\n0:" troubleshoot"\n0:" or"\n0:" suggest"\n0:" another"\n0:" way"\n0:" to"\n0:" send"\n0:"."\n0:" What"\n0:" would"\n0:" you"\n0:" like"\n0:" to"\n0:" do"\n0:" next"\n0:"?"\ne:{"finishReason":"stop","usage":{"promptTokens":4826,"completionTokens":57},"isContinued":false}\nd:{"finishReason":"stop","usage":{"promptTokens":9428,"completionTokens":164}}\n',
};

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

// Welcome message for new groups
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

/* Create the signer using viem and parse the encryption key for the local db */

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

await client.conversations.sync();

const MAX_RETRIES = 5;
// wait 5 seconds before each retry
const RETRY_INTERVAL = 5000;

let retries = MAX_RETRIES;

const retry = (handleStream: () => Promise<void>) => {
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
	retry(handleStream);
};

const clientIdentifier = await client.signer?.getIdentifier();
const clientEvmAddress = clientIdentifier?.identifier;

// stream all messages from all conversations
const stream = await client.conversations.streamAllMessages(
	undefined,
	undefined,
	undefined,
	onFail,
);

for await (const message of stream) {
	// skip if the message is not valid
	if (!message || !message.contentType) continue;

	const senderInboxId = message.senderInboxId;
	const clientInboxId = client.inboxId;

	// skip if the message is from the agent
	if (senderInboxId === clientInboxId) continue;

	// skip if the message is a reaction
	if (message.contentType.sameAs(ContentTypeReaction)) continue;

	const conversation = await client.conversations.getConversationById(
		message.conversationId,
	);
	// skip if the conversation is not found
	if (!conversation) continue;

	// skip if message content is not valid
	const messageContent = extractMessageContent(message);
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

	// skip extra events for now
	if (message.contentType.sameAs(ContentTypeTransactionReference)) {
		continue;
	}
	if (message.contentType.sameAs(ContentTypeGroupUpdated)) {
		continue;
	}

	// handle welcome message for new users
	if (isDm || isGroup) {
		const conversationMessages = await conversation.messages();
		const hasClientSentMessage = conversationMessages.some(
			(message) =>
				message.senderInboxId.toLowerCase() === clientInboxId.toLowerCase(),
		);

		// send welcome message if the client has not sent a message in this conversation
		if (!hasClientSentMessage) {
			const reaction = await generateReaction({
				messageContent,
				reference: message.id,
				referenceInboxId: senderInboxId,
			});

			await sendMessage(conversation, {
				content: reaction,
				reference: message.id,
				contentType: ContentTypeReaction,
				referenceInboxId: senderInboxId,
				isGroup,
			});

			const welcomeReply: Reply = {
				reference: message.id,
				content: WELCOME_MESSAGE,
				contentType: ContentTypeText,
				referenceInboxId: senderInboxId,
			};

			await sendMessage(conversation, {
				content: welcomeReply,
				reference: message.id,
				contentType: ContentTypeText,
				referenceInboxId: senderInboxId,
				isGroup,
			});
		}
	}

	const isReplyToAgent = (message: DecodedMessage) => {
		const replyContent = message.content as Reply;
		const referenceMessage = client.conversations.getMessageById(
			replyContent.reference,
		);
		return referenceMessage?.senderInboxId === clientInboxId;
	};

	const isTaggingClient = (messageContent: string) => {
		const clientTags = [`@${clientEvmAddress}`, `@${AGENT_CHAT_ID}`, "@bitte"];
		return clientTags.some((tag) =>
			messageContent.toLowerCase().includes(tag.toLowerCase()),
		);
	};

	// skip group messages with no mention or reply to client
	if (isGroup && !isTaggingClient(messageContent) && !isReplyToAgent(message))
		continue;

	const reaction = await generateReaction({
		messageContent,
		reference: message.id,
		referenceInboxId: senderInboxId,
	});

	// Add a reaction to the received message
	await sendMessage(conversation, {
		content: reaction,
		reference: message.id,
		contentType: ContentTypeReaction,
		referenceInboxId: senderInboxId,
		isGroup,
	});

	const chatId = `xmtp-${conversation.id}`;
	console.log("CHAT ID", chatId);

	const inboxState = await client.preferences.inboxStateFromInboxIds([
		senderInboxId,
	]);
	const addressFromInboxId = inboxState?.[0]?.identifiers?.[0]?.identifier;

	/* Get the AI response */
	const completion: CompletionResponse = await sendToAgent({
		chatId,
		systemMessage: `This is Base Wallet ${isGroup ? "group" : "DM"} chat 
using XMTP. Keep responses brief when possible. Use plain text, with occasional emojis. Here is your welcome message / persona that is sent to each new user: ${WELCOME_MESSAGE}.  The users EVM address is ${addressFromInboxId}.

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
- Fetch quotes and present order transactions with the "swap" tool on on CowSwap with "get-cowswap-orders".
- Generate and present EVM transactions with "generate-evm-tx" for swaps, transfers, and basic transactions.`,
		message: messageContent,
		evmAddress: addressFromInboxId,
	});

	console.log("COMPLETION", JSON.stringify(completion.content, null, 2));

	// Process tool calls and group generate-evm-tx calls
	if (completion?.toolCalls && completion.toolCalls.length > 0) {
		// First, separate tool calls with results from those without
		const toolCallsWithResults = completion.toolCalls.filter(
			(toolCall): toolCall is ToolCallWithResult => {
				return toolCall && typeof toolCall === "object" && "result" in toolCall;
			},
		);

		const toolCallsWithArgs = completion.toolCalls.filter(
			(toolCall): toolCall is ToolCallWithArgs => {
				return (
					toolCall &&
					typeof toolCall === "object" &&
					"args" in toolCall &&
					!("result" in toolCall)
				);
			},
		);

		const combinedToolResults: (ToolCallWithResult & {
			args: ToolCallWithArgs["args"];
			toolName: ToolCallWithArgs["toolName"];
		})[] = toolCallsWithResults.map((toolCall) => ({
			...toolCall,
			args:
				toolCallsWithArgs.find((tc) => tc.toolCallId === toolCall.toolCallId)
					?.args || {},
			toolName:
				toolCallsWithArgs.find((tc) => tc.toolCallId === toolCall.toolCallId)
					?.toolName || "",
		}));

		console.log(
			"COMBINED_TOOL_RESULTS\n\n",
			JSON.stringify(combinedToolResults, null, 2),
		);

		const evmTxCalls = [];

		// Process each tool call with results
		for (const toolCall of combinedToolResults) {
			const result = toolCall.result;

			// Handle generate-evm-tx tool calls
			if (toolCall.toolName === "generate-evm-tx") {
				// Skip if there's an error
				if (result?.error) {
					console.log(`Skipping generate-evm-tx with error: ${result.error}`);
					continue;
				}

				// Check for evmSignRequest data
				const resultData = "data" in result ? result.data : undefined;
				const evmSignRequest =
					resultData && "evmSignRequest" in resultData
						? resultData.evmSignRequest
						: undefined;

				if (!evmSignRequest) {
					console.log(
						`Skipping generate-evm-tx without evmSignRequest, result data:`,
						JSON.stringify(result?.data, null, 2),
					);
					continue;
				}

				console.log(
					"Processing evmSignRequest:",
					JSON.stringify(evmSignRequest, null, 2),
				);

				const chainId = toHex(evmSignRequest.chainId || 8453);
				const params = evmSignRequest.params || [];

				type TRefMetadata = {
					transactionType: string;
					description: string;
					currency?: string;
					amount?: number;
					decimals?: number;
					fromAddress?: string;
					toAddress?: string;
				};

				// Extract all calls from the params array
				const calls: WalletSendCallsParams["calls"] & {
					metadata?: TRefMetadata;
				} = params.map(
					(param: {
						to: string;
						data: string;
						value: string;
						from: string;
						metadata?: TRefMetadata;
					}) => ({
						to: param.to as `0x${string}`,
						data: (param.data || "0x") as `0x${string}`,
						value: (param.value || "0x0") as `0x${string}`,
						metadata: {
							transactionType: evmSignRequest.method || "transfer",
							description: `${param.from} -> ${param.to} on ${evmSignRequest.chainId}`,
							fromAddress: param.from,
							toAddress: param.to,
							amount: param.value,
						},
					}),
				);

				evmTxCalls.push({
					version: "1.0.0" as const,
					chainId: chainId,
					from: (params[0]?.from || addressFromInboxId) as `0x${string}`,
					calls: calls,
				});
			}
			// Handle swap tool calls
			else if (toolCall.toolName === "swap") {
				const swapResult = "data" in result ? result.data : undefined;
				const swapResultData =
					swapResult && "swapArgs" in swapResult ? swapResult : undefined;
				const swapResultDataTransaction =
					swapResultData && "transaction" in swapResultData
						? swapResultData.transaction
						: undefined;
				const txData =
					swapResultDataTransaction as SwapResult["data"]["transaction"];
				if (txData?.params) {
					const chainId = toHex(txData?.chainId || 8453);

					// Find the original args for this swap to get token names
					const originalArgs = toolCallsWithArgs.find(
						(tc) =>
							tc.toolCallId === toolCall.toolCallId && tc.toolName === "swap",
					);

					const swapArgs = originalArgs?.args as SwapArgs | undefined;
					const sellToken = swapArgs?.sellToken || "Token A";
					const buyToken = swapArgs?.buyToken || "Token B";
					const swapDescription = `Swap ${sellToken} for ${buyToken} on ${txData.chainId}`;

					// Extract CowSwap order URL
					const cowswapOrderUrl =
						swapResultData && "meta" in swapResultData
							? (swapResultData.meta as { orderUrl?: string })?.orderUrl
							: undefined;
					console.log("COWSWAP ORDER URL", cowswapOrderUrl);

					// Create calls array from all params
					const calls = txData.params.map(
						(param: {
							to: string;
							data: string;
							value: string;
							from: string;
						}) => ({
							to: param.to as `0x${string}`,
							data: param.data as `0x${string}`,
							value: (param.value || "0x0") as `0x${string}`,
							metadata: {
								description: swapDescription,
								transactionType: "swap",
								fromAddress: txData.params[0]?.from,
								toAddress: txData.params[0]?.to,
								amount: txData.params[0]?.value,
								...(cowswapOrderUrl && { cowswapOrderUrl }),
							},
						}),
					);

					evmTxCalls.push({
						version: "1.0.0" as const,
						chainId: chainId,
						from: (txData.params[0]?.from ||
							addressFromInboxId) as `0x${string}`,
						calls: calls,
					});
				}
			}
			// Add more tool handlers here in the future
		}

		// Group by chainId, from, and version
		const groupedTxs = new Map<string, WalletSendCallsParams>();

		if (evmTxCalls.length > 0) {
			console.log(
				JSON.stringify({
					PROCESSING_EVM_TX_CALLS: evmTxCalls,
				}),
			);
		}

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
					from: txCall.from || addressFromInboxId,
					calls: txCall.calls,
				});
			}
		}

		// Send each grouped transaction
		for (const [_groupKey, walletParams] of groupedTxs) {
			console.log(
				JSON.stringify({
					SENDING_WALLET_PARAMS: walletParams,
				}),
			);
			await sendMessage(conversation, {
				content: walletParams,
				reference: message.id,
				contentType: ContentTypeWalletSendCalls,
				referenceInboxId: senderInboxId,
				isGroup,
			});
		}
	}

	await sendMessage(conversation, {
		content: completion.content,
		reference: message.id,
		contentType: ContentTypeText,
		referenceInboxId: senderInboxId,
		isGroup,
	});
}

const handleStream = async () => {
	console.log("handleStream");
};

try {
	await handleStream();
} catch (error) {
	console.error(error);
}
