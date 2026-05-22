import { chromium } from "playwright";

const url = process.env.SMOKE_URL ?? "http://localhost:3000";

const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome",
  headless: true,
});

const page = await browser.newPage({
  viewport: { width: 1280, height: 900 },
});

const messages = [];

page.on("pageerror", (error) => messages.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error" || message.type() === "warning") {
    messages.push(message.text());
  }
});

await page.goto(url, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Place (Buy|Sell) Order/ }).click();
await page.getByRole("button", { name: /^Market$/ }).click();
await page.getByText(/BUY 25\.0 MWh/).waitFor({ timeout: 5000 });
await page.getByRole("button", { name: /Strategy Duel/ }).click();
await page.getByRole("button", { name: /Run script/ }).click();
await page.getByText(/Run complete/).waitFor({ timeout: 5000 });
await page.getByRole("button", { name: /Contracts/ }).click();
await page.getByRole("button", { name: /^Sign contract$/ }).click();
await page.getByRole("dialog", { name: /Sign simulated contract/ }).waitFor({
  timeout: 5000,
});

await browser.close();

if (messages.length > 0) {
  console.error(messages.join("\n"));
  process.exit(1);
}
