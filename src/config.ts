import type { XmtpEnv } from "@xmtp/node-sdk";
import { config } from "dotenv";
import { privateKeyToAddress } from "viem/accounts";

// Configuration
export const {
  WALLET_KEY,
  ENCRYPTION_KEY,
  XMTP_ENV,
  OPENAI_API_KEY,
  BITTE_AGENT_ID,
  BITTE_API_KEY,
  NETWORK_ID,
  CHAT_API_URL,
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
    NETWORK_ID,
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

  const agentAddress = privateKeyToAddress(WALLET_KEY as `0x${string}`);
  const agentMentionId = `${agentAddress.slice(0, 6)}...${agentAddress.slice(
    -4,
  )}`;

  return {
    CHAT_API_URL:
      process.env.BITTE_CHAT_API_URL ||
      "https://ai-runtime-446257178793.europe-west1.run.app/chat",
    WALLET_KEY,
    ENCRYPTION_KEY,
    BITTE_API_KEY,
    BITTE_AGENT_ID,
    OPENAI_API_KEY,
    IS_PRODUCTION,
    XMTP_ENV: XMTP_ENV as XmtpEnv,
    NETWORK_ID: NETWORK_ID || "base-mainnet",
    AGENT_CHAT_ID: IS_PRODUCTION ? "bitte.base.eth" : agentMentionId,
  };
})();
