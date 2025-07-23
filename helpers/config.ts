import type { XmtpEnv } from "@xmtp/node-sdk";
import { config } from "dotenv";

// Configuration
export const {
	WALLET_KEY,
	ENCRYPTION_KEY,
	XMTP_ENV,
	OPENAI_API_KEY,
	BITTE_AGENT_ID,
	BITTE_API_KEY,
	CHAT_API_URL,
	DEFAULT_AGENT_ID,
	IS_PRODUCTION,
	AGENT_CHAT_ID,
} = (() => {
	config();

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
	const IS_PRODUCTION = NODE_ENV === "production";

	return {
		CHAT_API_URL:
			process.env.BITTE_CHAT_API_URL ||
			"https://ai-runtime-446257178793.europe-west1.run.app/chat",

		DEFAULT_AGENT_ID: BITTE_AGENT_ID,

		WALLET_KEY,
		ENCRYPTION_KEY,
		XMTP_ENV: XMTP_ENV as XmtpEnv,
		BITTE_API_KEY,
		BITTE_AGENT_ID,
		OPENAI_API_KEY,
		IS_PRODUCTION,
		AGENT_CHAT_ID: IS_PRODUCTION ? "bitte.base.eth" : "0x4109…0848",
	};
})();
