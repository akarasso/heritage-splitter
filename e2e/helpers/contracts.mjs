/**
 * Contract ABIs for E2E tests — matches the deployed Solidity contracts.
 */

export const FACTORY_ABI = [
  {
    name: "createCollection",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "name", type: "string" },
      { name: "symbol", type: "string" },
      { name: "owner", type: "address" },
      { name: "wallets", type: "address[]" },
      { name: "shares", type: "uint256[]" },
      { name: "royaltyBps", type: "uint96" },
      { name: "contractURI", type: "string" },
      { name: "registry", type: "address" },
    ],
    outputs: [
      { name: "index", type: "uint256" },
      { name: "nftAddr", type: "address" },
      { name: "splitterAddr", type: "address" },
    ],
  },
];

export const NFT_ABI = [
  {
    name: "mint",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "uri", type: "string" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "setMinter",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "_minter", type: "address" }],
    outputs: [],
  },
  {
    name: "setApprovalForAll",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
  },
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "totalSupply",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
];

export const MARKET_ABI = [
  {
    name: "list",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "nft", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "price", type: "uint256" },
    ],
    outputs: [{ name: "listingId", type: "uint256" }],
  },
  {
    name: "listBatch",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "nfts", type: "address[]" },
      { name: "tokenIds", type: "uint256[]" },
      { name: "prices", type: "uint256[]" },
    ],
    outputs: [{ name: "listingIds", type: "uint256[]" }],
  },
  {
    name: "purchase",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "listingId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "purchaseFor",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "listingId", type: "uint256" },
      { name: "recipient", type: "address" },
    ],
    outputs: [],
  },
  {
    name: "availableCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "count", type: "uint256" }],
  },
  {
    name: "listAvailable",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "offset", type: "uint256" },
      { name: "limit", type: "uint256" },
    ],
    outputs: [
      { name: "listingIds", type: "uint256[]" },
      { name: "nftContracts", type: "address[]" },
      { name: "tokenIds", type: "uint256[]" },
      { name: "prices", type: "uint256[]" },
      { name: "sellers", type: "address[]" },
    ],
  },
  {
    name: "listings",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "nftContract", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "price", type: "uint256" },
      { name: "seller", type: "address" },
      { name: "active", type: "bool" },
    ],
  },
];

export const SHOWROOM_ABI = [
  {
    name: "addItem",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "market", type: "address" },
      { name: "listingId", type: "uint256" },
      { name: "margin", type: "uint256" },
    ],
    outputs: [{ name: "itemId", type: "uint256" }],
  },
  {
    name: "addItemBatch",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "markets", type: "address[]" },
      { name: "listingIds", type: "uint256[]" },
      { name: "margins", type: "uint256[]" },
    ],
    outputs: [{ name: "itemIds", type: "uint256[]" }],
  },
  {
    name: "purchase",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "itemId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "itemCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "accumulatedMargins",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "withdrawMargins",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "owner",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
];

export const PAYMENT_REGISTRY_ABI = [
  {
    name: "pendingWithdrawals",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
];
