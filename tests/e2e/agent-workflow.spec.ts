import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

/**
 * The full product workflow from the specification, driven through the UI with a
 * real worker (deterministic demo provider) and local Supabase:
 *  1 sign up → 2 organization + workspace → 3 upload → 4 indexed → 5 task →
 *  6 plan → 7 document search → 8 live progress → 9 approval request →
 *  10 approve → 11 report in artifacts → 12 inspect sources.
 * Plus rejection, cancellation, and cross-organization access.
 * Screenshots for the README are written to docs/screenshots.
 */
test.describe.configure({ mode: "serial" });

const stamp = Date.now();
const owner = { email: `e2e-owner-${stamp}@example.test`, password: "e2e-password-123" };
const fixtures = path.join(process.cwd(), "tests", "fixtures", "demo");
const shots = path.join(process.cwd(), "docs", "screenshots");
let workspaceUrl = "";
let approvedRunUrl = "";

async function signUp(page: Page, email: string, password: string) {
  await page.goto("/sign-up");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
}

async function startTask(page: Page, title: string, objective: string) {
  await page.goto(`${workspaceUrl}/runs/new`);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Objective").fill(objective);
  await page.getByRole("button", { name: "Review task" }).click();
  await expect(page.getByText("Review the task")).toBeVisible();
  await page.getByRole("button", { name: "Start run" }).click();
  await page.waitForURL(/\/agent-runs\/[0-9a-f-]{36}$/);
}

test("1-2. sign up, onboarding creates the organization and workspace", async ({ page }) => {
  await signUp(page, owner.email, owner.password);
  await page.waitForURL(/\/onboarding/);
  await page.getByLabel("Organization name").fill(`E2E Org ${stamp}`);
  await page.getByLabel("First workspace").fill("Getting started");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await page.waitForURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

test("2. create a workspace", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(owner.email);
  await page.getByLabel("Password").fill(owner.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard/);
  await page.context().storageState({ path: "test-results/owner.json" });

  await page.goto("/workspaces");
  await page.getByRole("button", { name: "New workspace" }).click();
  await page.getByLabel("Name").fill("Sales Analytics");
  await page.getByLabel(/Description/).fill("Q3 revenue analysis");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await page.waitForURL(/\/workspaces\/[0-9a-f-]{36}$/);
  workspaceUrl = new URL(page.url()).pathname;
  await expect(page.getByRole("heading", { name: "Sales Analytics" })).toBeVisible();
});

test.describe("as the workspace owner", () => {
  test.use({ storageState: "test-results/owner.json" });

  test("3-4. upload documents and see them indexed live", async ({ page }) => {
    await page.goto(`${workspaceUrl}/documents`);
    // The live indicator renders only after hydration, so the file input's handler is attached.
    await expect(page.getByText("Live", { exact: true }).first()).toBeVisible();
    await page.getByLabel("Choose files to upload").setInputFiles([
      path.join(fixtures, "q3-sales-review.md"),
      path.join(fixtures, "regional-notes.txt"),
      path.join(fixtures, "monthly-revenue-2026.csv"),
    ]);
    await expect(page.getByText("Queued for indexing")).toHaveCount(3);
    // Status changes arrive through Realtime; no reload.
    await expect(page.locator("li span").filter({ hasText: /^Indexed$/ })).toHaveCount(3, { timeout: 60_000 });
    await page.screenshot({ path: path.join(shots, "knowledge-base.png") });
  });

  test("5-10. create a task, follow it live, approve the report", async ({ page }) => {
    await startTask(page, "Q3 regional revenue report", "Analyze the Q3 sales review and revenue dataset, compare regions, and save a report with sources.");

    // 6. plan, 7. document search — all pushed live, no reload.
    await expect(page.getByText("Search workspace sources").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Plan" })).toBeVisible();
    await expect(page.getByText("Analyze dataset").first()).toBeVisible({ timeout: 30_000 });

    // 8-9. the run pauses with an approval request.
    await expect(page.getByText("Approval required: Save report as a workspace artifact")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Waiting for approval").first()).toBeVisible();
    await page.screenshot({ path: path.join(shots, "run-approval.png") });

    // 10. approve and watch it complete.
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("Completed", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Final answer" })).toBeVisible();
    await expect(page.getByText("Saved reports")).toBeVisible();
    approvedRunUrl = new URL(page.url()).pathname;
    await page.screenshot({ path: path.join(shots, "run-completed.png"), fullPage: true });
  });

  test("11-12. the report is in the workspace artifacts and its sources can be inspected", async ({ page }) => {
    await page.goto(`${workspaceUrl}/artifacts`);
    const report = page.getByRole("link", { name: /Report: Analyze the Q3 sales review/ });
    await expect(report).toBeVisible();
    await report.click();
    await expect(page.getByText("Created by an agent run")).toBeVisible();
    await expect(page.getByText(/^Approved /)).toBeVisible();
    await page.screenshot({ path: path.join(shots, "report.png"), fullPage: true });

    await page.getByRole("button", { name: "Open document" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Document details and index status.")).toBeVisible();
    await expect(dialog.getByRole("link", { name: /Download original/ })).toBeVisible();
  });

  test("rejecting an approval returns it to the agent and saves nothing", async ({ page }) => {
    await startTask(page, "APAC report draft", "Summarize the APAC situation from the regional notes and save a short report.");
    await expect(page.getByText(/Approval required/)).toBeVisible({ timeout: 30_000 });
    await page.getByLabel(/Note/).fill("Wait for the final September numbers.");
    await page.getByRole("button", { name: "Reject" }).click();
    await expect(page.getByText("Completed", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Approval history" })).toBeVisible();
    await expect(page.getByText("“Wait for the final September numbers.”")).toBeVisible();
    await expect(page.getByText("Saved reports")).toHaveCount(0);
  });

  test("cancelling a run stops it", async ({ page }) => {
    await startTask(page, "Leadership briefing", "Prepare a leadership briefing on regional performance and save it as a report.");
    await expect(page.getByText(/Approval required/)).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Cancel run" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Cancel run" }).click();
    await expect(page.getByText("Cancelled", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("This run was cancelled.")).toBeVisible();
  });

  test("dashboard and usage reflect the runs", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByText("Q3 regional revenue report").first()).toBeVisible();
    await page.waitForTimeout(1500); // let chart animations finish before the screenshot
    await page.screenshot({ path: path.join(shots, "dashboard.png"), fullPage: true });
    await page.goto("/usage");
    await expect(page.getByText("Tool calls", { exact: true })).toBeVisible();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(shots, "usage.png"), fullPage: true });
    await page.goto("/approvals");
    await expect(page.getByText("Nothing to review")).toBeVisible();
  });

  test("dark theme and small screens", async ({ browser }) => {
    const dark = await browser.newContext({ storageState: "test-results/owner.json", colorScheme: "dark", viewport: { width: 1440, height: 900 } });
    const darkPage = await dark.newPage();
    await darkPage.goto(approvedRunUrl);
    await expect(darkPage.locator("html")).toHaveClass(/dark/);
    await expect(darkPage.getByRole("heading", { name: "Final answer" })).toBeVisible();
    await darkPage.screenshot({ path: path.join(shots, "run-dark.png") });
    await dark.close();

    const mobile = await browser.newContext({ storageState: "test-results/owner.json", viewport: { width: 390, height: 844 }, isMobile: true });
    const mobilePage = await mobile.newPage();
    await mobilePage.goto(approvedRunUrl);
    await expect(mobilePage.getByRole("tab", { name: "Timeline" })).toBeVisible();
    const fitsViewport = () => mobilePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(await fitsViewport()).toBe(true);
    await mobilePage.screenshot({ path: path.join(shots, "run-mobile.png") });
    for (const route of ["/dashboard", "/usage", `${workspaceUrl}/documents`, "/approvals", "/artifacts"]) {
      await mobilePage.goto(route);
      await mobilePage.waitForLoadState("networkidle");
      expect(await fitsViewport(), `${route} overflows horizontally on mobile`).toBe(true);
    }
    await mobile.close();
  });
});

test("another organization cannot access the run, its API, or the workspace", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signUp(page, `e2e-intruder-${stamp}@example.test`, "e2e-password-123");
  await page.waitForURL(/\/onboarding/);
  await page.getByLabel("Organization name").fill(`Intruder ${stamp}`);
  await page.getByLabel("First workspace").fill("Elsewhere");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await page.waitForURL(/\/dashboard/);

  // Pages stream, so the HTTP status is already sent; assert on what is rendered instead.
  await page.goto(approvedRunUrl);
  await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
  await expect(page.getByText("Q3 regional revenue report")).toHaveCount(0);
  const api = await page.request.get(`/api/agent-runs/${approvedRunUrl.split("/").pop()}`);
  expect(api.status()).toBe(404);
  await page.goto(workspaceUrl);
  await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
  await expect(page.getByText("Sales Analytics")).toHaveCount(0);
  const reports = await page.request.get("/api/artifacts");
  expect((await reports.json()).data).toEqual([]);
  await context.close();
});

test("unauthenticated visitors are redirected to sign in", async ({ page }) => {
  await page.goto(approvedRunUrl);
  await expect(page).toHaveURL(/\/sign-in\?next=/);
  const api = await page.request.get("/api/agent-runs");
  expect(api.status()).toBe(401);
});
