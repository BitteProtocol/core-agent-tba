import { openai } from "@ai-sdk/openai";
import {
  ContentTypeReaction,
  type Reaction,
} from "@xmtp/content-type-reaction";
import type { Conversation, DecodedMessage } from "@xmtp/node-sdk";
import { generateText } from "ai";

export const generateReaction = async ({
  messageContent,
  reference,
  referenceInboxId,
}: {
  messageContent: string;
  reference: string;
  referenceInboxId?: string;
}): Promise<Reaction> => {
  const emoji = await generateText({
    model: openai("gpt-4.1-nano"),
    prompt: `Return only a single emoji that matches the sentiment of this message: ${messageContent}. Do not include any other text or explanation.`,
  });

  return {
    reference,
    action: "added",
    content: emoji.text,
    schema: "unicode",
    referenceInboxId,
  };
};

export const handleReaction = async (
  message: DecodedMessage,
  conversation: Conversation,
  senderInboxId: string,
) => {
  if (!message.content) {
    return;
  }
  // Generate and send a reaction
  const reaction = await generateReaction({
    messageContent: message.content as string,
    reference: message.id,
    referenceInboxId: senderInboxId,
  });

  await conversation.send(reaction, ContentTypeReaction);
};
