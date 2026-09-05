import OpenAI from "openai";
import { sessionStore, GuardrailOptions } from "@/lib/agents/conversational-guardrails";

export type DBMessage = OpenAI.Chat.ChatCompletionMessageParam & {
  id?: string;
};

export const getMessageStore = (threadId: string, tenantId = "default") => {
  return {
    addMessage: (message: DBMessage) => {
      sessionStore.addMessage(tenantId, threadId, message);
    },
    get messageList() {
      return sessionStore.getMessages(tenantId, threadId);
    },
    getOpenAICompatibleMessageList: (guardrails: GuardrailOptions = { maxTotalMessages: 16 }) => {
      return sessionStore.getOpenAICompatibleMessageList(tenantId, threadId, guardrails);
    },
  };
};

