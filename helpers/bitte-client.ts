import { type ChatRequest, generateId, type ToolInvocation } from "ai";
import { BITTE_AGENT_ID, BITTE_API_KEY, CHAT_API_URL } from "./config";

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
	contextMessage,
	instructionsOverride,
}: {
	chatId: string;
	message: string;
	evmAddress: string;
	contextMessage?: string;
	instructionsOverride?: string;
}) {
	const messagesWithContext: ChatRequest["messages"] = [
		...(contextMessage
			? [
					{
						id: generateId(),
						createdAt: new Date(),
						role: "system" as const,
						content: contextMessage,
					},
				]
			: []),
		{
			id: generateId(),
			createdAt: new Date(),
			role: "user" as const,
			content: message,
			parts: [
				{
					type: "text",
					text: message,
				},
			],
		},
	];

	const payload: ChatRequest & {
		id: string;
		evmAddress: string;
		config: {
			agentId: string;
			instructionsOverride?: string;
		};
	} = {
		id: chatId,
		messages: messagesWithContext,
		config: {
			// append bitte-xmtp- prefix required by Bitte API
			agentId: `bitte-xmtp-${BITTE_AGENT_ID}`,
			instructionsOverride,
		},
		evmAddress,
	};

	const maxRetries = 3;
	let lastError: Error | null = null;

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
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
				const error = new Error(
					`Bitte API error: ${response.status} ${response.statusText} - ${errorText}`,
				);
				lastError = error;

				// If this is the last attempt or it's not a retryable error, don't retry
				if (attempt === maxRetries || !isRetryableError(response.status)) {
					throw error;
				}

				console.warn(
					`⚠️  Attempt ${attempt}/${maxRetries} failed, retrying in ${getDelayMs(
						attempt,
					)}ms...`,
				);
				await sleep(getDelayMs(attempt));
				continue;
			}

			// Parse the streaming response
			const responseText = await response.text();
			const parsedResponse = parseStreamingResponse(responseText);

			// Success - log if we had to retry
			if (attempt > 1) {
				console.log(
					`✅ Request succeeded on retry attempt ${attempt}/${maxRetries}`,
				);
			}

			return parsedResponse;
		} catch (error) {
			lastError = error as Error;

			// If this is the last attempt, break out of the loop
			if (attempt === maxRetries) {
				break;
			}

			console.warn(
				`⚠️  Attempt ${attempt}/${maxRetries} failed: ${error}, retrying in ${getDelayMs(
					attempt,
				)}ms...`,
			);
			await sleep(getDelayMs(attempt));
		}
	}

	// All retries failed - return a user-friendly error response
	console.error("❌ All retry attempts failed:", lastError);

	return {
		messageId: generateId(),
		content:
			"I'm sorry, but I'm experiencing some technical difficulties right now. Please try again in a few moments.",
		finishReason: "error",
		usage: null,
		toolCalls: [],
		raw: "",
		isError: true,
	};
}

/**
 * Check if an HTTP status code is retryable
 */
function isRetryableError(status: number): boolean {
	// Retry on server errors (5xx) and rate limiting (429)
	return status >= 500 || status === 429;
}

/**
 * Calculate delay for exponential backoff
 */
function getDelayMs(attempt: number): number {
	// Base delay of 1 second, doubling each attempt: 1s, 2s, 4s
	return Math.min(1000 * 2 ** (attempt - 1), 10000);
}

/**
 * Sleep for the specified number of milliseconds
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
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
		} catch (parseError) {
			// Skip unparseable lines
			console.error({ SKIPPING_UNPARSEABLE_LINE: line, parseError });
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
