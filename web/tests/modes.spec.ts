import { test, expect } from "@playwright/test";
import { defaultQuery, encodeQuery, decodeQuery, fixtureJourneys } from "../src/fixtures";

const query = { ...defaultQuery(), serviceDate: "2026-10-14" };
test("rail-only fixtures cannot return bus rides", () => {
  expect(fixtureJourneys({ ...query, modes: ["rail"] })).toEqual([]);
});
test("transport filter survives URL roundtrip and legacy links remain usable", () => {
  const selected = { ...query, modes: ["rail"] as const };
  expect(decodeQuery(encodeQuery(selected))?.modes).toEqual(["rail"]);
  const legacy = new URLSearchParams(encodeQuery(query));
  legacy.delete("modes");
  expect(decodeQuery(legacy.toString())?.modes).toEqual(["bus", "rail"]);
  expect(fixtureJourneys(decodeQuery(legacy.toString())!)).toHaveLength(3);
});
for (const value of ["", "car", "bus,bus", "rail,bus", "bus,rail,walk", " bus"]) {
  test(`malformed modes ${JSON.stringify(value)} rejected`, () => {
    const p = new URLSearchParams(encodeQuery(query));
    p.set("modes", value);
    expect(decodeQuery(p.toString())).toBeNull();
  });
}
test("duplicate modes parameters are rejected instead of taking the first", () => {
  const p = new URLSearchParams(encodeQuery(query));
  p.set("modes", "bus");
  p.append("modes", "rail");
  expect(decodeQuery(p.toString())).toBeNull();
});
test("bus and rail filter supports empty state, validation, reload and recovery", async ({ page }) => {
  await page.route("**/*", async (route) => {
    expect(new URL(route.request().url()).hostname).toBe("127.0.0.1");
    await route.continue();
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#/demo");
  await page.locator(".search-options > summary").click();
  await expect(page.getByRole("group", { name: "Transport" })).toBeVisible();
  const bus = page.getByRole("checkbox", { name: "Bus", exact: true });
  const rail = page.getByRole("checkbox", { name: "Train", exact: true });
  await expect(bus).toBeChecked();
  await expect(rail).toBeChecked();
  await bus.uncheck();
  await page.getByRole("button", { name: "Find journeys" }).click();
  await expect(page.getByText("This demo has no train examples.")).toBeVisible();
  await expect(page.locator(".journey-card")).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("This demo has no train examples.")).toBeVisible();
  await page.getByText("Edit search").click();
  await page.locator(".search-options > summary").click();
  await expect(bus).not.toBeChecked();
  await expect(rail).toBeChecked();
  await rail.uncheck();
  await page.getByRole("button", { name: "Find journeys" }).click();
  await expect(page.getByRole("alert")).toContainText("Select at least one transport mode.");
  await bus.check();
  await page.getByRole("button", { name: "Find journeys" }).click();
  await expect(page.locator(".journey-card")).toHaveCount(3);
  await page.getByRole("link", { name: "View details: Arrive sooner" }).click();
  await expect(page.getByRole("heading", { name: "Bus 22" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Bus 22" })).toBeVisible();
  expect(errors).toEqual([]);
});
