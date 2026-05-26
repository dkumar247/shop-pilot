import { tool } from "ai";
import { z } from "zod";
import { SUBCONSCIOUS_MODEL_ID } from "@/lib/subconscious";

const ShoppingItemSchema = z.object({
  quantity: z.number().int().min(1),
  maxPrice: z.number().optional(),
  color: z.string().optional(),
  style: z.string().optional(),
  keywords: z.string().optional(),
});

const SHOPPING_LIST_JSON_SCHEMA = {
  type: "object",
  description: "Map of furniture items. Key = item name (lowercase singular).",
  additionalProperties: {
    type: "object",
    properties: {
      quantity: { type: "integer", minimum: 1, description: "Units to purchase" },
      maxPrice: { type: "number", description: "Maximum price in USD" },
      color:    { type: "string", description: "Color preference e.g. blue" },
      style:    { type: "string", description: "Style e.g. mid-century, modern" },
      keywords: { type: "string", description: "Extra search terms" },
    },
    required: ["quantity"],
    additionalProperties: false,
  },
};

export const parseShoppingRequest = tool({
  description:
    "Parse a natural language furniture request into a structured shopping list. Always call this first before any Wayfair tool.",
  inputSchema: z.object({
    request: z.string().describe("The user's raw furniture request"),
  }),
  execute: async ({ request }) => {
    const apiKey = process.env.SUBCONSCIOUS_API_KEY;
    const baseUrl =
      process.env.CLOUDFLARE_AI_GATEWAY_URL ?? "https://api.subconscious.dev/v1";

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: SUBCONSCIOUS_MODEL_ID,
        messages: [
          {
            role: "system",
            content:
              "Extract furniture items from the user's request. Return a JSON object where each key is a furniture item name (lowercase singular). Include quantity, maxPrice (USD number if mentioned), color, style, and keywords (extra descriptors).",
          },
          { role: "user", content: request },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "shopping_list", schema: SHOPPING_LIST_JSON_SCHEMA },
        },
        chat_template_kwargs: { enable_thinking: false },
        max_tokens: 300,
      }),
    });

    const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    const parsed = JSON.parse(data.choices[0].message.content) as Record<
      string,
      z.infer<typeof ShoppingItemSchema>
    >;
    return parsed;
  },
});

/**
 * Example tools for the hackathon starter.
 *
 * Add your own tools here — connect APIs, databases, Cloudflare Workers,
 * Baseten endpoints, or wrap MCP server tools (see lib/tools/mcp-tools.ts).
 */
export const getWeather = tool({
  description: "Get the current weather for a city",
  inputSchema: z.object({
    city: z.string().describe("City name, e.g. Boston"),
    units: z
      .enum(["fahrenheit", "celsius"])
      .optional()
      .describe("Temperature units"),
  }),
  execute: async ({ city, units = "fahrenheit" }) => {
    const tempF = 55 + Math.floor(Math.random() * 30);
    const tempC = Math.round(((tempF - 32) * 5) / 9);
    return {
      city,
      condition: ["sunny", "cloudy", "rainy", "windy"][
        Math.floor(Math.random() * 4)
      ],
      temperature: units === "celsius" ? tempC : tempF,
      units,
      source: "demo-tool",
    };
  },
});

export const calculate = tool({
  description: "Evaluate a basic math expression (numbers and + - * / parentheses)",
  inputSchema: z.object({
    expression: z
      .string()
      .describe("Math expression, e.g. (17 * 23) + 4"),
  }),
  execute: async ({ expression }) => {
    const sanitized = expression.replace(/[^0-9+\-*/().\s]/g, "");
    if (!sanitized.trim()) {
      return { error: "Invalid expression" };
    }
    const result = Function(`"use strict"; return (${sanitized})`)();
    return { expression, result };
  },
});

export const webSearch = tool({
  description:
    "Search the web for information. Replace this stub with Tavily, SerpAPI, or your own search API.",
  inputSchema: z.object({
    query: z.string().describe("Search query"),
    maxResults: z.number().min(1).max(10).optional(),
  }),
  execute: async ({ query, maxResults = 3 }) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    return {
      query,
      results: Array.from({ length: maxResults }, (_, i) => ({
        title: `Result ${i + 1} for "${query}"`,
        url: `https://example.com/search?q=${encodeURIComponent(query)}&r=${i + 1}`,
        snippet:
          "Replace lib/tools/index.ts webSearch with a real API call during the hackathon.",
      })),
      note: "Stub — wire up a real search provider to go further.",
    };
  },
});

export const runLongTask = tool({
  description:
    "Run a multi-step background task. Use for demos of long-running agent work.",
  inputSchema: z.object({
    taskName: z.string().describe("Short label for the task"),
    steps: z
      .number()
      .min(1)
      .max(8)
      .optional()
      .describe("Number of simulated steps"),
  }),
  execute: async ({ taskName, steps = 4 }) => {
    const log: string[] = [];
    for (let i = 1; i <= steps; i++) {
      await new Promise((resolve) => setTimeout(resolve, 600));
      log.push(`Step ${i}/${steps}: processed "${taskName}"`);
    }
    return {
      taskName,
      status: "complete",
      stepsCompleted: steps,
      log,
    };
  },
});

export const chatTools = {
  getWeather,
  calculate,
};

export const agentTools = {
  parseShoppingRequest,
  getWeather,
  calculate,
  webSearch,
  runLongTask,
};
