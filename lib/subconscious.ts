import { createOpenAI } from "@ai-sdk/openai";

export const SUBCONSCIOUS_MODEL_ID = "subconscious/tim-qwen3.6-27b";

const SUBC_BASE_URL = process.env.CLOUDFLARE_AI_GATEWAY_URL ?? "https://api.subconscious.dev/v1";

/**
 * Subconscious defaults thinking ON. TIM gates it via
 * `chat_template_kwargs.enable_thinking` on the wire — inject it in a fetch
 * override because the OpenAI SDK doesn't expose that param directly.
 */
function injectSubconsciousRequestOptions(
  init: RequestInit | undefined,
  enableThinking: boolean,
): RequestInit | undefined {
  if (!init?.body) {
    return init;
  }

  let bodyText: string | undefined;
  if (typeof init.body === "string") {
    bodyText = init.body;
  } else if (init.body instanceof Uint8Array) {
    bodyText = new TextDecoder().decode(init.body);
  }

  if (!bodyText) {
    return init;
  }

  try {
    const parsed = JSON.parse(bodyText) as Record<string, unknown>;
    const existingKwargs =
      (parsed.chat_template_kwargs as Record<string, unknown> | undefined) ?? {};
    parsed.chat_template_kwargs = {
      ...existingKwargs,
      enable_thinking: enableThinking,
    };
    parsed.stream_options = { include_usage: true };
    return { ...init, body: JSON.stringify(parsed) };
  } catch {
    return init;
  }
}

function createSubconsciousProvider(enableThinking: boolean) {
  return createOpenAI({
    baseURL: SUBC_BASE_URL,
    apiKey: process.env.SUBCONSCIOUS_API_KEY,
    fetch: async (url, init) => {
      return fetch(url, injectSubconsciousRequestOptions(init, enableThinking));
    },
  });
}

/** Thinking off by default — faster replies, no reasoning preamble. */
const subconscious = createSubconsciousProvider(false);

/** Chat completions API — Subconscious does not support /v1/responses. */
export const subconsciousModel = subconscious.chat(SUBCONSCIOUS_MODEL_ID);

export function requireSubconsciousApiKey() {
  const apiKey = process.env.SUBCONSCIOUS_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing SUBCONSCIOUS_API_KEY. Get one at https://www.subconscious.dev/platform",
    );
  }
  return apiKey;
}
