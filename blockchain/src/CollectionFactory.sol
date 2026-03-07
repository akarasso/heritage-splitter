// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "./ArtistsSplitter.sol";
import "./CollectionNFT.sol";
import "./NFTMarket.sol";

/**
 * @title CollectionFactory
 * @notice Factory that deploys CollectionNFT + ArtistsSplitter + NFTMarket in one transaction
 * @dev The `minter` role allows a backend wallet to mint on behalf of the owner.
 *      The owner retains full ownership and can revoke the minter at any time.
 */
contract CollectionFactory {

    struct Collection {
        address nft;
        address splitter;
        address vault;
        address owner;
        uint256 createdAt;
    }

    error ZeroOwner();
    error ZeroRegistry();
    error NotOwner();
    error RoyaltyTooHigh();

    Collection[] public collections;

    mapping(address => uint256[]) public ownerCollections;

    event CollectionCreated(
        uint256 indexed index,
        address nft,
        address splitter,
        address vault,
        address owner,
        string name,
        string symbol
    );

    /// @notice Deploy a paired NFT + Splitter + Market
    /// @param owner The creator who will OWN the contracts
    /// @param minter A backend wallet authorized to mint (can be revoked by owner)
    function createCollection(
        string calldata name,
        string calldata symbol,
        address owner,
        address[] calldata wallets,
        uint256[] calldata shares,
        uint96 royaltyBps,
        string calldata contractURI,
        address minter,
        address registry
    ) external returns (uint256 index, address nftAddr, address splitterAddr, address vaultAddr) {
        if (owner == address(0)) revert ZeroOwner();
        if (registry == address(0)) revert ZeroRegistry();
        if (msg.sender != owner) revert NotOwner();
        if (royaltyBps > 10000) revert RoyaltyTooHigh();

        // Deploy splitter first
        ArtistsSplitter splitter = new ArtistsSplitter(
            owner,
            wallets,
            shares,
            registry
        );

        // Deploy NFT pointing to splitter, owner is owner, minter can mint
        CollectionNFT nft = new CollectionNFT(
            name,
            symbol,
            address(splitter),
            royaltyBps,
            owner,
            contractURI,
            minter
        );

        // Deploy market pointing to NFT and splitter
        NFTMarket vault = new NFTMarket(
            address(nft),
            payable(address(splitter)),
            owner,
            minter
        );

        index = collections.length;
        collections.push(Collection({
            nft: address(nft),
            splitter: address(splitter),
            vault: address(vault),
            owner: owner,
            createdAt: block.timestamp
        }));

        ownerCollections[owner].push(index);

        emit CollectionCreated(index, address(nft), address(splitter), address(vault), owner, name, symbol);

        return (index, address(nft), address(splitter), address(vault));
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
