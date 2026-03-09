// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "./ArtistsSplitter.sol";
import "./CollectionNFT.sol";

/**
 * @title CollectionFactory
 * @notice Factory that deploys CollectionNFT + ArtistsSplitter in one transaction
 * @dev NFTs are minted to the owner. The owner lists them on an NFTMarket separately.
 */
contract CollectionFactory {

    struct Collection {
        address nft;
        address splitter;
        address owner;
        uint256 createdAt;
    }

    error ZeroOwner();
    error ZeroRegistry();
    error NotOwner();
    error RoyaltyTooHigh();
    error RegistryNotAuthorized();

    address public owner;
    address public authorizedRegistry;

    Collection[] public collections;

    mapping(address => uint256[]) public ownerCollections;

    event CollectionCreated(
        uint256 indexed index,
        address nft,
        address splitter,
        address owner,
        string name,
        string symbol
    );

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /// @notice Set the authorized registry address. address(0) means any registry is allowed (backwards compat).
    function setAuthorizedRegistry(address _registry) external onlyOwner {
        authorizedRegistry = _registry;
    }

    /// @notice Deploy a paired NFT + Splitter
    /// @param owner The creator who will OWN the contracts
    /// @param minterAddr Backend wallet that can mint NFTs (address(0) = no minter)
    function createCollection(
        string calldata name,
        string calldata symbol,
        address owner,
        address[] calldata wallets,
        uint256[] calldata shares,
        uint96 royaltyBps,
        string calldata contractURI,
        address registry,
        address minterAddr
    ) external returns (uint256 index, address nftAddr, address splitterAddr) {
        if (owner == address(0)) revert ZeroOwner();
        if (registry == address(0)) revert ZeroRegistry();
        if (authorizedRegistry != address(0) && registry != authorizedRegistry) revert RegistryNotAuthorized();
        if (royaltyBps > 10000) revert RoyaltyTooHigh();

        // Deploy splitter first
        ArtistsSplitter splitter = new ArtistsSplitter(
            owner,
            wallets,
            shares,
            registry
        );

        // Deploy NFT pointing to splitter, owner is owner, minter set at deploy time
        CollectionNFT nft = new CollectionNFT(
            name,
            symbol,
            address(splitter),
            royaltyBps,
            owner,
            contractURI,
            minterAddr
        );

        index = collections.length;
        collections.push(Collection({
            nft: address(nft),
            splitter: address(splitter),
            owner: owner,
            createdAt: block.timestamp
        }));

        ownerCollections[owner].push(index);

        emit CollectionCreated(index, address(nft), address(splitter), owner, name, symbol);

        return (index, address(nft), address(splitter));
    }

    /// @notice Get total number of deployed collections
    function collectionCount() external view returns (uint256) {
        return collections.length;
    }

    /// @notice Get collection indices for an owner
    function getOwnerCollections(address owner) external view returns (uint256[] memory) {
        return ownerCollections[owner];
    }
}
