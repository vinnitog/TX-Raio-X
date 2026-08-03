export const NETWORKS = Object.freeze([
  {
    id: "ethereum",
    name: "Ethereum",
    nativeSymbol: "ETH",
    rpcUrls: ["https://cloudflare-eth.com", "https://ethereum-rpc.publicnode.com"],
    explorerUrl: "https://etherscan.io/tx/"
  },
  {
    id: "base",
    name: "Base",
    nativeSymbol: "ETH",
    rpcUrls: ["https://mainnet.base.org"],
    explorerUrl: "https://basescan.org/tx/"
  },
  {
    id: "arbitrum",
    name: "Arbitrum",
    nativeSymbol: "ETH",
    rpcUrls: ["https://arb1.arbitrum.io/rpc"],
    explorerUrl: "https://arbiscan.io/tx/"
  },
  {
    id: "polygon",
    name: "Polygon",
    nativeSymbol: "POL",
    rpcUrls: ["https://polygon-rpc.com"],
    explorerUrl: "https://polygonscan.com/tx/"
  },
  {
    id: "bnb",
    name: "BNB Chain",
    nativeSymbol: "BNB",
    rpcUrls: ["https://bsc-dataseed.binance.org"],
    explorerUrl: "https://bscscan.com/tx/"
  }
]);
