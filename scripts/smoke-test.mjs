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

async function expectNoHorizontalOverflow(label) {
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));

  if (overflow.scrollWidth > overflow.clientWidth + 1) {
    messages.push(
      `${label} horizontal overflow: ${overflow.scrollWidth}px > ${overflow.clientWidth}px`
    );
  }
}

async function expectReadableHeading(text) {
  const headingBox = await page.getByText(text, { exact: true }).evaluate((element) => {
    const rect = element.getBoundingClientRect();

    return {
      height: rect.height,
      width: rect.width,
    };
  });

  if (headingBox.width < 120 || headingBox.height > 64) {
    messages.push(
      `${text} heading collapsed: ${headingBox.width.toFixed(1)}x${headingBox.height.toFixed(1)}`
    );
  }
}

await page.goto(url, { waitUntil: "networkidle" });
await expectReadableHeading("Forecast vs Actual (Generation/Load)");
await expectReadableHeading("Signed Contracts");
await page.locator("#sidebar-portfolio").selectOption("industrial-supply");
await page
  .locator("footer")
  .getByText(/Portfolio switched to Industrial Supply Desk/)
  .waitFor({ timeout: 5000 });
const industrialContractCount = await page.getByText("Flex Provider").count();
if (industrialContractCount < 1) {
  messages.push("Expected Industrial Supply Desk portfolio contracts to include Flex Provider");
}
await page.getByRole("button", { name: /^Forecast$/ }).click();
await page.getByText("Scenario editor").waitFor({ timeout: 5000 });
await page.getByText("Calibration preview").waitFor({ timeout: 5000 });
await page.getByLabel("Scenario seed").fill("22222");
await page.getByRole("button", { name: /Apply scenario/ }).click();
await page.locator("footer").getByText(/Scenario reset with seed 22222/).waitFor({ timeout: 5000 });
await expectNoHorizontalOverflow("desktop scenario editor");
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
await page.getByRole("button", { name: /^Dashboard$/ }).click();
await page.getByTestId("status-message-strip").waitFor({ timeout: 5000 });
const mobileRiskAlertRowCount = await page.getByTestId("risk-alert-row").count();
if (mobileRiskAlertRowCount < 5) {
  messages.push(`Expected 5 mobile risk alert rows, found ${mobileRiskAlertRowCount}`);
}
const mobileDashboardContractCardCount = await page
  .getByTestId("mobile-dashboard-contract-card")
  .count();
if (mobileDashboardContractCardCount < 3) {
  messages.push(
    `Expected mobile dashboard contract cards, found ${mobileDashboardContractCardCount}`
  );
}
await expectNoHorizontalOverflow("mobile dashboard contract cards");
await page.getByRole("button", { name: /^Market$/ }).click();
const mobileMarketCardCount = await page.getByTestId("mobile-market-period-card").count();
if (mobileMarketCardCount < 2) {
  messages.push(`Expected mobile market cards, found ${mobileMarketCardCount}`);
}
await page.getByRole("button", { name: "Load ticket", exact: true }).nth(1).click();
const selectedDeliveryText = await page
  .getByLabel("Delivery period")
  .evaluate((select) => select.selectedOptions[0]?.textContent?.trim());
if (selectedDeliveryText !== "11:00 - 11:15") {
  messages.push(`Expected delivery 11:00 - 11:15, got ${selectedDeliveryText}`);
}
const mobileDecisionCandidateCardCount = await page
  .getByTestId("decision-candidate-card")
  .count();
if (mobileDecisionCandidateCardCount < 2) {
  messages.push(`Expected mobile decision candidate cards, found ${mobileDecisionCandidateCardCount}`);
}
await expectNoHorizontalOverflow("mobile market cards");
await page.setViewportSize({ width: 1280, height: 900 });
await page.waitForTimeout(300);
await page.getByRole("button", { name: /^Dashboard$/ }).click();
await page.getByRole("button", { name: /Play simulation/ }).click();
await page.getByRole("button", { name: /Pause simulation/ }).click();
await page.getByRole("button", { name: /Step/ }).click();
await page.getByText("RDB depth", { exact: true }).waitFor({ timeout: 5000 });
await page.getByText("Spread Cost", { exact: true }).waitFor({ timeout: 5000 });
await page.getByText("Fees", { exact: true }).first().waitFor({ timeout: 5000 });
await page.getByRole("button", { name: /Place (Buy|Sell) Order/ }).click();
await page.getByRole("button", { name: /^Market$/ }).click();
await page.getByText("Decision workbench").waitFor({ timeout: 5000 });
await page.getByText("Decision log").waitFor({ timeout: 5000 });
await page
  .getByTestId("decision-workbench")
  .getByRole("button", { name: "Load", exact: true })
  .first()
  .click();
await page.getByText(/^BUY .+ MWh$/).waitFor({ timeout: 5000 });
await page.getByRole("button", { name: /Run to end/ }).click();
await page
  .locator("footer")
  .getByText("Trading day closed. Final imbalance settlement is available.")
  .waitFor({ timeout: 5000 });
await page.getByRole("button", { name: /Strategy Duel/ }).click();
await page.getByRole("button", { name: /Run script/ }).click();
await page.getByText(/Run complete/).waitFor({ timeout: 5000 });
await page.getByText("Bot edge diagnostics").waitFor({ timeout: 5000 });
await page.getByText("Scenario report").waitFor({ timeout: 5000 });
await page.getByRole("button", { name: /^Replay$/ }).click();
await page.getByText("Replay timeline").waitFor({ timeout: 5000 });
await page.getByText("Period drilldown").waitFor({ timeout: 5000 });
await page.getByText("Lesson learned").waitFor({ timeout: 5000 });
await page.getByText("Settlement audit").waitFor({ timeout: 5000 });
await page.getByRole("button", { name: "Bot edge", exact: true }).click();
await page.getByRole("button", { name: "All", exact: true }).click();
await expectNoHorizontalOverflow("desktop replay");
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
const mobileReplayAuditCardCount = await page.getByTestId("mobile-replay-audit-card").count();
if (mobileReplayAuditCardCount < 12) {
  messages.push(`Expected mobile replay audit cards, found ${mobileReplayAuditCardCount}`);
}
await expectNoHorizontalOverflow("mobile replay");
await page.getByRole("button", { name: /^Forecast$/ }).click();
await page.getByText("Scenario editor").waitFor({ timeout: 5000 });
await page.getByText("Calibration preview").waitFor({ timeout: 5000 });
await expectNoHorizontalOverflow("mobile scenario editor");
await page.getByRole("button", { name: /Strategy Duel/ }).click();
const mobileDuelComparisonCardCount = await page.getByTestId("mobile-duel-comparison-card").count();
if (mobileDuelComparisonCardCount < 2) {
  messages.push(`Expected mobile duel comparison cards, found ${mobileDuelComparisonCardCount}`);
}
const mobileDuelInsightCardCount = await page.getByTestId("mobile-duel-insight-card").count();
if (mobileDuelInsightCardCount < 1) {
  messages.push(`Expected mobile duel insight cards, found ${mobileDuelInsightCardCount}`);
}
await expectNoHorizontalOverflow("mobile strategy duel cards");
await page.getByRole("button", { name: /Contracts/ }).click();
await page.getByRole("button", { name: /^Sign contract$/ }).click();
await page.getByRole("dialog", { name: /Sign simulated contract/ }).waitFor({
  timeout: 5000,
});
await page.getByText("Current net").first().waitFor({ timeout: 5000 });
await page.getByText("PnL impact").first().waitFor({ timeout: 5000 });
await page.getByText("Profile impact").first().waitFor({ timeout: 5000 });
await page.getByText("Nomination").first().waitFor({ timeout: 5000 });
await page.getByText("Penalty rule").first().waitFor({ timeout: 5000 });
await page.getByTestId("sign-contract-peak-shaped-sell").click();
await page
  .getByTestId("sign-contract-peak-shaped-sell")
  .getByText("Already signed")
  .waitFor({ timeout: 5000 });
await expectNoHorizontalOverflow("mobile contract drawer");
await page.keyboard.press("Escape");
await page.getByRole("dialog", { name: /Sign simulated contract/ }).waitFor({
  state: "detached",
  timeout: 5000,
});
const mobileContractCards = page.getByTestId("mobile-contract-card");
const mobileContractCardCount = await mobileContractCards.count();
if (mobileContractCardCount < 4) {
  messages.push(`Expected at least 4 mobile contract cards, found ${mobileContractCardCount}`);
}
await mobileContractCards
  .filter({ hasText: "PEAK shaped sell" })
  .filter({ hasText: "Risk owner" })
  .waitFor({ timeout: 5000 });
await expectNoHorizontalOverflow("mobile contracts after signing");

await browser.close();

if (messages.length > 0) {
  console.error(messages.join("\n"));
  process.exit(1);
}
