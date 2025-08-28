import type { Conversation, GroupMember } from "@xmtp/node-sdk";
import { BITTE_AGENT_ID, NETWORK_ID } from "@/config";
import type { ActionsContent } from "@/types/actions-content";
import { TokenHandler } from "./token-handler";

const agentIdShort = BITTE_AGENT_ID.split(".")[0];

export const getWelcomeMessage = (): ActionsContent => {
  const tokenHandler = new TokenHandler(NETWORK_ID);
  const networkInfo = tokenHandler.getNetworkInfo();

  return {
    id: `welcome-${Date.now()}`,
    description: `👋 Welcome! I'm ${agentIdShort}, your blockchain assistant.

🌐 **Current Network:** ${networkInfo.name}
💰 **Supported Tokens:** ${networkInfo.supportedTokens.join(", ")}

I can help you:
• 💸 Send and receive tokens
• 💰 Check balances
• 📊 Track transactions
• 🔗 Interact with blockchain

✨ Choose an action below to get started:`,
    actions: [
      {
        id: "help",
        label: "🆘 Show Help Menu",
        style: "primary",
      },
      {
        id: "check-balance",
        label: "💰 Check Balance",
        style: "primary",
      },
      {
        id: "more-info",
        label: "ℹ️ Network Info",
        style: "secondary",
      },
    ],
  };
};

/**
 * Check if this is the first interaction with a user
 */
export async function isFirstTimeInteraction(
  conversation: Conversation,
  clientInboxId: string,
): Promise<boolean> {
  try {
    const [messages, members] = await Promise.all([
      conversation.messages(),
      conversation.members(),
    ]);
    const hasSentBefore = messages.some(
      (msg) => msg.senderInboxId.toLowerCase() === clientInboxId.toLowerCase(),
    );
    const wasMemberBefore = members.some(
      (member: GroupMember) =>
        member.inboxId.toLowerCase() === clientInboxId.toLowerCase() &&
        member.installationIds.length > 1,
    );

    return !hasSentBefore && !wasMemberBefore;
  } catch (error) {
    console.error("Error checking message history:", error);
    return false;
  }
}
