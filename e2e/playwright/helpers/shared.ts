/**
 * Shared constants and helpers used by both globalSetup and tests.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { privateKeyToAccount } from "viem/accounts";

// ── Anvil default accounts ──

export const ANVIL_KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
] as const;

export const ALICE_ACCOUNT = privateKeyToAccount(ANVIL_KEYS[0]);
export const BOB_ACCOUNT = privateKeyToAccount(ANVIL_KEYS[1]);
export const CHARLIE_ACCOUNT = privateKeyToAccount(ANVIL_KEYS[2]);
export const DAVE_ACCOUNT = privateKeyToAccount(ANVIL_KEYS[3]);

// ── Config interface ──

export interface E2EConfig {
  anvilRpc: string;
  apiUrl: string;
  frontendUrl: string;
  tiltMode: boolean;
  aliceToken: string;
  bobToken: string;
  charlieToken: string;
  daveToken: string;
  aliceUserId: string;
  bobUserId: string;
  charlieUserId: string;
  daveUserId: string;
  factoryAddr: string;
  marketAddr: string;
  docRegistryAddr: string;
  registryAddr: string;
}

// ── API helper ──

export async function apiRequest<T = unknown>(
  apiUrl: string,
  urlPath: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${apiUrl}${urlPath}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `API ${options.method || "GET"} ${urlPath} failed (${res.status}): ${text}`
    );
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json() as Promise<T>;
  return null as unknown as T;
}

export function apiAuth<T = unknown>(
  apiUrl: string,
  token: string,
  urlPath: string,
  options: RequestInit = {}
): Promise<T> {
  return apiRequest<T>(apiUrl, urlPath, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers as Record<string, string>),
    },
  });
}

// ── Temp file helpers ──

const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

/** Create a temp PNG file and return its path. Caller should call cleanupTempFile() after use. */
export function createTempPng(label = "e2e"): string {
  const tmpPath = path.join("/tmp", `${label}-${Date.now()}.png`);
  fs.writeFileSync(tmpPath, Buffer.from(TINY_PNG_B64, "base64"));
  return tmpPath;
}

/** Silently remove a temp file. */
export function cleanupTempFile(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch {}
}
