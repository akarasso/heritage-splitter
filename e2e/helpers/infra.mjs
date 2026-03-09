/**
 * E2E Infrastructure Manager
 *
 * Starts an isolated environment per test run:
 *   - Anvil local blockchain (random port)
 *   - Backend (random port, fresh SQLite DB)
 *   - Frontend Vite dev server (fixed port, pointing to local Anvil + backend)
 *
 * Also deploys smart contracts (Factory, Market, PaymentRegistry) on Anvil.
 */
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const BLOCKCHAIN_DIR = path.join(ROOT, "blockchain");
const BACKEND_DIR = path.join(ROOT, "backend");
const FRONTEND_DIR = path.join(ROOT, "frontend");

export { ROOT, BLOCKCHAIN_DIR };

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

async function waitForHttp(url, timeout = 30000) {
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

async function waitForJsonRpc(url, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 }),
      });
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Anvil not ready at ${url}`);
}

async function killProcessOnPort(port) {
  try {
    const { execSync } = await import("node:child_process");
    const out = execSync(`lsof -ti :${port} 2>/dev/null`).toString().trim();
    if (out) {
      for (const pid of out.split("\n")) {
        try { process.kill(Number(pid), "SIGKILL"); } catch {}
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  } catch {}
}

/**
 * Deploy a contract via `forge create`.
 * Returns the deployed address.
 */
export function deployContract(name, anvilRpc, deployerKey, extraArgs = []) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "forge",
      [
        "create", name,
        "--rpc-url", anvilRpc,
        "--private-key", deployerKey,
        "--broadcast",
        ...extraArgs,
      ],
      { cwd: BLOCKCHAIN_DIR, stdio: ["ignore", "pipe", "pipe"] }
    );
    let out = "";
    proc.stdout?.on("data", (d) => (out += d));
    proc.stderr?.on("data", (d) => (out += d));
    proc.on("close", () => {
      const match = out.match(/Deployed to:\s+(0x[0-9a-fA-F]+)/);
      if (match) resolve(match[1]);
      else reject(new Error(`Deploy ${name} failed: ${out}`));
    });
  });
}

/**
 * Start full isolated infrastructure:
 *   Anvil → Backend (with contracts config) → Frontend
 *
 * Returns { anvilRpc, apiUrl, frontendUrl, processes, ... }
 */
export async function startInfra(frontendPort = 8877) {
  const runId = Date.now();
  console.log(`\n=== E2E Infrastructure (run ${runId}) ===`);

  await killProcessOnPort(frontendPort);

  // 1. Allocate ports
  const [anvilPort, backendPort] = await Promise.all([getFreePort(), getFreePort()]);
  const anvilRpc = `http://127.0.0.1:${anvilPort}`;
  const backendUrl = `http://127.0.0.1:${backendPort}`;
  const frontendUrl = `http://127.0.0.1:${frontendPort}`;
  const dbPath = path.join(os.tmpdir(), `heritage-e2e-${runId}.db`);

  // 2. Create isolated env dir for frontend
  const envDir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-env-"));
  fs.writeFileSync(
    path.join(envDir, ".env"),
    [
      `VITE_CHAIN_RPC=${anvilRpc}`,
      `VITE_CHAIN_ID=31337`,
      `VITE_CHAIN_LABEL=Anvil Local`,
      `VITE_MAIN_DOMAIN=localhost`,
      `VITE_PUBLIC_DOMAIN=public.localhost`,
      `VITE_FACTORY_ADDRESS=`,
      `VITE_DOCUMENT_REGISTRY_ADDRESS=`,
    ].join("\n")
  );

  // 3. Start Anvil
  console.log(`  Starting Anvil on port ${anvilPort}...`);
  const anvil = spawn(
    "anvil",
    ["--port", String(anvilPort), "--silent", "--hardfork", "cancun"],
    { stdio: "ignore", detached: true }
  );
  anvil.unref();
  await waitForJsonRpc(anvilRpc);
  console.log(`  Anvil ready (chain ID 31337, port ${anvilPort})`);

  // 4. Deploy smart contracts on Anvil
  const DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  const DEPLOYER_ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

  const registryAddr = await deployContract("src/PaymentRegistry.sol:PaymentRegistry", anvilRpc, DEPLOYER_KEY);
  const factoryAddr = await deployContract("src/CollectionFactory.sol:CollectionFactory", anvilRpc, DEPLOYER_KEY);
  const marketAddr = await deployContract("src/NFTMarket.sol:NFTMarket", anvilRpc, DEPLOYER_KEY, [
    "--constructor-args", DEPLOYER_ADDR, DEPLOYER_ADDR,
  ]);
  console.log(`  Contracts deployed: Factory=${factoryAddr}, Market=${marketAddr}, Registry=${registryAddr}`);

  // 5. Find backend binary
  const debugBin = path.join(BACKEND_DIR, "target/debug/heritage-backend");
  const releaseBin = path.join(BACKEND_DIR, "target/release/heritage-backend");
  let backendBin;
  if (fs.existsSync(debugBin) && fs.existsSync(releaseBin)) {
    backendBin = fs.statSync(debugBin).mtimeMs > fs.statSync(releaseBin).mtimeMs ? debugBin : releaseBin;
  } else if (fs.existsSync(releaseBin)) {
    backendBin = releaseBin;
  } else if (fs.existsSync(debugBin)) {
    backendBin = debugBin;
  } else {
    throw new Error("Backend binary not found. Run 'cd backend && cargo build' first.");
  }
  console.log(`  Using backend: ${backendBin.includes("release") ? "release" : "debug"}`);

  // 6. Start backend with isolated DB + contract addresses
  const docsDir = path.join(os.tmpdir(), `e2e-docs-${runId}`);
  fs.mkdirSync(docsDir, { recursive: true });

  const backend = spawn(backendBin, [], {
    stdio: "ignore",
    detached: true,
    env: {
      ...process.env,
      DATABASE_URL: `sqlite://${dbPath}?mode=rwc`,
      JWT_SECRET: `e2e-secret-${runId}`,
      AVALANCHE_RPC_URL: anvilRpc,
      CHAIN_ID: "31337",
      HOST: "0.0.0.0",
      PORT: String(backendPort),
      CERTIFIER_PRIVATE_KEY: DEPLOYER_KEY.replace("0x", ""),
      CERTIFIER_ADDRESS: DEPLOYER_ADDR,
      FACTORY_ADDRESS: factoryAddr,
      MARKET_ADDRESS: marketAddr,
      REGISTRY_ADDRESS: registryAddr,
      DOCUMENT_STORAGE_PATH: docsDir,
    },
  });
  backend.unref();
  await waitForHttp(`${backendUrl}/api/health`);
  console.log(`  Backend ready (port ${backendPort}, DB ${dbPath})`);

  // 7. Start frontend vite dev server
  console.log(`  Starting frontend on port ${frontendPort}...`);
  const viteBin = path.join(FRONTEND_DIR, "node_modules", ".bin", "vite");
  const frontend = spawn(
    viteBin,
    ["--port", String(frontendPort), "--host"],
    {
      stdio: "ignore",
      detached: true,
      cwd: FRONTEND_DIR,
      env: {
        ...process.env,
        VITE_ENV_DIR: envDir,
        API_TARGET: backendUrl,
        DEV_PORT: String(frontendPort),
      },
    }
  );
  frontend.unref();
  await waitForHttp(frontendUrl);
  console.log(`  Frontend ready (port ${frontendPort})`);

  console.log(`=== Infrastructure ready ===\n`);

  return {
    anvilPort,
    backendPort,
    frontendPort,
    anvilRpc,
    apiUrl: `${backendUrl}/api`,
    frontendUrl,
    dbPath,
    envDir,
    docsDir,
    factoryAddr,
    marketAddr,
    registryAddr,
    processes: { anvil, backend, frontend },
  };
}

/**
 * Stop all infrastructure processes and clean up temp files.
 */
export async function stopInfra(infra) {
  console.log(`\n=== Tearing down infrastructure ===`);

  for (const [name, proc] of Object.entries(infra.processes)) {
    if (proc.pid) {
      try {
        process.kill(-proc.pid, "SIGTERM");
        console.log(`  Stopped ${name} (PID ${proc.pid})`);
      } catch {}
    }
  }

  // Clean up temp files
  for (const f of [infra.dbPath, `${infra.dbPath}-shm`, `${infra.dbPath}-wal`]) {
    try { fs.unlinkSync(f); } catch {}
  }
  try { fs.rmSync(infra.envDir, { recursive: true }); } catch {}
  try { fs.rmSync(infra.docsDir, { recursive: true }); } catch {}

  console.log(`=== Infrastructure stopped ===\n`);
}
