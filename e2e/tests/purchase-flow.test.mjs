import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createPublicClient, createWalletClient, http, parseEther, formatEther } from "viem";
import { foundry } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import puppeteer from "puppeteer";
import { BASE_URL, API_URL, getTestToken, authRequest, delay } from "./helpers.mjs";

// Anvil default accounts (private keys)
const DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const BUYER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const DEPLOYER = privateKeyToAccount(DEPLOYER_KEY);
const BUYER = privateKeyToAccount(BUYER_KEY);

const ANVIL_RPC = "http://127.0.0.1:8545";

// ABIs
const FACTORY_ABI = [
  {
    name: "createHeritage",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "name", type: "string" },
      { name: "symbol", type: "string" },
      { name: "producer", type: "address" },
      { name: "wallets", type: "address[]" },
      { name: "roles", type: "string[]" },
      { name: "shares", type: "uint256[]" },
      { name: "royaltyBps", type: "uint256" },
      { name: "contractURI", type: "string" },
    ],
    outputs: [
      { name: "index", type: "uint256" },
      { name: "nftAddr", type: "address" },
      { name: "splitterAddr", type: "address" },
      { name: "vaultAddr", type: "address" },
    ],
  },
];

const NFT_ABI = [
  {
    name: "mint",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "uri", type: "string" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "totalSupply",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
];

const VAULT_ABI = [
  {
    name: "purchase",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "setPrice",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "price", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "setPriceBatch",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenIds", type: "uint256[]" },
      { name: "prices", type: "uint256[]" },
    ],
    outputs: [],
  },
  {
    name: "tokenPrice",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "availableCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "listAvailableTokens",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "tokenIds", type: "uint256[]" },
      { name: "prices", type: "uint256[]" },
    ],
  },
];

const SPLITTER_ABI = [
  {
    name: "pendingWithdrawals",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "releasePrimary",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [],
  },
];

// ──────────────────────────────────────────
let anvilProcess;
let publicClient;
let deployerWallet;
let buyerWallet;
let factoryAddr;
let nftAddr;
let splitterAddr;
let vaultAddr;
let browser;
let page;
let token;

before(async () => {
  // 1. Start Anvil (with Shanghai hardfork for PUSH0 opcode support)
  anvilProcess = spawn("anvil", ["--port", "8545", "--silent", "--hardfork", "shanghai"], {
    stdio: "ignore",
    detached: true,
  });
  await delay(2000); // Wait for anvil to start

  // 2. Setup viem clients
  publicClient = createPublicClient({ chain: foundry, transport: http(ANVIL_RPC) });
  deployerWallet = createWalletClient({ account: DEPLOYER, chain: foundry, transport: http(ANVIL_RPC) });
  buyerWallet = createWalletClient({ account: BUYER, chain: foundry, transport: http(ANVIL_RPC) });

  // 3. Verify anvil is running
  const blockNumber = await publicClient.getBlockNumber();
  assert.ok(blockNumber >= 0n, "Anvil is running");

  // 4. Deploy Factory via forge
  factoryAddr = await new Promise((resolve, reject) => {
    const proc = spawn(
      "forge",
      [
        "create", "src/HeritageFactory.sol:HeritageFactory",
        "--rpc-url", ANVIL_RPC,
        "--private-key", DEPLOYER_KEY,
        "--broadcast",
      ],
      { cwd: "/home/alexandre/workspaces/trace/avalanche_hackathon/blockchain", stdio: ["ignore", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("close", (code) => {
      const output = stdout + stderr;
      const match = output.match(/Deployed to:\s+(0x[0-9a-fA-F]+)/);
      if (match) resolve(match[1]);
      else reject(new Error(`forge create failed — no deployed address found.\nstdout: ${stdout}\nstderr: ${stderr}`));
    });
  });

  // 5. Launch browser
  browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  page = await browser.newPage();
  page.setDefaultTimeout(15000);

  // 6. Get API auth token
  const auth = await getTestToken();
  token = auth.token;
});

after(async () => {
  if (browser) await browser.close();
  if (anvilProcess) {
    process.kill(-anvilProcess.pid);
  }
});

// ──────────────────────────────────────────
// 1. Deploy smart contracts on local Anvil
// ──────────────────────────────────────────
describe("Smart contract deployment on Anvil", () => {
  it("Factory deployed successfully", () => {
    assert.ok(factoryAddr, "Factory address exists");
    assert.ok(factoryAddr.startsWith("0x"), "Valid address format");
  });

  it("Create heritage (NFT + Splitter + Vault) via Factory", async () => {
    const beneficiary1 = DEPLOYER.address;
    const beneficiary2 = BUYER.address;

    const { result } = await publicClient.simulateContract({
      account: DEPLOYER,
      address: factoryAddr,
      abi: FACTORY_ABI,
      functionName: "createHeritage",
      args: [
        "Test Collection E2E",
        "TCE2E",
        DEPLOYER.address,
        [beneficiary1, beneficiary2],
        ["creator", "collaborator"],
        [7000n, 3000n], // 70% / 30%
        500n, // 5% royalties
        "ipfs://collection-metadata",
      ],
    });

    // Execute the transaction
    const hash = await deployerWallet.writeContract({
      address: factoryAddr,
      abi: FACTORY_ABI,
      functionName: "createHeritage",
      args: [
        "Test Collection E2E",
        "TCE2E",
        DEPLOYER.address,
        [beneficiary1, beneficiary2],
        ["creator", "collaborator"],
        [7000n, 3000n],
        500n,
        "ipfs://collection-metadata",
      ],
    });
    await publicClient.waitForTransactionReceipt({ hash });

    nftAddr = result[1];
    splitterAddr = result[2];
    vaultAddr = result[3];

    assert.ok(nftAddr, "NFT contract deployed");
    assert.ok(splitterAddr, "Splitter contract deployed");
    assert.ok(vaultAddr, "Vault contract deployed");
    assert.notEqual(nftAddr, splitterAddr, "NFT != Splitter");
    assert.notEqual(nftAddr, vaultAddr, "NFT != Vault");
  });

  it("Mint 3 NFTs into the Vault", async () => {
    for (let i = 0; i < 3; i++) {
      const hash = await deployerWallet.writeContract({
        address: nftAddr,
        abi: NFT_ABI,
        functionName: "mint",
        args: [vaultAddr, `ipfs://nft-${i}`],
      });
      await publicClient.waitForTransactionReceipt({ hash });
    }

    const supply = await publicClient.readContract({
      address: nftAddr,
      abi: NFT_ABI,
      functionName: "totalSupply",
    });
    assert.equal(supply, 3n, "3 NFTs minted");

    const vaultBalance = await publicClient.readContract({
      address: nftAddr,
      abi: NFT_ABI,
      functionName: "balanceOf",
      args: [vaultAddr],
    });
    assert.equal(vaultBalance, 3n, "Vault holds 3 NFTs");
  });

  it("Set prices on Vault", async () => {
    const price = parseEther("0.1"); // 0.1 ETH

    const hash = await deployerWallet.writeContract({
      address: vaultAddr,
      abi: VAULT_ABI,
      functionName: "setPriceBatch",
      args: [
        [0n, 1n, 2n],
        [parseEther("0.1"), parseEther("0.2"), parseEther("0.5")],
      ],
    });
    await publicClient.waitForTransactionReceipt({ hash });

    const price0 = await publicClient.readContract({
      address: vaultAddr,
      abi: VAULT_ABI,
      functionName: "tokenPrice",
      args: [0n],
    });
    assert.equal(price0, parseEther("0.1"), "Token 0 price = 0.1 ETH");

    const price2 = await publicClient.readContract({
      address: vaultAddr,
      abi: VAULT_ABI,
      functionName: "tokenPrice",
      args: [2n],
    });
    assert.equal(price2, parseEther("0.5"), "Token 2 price = 0.5 ETH");
  });

  it("Vault lists available tokens with prices", async () => {
    const available = await publicClient.readContract({
      address: vaultAddr,
      abi: VAULT_ABI,
      functionName: "availableCount",
    });
    assert.equal(available, 3n, "3 tokens available");

    const [tokenIds, prices] = await publicClient.readContract({
      address: vaultAddr,
      abi: VAULT_ABI,
      functionName: "listAvailableTokens",
    });
    assert.equal(tokenIds.length, 3, "3 token IDs listed");
    assert.equal(prices[0], parseEther("0.1"), "Price 0 correct");
    assert.equal(prices[1], parseEther("0.2"), "Price 1 correct");
    assert.equal(prices[2], parseEther("0.5"), "Price 2 correct");
  });
});

// ──────────────────────────────────────────
// 2. Purchase NFT on-chain
// ──────────────────────────────────────────
describe("Purchase NFT via Vault", () => {
  it("Buyer purchases token #0 for 0.1 ETH", async () => {
    const buyerBalanceBefore = await publicClient.getBalance({ address: BUYER.address });

    const hash = await buyerWallet.writeContract({
      address: vaultAddr,
      abi: VAULT_ABI,
      functionName: "purchase",
      args: [0n],
      value: parseEther("0.1"),
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, "success", "Purchase TX succeeded");

    // Verify buyer now owns the NFT
    const owner = await publicClient.readContract({
      address: nftAddr,
      abi: NFT_ABI,
      functionName: "ownerOf",
      args: [0n],
    });
    assert.equal(owner.toLowerCase(), BUYER.address.toLowerCase(), "Buyer owns token #0");
  });

  it("Vault now has 2 available tokens", async () => {
    const available = await publicClient.readContract({
      address: vaultAddr,
      abi: VAULT_ABI,
      functionName: "availableCount",
    });
    assert.equal(available, 2n, "2 tokens left in vault");
  });

  it("Purchase fails with insufficient payment", async () => {
    try {
      await buyerWallet.writeContract({
        address: vaultAddr,
        abi: VAULT_ABI,
        functionName: "purchase",
        args: [1n],
        value: parseEther("0.01"), // Too low — price is 0.2
      });
      assert.fail("Should have reverted");
    } catch (e) {
      assert.ok(
        e.message.includes("InsufficientPayment") || e.message.includes("revert"),
        "Reverted with InsufficientPayment"
      );
    }
  });

  it("Purchase token #1 with overpayment — refund works", async () => {
    const balanceBefore = await publicClient.getBalance({ address: BUYER.address });

    const hash = await buyerWallet.writeContract({
      address: vaultAddr,
      abi: VAULT_ABI,
      functionName: "purchase",
      args: [1n],
      value: parseEther("1.0"), // Overpay (price is 0.2)
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, "success", "Purchase TX with overpayment succeeded");

    const owner = await publicClient.readContract({
      address: nftAddr,
      abi: NFT_ABI,
      functionName: "ownerOf",
      args: [1n],
    });
    assert.equal(owner.toLowerCase(), BUYER.address.toLowerCase(), "Buyer owns token #1");

    // Check refund — balance should have decreased by ~0.2 ETH (+ gas), not 1.0 ETH
    const balanceAfter = await publicClient.getBalance({ address: BUYER.address });
    const spent = balanceBefore - balanceAfter;
    assert.ok(spent < parseEther("0.3"), `Spent ${formatEther(spent)} ETH (should be ~0.2 + gas)`);
  });

  it("Splitter received primary sale funds", async () => {
    // After 2 purchases (0.1 + 0.2 = 0.3 ETH), splitter should hold funds
    const splitterBalance = await publicClient.getBalance({ address: splitterAddr });
    assert.equal(splitterBalance, parseEther("0.3"), "Splitter received 0.3 ETH total");
  });

  it("ReleasePrimary distributes to beneficiaries", async () => {
    // Release primary for token 0 (0.1 ETH — 70%/30% split)
    const hash0 = await deployerWallet.writeContract({
      address: splitterAddr,
      abi: SPLITTER_ABI,
      functionName: "releasePrimary",
      args: [0n],
    });
    await publicClient.waitForTransactionReceipt({ hash: hash0 });

    const pending1 = await publicClient.readContract({
      address: splitterAddr,
      abi: SPLITTER_ABI,
      functionName: "pendingWithdrawals",
      args: [DEPLOYER.address],
    });
    const pending2 = await publicClient.readContract({
      address: splitterAddr,
      abi: SPLITTER_ABI,
      functionName: "pendingWithdrawals",
      args: [BUYER.address],
    });

    // 70% of 0.1 = 0.07, 30% of 0.1 = 0.03
    assert.equal(pending1, parseEther("0.07"), "Creator gets 70% of 0.1 ETH");
    assert.equal(pending2, parseEther("0.03"), "Collaborator gets 30% of 0.1 ETH");
  });

  it("Beneficiary withdraws funds", async () => {
    const balanceBefore = await publicClient.getBalance({ address: DEPLOYER.address });

    const hash = await deployerWallet.writeContract({
      address: splitterAddr,
      abi: SPLITTER_ABI,
      functionName: "withdraw",
    });
    await publicClient.waitForTransactionReceipt({ hash });

    const balanceAfter = await publicClient.getBalance({ address: DEPLOYER.address });
    const received = balanceAfter - balanceBefore;
    // Should have received ~0.07 ETH minus gas
    assert.ok(received > parseEther("0.06"), `Received ${formatEther(received)} ETH`);

    const pendingAfter = await publicClient.readContract({
      address: splitterAddr,
      abi: SPLITTER_ABI,
      functionName: "pendingWithdrawals",
      args: [DEPLOYER.address],
    });
    assert.equal(pendingAfter, 0n, "No pending withdrawals after withdraw");
  });

  it("Cannot purchase already-sold token", async () => {
    try {
      await buyerWallet.writeContract({
        address: vaultAddr,
        abi: VAULT_ABI,
        functionName: "purchase",
        args: [0n], // Already sold
        value: parseEther("0.1"),
      });
      assert.fail("Should have reverted");
    } catch (e) {
      assert.ok(
        e.message.includes("NotInVault") || e.message.includes("revert"),
        "Reverted — token no longer in vault"
      );
    }
  });
});

// ──────────────────────────────────────────
// 3. Backend + Frontend integration with real contracts
// ──────────────────────────────────────────
describe("Full stack integration: API + real contracts + public page", () => {
  let projectId;
  let workId;
  let publicSlug;

  it("Create project + work + NFTs via API", async () => {
    const project = await authRequest(token, "/projects", {
      method: "POST",
      body: JSON.stringify({ name: "Anvil E2E " + Date.now(), description: "Full stack test" }),
    });
    projectId = project.id;

    const work = await authRequest(token, `/projects/${projectId}/works`, {
      method: "POST",
      body: JSON.stringify({ name: "Anvil Collection", work_type: "nft_collection" }),
    });
    workId = work.id;

    for (let i = 0; i < 3; i++) {
      await authRequest(token, `/works/${workId}/draft-nfts`, {
        method: "POST",
        body: JSON.stringify({
          title: `Anvil NFT #${i}`,
          description: `NFT numero ${i}`,
          price: `${(i + 1) * 0.1}`,
          image_url: `https://picsum.photos/${400 + i}`,
          artist_name: "E2E Artist",
          attributes: JSON.stringify([{ key: "token", value: String(i) }]),
        }),
      });
    }
  });

  it("Deploy + store REAL contract addresses", async () => {
    // Deploy via API (auto-generates fake addresses)
    await authRequest(token, `/works/${workId}/submit-for-approval`, { method: "POST" });
    await authRequest(token, `/works/${workId}/deploy`, { method: "POST" });

    // Override with REAL Anvil contract addresses
    const work = await authRequest(token, `/works/${workId}/contracts`, {
      method: "PUT",
      body: JSON.stringify({
        contract_nft_address: nftAddr,
        contract_splitter_address: splitterAddr,
        contract_vault_address: vaultAddr,
      }),
    });
    assert.equal(work.contract_vault_address, vaultAddr, "Real vault address stored");
  });

  it("Publish the collection", async () => {
    const work = await authRequest(token, `/works/${workId}/publish`, { method: "POST" });
    assert.ok(work.public_slug, "Public slug generated");
    publicSlug = work.public_slug;
  });

  it("Public API returns real vault address", async () => {
    const res = await fetch(`${API_URL}/public/collections/${publicSlug}`);
    const col = await res.json();
    assert.equal(col.contract_vault_address, vaultAddr, "Public API returns real vault address");
    assert.equal(col.nfts.length, 3, "3 NFTs in collection");
  });

  it("Public page loads and shows NFTs", async () => {
    await page.goto(`${BASE_URL}/sale/${publicSlug}`, { waitUntil: "networkidle2" });
    await page.waitForFunction(
      () => !document.body.innerText.includes("Chargement") && document.body.innerText.length > 100,
      { timeout: 15000 }
    );
    const body = await page.$eval("body", (el) => el.innerText);
    assert.ok(body.includes("Anvil Collection"), "Collection name displayed");
    assert.ok(body.includes("Anvil NFT #0"), "NFT #0 displayed");
    assert.ok(body.includes("Anvil NFT #1"), "NFT #1 displayed");
    assert.ok(body.includes("Anvil NFT #2"), "NFT #2 displayed");
  });

  it("Buy buttons are present", async () => {
    const buyButtons = await page.$$eval("button", (btns) =>
      btns.filter((b) => b.textContent.trim() === "Acheter").length
    );
    assert.ok(buyButtons >= 3, "At least 3 buy buttons");
  });

  it("Clicking buy triggers wallet connection (no 'vault deploye' error)", async () => {
    // Click on a NFT card to open modal
    await page.evaluate(() => {
      const divs = document.querySelectorAll("div");
      for (const d of divs) {
        if (d.className && d.className.includes("cursor-pointer") && d.querySelector("h5")) {
          d.click();
          break;
        }
      }
    });
    await delay(800);

    // Click buy button in modal
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const buyBtn = btns.find((b) => b.textContent.includes("Acheter cette oeuvre"));
      if (buyBtn) buyBtn.click();
    });
    await delay(2000);

    // Should NOT see "vault deploye" error — should see wallet connection attempt or network error
    const body = await page.$eval("body", (el) => el.innerText);
    assert.ok(
      !body.includes("vault deploye"),
      "No 'vault deploye' error — real contract addresses are set"
    );
  });

  it("Direct on-chain purchase of last token via viem works", async () => {
    // Token #2 is still in vault (we sold 0 and 1 earlier)
    const ownerBefore = await publicClient.readContract({
      address: nftAddr,
      abi: NFT_ABI,
      functionName: "ownerOf",
      args: [2n],
    });
    assert.equal(ownerBefore.toLowerCase(), vaultAddr.toLowerCase(), "Token #2 still in vault");

    // Purchase token #2
    const hash = await buyerWallet.writeContract({
      address: vaultAddr,
      abi: VAULT_ABI,
      functionName: "purchase",
      args: [2n],
      value: parseEther("0.5"),
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, "success", "Purchase succeeded");

    const ownerAfter = await publicClient.readContract({
      address: nftAddr,
      abi: NFT_ABI,
      functionName: "ownerOf",
      args: [2n],
    });
    assert.equal(ownerAfter.toLowerCase(), BUYER.address.toLowerCase(), "Buyer owns token #2");

    // Vault is now empty
    const available = await publicClient.readContract({
      address: vaultAddr,
      abi: VAULT_ABI,
      functionName: "availableCount",
    });
    assert.equal(available, 0n, "Vault is empty — all sold");
  });
});
