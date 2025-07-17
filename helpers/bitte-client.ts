import { type ChatRequest, generateId, type ToolInvocation } from "ai";
import { BITTE_API_KEY, CHAT_API_URL, DEFAULT_AGENT_ID } from "./config";

type SendToAgentParams = {
	chatId: string;
	message: string;
	evmAddress: string;
	agentId?: string;
	systemMessage?: string;
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

export async function sendToAgent({
	chatId,
	message,
	evmAddress,
	agentId = DEFAULT_AGENT_ID,
	systemMessage,
}: SendToAgentParams) {
	const payload: ChatRequest & {
		id: string;
		evmAddress: string;
		config: { mode: "debug"; agentId: string };
	} = {
		id: chatId,
		messages: [
			...(systemMessage
				? [
						{
							id: generateId(),
							createdAt: new Date(),
							role: "system" as const,
							content: systemMessage,
						},
					]
				: []),
			{
				id: generateId(),
				createdAt: new Date(),
				role: "user",
				content: message,
				parts: [
					{
						type: "text",
						text: message,
					},
				],
			},
		],
		config: {
			mode: "debug",
			agentId,
		},
		evmAddress,
	};
	try {
		const response = await fetch(CHAT_API_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${BITTE_API_KEY}`,
			},
			body: JSON.stringify(payload),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(
				`Bitte API error: ${response.status} ${response.statusText} - ${errorText}`,
			);
		}

		// Parse the streaming response
		const responseText = await response.text();
		const parsedResponse = parseStreamingResponse(responseText);

		return parsedResponse;
	} catch (error) {
		console.error("❌ Bitte API request failed:", error);
		throw error;
	}
}

/**
 * Parse the streaming response from Bitte API
 * Format: f:{metadata}\n0:"text"\n0:"chunk"\ne:{endData}\nd:{doneData}\n8:[metadata]
 */
function parseStreamingResponse(responseText: string) {
	const lines = responseText.split("\n").filter((line) => line.trim());

	let messageId = "";
	let fullText = "";
	let finishReason = "";
	let usage = null;
	const toolCalls: ToolInvocation[] = [];

	for (const line of lines) {
		try {
			if (line.startsWith("f:")) {
				// Message metadata
				const metadata = JSON.parse(line.substring(2));
				messageId = metadata.messageId || "";
			} else if (line.startsWith("0:")) {
				// Text chunk
				const textChunk = JSON.parse(line.substring(2));
				fullText += textChunk;
			} else if (line.startsWith("e:")) {
				// End event
				const endData = JSON.parse(line.substring(2));
				finishReason = endData.finishReason || "";
				usage = endData.usage || null;
			} else if (line.startsWith("d:")) {
				// Done event
				const doneData = JSON.parse(line.substring(2));
				if (!finishReason) finishReason = doneData.finishReason || "";
				if (!usage) usage = doneData.usage || null;
			} else if (line.startsWith("1:")) {
				// Tool calls (if any)
				try {
					const toolCall = JSON.parse(line.substring(2));
					toolCalls.push(toolCall);
				} catch (_e) {
					// Ignore invalid tool call data
				}
			} else if (line.startsWith("9:")) {
				// Tool calls (if any)
				try {
					const toolCall = JSON.parse(line.substring(2));
					toolCalls.push(toolCall);
				} catch (_e) {
					// Ignore invalid tool call data
				}
			} else if (line.startsWith("a:")) {
				// Tool calls (if any)
				try {
					const toolCall = JSON.parse(line.substring(2));
					toolCalls.push(toolCall);
				} catch (_e) {
					// Ignore invalid tool call data
				}
			}
		} catch (_parseError) {
			// Skip unparseable lines
		}
	}

	return {
		messageId,
		content: fullText,
		finishReason,
		usage,
		toolCalls,
		raw: responseText,
	};
}
