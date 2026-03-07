/**
 * Comprehensive Browser E2E Tests
 *
 * Uses API calls for data setup, Puppeteer browsers for UI verification.
 * Uses TWO browsers for multi-user flows (creator + participant).
 *
 * Covers:
 * - Landing, dashboard, project creation
 * - Work/collection lifecycle, NFT management
 * - Multi-user approval flow (2 browsers)
 * - Deployment, publishing, public sale page
 * - Post-deploy mint approval cycle
 * - Allocations, discussion, notifications
 * - Navigation, error pages, profile
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import puppeteer from "puppeteer";
import { spawn } from "node:child_process";
import { createPublicClient, createWalletClient, http, parseEther, formatEther } from "viem";
import { foundry } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { BASE_URL, API_URL, apiRequest, authRequest, delay } from "./helpers.mjs";

// ──────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────
function randomWallet() {
  const hex = "0123456789abcdef";
  let addr = "0x";
  for (let i = 0; i < 40; i++) addr += hex[Math.floor(Math.random() * 16)];
  return addr;
}

async function createUser(name) {
  const wallet = randomWallet();
  const { nonce } = await apiRequest("/auth/nonce", {
    method: "POST",
    body: JSON.stringify({ wallet_address: wallet }),
  });
  const message = `Heritage Splitter Authentication\n\nWallet: ${wallet}\nNonce: ${nonce}`;
  const { token } = await apiRequest("/auth/verify", {
    method: "POST",
    body: JSON.stringify({ wallet_address: wallet, signature: "0xfake", message }),
  });
  // Complete profile
  await authRequest(token, "/me", {
    method: "PUT",
    body: JSON.stringify({
      display_name: name,
      bio: `Bio de ${name}`,
      avatar_url: "https://picsum.photos/100",
    }),
  });
  const user = await authRequest(token, "/me");
  return { wallet, token, name, userId: user.id };
}

async function newBrowser(token) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  if (token) {
    await page.evaluateOnNewDocument((t) => {
      localStorage.setItem("heritage_token", t);
    }, token);
  }
  return { browser, page };
}

async function gotoAndWait(page, url, timeout = 10000) {
  await page.goto(url, { waitUntil: "networkidle2" });
  await page.waitForFunction(
    () => {
      const t = document.body?.innerText || "";
      return !t.includes("Chargement") && t.length > 30;
    },
    { timeout }
  ).catch(() => {}); // soft fail — page might already be ready
  await delay(300);
}

async function text(page) {
  return page.$eval("body", (el) => el.innerText);
}

// ──────────────────────────────────────────
// Global state
// ──────────────────────────────────────────
let creator, participant;
let b1, b2; // { browser, page } — creator and participant browsers

before(async () => {
  creator = await createUser("Alice Creator");
  participant = await createUser("Bob Participant");
  b1 = await newBrowser(creator.token);
  b2 = await newBrowser(participant.token);
});

after(async () => {
  if (b1?.browser) await b1.browser.close();
  if (b2?.browser) await b2.browser.close();
});

// ════════════════════════════════════════════
// 1. Landing page (unauthenticated)
// ════════════════════════════════════════════
describe("1. Landing page", () => {
  it("Affiche Heritage et le CTA", async () => {
    const tmp = await newBrowser(null);
    await gotoAndWait(tmp.page, BASE_URL);
    const t = await text(tmp.page);
    assert.ok(t.toLowerCase().includes("heritage"), "Heritage visible");
    assert.ok(
      t.includes("Entrer") || t.includes("art") || t.includes("wallet"),
      "CTA or art content visible"
    );
    await tmp.browser.close();
  });

  it("Contient les piliers et etapes", async () => {
    const tmp = await newBrowser(null);
    await gotoAndWait(tmp.page, BASE_URL);
    const t = await text(tmp.page);
    assert.ok(
      t.includes("Avalanche") || t.includes("wallet") || t.includes("royalties"),
      "Landing page has feature content"
    );
    await tmp.browser.close();
  });
});

// ════════════════════════════════════════════
// 2. Auth redirect & dashboard
// ════════════════════════════════════════════
describe("2. Dashboard et authentification", () => {
  it("Utilisateur non-authentifie redirige vers landing", async () => {
    const tmp = await newBrowser(null);
    await gotoAndWait(tmp.page, `${BASE_URL}/dashboard`);
    assert.ok(
      tmp.page.url().endsWith("/") || tmp.page.url().includes("onboarding"),
      "Redirected away from dashboard"
    );
    await tmp.browser.close();
  });

  it("Utilisateur authentifie redirige vers dashboard depuis /", async () => {
    await gotoAndWait(b1.page, BASE_URL);
    await b1.page.waitForFunction(
      () => window.location.pathname === "/dashboard",
      { timeout: 10000 }
    ).catch(() => {});
    const url = b1.page.url();
    assert.ok(url.includes("/dashboard"), "Creator redirected to dashboard");
  });

  it("Dashboard affiche le nom du createur", async () => {
    await gotoAndWait(b1.page, `${BASE_URL}/dashboard`);
    const t = await text(b1.page);
    assert.ok(t.includes("Alice Creator"), "Creator name shown");
  });

  it("Dashboard du participant affiche son nom", async () => {
    await gotoAndWait(b2.page, `${BASE_URL}/dashboard`);
    const t = await text(b2.page);
    assert.ok(t.includes("Bob Participant"), "Participant name shown");
  });
});

// ════════════════════════════════════════════
// 3. Project CRUD
// ════════════════════════════════════════════
let projectId, projectName;

describe("3. Projet — creation et affichage", () => {
  it("Creer un projet via API", async () => {
    projectName = "Browser E2E Project " + Date.now();
    const project = await authRequest(creator.token, "/projects", {
      method: "POST",
      body: JSON.stringify({ name: projectName, description: "Test E2E" }),
    });
    projectId = project.id;
    assert.ok(projectId);
  });

  it("Le projet apparait sur le dashboard du createur", async () => {
    await gotoAndWait(b1.page, `${BASE_URL}/dashboard`);
    const t = await text(b1.page);
    assert.ok(t.includes(projectName), "Project on dashboard");
  });

  it("La page projet affiche le nom et la description", async () => {
    await gotoAndWait(b1.page, `${BASE_URL}/projects/${projectId}`);
    const t = await text(b1.page);
    assert.ok(t.includes(projectName), "Project name on page");
    assert.ok(t.includes("Test E2E"), "Project description on page");
  });

  it("La page projet affiche les onglets de navigation", async () => {
    const t = await text(b1.page);
    assert.ok(
      t.includes("Vue d'ensemble") || t.includes("Discussion") || t.includes("Activit"),
      "Navigation tabs visible"
    );
  });
});

// ════════════════════════════════════════════
// 4. Work creation + NFT management
// ════════════════════════════════════════════
let workId;

describe("4. Collection NFT — creation et NFTs", () => {
  it("Creer une collection NFT via API", async () => {
    const work = await authRequest(creator.token, `/projects/${projectId}/works`, {
      method: "POST",
      body: JSON.stringify({ name: "Collection Alpha", work_type: "nft_collection" }),
    });
    workId = work.id;
    assert.equal(work.status, "draft");
  });

  it("La page collection affiche 'Brouillon'", async () => {
    await gotoAndWait(b1.page, `${BASE_URL}/projects/${projectId}/works/${workId}`);
    const t = await text(b1.page);
    assert.ok(t.includes("Brouillon"), "Draft status banner");
  });

  it("La page affiche le bouton 'Soumettre pour approbation'", async () => {
    const hasBtn = await b1.page.evaluate(() =>
      Array.from(document.querySelectorAll("button"))
        .some((b) => b.textContent.includes("Soumettre") || b.textContent.includes("approbation"))
    );
    assert.ok(hasBtn, "Submit for approval button visible");
  });

  it("Ajouter 3 draft NFTs via API", async () => {
    const nfts = [
      { title: "NFT Alpha", description: "Premier", price: "0.1", artist_name: "Artiste A", image_url: "https://picsum.photos/400", attributes: JSON.stringify([{ key: "rarity", value: "common" }]) },
      { title: "NFT Beta", description: "Deuxieme", price: "0.5", artist_name: "Artiste B", image_url: "https://picsum.photos/401", attributes: JSON.stringify([{ key: "rarity", value: "rare" }]) },
      { title: "NFT Gamma", description: "Troisieme", price: "1.0", artist_name: "Artiste C", image_url: "", attributes: "[]" },
    ];
    for (const nft of nfts) {
      await authRequest(creator.token, `/works/${workId}/draft-nfts`, {
        method: "POST",
        body: JSON.stringify(nft),
      });
    }
  });

  it("L'onglet NFTs affiche les 3 brouillons", async () => {
    await gotoAndWait(b1.page, `${BASE_URL}/projects/${projectId}/works/${workId}/nfts`);
    const t = await text(b1.page);
    assert.ok(t.includes("NFT Alpha"), "NFT Alpha visible");
    assert.ok(t.includes("NFT Beta"), "NFT Beta visible");
    assert.ok(t.includes("NFT Gamma"), "NFT Gamma visible");
  });

  it("Les NFTs affichent le badge 'Non minte'", async () => {
    const badges = await b1.page.evaluate(() =>
      Array.from(document.querySelectorAll("span"))
        .filter((s) => s.textContent.includes("Non mint"))
        .length
    );
    assert.ok(badges >= 3, `3+ badges 'Non minte' (found: ${badges})`);
  });

  it("Les prix sont affiches", async () => {
    const t = await text(b1.page);
    assert.ok(t.includes("0.1") || t.includes("0,1"), "Price 0.1 shown");
    assert.ok(t.includes("0.5") || t.includes("0,5"), "Price 0.5 shown");
  });

  it("Modifier un NFT via API", async () => {
    const work = await authRequest(creator.token, `/works/${workId}`);
    const draft = work.draft_nfts.find((n) => n.title === "NFT Gamma");
    await authRequest(creator.token, `/draft-nfts/${draft.id}`, {
      method: "PUT",
      body: JSON.stringify({ title: "NFT Gamma Updated", price: "2.0" }),
    });
    const updated = await authRequest(creator.token, `/works/${workId}`);
    const g = updated.draft_nfts.find((n) => n.id === draft.id);
    assert.equal(g.title, "NFT Gamma Updated");
    assert.equal(g.price, "2.0");
  });

  it("La modification est visible dans le navigateur", async () => {
    await b1.page.reload({ waitUntil: "networkidle2" });
    await delay(500);
    const t = await text(b1.page);
    assert.ok(t.includes("NFT Gamma Updated"), "Updated title visible");
  });

  it("Supprimer un NFT via API", async () => {
    const work = await authRequest(creator.token, `/works/${workId}`);
    const draft = work.draft_nfts.find((n) => n.title === "NFT Gamma Updated");
    await authRequest(creator.token, `/draft-nfts/${draft.id}`, { method: "DELETE" });
    const updated = await authRequest(creator.token, `/works/${workId}`);
    assert.equal(updated.draft_nfts.length, 2, "Down to 2 drafts");
  });

  it("Re-ajouter un NFT pour avoir 3 au total", async () => {
    await authRequest(creator.token, `/works/${workId}/draft-nfts`, {
      method: "POST",
      body: JSON.stringify({ title: "NFT Delta", description: "Remplacant", price: "1.5", artist_name: "Artiste D", image_url: "", attributes: "[]" }),
    });
    const work = await authRequest(creator.token, `/works/${workId}`);
    assert.equal(work.draft_nfts.length, 3);
  });
});

// ════════════════════════════════════════════
// 5. Solo approval → deploy → publish
// ════════════════════════════════════════════
describe("5. Flux solo : approbation → deploiement → publication", () => {
  it("Soumettre → auto-approve → ready_to_deploy (solo)", async () => {
    const work = await authRequest(creator.token, `/works/${workId}/submit-for-approval`, { method: "POST" });
    assert.equal(work.status, "ready_to_deploy", "Solo auto-approves to ready_to_deploy");
  });

  it("Le navigateur affiche 'Pret a deployer'", async () => {
    await gotoAndWait(b1.page, `${BASE_URL}/projects/${projectId}/works/${workId}`);
    const t = await text(b1.page);
    assert.ok(
      t.includes("deployer") || t.includes("Deployer") || t.includes("Pret"),
      "Ready to deploy status shown"
    );
  });

  it("Le bouton 'Deployer sur la blockchain' est visible", async () => {
    const hasBtn = await b1.page.evaluate(() =>
      Array.from(document.querySelectorAll("button"))
        .some((b) => b.textContent.includes("Deployer") || b.textContent.includes("deployer"))
    );
    assert.ok(hasBtn, "Deploy button visible");
  });

  it("Deployer la collection", async () => {
    const work = await authRequest(creator.token, `/works/${workId}/deploy`, { method: "POST" });
    assert.equal(work.status, "deployed");
    assert.ok(work.contract_nft_address, "NFT address auto-generated");
    assert.ok(work.contract_vault_address, "Vault address auto-generated");
    assert.ok(work.contract_splitter_address, "Splitter address auto-generated");
  });

  it("Le navigateur affiche 'Deploye'", async () => {
    await b1.page.reload({ waitUntil: "networkidle2" });
    await delay(500);
    const t = await text(b1.page);
    assert.ok(
      t.toLowerCase().includes("deploy"),
      "Deployed status shown"
    );
  });

  it("Les NFTs sont mintes (onglet NFTs)", async () => {
    await gotoAndWait(b1.page, `${BASE_URL}/projects/${projectId}/works/${workId}/nfts`);
    const t = await text(b1.page);
    assert.ok(t.includes("NFT Alpha"), "Minted NFT Alpha");
    assert.ok(t.includes("NFT Beta"), "Minted NFT Beta");
    assert.ok(t.includes("NFT Delta"), "Minted NFT Delta");
    const mintBadges = await b1.page.evaluate(() =>
      Array.from(document.querySelectorAll("span"))
        .filter((s) => s.textContent.includes("Mint"))
        .length
    );
    assert.ok(mintBadges >= 3, `3+ 'Minted' badges (found: ${mintBadges})`);
  });

  it("Publier la collection", async () => {
    const work = await authRequest(creator.token, `/works/${workId}/publish`, { method: "POST" });
    assert.ok(work.is_public, "is_public = true");
    assert.ok(work.public_slug, "Slug generated");
  });

  it("La page vue d'ensemble affiche le lien public", async () => {
    await gotoAndWait(b1.page, `${BASE_URL}/projects/${projectId}/works/${workId}`);
    const t = await text(b1.page);
    assert.ok(
      t.includes("/sale/") || t.includes("Ouvrir") || t.includes("publique"),
      "Public link visible on work overview"
    );
  });
});

// ════════════════════════════════════════════
// 6. Public sale page
// ════════════════════════════════════════════
describe("6. Page de vente publique", () => {
  let publicSlug;

  it("Recuperer le slug", async () => {
    const work = await authRequest(creator.token, `/works/${workId}`);
    publicSlug = work.public_slug;
    assert.ok(publicSlug);
  });

  it("La page s'affiche sans authentification", async () => {
    const tmp = await newBrowser(null);
    await gotoAndWait(tmp.page, `${BASE_URL}/sale/${publicSlug}`);
    const t = await text(tmp.page);
    assert.ok(t.includes("Collection Alpha"), "Collection name");
    assert.ok(t.includes("NFT Alpha"), "NFT Alpha");
    assert.ok(t.includes("NFT Beta"), "NFT Beta");
    assert.ok(t.includes("NFT Delta"), "NFT Delta");
    await tmp.browser.close();
  });

  it("Les boutons Acheter sont presents", async () => {
    await gotoAndWait(b2.page, `${BASE_URL}/sale/${publicSlug}`);
    const buyCount = await b2.page.evaluate(() =>
      Array.from(document.querySelectorAll("button"))
        .filter((b) => b.textContent.trim() === "Acheter").length
    );
    assert.ok(buyCount >= 3, `3+ Acheter buttons (found: ${buyCount})`);
  });

  it("Les prix sont visibles", async () => {
    const t = await text(b2.page);
    assert.ok(t.includes("0.1") || t.includes("0,1"), "Price 0.1");
    assert.ok(t.includes("0.5") || t.includes("0,5"), "Price 0.5");
    assert.ok(t.includes("1.5") || t.includes("1,5"), "Price 1.5");
  });

  it("Clic sur un NFT ouvre la modal avec details", async () => {
    await b2.page.evaluate(() => {
      const cards = document.querySelectorAll("div[class*='cursor-pointer']");
      for (const c of cards) {
        if (c.querySelector("h5")) { c.click(); break; }
      }
    });
    await delay(800);
    const t = await text(b2.page);
    assert.ok(
      t.includes("Acheter cette") || t.includes("Token #"),
      "Modal with buy button"
    );
  });

  it("Pas d'erreur 'vault deploye'", async () => {
    const t = await text(b2.page);
    assert.ok(!t.includes("vault deploye"), "No vault error");
  });

  it("Le footer Heritage est present", async () => {
    const footer = await b2.page.evaluate(() => {
      const f = document.querySelector("footer");
      return f ? f.innerText : "";
    });
    assert.ok(
      footer.toLowerCase().includes("heritage") || footer.includes("CPI"),
      "Footer present"
    );
  });

  it("Slug invalide → page d'erreur", async () => {
    const tmp = await newBrowser(null);
    await tmp.page.goto(`${BASE_URL}/sale/invalid-slug-xyz-999`, { waitUntil: "networkidle2" });
    await delay(3000);
    const t = await text(tmp.page);
    assert.ok(
      t.includes("introuvable") || t.includes("existe pas") || !t.includes("Acheter"),
      "Error page for invalid slug"
    );
    await tmp.browser.close();
  });
});

// ════════════════════════════════════════════
// 7. Multi-user approval flow (TWO BROWSERS)
// ════════════════════════════════════════════
let multiProjectId, multiWorkId;

describe("7. Flux d'approbation multi-utilisateurs (2 navigateurs)", () => {
  it("Setup: projet + work + allocation + invitation", async () => {
    const project = await authRequest(creator.token, "/projects", {
      method: "POST",
      body: JSON.stringify({ name: "Collab E2E " + Date.now(), description: "Multi-user test" }),
    });
    multiProjectId = project.id;

    const work = await authRequest(creator.token, `/projects/${multiProjectId}/works`, {
      method: "POST",
      body: JSON.stringify({ name: "Collab Collection", work_type: "nft_collection" }),
    });
    multiWorkId = work.id;

    // Create allocation
    const alloc = await authRequest(creator.token, `/works/${multiWorkId}/allocations`, {
      method: "POST",
      body: JSON.stringify({ label: "Collaborateurs", total_bps: 3000, distribution_mode: "equal" }),
    });

    // Invite participant
    await authRequest(creator.token, `/projects/${multiProjectId}/participants`, {
      method: "POST",
      body: JSON.stringify({
        user_id: participant.userId,
        wallet_address: participant.wallet,
        allocation_id: alloc.id,
        role: "collaborator",
      }),
    });
  });

  it("Participant voit le projet et l'invitation", async () => {
    await gotoAndWait(b2.page, `${BASE_URL}/projects/${multiProjectId}`);
    const t = await text(b2.page);
    assert.ok(
      t.includes("Collab") || t.includes("Accepter") || t.includes("invitation"),
      "Participant sees project or invitation"
    );
  });

  it("Participant accepte l'invitation via API", async () => {
    const proj = await authRequest(participant.token, `/projects/${multiProjectId}`);
    const myP = proj.participants?.find(
      (p) => p.wallet_address === participant.wallet && p.status === "invited"
    );
    if (myP) {
      await authRequest(participant.token, `/participants/${myP.id}/accept`, { method: "PUT" });
    }
    // Verify
    const proj2 = await authRequest(participant.token, `/projects/${multiProjectId}`);
    const accepted = proj2.participants?.find((p) => p.wallet_address === participant.wallet);
    assert.equal(accepted.status, "accepted");
  });

  it("Participant est membre — le navigateur le confirme", async () => {
    await b2.page.reload({ waitUntil: "networkidle2" });
    await delay(500);
    const t = await text(b2.page);
    assert.ok(
      t.includes("Bob Participant") || t.includes("Accepte") || !t.includes("Accepter"),
      "Participant is now a member"
    );
  });

  it("Createur ajoute des draft NFTs", async () => {
    for (let i = 0; i < 2; i++) {
      await authRequest(creator.token, `/works/${multiWorkId}/draft-nfts`, {
        method: "POST",
        body: JSON.stringify({ title: `Collab NFT #${i}`, description: `Collab ${i}`, price: `${(i + 1) * 0.3}`, artist_name: "Alice&Bob", image_url: "", attributes: "[]" }),
      });
    }
  });

  it("Soumettre pour approbation → pending_approval", async () => {
    const work = await authRequest(creator.token, `/works/${multiWorkId}/submit-for-approval`, { method: "POST" });
    assert.equal(work.status, "pending_approval");
  });

  it("[Browser 1] Createur voit 'En attente d'approbation'", async () => {
    await gotoAndWait(b1.page, `${BASE_URL}/projects/${multiProjectId}/works/${multiWorkId}`);
    const t = await text(b1.page);
    assert.ok(
      t.includes("attente") || t.includes("approbation") || t.includes("pending"),
      "Creator sees pending approval"
    );
  });

  it("[Browser 2] Participant voit l'oeuvre en attente", async () => {
    await gotoAndWait(b2.page, `${BASE_URL}/projects/${multiProjectId}/works/${multiWorkId}`);
    const t = await text(b2.page);
    assert.ok(
      t.includes("attente") || t.includes("approbation") || t.includes("Approuver"),
      "Participant sees pending approval"
    );
  });

  it("[Browser 2] Participant voit les NFTs a approuver", async () => {
    await gotoAndWait(b2.page, `${BASE_URL}/projects/${multiProjectId}/works/${multiWorkId}/nfts`);
    const t = await text(b2.page);
    assert.ok(t.includes("Collab NFT"), "Participant sees draft NFTs");
  });

  it("Participant approuve → status = approved", async () => {
    const work = await authRequest(participant.token, `/works/${multiWorkId}/approve`, { method: "POST" });
    assert.equal(work.status, "approved");
  });

  it("[Browser 1] Createur voit 'Approuve' apres reload", async () => {
    await b1.page.reload({ waitUntil: "networkidle2" });
    await delay(500);
    const t = await text(b1.page);
    assert.ok(
      t.includes("Approuv") || t.includes("approuv") || t.includes("Valider"),
      "Creator sees approved status"
    );
  });

  it("Createur valide → ready_to_deploy", async () => {
    const work = await authRequest(creator.token, `/works/${multiWorkId}/validate-approval`, { method: "POST" });
    assert.equal(work.status, "ready_to_deploy");
  });

  it("Createur deploie", async () => {
    const work = await authRequest(creator.token, `/works/${multiWorkId}/deploy`, { method: "POST" });
    assert.equal(work.status, "deployed");
    assert.ok(work.contract_vault_address);
  });

  it("[Browser 1] Createur voit 'Deploye'", async () => {
    await b1.page.reload({ waitUntil: "networkidle2" });
    await delay(500);
    const t = await text(b1.page);
    assert.ok(t.toLowerCase().includes("deploy"), "Creator sees deployed");
  });

  it("[Browser 2] Participant voit 'Deploye'", async () => {
    await gotoAndWait(b2.page, `${BASE_URL}/projects/${multiProjectId}/works/${multiWorkId}`);
    const t = await text(b2.page);
    assert.ok(t.toLowerCase().includes("deploy"), "Participant sees deployed");
  });
});

// ════════════════════════════════════════════
// 8. Auto-reset on modification during approval
// ════════════════════════════════════════════
describe("8. Auto-reset lors de modification pendant l'approbation", () => {
  let resetProjectId, resetWorkId;

  it("Setup: new project + work + allocation + participant + NFT", async () => {
    const project = await authRequest(creator.token, "/projects", {
      method: "POST",
      body: JSON.stringify({ name: "Reset E2E " + Date.now(), description: "" }),
    });
    resetProjectId = project.id;

    const work = await authRequest(creator.token, `/projects/${resetProjectId}/works`, {
      method: "POST",
      body: JSON.stringify({ name: "Reset Collection", work_type: "nft_collection" }),
    });
    resetWorkId = work.id;

    const alloc = await authRequest(creator.token, `/works/${resetWorkId}/allocations`, {
      method: "POST",
      body: JSON.stringify({ label: "Reset Part", total_bps: 2000, distribution_mode: "equal" }),
    });

    await authRequest(creator.token, `/projects/${resetProjectId}/participants`, {
      method: "POST",
      body: JSON.stringify({ user_id: participant.userId, wallet_address: participant.wallet, allocation_id: alloc.id, role: "tester" }),
    });

    // Accept invitation
    const proj = await authRequest(participant.token, `/projects/${resetProjectId}`);
    const inv = proj.participants?.find((p) => p.wallet_address === participant.wallet && p.status === "invited");
    if (inv) await authRequest(participant.token, `/participants/${inv.id}/accept`, { method: "PUT" });

    await authRequest(creator.token, `/works/${resetWorkId}/draft-nfts`, {
      method: "POST",
      body: JSON.stringify({ title: "Reset NFT", description: "", price: "1", artist_name: "", image_url: "", attributes: "[]" }),
    });
  });

  it("Soumettre → pending_approval", async () => {
    const work = await authRequest(creator.token, `/works/${resetWorkId}/submit-for-approval`, { method: "POST" });
    assert.equal(work.status, "pending_approval");
  });

  it("Modifier un draft NFT → auto-reset to draft", async () => {
    const work = await authRequest(creator.token, `/works/${resetWorkId}`);
    const draftId = work.draft_nfts[0].id;
    await authRequest(creator.token, `/draft-nfts/${draftId}`, {
      method: "PUT",
      body: JSON.stringify({ title: "Reset NFT Modified" }),
    });
    const updated = await authRequest(creator.token, `/works/${resetWorkId}`);
    assert.equal(updated.status, "draft", "Auto-reset to draft");
  });

  it("[Browser] Createur voit 'Brouillon' apres reset", async () => {
    await gotoAndWait(b1.page, `${BASE_URL}/projects/${resetProjectId}/works/${resetWorkId}`);
    const t = await text(b1.page);
    assert.ok(t.includes("Brouillon"), "Draft status after reset");
  });

  it("Ajouter un NFT pendant pending_approval → auto-reset", async () => {
    // Re-submit
    const work = await authRequest(creator.token, `/works/${resetWorkId}/submit-for-approval`, { method: "POST" });
    assert.equal(work.status, "pending_approval");

    // Add a new draft NFT
    await authRequest(creator.token, `/works/${resetWorkId}/draft-nfts`, {
      method: "POST",
      body: JSON.stringify({ title: "New During Approval", description: "", price: "2", artist_name: "", image_url: "", attributes: "[]" }),
    });

    const updated = await authRequest(creator.token, `/works/${resetWorkId}`);
    assert.equal(updated.status, "draft", "Auto-reset after adding NFT during approval");
  });

  it("Supprimer un draft NFT pendant pending_approval → auto-reset", async () => {
    const submitted = await authRequest(creator.token, `/works/${resetWorkId}/submit-for-approval`, { method: "POST" });
    assert.equal(submitted.status, "pending_approval");

    // Fetch full work detail to get draft_nfts
    const work = await authRequest(creator.token, `/works/${resetWorkId}`);
    const draft = work.draft_nfts[0];
    assert.ok(draft, "Has at least one draft NFT");
    await authRequest(creator.token, `/draft-nfts/${draft.id}`, { method: "DELETE" });

    const updated = await authRequest(creator.token, `/works/${resetWorkId}`);
    assert.equal(updated.status, "draft", "Auto-reset after deleting NFT during approval");
  });
});

// ════════════════════════════════════════════
// 9. Post-deploy mint cycle with approval
// ════════════════════════════════════════════
describe("9. Cycle mint post-deploiement avec approbation (2 navigateurs)", () => {
  it("Ajouter des drafts a la collection deployee", async () => {
    for (let i = 0; i < 2; i++) {
      await authRequest(creator.token, `/works/${multiWorkId}/draft-nfts`, {
        method: "POST",
        body: JSON.stringify({ title: `Post-Deploy #${i}`, description: "After deploy", price: `${(i + 1) * 0.5}`, artist_name: "Alice", image_url: "", attributes: "[]" }),
      });
    }
    const work = await authRequest(creator.token, `/works/${multiWorkId}`);
    assert.equal(work.draft_nfts.length, 2);
  });

  it("[Browser 1] Createur voit les nouveaux drafts dans l'onglet NFTs", async () => {
    await gotoAndWait(b1.page, `${BASE_URL}/projects/${multiProjectId}/works/${multiWorkId}/nfts`);
    const t = await text(b1.page);
    assert.ok(t.includes("Post-Deploy #0"), "Draft #0 visible");
    assert.ok(t.includes("Post-Deploy #1"), "Draft #1 visible");
  });

  it("Soumettre pour approbation mint → pending_mint_approval", async () => {
    const work = await authRequest(creator.token, `/works/${multiWorkId}/submit-for-mint-approval`, { method: "POST" });
    assert.equal(work.status, "pending_mint_approval");
  });

  it("[Browser 1] Createur voit le statut mint approval", async () => {
    await b1.page.reload({ waitUntil: "networkidle2" });
    await delay(500);
    const t = await text(b1.page);
    assert.ok(
      t.toLowerCase().includes("mint") || t.includes("approbation"),
      "Creator sees mint approval status"
    );
  });

  it("[Browser 2] Participant voit les drafts a approuver", async () => {
    await gotoAndWait(b2.page, `${BASE_URL}/projects/${multiProjectId}/works/${multiWorkId}/nfts`);
    const t = await text(b2.page);
    assert.ok(t.includes("Post-Deploy"), "Participant sees draft NFTs");
  });

  it("Participant approuve le mint → mint_ready", async () => {
    const work = await authRequest(participant.token, `/works/${multiWorkId}/approve`, { method: "POST" });
    assert.equal(work.status, "mint_ready");
  });

  it("[Browser 1] Createur voit 'Pret a minter'", async () => {
    await gotoAndWait(b1.page, `${BASE_URL}/projects/${multiProjectId}/works/${multiWorkId}`);
    const t = await text(b1.page);
    assert.ok(
      t.includes("Minter") || t.includes("minter") || t.includes("mint"),
      "Creator sees mint ready"
    );
  });

  it("Minter les NFTs un par un → retour a deployed", async () => {
    const work = await authRequest(creator.token, `/works/${multiWorkId}`);
    for (const draft of work.draft_nfts) {
      await authRequest(creator.token, `/works/${multiWorkId}/mint`, {
        method: "POST",
        body: JSON.stringify({
          title: draft.title,
          artist_name: draft.artist_name || "",
          metadata_uri: draft.metadata_uri || "",
        }),
      });
    }
    const final_ = await authRequest(creator.token, `/works/${multiWorkId}`);
    assert.equal(final_.status, "deployed");
    assert.equal(final_.draft_nfts.length, 0);
    assert.ok(final_.nfts.length >= 4, `4+ minted NFTs (got ${final_.nfts.length})`);
  });

  it("[Browser 1+2] Les deux voient tous les NFTs mintes", async () => {
    await gotoAndWait(b1.page, `${BASE_URL}/projects/${multiProjectId}/works/${multiWorkId}/nfts`);
    let t = await text(b1.page);
    assert.ok(t.includes("Post-Deploy"), "Creator sees post-deploy NFTs");

    await gotoAndWait(b2.page, `${BASE_URL}/projects/${multiProjectId}/works/${multiWorkId}/nfts`);
    t = await text(b2.page);
    assert.ok(t.includes("Post-Deploy"), "Participant sees post-deploy NFTs");
  });
});

// ════════════════════════════════════════════
// 10. Allocations, repartition, simulation views
// ════════════════════════════════════════════
describe("10. Allocations et onglets de repartition", () => {
  it("[Browser 1] Onglet Parts affiche les allocations", async () => {
    await gotoAndWait(b1.page, `${BASE_URL}/projects/${multiProjectId}/works/${multiWorkId}/allocations`);
    const t = await text(b1.page);
    assert.ok(
      t.includes("Collaborateurs") || t.includes("30") || t.includes("deploy"),
      "Allocations tab content"
    );
  });

  it("[Browser 2] Participant voit les allocations (verrouillees)", async () => {
    await gotoAndWait(b2.page, `${BASE_URL}/projects/${multiProjectId}/works/${multiWorkId}/allocations`);
    const t = await text(b2.page);
    assert.ok(
      t.includes("deploy") || t.includes("modifiable") || t.includes("Repartition") || t.includes("createur"),
      "Participant sees locked allocations"
    );
  });

  it("Onglet Repartition charge correctement", async () => {
    await gotoAndWait(b1.page, `${BASE_URL}/projects/${multiProjectId}/works/${multiWorkId}/repartition`);
    const t = await text(b1.page);
    assert.ok(t.length > 30, "Repartition page loaded");
  });

  it("Onglet Simulation charge correctement", async () => {
    await gotoAndWait(b1.page, `${BASE_URL}/projects/${multiProjectId}/works/${multiWorkId}/simulation`);
    const t = await text(b1.page);
    assert.ok(t.length > 30, "Simulation page loaded");
  });
});

// ════════════════════════════════════════════
// 11. Discussion / Threads
// ════════════════════════════════════════════
describe("11. Discussion et threads", () => {
  let threadId;

  it("Creer un thread", async () => {
    const thread = await authRequest(creator.token, `/projects/${multiProjectId}/threads`, {
      method: "POST",
      body: JSON.stringify({ title: "Thread E2E", content: "Premier message" }),
    });
    threadId = thread.id;
    assert.ok(threadId);
  });

  it("Participant repond au thread", async () => {
    const msg = await authRequest(participant.token, `/threads/${threadId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: "Reponse de Bob" }),
    });
    assert.ok(msg.id);
  });

  it("[Browser 1] Discussion visible pour le createur", async () => {
    await gotoAndWait(b1.page, `${BASE_URL}/projects/${multiProjectId}/discussion`);
    const t = await text(b1.page);
    assert.ok(t.includes("Thread E2E") || t.includes("discussion"), "Thread visible for creator");
  });

  it("[Browser 2] Discussion visible pour le participant", async () => {
    await gotoAndWait(b2.page, `${BASE_URL}/projects/${multiProjectId}/discussion`);
    const t = await text(b2.page);
    assert.ok(t.includes("Thread E2E") || t.includes("discussion"), "Thread visible for participant");
  });
});

// ════════════════════════════════════════════
// 12. Project close / reopen
// ════════════════════════════════════════════
describe("12. Fermeture et reouverture de projet", () => {
  let closeProjectId;

  it("Creer et fermer un projet", async () => {
    const project = await authRequest(creator.token, "/projects", {
      method: "POST",
      body: JSON.stringify({ name: "Close Test " + Date.now(), description: "" }),
    });
    closeProjectId = project.id;
    await authRequest(creator.token, `/projects/${closeProjectId}/close`, { method: "POST" });
    const closed = await authRequest(creator.token, `/projects/${closeProjectId}`);
    assert.equal(closed.status, "closed");
  });

  it("[Browser] Affiche 'Clos' et bouton Rouvrir", async () => {
    await gotoAndWait(b1.page, `${BASE_URL}/projects/${closeProjectId}`);
    const t = await text(b1.page);
    assert.ok(
      t.includes("Clos") || t.includes("Rouvrir"),
      "Closed status or reopen button"
    );
  });

  it("Rouvrir le projet", async () => {
    await authRequest(creator.token, `/projects/${closeProjectId}/reopen`, { method: "POST" });
    const reopened = await authRequest(creator.token, `/projects/${closeProjectId}`);
    assert.equal(reopened.status, "active");
  });
});

// ════════════════════════════════════════════
// 13. Locked state (ready_to_deploy)
// ════════════════════════════════════════════
describe("13. Etat verrouille — ready_to_deploy", () => {
  let lockedWorkId;

  it("Setup: work solo → ready_to_deploy", async () => {
    const proj = await authRequest(creator.token, "/projects", {
      method: "POST",
      body: JSON.stringify({ name: "Lock E2E " + Date.now(), description: "" }),
    });
    const work = await authRequest(creator.token, `/projects/${proj.id}/works`, {
      method: "POST",
      body: JSON.stringify({ name: "Locked Work", work_type: "nft_collection" }),
    });
    lockedWorkId = work.id;
    await authRequest(creator.token, `/works/${lockedWorkId}/draft-nfts`, {
      method: "POST",
      body: JSON.stringify({ title: "Locked NFT", description: "", price: "1", artist_name: "", image_url: "", attributes: "[]" }),
    });
    const submitted = await authRequest(creator.token, `/works/${lockedWorkId}/submit-for-approval`, { method: "POST" });
    assert.equal(submitted.status, "ready_to_deploy");
  });

  it("Cannot add draft NFT", async () => {
    try {
      await authRequest(creator.token, `/works/${lockedWorkId}/draft-nfts`, {
        method: "POST",
        body: JSON.stringify({ title: "Fail", description: "", price: "1", artist_name: "", image_url: "", attributes: "[]" }),
      });
      assert.fail("Should reject");
    } catch (e) {
      assert.ok(e.message.includes("400"), "Rejected");
    }
  });

  it("Cannot add allocation", async () => {
    try {
      await authRequest(creator.token, `/works/${lockedWorkId}/allocations`, {
        method: "POST",
        body: JSON.stringify({ label: "Fail", total_bps: 1000, distribution_mode: "equal" }),
      });
      assert.fail("Should reject");
    } catch (e) {
      assert.ok(e.message.includes("400"), "Rejected");
    }
  });
});

// ════════════════════════════════════════════
// 14. Contract addresses
// ════════════════════════════════════════════
describe("14. Adresses de contrats", () => {
  it("Deploy auto-genere les adresses", async () => {
    const work = await authRequest(creator.token, `/works/${multiWorkId}`);
    assert.ok(work.contract_nft_address?.startsWith("0x"));
    assert.ok(work.contract_splitter_address?.startsWith("0x"));
    assert.ok(work.contract_vault_address?.startsWith("0x"));
    assert.equal(work.contract_nft_address.length, 42);
  });

  it("Mise a jour partielle des adresses", async () => {
    const before = await authRequest(creator.token, `/works/${multiWorkId}`);
    const newVault = "0x" + "a".repeat(40);
    const updated = await authRequest(creator.token, `/works/${multiWorkId}/contracts`, {
      method: "PUT",
      body: JSON.stringify({ contract_vault_address: newVault }),
    });
    assert.equal(updated.contract_vault_address, newVault, "Vault updated");
    assert.equal(updated.contract_nft_address, before.contract_nft_address, "NFT unchanged");
  });

  it("[Browser] Adresses visibles dans vue d'ensemble", async () => {
    await gotoAndWait(b1.page, `${BASE_URL}/projects/${multiProjectId}/works/${multiWorkId}`);
    const t = await text(b1.page);
    assert.ok(t.includes("0x"), "Addresses visible");
  });
});

// ════════════════════════════════════════════
// 15. NFT collections list page
// ════════════════════════════════════════════
describe("15. Liste des collections NFT", () => {
  it("Page collections NFT liste les collections du projet", async () => {
    await gotoAndWait(b1.page, `${BASE_URL}/projects/${multiProjectId}/works/nft`);
    const t = await text(b1.page);
    assert.ok(
      t.includes("Collab Collection") || t.includes("Collections NFT"),
      "Collection listed"
    );
  });
});

// ════════════════════════════════════════════
// 16. Profile edit
// ════════════════════════════════════════════
describe("16. Page profil", () => {
  it("Page profil accessible pour le createur", async () => {
    await gotoAndWait(b1.page, `${BASE_URL}/profile/edit`);
    const t = await text(b1.page);
    assert.ok(
      t.includes("Alice Creator") || t.includes("Profil") || t.includes("profil"),
      "Profile page loaded"
    );
  });

  it("Page profil accessible pour le participant", async () => {
    await gotoAndWait(b2.page, `${BASE_URL}/profile/edit`);
    const t = await text(b2.page);
    assert.ok(
      t.includes("Bob Participant") || t.includes("Profil") || t.includes("profil"),
      "Profile page loaded"
    );
  });
});

// ════════════════════════════════════════════
// 17. Dashboard filters
// ════════════════════════════════════════════
describe("17. Filtres du dashboard", () => {
  it("Le dashboard montre les projets crees", async () => {
    await gotoAndWait(b1.page, `${BASE_URL}/dashboard`);
    const t = await text(b1.page);
    assert.ok(
      t.includes("Collab E2E") || t.includes("Browser E2E"),
      "Dashboard shows projects"
    );
  });

  it("Les filtres sont presents", async () => {
    const t = await text(b1.page);
    assert.ok(
      t.includes("Tous") || t.includes("Actif"),
      "Filter chips visible"
    );
  });
});

// ════════════════════════════════════════════
// 18. Notifications
// ════════════════════════════════════════════
describe("18. Notifications", () => {
  it("Le createur a des notifications", async () => {
    const notifs = await authRequest(creator.token, "/notifications");
    assert.ok(Array.isArray(notifs) && notifs.length > 0, `Creator has ${notifs.length} notifications`);
  });

  it("Le participant a des notifications", async () => {
    const notifs = await authRequest(participant.token, "/notifications");
    assert.ok(Array.isArray(notifs) && notifs.length > 0, `Participant has ${notifs.length} notifications`);
  });

  it("Compteur non-lus disponible", async () => {
    const data = await authRequest(creator.token, "/notifications/unread-count");
    assert.ok(typeof data.count === "number");
  });
});

// ════════════════════════════════════════════
// 19. Activity page
// ════════════════════════════════════════════
describe("19. Page activite", () => {
  it("Activite du projet accessible", async () => {
    await gotoAndWait(b1.page, `${BASE_URL}/projects/${multiProjectId}/activity`);
    const t = await text(b1.page);
    assert.ok(t.length > 30, "Activity page loaded");
  });
});

// ════════════════════════════════════════════
// 20. Error handling — nonexistent project
// ════════════════════════════════════════════
describe("20. Gestion d'erreurs", () => {
  it("Projet inexistant → page ne montre pas de contenu projet valide", async () => {
    await b1.page.goto(`${BASE_URL}/projects/nonexistent-id-123`, { waitUntil: "networkidle2" });
    await delay(3000);
    const t = await text(b1.page);
    const url = b1.page.url();
    // App may show error, redirect, or show loading. Key: no valid project content
    assert.ok(
      t.includes("introuvable") ||
      t.includes("Erreur") ||
      t.includes("erreur") ||
      t.includes("Chargement") ||
      url.includes("dashboard") ||
      !t.includes("Vue d'ensemble"),
      "No valid project content for nonexistent ID"
    );
  });
});

// ════════════════════════════════════════════
// 21. ACHAT NFT END-TO-END (Anvil + API + Browser + On-chain)
//
// Flow complet :
//   1. Demarrer Anvil (blockchain locale)
//   2. Deployer HeritageFactory → creer NFT+Splitter+Vault
//   3. Minter 3 NFTs dans le Vault, fixer les prix
//   4. Creer projet + collection via API avec les VRAIES adresses Anvil
//   5. Publier la collection
//   6. Ouvrir la page publique dans le navigateur → verifier NFTs + prix
//   7. Acheter un NFT on-chain via viem → verifier transfert de propriete
//   8. Verifier que le Splitter a recu les fonds
//   9. Distribuer les fonds aux beneficiaires → verifier les montants
// ════════════════════════════════════════════

const ANVIL_RPC = "http://127.0.0.1:8545";
const DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const BUYER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const DEPLOYER = privateKeyToAccount(DEPLOYER_KEY);
const BUYER = privateKeyToAccount(BUYER_KEY);

const FACTORY_ABI = [
  {
    name: "createHeritage", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "name", type: "string" }, { name: "symbol", type: "string" },
      { name: "producer", type: "address" }, { name: "wallets", type: "address[]" },
      { name: "roles", type: "string[]" }, { name: "shares", type: "uint256[]" },
      { name: "royaltyBps", type: "uint256" }, { name: "contractURI", type: "string" },
    ],
    outputs: [
      { name: "index", type: "uint256" }, { name: "nftAddr", type: "address" },
      { name: "splitterAddr", type: "address" }, { name: "vaultAddr", type: "address" },
    ],
  },
];
const NFT_ABI = [
  { name: "mint", type: "function", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "uri", type: "string" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "ownerOf", type: "function", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "address" }] },
  { name: "totalSupply", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
];
const VAULT_ABI = [
  { name: "purchase", type: "function", stateMutability: "payable", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [] },
  { name: "setPriceBatch", type: "function", stateMutability: "nonpayable", inputs: [{ name: "tokenIds", type: "uint256[]" }, { name: "prices", type: "uint256[]" }], outputs: [] },
  { name: "tokenPrice", type: "function", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "availableCount", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
];
const SPLITTER_ABI = [
  { name: "releasePrimary", type: "function", stateMutability: "nonpayable", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [] },
  { name: "pendingWithdrawals", type: "function", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "withdraw", type: "function", stateMutability: "nonpayable", inputs: [], outputs: [] },
];

describe("21. Achat NFT end-to-end (Anvil + API + Browser + On-chain)", () => {
  let anvilProcess, publicClient, deployerWallet, buyerWallet;
  let factoryAddr, nftAddr, splitterAddr, vaultAddr;
  let purchaseSlug;

  it("Demarrer Anvil et deployer la Factory", async () => {
    // Start Anvil
    anvilProcess = spawn("anvil", ["--port", "8545", "--silent", "--hardfork", "shanghai"], {
      stdio: "ignore", detached: true,
    });
    await delay(2000);

    publicClient = createPublicClient({ chain: foundry, transport: http(ANVIL_RPC) });
    deployerWallet = createWalletClient({ account: DEPLOYER, chain: foundry, transport: http(ANVIL_RPC) });
    buyerWallet = createWalletClient({ account: BUYER, chain: foundry, transport: http(ANVIL_RPC) });

    // Verify anvil is running
    const block = await publicClient.getBlockNumber();
    assert.ok(block >= 0n, "Anvil is running");

    // Deploy Factory via forge
    factoryAddr = await new Promise((resolve, reject) => {
      const proc = spawn("forge", [
        "create", "src/HeritageFactory.sol:HeritageFactory",
        "--rpc-url", ANVIL_RPC, "--private-key", DEPLOYER_KEY, "--broadcast",
      ], { cwd: "/home/alexandre/workspaces/trace/avalanche_hackathon/blockchain", stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "", stderr = "";
      proc.stdout.on("data", (d) => (stdout += d));
      proc.stderr.on("data", (d) => (stderr += d));
      proc.on("close", () => {
        const match = (stdout + stderr).match(/Deployed to:\s+(0x[0-9a-fA-F]+)/);
        if (match) resolve(match[1]);
        else reject(new Error(`forge failed:\n${stdout}\n${stderr}`));
      });
    });
    assert.ok(factoryAddr.startsWith("0x"), "Factory deployed");
  });

  it("Creer Heritage (NFT + Splitter + Vault) via Factory", async () => {
    const { result } = await publicClient.simulateContract({
      account: DEPLOYER, address: factoryAddr, abi: FACTORY_ABI,
      functionName: "createHeritage",
      args: ["Purchase E2E", "PE2E", DEPLOYER.address,
        [DEPLOYER.address, BUYER.address], ["creator", "buyer"], [7000n, 3000n],
        500n, "ipfs://test"],
    });
    const hash = await deployerWallet.writeContract({
      address: factoryAddr, abi: FACTORY_ABI, functionName: "createHeritage",
      args: ["Purchase E2E", "PE2E", DEPLOYER.address,
        [DEPLOYER.address, BUYER.address], ["creator", "buyer"], [7000n, 3000n],
        500n, "ipfs://test"],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    nftAddr = result[1]; splitterAddr = result[2]; vaultAddr = result[3];
    assert.ok(nftAddr && splitterAddr && vaultAddr, "Heritage trio deployed");
  });

  it("Minter 3 NFTs dans le Vault et fixer les prix", async () => {
    for (let i = 0; i < 3; i++) {
      const h = await deployerWallet.writeContract({
        address: nftAddr, abi: NFT_ABI, functionName: "mint",
        args: [vaultAddr, `ipfs://purchase-e2e-nft-${i}`],
      });
      await publicClient.waitForTransactionReceipt({ hash: h });
    }

    const supply = await publicClient.readContract({ address: nftAddr, abi: NFT_ABI, functionName: "totalSupply" });
    assert.equal(supply, 3n, "3 NFTs minted");

    const h = await deployerWallet.writeContract({
      address: vaultAddr, abi: VAULT_ABI, functionName: "setPriceBatch",
      args: [[0n, 1n, 2n], [parseEther("0.1"), parseEther("0.25"), parseEther("0.5")]],
    });
    await publicClient.waitForTransactionReceipt({ hash: h });

    const p0 = await publicClient.readContract({ address: vaultAddr, abi: VAULT_ABI, functionName: "tokenPrice", args: [0n] });
    assert.equal(p0, parseEther("0.1"), "Token 0 = 0.1 ETH");
  });

  it("Creer projet + collection via API avec les VRAIES adresses Anvil", async () => {
    const project = await authRequest(creator.token, "/projects", {
      method: "POST",
      body: JSON.stringify({ name: "Purchase E2E " + Date.now(), description: "Test achat reel" }),
    });

    const work = await authRequest(creator.token, `/projects/${project.id}/works`, {
      method: "POST",
      body: JSON.stringify({ name: "Purchase Collection", work_type: "nft_collection" }),
    });

    // Add 3 draft NFTs matching on-chain tokens
    for (let i = 0; i < 3; i++) {
      await authRequest(creator.token, `/works/${work.id}/draft-nfts`, {
        method: "POST",
        body: JSON.stringify({
          title: `Achat NFT #${i}`,
          description: `NFT pour test d'achat numero ${i}`,
          price: [0.1, 0.25, 0.5][i].toString(),
          artist_name: "E2E Artist",
          image_url: "", attributes: "[]",
        }),
      });
    }

    // Deploy (auto-generates fake addresses)
    await authRequest(creator.token, `/works/${work.id}/submit-for-approval`, { method: "POST" });
    await authRequest(creator.token, `/works/${work.id}/deploy`, { method: "POST" });

    // Override with REAL Anvil contract addresses
    await authRequest(creator.token, `/works/${work.id}/contracts`, {
      method: "PUT",
      body: JSON.stringify({
        contract_nft_address: nftAddr,
        contract_splitter_address: splitterAddr,
        contract_vault_address: vaultAddr,
      }),
    });

    // Publish
    const published = await authRequest(creator.token, `/works/${work.id}/publish`, { method: "POST" });
    purchaseSlug = published.public_slug;
    assert.ok(purchaseSlug, "Collection publiee avec slug");
  });

  it("API publique retourne les vraies adresses de contrats", async () => {
    const res = await fetch(`${API_URL}/public/collections/${purchaseSlug}`);
    const col = await res.json();
    assert.equal(col.contract_vault_address, vaultAddr, "Vault address = vraie adresse Anvil");
    assert.equal(col.nfts.length, 3, "3 NFTs dans la collection");
    assert.equal(col.nfts[0].price, "0.1", "Prix du NFT #0 correct");
  });

  it("[Browser] Page publique affiche les NFTs avec les prix", async () => {
    await gotoAndWait(b2.page, `${BASE_URL}/sale/${purchaseSlug}`);
    const t = await text(b2.page);
    assert.ok(t.includes("Purchase Collection"), "Nom de collection affiche");
    assert.ok(t.includes("Achat NFT #0"), "NFT #0 affiche");
    assert.ok(t.includes("Achat NFT #1"), "NFT #1 affiche");
    assert.ok(t.includes("Achat NFT #2"), "NFT #2 affiche");
    assert.ok(t.includes("0.1") || t.includes("0,1"), "Prix 0.1 affiche");
    assert.ok(t.includes("0.25") || t.includes("0,25"), "Prix 0.25 affiche");
    assert.ok(t.includes("0.5") || t.includes("0,5"), "Prix 0.5 affiche");
  });

  it("[Browser] Boutons Acheter presents et pas d'erreur vault", async () => {
    const t = await text(b2.page);
    assert.ok(!t.includes("vault deploye"), "Pas d'erreur 'vault deploye'");
    const buyCount = await b2.page.evaluate(() =>
      Array.from(document.querySelectorAll("button"))
        .filter((b) => b.textContent.trim() === "Acheter").length
    );
    assert.ok(buyCount >= 3, `3+ boutons Acheter (trouve: ${buyCount})`);
  });

  it("[On-chain] Acheter le NFT #0 pour 0.1 ETH", async () => {
    // Verify token is in vault before purchase
    const ownerBefore = await publicClient.readContract({
      address: nftAddr, abi: NFT_ABI, functionName: "ownerOf", args: [0n],
    });
    assert.equal(ownerBefore.toLowerCase(), vaultAddr.toLowerCase(), "Token #0 dans le vault avant achat");

    // Purchase
    const hash = await buyerWallet.writeContract({
      address: vaultAddr, abi: VAULT_ABI, functionName: "purchase",
      args: [0n], value: parseEther("0.1"),
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, "success", "Transaction d'achat reussie");

    // Verify buyer now owns the NFT
    const ownerAfter = await publicClient.readContract({
      address: nftAddr, abi: NFT_ABI, functionName: "ownerOf", args: [0n],
    });
    assert.equal(ownerAfter.toLowerCase(), BUYER.address.toLowerCase(), "L'acheteur possede le NFT #0");
  });

  it("[On-chain] Le Vault a 2 NFTs restants", async () => {
    const available = await publicClient.readContract({
      address: vaultAddr, abi: VAULT_ABI, functionName: "availableCount",
    });
    assert.equal(available, 2n, "2 tokens restants dans le vault");
  });

  it("[On-chain] Le Splitter a recu les fonds (0.1 ETH)", async () => {
    const balance = await publicClient.getBalance({ address: splitterAddr });
    assert.equal(balance, parseEther("0.1"), "Splitter a recu 0.1 ETH");
  });

  it("[On-chain] Acheter le NFT #2 pour 0.5 ETH", async () => {
    const hash = await buyerWallet.writeContract({
      address: vaultAddr, abi: VAULT_ABI, functionName: "purchase",
      args: [2n], value: parseEther("0.5"),
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, "success", "Achat NFT #2 reussi");

    const owner = await publicClient.readContract({
      address: nftAddr, abi: NFT_ABI, functionName: "ownerOf", args: [2n],
    });
    assert.equal(owner.toLowerCase(), BUYER.address.toLowerCase(), "L'acheteur possede le NFT #2");
  });

  it("[On-chain] Le Splitter a recu 0.6 ETH au total", async () => {
    const balance = await publicClient.getBalance({ address: splitterAddr });
    assert.equal(balance, parseEther("0.6"), "Splitter: 0.1 + 0.5 = 0.6 ETH");
  });

  it("[On-chain] ReleasePrimary distribue les fonds (70/30)", async () => {
    const h = await deployerWallet.writeContract({
      address: splitterAddr, abi: SPLITTER_ABI, functionName: "releasePrimary", args: [0n],
    });
    await publicClient.waitForTransactionReceipt({ hash: h });

    const pendingCreator = await publicClient.readContract({
      address: splitterAddr, abi: SPLITTER_ABI, functionName: "pendingWithdrawals", args: [DEPLOYER.address],
    });
    const pendingBuyer = await publicClient.readContract({
      address: splitterAddr, abi: SPLITTER_ABI, functionName: "pendingWithdrawals", args: [BUYER.address],
    });
    // 70% of 0.1 = 0.07, 30% of 0.1 = 0.03
    assert.equal(pendingCreator, parseEther("0.07"), "Creator: 70% de 0.1 ETH = 0.07");
    assert.equal(pendingBuyer, parseEther("0.03"), "Buyer: 30% de 0.1 ETH = 0.03");
  });

  it("[On-chain] Beneficiaire retire ses fonds", async () => {
    const balBefore = await publicClient.getBalance({ address: DEPLOYER.address });
    const h = await deployerWallet.writeContract({
      address: splitterAddr, abi: SPLITTER_ABI, functionName: "withdraw",
    });
    await publicClient.waitForTransactionReceipt({ hash: h });
    const balAfter = await publicClient.getBalance({ address: DEPLOYER.address });

    assert.ok(balAfter > balBefore, "Balance du deployer a augmente apres retrait");

    const pendingAfter = await publicClient.readContract({
      address: splitterAddr, abi: SPLITTER_ABI, functionName: "pendingWithdrawals", args: [DEPLOYER.address],
    });
    assert.equal(pendingAfter, 0n, "Plus de fonds en attente apres retrait");
  });

  it("[On-chain] Impossible d'acheter un NFT deja vendu", async () => {
    try {
      await buyerWallet.writeContract({
        address: vaultAddr, abi: VAULT_ABI, functionName: "purchase",
        args: [0n], value: parseEther("0.1"),
      });
      assert.fail("Devrait echouer — NFT deja vendu");
    } catch (e) {
      assert.ok(
        e.message.includes("NotInVault") || e.message.includes("revert"),
        "Revert: NFT plus dans le vault"
      );
    }
  });

  // Cleanup
  after(() => {
    if (anvilProcess) {
      try { process.kill(-anvilProcess.pid); } catch {}
    }
  });
});
