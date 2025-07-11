import { createHash } from "node:crypto";
import type { ToolInvocation } from "ai";
import {
	BITTE_API_KEY,
	CHAT_API_URL,
	DEFAULT_AGENT_ID,
	MCP_SERVER_URL,
} from "@/helpers/config";

type WalletInfo = {
	evm?: {
		address?: string;
		chainId?: number;
	};
};

/**
 * Bitte API Client
 * Handles direct communication with Bitte API endpoints
 */
export class BitteAPIClient {
	private apiKey: string;
	private chatId: string;

	constructor(apiKey?: string) {
		this.apiKey = apiKey || BITTE_API_KEY;
		this.chatId = this.generateChatId();
	}

	/**
	 * Generate a unique chat ID
	 */
	private generateChatId(): string {
		return createHash("md5")
			.update(Date.now().toString())
			.digest("hex")
			.substring(0, 16);
	}

	/**
	 * Generate a unique message ID
	 */
	private generateMessageId(): string {
		return createHash("md5")
			.update(Date.now().toString() + Math.random().toString())
			.digest("hex")
			.substring(0, 16);
	}

	/**
	 * Send message to Bitte agent
	 */
	async sendToAgent({
		message,
		walletInfo,
		agentId = DEFAULT_AGENT_ID,
	}: {
		message: string;
		walletInfo?: WalletInfo;
		agentId?: string;
	}): Promise<{
		messageId: string;
		content: string;
		finishReason: string;
		usage: {
			promptTokens: number;
			completionTokens: number;
		};
		toolCalls: ToolInvocation[];
		raw: string;
		timestamp: string;
	}> {
		const messageId = this.generateMessageId();
		const timestamp = new Date().toISOString();

		const payload = {
			id: this.chatId,
			messages: [
				{
					id: messageId,
					createdAt: timestamp,
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
				agentId: agentId,
				mcpServerUrl: MCP_SERVER_URL,
			},
			evmAddress: walletInfo?.evm?.address || null,
			chainId: walletInfo?.evm?.chainId || null,
		};

		try {
			const response = await fetch(CHAT_API_URL, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.apiKey}`,
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
			const parsedResponse = this.parseStreamingResponse(responseText);

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
	private parseStreamingResponse(responseText: string) {
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
			} catch (_parseError) {}
		}

		return {
			messageId,
			content: fullText,
			finishReason,
			usage,
			toolCalls,
			raw: responseText,
			timestamp: new Date().toISOString(),
		};
	}

	/**
	 * Get agent metadata from .well-known/ai-plugin.json
	 */
	async getAgentMetadata(agentId: string) {
		const metadataUrl = `https://${agentId}/.well-known/ai-plugin.json`;

		try {
			const response = await fetch(metadataUrl, {
				method: "GET",
			});

			if (!response.ok) {
				throw new Error(
					`Failed to fetch agent metadata: ${response.status} ${response.statusText}`,
				);
			}

			const metadata = await response.json();

			return {
				info: metadata.info,
				"x-mb": metadata["x-mb"],
				agentId,
				metadataUrl,
				fetchedAt: new Date().toISOString(),
			};
		} catch (error) {
			console.error("❌ Failed to fetch agent metadata:", error);
			throw error;
		}
	}
	/**
	 * Update chat ID for new conversation
	 */
	newConversation(): void {
		this.chatId = this.generateChatId();
	}

	/**
	 * Get current chat ID
	 */
	getCurrentChatId(): string {
		return this.chatId;
	}

	/**
	 * Send message to Bitte agent with streaming response
	 */
	async sendToAgentStreaming(
		agentId: string,
		message: string,
		walletInfo: WalletInfo,
	) {
		const messageId = this.generateMessageId();
		const timestamp = new Date().toISOString();

		const payload = {
			id: this.chatId,
			messages: [
				{
					id: messageId,
					createdAt: timestamp,
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
				agentId: agentId,
				mcpServerUrl: MCP_SERVER_URL,
			},
			evmAddress: walletInfo?.evm?.address || null,
		};

		try {
			const response = await fetch(CHAT_API_URL, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.apiKey}`,
				},
				body: JSON.stringify(payload),
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(
					`Bitte API error: ${response.status} ${response.statusText} - ${errorText}`,
				);
			}

			// Stream the response and show it in real-time
			const responseText = await response.text();
			const parsedResponse =
				this.parseStreamingResponseWithDisplay(responseText);

			return parsedResponse;
		} catch (error) {
			console.error("❌ Streaming request failed:", error);
			throw error;
		}
	}

	/**
	 * Parse streaming response with real-time display
	 */
	private parseStreamingResponseWithDisplay(responseText: string) {
		const lines = responseText.split("\n").filter((line) => line.trim());

		let messageId = "";
		let fullText = "";
		let finishReason = "";
		let usage = null;
		const toolCalls: Record<string, unknown>[] = [];

		for (const line of lines) {
			try {
				if (line.startsWith("f:")) {
					// Message metadata
					const metadata = JSON.parse(line.substring(2));
					messageId = metadata.messageId || "";
				} else if (line.startsWith("0:")) {
					// Text chunk - display in real-time
					const textChunk = JSON.parse(line.substring(2));
					process.stdout.write(textChunk);
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
				}
			} catch (_parseError) {}
		}

		return {
			messageId,
			content: fullText,
			finishReason,
			usage,
			toolCalls,
			raw: responseText,
			timestamp: new Date().toISOString(),
		};
	}

	/**
	 * Test API connection with a simple message
	 */
	async testConnection(
		agentId?: string,
		walletInfo?: WalletInfo,
	): Promise<boolean> {
		try {
			const response = await this.sendToAgent({
				message: "Hello, are you available?",
				agentId,
				walletInfo,
			});

			if (response?.content) {
				return true;
			}

			return false;
		} catch (error) {
			console.error("❌ Connection test failed:", error);
			return false;
		}
	}
}
