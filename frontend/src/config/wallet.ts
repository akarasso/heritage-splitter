import Onboard from "@web3-onboard/core";
import injectedModule from "@web3-onboard/injected-wallets";

const injected = injectedModule();

const avalancheFuji = {
  id: "0xA869",
  token: "AVAX",
  label: "Avalanche Fuji Testnet",
  rpcUrl: "https://api.avax-test.network/ext/bc/C/rpc",
};

const avalancheMainnet = {
  id: "0xA86A",
  token: "AVAX",
  label: "Avalanche C-Chain",
  rpcUrl: "https://api.avax.network/ext/bc/C/rpc",
};

export const onboard = Onboard({
  wallets: [injected],
  chains: [avalancheFuji, avalancheMainnet],
  appMetadata: {
    name: "Heritage Splitter",
    description: "Plateforme de royalties conforme au droit francais",
    icon: "<svg viewBox='0 0 100 100'><circle cx='50' cy='50' r='40' fill='#E84142'/><text x='50' y='60' text-anchor='middle' fill='white' font-size='30' font-weight='bold'>H</text></svg>",
  },
  accountCenter: {
    desktop: { enabled: false },
    mobile: { enabled: false },
  },
});
