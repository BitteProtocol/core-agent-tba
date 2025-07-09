import { createHash } from "node:crypto";
import { CONFIG } from "./config.js";

type WalletInfo = {
	evmAddress: string;
};

/**
 * Bitte API Client
 * Handles direct communication with Bitte API endpoints
 */
export class BitteAPIClient {
	private apiKey: string;
	private baseUrl: string;
	private chatId: string;

	constructor(apiKey?: string) {
		this.apiKey = apiKey || process.env.BITTE_API_KEY || "";
		this.baseUrl = "https://bitte.ai";
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
	async sendToAgent(
		agentId: string,
		message: string,
		walletInfo: WalletInfo,
	): Promise<any> {
		const url = `${this.baseUrl}/api/chat`;

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
				mcpServerUrl: CONFIG.MCP_SERVER_URL,
			},
			evmAddress: walletInfo.evmAddress || null,
		};

		try {

			const response = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.apiKey}`,
					Accept: "*/*",
					Origin: "https://bitte.ai",
					Referer: `https://bitte.ai/chat?agentid=${agentId}&chatId=${this.chatId}`,
					"User-Agent":
						"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
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
	private parseStreamingResponse(responseText: string): any {
		const lines = responseText.split("\n").filter((line) => line.trim());

		let messageId = "";
		let fullText = "";
		let finishReason = "";
		let usage = null;
		let agentId = "";
		const toolCalls: any[] = [];

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
				} else if (line.startsWith("8:")) {
					// Additional metadata
					const metadata = JSON.parse(line.substring(2));
					if (Array.isArray(metadata) && metadata[0]?.agentId) {
						agentId = metadata[0].agentId;
					}
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
			agentId,
			toolCalls,
			raw: responseText,
			timestamp: new Date().toISOString(),
		};
	}

	/**
	 * Get agent metadata from .well-known/ai-plugin.json
	 */
	async getAgentMetadata(agentId: string): Promise<any> {
		const metadataUrl = `https://${agentId}/.well-known/ai-plugin.json`;

		try {
			const response = await fetch(metadataUrl, {
				method: "GET",
				headers: {
					Accept: "application/json",
					"User-Agent":
						"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
				},
			});

			if (!response.ok) {
				throw new Error(
					`Failed to fetch agent metadata: ${response.status} ${response.statusText}`,
				);
			}

			const metadata = (await response.json()) as any;

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
		walletInfo: any,
	): Promise<any> {
		const url = `${this.baseUrl}/api/chat`;

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
				mcpServerUrl: CONFIG.MCP_SERVER_URL,
			},
			evmAddress: walletInfo.evm?.address || null,
			chainId: walletInfo.evm?.chainId || null,
			accountId: walletInfo.near?.address || null,
			nearWalletId: "meteor-wallet",
			suiAddress: walletInfo.sui?.address || null,
		};

		try {

			const response = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.apiKey}`,
					Accept: "*/*",
					Origin: "https://bitte.ai",
					Referer: `https://bitte.ai/chat?agentid=${agentId}&chatId=${this.chatId}`,
					"User-Agent":
						"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
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
	private parseStreamingResponseWithDisplay(responseText: string): any {
		const lines = responseText.split("\n").filter((line) => line.trim());

		let messageId = "";
		let fullText = "";
		let finishReason = "";
		let usage = null;
		let agentId = "";
		const toolCalls: any[] = [];

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
				} else if (line.startsWith("8:")) {
					// Additional metadata
					const metadata = JSON.parse(line.substring(2));
					if (Array.isArray(metadata) && metadata[0]?.agentId) {
						agentId = metadata[0].agentId;
					}
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
			agentId,
			toolCalls,
			raw: responseText,
			timestamp: new Date().toISOString(),
		};
	}

	/**
	 * Test API connection with a simple message
	 */
	async testConnection(agentId: string): Promise<boolean> {
		try {

			const walletInfo = {
				evmAddress: "0x0000000000000000000000000000000000000000",
			};

			const response = await this.sendToAgent(
				agentId,
				"Hello, are you available?",
				walletInfo,
			);

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
