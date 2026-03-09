/**
 * Global Teardown — runs once after all tests
 *
 * In standalone mode: kills isolated infrastructure and cleans up temp files.
 * In Tilt CI mode: just cleans up the config file (Tilt manages infra).
 */
import * as fs from "node:fs";

export default async function globalTeardown() {
  const configPath = process.env.E2E_CONFIG_PATH;
  if (!configPath) return;

  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

    // In Tilt mode, infra is managed by Tilt — skip process cleanup
    if (!config.tiltMode && config.pids) {
      console.log("\n=== Tearing down E2E infrastructure ===");

      // Kill processes by PID group
      for (const [name, pid] of Object.entries(config.pids || {})) {
        try {
          process.kill(-(pid as number), "SIGTERM");
          console.log(`  Stopped ${name} (PID ${pid})`);
        } catch {}
      }

      // Stop MinIO Docker container
      if (config.minioPort) {
        try {
          const { execSync } = await import("node:child_process");
          execSync(`docker rm -f e2e-minio-${config.minioPort}`, { stdio: "ignore" });
          console.log(`  Stopped minio (Docker, port ${config.minioPort})`);
        } catch {}
      }

      // Clean up temp files
      for (const f of [
        config.dbPath,
        `${config.dbPath}-shm`,
        `${config.dbPath}-wal`,
      ]) {
        try {
          fs.unlinkSync(f);
        } catch {}
      }
      if (config.envDir) {
        try {
          fs.rmSync(config.envDir, { recursive: true });
        } catch {}
      }

      console.log("=== Infrastructure stopped ===\n");
    }

    // Always clean up config file
    try {
      fs.unlinkSync(configPath);
    } catch {}
  } catch (e) {
    console.error("Teardown error:", e);
  }
}
