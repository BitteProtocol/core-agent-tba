import { getRandomValues } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
	ContentTypeReaction,
	type Reaction,
	type ReactionCodec,
} from "@xmtp/content-type-reaction";
import { ContentTypeReply, type Reply } from "@xmtp/content-type-reply";
import type { ContentTypeText } from "@xmtp/content-type-text";
import type {
	ContentTypeTransactionReference,
	TransactionReference,
} from "@xmtp/content-type-transaction-reference";
import {
	ContentTypeWalletSendCalls,
	type WalletSendCallsParams,
} from "@xmtp/content-type-wallet-send-calls";
import {
	Client,
	type ClientOptions,
	type Conversation,
	type ExtractCodecContentTypes,
	getInboxIdForIdentifier,
	IdentifierKind,
	type Signer,
} from "@xmtp/node-sdk";
import { fromString, toString as uint8ArrayToString } from "uint8arrays";
import { createWalletClient, http, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

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
	return uint8ArrayToString(uint8Array, "hex");
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

export const getDbPath = (description: string = "xmtp") => {
	//Checks if the environment is a Railway deployment
	const volumePath = process.env.RAILWAY_VOLUME_MOUNT_PATH ?? ".data/xmtp";
	// Create database directory if it doesn't exist
	if (!fs.existsSync(volumePath)) {
		fs.mkdirSync(volumePath, { recursive: true });
	}
	return `${volumePath}/${description}.db3`;
};

export const logAgentDetails = async (
	clients: Client<ExtractCodecContentTypes<[ReactionCodec]>>,
): Promise<void> => {
	const clientArray = Array.isArray(clients) ? clients : [clients];
	const clientsByAddress = clientArray.reduce<
		Record<string, Client<string | Reaction>[]>
	>((acc, client) => {
		const address = client.accountIdentifier?.identifier as string;
		acc[address] = acc[address] ?? [];
		acc[address].push(client);
		return acc;
	}, {});

	for (const [address, clientGroup] of Object.entries(clientsByAddress)) {
		const firstClient = clientGroup[0];
		const inboxId = firstClient.inboxId;
		const installationId = firstClient.installationId;
		const environments = clientGroup
			.map((c: Client<string | Reaction>) => c.options?.env ?? "production")
			.join(", ");
		console.log(`\x1b[38;2;252;76;52m
        ██╗  ██╗███╗   ███╗████████╗██████╗ 
        ╚██╗██╔╝████╗ ████║╚══██╔══╝██╔══██╗
         ╚███╔╝ ██╔████╔██║   ██║   ██████╔╝
         ██╔██╗ ██║╚██╔╝██║   ██║   ██╔═══╝ 
        ██╔╝ ██╗██║ ╚═╝ ██║   ██║   ██║     
        ╚═╝  ╚═╝╚═╝     ╚═╝   ╚═╝   ╚═╝     
      \x1b[0m`);

		const urls = [`http://xmtp.chat/dm/${address}`];

		const conversations = await firstClient.conversations.list();
		const inboxState = await firstClient.preferences.inboxState();

		console.log(`
    ✓ XMTP Client:
    • InboxId: ${inboxId}
    • Address: ${address}
    • Conversations: ${conversations.length}
    • Installations: ${inboxState.installations.length}
    • InstallationId: ${installationId}
    • Networks: ${environments}
    ${urls.map((url) => `• URL: ${url}`).join("\n")}`);
	}
};
export function validateEnvironment(vars: string[]): Record<string, string> {
	const missing = vars.filter((v) => !process.env[v]);

	if (missing.length) {
		try {
			const envPath = path.resolve(process.cwd(), ".env");
			if (fs.existsSync(envPath)) {
				const envVars = fs
					.readFileSync(envPath, "utf-8")
					.split("\n")
					.filter((line) => line.trim() && !line.startsWith("#"))
					.reduce<Record<string, string>>((acc, line) => {
						const [key, ...val] = line.split("=");
						if (key && val.length) acc[key.trim()] = val.join("=").trim();
						return acc;
					}, {});

				missing.forEach((v) => {
					if (envVars[v]) process.env[v] = envVars[v];
				});
			}
		} catch (e) {
			console.error(e);
			/* ignore errors */
		}

		const stillMissing = vars.filter((v) => !process.env[v]);
		if (stillMissing.length) {
			console.error("Missing env vars:", stillMissing.join(", "));
			process.exit(1);
		}
	}

	return vars.reduce<Record<string, string>>((acc, key) => {
		acc[key] = process.env[key] as string;
		return acc;
	}, {});
}

export const createClientWithRevoke = async (
	signer: Signer,
	config: ClientOptions,
): Promise<Client<ExtractCodecContentTypes<typeof config.codecs>>> => {
	// try to create new client, if it fails, revoke all other installations and try again
	const identifier = await signer.getIdentifier();
	try {
		const client = await Client.create(signer, config);
		console.log("New client created ✅");

		// revoke all other installations
		await client.revokeAllOtherInstallations();
		console.log("Revoked all other installations ␡");

		return client;
	} catch (error) {
		console.error("Error creating client ❌", error);
	}

	try {
		// revoke all other installations
		const inboxId = await getInboxIdForIdentifier(identifier, config.env);
		if (inboxId) {
			const inboxStates = await Client.inboxStateFromInboxIds(
				[inboxId],
				config.env,
			);
			const toRevokeInstallationBytes = inboxStates[0].installations.map(
				(i) => i.bytes,
			);
			console.log("To revoke installation bytes", toRevokeInstallationBytes);
			await Client.revokeInstallations(
				signer,
				inboxId,
				toRevokeInstallationBytes,
				config.env,
			);
			console.log("Revoked all other installations ␡");
		}
		console.log("Creating new client with config", config);
		return await Client.create(signer, config);
	} catch (error) {
		console.error("Error revoking installations ❌", error);
		throw error;
	}
};

export const sendMessage = async (
	conversation: Conversation,
	{
		content,
		reference,
		contentType,
		isGroup = false,
	}: {
		content:
			| Reaction
			| Reply
			| WalletSendCallsParams
			| TransactionReference
			| string;
		reference: string;
		contentType:
			| typeof ContentTypeReaction
			| typeof ContentTypeReply
			| typeof ContentTypeText
			| typeof ContentTypeWalletSendCalls
			| typeof ContentTypeTransactionReference;
		isGroup?: boolean;
	},
) => {
	if (!isGroup || contentType.typeId === ContentTypeReaction.typeId) {
		await conversation.send(content, contentType);
	} else {
		const hasWalletSendCalls =
			contentType.typeId === ContentTypeWalletSendCalls.typeId;
		const reply: Reply = {
			reference,
			content,
			contentType,
		};

		const replyContentType = hasWalletSendCalls
			? contentType
			: ContentTypeReply;

		await conversation.send(reply, replyContentType);
	}
};
