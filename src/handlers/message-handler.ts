import { ContentTypeWalletSendCalls } from "@xmtp/content-type-wallet-send-calls";
import type { Conversation } from "@xmtp/node-sdk";
import { ContentTypeActions } from "@/types/actions-content";
import type { IntentContent } from "@/types/intent-content";
import {
  handleActionsCommand,
  handleActionsWithImagesCommand,
  handleHelpCommand,
} from "./actions-handler";
import { bitteHandler } from "./bitte-handler";
import type { TokenHandler } from "./token-handler";
import { getWelcomeMessage, isFirstTimeInteraction } from "./welcome";

export async function handleTextMessage(
  conversation: Conversation,
  messageContent: string,
  senderAddress: string,
  agentAddress: string,
  tokenHandler: TokenHandler,
) {
  // Check if this is the first-time interaction
  const isFirstTime = await isFirstTimeInteraction(conversation, senderAddress);

  // Handle first-time interactions with welcome actions
  if (isFirstTime) {
    const welcomeMessage = getWelcomeMessage();
    console.log("👋 Sending welcome message with actions");
    await conversation.send(welcomeMessage, ContentTypeActions);
    return;
  }

  const command = messageContent.toLowerCase().trim();

  // Check for specific commands first
  switch (true) {
    case command === "/help" || command.toLowerCase() === "gm":
      await handleHelpCommand(conversation, tokenHandler);
      break;

    case command.startsWith("/actions"):
      await handleActionsCommand(conversation, tokenHandler);
      break;

    case command.startsWith("/actions-with-images"):
      await handleActionsWithImagesCommand(conversation, tokenHandler);
      break;

    case command.startsWith("/send "):
      await handleSendCommand(
        conversation,
        command,
        senderAddress,
        agentAddress,
        tokenHandler,
      );
      break;

    case command.startsWith("/balance "):
      await handleBalanceCommand(
        conversation,
        command,
        agentAddress,
        tokenHandler,
      );
      break;

    case command === "/info":
      await handleInfoCommand(conversation, tokenHandler);
      break;

    case command === "/ping" || command.toLowerCase() === "ping":
      await conversation.send("pong");
      break;

    default:
      // Use Bitte AI handler for natural language processing
      console.log("🤖 Processing message with Bitte AI agent");
      try {
        const response = await bitteHandler({
          chatId: conversation.id,
          message: messageContent,
          evmAddress: senderAddress,
          contextMessage: `You are being called from a XMTP chat within TBA (The Base App).  Keep responses conscise, this is a DM chat.  Use Text and emojis only, no text formatting or markdown.
User's wallet address: ${senderAddress}
Current network: ${tokenHandler.getNetworkInfo().name}`,
        });

        if (response.content) {
          await conversation.send(response.content);
        }

        // Process any tool calls from the AI response
        if (response.toolCalls && response.toolCalls.length > 0) {
          for (const toolCall of response.toolCalls) {
            console.log(`🔧 Processing tool call: ${toolCall.toolName}`);
            // Handle specific tool calls if needed
            // This could be extended to handle custom tools

            
          }
        }
      } catch (error) {
        console.error("❌ Error processing with Bitte AI:", error);
        await conversation.send(
          "🤖 I had trouble understanding that. Try `/help` to see available commands!",
        );
      }
      break;
  }
}

export async function handleSendCommand(
  conversation: Conversation,
  command: string,
  senderAddress: string,
  agentAddress: string,
  tokenHandler: TokenHandler,
  includeMetadata: boolean = false,
  usePaymaster: boolean = false,
) {
  const parts = command.split(" ");
  if (parts.length !== 3) {
    await conversation.send(
      "❌ Invalid format\n\nUse: /send <AMOUNT> <TOKEN>\nExample: /send 0.1 USDC",
    );
    return;
  }

  const amount = parseFloat(parts[1]);
  const token = parts[2].toUpperCase();

  if (Number.isNaN(amount) || amount <= 0) {
    await conversation.send(
      "❌ Invalid amount. Please provide a positive number.",
    );
    return;
  }

  try {
    // Validate token is supported
    tokenHandler.getTokenConfig(token);

    const walletSendCalls = tokenHandler.createTokenTransferCalls({
      from: senderAddress,
      to: agentAddress,
      amount: amount,
      token: token,
      networkId: tokenHandler.getNetworkInfo().id,
      includeMetadata,
      usePaymaster,
    });

    console.log(
      `💸 Created transfer request: ${amount} ${token} from ${senderAddress}${
        usePaymaster ? " with paymaster" : ""
      }`,
    );
    await conversation.send(walletSendCalls, ContentTypeWalletSendCalls);

    await conversation.send(
      `✅ Transaction request created!

DETAILS:
• Amount: ${amount} ${token}
• To: ${agentAddress}
• Network: ${tokenHandler.getNetworkInfo().name}${
        usePaymaster
          ? "\n• Paymaster: Enabled (gas fees sponsored)\n• Rich Metadata: Included automatically"
          : ""
      }${includeMetadata && !usePaymaster ? "\n• Rich Metadata: Included" : ""}

💡 Please approve the transaction in your wallet.
📋 Optionally share the transaction reference when complete.`,
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Enhanced error handling for wallet send calls
    if (
      errorMessage.toLowerCase().includes("insufficient gas") ||
      errorMessage.toLowerCase().includes("out of gas") ||
      errorMessage.toLowerCase().includes("gas limit") ||
      errorMessage.toLowerCase().includes("intrinsic gas too low") ||
      errorMessage.toLowerCase().includes("gas required exceeds allowance")
    ) {
      console.error(`⛽ Gas error for wallet send calls: ${errorMessage}`);
      await conversation.send(`⛽ **Gas Error**: Transaction cannot be prepared due to insufficient gas.

**Details**: ${errorMessage}

**Solutions**:
• Increase gas limit in your wallet
• Ensure you have enough ETH for gas fees
• Try a smaller transaction amount`);
    } else if (
      errorMessage.toLowerCase().includes("insufficient funds") ||
      errorMessage.toLowerCase().includes("insufficient balance")
    ) {
      console.error(
        `💰 Insufficient funds error for wallet send calls: ${errorMessage}`,
      );
      await conversation.send(`💰 **Insufficient Funds**: ${errorMessage}

**Solutions**:
• Check your wallet balance
• Ensure you have enough tokens + gas fees`);
    } else {
      console.error(`❌ Wallet send calls error: ${errorMessage}`);
      await conversation.send(`❌ ${errorMessage}`);
    }
  }
}

export async function handleBalanceCommand(
  conversation: Conversation,
  command: string,
  agentAddress: string,
  tokenHandler: TokenHandler,
) {
  const parts = command.split(" ");
  if (parts.length !== 2) {
    await conversation.send(
      "❌ Invalid format\n\nUse: /balance <TOKEN>\nExample: /balance USDC",
    );
    return;
  }

  const token = parts[1].toUpperCase();

  try {
    const balance = await tokenHandler.getTokenBalance(agentAddress, token);
    await conversation.send(
      `💰 Bot Balance

Token: ${token}
Balance: ${balance} ${token}
Network: ${tokenHandler.getNetworkInfo().name}`,
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await conversation.send(`❌ ${errorMessage}`);
  }
}

export async function handleInfoCommand(
  conversation: Conversation,
  tokenHandler: TokenHandler,
) {
  const networkInfo = tokenHandler.getNetworkInfo();
  const { getAvailableNetworks } = await import("./token-handler");
  const availableNetworks = getAvailableNetworks();

  const infoMessage = `ℹ️ Network Information

CURRENT NETWORK:
• Name: ${networkInfo.name}
• ID: ${networkInfo.id}
• Chain ID: ${networkInfo.chainId}

SUPPORTED TOKENS:
${networkInfo.supportedTokens.map((token) => `• ${token}`).join("\n")}

AVAILABLE NETWORKS:
${availableNetworks.map((net) => `• ${net}`).join("\n")}

CONTENT TYPES:
• Wallet Send Calls (EIP-5792)
• Transaction Reference
• Inline Actions
• Paymaster Service Capability

🔗 Test at: https://xmtp.chat`;

  await conversation.send(infoMessage);
}

export async function handleIntentMessage(
  conversation: Conversation,
  intentContent: IntentContent,
  senderAddress: string,
  agentAddress: string,
  tokenHandler: TokenHandler,
) {
  console.log(
    `🎯 Processing intent: ${intentContent.actionId} for actions: ${intentContent.id}`,
  );

  try {
    // First, try to process with Bitte AI for intelligent handling
    const intentDescription = getIntentDescription(intentContent.actionId);

    console.log("🤖 Processing intent with Bitte AI agent");
    const response = await bitteHandler({
      chatId: conversation.id,
      message: intentDescription,
      evmAddress: senderAddress,
      contextMessage: `User clicked an action button with ID: ${
        intentContent.actionId
      }

Available actions:
- help: Show help message
- check-balance: Check USDC balance
- more-info: Show network information
- send-small: Send 0.005 USDC
- send-large: Send 1 USDC

User's wallet address: ${senderAddress}
Bot's wallet address: ${agentAddress}
Current network: ${tokenHandler.getNetworkInfo().name}

Please process this action appropriately.`,
      instructionsOverride:
        "Process the user's action request and provide helpful information or execute the requested command.",
    });

    if (response.content) {
      await conversation.send(response.content);
    }

    // Fallback to direct command execution based on action ID
    switch (intentContent.actionId) {
      case "help":
        if (!response.content) {
          await handleHelpCommand(conversation, tokenHandler);
        }
        break;

      case "check-balance":
        console.log("💰 Executing balance check");
        await handleBalanceCommand(
          conversation,
          "/balance USDC",
          agentAddress,
          tokenHandler,
        );
        break;

      case "more-info":
        if (!response.content) {
          console.log("ℹ️ Showing more info");
          await handleInfoCommand(conversation, tokenHandler);
        }
        break;

      case "send-small":
        console.log("💸 Executing small USDC send");
        await handleSendCommand(
          conversation,
          "/send 0.005 USDC",
          senderAddress,
          agentAddress,
          tokenHandler,
        );
        break;

      case "send-large":
        console.log("💸 Executing large USDC send");
        await handleSendCommand(
          conversation,
          "/send 1 USDC",
          senderAddress,
          agentAddress,
          tokenHandler,
        );
        break;

      default:
        if (!response.content) {
          await conversation.send(
            `❌ Unknown action: ${intentContent.actionId}`,
          );
          console.log(`❌ Unknown action ID: ${intentContent.actionId}`);
        }
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("❌ Error processing intent:", errorMessage);
    await conversation.send(`❌ Error processing action: ${errorMessage}`);
  }
}

/**
 * Helper function to convert intent action IDs to natural language descriptions
 */
function getIntentDescription(actionId: string): string {
  const descriptions: Record<string, string> = {
    help: "Show me the available commands and how to use them",
    "check-balance": "Check the USDC balance",
    "more-info": "Show me detailed network information",
    "send-small": "Send 0.005 USDC",
    "send-large": "Send 1 USDC",
  };

  return descriptions[actionId] || `Execute action: ${actionId}`;
}
