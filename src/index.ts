/**
 * LLM Chat Application Template
 *
 * A simple chat application using Cloudflare Workers AI.
 * This template demonstrates how to implement an LLM-powered chat interface with
 * streaming responses using Server-Sent Events (SSE).
 *
 * @license MIT
 */
import { Env, ChatMessage } from "./types";

// Model ID for Workers AI model
// https://developers.cloudflare.com/workers-ai/models/
const MODEL_ID = "@cf/openai/gpt-oss-120b";

// Default system prompt
const SYSTEM_PROMPT =
  "You are a helpful, friendly assistant. Provide concise and accurate responses.";

export default {
  /**
   * Main request handler for the Worker
   */
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // Handle static assets (frontend)
    if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    // API Routes
    if (url.pathname === "/api/chat") {
      // Handle POST requests for chat
      if (request.method === "POST") {
        return handleChatRequest(request, env);
      }

      // Method not allowed for other request types
      return new Response("Method not allowed", { status: 405 });
    }

    // Handle 404 for unmatched routes
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

/**
 * Handles chat API requests
 */
async function handleChatRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    const { messages = [] } = (await request.json()) as {
      messages: ChatMessage[];
    };

    // システムメッセージを除外（instructionsで指定するため）
    const userMessages = messages.filter((msg) => msg.role !== "system");

    // gpt-oss-120b用の呼び出し
    const aiResponse = await env.AI.run(MODEL_ID, {
      instructions: SYSTEM_PROMPT,
      input: userMessages,
      stream: true
    });

    // ReadableStreamをSSE形式に変換
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    // バックグラウンドでストリーム処理
    (async () => {
      try {
        // aiResponseがReadableStreamの場合
        if (aiResponse && typeof aiResponse === 'object' && 'getReader' in aiResponse) {
          const reader = aiResponse.getReader();
          const decoder = new TextDecoder();

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const text = decoder.decode(value, { stream: true });
            
            // SSE形式で送信
            await writer.write(
              encoder.encode(JSON.stringify({ response: text }) + "\n")
            );
          }
        } else {
          // ストリームでない場合
          const text = typeof aiResponse === 'string' ? aiResponse : JSON.stringify(aiResponse);
          await writer.write(
            encoder.encode(JSON.stringify({ response: text }) + "\n")
          );
        }
      } catch (error) {
        console.error("Stream processing error:", error);
      } finally {
        await writer.close();
      }
    })();

    return new Response(readable, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "connection": "keep-alive",
      },
    });

  } catch (error) {
    console.error("Error processing chat request:", error);
    return new Response(
      JSON.stringify({ 
        error: "Failed to process request",
        details: error instanceof Error ? error.message : String(error)
      }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      },
    );
  }
}
