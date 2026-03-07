// Shared helpers for E2E tests
export const BASE_URL = process.env.BASE_URL || "http://localhost:8080";
export const API_URL = `${BASE_URL}/api`;

// Generate a random wallet address
export function randomWallet() {
  const hex = "0123456789abcdef";
  let addr = "0x";
  for (let i = 0; i < 40; i++) addr += hex[Math.floor(Math.random() * 16)];
  return addr;
}

// Raw API request
export async function apiRequest(path, options = {}) {
  const url = `${API_URL}${path}`;
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${options.method || "GET"} ${path} failed (${res.status}): ${text}`);
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return null;
}

// Authenticated API request
export async function authRequest(token, path, options = {}) {
  const headers = { Authorization: `Bearer ${token}`, ...(options.headers || {}) };
  return apiRequest(path, { ...options, headers });
}

// Get a test JWT token (MVP backend doesn't verify signatures)
export async function getTestToken() {
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
  return { wallet, token };
}

export function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
