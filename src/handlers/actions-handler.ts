import type { Conversation } from "@xmtp/node-sdk";
import {
  type ActionsContent,
  ContentTypeActions,
} from "../types/actions-content";
import type { TokenHandler } from "./token-handler";

export async function handleActionsCommand(
  conversation: Conversation,
  _tokenHandler: TokenHandler
) {
  const actionsContent: ActionsContent = {
    id: `help-${Date.now()}`,
    description: "Glad to help you out! Here are some actions you can take:",
    actions: [
      {
        id: "send-small",
        label: "Send 0.005 USDC",
        style: "primary",
      },
      {
        id: "send-large",
        label: "Send 1 usdc",
        style: "primary",
      },
      {
        id: "check-balance",
        label: "Check balance",
        style: "primary",
      },
    ],
  };

  console.log("🎯 Sending inline actions help message");
  await conversation.send(actionsContent, ContentTypeActions);
}

export async function handleActionsWithImagesCommand(
  conversation: Conversation,
  _tokenHandler: TokenHandler
) {
  const actionsContent: ActionsContent = {
    id: `help-${Date.now()}`,
    description:
      "Glad to help you out! Here are some actions you can take with images:",
    actions: [
      {
        id: "send-small",
        label: "Send 0.005 USDC",
        style: "primary",
        imageUrl: "https://cataas.com/cat",
      },
      {
        id: "send-large",
        label: "Send 1 usdc",
        style: "primary",
        imageUrl: "https://cataas.com/cat",
      },
      {
        id: "check-balance",
        label: "Check balance",
        style: "primary",
        imageUrl: "https://cataas.com/cat",
      },
    ],
  };

  console.log("🎯 Sending inline actions help message");
  await conversation.send(actionsContent, ContentTypeActions);
}

export async function handleHelpCommand(
  conversation: Conversation,
  _tokenHandler: TokenHandler
) {
  const networkInfo = _tokenHandler.getNetworkInfo();

  const helpContent: ActionsContent = {
    id: `help-${Date.now()}`,
    description: `🆘 **Help Menu**

I'm here to help you interact on ${networkInfo.name}!

**Available Commands:**
• \`/send <amount> <token>\` - Send tokens (e.g., /send 0.1 USDC)
• \`/balance <token>\` - Check balance (e.g., /balance USDC)
• \`/info\` - Show network information
• \`/help\` - Show this help menu
• \`/ping\` - Check if I'm online

**Quick Actions:**`,
    actions: [
      {
        id: "send-small",
        label: "💸 Send 0.005 USDC",
        style: "primary",
      },
      {
        id: "send-large",
        label: "💰 Send 1 USDC",
        style: "primary",
      },
      {
        id: "check-balance",
        label: "📊 Check USDC Balance",
        style: "primary",
      },
      {
        id: "more-info",
        label: "ℹ️ Network Info",
        style: "secondary",
      },
    ],
  };

  console.log("🆘 Sending help message");
  await conversation.send(helpContent, ContentTypeActions);
}
