/**
 * E2E Infrastructure Manager
 *
 * Creates a fully isolated environment per test run:
 *   - Anvil local blockchain (random port)
 *   - Backend (random port, fresh SQLite DB)
 *   - Frontend Vite dev server (random port, pointing to local Anvil + backend)
 *
 * Two entry points:
 *   - startInfra()     — convenience wrapper, starts everything
 *   - startAnvil()     — start just Anvil (for split deploy flow)
 *   - startServices()  — start backend + frontend (after contracts are deployed)
 */
import * as net from "node:net";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");
const BLOCKCHAIN_DIR = path.join(ROOT, "blockchain");
const BACKEND_DIR = path.join(ROOT, "backend");
const FRONTEND_DIR = path.join(ROOT, "frontend");

// Track all spawned processes for cleanup on unexpected exit
const spawnedProcesses = new Set<ChildProcess>();

function killAllSpawned() {
  for (const proc of spawnedProcesses) {
    if (proc.pid) {
      try { process.kill(-proc.pid, "SIGKILL"); } catch {}
    }
  }
  spawnedProcesses.clear();
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => { killAllSpawned(); process.exit(1); });
}
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception, cleaning up spawned processes:", err);
  killAllSpawned();
  process.exit(1);
});

export { ROOT, BLOCKCHAIN_DIR };

export interface E2EInfra {
  anvilPort: number;
  backendPort: number;
  frontendPort: number;
  anvilRpc: string;
  apiUrl: string;
  frontendUrl: string;
  dbPath: string;
  envDir: string;
  processes: {
    anvil: ChildProcess;
    backend: ChildProcess;
    frontend: ChildProcess;
  };
}

export interface AnvilInstance {
  port: number;
  rpc: string;
  process: ChildProcess;
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
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

async function waitForJsonRpc(url: string, timeout = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_blockNumber",
          params: [],
          id: 1,
        }),
      });
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Anvil not ready at ${url}`);
}

async function killProcessOnPort(port: number): Promise<void> {
  try {
    const { execSync } = await import("node:child_process");
    const out = execSync(`lsof -ti :${port} 2>/dev/null`).toString().trim();
    if (out) {
      // SIGTERM first for graceful shutdown
      for (const pid of out.split("\n")) {
        try { process.kill(Number(pid), "SIGTERM"); } catch {}
      }
      // Wait up to 5s, then SIGKILL any remaining
      await new Promise((r) => setTimeout(r, 5000));
      try {
        const remaining = execSync(`lsof -ti :${port} 2>/dev/null`).toString().trim();
        if (remaining) {
          for (const pid of remaining.split("\n")) {
            try { process.kill(Number(pid), "SIGKILL"); } catch {}
          }
          await new Promise((r) => setTimeout(r, 500));
        }
      } catch {}
    }
  } catch {}
}

// ── Start just Anvil ──

export async function startAnvil(): Promise<AnvilInstance> {
  const port = await getFreePort();
  const rpc = `http://127.0.0.1:${port}`;

  console.log(`  Starting Anvil on port ${port}...`);
  const proc = spawn(
    "anvil",
    ["--port", String(port), "--silent", "--hardfork", "cancun"],
    { stdio: "ignore", detached: true }
  );
  proc.unref();
  spawnedProcesses.add(proc);
  await waitForJsonRpc(rpc);
  console.log(`  Anvil ready (chain ID 31337, port ${port})`);

  return { port, rpc, process: proc };
}

// ── Start MinIO (Docker) ──

export interface MinioInstance {
  port: number;
  endpoint: string;
  process: ChildProcess;
}

export async function startMinio(): Promise<MinioInstance> {
  const port = await getFreePort();
  const endpoint = `http://127.0.0.1:${port}`;
  const containerName = `e2e-minio-${port}`;

  console.log(`  Starting MinIO on port ${port}...`);
  const proc = spawn(
    "docker",
    [
      "run", "--rm", "--name", containerName,
      "-p", `${port}:9000`,
      "-e", "MINIO_ROOT_USER=minioadmin",
      "-e", "MINIO_ROOT_PASSWORD=minioadmin",
      "minio/minio", "server", "/data",
    ],
    { stdio: "ignore", detached: true }
  );
  proc.unref();
  spawnedProcesses.add(proc);

  // Wait for MinIO to be ready
  await waitForHttp(`${endpoint}/minio/health/ready`);

  // Create the bucket
  const { execSync } = await import("node:child_process");
  // Use mc (minio client) or curl to create bucket
  try {
    execSync(
      `docker exec ${containerName} sh -c "mkdir -p /data/heritage-e2e"`,
      { stdio: "ignore" }
    );
  } catch {
    // Bucket might already exist
  }

  console.log(`  MinIO ready (port ${port})`);
  return { port, endpoint, process: proc };
}

export async function stopMinio(minio: MinioInstance): Promise<void> {
  const containerName = `e2e-minio-${minio.port}`;
  try {
    const { execSync } = await import("node:child_process");
    execSync(`docker rm -f ${containerName}`, { stdio: "ignore" });
  } catch {}
  spawnedProcesses.delete(minio.process);
}

// ── Start backend + frontend ──

export async function startServices(opts: {
  anvilRpc: string;
  backendEnv?: Record<string, string>;
  fixedFrontendPort?: number;
}): Promise<{
  backendPort: number;
  frontendPort: number;
  apiUrl: string;
  frontendUrl: string;
  dbPath: string;
  envDir: string;
  minioPort: number;
  processes: { backend: ChildProcess; frontend: ChildProcess };
}> {
  const runId = Date.now();

  const frontendPortToCheck = opts.fixedFrontendPort || 8877;
  await killProcessOnPort(frontendPortToCheck);

  const backendPort = await getFreePort();
  const frontendPort = opts.fixedFrontendPort || (await getFreePort());

  const backendUrl = `http://127.0.0.1:${backendPort}`;
  const frontendUrl = `http://127.0.0.1:${frontendPort}`;
  const dbPath = path.join(os.tmpdir(), `heritage-e2e-${runId}.db`);

  // Create isolated env dir for frontend
  const envDir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-env-"));
  fs.writeFileSync(
    path.join(envDir, ".env"),
    [
      `VITE_CHAIN_RPC=${opts.anvilRpc}`,
      `VITE_CHAIN_ID=31337`,
      `VITE_CHAIN_LABEL=Anvil Local`,
      `VITE_MAIN_DOMAIN=localhost`,
      `VITE_PUBLIC_DOMAIN=public.localhost`,
      `VITE_FACTORY_ADDRESS=`,
      `VITE_DOCUMENT_REGISTRY_ADDRESS=`,
    ].join("\n")
  );

  // Find backend binary
  const debugBin = path.join(BACKEND_DIR, "target/debug/heritage-backend");
  const releaseBin = path.join(BACKEND_DIR, "target/release/heritage-backend");
  const debugExists = fs.existsSync(debugBin);
  const releaseExists = fs.existsSync(releaseBin);
  let backendBin: string;
  if (debugExists && releaseExists) {
    const debugMtime = fs.statSync(debugBin).mtimeMs;
    const releaseMtime = fs.statSync(releaseBin).mtimeMs;
    backendBin = debugMtime > releaseMtime ? debugBin : releaseBin;
  } else if (releaseExists) {
    backendBin = releaseBin;
  } else if (debugExists) {
    backendBin = debugBin;
  } else {
    throw new Error(
      `Backend binary not found. Run 'cd backend && cargo build' first.`
    );
  }
  console.log(
    `  Using backend: ${backendBin.includes("release") ? "release" : "debug"}`
  );

  // Start MinIO (Docker)
  const minio = await startMinio();

  // Start backend
  console.log(`  Starting backend on port ${backendPort}...`);
  const docsDir = path.join(os.tmpdir(), `e2e-docs-${runId}`);
  fs.mkdirSync(docsDir, { recursive: true });

  const backendLog = path.join(os.tmpdir(), `e2e-backend-${runId}.log`);
  const backendLogFd = fs.openSync(backendLog, "w");
  console.log(`  Backend log: ${backendLog}`);
  const backend = spawn(backendBin, [], {
    stdio: ["ignore", backendLogFd, backendLogFd],
    detached: true,
    env: {
      ...process.env,
      DATABASE_URL: `sqlite://${dbPath}?mode=rwc`,
      JWT_SECRET: `e2e-secret-${runId}`,
      AVALANCHE_RPC_URL: opts.anvilRpc,
      CHAIN_ID: "31337",
      HOST: "0.0.0.0",
      PORT: String(backendPort),
      CERTIFIER_PRIVATE_KEY:
        "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      CERTIFIER_ADDRESS: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      DOCUMENT_STORAGE_PATH: docsDir,
      MINIO_ENDPOINT: minio.endpoint,
      MINIO_ACCESS_KEY: "minioadmin",
      MINIO_SECRET_KEY: "minioadmin",
      MINIO_BUCKET: "heritage-e2e",
      RATE_LIMIT_PER_MIN: "600",
      WS_RATE_LIMIT_PER_MIN: "120",
      ...(opts.backendEnv || {}),
    },
  });
  backend.unref();
  spawnedProcesses.add(backend);
  await waitForHttp(`${backendUrl}/api/health`);
  console.log(`  Backend ready (port ${backendPort}, DB ${dbPath})`);

  // Start frontend vite dev server
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
  spawnedProcesses.add(frontend);
  await waitForHttp(frontendUrl);
  console.log(`  Frontend ready (port ${frontendPort})`);

  return {
    backendPort,
    frontendPort,
    apiUrl: `${backendUrl}/api`,
    frontendUrl,
    dbPath,
    envDir,
    minioPort: minio.port,
    processes: { backend, frontend },
  };
}

// ── Convenience wrapper ──

export async function startInfra(
  fixedFrontendPort?: number
): Promise<E2EInfra> {
  console.log(`\n=== E2E Infrastructure ===`);

  const anvil = await startAnvil();
  const services = await startServices({
    anvilRpc: anvil.rpc,
    fixedFrontendPort,
  });

  console.log(`=== Infrastructure ready ===\n`);

  return {
    anvilPort: anvil.port,
    backendPort: services.backendPort,
    frontendPort: services.frontendPort,
    anvilRpc: anvil.rpc,
    apiUrl: services.apiUrl,
    frontendUrl: services.frontendUrl,
    dbPath: services.dbPath,
    envDir: services.envDir,
    processes: {
      anvil: anvil.process,
      backend: services.processes.backend,
      frontend: services.processes.frontend,
    },
  };
}

export async function stopInfra(infra: E2EInfra): Promise<void> {
  console.log(`\n=== Tearing down infrastructure ===`);
  const { processes, dbPath, envDir } = infra;

  for (const [name, proc] of Object.entries(processes)) {
    if (proc.pid) {
      try {
        process.kill(-proc.pid, "SIGTERM");
        console.log(`  Stopped ${name} (PID ${proc.pid})`);
      } catch {}
      spawnedProcesses.delete(proc);
    }
  }

  // Clean up temp files
  for (const f of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
    try {
      fs.unlinkSync(f);
    } catch {}
  }
  try {
    fs.rmSync(envDir, { recursive: true });
  } catch {}

  console.log(`=== Infrastructure stopped ===\n`);
}
