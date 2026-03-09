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
      { name: "minterAddr", type: "address" },
    ],
    outputs: [
      { name: "index", type: "uint256" },
      { name: "nftAddr", type: "address" },
      { name: "splitterAddr", type: "address" },
    ],
  },
] as const;

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
] as const;

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
    name: "setPrice",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "listingId", type: "uint256" },
      { name: "price", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "availableCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
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
      {
        name: "result",
        type: "tuple[]",
        components: [
          { name: "nftContract", type: "address" },
          { name: "tokenId", type: "uint256" },
          { name: "price", type: "uint256" },
          { name: "seller", type: "address" },
          { name: "active", type: "bool" },
        ],
      },
    ],
  },
  {
    name: "listingCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
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
] as const;

export const SPLITTER_ABI = [
  {
    name: "beneficiaryCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// Showroom ABI — matches blockchain/src/Showroom.sol (nft+tokenId keyed)
export const SHOWROOM_ABI = [
  {
    name: "addItem",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "nft", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "market", type: "address" },
      { name: "listingId", type: "uint256" },
      { name: "margin", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "addItemBatch",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "nfts", type: "address[]" },
      { name: "tokenIds", type: "uint256[]" },
      { name: "markets", type: "address[]" },
      { name: "listingIds", type: "uint256[]" },
      { name: "margins", type: "uint256[]" },
    ],
    outputs: [],
  },
  {
    name: "removeItem",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "nft", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "removeItemBatch",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "nfts", type: "address[]" },
      { name: "tokenIds", type: "uint256[]" },
    ],
    outputs: [],
  },
  {
    name: "setMargin",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "nft", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "margin", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "setMarginBatch",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "nfts", type: "address[]" },
      { name: "tokenIds", type: "uint256[]" },
      { name: "margins", type: "uint256[]" },
    ],
    outputs: [],
  },
  {
    name: "purchase",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "nft", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "getItem",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "nft", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
    outputs: [
      { name: "market", type: "address" },
      { name: "marketListingId", type: "uint256" },
      { name: "margin", type: "uint256" },
      { name: "active", type: "bool" },
    ],
  },
  {
    name: "listAvailable",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "nftContracts", type: "address[]" },
      { name: "tokenIds", type: "uint256[]" },
      { name: "markets", type: "address[]" },
      { name: "marketListingIds", type: "uint256[]" },
      { name: "margins", type: "uint256[]" },
      { name: "basePrices", type: "uint256[]" },
    ],
  },
  {
    name: "itemCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "owner",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "deployer",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "registry",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

// DocumentRegistry ABI — matches blockchain/src/DocumentRegistry.sol
export const DOC_REGISTRY_ABI = [
  {
    name: "certifications",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "certifiers",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "nonces",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "DOMAIN_SEPARATOR",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
] as const;

// PaymentRegistry ABI — matches blockchain/src/PaymentRegistry.sol
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
  {
    name: "pay",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "beneficiary", type: "address" }],
    outputs: [],
  },
] as const;

