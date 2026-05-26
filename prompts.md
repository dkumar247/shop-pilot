# Hackathon Claude Code Prompts
**Wayfair Agent Hack — 100-minute sprint**
Copy-paste these into Claude Code exactly as written. Do not paraphrase.

---

## BLOCK 1 — 0–8 min | Setup (manual, no prompts)

Both devs together — no Claude Code needed yet.

```bash
pnpm dev                                          # confirm http://localhost:3000 loads
pnpm add playwright
node_modules/.bin/playwright install chromium
pnpm add @aws-sdk/client-s3
```

Fill in `.env.local` with all keys before running any prompts below.
Dev B: start BaseTen Whisper deployment NOW (3–5 min cold start).

---

## BLOCK 2 — 8–20 min | Parallel

---

### DEV A — Prompt 1: Playwright browser skeleton

> Paste into Claude Code:

```
In this Next.js repo, create lib/tools/wayfair.ts with Playwright (Node.js).

The file should export these async functions:

1. launchBrowser() — launches a chromium browser with { headless: false } so we can see it during the demo. Returns { browser, page }. Keep the browser instance in a module-level variable so subsequent tool calls reuse it.

2. searchWayfair(query: string) — navigates to https://www.wayfair.com/keyword.php?keyword=<encoded query> and waits for the results page to load. Returns { url: string, query: string }.

3. getProducts() — on the current search results page, scrapes the first 5 products. For each product extracts: name, price (as string), productUrl. Returns { products: Array<{ name, price, productUrl }> }.

4. addToCart(productUrl: string) — navigates to the product URL, waits for the page to load, clicks the "Add to Cart" button. Returns { success: boolean, productName: string }.

Use real Playwright selectors. Add a test block at the bottom behind `if (require.main === module)` that calls searchWayfair("blue mid century sofa") then getProducts() and logs the result.

Do not register these as AI SDK tools yet — just export the raw async functions. We will wire them up in the next step.
```

**Done when:** `npx tsx lib/tools/wayfair.ts` opens a Chromium window and logs product results.

---

### DEV B — Prompt 2: BaseTen Whisper transcription route

> Paste into Claude Code:

```
In this Next.js repo, create app/api/transcribe/route.ts.

This is a Next.js App Router route handler. It should:

1. Accept a POST request with multipart form data containing a field called "audio" (a Blob/File of audio).
2. Read BASETEN_WHISPER_URL and BASETEN_API_KEY from process.env. If either is missing, return a 500 with { error: "Missing BaseTen config" }.
3. Forward the audio file as multipart/form-data to the BaseTen Whisper endpoint. BaseTen Whisper expects the field name "audio". Set the Authorization header to "Api-Key <BASETEN_API_KEY>".
4. Parse the BaseTen response — it returns JSON with a "transcription" field containing the text string.
5. Return Response.json({ transcript: string }).

Also add a fallback: if BASETEN_WHISPER_URL is not set, use the browser Web Speech API approach — return Response.json({ transcript: "", fallback: true }) so the frontend knows to use window.SpeechRecognition instead.

Use native fetch — no extra npm packages needed.
```

**Done when:** `curl -X POST http://localhost:3000/api/transcribe -F audio=@test.m4a` returns `{ "transcript": "..." }`.

---

## BLOCK 3 — 20–40 min | Parallel

---

### DEV A — Prompt 3: Full Wayfair tool set

> Paste into Claude Code:

```
Extend lib/tools/wayfair.ts with 3 more exported async functions:

1. applyPriceFilter(maxPrice: number) — do NOT click DOM elements. Instead rebuild the current page URL adding the query parameter &price_max=<maxPrice> (inspect Wayfair's network tab to confirm the exact param — common ones are price_max, max_price, or pricemax). Navigate to the new URL and wait for results to reload. Returns { url: string, maxPrice: number }.

2. readProductDescription(productUrl: string) — navigate to that product page. Extract: name (the h1 or main product title), price (the displayed price string), description (first 300 chars of the product description text). Returns { name, price, description }.

3. getCartSummary() — navigate to https://www.wayfair.com/checkout/cart. Wait for the cart page to load. Scrape: list of item names, list of item prices, and the order total. Returns { items: Array<{ name, price }>, total: string }.

Keep the shared browser/page module-level variable from the previous file — all functions reuse the same browser session.

Extend the test block at the bottom to run the full sequence: searchWayfair → applyPriceFilter → getProducts → readProductDescription on products[0].productUrl → addToCart → getCartSummary. Log the cart summary at the end.
```

**Done when:** test script runs the full sequence and prints a cart summary.

---

### DEV A — Prompt 4: Register tools in the agent (run after Prompt 3)

> Paste into Claude Code:

```
In this Next.js repo:

1. In lib/tools/index.ts, import the Playwright functions from lib/tools/wayfair.ts and wrap each one as a Vercel AI SDK tool() using zod input schemas:

   - searchWayfair: input { query: string }
   - applyPriceFilter: input { maxPrice: number }
   - getProducts: no input
   - readProductDescription: input { productUrl: string }
   - addToCart: input { productUrl: string }
   - getCartSummary: no input

   Each tool's description must be clear enough for the LLM to know when to call it. Export them all as a wayfairTools object.

2. In lib/tools/index.ts, add wayfairTools to the agentTools export so the research agent can use them.

3. In lib/agents/index.ts, replace the AGENT_INSTRUCTIONS string with this exact text:

   You are a Wayfair shopping agent. The user will describe a furniture item they want. Your job is to buy it for them.

   Follow these steps in order every time:
   1. Call searchWayfair with the core item type (e.g. "blue mid century sofa").
   2. Call getProducts to see what is available.
   3. If the user mentioned a price limit, call applyPriceFilter with that amount, then call getProducts again.
   4. Call readProductDescription on the top 1-2 results to choose the best match.
   5. Call addToCart with the chosen product URL.
   6. Call getCartSummary and return it as your final message.

   Never skip steps. Never call addToCart without first calling readProductDescription. If a tool fails, try the next product instead of stopping.

Do not modify app/api/chat/route.ts — it already wires the agent correctly.
```

**Done when:** agent mode in the UI calls tools in the right order when you type "blue sofa under $700".

---

### DEV B — Prompt 5: Cloudflare R2 audio upload route

> Paste into Claude Code:

```
In this Next.js repo, create app/api/upload-audio/route.ts.

This is a Next.js App Router route handler. It should:

1. Accept a POST request where the body is a raw audio blob (binary).
2. Read these env vars: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_R2_BUCKET, CLOUDFLARE_R2_ACCESS_KEY, CLOUDFLARE_R2_SECRET_KEY. If any are missing return 500 with { error: "Missing Cloudflare config" }.
3. Create an S3Client pointed at Cloudflare R2:
   - endpoint: `https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`
   - region: "auto"
   - credentials: { accessKeyId: CLOUDFLARE_R2_ACCESS_KEY, secretAccessKey: CLOUDFLARE_R2_SECRET_KEY }
4. Generate a unique key: `audio/${Date.now()}-${crypto.randomUUID()}.webm`
5. Upload the audio body to R2 using PutObjectCommand with ContentType "audio/webm".
6. Return Response.json({ key: string }).

Use @aws-sdk/client-s3 which is already installed. Use native crypto.randomUUID().
```

**Done when:** `curl -X POST http://localhost:3000/api/upload-audio --data-binary @test.m4a` returns `{ "key": "audio/..." }` and the object appears in the Cloudflare R2 dashboard.

---

## ✅ COMMIT 1 — after Checkpoint 1 (minute ~55)

**Condition:** agent mode works end-to-end in the UI — typed text → Playwright browses Wayfair → real item in cart → summary in chat. Verify this before committing.

```bash
git add lib/tools/wayfair.ts lib/tools/index.ts lib/agents/index.ts app/api/transcribe/route.ts app/api/upload-audio/route.ts
git commit -m "add wayfair playwright tools, agent prompt, transcribe and r2 upload routes"
git push origin main
```

---

## BLOCK 4 — 60–75 min | Parallel

---

### DEV B — Prompt 6: Voice mic UI + cart summary card

> Paste into Claude Code:

```
In this Next.js repo, update components/chat-app.tsx. Replace the text input area with a voice-first UI while keeping the streaming agent message display intact.

Changes needed:

1. REPLACE the text input and send button with:
   - A large centered mic button. On click: start recording using the MediaRecorder API (mimeType: "audio/webm"). Button turns red while recording. On second click: stop recording.
   - Below the mic button: a small "or type instead" toggle that shows the original text input if clicked (fallback for when mic isn't needed).

2. WIRE the recording flow:
   - On recording stop: POST the audio blob to /api/upload-audio (raw binary body, Content-Type: audio/webm). Get back { key }.
   - POST { key } to /api/transcribe as JSON. Get back { transcript }.
   - Display the transcript in a small grey pill above the mic button: "Heard: <transcript text>".
   - Automatically send the transcript as a message to the agent (call sendMessage with the transcript text, mode forced to "agent").

3. ADD a cart summary card: after the message list, check if the last assistant message's tool results include a getCartSummary call with output-available state. If yes, render a card below the chat with:
   - Product name in large text
   - Price in green
   - A "View cart on Wayfair →" button linking to https://www.wayfair.com/checkout/cart
   - Subtle orange border matching the existing #FF5C28 brand color

4. Keep all existing MessagePart rendering, tool call bubbles, and streaming behavior exactly as-is.

5. Add a loading state between transcript appearing and the first agent token arriving: show "Agent shopping on Wayfair…" with the existing pulse animation.
```

**Done when:** clicking mic → speaking → stopping → transcript appears → agent starts automatically → cart card renders.

---

### DEV A — Prompt 7: Wire transcribe to use R2 key

> Paste into Claude Code:

```
Update app/api/transcribe/route.ts to support two calling patterns:

Pattern 1 (existing): POST with multipart form-data containing "audio" blob — transcribe directly.

Pattern 2 (new): POST with JSON body { key: string } — read the audio file from Cloudflare R2 by that key, then transcribe it.

For pattern 2:
- Create an S3Client using the same config as app/api/upload-audio/route.ts (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_R2_BUCKET, CLOUDFLARE_R2_ACCESS_KEY, CLOUDFLARE_R2_SECRET_KEY).
- Use GetObjectCommand to fetch the audio bytes by key.
- Convert the stream to a Buffer, then forward it as multipart to BaseTen exactly like pattern 1.
- Delete the R2 object after transcription using DeleteObjectCommand (clean up after ourselves).

Detect which pattern based on Content-Type header: application/json → pattern 2, multipart/form-data → pattern 1.

Keep the same response shape: Response.json({ transcript: string }).
```

**Done when:** `curl -X POST http://localhost:3000/api/transcribe -H "Content-Type: application/json" -d '{"key":"audio/test.webm"}'` returns a transcript.

---

## ✅ COMMIT 2 — after Block 4 (minute ~75)

**Condition:** full voice flow works end-to-end — speak into mic → transcript → agent browses Wayfair → cart summary card appears. Verify once before committing.

```bash
git add components/chat-app.tsx app/api/transcribe/route.ts
git commit -m "add voice mic UI, cart summary card, R2-backed transcription flow"
git push origin main
```

---

## CHECKPOINT 2 — 75–88 min | Polish + AI Gateway

---

### DEV A — Prompt 8: Cloudflare AI Gateway swap

> Paste into Claude Code:

```
In lib/subconscious.ts, update the SUBC_BASE_URL constant so it reads from an env var with the existing URL as fallback:

const SUBC_BASE_URL = process.env.CLOUDFLARE_AI_GATEWAY_URL ?? "https://api.subconscious.dev/v1";

No other changes. Do not touch any other file.
```

After running this prompt:
1. Go to Cloudflare dashboard → AI Gateway → create gateway named "wayfair-agent"
2. Copy the gateway URL into `.env.local` as `CLOUDFLARE_AI_GATEWAY_URL`
3. Restart `pnpm dev` and run one full voice flow to confirm the gateway logs show the request

---

### DEV B — Prompt 9: UI polish

> Paste into Claude Code:

```
In components/chat-app.tsx, make these visual polish changes:

1. The mic button: make it larger (at least 80px diameter), add a pulse ring animation while recording (CSS keyframe scale + opacity pulse on a pseudo-ring div around the button).

2. Agent steps: verify the tool call bubbles in MessagePart render one at a time as they stream. If they all appear at once, this is already handled by the streaming — just confirm visually.

3. Cart summary card: make the product name font-size larger (text-xl or text-2xl), price in a bright green (#22c55e), and the "View cart" button styled with a solid Wayfair orange (#FF5C28) background with black text. Add a subtle shadow to the whole card.

4. Header: update the h1 text from "Chat + Agents on Subconscious" to "Wayfair Shopping Agent". Update the subtitle from the generic text to "Speak your request. Agent shops Wayfair. Item lands in your cart."

5. Empty state: replace the generic example prompts with: "Click the mic and say: I want a blue mid-century sofa under $700"

Do not touch any logic, routing, or tool call handling — visual changes only.
```

**Done when:** UI looks demo-ready — clean mic button, clear cart card, updated header.

---

## ✅ COMMIT 3 — after Checkpoint 2 (minute ~85)

**Condition:** full voice flow runs cleanly twice in a row. AI Gateway shows logs. UI is polished.

```bash
git add lib/subconscious.ts components/chat-app.tsx
git commit -m "ai gateway integration and UI polish for demo"
git push origin main
```

---

## FALLBACK PROMPTS — use only if behind schedule

---

### FALLBACK A — If Playwright selectors break

> Paste into Claude Code:

```
In lib/tools/wayfair.ts, add a fallback to the getProducts() function.

If the existing CSS selector approach returns 0 products (selector not found or empty results), fall back to:
1. Call page.content() to get the full HTML of the current page.
2. Return { rawHtml: string, products: [] } so the agent can parse it.

Also add a new exported async function extractProductsFromHtml(rawHtml: string) that uses a regex or simple string matching to find product names and prices from the HTML — no selectors needed. Pattern: look for JSON-LD script tags with @type Product, or og:title meta tags.

This ensures we always return something even if Wayfair changes their DOM.
```

---

### FALLBACK B — If BaseTen is down or slow

> Paste into Claude Code:

```
In components/chat-app.tsx, add a Web Speech API fallback to the mic recording flow.

Before starting MediaRecorder, check if window.SpeechRecognition or window.webkitSpeechRecognition is available.

If yes: use SpeechRecognition instead of MediaRecorder. Start recognition on mic button click, stop on second click. On the result event, set the transcript directly — skip /api/upload-audio and /api/transcribe entirely.

If no: use the existing MediaRecorder → R2 → BaseTen flow.

Add a small text indicator under the mic button: "Using device transcription" or "Using BaseTen Whisper" so we know which path is active.
```

---

### FALLBACK C — If voice input is taking too long (cut it entirely)

> Paste into Claude Code:

```
In components/chat-app.tsx, revert the mic button area back to a standard text input. Keep all agent streaming logic, tool call bubbles, and cart summary card exactly as-is. 

The input should:
- Be a full-width text input with placeholder "Describe what furniture you want..."
- On submit (enter or send button), send the message directly to the agent in Agent mode (force mode="agent" for all sends).
- Show the same "Agent shopping on Wayfair…" loading state while the agent runs.

Do not touch MessagePart, the cart summary card, or any API routes.
```

---

## Quick Reference

| Prompt | Dev | File | Minute |
|---|---|---|---|
| 1 — Playwright skeleton | A | `lib/tools/wayfair.ts` | 8 |
| 2 — BaseTen Whisper route | B | `app/api/transcribe/route.ts` | 8 |
| 3 — Full Wayfair tools | A | `lib/tools/wayfair.ts` | 20 |
| 4 — Register tools + agent prompt | A | `lib/tools/index.ts`, `lib/agents/index.ts` | 35 |
| 5 — Cloudflare R2 upload | B | `app/api/upload-audio/route.ts` | 20 |
| **COMMIT 1** | Both | — | ~55 |
| 6 — Voice mic UI + cart card | B | `components/chat-app.tsx` | 60 |
| 7 — Wire R2 → transcribe | A | `app/api/transcribe/route.ts` | 60 |
| **COMMIT 2** | Both | — | ~75 |
| 8 — AI Gateway swap | A | `lib/subconscious.ts` | 75 |
| 9 — UI polish | B | `components/chat-app.tsx` | 75 |
| **COMMIT 3** | Both | — | ~85 |
