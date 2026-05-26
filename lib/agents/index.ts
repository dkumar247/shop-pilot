import { ToolLoopAgent, stepCountIs } from "ai";
import { subconsciousModel } from "@/lib/subconscious";
import { agentTools, chatTools } from "@/lib/tools";
import { createMcpTools } from "@/lib/tools/mcp-tools";

const CHAT_INSTRUCTIONS = `You are a helpful hackathon assistant powered by Subconscious (TIM-Qwen3.6).

You can use tools when they help answer the user. Keep replies concise and practical.
When the user attaches an image, describe what you see and answer their question.
If you need more steps or research, suggest they switch to Agent mode.`;

const AGENT_INSTRUCTIONS = `You are a Wayfair shopping agent. The user will describe furniture they want in plain English.

Always follow these steps in order:
1. Call parseShoppingRequest with the user's exact message to extract structured intent (item, quantity, maxPrice, color, style).
2. For each item in the result, call searchWayfair using the item name plus color and style as the query (e.g. "blue mid-century sofa").
3. Call getProducts to see available results.
4. If maxPrice is set, call applyPriceFilter with that value, then call getProducts again.
5. Call readProductDescription on the top 1-2 results to pick the best match.
6. Call addToCart with the chosen product URL.
7. Call getCartSummary and return it as your final response.

Never skip steps. Never call addToCart without reading the description first.
If a tool fails, try the next product rather than stopping.`;

/** Quick chat with a small tool set. */
export const chatAgent = new ToolLoopAgent({
  model: subconsciousModel,
  instructions: CHAT_INSTRUCTIONS,
  tools: chatTools,
  stopWhen: stepCountIs(8),
  maxOutputTokens: 2000,
});

/** Long-running agent with search, multi-step tasks, and MCP examples. */
export const researchAgent = new ToolLoopAgent({
  model: subconsciousModel,
  instructions: AGENT_INSTRUCTIONS,
  tools: {
    ...agentTools,
    ...createMcpTools(),
  },
  stopWhen: stepCountIs(30),
  maxOutputTokens: 4000,
});

export type AgentMode = "chat" | "agent";
