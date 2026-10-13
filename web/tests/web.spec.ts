import { test, expect } from "@playwright/test";
import {
  decodeQuery,
  encodeQuery,
  fixtureJourneys,
  defaultQuery,
  fixtureService,
  clock,
} from "../src/fixtures";
const query = {
  ...defaultQuery(),
  serviceDate: "2026-10-14",
  departAt: "09:15",
};
const searchURL = (changes = {}) =>
  `/#/search?${encodeQuery({ ...query, ...changes })}`;
test.beforeEach(async ({ page }) => {
  // Record the real loading DOM while it exists; a slow click acknowledgement
  // must not make a transient 650 ms state invisible to the assertion.
  await page.addInitScript(() => {
    const state = window as Window & { ballinaLoadingCount: number };
    state.ballinaLoadingCount = 0;
    let previous: Element | null = null;
    new MutationObserver(() => {
      const loading =
        Array.from(document.querySelectorAll('[role="status"]')).find(
          (el) =>
            el.textContent?.includes("Finding demo journeys") &&
            el.getClientRects().length > 0,
        ) ?? null;
      if (loading && loading !== previous) state.ballinaLoadingCount++;
      previous = loading;
    }).observe(document, { childList: true, subtree: true });
  });
  await page.route("**/*", async (route) => {
    expect(new URL(route.request().url()).hostname).toBe("127.0.0.1");
    await route.continue();
  });
  page.on("pageerror", (error) => {
    throw error;
  });
});
test("home → results → itinerary → back and deep-link reload", async ({
  page,
}) => {
  await page.goto("/#/demo");
  await expect(page.getByRole("heading", { name: /Your next journey/ })).toBeVisible();
  await page.getByLabel("Travel date").fill(query.serviceDate);
  await page.getByRole("button", { name: "Find journeys" }).click();
  await page.waitForFunction(
    () =>
      (window as Window & { ballinaLoadingCount: number }).ballinaLoadingCount >
      0,
  );
  await expect(page.locator(".journey-card")).toHaveCount(3);
  await expect(page.locator(".fixture-tag")).toHaveCount(3);
  await page
    .getByRole("link", { name: "View details: Arrive sooner" })
    .click();
  await expect(page.getByRole("heading", { name: "Bus 22" })).toBeVisible();
  await expect(
    page.getByText("260 m · demo walk, no verified path."),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Boarding point, accessibility and side of the road are unverified.",
    ),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Bus 22" })).toBeVisible();
  await page.getByRole("link", { name: "Back to results" }).click();
  await expect(page.locator(".journey-card")).toHaveCount(3);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Bus 22" })).toBeVisible();
});
test("priority and walking limit alter order and count", async ({ page }) => {
  await page.goto(searchURL());
  await expect(page.locator(".journey-card")).toHaveCount(3);
  await page.getByText("Edit search").click();
  await page.locator(".search-options > summary").click();
  await page.getByLabel("Priority").selectOption("less_walking");
  await page.getByLabel("Walking limit").selectOption("500");
  await page.getByRole("button", { name: "Find journeys" }).click();
  await expect(page.locator(".journey-card")).toHaveCount(2);
  await expect(page.locator(".journey-card").first()).toContainText(
    "LESS WALKING",
  );
  await expect(page.locator(".journey-card").first()).toContainText(
    "140 m walking",
  );
});
test("swap and equal-place validation", async ({ page }) => {
  await page.goto("/#/demo");
  await page.getByRole("button", { name: "Swap start and destination" }).click();
  await expect(page.getByLabel("From — Origin", { exact: true })).toHaveValue(
    "foxford",
  );
  await expect(page.getByLabel("To — Destination", { exact: true })).toHaveValue(
    "ballina",
  );
  await page.getByLabel("To — Destination", { exact: true }).selectOption("foxford");
  await page.getByRole("button", { name: "Find journeys" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "different start and destination points",
  );
});
test("empty, simulated failure, retry and recovery", async ({ page }) => {
  await page.goto("/#/demo");
  await page.locator(".search-options > summary").click();
  await page.getByText("Demo states").click();
  await page.getByLabel("Demo response").selectOption("empty");
  await page.getByRole("button", { name: "Find journeys" }).click();
  await expect(
    page.getByRole("heading", { name: "No demo journeys found." }),
  ).toBeVisible();
  await page.getByText("Edit search").click();
  await page.locator(".search-options > summary").click();
  await page.getByText("Demo states").click();
  await page.getByLabel("Demo response").selectOption("error");
  await page.getByRole("button", { name: "Find journeys" }).click();
  await expect(page.getByRole("alert")).toContainText("Unable to load journeys.");
  const beforeRetry = await page.evaluate(
    () =>
      (window as Window & { ballinaLoadingCount: number }).ballinaLoadingCount,
  );
  await page.getByRole("button", { name: "Try again" }).click();
  await page.waitForFunction(
    (count) =>
      (window as Window & { ballinaLoadingCount: number }).ballinaLoadingCount >
      count,
    beforeRetry,
  );
  await expect(page.getByRole("alert")).toContainText("Unable to load journeys.");
  await page.getByText("Edit search").click();
  await page.locator(".search-options > summary").click();
  await page.getByText("Demo states").click();
  await page.getByLabel("Demo response").selectOption("normal");
  await page.getByRole("button", { name: "Find journeys" }).click();
  await expect(page.locator(".journey-card")).toHaveCount(3);
});
test("bad links and missing itinerary have recovery paths", async ({
  page,
}) => {
  await page.goto("/#/search?origin=unknown");
  await expect(
    page.getByRole("heading", { name: "Invalid search." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Start a new search" }).click();
  await expect(page.getByRole("heading", { name: "Find your journey." })).toBeVisible();
  await expect(page).toHaveURL(/#\/$/);
  await page.goto(`/#/journey/missing?${encodeQuery(query)}`);
  await expect(
    page.getByRole("heading", { name: "Journey not found." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "View results", exact: true }).click();
  await expect(page.locator(".journey-card")).toHaveCount(3);
  await page.goto("/#/unknown");
  await expect(
    page.getByRole("heading", { name: "Page not found." }),
  ).toBeVisible();
});
test("midnight offsets and transfer itinerary", async ({ page }) => {
  await page.goto(searchURL({ departAt: "23:55" }));
  await expect(page.locator(".journey-card")).toHaveCount(3);
  await expect(page.locator(".journey-card").first()).toContainText("(+1 day)");
  await page
    .getByRole("link", { name: "View details: Another option" })
    .click();
  await expect(page.getByRole("heading", { name: "Bus 445" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bus 420" })).toBeVisible();
  await expect(
    page.getByText("6 min wait / boarding buffer"),
  ).toBeVisible();
  await expect(page.locator(".timeline-arrival")).toContainText("(+1 day)");
});
test("360px pages fit and keyboard skip link works", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/#/demo");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
  const noOverflow = async () =>
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  await noOverflow();
  await page.getByRole("button", { name: "Find journeys" }).click();
  await expect(page.locator(".journey-card")).toHaveCount(3);
  await noOverflow();
  await page
    .getByRole("link", { name: "View details: Another option" })
    .click();
  await expect(page.getByRole("heading", { name: "Bus 445" })).toBeVisible();
  await noOverflow();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "About" })
    .click();
  await expect(
    page.getByRole("heading", { name: /Local journeys/ }),
  ).toBeVisible();
  await noOverflow();
});
test("navigation cancels stale searches", async ({ page }) => {
  await page.goto(searchURL({ demoState: "error" }));
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Home" })
    .click();
  await expect(page.getByRole("heading", { name: "Find your journey." })).toBeVisible();
  await page.evaluate(() => { window.location.hash = '/demo'; });
  await expect(page.getByRole("heading", { name: /Your next journey/ })).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Find journeys" }).click();
  await expect(page.locator(".journey-card")).toHaveCount(3);
});
test("fixture provenance, date validation, query roundtrip and cancellation", async () => {
  expect(decodeQuery(encodeQuery(query))).toEqual(query);
  expect(
    decodeQuery(encodeQuery({ ...query, serviceDate: "2026-02-30" })),
  ).toBeNull();
  expect(fixtureJourneys({ ...query, destination: query.origin })).toEqual([]);
  for (const j of fixtureJourneys(query)) {
    expect(j.demo).toBe(true);
    expect(j.feedVersion).toBe("synthetic-web-demo-v1");
    expect(j.arrivalAtSeconds).toBeGreaterThan(j.latestLeaveAtSeconds!);
    for (const leg of j.legs)
      if (leg.type === "walk") {
        expect(leg.geometry).toEqual([]);
        expect(leg.provider).toBe("synthetic_web_fixture_only");
      }
  }
  expect(clock(25 * 3600 + 300)).toBe("01:05");
  const c = new AbortController();
  const pending = fixtureService.search(query, c.signal);
  c.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
});
