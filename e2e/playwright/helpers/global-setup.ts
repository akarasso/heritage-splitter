/**
 * Global Setup — runs once before all tests
 *
 * MINIMAL setup: infrastructure + auth only.
 * All data creation (project, collection, NFTs, showroom) happens in browser tests.
 *
 * Steps:
 *   A. Infrastructure (Tilt CI or Standalone: Anvil + backend + frontend)
 *   B. Deploy smart contracts
 *   C. Auth 4 personas with complete profiles
 *   D. Write config file
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { privateKeyToAccount } from "viem/accounts";
import { BLOCKCHAIN_DIR } from "./infra";
import { ANVIL_KEYS, apiRequest, apiAuth } from "./shared";

async function getToken(
  apiUrl: string,
  key: string
): Promise<{ wallet: string; token: string; userId: string }> {
  const account = privateKeyToAccount(key as `0x${string}`);
  const wallet = account.address.toLowerCase();

  const { nonce } = await apiRequest<{ nonce: string }>(
    apiUrl,
    "/auth/nonce",
    {
      method: "POST",
      body: JSON.stringify({ wallet_address: wallet }),
    }
  );

  const message = `Heritage Splitter Authentication\n\nWallet: ${wallet}\nNonce: ${nonce}`;
  const signature = await account.signMessage({ message });

  const { token } = await apiRequest<{ token: string }>(
    apiUrl,
    "/auth/verify",
    {
      method: "POST",
      body: JSON.stringify({ wallet_address: wallet, signature, message }),
    }
  );

  const me = await apiRequest<{ id: string }>(apiUrl, "/me", {
    headers: { Authorization: `Bearer ${token}` },
  });

  return { wallet, token, userId: me.id };
}

async function deployViaScript(anvilRpc: string): Promise<{
  factoryAddr: string;
  marketAddr: string;
  docRegistryAddr: string;
  registryAddr: string;
}> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "forge",
      [
        "script",
        "script/Deploy.s.sol",
        "--broadcast",
        "--rpc-url",
        anvilRpc,
      ],
      {
        cwd: BLOCKCHAIN_DIR,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          PRIVATE_KEY: ANVIL_KEYS[0], // keep 0x prefix for vm.envUint
        },
      }
    );
    let out = "";
    proc.stdout?.on("data", (d: Buffer) => (out += d));
    proc.stderr?.on("data", (d: Buffer) => (out += d));
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Deploy script failed (code ${code}): ${out}`));
        return;
      }
      const parse = (label: string) => {
        const m = out.match(new RegExp(`${label}.*?(0x[0-9a-fA-F]{40})`));
        if (!m) throw new Error(`Could not parse ${label} from deploy output:\n${out}`);
        return m[1];
      };
      resolve({
        factoryAddr: parse("CollectionFactory deployed"),
        marketAddr: parse("NFTMarket deployed"),
        docRegistryAddr: parse("DocumentRegistry deployed"),
        registryAddr: parse("PaymentRegistry \\(proxy\\) deployed"),
      });
    });
  });
}

async function waitForHttp(url: string, timeout = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timeout waiting for ${url}`);
}

// ── Main setup ──

export default async function globalSetup() {
  // ── A. Infrastructure ──
  const tiltMode = !!(process.env.E2E_ANVIL_RPC && process.env.E2E_API_URL);

  let anvilRpc: string;
  let apiUrl: string;
  let frontendUrl: string;
  let infra: any = null;
  let factoryAddr: string;
  let marketAddr: string;
  let docRegistryAddr: string;
  let registryAddr: string;

  if (tiltMode) {
    anvilRpc = process.env.E2E_ANVIL_RPC!;
    apiUrl = process.env.E2E_API_URL!;
    frontendUrl = process.env.E2E_FRONTEND_URL || "http://localhost:8877";

    console.log("\n=== Tilt CI mode ===");
    await waitForHttp(`${apiUrl}/health`);

    const contractsPath = "/tmp/e2e-contracts.json";
    if (fs.existsSync(contractsPath)) {
      const contracts = JSON.parse(fs.readFileSync(contractsPath, "utf-8"));
      factoryAddr = contracts.factoryAddr;
      marketAddr = contracts.marketAddr;
      docRegistryAddr = contracts.docRegistryAddr;
      registryAddr = contracts.registryAddr;
    } else {
      const deployed = await deployViaScript(anvilRpc);
      factoryAddr = deployed.factoryAddr;
      marketAddr = deployed.marketAddr;
      docRegistryAddr = deployed.docRegistryAddr;
      registryAddr = deployed.registryAddr;
    }
  } else {
    const { startAnvil, startServices } = await import("./infra");

    console.log("\n=== Standalone mode ===");
    const anvil = await startAnvil();
    anvilRpc = anvil.rpc;

    console.log("  Deploying contracts via forge script...");
    const deployed = await deployViaScript(anvilRpc);
    factoryAddr = deployed.factoryAddr;
    marketAddr = deployed.marketAddr;
    docRegistryAddr = deployed.docRegistryAddr;
    registryAddr = deployed.registryAddr;
    console.log(`  Factory: ${factoryAddr}`);
    console.log(`  Market:  ${marketAddr}`);
    console.log(`  DocReg:  ${docRegistryAddr}`);
    console.log(`  Registry: ${registryAddr}`);

    const frontendPort = parseInt(process.env.E2E_FRONTEND_PORT || "8877");
    const services = await startServices({
      anvilRpc,
      fixedFrontendPort: frontendPort,
      backendEnv: {
        FACTORY_ADDRESS: factoryAddr,
        MARKET_ADDRESS: marketAddr,
        DOC_REGISTRY_ADDRESS: docRegistryAddr,
        REGISTRY_ADDRESS: registryAddr,
      },
    });
    apiUrl = services.apiUrl;
    frontendUrl = services.frontendUrl;

    infra = {
      processes: {
        anvil: anvil.process,
        backend: services.processes.backend,
        frontend: services.processes.frontend,
      },
      minioPort: services.minioPort,
      dbPath: services.dbPath,
      envDir: services.envDir,
    };
  }

  // ── B. Auth all 4 personas ──
  const aliceAuth = await getToken(apiUrl, ANVIL_KEYS[0]);
  const bobAuth = await getToken(apiUrl, ANVIL_KEYS[1]);
  const charlieAuth = await getToken(apiUrl, ANVIL_KEYS[2]);
  const daveAuth = await getToken(apiUrl, ANVIL_KEYS[3]);
  console.log("  All 4 personas authenticated");

  // Set complete profiles (display_name + avatar_url + bio required for isProfileComplete)
  const avatar = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>";
  await apiAuth(apiUrl, aliceAuth.token, "/me", {
    method: "PUT",
    body: JSON.stringify({ display_name: "Alice", role: "artist", bio: "Artist", avatar_url: avatar }),
  });
  await apiAuth(apiUrl, bobAuth.token, "/me", {
    method: "PUT",
    body: JSON.stringify({ display_name: "Bob", role: "artist", bio: "Artist", avatar_url: avatar }),
  });
  await apiAuth(apiUrl, charlieAuth.token, "/me", {
    method: "PUT",
    body: JSON.stringify({ display_name: "Charlie", bio: "Collector", avatar_url: avatar }),
  });
  await apiAuth(apiUrl, daveAuth.token, "/me", {
    method: "PUT",
    body: JSON.stringify({ display_name: "Dave", role: "producer", bio: "Producer", avatar_url: avatar }),
  });

  // ── C. Write config ──
  const config: Record<string, any> = {
    anvilRpc,
    apiUrl,
    frontendUrl,
    tiltMode,
    aliceToken: aliceAuth.token,
    bobToken: bobAuth.token,
    charlieToken: charlieAuth.token,
    daveToken: daveAuth.token,
    aliceUserId: aliceAuth.userId,
    bobUserId: bobAuth.userId,
    charlieUserId: charlieAuth.userId,
    daveUserId: daveAuth.userId,
    factoryAddr,
    marketAddr,
    docRegistryAddr,
    registryAddr,
  };

  if (infra) {
    config.pids = {
      anvil: infra.processes.anvil.pid,
      backend: infra.processes.backend.pid,
      frontend: infra.processes.frontend.pid,
    };
    config.minioPort = infra.minioPort;
    config.dbPath = infra.dbPath;
    config.envDir = infra.envDir;
  }

  const configPath = path.join(
    os.tmpdir(),
    `e2e-config-${process.pid}.json`
  );
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  process.env.E2E_CONFIG_PATH = configPath;
  console.log(`\n=== Setup complete — config at ${configPath} ===\n`);
}
