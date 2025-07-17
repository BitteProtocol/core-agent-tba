import { getRandomValues } from "node:crypto";
import fs from "node:fs";
import { ContentTypeReaction } from "@xmtp/content-type-reaction";
import { ContentTypeReply, type Reply } from "@xmtp/content-type-reply";
import { ContentTypeWalletSendCalls } from "@xmtp/content-type-wallet-send-calls";
import type { Conversation, DecodedMessage } from "@xmtp/node-sdk";
import { type Client, IdentifierKind, type Signer } from "@xmtp/node-sdk";
import { fromString, toString as uint8arraysToString } from "uint8arrays";
import { createWalletClient, http, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import type { ClientContentTypes } from "@/server";

export const sendMessage = async (
	conversation: Conversation<ClientContentTypes>,
	{
		content,
		contentType,
		reference,
		referenceInboxId,
		isGroup = false,
	}: {
		content: Reply | ClientContentTypes;
		contentType: typeof ContentTypeReaction | typeof ContentTypeReply;
		reference?: string;
		referenceInboxId?: string;
		isGroup?: boolean;
	},
) => {
	// normal message or reaction for non group messages and
	if (!reference || !isGroup || ContentTypeReaction.sameAs(contentType)) {
		await conversation.send(content, contentType);
	} else {
		// maintain wallet content type for wallet send calls
		const hasWalletSendCalls = ContentTypeWalletSendCalls.sameAs(contentType);

		const messageContent = {
			content,
			contentType,
			reference,
			referenceInboxId,
		};

		const messageContentType = hasWalletSendCalls
			? contentType
			: ContentTypeReply;

		await conversation.send(messageContent, messageContentType);
	}
};

interface User {
	key: `0x${string}`;
	account: ReturnType<typeof privateKeyToAccount>;
	wallet: ReturnType<typeof createWalletClient>;
}

export const createUser = (key: string): User => {
	const account = privateKeyToAccount(key as `0x${string}`);
	return {
		key: key as `0x${string}`,
		account,
		wallet: createWalletClient({
			account,
			chain: sepolia,
			transport: http(),
		}),
	};
};

export const createSigner = (key: string): Signer => {
	const sanitizedKey = key.startsWith("0x") ? key : `0x${key}`;
	const user = createUser(sanitizedKey);
	return {
		type: "EOA",
		getIdentifier: () => ({
			identifierKind: IdentifierKind.Ethereum,
			identifier: user.account.address.toLowerCase(),
		}),
		signMessage: async (message: string) => {
			const signature = await user.wallet.signMessage({
				message,
				account: user.account,
			});
			return toBytes(signature);
		},
	};
};

/**
 * Generate a random encryption key
 * @returns The encryption key
 */
export const generateEncryptionKeyHex = () => {
	/* Generate a random encryption key */
	const uint8Array = getRandomValues(new Uint8Array(32));
	/* Convert the encryption key to a hex string */
	return uint8arraysToString(uint8Array, "hex");
};

/**
 * Get the encryption key from a hex string
 * @param hex - The hex string
 * @returns The encryption key
 */
export const getEncryptionKeyFromHex = (hex: string) => {
	/* Convert the hex string to an encryption key */
	return fromString(hex, "hex");
};

export const getDbPath = (env: string, suffix: string = "xmtp") => {
	//Checks if the environment is a Railway deployment
	const volumePath = process.env.RAILWAY_VOLUME_MOUNT_PATH || ".data/xmtp";

	// Ensure volumePath is not empty
	if (!volumePath || volumePath.trim() === "") {
		throw new Error(
			"Volume path is empty. Please set RAILWAY_VOLUME_MOUNT_PATH or check your Railway volume configuration.",
		);
	}

	// Create database directory if it doesn't exist
	try {
		if (!fs.existsSync(volumePath)) {
			fs.mkdirSync(volumePath, { recursive: true });
		}
	} catch (error) {
		console.error(`Failed to create directory ${volumePath}:`, error);
		// Fallback to a temporary directory
		const fallbackPath = "/tmp/xmtp";
		if (!fs.existsSync(fallbackPath)) {
			fs.mkdirSync(fallbackPath, { recursive: true });
		}
		const dbPath = `${fallbackPath}/${env}-${suffix}.db3`;
		return dbPath;
	}

	const dbPath = `${volumePath}/${env}-${suffix}.db3`;
	return dbPath;
};

export const logAgentDetails = async (
	clients: Client<ClientContentTypes> | Client<ClientContentTypes>[],
): Promise<void> => {
	const clientArray = Array.isArray(clients) ? clients : [clients];
	const clientsByAddress = clientArray.reduce<
		Record<string, Client<ClientContentTypes>[]>
	>((acc, client) => {
		const address = client.accountIdentifier?.identifier as string;
		acc[address] = acc[address] ?? [];
		acc[address].push(client);
		return acc;
	}, {});

	for (const [address, clientGroup] of Object.entries(clientsByAddress)) {
		const firstClient = clientGroup[0];
		const inboxId = firstClient.inboxId;
		const environments = clientGroup
			.map((c: Client<ClientContentTypes>) => c.options?.env ?? "dev")
			.join(", ");

		const urls = [`http://xmtp.chat/dm/${address}`];

		const conversations = await firstClient.conversations.list();
		const installations = await firstClient.preferences.inboxState();

		console.log(`
    ✓ XMTP Client:
    • Address: ${address}
    • Installations: ${installations.installations.length}
    • Conversations: ${conversations.length}
    • InboxId: ${inboxId}
    • Networks: ${environments}
    ${urls.map((url) => `• URL: ${url}`).join("\n")}`);
	}
};

/**
 * Extract message content from different message types
 *
 * Handles various XMTP message types including replies and regular text messages.
 * For reply messages, it attempts to extract the actual user content from
 * various possible locations in the message structure.
 *
 * @param message - The decoded XMTP message
 * @returns The message content as a string
 */
export function extractMessageContent(message: DecodedMessage): string {
	// Handle reply messages
	if (message.contentType?.typeId === "reply") {
		const messageAny = message;
		const replyContent = message.content;

		if (replyContent && typeof replyContent === "object") {
			// Try different possible property names for the actual content
			if ("content" in replyContent) {
				return String(replyContent.content);
			}
			if ("text" in replyContent) {
				return String(replyContent.text);
			}
			if ("message" in replyContent) {
				return String(replyContent.message);
			}
		}

		// Check fallback field (might contain the actual user message)
		if (messageAny.fallback && typeof messageAny.fallback === "string") {
			// Extract the actual user message from the fallback format
			// Format: 'Replied with "actual message" to an earlier message'
			const fallbackText = messageAny.fallback;
			const match = fallbackText.match(
				/Replied with "(.+)" to an earlier message/,
			);
			if (match?.[1]) {
				const actualMessage = match[1];
				return actualMessage;
			}

			// If pattern doesn't match, return the full fallback text
			return fallbackText;
		}

		// Check parameters field (might contain reply data)
		if (messageAny.parameters && typeof messageAny.parameters === "object") {
			const params = messageAny.parameters;
			if (params.content) {
				return String(params.content);
			}
			if (params.text) {
				return String(params.text);
			}
		}

		// If content is null/undefined, return empty string to avoid errors
		if (replyContent === null || replyContent === undefined) {
			return "";
		}

		// Fallback to stringifying the whole content if structure is different
		return JSON.stringify(replyContent);
	}

	// Handle regular text messages
	const content = message.content;
	if (content === null || content === undefined) {
		return "";
	}
	return String(content);
}
