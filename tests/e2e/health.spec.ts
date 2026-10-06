import { expect, test } from "@playwright/test";
import { login } from "./helpers";

// T-005: /api/health memuat commit (tanpa info lain) dan sidebar menampilkan label versi. Server e2e dijalankan tanpa GIT_SHA -> "unknown".
test("/api/health: hanya status dan commit; commit = sha pendek atau 'unknown'", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Object.keys(body).sort()).toEqual(["commit", "status"]);
  expect(body.status).toBe("ok");
  expect(body.commit).toMatch(/^([0-9a-f]{7,12}|unknown)$/);
});

test("sidebar menampilkan 'Hashi · <commit>' (bukan versi basi) untuk pengguna yang login", async ({ page }) => {
  await login(page, "tsk.admin@hashi.test");
  const label = page.getByTestId("build-version");
  await expect(label).toBeVisible();
  await expect(label).toHaveText(/^Hashi · (unknown|[0-9a-f]{7,12})$/);
  await expect(label).not.toContainText("v0.2");
});
