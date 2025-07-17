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
		console.log("Syncing conversations...");
		await client.conversations.sync();

		const clientIdentifier = await client.signer?.getIdentifier();
		const clientEvmAddress = clientIdentifier?.identifier;
		const clientInboxId = client.inboxId;

		// Create the stream with the onFail callback
		const stream = await client.conversations.streamAllMessages(
			undefined,
			undefined,
			undefined,
			onFail,
		);

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

				// if is DM or Group message, get the conversation messages
				if (isDm || isGroup && messageContent) {
          const senderInboxId = message.senderInboxId;
          const conversation = await client.conversations.getConversationById(
            senderInboxId,
          );

          // if client hasn't sent any messages, do welcome.

          const clientHasMessagedConversation = conversation?.members.some(
            senderInboxId === clientInboxId)

            if (clientHasMessagedConversation) {
              continue;
            }



				const isReplyToAgent = (message: DecodedMessage) => {
					const replyContent = message.content as Reply;
					const referenceMessage = client.conversations.getMessageById(
						replyContent.reference,
					);
					return referenceMessage?.senderInboxId === clientInboxId;
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

				// skip group messages with no mention or reply to client
				if (
					isGroup &&
					!isTaggingClient(messageContent) &&
					!isReplyToAgent(message)
				)
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
				const addressFromInboxId =
					inboxState?.[0]?.identifiers?.[0]?.identifier;

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
			}



      