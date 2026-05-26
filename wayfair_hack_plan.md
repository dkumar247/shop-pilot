# Wayfair Agent Hack — Execution Plan
**Beat The Clock Agent Hack @ Wayfair HQ | 100-minute sprint**

Stack: Subconscious + Playwright (Node) + BaseTen Whisper + Cloudflare R2 + AI Gateway + Next.js (this repo)

---

## Repo Overview

This is a Next.js 16 app with the Vercel AI SDK's `ToolLoopAgent` already wired to Subconscious. The starter is already running — do not re-scaffold anything.

```
lib/subconscious.ts            — model provider (swap AI Gateway URL here)
lib/tools/index.ts             — register Wayfair Playwright tools here
lib/tools/wayfair.ts           — NEW: Playwright browser tools
lib/agents/index.ts            — update system prompt to shopping agent
app/api/chat/route.ts          — existing streaming agent route (don't touch)
app/api/transcribe/route.ts    — NEW: BaseTen Whisper route
app/api/upload-audio/route.ts  — NEW: Cloudflare R2 upload route
components/chat-app.tsx        — replace text input with mic + cart summary UI
.env.local                     — all keys go here (already gitignored)
```

---

## Sprint Board

### Block 1 — 0–8 min | Environment setup + first questions | Both devs together

**What you're actually doing:**

- Walk up to organizers immediately. Ask: "Is there a Wayfair staging/sandbox URL for the hack?" Write it down before anything else.
- Confirm dev server is running: `pnpm dev` → http://localhost:3000 should load the chat UI.
- Install Playwright: `pnpm add playwright && node_modules/.bin/playwright install chromium`
- Add all keys to `.env.local`:
  ```
  SUBCONSCIOUS_API_KEY=sky_...          # already set
  BASETEN_API_KEY=xxx
  BASETEN_WHISPER_URL=xxx
  CLOUDFLARE_ACCOUNT_ID=xxx
  CLOUDFLARE_R2_BUCKET=wayfair-audio
  CLOUDFLARE_R2_ACCESS_KEY=xxx
  CLOUDFLARE_R2_SECRET_KEY=xxx
  CLOUDFLARE_AI_GATEWAY_URL=xxx         # fill in last
  ```
- Dev B: open baseten.co, log in, confirm free credits, start deploying Whisper now (takes 3–5 min).

**Done when:** `pnpm dev` runs cleanly, Playwright installs, BaseTen dashboard shows credits, staging URL written down.

> ⚠️ **Risk — no staging URL:** Hit bot detection on live Wayfair within 20–30 min.
> **Fallback:** use `playwright-extra` + `puppeteer-extra-plugin-stealth`: `pnpm add playwright-extra puppeteer-extra-plugin-stealth`

---

### Block 2 — 8–20 min | Parallel: BaseTen Whisper route + Playwright skeleton | Split

#### Dev A — Playwright Wayfair tools (`lib/tools/wayfair.ts`)

- Create `lib/tools/wayfair.ts`. Implement 4 async functions using `playwright` (Node):
  ```ts
  launchBrowser()           // chromium.launch(), returns { browser, page }
  searchWayfair(query)      // navigates to wayfair.com/keyword/..., returns product list
  getProducts()             // scrapes name, price, url from results page
  addToCart(productUrl)     // navigates to product page, clicks Add to Cart
  ```
- Open Wayfair in a real browser, right-click the search bar → inspect → copy the actual CSS selector. Paste it over any placeholder.
- Run a quick test: `npx tsx lib/tools/wayfair.ts` with a hardcoded query "blue sofa" — confirm chromium opens and lands on results.

**Done when:** chromium opens, navigates to search results, no crash.

#### Dev B — BaseTen Whisper route (`app/api/transcribe/route.ts`)

- On baseten.co: Model Library → Whisper → `whisper-large-v3` → Deploy → GPU: A10G → Deploy. Starts in 3–5 min.
- While it spins: create `app/api/transcribe/route.ts`:
  ```ts
  export async function POST(request: Request) {
    const formData = await request.formData();
    const audio = formData.get("audio") as Blob;
    // POST multipart to process.env.BASETEN_WHISPER_URL
    // Authorization: Api-Key ${process.env.BASETEN_API_KEY}
    // return Response.json({ transcript: string })
  }
  ```
- Once BaseTen endpoint is Active: copy endpoint URL into `.env.local` as `BASETEN_WHISPER_URL`.
- Test: `curl -X POST http://localhost:3000/api/transcribe -F audio=@test.m4a`

**Done when:** transcript text returns from the route matching what you said.

> ⚠️ **Risk — BaseTen cold start slow:**
> **Fallback:** use browser Web Speech API in the frontend (`window.SpeechRecognition`) — zero setup, no API key needed. Add a `useSpeechRecognition` hook in `components/chat-app.tsx` as an escape hatch.

---

### Block 3 — 20–40 min | Playwright tool expansion + Cloudflare R2 route | Split

#### Dev A — full Wayfair tool set (`lib/tools/wayfair.ts`)

- Add `applyPriceFilter(maxPrice: number)`: rebuild the search URL with `&price_max=800` directly (URL param approach — faster and more reliable than DOM clicks). Inspect Wayfair's network tab to confirm the exact param name.
- Add `readProductDescription(url: string) -> { name, price, description }`: navigate to product page, extract with `page.$eval`.
- Add `getCartSummary() -> { items, total }`: navigate to cart, read item names and total.
- Run a full manual sequence in a test script: `searchWayfair` → `applyPriceFilter` → `getProducts` → `readProductDescription` → `addToCart` → `getCartSummary`. Fix any selector errors.
- Register all tools in `lib/tools/index.ts` and add them to `agentTools`.

**Done when:** manual sequence runs start to finish, one product in cart, summary printed.

> ⚠️ **Risk — Wayfair DOM selectors wrong:**
> **Fallback:** use `page.content()` and pass raw HTML to the agent via a `extractProductData` tool — agent parses it with LLM. Slower but works on any DOM.

#### Dev B — Cloudflare R2 upload (`app/api/upload-audio/route.ts`)

- `pnpm add @aws-sdk/client-s3` (R2 is S3-compatible).
- Create `app/api/upload-audio/route.ts`:
  ```ts
  import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
  // endpoint: `https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`
  // region: "auto"
  // returns Response.json({ key: string })
  ```
- Test: `curl -X POST http://localhost:3000/api/upload-audio --data-binary @test.m4a`

**Done when:** route returns a key, object visible in Cloudflare R2 dashboard.

---

### ⏱ CHECKPOINT 1 — Minute 40: Wire agent tools + update system prompt | Both devs | 40–60 min

- Update `lib/agents/index.ts` — replace `AGENT_INSTRUCTIONS` with the shopping agent system prompt:
  ```
  You are a Wayfair shopping agent. Given a furniture request from the user:
  1. Always call searchWayfair first.
  2. Apply price/style filters before reading individual product pages.
  3. Call readProductDescription on the top 1–2 results to pick the best match.
  4. Call addToCart once you have chosen a product.
  5. Call getCartSummary and return it as your final response.
  Never skip steps. Never add to cart without reading the description first.
  ```
- Make sure all 5 Wayfair tools are in `agentTools` in `lib/tools/index.ts`.
- Switch to Agent mode in the UI at http://localhost:3000. Type: `"blue mid-century sofa under $800 in stock"`. Watch tool calls stream in the chat.
- Run it 2× with different queries. If tool call order is wrong: tighten the system prompt.

**✅ MVP checkpoint — typed text → Subconscious orchestrates Playwright → real item in Wayfair cart → summary in chat UI. Safety net if nothing else works.**

> ⚠️ **Risk — Subconscious tool calling unreliable:**
> **Fallback:** hardcode the sequence in `lib/tools/index.ts` as a single `shopWayfair(query, maxPrice)` tool that runs search → filter → add_to_cart internally. Use Subconscious only to parse `{ query, maxPrice }` from the user's natural language. Loses visible reasoning steps but still demos live browsing.

---

### Block 4 — 60–75 min | Voice UI + end-to-end wiring | Split

#### Dev B — voice mic UI (`components/chat-app.tsx`)

- Replace the text input section with a mic button using the `MediaRecorder` API:
  ```ts
  // On mic stop:
  //   POST blob to /api/upload-audio → get { key }
  //   POST { key } to /api/transcribe → get { transcript }
  //   Set transcript as the chat message → auto-send to agent in Agent mode
  ```
- Add a transcript display that appears between mic stop and agent start.
- Add a cart summary card — render when the last agent message contains a `getCartSummary` tool result. Show: product name (large), price (prominent), "View cart on Wayfair →" link.
- The existing `MessagePart` component in `chat-app.tsx` already renders tool call bubbles streaming in — verify they stream one by one, not all at once.

**Done when:** clicking mic, speaking, stopping → transcript appears → agent starts automatically.

#### Dev A — connect voice flow end-to-end

- Ensure `/api/transcribe` reads the audio from R2 by key, POSTs to BaseTen, returns transcript.
- Full end-to-end test: speak → transcript in UI → agent runs → cart summary card appears. Time it — target under 45 seconds total.

**Done when:** speaking produces a cart summary card with a working "View cart" link.

---

### ⏱ CHECKPOINT 2 — Minute 75: AI Gateway + polish + two clean runs | Both devs | 75–88 min

- Dev A: Cloudflare dashboard → AI Gateway → Create gateway "wayfair-agent". Copy the gateway URL. In `lib/subconscious.ts`, replace `SUBC_BASE_URL`:
  ```ts
  // Before:
  const SUBC_BASE_URL = "https://api.subconscious.dev/v1";
  // After:
  const SUBC_BASE_URL = process.env.CLOUDFLARE_AI_GATEWAY_URL ?? "https://api.subconscious.dev/v1";
  ```
  Add `CLOUDFLARE_AI_GATEWAY_URL` to `.env.local`. Test one full run — confirm gateway shows the request in its logs.
- Dev A: open AI Gateway dashboard on a second monitor. This is your live request log during the demo.
- Dev B: polish the UI — steps stream one by one, spinner visible during agent run, cart summary card is visually clear.
- Both: run the full voice flow 3× with different queries. Fix any crashes. **Choose your exact demo query** — specific enough to show filtering ("under $700", "blue", "in stock"), broad enough that Wayfair has results.

**✅ Demo-ready checkpoint — full voice flow runs cleanly 2× in a row. AI Gateway showing logs. Demo query chosen and memorized.**

---

### ⏱ CHECKPOINT 3 — 88–100 min | Video submission buffer | 12 min

- Open Loom (or QuickTime). Layout: browser with app on left half, Cloudflare AI Gateway logs on right half.
- Record: one person narrates pitch script, the other operates the demo. Real mic, real Wayfair browser, real cart.
- Upload to Loom/YouTube unlisted, copy link, paste into submission form.
- If recording fails: submit a screenshot of the cart summary card + Cloudflare AI Gateway log as proof.

**Done when:** submission link submitted before the 7:45pm deadline.

---

## If You're Behind at Minute 60 — Cut in This Order

| Priority | Cut | Time saved | Impact |
|---|---|---|---|
| Cut first | Voice input → text box | 15 min | Remove mic, R2 upload, BaseTen entirely. User types in the existing chat input. Core demo still works — agent still browses Wayfair live. |
| Cut second | Cloudflare AI Gateway → direct calls | 10 min | Skip the URL swap in `lib/subconscious.ts`. Lose the live log dashboard — mention as "planned for production." |
| Cut third | `readProductDescription` tool → skip it | 8 min | Agent only uses search + filter + add_to_cart. Frame as "v1, product reasoning in v2." |
| Do NOT cut | Live Playwright browser → mock data | — | Never replace with mocks. The demo moment depends on judges seeing a real browser navigate a real Wayfair page. Fix Playwright before anything else. |

---

## Live Demo Script — What the Judge Sees

1. **Show the blank UI** — "No search bar. No filters. Just a mic."

2. **Click mic, speak the demo query** — "I want a blue mid-century sofa, under $700, in stock." Click stop.

3. **Transcript appears** — "Whisper on BaseTen transcribed that in under 2 seconds. Now Subconscious takes over."

4. **Agent steps stream in, Playwright browser opens Wayfair** — "Watch the agent think — calling tools in real time. That's a live Wayfair browser." Point at the browser as it navigates and filters.

5. **Cart summary card appears** — "Harrison Mid-Century Sectional, $649, added to cart." Click "View cart on Wayfair →" — show the real cart.

6. **Point at AI Gateway logs** — "Every agent call logged here through Cloudflare AI Gateway. Full audit trail, production-ready." End.

---

## Pitch Script — Under 90 Seconds

> Furniture shopping is broken. You know what you want — you just can't translate it into Wayfair's search and filter system. So you spend 45 minutes browsing and still aren't sure.
>
> We built an agent that shops for you. You speak. You say exactly what you want, in plain English. Our agent — powered by Subconscious — hears you through Whisper on BaseTen, figures out your intent, and then controls a real Wayfair browser using Playwright. It searches, filters by price, reads product descriptions to pick the best match, and drops it in your cart. All in under 60 seconds.
>
> Audio hits Cloudflare R2, every agent call goes through AI Gateway for a full audit trail, and the app is deployed on Vercel.
>
> No mocks. No slides. Real browser. Real cart. Let us show you.

*~120 words. Reading pace: 80 seconds. Do not add anything.*

---

## Pre-Hack Checklist (Do Tonight)

- [ ] Pre-record a test audio clip on your phone with a clear furniture request as a fallback
- [ ] Test your demo query on Wayfair right now — confirm search + price filter returns results
- [ ] Confirm BaseTen account has credits loaded
- [ ] Confirm Subconscious API key is in `.env.local` (already done)
- [ ] Confirm Cloudflare account is set up with R2 + AI Gateway access
- [ ] Run `pnpm dev` and confirm the chat UI loads at http://localhost:3000

---

## Full Stack Summary

```
Voice input (browser mic — MediaRecorder in components/chat-app.tsx)
    → POST /api/upload-audio  → Cloudflare R2 (stores audio blob)
    → POST /api/transcribe    → BaseTen Whisper large-v3 (speech → text)
    → Agent mode chat UI      → Subconscious ToolLoopAgent (lib/agents/index.ts)
                              → Cloudflare AI Gateway (proxies + logs every call)
    → Playwright tools        → live Wayfair browser (lib/tools/wayfair.ts)
    → Cart summary card       → rendered in components/chat-app.tsx
```

| Sponsor | Role | Visible in demo? |
|---|---|---|
| Subconscious | Agent brain + tool orchestration | Yes — reasoning steps stream live in chat |
| BaseTen | Voice → text (Whisper large-v3) | Yes — user speaks, transcript appears |
| Cloudflare | R2 audio storage + AI Gateway logs | Yes — live request dashboard on screen |
| Wayfair | The live site being shopped | Yes — real browser navigates + real cart |

---

## Key Files to Build

| File | Status | What |
|---|---|---|
| `lib/tools/wayfair.ts` | 🔴 Build | All 5 Playwright tools |
| `lib/tools/index.ts` | 🟡 Update | Add `wayfairTools` to `agentTools` |
| `lib/agents/index.ts` | 🟡 Update | Shopping agent system prompt |
| `app/api/transcribe/route.ts` | 🔴 Build | BaseTen Whisper endpoint |
| `app/api/upload-audio/route.ts` | 🔴 Build | Cloudflare R2 upload |
| `components/chat-app.tsx` | 🟡 Update | Mic button + cart summary card |
| `lib/subconscious.ts` | 🟡 Update | AI Gateway URL swap (do last) |
