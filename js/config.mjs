export const FREE_ANALYSES = 2;
export const CREDIT_PACK_PRICE = 4.90;
export const CREDIT_PACK_SIZE = 10;
export const FREE_WALLET_HISTORY_LIMIT = 3;
export const UNLOCKED_WALLET_HISTORY_LIMIT = 10;

export function isLocalTestEnvironment(hostname) {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
}

export const NETWORKS = [
  {
    id: "ethereum",
    name: "Ethereum",
    nativeSymbol: "ETH",
    rpcUrls: [
      "https://cloudflare-eth.com",
      "https://ethereum-rpc.publicnode.com"
    ],
    explorerUrl: "https://etherscan.io/tx/",
    historyApiUrl: "https://eth.blockscout.com/api"
  },
  {
    id: "base",
    name: "Base",
    nativeSymbol: "ETH",
    rpcUrls: ["https://mainnet.base.org"],
    explorerUrl: "https://basescan.org/tx/",
    historyApiUrl: "https://base.blockscout.com/api"
  },
  {
    id: "arbitrum",
    name: "Arbitrum",
    nativeSymbol: "ETH",
    rpcUrls: ["https://arb1.arbitrum.io/rpc"],
    explorerUrl: "https://arbiscan.io/tx/",
    historyApiUrl: "https://arbitrum.blockscout.com/api"
  },
  {
    id: "polygon",
    name: "Polygon",
    nativeSymbol: "POL",
    rpcUrls: ["https://polygon-rpc.com"],
    explorerUrl: "https://polygonscan.com/tx/",
    historyApiUrl: "https://polygon.blockscout.com/api"
  },
  {
    id: "bnb",
    name: "BNB Chain",
    nativeSymbol: "BNB",
    rpcUrls: ["https://bsc-dataseed.binance.org"],
    explorerUrl: "https://bscscan.com/tx/",
    historyApiUrl: null
  }
];
