import { chromium } from "playwright";
import type { Browser, Page } from "playwright";

/**
 * Wayfair Playwright tools — Dev A
 *
 * Bot detection strategy:
 * - Launches a visible Chrome browser
 * - If Kasada "Press & Hold" appears, pauses and waits for you to solve it manually
 * - Once solved, session cookies persist for all subsequent tool calls
 */

let browser: Browser | null = null;
let page: Page | null = null;

// ─── Browser lifecycle ───────────────────────────────────────────────────────

async function spawnBrowser() {
  browser = await chromium.launch({
    headless: false,
    args: ["--start-maximized", "--disable-blink-features=AutomationControlled"],
  });
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: null,
    locale: "en-US",
    timezoneId: "America/New_York",
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  page = await ctx.newPage();
}

export async function launchBrowser(): Promise<{ page: Page }> {
  // Re-launch if browser was closed or crashed
  if (browser && page) {
    const alive = await page.evaluate(() => true).catch(() => false);
    if (!alive) { browser = null; page = null; }
  }
  if (!browser || !page) await spawnBrowser();
  return { page: page! };
}

// ─── CAPTCHA helper ──────────────────────────────────────────────────────────

/**
 * Detects Kasada "Press & Hold".
 * - In terminal (test script): waits for Enter keypress.
 * - In Next.js server route: throws so the agent gets a clear error message.
 */
async function solveCaptchaIfPresent(p: Page): Promise<void> {
  const CAPTCHA_XPATH = "/html/body/div/div/div[2]/div[2]/p";

  // Check if CAPTCHA is present using the exact XPath
  const isBlocked = await p.evaluate((xpath) => {
    const el = document.evaluate(
      xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
    ).singleNodeValue;
    return el !== null;
  }, CAPTCHA_XPATH).catch(() => false);

  if (!isBlocked) return;

  const box = await p.evaluate((xpath) => {
    const el = document.evaluate(
      xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
    ).singleNodeValue as HTMLElement | null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }, CAPTCHA_XPATH);

  if (!box) return;

  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  // Simulate a human-like press and hold:
  // move to the button, press down, hold for 3s, release
  await p.mouse.move(x, y, { steps: 10 });
  await p.waitForTimeout(200);
  await p.mouse.down();
  await p.waitForTimeout(3000);
  await p.mouse.up();

  // Wait for CAPTCHA to clear and page to reload
  await p.waitForTimeout(1500);
  await p.waitForLoadState("load", { timeout: 15000 }).catch(() => {});
}

// ─── Search ──────────────────────────────────────────────────────────────────

export async function searchWayfair(
  query: string
): Promise<{ url: string; query: string }> {
  const { page: p } = await launchBrowser();
  const url = `https://www.wayfair.com/keyword.php?keyword=${encodeURIComponent(query)}`;
  await p.goto(url, { waitUntil: "load", timeout: 30000 });
  await solveCaptchaIfPresent(p);
  await p.waitForTimeout(2000); // let React render the grid
  return { url: p.url(), query };
}

// ─── Scrape results ──────────────────────────────────────────────────────────

export async function getProducts(): Promise<{
  products: Array<{ name: string; price: string; productUrl: string }>;
}> {
  const { page: p } = await launchBrowser();

  const products = await p.evaluate(() => {
    const results: Array<{ name: string; price: string; productUrl: string }> = [];
    const cards = document.querySelectorAll(
      '[data-testid="ProductCard"], [class*="ProductCard"], [data-hb-id="StandardProductCard"]'
    );
    cards.forEach((card, i) => {
      if (i >= 5) return;
      const nameEl =
        card.querySelector('[data-testid="product-title"]') ||
        card.querySelector('[class*="productName"]') ||
        card.querySelector('[class*="ProductName"]') ||
        card.querySelector("h2") ||
        card.querySelector("h3");
      const name = nameEl?.textContent?.trim() ?? "Unknown product";

      const priceEl =
        card.querySelector('[data-testid="sale-price"]') ||
        card.querySelector('[class*="BasePriceSection"]') ||
        card.querySelector('[class*="price"]') ||
        card.querySelector("span[aria-label*='$']");
      const price = priceEl?.textContent?.trim() ?? "N/A";

      const linkEl = card.querySelector("a[href]") as HTMLAnchorElement | null;
      const href = linkEl?.href ?? "";
      const productUrl = href.startsWith("http")
        ? href
        : href
        ? `https://www.wayfair.com${href}`
        : "";

      if (name && productUrl) results.push({ name, price, productUrl });
    });

    // Fallback: find any <a> tags whose href matches a Wayfair product URL pattern
    if (results.length === 0) {
      const seen = new Set<string>();
      const allLinks = Array.from(document.querySelectorAll("a[href]")) as HTMLAnchorElement[];
      for (const link of allLinks) {
        if (results.length >= 5) break;
        const href = link.href;
        if (!href.includes("wayfair.com") || seen.has(href)) continue;
        if (!/\/(pdp|sb)\//.test(href) && !/wayfair\.com\/[a-z]/.test(href)) continue;
        seen.add(href);
        const nameEl = link.querySelector("h2, h3") ?? link;
        const name = nameEl.textContent?.trim() ?? "Unknown";
        const container = link.closest("li, article") ?? link.parentElement;
        const price = container?.querySelector("[class*='price' i]")?.textContent?.trim() ?? "N/A";
        results.push({ name, price, productUrl: href });
      }
    }

    return results;
  });

  return { products };
}

// ─── Navigate to first product ───────────────────────────────────────────────

export async function navigateToFirstProduct(): Promise<{
  productName: string;
  productUrl: string;
}> {
  const { page: p } = await launchBrowser();

  const XPATH = "/html/body/div[1]/div[3]/div/div[2]/div[2]/div[4]/section/div[1]/div/div/div[1]/a";

  // Use document.evaluate directly — matches exactly what DevTools resolves
  const href = await p.evaluate((xpath) => {
    const el = document.evaluate(
      xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
    ).singleNodeValue as HTMLAnchorElement | null;
    return el?.href ?? null;
  }, XPATH);

  if (!href) throw new Error("navigateToFirstProduct: first product link not found — CAPTCHA may be showing or page not fully loaded");

  await Promise.all([
    p.waitForLoadState("load", { timeout: 30000 }),
    p.evaluate((xpath) => {
      const el = document.evaluate(
        xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
      ).singleNodeValue as HTMLElement | null;
      el?.click();
    }, XPATH),
  ]);

  await solveCaptchaIfPresent(p);

  const productName = await p
    .$eval("h1", (el) => el.textContent?.trim() ?? "Unknown")
    .catch(() => "Unknown");

  return { productName, productUrl: p.url() };
}

// ─── Apply price filter ──────────────────────────────────────────────────────

export async function applyPriceFilter(
  maxPrice: number
): Promise<{ url: string; maxPrice: number }> {
  const { page: p } = await launchBrowser();
  const current = new URL(p.url());
  current.searchParams.set("price_max", String(maxPrice));
  await p.goto(current.toString(), { waitUntil: "load", timeout: 30000 });
  await solveCaptchaIfPresent(p);
  await p.waitForTimeout(2000);
  return { url: p.url(), maxPrice };
}

// ─── Read product description ────────────────────────────────────────────────

export async function readProductDescription(productUrl: string): Promise<{
  name: string;
  price: string;
  description: string;
}> {
  const { page: p } = await launchBrowser();
  await p.goto(productUrl, { waitUntil: "load", timeout: 30000 });
  await solveCaptchaIfPresent(p);

  const name = await p
    .$eval("h1", (el) => el.textContent?.trim() ?? "Unknown")
    .catch(() => "Unknown");

  const price = await p
    .$$eval(
      '[data-testid="sale-price"], [class*="BasePriceSection"], [class*="productPrice"]',
      (els) => els[0]?.textContent?.trim() ?? "N/A"
    )
    .catch(() => "N/A");

  const description = await p
    .$$eval(
      '[data-testid="product-description"], [class*="ProductDescription"], [class*="productDescription"]',
      (els) => els[0]?.textContent?.trim().slice(0, 300) ?? ""
    )
    .catch(() => "");

  return { name, price, description };
}

// ─── Set quantity ────────────────────────────────────────────────────────────

export async function setQuantity(
  quantity: number
): Promise<{ quantity: number; method: string }> {
  if (quantity < 1) throw new Error("quantity must be ≥ 1");
  const { page: p } = await launchBrowser();

  const XPATH = "xpath=/html/body/div[2]/div[3]/div[1]/div[2]/div/div[2]/div[7]/div/div[2]/div[1]/div[2]/div/button[2]";

  for (let i = 0; i < quantity - 1; i++) {
    await p.click(XPATH);
    await p.waitForTimeout(300);
  }

  return { quantity, method: "xpath-stepper" };
}

// ─── Add to cart ─────────────────────────────────────────────────────────────

export async function addToCart(): Promise<{
  success: boolean;
  productName: string;
}> {
  const { page: p } = await launchBrowser();

  const productName = await p
    .$eval("h1", (el) => el.textContent?.trim() ?? "Unknown")
    .catch(() => "Unknown");

  const selectors = [
    '[data-testid="add-to-cart-button"]',
    'button[aria-label*="Add to Cart" i]',
    'button:has-text("Add to Cart")',
    'button:has-text("Add To Cart")',
    '[class*="AddToCart"] button',
  ];

  for (const sel of selectors) {
    const btn = await p.$(sel).catch(() => null);
    if (btn) {
      await btn.click();
      await p.waitForTimeout(2000);
      return { success: true, productName };
    }
  }

  return { success: false, productName };
}

// ─── Cart summary ────────────────────────────────────────────────────────────

export async function getCartSummary(): Promise<{
  items: Array<{ name: string; price: string }>;
  total: string;
  cartUrl: string;
}> {
  const { page: p } = await launchBrowser();
  await p.goto("https://www.wayfair.com/checkout/cart", {
    waitUntil: "load",
    timeout: 30000,
  });
  await solveCaptchaIfPresent(p);

  const summary = await p.evaluate(() => {
    const items: Array<{ name: string; price: string }> = [];
    const nameEls = document.querySelectorAll(
      '[data-testid="cart-item-name"], [class*="CartItemName"], [class*="cartItemName"]'
    );
    const priceEls = document.querySelectorAll(
      '[data-testid="cart-item-price"], [class*="CartItemPrice"], [class*="cartItemPrice"]'
    );
    nameEls.forEach((el, i) => {
      items.push({
        name: el.textContent?.trim() ?? "Unknown",
        price: priceEls[i]?.textContent?.trim() ?? "N/A",
      });
    });
    const totalEl = document.querySelector(
      '[data-testid="order-total"], [class*="OrderTotal"], [class*="CartTotal"]'
    );
    return { items, total: totalEl?.textContent?.trim() ?? "N/A" };
  });

  return { ...summary, cartUrl: "https://www.wayfair.com/checkout/cart" };
}

// ─── Convenience ─────────────────────────────────────────────────────────────

export async function buyFirstProduct(quantity = 1): Promise<{
  productName: string;
  productUrl: string;
  quantity: number;
  addedToCart: boolean;
}> {
  const { productName, productUrl } = await navigateToFirstProduct();
  if (quantity > 1) await setQuantity(quantity);
  const { success } = await addToCart();
  return { productName, productUrl, quantity, addedToCart: success };
}

// ─── Test block ──────────────────────────────────────────────────────────────

if (require.main === module) {
  const QUANTITY = 2;
  (async () => {
    await searchWayfair("blue mid century sofa");
    const { productName, productUrl } = await navigateToFirstProduct();
    await setQuantity(QUANTITY);
    await addToCart();
    const summary = await getCartSummary();
    process.stdout.write(
      JSON.stringify({ productName, productUrl, quantity: QUANTITY, summary }, null, 2) + "\n"
    );
  })().catch(console.error);
}
