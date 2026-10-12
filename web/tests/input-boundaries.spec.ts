import { test, expect } from "@playwright/test";
import { defaultQuery, encodeQuery, decodeQuery, validDate } from "../src/fixtures";

const query = { ...defaultQuery(), serviceDate: "2026-10-14" };

test("calendar excludes year zero and impossible leap dates", () => {
  expect(validDate("0000-01-01")).toBe(false);
  expect(validDate("0001-01-01")).toBe(true);
  expect(validDate("2000-02-29")).toBe(true);
  expect(validDate("1900-02-29")).toBe(false);
});

for (const [name, change] of [
  ["duplicate origin", (p: URLSearchParams) => p.append("origin", "castlebar")],
  ["duplicate identical date", (p: URLSearchParams) => p.append("serviceDate", query.serviceDate)],
  ["unknown field", (p: URLSearchParams) => p.set("unreviewed", "true")],
  ["hex walking distance", (p: URLSearchParams) => p.set("maxWalkingMeters", "0x1f4")],
  ["exponential walking distance", (p: URLSearchParams) => p.set("maxWalkingMeters", "5e2")],
  ["padded walking distance", (p: URLSearchParams) => p.set("maxWalkingMeters", "0500")],
] as const) {
  test(`deep link rejects ${name}`, () => {
    const p = new URLSearchParams(encodeQuery(query));
    change(p);
    expect(decodeQuery(p.toString())).toBeNull();
  });
}

test("form accessible names contain the visible labels", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("combobox", { name: /De onde/ })).toBeVisible();
  await expect(page.getByRole("combobox", { name: /Para onde/ })).toBeVisible();
  await expect(page.getByLabel(/Partir a partir de/)).toBeVisible();
  await page.getByText("Explorar estados da demonstração").click();
  await expect(page.getByRole("combobox", { name: /Resposta das fixtures/ })).toBeVisible();
});

for (const path of ["/journey/", "/journey/direct/extra"]) {
  test(`malformed itinerary path ${path} offers home recovery`, async ({ page }) => {
    await page.goto(`/#${path}?${encodeQuery(query)}`);
    await expect(page.getByRole("heading", { name: "Este caminho não existe." })).toBeVisible();
    await expect(page.locator(".journey-card")).toHaveCount(0);
    await page.getByRole("link", { name: "Voltar ao início" }).click();
    await expect(page.getByRole("heading", { name: /Mais perto/ })).toBeVisible();
  });
}

test("router does not silently discard a second question mark", async ({ page }) => {
  await page.goto(`/#/search?${encodeQuery(query)}?&unreviewed=true`);
  await expect(page.getByRole("heading", { name: "Pesquisa inválida." })).toBeVisible();
  await expect(page.locator(".journey-card")).toHaveCount(0);
});
