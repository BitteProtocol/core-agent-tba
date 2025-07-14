import dotenv from "dotenv";

dotenv.config();

// Configuration
export const {
	WALLET_KEY,
	ENCRYPTION_KEY,
	XMTP_ENV,
	OPENAI_API_KEY,
	BITTE_AGENT_ID,
	BITTE_API_KEY,
	BITTE_API_BASE,
	CHAT_API_URL,
	MCP_SERVER_URL,
	DEFAULT_AGENT_ID,
	NETWORKS,
	IS_PRODUCTION,
	AGENT_CHAT_ID,
} = (() => {
	const {
		WALLET_KEY,
		ENCRYPTION_KEY,
		XMTP_ENV,
		BITTE_AGENT_ID,
		BITTE_API_KEY,
		OPENAI_API_KEY,
		NODE_ENV,
	} = process.env;

	if (
		!WALLET_KEY ||
		!ENCRYPTION_KEY ||
		!XMTP_ENV ||
		!BITTE_AGENT_ID ||
		!BITTE_API_KEY ||
		!OPENAI_API_KEY
	) {
		throw new Error("ENV variables not configured");
	}

	return {
		// Bitte API endpoints
		BITTE_API_BASE: "https://ai-runtime-446257178793.europe-west1.run.app",
		CHAT_API_URL: process.env.BITTE_CHAT_API_URL || "https://ai-runtime-446257178793.europe-west1.run.app/chat",
		MCP_SERVER_URL:
			"https://bitte-mcp-sse-446257178793.europe-west1.run.app/sse",

		// Default agent configurations
		DEFAULT_AGENT_ID: BITTE_AGENT_ID,

		// Network configurations
		NETWORKS: {
			EVM: {
				mainnet: { chainId: 1, rpcUrl: "https://eth.llamarpc.com" },
				polygon: { chainId: 137, rpcUrl: "https://polygon.llamarpc.com" },
				arbitrum: { chainId: 42161, rpcUrl: "https://arbitrum.llamarpc.com" },
				base: { chainId: 8453, rpcUrl: "https://base.llamarpc.com" },
			},
			NEAR: {
				mainnet: {
					networkId: "mainnet",
					nodeUrl: "https://rpc.mainnet.near.org",
				},
				testnet: {
					networkId: "testnet",
					nodeUrl: "https://rpc.testnet.near.org",
				},
			},
			SUI: {
				mainnet: { rpcUrl: "https://fullnode.mainnet.sui.io:443" },
				testnet: { rpcUrl: "https://fullnode.testnet.sui.io:443" },
			},
		},
		WALLET_KEY,
		ENCRYPTION_KEY,
		XMTP_ENV,
		BITTE_API_KEY,
		BITTE_AGENT_ID,
		OPENAI_API_KEY,
		IS_PRODUCTION: NODE_ENV === "production",
		AGENT_CHAT_ID: NODE_ENV === "production" ? "bitte.base.eth" : "0x4109…0848",
	};
})();
