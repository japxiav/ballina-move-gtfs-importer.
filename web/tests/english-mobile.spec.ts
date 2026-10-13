import { test, expect } from "@playwright/test";

test("English interface includes navigation, forms, notices and recovery", async ({ page }) => {
  await page.goto("/#/demo");
  await expect(page.locator("html")).toHaveAttribute("lang", "en-IE");
  await expect(page).toHaveTitle(/Your next journey/);
  await expect(page.getByRole("link", { name: "Home", exact: true })).toBeVisible();
  await expect(page.getByLabel("From — Origin", { exact: true })).toBeVisible();
  await expect(page.getByLabel("To — Destination", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Travel date")).toBeVisible();
  await expect(page.locator(".demo-note")).toContainText("Demo data");
  await page.getByRole("button", { name: "Find journeys" }).click();
  await expect(page.locator(".journey-card")).toHaveCount(3);
  await expect(page.locator(".journey-card").first()).toContainText("ARRIVE SOONER");
  await page.getByRole("link", { name: "View details: Arrive sooner" }).click();
  await expect(page.getByRole("heading", { name: "Bus 22" })).toBeVisible();
  await expect(page.getByText("Boarding point, accessibility and side of the road are unverified.")).toBeVisible();
  await page.getByRole("navigation").getByRole("link", { name: "About" }).click();
  await expect(page.getByRole("heading", { name: /Local journeys/ })).toBeVisible();
  await page.goto("/#/unknown");
  await expect(page.getByRole("heading", { name: "Page not found." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to home" })).toBeVisible();
});

for (const [width, height] of [[320, 640], [390, 844]]) {
  test(`compact mobile ${width}px keeps search reachable and results short`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/#/demo");
    const home = await page.evaluate(() => ({
      height: document.documentElement.scrollHeight,
      ctaBottom: document.querySelector(".search-submit")!.getBoundingClientRect().bottom,
      overflow: document.documentElement.scrollWidth > innerWidth,
    }));
    await page.locator(".search-submit").click();
    await expect(page.locator(".journey-card")).toHaveCount(3);
    const results = await page.evaluate(() => ({
      height: document.documentElement.scrollHeight,
      firstBottom: document.querySelector(".journey-card")!.getBoundingClientRect().bottom,
      cards: Array.from(document.querySelectorAll(".journey-card")).map(el => el.getBoundingClientRect().height),
      overflow: document.documentElement.scrollWidth > innerWidth,
    }));
    console.log(JSON.stringify({ width, home, results }));
    expect(home.ctaBottom).toBeLessThanOrEqual(height - 12);
    expect(home.height).toBeLessThanOrEqual(900);
    expect(home.overflow).toBe(false);
    expect(results.firstBottom).toBeLessThanOrEqual(height - 12);
    expect(results.height).toBeLessThanOrEqual(1050);
    expect(results.cards.every(h => h <= 195)).toBe(true);
    expect(results.overflow).toBe(false);
    await expect(page.locator(".demo-note")).toBeVisible();
    await expect(page.locator(".coverage-aside")).toBeHidden();
    await page.getByText("Edit search", { exact: true }).click();
    await page.locator(".search-options > summary").click();
    await expect(page.getByRole("group", { name: "Transport" })).toBeVisible();
    await expect(page.getByLabel("Walking limit")).toBeVisible();
  });
}

test("mobile controls remain easy to tap through filters and recovery", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const checkTargets = async () => {
    const small = await page.evaluate(() => Array.from(document.querySelectorAll("a[href], button, summary, select, input:not([type=checkbox])"))
      .filter(el => el.getClientRects().length > 0)
      .map(el => ({ label: el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 50), box: el.getBoundingClientRect() }))
      .filter(({ box }) => box.width < 44 || box.height < 44)
      .map(({ label, box }) => ({ label, width: box.width, height: box.height })));
    expect(small).toEqual([]);
  };
  await page.goto("/#/demo");
  await checkTargets();
  await page.locator(".search-options > summary").click();
  await page.getByText("Demo states", { exact: true }).click();
  await checkTargets();
  await page.getByLabel("Demo response").selectOption("empty");
  await page.getByRole("button", { name: "Find journeys" }).click();
  await expect(page.getByRole("heading", { name: "No demo journeys found." })).toBeVisible();
  await checkTargets();
  await page.getByText("Edit search", { exact: true }).click();
  await page.locator(".search-options > summary").click();
  await page.getByText("Demo states", { exact: true }).click();
  await page.getByLabel("Demo response").selectOption("error");
  await page.getByRole("button", { name: "Find journeys" }).click();
  await expect(page.getByRole("alert")).toContainText("Unable to load journeys.");
  await checkTargets();
});
