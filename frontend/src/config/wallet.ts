import Onboard from "@web3-onboard/core";
import injectedModule from "@web3-onboard/injected-wallets";
import { chainIdHex, chainRpc, chainName } from "./chain";

const injected = injectedModule();

const primaryChain = {
  id: chainIdHex,
  token: "AVAX",
  label: chainName,
  rpcUrl: chainRpc,
};

export const onboard = Onboard({
  wallets: [injected],
  chains: [primaryChain],
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
