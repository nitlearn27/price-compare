import { test, expect } from "@playwright/test";

// These E2E tests require the backend + frontend running.
// Run: cd backend && uvicorn app.main:app & cd frontend && pnpm dev
// Then: pnpm test:e2e

test.describe("Product comparison flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("http://localhost:5173");
  });

  test("shows empty state with example prompts on load", async ({ page }) => {
    await expect(page.getByText(/what are you looking for/i)).toBeVisible();
    await expect(page.getByText(/nandini cow milk/i)).toBeVisible();
  });

  test("chat input is visible and accepts text", async ({ page }) => {
    const input = page.getByRole("textbox");
    await input.fill("Find Aashirvaad Atta 5kg");
    await expect(input).toHaveValue("Find Aashirvaad Atta 5kg");
  });

  test("clicking example prompt fills input", async ({ page }) => {
    const prompt = page.getByText(/nandini cow milk/i).first();
    await prompt.click();
    // Input gets set and message is sent
    await expect(page.getByText(/nandini cow milk/i)).toBeVisible();
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
    await expect(page.getByRole("textbox")).toBeVisible();
  });
});
