import { defineChain } from "viem";

const chainRpc =
  import.meta.env.VITE_CHAIN_RPC ||
  "https://api.avax-test.network/ext/bc/C/rpc";
const chainId = Number(import.meta.env.VITE_CHAIN_ID || "43113");
const chainName =
  import.meta.env.VITE_CHAIN_LABEL || "Avalanche Fuji Testnet";

export const appChain = defineChain({
  id: chainId,
  name: chainName,
  nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
  rpcUrls: {
    default: { http: [chainRpc] },
  },
});

export const chainIdHex = `0x${chainId.toString(16)}`;
export { chainRpc, chainName };
