import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { transformStream } from "@crayonai/stream";
import { DBMessage, getMessageStore } from "./messageStore";
import { logInteraction } from "@/lib/agents/chat-widget/agent";


export async function POST(req: NextRequest) {
  const t0 = Date.now();
  const { prompt, threadId, responseId } = (await req.json()) as {
    prompt: DBMessage;
    threadId: string;
    responseId: string;
  };
  const client = new OpenAI({
    baseURL: "https://api.thesys.dev/v1/embed/",
    apiKey: process.env.THESYS_API_KEY,
  });
  const messageStore = getMessageStore(threadId);

  messageStore.addMessage(prompt);

  const llmStream = await client.chat.completions.create({
    model: "c1/openai/gpt-5/v-20250915",
    messages: messageStore.getOpenAICompatibleMessageList(),
    stream: true,
    tools: [
      {
        type: "function",
        function: {
          name: "createBooking",
          description: "Show a form to create a new logistics booking",
          parameters: {
            type: "object",
            properties: {
              origin: {
                type: "string",
                description: "The origin location if provided by user",
              },
              destination: {
                type: "string",
                description: "The destination location if provided by user",
              },
            },
          },
        },
      },
    ],
  });

  const responseStream = transformStream(
    llmStream,
    (chunk) => {
      return chunk.choices?.[0]?.delta?.content ?? "";
    },
    {
      onEnd: ({ accumulated }) => {
        const message = accumulated.filter((message) => message).join("");
        messageStore.addMessage({
          role: "assistant",
          content: message,
          id: responseId,
        });
        // Log to agent_runs for ecosystem visibility (fire-and-forget)
        const toolsUsed = message.includes('createBooking') ? ['createBooking'] : [];
        logInteraction({
          threadId,
          messageCount: messageStore.getOpenAICompatibleMessageList().length,
          toolsUsed,
          durationMs: Date.now() - t0,
        });
      },
    }
  ) as ReadableStream<string>;

  return new NextResponse(responseStream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
