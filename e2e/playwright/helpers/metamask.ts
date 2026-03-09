/**
 * MetaMask Extension Helper — pure Playwright, no Synpress.
 *
 * Handles: browser launch with extension, onboarding, and popup interactions.
 */
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const METAMASK_DIR = path.join(
  __dirname,
  "..",
  ".cache-metamask",
  "metamask-chrome-13.13.1"
);

const SEED_PHRASE =
  "test test test test test test test test test test test junk";
const PASSWORD = "Tester@1234";

// ── Browser launch ──

export interface MetaMaskContext {
  context: BrowserContext;
  extensionId: string;
  metamaskPage: Page;
  userDataDir: string;
}

export async function launchBrowserWithMetaMask(
  baseURL: string
): Promise<MetaMaskContext> {
  if (!fs.existsSync(METAMASK_DIR)) {
    throw new Error(
      `MetaMask extension not found at ${METAMASK_DIR}. ` +
        `Download and extract MetaMask there.`
    );
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-e2e-"));

  const isCI = !!process.env.CI;
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      ...(isCI ? ["--headless=new"] : []),
      `--disable-extensions-except=${METAMASK_DIR}`,
      `--load-extension=${METAMASK_DIR}`,
      "--no-first-run",
      "--disable-default-apps",
    ],
    baseURL,
  });

  // Find the MetaMask extension page
  const metamaskPage = await waitForExtensionPage(context);
  const extensionId = new URL(metamaskPage.url()).host;

  // Complete onboarding
  await completeOnboarding(metamaskPage);

  return { context, extensionId, metamaskPage, userDataDir };
}

export async function cleanup(mm: MetaMaskContext) {
  await mm.context.close();
  try {
    fs.rmSync(mm.userDataDir, { recursive: true });
  } catch {}
}

// ── Onboarding ──

async function waitForExtensionPage(
  context: BrowserContext,
  timeoutMs = 30000
): Promise<Page> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    // Check existing pages
    for (const page of context.pages()) {
      if (page.url().includes("chrome-extension://") && page.url().includes("/home.html")) {
        return page;
      }
    }

    // Check service workers for extension ID
    for (const sw of context.serviceWorkers()) {
      const url = sw.url();
      if (url.includes("chrome-extension://")) {
        const extensionId = url.split("/")[2];
        const page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/home.html`);
        await page.waitForLoadState("domcontentloaded");
        return page;
      }
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  throw new Error("MetaMask extension page not found");
}

async function completeOnboarding(page: Page) {
  console.log("[MetaMask] Starting onboarding...");

  // Wait for onboarding page
  const importBtn = page.locator('[data-testid="onboarding-import-wallet"]');
  await importBtn.waitFor({ state: "visible", timeout: 30000 });

  // 1. Terms checkbox + Import wallet
  await page.locator('[data-testid="onboarding-terms-checkbox"]').click();
  await importBtn.click();
  console.log("[MetaMask] Clicked Import Wallet");

  // 2. Import with SRP
  await page.getByTestId("onboarding-import-with-srp-button").click();
  console.log("[MetaMask] Clicked Import with SRP");

  // 3. Enter seed phrase
  const srpInput = page.getByTestId("srp-input-import__srp-note");
  await srpInput.waitFor({ state: "visible", timeout: 10000 });
  await srpInput.type(SEED_PHRASE, { delay: 5 });
  console.log("[MetaMask] Entered seed phrase");

  // 4. Confirm SRP
  await page.getByTestId("import-srp-confirm").click();
  console.log("[MetaMask] Confirmed SRP");

  // 5. Create password
  const pwInput = page.locator('[data-testid="create-password-new-input"]');
  await pwInput.waitFor({ state: "visible", timeout: 15000 });
  await pwInput.fill(PASSWORD);
  await page.locator('[data-testid="create-password-confirm-input"]').fill(PASSWORD);
  await page.locator('[data-testid="create-password-terms"]').click();
  await page.locator('[data-testid="create-password-submit"]').click();
  console.log("[MetaMask] Password created");

  // 6. Analytics opt-out
  const optOut = page.locator("#metametrics-opt-in");
  await optOut.waitFor({ state: "visible", timeout: 15000 });
  await optOut.click();
  await page.locator('[data-testid="metametrics-i-agree"]').click();
  console.log("[MetaMask] Analytics opted out");

  // 7. Done — click "Open wallet"
  const doneBtn = page.locator('[data-testid="onboarding-complete-done"]');
  await doneBtn.waitFor({ state: "visible", timeout: 15000 });
  await doneBtn.click();
  console.log("[MetaMask] Clicked Done / Open wallet");

  // 8. Wait for home page + dismiss popovers
  await page.waitForTimeout(2000);
  await dismissPopovers(page);
  console.log("[MetaMask] Onboarding complete!");
}

async function dismissPopovers(page: Page) {
  const popovers = [
    '[data-testid="popover-close"]',
    ".popover-container button.btn-primary",
    '.home__new-network-added button.btn-secondary',
    ".recovery-phrase-reminder button.btn-primary",
    ".new-network-info__wrapper button.btn-primary",
  ];

  for (const selector of popovers) {
    const el = page.locator(selector).first();
    if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
      await el.click();
      await page.waitForTimeout(300);
    }
  }
}

// ── Notification popup helpers ──

async function waitForNotification(
  context: BrowserContext,
  extensionId: string,
  timeoutMs = 30000
): Promise<Page> {
  const notificationUrl = `chrome-extension://${extensionId}/notification.html`;

  // Check existing pages
  for (const page of context.pages()) {
    if (page.url().includes(notificationUrl)) {
      await page.waitForLoadState("domcontentloaded");
      return page;
    }
  }

  // Wait for new page
  const page = await context.waitForEvent("page", {
    predicate: (p) => p.url().includes(notificationUrl),
    timeout: timeoutMs,
  });

  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(500); // Let MetaMask UI settle
  return page;
}

/** Approve "Connect to dApp" popup: clicks Next then Connect */
export async function connectToDapp(
  context: BrowserContext,
  extensionId: string
) {
  const popup = await waitForNotification(context, extensionId);
  const confirmBtn = popup.locator(
    '.page-container__footer [data-testid="page-container-footer-next"]'
  );
  await confirmBtn.waitFor({ state: "visible", timeout: 10000 });
  await confirmBtn.click(); // Next
  await confirmBtn.waitFor({ state: "visible", timeout: 5000 });
  await confirmBtn.click(); // Connect
}

/** Approve "Add network" popup */
export async function approveNewNetwork(
  context: BrowserContext,
  extensionId: string
) {
  const popup = await waitForNotification(context, extensionId);
  const approveBtn = popup.locator(
    ".confirmation-footer__actions button.btn-primary"
  );
  await approveBtn.waitFor({ state: "visible", timeout: 10000 });
  await approveBtn.click();
}

/** Approve "Switch network" popup */
export async function approveSwitchNetwork(
  context: BrowserContext,
  extensionId: string
) {
  const popup = await waitForNotification(context, extensionId);
  const switchBtn = popup.locator(
    ".confirmation-footer__actions button.btn-primary"
  );
  await switchBtn.waitFor({ state: "visible", timeout: 10000 });
  await switchBtn.click();
}

/** Confirm transaction popup */
export async function confirmTransaction(
  context: BrowserContext,
  extensionId: string
) {
  const popup = await waitForNotification(context, extensionId);
  const confirmBtn = popup.locator(
    '.page-container__footer [data-testid="page-container-footer-next"]'
  );
  await confirmBtn.waitFor({ state: "visible", timeout: 10000 });
  await confirmBtn.click();
}

/** Add a custom network via MetaMask Settings UI (no popup needed) */
export async function addNetwork(
  metamaskPage: Page,
  network: { name: string; rpcUrl: string; chainId: number; symbol: string }
) {
  // Navigate to settings
  await metamaskPage.locator('[data-testid="network-display"]').click();
  await metamaskPage.waitForTimeout(500);

  // Click "Add network"
  const addBtn = metamaskPage.locator(
    '.multichain-network-list-menu-content-wrapper button:has-text("Add")'
  ).first();
  await addBtn.waitFor({ state: "visible", timeout: 5000 });
  await addBtn.click();
  await metamaskPage.waitForTimeout(500);

  // Click "Add a network manually"
  const manualBtn = metamaskPage.locator(
    'a:has-text("Add a network manually"), button:has-text("Add a network manually")'
  ).first();
  if (await manualBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await manualBtn.click();
    await metamaskPage.waitForTimeout(500);
  }

  // Fill in network details
  const inputs = metamaskPage.locator(".networks-tab__add-network-form input, .form-field input");
  const nameInput = metamaskPage.locator('[data-testid="network-form-network-name"]').or(inputs.nth(0));
  const rpcInput = metamaskPage.locator('[data-testid="network-form-rpc-url"]').or(inputs.nth(1));
  const chainIdInput = metamaskPage.locator('[data-testid="network-form-chain-id"]').or(inputs.nth(2));
  const symbolInput = metamaskPage.locator('[data-testid="network-form-ticker-input"]').or(inputs.nth(3));

  await nameInput.fill(network.name);
  await rpcInput.fill(network.rpcUrl);
  await chainIdInput.fill(String(network.chainId));
  await symbolInput.fill(network.symbol);

  // Save
  const saveBtn = metamaskPage.locator(
    'button:has-text("Save"), .networks-tab__add-network-form button.btn-primary'
  ).first();
  await saveBtn.waitFor({ state: "visible", timeout: 5000 });
  await saveBtn.click();

  await metamaskPage.waitForTimeout(1000);

  // Handle "Network added" / "Switch to network" popover
  await dismissPopovers(metamaskPage);

  // Go back to home
  await metamaskPage.locator('[data-testid="app-header-logo"]').click().catch(() => {});
  await metamaskPage.waitForTimeout(500);
}
