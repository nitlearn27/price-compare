import { test, expect } from "@playwright/test";

// These E2E tests require the backend + frontend running.
// Run: cd backend && uvicorn app.main:app & cd frontend && pnpm dev
// Then: pnpm test:e2e

test.describe("Product comparison flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("http://localhost:5173");
  });

  test("shows the recommended picks on load", async ({ page }) => {
    await expect(page.getByText(/picks for you/i)).toBeVisible();
  });

  test("chat input is visible and accepts text", async ({ page }) => {
    const input = page.getByRole("textbox", { name: /ask me to find a product/i });
    await input.fill("Find Aashirvaad Atta 5kg");
    await expect(input).toHaveValue("Find Aashirvaad Atta 5kg");
  });

  test("app title is displayed", async ({ page }) => {
    await expect(page.getByText("Price Compare")).toBeVisible();
  });

  test("comparison panel header is visible on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByText("Product Comparison")).toBeVisible();
  });

  test("mobile layout: single column", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    // Chat pane should still be visible
    await expect(
      page.getByRole("textbox", { name: /ask me to find a product/i }),
    ).toBeVisible();
  });
});
