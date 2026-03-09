/**
 * MetaMask Extension Helper — pure Puppeteer, no Synpress.
 *
 * Handles: browser launch with extension, onboarding, and popup interactions.
 *
 * IMPORTANT: MetaMask uses LavaMoat which can interfere with page.click().
 * We use $eval(el => el.click()) for reliable clicking ("jsClick").
 */
import puppeteer from "puppeteer";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const METAMASK_DIR = path.join(
  __dirname,
  "..",
  "synpress",
  ".cache-synpress",
  "metamask-chrome-13.13.1"
);

const SEED_PHRASE =
  "test test test test test test test test test test test junk";
const PASSWORD = "Tester@1234";

/** Click via JS eval — avoids CDP mouse event issues with MetaMask's LavaMoat */
async function jsClick(page, selector) {
  await page.$eval(selector, (el) => el.click());
}

/** Wait for selector then click via JS */
async function waitAndClick(page, selector, timeout = 10000) {
  await page.waitForSelector(selector, { timeout });
  await jsClick(page, selector);
}

// ── Browser launch ──

/**
 * Launch a Chromium browser with MetaMask extension loaded.
 * Returns { browser, extensionId, metamaskPage }
 */
export async function launchBrowserWithMetaMask() {
  if (!fs.existsSync(METAMASK_DIR)) {
    throw new Error(
      `MetaMask extension not found at ${METAMASK_DIR}. ` +
        `Download it first (e.g. npx synpress cache or manually).`
    );
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-e2e-"));

  const browser = await puppeteer.launch({
    headless: false,
    args: [
      `--disable-extensions-except=${METAMASK_DIR}`,
      `--load-extension=${METAMASK_DIR}`,
      "--no-first-run",
      "--disable-default-apps",
      "--no-sandbox",
      "--disable-setuid-sandbox",
    ],
    userDataDir,
  });

  // Find the MetaMask extension page (wait for its own page, don't create duplicate)
  const metamaskPage = await waitForExtensionPage(browser);
  const extensionId = new URL(metamaskPage.url()).host;

  // Complete onboarding
  await completeOnboarding(metamaskPage);

  return { browser, extensionId, metamaskPage, userDataDir };
}

export async function cleanup(mm) {
  if (mm.browser) await mm.browser.close();
  try {
    fs.rmSync(mm.userDataDir, { recursive: true });
  } catch {}
}

// ── Onboarding ──

async function waitForExtensionPage(browser, timeoutMs = 30000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    // Check existing pages for MetaMask's own home.html
    const pages = await browser.pages();
    for (const page of pages) {
      const url = page.url();
      if (url.includes("chrome-extension://") && url.includes("/home.html")) {
        console.log(`[MetaMask] Found extension page: ${url}`);
        await page.bringToFront();
        // Wait for React to render (any data-testid to appear)
        try {
          await page.waitForSelector("[data-testid]", { timeout: 15000 });
        } catch {}
        await new Promise((r) => setTimeout(r, 1000));
        return page;
      }
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  throw new Error("MetaMask extension page not found");
}

async function completeOnboarding(page) {
  console.log("[MetaMask] Starting onboarding...");

  // 1. Wait for welcome page and click "I have an existing wallet"
  await page.waitForSelector('[data-testid="onboarding-import-wallet"]', {
    timeout: 30000,
  });
  await new Promise((r) => setTimeout(r, 1000)); // Let animation finish
  await jsClick(page, '[data-testid="onboarding-import-wallet"]');
  console.log("[MetaMask] Clicked Import Wallet");
  await new Promise((r) => setTimeout(r, 2000));

  // 2. Click "Import using Secret Recovery Phrase" (MetaMask 13.x shows Google/Apple/SRP options)
  try {
    await page.waitForSelector(
      '[data-testid="onboarding-import-with-srp-button"]',
      { timeout: 8000 }
    );
    await jsClick(page, '[data-testid="onboarding-import-with-srp-button"]');
    console.log("[MetaMask] Clicked Import with SRP");
    await new Promise((r) => setTimeout(r, 2000));
  } catch {
    console.log("[MetaMask] No SRP button (older version?)");
  }

  // 3. In MetaMask 13.13.1 metametrics comes AFTER password, not here.
  //    Skip this step.

  // 4. Enter seed phrase
  // MetaMask 13.13.1 uses a textarea with data-testid="srp-input-import__srp-note"
  // Older versions use word-by-word inputs with data-testid="import-srp__srp-word-{i}"
  await new Promise((r) => setTimeout(r, 1000));

  const hasTextarea = await page.$('[data-testid="srp-input-import__srp-note"]');
  const hasWordInputs = await page.$('[data-testid="import-srp__srp-word-0"]');

  if (hasTextarea) {
    // MetaMask 13.13.1: single textarea.
    // page.type() is the only method that properly triggers React state updates
    // (LavaMoat blocks all other JS-based approaches).
    // Despite char-by-char typing causing visual word-splitting, the validation
    // still passes and the Continue button becomes enabled.
    await page.type('[data-testid="srp-input-import__srp-note"]', SEED_PHRASE, {
      delay: 5,
    });
    console.log("[MetaMask] Entered seed phrase (textarea)");
  } else if (hasWordInputs) {
    // Older versions: word-by-word
    const words = SEED_PHRASE.split(" ");
    for (let i = 0; i < words.length; i++) {
      const selector = `[data-testid="import-srp__srp-word-${i}"]`;
      await page.waitForSelector(selector, { timeout: 5000 });
      await page.type(selector, words[i]);
    }
    console.log("[MetaMask] Entered seed phrase (word-by-word)");
  } else {
    throw new Error("Could not find seed phrase input");
  }

  // 5. Click Continue/Confirm (may be disabled until phrase is validated)
  // Wait for button to become enabled — poll with $eval to avoid LavaMoat blocking waitForFunction
  await new Promise((r) => setTimeout(r, 1000));
  const confirmStart = Date.now();
  while (Date.now() - confirmStart < 15000) {
    try {
      const disabled = await page.$eval(
        '[data-testid="import-srp-confirm"]',
        (el) => el.disabled
      );
      if (!disabled) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  await jsClick(page, '[data-testid="import-srp-confirm"]');
  console.log("[MetaMask] Confirmed SRP");
  await new Promise((r) => setTimeout(r, 2000));

  // 6. Create password
  // MetaMask 13.13.1 selectors: create-password-new-input, create-password-confirm-input, create-password-submit
  await page.waitForSelector('[data-testid="create-password-new-input"]', {
    timeout: 15000,
  });
  await page.type('[data-testid="create-password-new-input"]', PASSWORD);
  await page.type('[data-testid="create-password-confirm-input"]', PASSWORD);

  // Terms checkbox
  try {
    await jsClick(page, '[data-testid="create-password-terms"]');
  } catch {}

  // Submit
  await new Promise((r) => setTimeout(r, 500));
  await jsClick(page, '[data-testid="create-password-submit"]');
  console.log("[MetaMask] Password created");
  await new Promise((r) => setTimeout(r, 5000));

  // 7. Metametrics consent (MetaMask 13.13.1 shows this AFTER password)
  try {
    await page.waitForSelector('[data-testid="metametrics-i-agree"]', {
      timeout: 15000,
    });
    await jsClick(page, '[data-testid="metametrics-i-agree"]');
    console.log("[MetaMask] Accepted metametrics");
    await new Promise((r) => setTimeout(r, 2000));
  } catch {
    console.log("[MetaMask] No metametrics page");
  }

  // 8. Wait for completion
  await page.waitForSelector('[data-testid="onboarding-complete-done"]', {
    timeout: 30000,
  });
  await jsClick(page, '[data-testid="onboarding-complete-done"]');
  console.log("[MetaMask] Clicked Done");
  await new Promise((r) => setTimeout(r, 1000));

  // 9. Pin extension page — "Next" then possibly "Done"
  try {
    await page.waitForSelector('[data-testid="pin-extension-next"]', {
      timeout: 5000,
    });
    await jsClick(page, '[data-testid="pin-extension-next"]');
    await new Promise((r) => setTimeout(r, 500));
    await page.waitForSelector('[data-testid="pin-extension-done"]', {
      timeout: 5000,
    });
    await jsClick(page, '[data-testid="pin-extension-done"]');
  } catch {
    console.log("[MetaMask] No pin extension step");
  }

  // 10. Force navigate to wallet dashboard (completion page may be stuck)
  await new Promise((r) => setTimeout(r, 2000));
  const baseUrl = page.url().split("#")[0];
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
  await new Promise((r) => setTimeout(r, 3000));
  await dismissPopovers(page);
  console.log("[MetaMask] Onboarding complete!");
}

async function dismissPopovers(page) {
  const selectors = [
    '[data-testid="popover-close"]',
    '[data-testid="auto-detect-token-modal-close"]',
  ];

  for (const selector of selectors) {
    try {
      const el = await page.$(selector);
      if (el) {
        await jsClick(page, selector);
        await new Promise((r) => setTimeout(r, 300));
      }
    } catch {}
  }
}

// ── Notification popup helpers ──

/**
 * Wait for a MetaMask notification popup to appear.
 * MetaMask opens notification.html in a new tab/window.
 */
async function waitForNotification(browser, extensionId, timeoutMs = 30000) {
  const notificationUrl = `chrome-extension://${extensionId}/notification.html`;

  // Check existing pages
  const pages = await browser.pages();
  for (const page of pages) {
    if (page.url().includes(notificationUrl)) {
      await page.bringToFront();
      return page;
    }
  }

  // Wait for new target
  const target = await browser.waitForTarget(
    (t) => t.url().includes(notificationUrl),
    { timeout: timeoutMs }
  );
  const page = await target.page();
  await page.bringToFront();
  await new Promise((r) => setTimeout(r, 1000)); // Let MetaMask UI settle
  return page;
}

/** Approve "Connect to dApp" popup */
export async function connectToDapp(browser, extensionId) {
  const popup = await waitForNotification(browser, extensionId, 15000);

  // MetaMask 13.x connect flow: Next → Connect
  await waitAndClick(popup, '[data-testid="page-container-footer-next"]');
  await new Promise((r) => setTimeout(r, 500));

  // Second confirmation (Connect)
  try {
    await waitAndClick(
      popup,
      '[data-testid="page-container-footer-next"]',
      5000
    );
  } catch {
    // Some flows only have one step
  }
}

/** Approve "Add network" popup */
export async function approveNewNetwork(browser, extensionId) {
  const popup = await waitForNotification(browser, extensionId);
  await waitAndClick(
    popup,
    ".confirmation-footer__actions button.btn-primary"
  );
}

/** Approve "Switch network" popup */
export async function approveSwitchNetwork(browser, extensionId) {
  const popup = await waitForNotification(browser, extensionId);
  await waitAndClick(
    popup,
    ".confirmation-footer__actions button.btn-primary"
  );
}

/** Confirm transaction popup */
export async function confirmTransaction(browser, extensionId) {
  const popup = await waitForNotification(browser, extensionId);

  const confirmSelectors = [
    '[data-testid="page-container-footer-next"]',
    '[data-testid="confirm-footer-button"]',
    ".confirmation-footer__actions button.btn-primary",
  ];

  for (const selector of confirmSelectors) {
    try {
      await waitAndClick(popup, selector, 5000);
      return;
    } catch {}
  }
  throw new Error("Could not find confirm button in MetaMask popup");
}

/** Sign a message (personal_sign) */
export async function signMessage(browser, extensionId) {
  const popup = await waitForNotification(browser, extensionId);

  // Try scroll button first
  try {
    const scrollBtn = await popup.$(
      '[data-testid="signature-request-scroll-button"]'
    );
    if (scrollBtn) {
      await jsClick(popup, '[data-testid="signature-request-scroll-button"]');
      await new Promise((r) => setTimeout(r, 300));
    }
  } catch {}

  // Click sign
  const signSelectors = [
    '[data-testid="page-container-footer-next"]',
    '[data-testid="signature-request-scroll-button"]',
    ".request-signature__footer button.btn-primary",
  ];

  for (const selector of signSelectors) {
    try {
      await waitAndClick(popup, selector, 5000);
      return;
    } catch {}
  }
  throw new Error("Could not find sign button in MetaMask popup");
}

/** Add a custom network via MetaMask Settings UI */
export async function addNetwork(
  metamaskPage,
  { name, rpcUrl, chainId, symbol }
) {
  // Navigate to settings > networks
  await jsClick(metamaskPage, '[data-testid="network-display"]');
  await new Promise((r) => setTimeout(r, 500));

  // Click "Add network"
  try {
    const buttons = await metamaskPage.$$("button");
    for (const btn of buttons) {
      const text = await metamaskPage.evaluate((el) => el.textContent, btn);
      if (text && text.includes("Add")) {
        await btn.evaluate((el) => el.click());
        break;
      }
    }
  } catch {}
  await new Promise((r) => setTimeout(r, 500));

  // Click "Add a network manually"
  try {
    const links = await metamaskPage.$$("a, button");
    for (const link of links) {
      const text = await metamaskPage.evaluate((el) => el.textContent, link);
      if (text && text.includes("Add a network manually")) {
        await link.evaluate((el) => el.click());
        break;
      }
    }
  } catch {}
  await new Promise((r) => setTimeout(r, 500));

  // Fill in network details
  const nameInput = await metamaskPage.$(
    '[data-testid="network-form-network-name"]'
  );
  const rpcInput = await metamaskPage.$(
    '[data-testid="network-form-rpc-url"]'
  );
  const chainIdInput = await metamaskPage.$(
    '[data-testid="network-form-chain-id"]'
  );
  const symbolInput = await metamaskPage.$(
    '[data-testid="network-form-ticker-input"]'
  );

  if (nameInput) await nameInput.type(name);
  if (rpcInput) await rpcInput.type(rpcUrl);
  if (chainIdInput) await chainIdInput.type(String(chainId));
  if (symbolInput) await symbolInput.type(symbol);

  // Save
  const buttons = await metamaskPage.$$("button");
  for (const btn of buttons) {
    const text = await metamaskPage.evaluate((el) => el.textContent, btn);
    if (text && text.includes("Save")) {
      await btn.evaluate((el) => el.click());
      break;
    }
  }

  await new Promise((r) => setTimeout(r, 1000));
  await dismissPopovers(metamaskPage);
}
