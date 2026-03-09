/**
 * Full Story E2E — Heritage Splitter
 *
 * REAL browser E2E tests: navigate the frontend, fill forms, click buttons,
 * follow the complete user workflow through the UI.
 *
 * globalSetup provides: infrastructure + 4 authenticated personas.
 * All data creation happens HERE in the browser.
 *
 * Single serial block — if one step fails, all subsequent are skipped.
 */
import { test, expect, type Page } from "@playwright/test";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
} from "viem";
import { foundry } from "viem/chains";
import * as fs from "node:fs";
import {
  NFT_ABI,
  MARKET_ABI,
  SHOWROOM_ABI,
  DOC_REGISTRY_ABI,
  PAYMENT_REGISTRY_ABI,
} from "../helpers/contracts";
import {
  ALICE_ACCOUNT,
  BOB_ACCOUNT,
  CHARLIE_ACCOUNT,
  DAVE_ACCOUNT,
  type E2EConfig,
  apiAuth as _apiAuth,
  createTempPng,
  cleanupTempFile,
} from "../helpers/shared";

// ── Shared state across serial tests ──
let cfg: E2EConfig;
let publicClient: ReturnType<typeof createPublicClient>;
let projectId: string;
let collectionId: string;
let publicSlug: string;
let showroomId: string;
let showroomSlug: string;
let nftAddr: string;
let documentId: string;
let documentHash: string;

// Balance snapshots for payment verification
let aliceBalBeforeDirect: bigint;
let bobBalBeforeDirect: bigint;
let aliceBalBeforeShowroom: bigint;
let bobBalBeforeShowroom: bigint;
let daveBalBeforeShowroom: bigint;

function loadConfig() {
  if (cfg) return;
  const configPath = process.env.E2E_CONFIG_PATH;
  if (!configPath)
    throw new Error("E2E_CONFIG_PATH not set — globalSetup failed?");
  cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  publicClient = createPublicClient({
    chain: foundry,
    transport: http(cfg.anvilRpc),
  });
}

test.beforeAll(() => {
  loadConfig();
});

// ── Helpers ──

/**
 * Set JWT in localStorage BEFORE the page loads.
 * Call this before page.goto() — the token will be available when SolidJS initializes.
 */
async function loginAs(page: Page, token: string) {
  await page.addInitScript((t) => {
    localStorage.setItem("heritage_token", t);
  }, token);
}

/** API request for actions without UI (e.g. Bob's approval) */
function apiAuth<T = any>(token: string, urlPath: string, options: RequestInit = {}) {
  return _apiAuth<T>(cfg.apiUrl, token, urlPath, options);
}

/** Guard — fail fast with a clear message if a prior test didn't set shared state */
function require(value: unknown, name: string): asserts value {
  if (!value) throw new Error(`${name} is not set — did a prior test fail?`);
}

// ============================================================
// ALL TESTS — single serial block so failures cascade
// ============================================================

test.describe.serial("Full Story", () => {
  // ── CHAPTER 1: Project ──

  test("1.1 Alice creates a project", async ({ page }) => {
    await loginAs(page, cfg.aliceToken);
    await page.goto("/projects/new");

    // Fill project name
    const nameInput = page.locator(
      'input[placeholder="e.g. Lights of Paris Collection"]'
    );
    await nameInput.fill("Alice & Bob Collab");

    const descInput = page.locator(
      'textarea[placeholder="Describe your artistic project..."]'
    );
    await descInput.fill("A collaborative art project");

    // Upload logo
    const tmpPng = createTempPng("e2e-logo");
    await page.locator('input[type="file"][accept*="image"]').setInputFiles(tmpPng);

    const createBtn = page.getByRole("button", { name: "Create project" });
    await expect(createBtn).toBeEnabled({ timeout: 10000 });

    await createBtn.click();

    // Should navigate to the new project
    await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+/, { timeout: 15000 });
    projectId = page.url().match(/\/projects\/([a-f0-9-]+)/)?.[1] || "";
    expect(projectId).toBeTruthy();

    await expect(page.locator("h1")).toContainText("Alice & Bob Collab", {
      timeout: 10000,
    });

    cleanupTempFile(tmpPng);
  });

  test("1.2 Alice invites Bob", async ({ page }) => {
    require(projectId, "projectId");
    await loginAs(page, cfg.aliceToken);
    await page.goto(`/projects/${projectId}`);
    await expect(page.locator("h1")).toContainText("Alice & Bob Collab", {
      timeout: 15000,
    });

    await test.step("Search and invite Bob", async () => {
      await page
        .locator('input[placeholder="Search for a user..."]')
        .fill("Bob");
      await page.getByText("Invite", { exact: true }).first().click({ timeout: 10000 });
    });

    await expect(page.getByText("Invited")).toBeVisible({ timeout: 10000 });
  });

  test("1.3 Bob accepts the invitation", async ({ page }) => {
    require(projectId, "projectId");
    await loginAs(page, cfg.bobToken);
    await page.goto(`/projects/${projectId}`);
    await expect(page.locator("h1")).toContainText("Alice & Bob Collab", {
      timeout: 15000,
    });

    // Click Accept
    await page.getByRole("button", { name: "Accept" }).click();

    // Wait for the "Accepted" badge to appear next to Bob
    await expect(page.getByText("Accepted").first()).toBeVisible({
      timeout: 10000,
    });

    // The participant count should show 2 (creator + Bob)
    await expect(page.getByText("Participants", { exact: true })).toBeVisible({ timeout: 5000 });
  });

  // ── CHAPTER 2: Document Certification ──

  test("2.1 Alice uploads a document", async ({ page }) => {
    require(projectId, "projectId");
    await loginAs(page, cfg.aliceToken);
    await page.goto(`/projects/${projectId}/documents`);

    await expect(page.getByText("No documents yet.")).toBeVisible({ timeout: 15000 });

    await test.step("Upload file", async () => {
      const tmpFile = createTempPng("e2e-doc");
      await page.locator("#doc-upload-input").setInputFiles(tmpFile);
      cleanupTempFile(tmpFile);
    });

    await expect(page.getByText(".png").first()).toBeVisible({ timeout: 15000 });

    await test.step("Fetch document metadata from API", async () => {
      const docs = (await apiAuth(
        cfg.aliceToken,
        `/projects/${projectId}/documents`
      )) as any[];
      expect(docs.length).toBeGreaterThanOrEqual(1);
      documentId = docs[0].id;
      documentHash = docs[0].sha256_hash;
      expect(documentId).toBeTruthy();
      expect(documentHash).toBeTruthy();
    });
  });

  test("2.2 Alice shares document with Bob", async ({ page }) => {
    require(projectId, "projectId");
    require(documentId, "documentId");
    await loginAs(page, cfg.aliceToken);
    await page.goto(`/projects/${projectId}/documents`);

    // Wait for document to appear
    await expect(page.getByText(".png").first()).toBeVisible({ timeout: 15000 });

    // Click Share button
    await page.getByRole("button", { name: "Share" }).first().click();

    // Share modal should appear
    await expect(page.getByText("Share document")).toBeVisible({
      timeout: 5000,
    });

    // Select Bob's checkbox
    const bobCheckbox = page.locator("label").filter({ hasText: "Bob" }).locator("input[type='checkbox']");
    await bobCheckbox.check();

    // Click "Share" confirm button (shows count)
    await page.getByRole("button", { name: /Share \(1\)/ }).click();

    // Modal should close
    await expect(page.getByText("Share document")).not.toBeVisible({
      timeout: 5000,
    });
  });

  test("2.3 Alice certifies the document (API + EIP-712)", async () => {
    require(documentId, "documentId");
    require(documentHash, "documentHash");

    const walletClient = createWalletClient({
      account: ALICE_ACCOUNT,
      chain: foundry,
      transport: http(cfg.anvilRpc),
    });

    // Get nonce from contract via backend
    const { nonce } = (await apiAuth(
      cfg.aliceToken,
      `/documents/nonce/${ALICE_ACCOUNT.address}`
    )) as { nonce: number };

    const deadline = Math.floor(Date.now() / 1000) + 3600;

    // Sign EIP-712 typed data
    const signature = await walletClient.signTypedData({
      domain: {
        name: "DocumentRegistry",
        version: "1",
        chainId: 31337,
        verifyingContract: cfg.docRegistryAddr as `0x${string}`,
      },
      types: {
        Certify: [
          { name: "hash", type: "bytes32" },
          { name: "certifier", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "Certify",
      message: {
        hash: `0x${documentHash}` as `0x${string}`,
        certifier: ALICE_ACCOUNT.address,
        nonce: BigInt(nonce),
        deadline: BigInt(deadline),
      },
    });

    // Submit to backend — it relays to the contract
    await apiAuth(cfg.aliceToken, `/documents/${documentId}/certify`, {
      method: "POST",
      body: JSON.stringify({ signature, deadline }),
    });
  });

  test("2.4 Document shows Certified badge", async ({ page }) => {
    require(projectId, "projectId");
    await loginAs(page, cfg.aliceToken);
    await page.goto(`/projects/${projectId}/documents`);

    await expect(page.getByText("Certified").first()).toBeVisible({
      timeout: 15000,
    });
  });

  test("2.5 On-chain: document hash is certified", async () => {
    require(documentHash, "documentHash");
    const timestamp = await publicClient.readContract({
      address: cfg.docRegistryAddr as `0x${string}`,
      abi: DOC_REGISTRY_ABI,
      functionName: "certifications",
      args: [`0x${documentHash}` as `0x${string}`],
    });
    expect(timestamp).toBeGreaterThan(0n);
  });

  test("2.6 Bob can see the shared document", async ({ page }) => {
    require(projectId, "projectId");
    await loginAs(page, cfg.bobToken);
    await page.goto(`/projects/${projectId}/documents`);

    await expect(page.getByText(".png").first()).toBeVisible({
      timeout: 15000,
    });
  });

  // ── CHAPTER 3: Collection ──

  test("3.1 Alice creates a collection", async ({ page }) => {
    require(projectId, "projectId");
    await loginAs(page, cfg.aliceToken);
    await page.goto(
      `/projects/${projectId}/collections/new?type=nft_collection`
    );

    // Wait for the form — heading is h2
    await expect(page.locator("h2")).toContainText("New NFT collection", {
      timeout: 15000,
    });

    await page
      .locator('input[placeholder="E.g.: Paris Lights Collection..."]')
      .fill("Duo Collection");

    await page.getByRole("button", { name: "Create", exact: true }).click();

    // Navigate to the new collection
    await expect(page).toHaveURL(/\/collections\/[a-f0-9-]+/, {
      timeout: 15000,
    });
    collectionId = page.url().match(/\/collections\/([a-f0-9-]+)/)?.[1] || "";
    expect(collectionId).toBeTruthy();

    // Should see Draft status
    await expect(page.getByText("Draft").first()).toBeVisible({
      timeout: 10000,
    });
  });

  test("3.2 Alice adds NFT 'Sunrise' (0.1 AVAX)", async ({ page }) => {
    require(collectionId, "collectionId");
    await loginAs(page, cfg.aliceToken);
    await page.goto(
      `/projects/${projectId}/collections/${collectionId}/nfts`
    );

    const addBtn = page.getByRole("button", { name: "+ Add an NFT" });
    await expect(addBtn).toBeVisible({ timeout: 15000 });
    await addBtn.click();

    await page.locator('input[placeholder="NFT name"]').fill("Sunrise");
    await page.locator('input[placeholder="0.00"]').fill("0.1");
    await page
      .locator('textarea[placeholder="NFT description..."]')
      .fill("A beautiful sunrise");

    // Upload image
    const tmpPng = createTempPng("e2e-nft1");
    await page.locator('input[type="file"][accept="image/*"]').setInputFiles(tmpPng);

    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText("Sunrise")).toBeVisible({ timeout: 10000 });
    cleanupTempFile(tmpPng);
  });

  test("3.3 Alice adds NFT 'Moonlight' (0.2 AVAX)", async ({ page }) => {
    require(projectId, "projectId");
    require(collectionId, "collectionId");
    await loginAs(page, cfg.aliceToken);
    await page.goto(
      `/projects/${projectId}/collections/${collectionId}/nfts`
    );
    await expect(page.getByText("Sunrise")).toBeVisible({ timeout: 15000 });

    await page.getByRole("button", { name: "+ Add an NFT" }).click();
    await page.locator('input[placeholder="NFT name"]').fill("Moonlight");
    await page.locator('input[placeholder="0.00"]').fill("0.2");
    await page
      .locator('textarea[placeholder="NFT description..."]')
      .fill("A moonlit landscape");

    const tmpPng = createTempPng("e2e-nft2");
    await page.locator('input[type="file"][accept="image/*"]').setInputFiles(tmpPng);

    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText("Moonlight")).toBeVisible({ timeout: 10000 });
    cleanupTempFile(tmpPng);
  });

  test("3.4 Alice adds NFT 'Ocean' (0.5 AVAX)", async ({ page }) => {
    require(projectId, "projectId");
    require(collectionId, "collectionId");
    await loginAs(page, cfg.aliceToken);
    await page.goto(
      `/projects/${projectId}/collections/${collectionId}/nfts`
    );
    await expect(page.getByText("Moonlight")).toBeVisible({ timeout: 15000 });

    await page.getByRole("button", { name: "+ Add an NFT" }).click();
    await page.locator('input[placeholder="NFT name"]').fill("Ocean");
    await page.locator('input[placeholder="0.00"]').fill("0.5");
    await page
      .locator('textarea[placeholder="NFT description..."]')
      .fill("Deep ocean waves");

    const tmpPng = createTempPng("e2e-nft3");
    await page.locator('input[type="file"][accept="image/*"]').setInputFiles(tmpPng);

    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText("Ocean")).toBeVisible({ timeout: 10000 });
    cleanupTempFile(tmpPng);
  });

  // ── CHAPTER 4: Allocations ──

  test("4.1 Alice adds a 30% share for collaborator", async ({ page }) => {
    require(collectionId, "collectionId");
    await loginAs(page, cfg.aliceToken);
    await page.goto(
      `/projects/${projectId}/collections/${collectionId}/allocations`
    );

    await expect(page.getByText("Your share (creator)")).toBeVisible({
      timeout: 15000,
    });

    await page.getByRole("button", { name: "+ Add a share" }).click();

    await page
      .locator('input[placeholder="E.g.: Lead Artist, Producer..."]')
      .fill("Collaborator");

    // The percentage input — find the one in the create form
    const percentInputs = page.locator(
      '.card input[type="number"][step="0.1"]'
    );
    await percentInputs.first().fill("30");

    await page.getByRole("button", { name: "Create share" }).click();

    await expect(
      page.getByText("Collaborator", { exact: true }).first()
    ).toBeVisible({ timeout: 10000 });
  });

  test("4.2 Alice invites Bob to the share", async ({ page }) => {
    require(projectId, "projectId");
    require(collectionId, "collectionId");
    await loginAs(page, cfg.aliceToken);
    await page.goto(
      `/projects/${projectId}/collections/${collectionId}/allocations`
    );

    await expect(page.getByText("Collaborator", { exact: true }).first()).toBeVisible({
      timeout: 15000,
    });

    // Click invite button inside the share card
    await page
      .getByRole("button", { name: "+ Invite a participant" })
      .click();

    // The search input for project members
    const searchInput = page.locator(
      'input[placeholder="Search for a project member..."]'
    );
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    // Focus the input — the member list should appear (no typing needed for project members)
    await searchInput.click();

    // Click on Bob in the dropdown
    const bobOption = page
      .locator("button")
      .filter({ hasText: "Bob" })
      .first();
    await expect(bobOption).toBeVisible({ timeout: 10000 });
    await bobOption.click();

    // Click Invite
    await page.getByRole("button", { name: "Invite", exact: true }).click();

    // Bob should appear in the share
    await expect(page.locator("body")).toContainText("Bob", { timeout: 10000 });
  });

  // ── CHAPTER 5: Approval & Deploy ──

  test("5.1 Alice submits for approval", async ({ page }) => {
    require(collectionId, "collectionId");
    await loginAs(page, cfg.aliceToken);
    await page.goto(
      `/projects/${projectId}/collections/${collectionId}`
    );
    await expect(page.getByText("Draft").first()).toBeVisible({
      timeout: 15000,
    });

    await page
      .getByRole("button", { name: "Submit for approval" })
      .click();

    // Confirm dialog
    const confirmBtn = page.getByRole("button", { name: "Submit", exact: true });
    await expect(confirmBtn).toBeVisible({ timeout: 5000 });
    await confirmBtn.click();

    await expect(page.getByText("Pending approval")).toBeVisible({
      timeout: 15000,
    });
  });

  test("5.2 Bob approves (API)", async () => {
    require(collectionId, "collectionId");
    await apiAuth(cfg.bobToken, `/collections/${collectionId}/approve`, {
      method: "POST",
    });
  });

  test("5.3 Alice validates final approval", async ({ page }) => {
    require(projectId, "projectId");
    require(collectionId, "collectionId");
    await loginAs(page, cfg.aliceToken);
    await page.goto(
      `/projects/${projectId}/collections/${collectionId}`
    );

    // Wait for "Approved" status (might also show "final validation required")
    const validateBtn = page.getByRole("button", {
      name: "Validate final approval",
    });
    await expect(validateBtn).toBeVisible({ timeout: 15000 });
    await validateBtn.click();

    // Confirm
    await page
      .getByRole("button", { name: "Confirm", exact: true })
      .click();

    await expect(page.getByText("Ready to deploy")).toBeVisible({
      timeout: 15000,
    });
  });

  test("5.4 Alice deploys to blockchain", async ({ page }) => {
    require(collectionId, "collectionId");
    test.setTimeout(120_000);

    await loginAs(page, cfg.aliceToken);
    await page.goto(
      `/projects/${projectId}/collections/${collectionId}`
    );

    await test.step("Click deploy and confirm", async () => {
      const deployBtn = page.getByRole("button", {
        name: "Deploy to blockchain",
      });
      await expect(deployBtn).toBeVisible({ timeout: 15000 });
      await deployBtn.click();
      await page
        .getByRole("button", { name: "Deploy", exact: true })
        .click();
    });

    await test.step("Wait for on-chain deployment", async () => {
      await expect(page.getByText("Deployed").first()).toBeVisible({
        timeout: 90000,
      });
    });

    await test.step("Fetch contract addresses", async () => {
      const col = await apiAuth(
        cfg.aliceToken,
        `/collections/${collectionId}`
      );
      nftAddr = col.contract_nft_address;
      expect(nftAddr).toBeTruthy();
    });
  });

  // ── CHAPTER 6: Verify Minted NFTs (deploy auto-mints all drafts) ──

  test("6.1 NFTs tab shows 3 minted NFTs", async ({ page }) => {
    require(collectionId, "collectionId");
    await loginAs(page, cfg.aliceToken);
    await page.goto(
      `/projects/${projectId}/collections/${collectionId}/nfts`
    );

    await expect(page.getByText("Sunrise")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Moonlight")).toBeVisible();
    await expect(page.getByText("Ocean")).toBeVisible();

    // Token IDs assigned during mint
    await expect(page.getByText("#0")).toBeVisible();
    await expect(page.getByText("#1")).toBeVisible();
    await expect(page.getByText("#2")).toBeVisible();

    // At least one "For sale" badge visible
    await expect(page.getByText("For sale").first()).toBeVisible({
      timeout: 10000,
    });
  });

  test("6.2 On-chain: totalSupply = 3", async () => {
    require(nftAddr, "nftAddr");
    const supply = await publicClient.readContract({
      address: nftAddr as `0x${string}`,
      abi: NFT_ABI,
      functionName: "totalSupply",
    });
    expect(supply).toBe(3n);
  });

  // ── CHAPTER 7: Publish ──

  test("7.1 Alice publishes the collection", async ({ page }) => {
    require(collectionId, "collectionId");
    await loginAs(page, cfg.aliceToken);
    await page.goto(
      `/projects/${projectId}/collections/${collectionId}`
    );
    await expect(page.getByText("Deployed").first()).toBeVisible({
      timeout: 15000,
    });

    await page
      .getByRole("button", { name: "Create a public sale page" })
      .click();

    await expect(page.getByText("Sale page active")).toBeVisible({
      timeout: 15000,
    });

    const col = await apiAuth(
      cfg.aliceToken,
      `/collections/${collectionId}`
    );
    publicSlug = col.public_slug;
    expect(publicSlug).toBeTruthy();
  });

  test("7.2 Public sale page shows NFTs with Buy buttons", async ({
    page,
  }) => {
    require(publicSlug, "publicSlug");
    await page.goto(`/sale/${publicSlug}`);

    await expect(page.locator("body")).toContainText("Duo Collection", {
      timeout: 20000,
    });
    await expect(page.locator("body")).toContainText("AVAX");

    const buyBtn = page.locator('button:has-text("Buy")');
    await expect(buyBtn.first()).toBeVisible({ timeout: 10000 });
  });

  // ── CHAPTER 8: Direct Purchase & Payment Verification ──

  test("8.1 Snapshot balances before direct purchase", async () => {
    aliceBalBeforeDirect = await publicClient.getBalance({
      address: ALICE_ACCOUNT.address,
    });
    bobBalBeforeDirect = await publicClient.getBalance({
      address: BOB_ACCOUNT.address,
    });
  });

  test("8.2 Charlie buys NFT #0 from the market", async () => {
    require(nftAddr, "nftAddr");
    const marketAddr = cfg.marketAddr as `0x${string}`;

    let targetListingId: bigint | null = null;
    let price: bigint = 0n;

    await test.step("Find listing for tokenId 0", async () => {
      const total = await publicClient.readContract({
        address: marketAddr,
        abi: MARKET_ABI,
        functionName: "listingCount",
      }) as bigint;

      for (let i = 0n; i < total; i++) {
        const [, tokenId, listingPrice, , active] = await publicClient.readContract({
          address: marketAddr,
          abi: MARKET_ABI,
          functionName: "listings",
          args: [i],
        }) as [string, bigint, bigint, string, boolean];
        if (tokenId === 0n && active) {
          targetListingId = i;
          price = listingPrice;
          break;
        }
      }
      expect(targetListingId).not.toBeNull();
    });

    await test.step("Purchase on-chain", async () => {
      const walletClient = createWalletClient({
        account: CHARLIE_ACCOUNT,
        chain: foundry,
        transport: http(cfg.anvilRpc),
      });

      const hash = await walletClient.writeContract({
        address: marketAddr,
        abi: MARKET_ABI,
        functionName: "purchase",
        args: [targetListingId!],
        value: price,
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      expect(receipt.status).toBe("success");
    });
  });

  test("8.3 On-chain: Charlie owns NFT #0", async () => {
    require(nftAddr, "nftAddr");
    const owner = await publicClient.readContract({
      address: nftAddr as `0x${string}`,
      abi: NFT_ABI,
      functionName: "ownerOf",
      args: [0n],
    });
    expect((owner as string).toLowerCase()).toBe(
      CHARLIE_ACCOUNT.address.toLowerCase()
    );
  });

  test("8.4 Artists received correct shares (70/30 of 0.1 AVAX)", async () => {
    require(nftAddr, "nftAddr");
    // Direct purchase of Sunrise (0.1 AVAX) → ArtistsSplitter → Alice 70%, Bob 30%
    const aliceBalAfter = await publicClient.getBalance({
      address: ALICE_ACCOUNT.address,
    });
    const bobBalAfter = await publicClient.getBalance({
      address: BOB_ACCOUNT.address,
    });

    const aliceDelta = aliceBalAfter - aliceBalBeforeDirect;
    const bobDelta = bobBalAfter - bobBalBeforeDirect;

    // Alice: 70% of 0.1 = 0.07 AVAX
    expect(aliceDelta).toBe(parseEther("0.07"));
    // Bob: 30% of 0.1 = 0.03 AVAX
    expect(bobDelta).toBe(parseEther("0.03"));
  });

  test("8.5 NFT tab shows Sold badge", async ({ page }) => {
    require(projectId, "projectId");
    require(collectionId, "collectionId");
    await loginAs(page, cfg.aliceToken);
    await page.goto(
      `/projects/${projectId}/collections/${collectionId}/nfts`
    );
    await expect(page.getByText("Sunrise")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Sold").first()).toBeVisible({
      timeout: 10000,
    });
  });

  // ── CHAPTER 9: Showroom ──

  test("9.1 Dave creates a showroom", async ({ page }) => {
    await loginAs(page, cfg.daveToken);
    await page.goto("/showroom/new");

    await page.locator('input[placeholder="My Showroom"]').fill("Dave's Gallery");
    await page
      .locator('textarea[placeholder="Curated selection of artworks..."]')
      .fill("A curated gallery");

    await page.getByRole("button", { name: "Create Showroom" }).click();

    await expect(page).toHaveURL(/\/showroom\/[a-f0-9-]+/, {
      timeout: 15000,
    });
    showroomId = page.url().match(/\/showroom\/([a-f0-9-]+)/)?.[1] || "";
    expect(showroomId).toBeTruthy();

    await expect(page.locator("h1")).toContainText("Dave's Gallery", {
      timeout: 10000,
    });
  });

  test("9.2 Dave invites Alice", async ({ page }) => {
    require(showroomId, "showroomId");
    await loginAs(page, cfg.daveToken);
    await page.goto(`/showroom/${showroomId}`);
    await expect(page.locator("h1")).toContainText("Dave's Gallery", {
      timeout: 15000,
    });

    const searchInput = page.locator(
      'input[placeholder="Search artists by name..."]'
    );
    await searchInput.fill("Ali");

    // Click on Alice in the dropdown
    const aliceOption = page
      .locator("button")
      .filter({ hasText: "Alice" })
      .first();
    await expect(aliceOption).toBeVisible({ timeout: 10000 });
    await aliceOption.click();

    await page
      .getByRole("button", { name: "Invite", exact: true })
      .click();

    // Alice should appear in participants
    await expect(page.getByText("Alice")).toBeVisible({ timeout: 10000 });
  });

  test("9.3 Alice proposes her collection", async ({ page }) => {
    require(showroomId, "showroomId");
    await loginAs(page, cfg.aliceToken);
    await page.goto(`/showroom/${showroomId}`);
    await expect(page.locator("h1")).toContainText("Dave's Gallery", {
      timeout: 15000,
    });

    // As artist member, Alice sees "My Collections"
    await expect(page.getByText("My Collections")).toBeVisible({
      timeout: 10000,
    });

    // Click "Share" on the Duo Collection
    const shareBtn = page.getByRole("button", { name: "Share", exact: true });
    await expect(shareBtn).toBeVisible({ timeout: 10000 });
    await shareBtn.click();

    // Wait for "shared" badge
    await expect(page.getByText("shared").first()).toBeVisible({
      timeout: 15000,
    });
  });

  test("9.4 Dave sets margins on listings", async ({ page }) => {
    require(showroomId, "showroomId");
    await loginAs(page, cfg.daveToken);
    await page.goto(`/showroom/${showroomId}/listings`);

    await expect(page.getByText("NFT Listings")).toBeVisible({
      timeout: 15000,
    });

    await test.step("Wait for listing rows", async () => {
      await expect(page.locator("thead")).toBeVisible({ timeout: 10000 });
    });

    await test.step("Expand and select all listings", async () => {
      const expandBtn = page.getByText("Expand all");
      if (await expandBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expandBtn.click();
      }
      const headerCheckbox = page.locator('thead input[type="checkbox"]').first();
      await headerCheckbox.check();
    });

    await test.step("Set batch margin to 0.2 AVAX", async () => {
      await page.locator('input[placeholder="Margin (AVAX)"]').fill("0.2");
      await page.getByRole("button", { name: "Apply margin" }).click();
      await expect(page.getByText("0.2", { exact: false }).first()).toBeVisible({
        timeout: 10000,
      });
    });
  });

  test("9.5 Dave deploys the showroom", async ({ page }) => {
    require(showroomId, "showroomId");
    test.setTimeout(120_000);

    await loginAs(page, cfg.daveToken);
    await page.goto(`/showroom/${showroomId}`);
    await expect(page.locator("h1")).toContainText("Dave's Gallery", {
      timeout: 15000,
    });

    await page
      .getByRole("button", { name: "Deploy Showroom" })
      .click();

    // Wait for "active" status badge
    await expect(page.getByText("active")).toBeVisible({ timeout: 90000 });
  });

  test("9.6 Dave publishes the showroom", async ({ page }) => {
    require(showroomId, "showroomId");
    await loginAs(page, cfg.daveToken);
    await page.goto(`/showroom/${showroomId}`);
    await expect(page.getByText("active")).toBeVisible({ timeout: 15000 });

    await page
      .getByRole("button", { name: "Create a public sale page" })
      .click();

    await expect(page.getByText("Sale page active")).toBeVisible({
      timeout: 15000,
    });

    const sr = await apiAuth(cfg.daveToken, `/showrooms/${showroomId}`);
    showroomSlug = sr.public_slug;
    expect(showroomSlug).toBeTruthy();
  });

  test("9.7 Public showroom page loads", async ({ page }) => {
    require(showroomSlug, "showroomSlug");
    await page.goto(`/showroom/sale/${showroomSlug}`);
    await expect(page.locator("body")).toContainText("Dave's Gallery", {
      timeout: 20000,
    });
    await expect(page.locator("body")).toContainText("AVAX", {
      timeout: 10000,
    });
  });

  // ── CHAPTER 10: Showroom Purchase & Payment Verification ──

  test("10.1 Snapshot balances before showroom purchase", async () => {
    aliceBalBeforeShowroom = await publicClient.getBalance({
      address: ALICE_ACCOUNT.address,
    });
    bobBalBeforeShowroom = await publicClient.getBalance({
      address: BOB_ACCOUNT.address,
    });
    daveBalBeforeShowroom = await publicClient.getBalance({
      address: DAVE_ACCOUNT.address,
    });
  });

  test("10.2 Charlie buys NFT #1 via showroom", async () => {
    require(showroomId, "showroomId");
    require(nftAddr, "nftAddr");

    let showroomAddr: string;
    let buyIdx: number;
    let totalPrice: bigint;
    let basePrice: bigint;
    let nftContracts: `0x${string}`[];
    let tokenIds: bigint[];

    await test.step("Fetch showroom contract and available items", async () => {
      const sr = await apiAuth(cfg.daveToken, `/showrooms/${showroomId}`);
      showroomAddr = sr.contract_address;
      expect(showroomAddr).toBeTruthy();

      const available = (await publicClient.readContract({
        address: showroomAddr as `0x${string}`,
        abi: SHOWROOM_ABI,
        functionName: "listAvailable",
      })) as any;

      nftContracts = available[0] as `0x${string}`[];
      tokenIds = available[1] as bigint[];
      const margins = available[4] as bigint[];
      const basePrices = available[5] as bigint[];
      expect(nftContracts.length).toBeGreaterThanOrEqual(1);

      const idx = tokenIds.findIndex((id) => id === 1n);
      buyIdx = idx >= 0 ? idx : 0;
      basePrice = basePrices[buyIdx];
      totalPrice = basePrice + margins[buyIdx];
    });

    await test.step("Purchase on-chain via showroom", async () => {
      const walletClient = createWalletClient({
        account: CHARLIE_ACCOUNT,
        chain: foundry,
        transport: http(cfg.anvilRpc),
      });

      const hash = await walletClient.writeContract({
        address: showroomAddr! as `0x${string}`,
        abi: SHOWROOM_ABI,
        functionName: "purchase",
        args: [nftContracts![buyIdx!], tokenIds![buyIdx!]],
        value: totalPrice!,
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      expect(receipt.status).toBe("success");
    });
  });

  test("10.3 On-chain: Charlie owns NFT #1", async () => {
    require(nftAddr, "nftAddr");
    const owner = await publicClient.readContract({
      address: nftAddr as `0x${string}`,
      abi: NFT_ABI,
      functionName: "ownerOf",
      args: [1n],
    });
    expect((owner as string).toLowerCase()).toBe(
      CHARLIE_ACCOUNT.address.toLowerCase()
    );
  });

  test("10.4 Artists + producer received correct shares (0.2 base + 0.2 margin)", async () => {
    require(nftAddr, "nftAddr");
    // Showroom purchase: Moonlight (0.2 AVAX base + 0.2 AVAX margin = 0.4 total)
    // Base → ArtistsSplitter → Alice 70%, Bob 30%
    // Margin → PaymentRegistry → Dave
    const aliceBalAfter = await publicClient.getBalance({
      address: ALICE_ACCOUNT.address,
    });
    const bobBalAfter = await publicClient.getBalance({
      address: BOB_ACCOUNT.address,
    });
    const daveBalAfter = await publicClient.getBalance({
      address: DAVE_ACCOUNT.address,
    });

    const aliceDelta = aliceBalAfter - aliceBalBeforeShowroom;
    const bobDelta = bobBalAfter - bobBalBeforeShowroom;
    const daveDelta = daveBalAfter - daveBalBeforeShowroom;

    // Dave's margin may be direct transfer or deferred in PaymentRegistry
    const pending = (await publicClient.readContract({
      address: cfg.registryAddr as `0x${string}`,
      abi: PAYMENT_REGISTRY_ABI,
      functionName: "pendingWithdrawals",
      args: [DAVE_ACCOUNT.address],
    })) as bigint;

    // Alice: 70% of 0.2 = 0.14 AVAX
    expect(aliceDelta).toBe(parseEther("0.14"));
    // Bob: 30% of 0.2 = 0.06 AVAX
    expect(bobDelta).toBe(parseEther("0.06"));
    // Dave: full margin = 0.2 AVAX (may be direct or deferred in PaymentRegistry)
    const daveExpected = parseEther("0.2");
    expect(daveDelta + pending).toBe(daveExpected);
  });

  // ── CHAPTER 11: Final State ──

  test("11.1 On-chain: Charlie has 2 NFTs, market has 1 left", async () => {
    require(nftAddr, "nftAddr");
    const balance = await publicClient.readContract({
      address: nftAddr as `0x${string}`,
      abi: NFT_ABI,
      functionName: "balanceOf",
      args: [CHARLIE_ACCOUNT.address],
    });
    expect(balance).toBe(2n);

    const available = await publicClient.readContract({
      address: cfg.marketAddr as `0x${string}`,
      abi: MARKET_ABI,
      functionName: "availableCount",
    });
    expect(available).toBe(1n);
  });

  test("11.2 Integration tab shows contract addresses", async ({ page }) => {
    require(projectId, "projectId");
    require(collectionId, "collectionId");
    require(nftAddr, "nftAddr");
    await loginAs(page, cfg.aliceToken);
    await page.goto(
      `/projects/${projectId}/collections/${collectionId}/integration`
    );

    await expect(page.locator("body")).toContainText(
      nftAddr.slice(0, 10),
      { timeout: 15000 }
    );
    await expect(page.locator("body")).toContainText(
      cfg.marketAddr.slice(0, 10)
    );
  });

  test("11.3 Alice unpublishes from the browser", async ({ page }) => {
    require(projectId, "projectId");
    require(collectionId, "collectionId");
    await loginAs(page, cfg.aliceToken);
    await page.goto(
      `/projects/${projectId}/collections/${collectionId}`
    );

    await expect(page.getByText("Sale page active")).toBeVisible({
      timeout: 15000,
    });

    await test.step("Click remove and confirm", async () => {
      await page
        .getByRole("button", { name: "Remove public link" })
        .click();
      await page
        .getByRole("button", { name: "Remove", exact: true })
        .click();
    });

    await expect(
      page.getByRole("button", { name: "Create a public sale page" })
    ).toBeVisible({ timeout: 15000 });
  });

  test("11.4 Public sale page shows not found", async ({ page }) => {
    require(publicSlug, "publicSlug");
    await page.goto(`/sale/${publicSlug}`);
    await expect(page.locator("body")).toContainText("not found", {
      timeout: 10000,
      ignoreCase: true,
    });
  });
});
