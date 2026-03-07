// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "forge-std/Test.sol";
import "../src/CollectionFactory.sol";
import "../src/CollectionNFT.sol";
import "../src/ArtistsSplitter.sol";
import "../src/NFTMarket.sol";
import "../src/PaymentRegistry.sol";
import "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";

contract CollectionFactoryTest is Test {
    event CollectionCreated(
        uint256 indexed index,
        address nft,
        address splitter,
        address vault,
        address owner,
        string name,
        string symbol
    );

    CollectionFactory public factory;
    PaymentRegistry public registry;
    address public registryAddr;

    address public producer = makeAddr("producer");
    address payable public artist = payable(makeAddr("artist"));
    address payable public gallery = payable(makeAddr("gallery"));

    function setUp() public {
        factory = new CollectionFactory();

        // Deploy registry behind proxy
        PaymentRegistry impl = new PaymentRegistry();
        bytes memory initData = abi.encodeCall(PaymentRegistry.initialize, (address(this)));
        TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(address(impl), address(this), initData);
        registry = PaymentRegistry(payable(address(proxy)));
        registryAddr = address(registry);
    }

    function _createCollection() internal returns (uint256 index, address nftAddr, address splitterAddr, address vaultAddr) {
        address[] memory wallets = new address[](2);
        wallets[0] = artist;
        wallets[1] = gallery;

        uint256[] memory shares = new uint256[](2);
        shares[0] = 6000;
        shares[1] = 4000;

        vm.prank(producer);
        return factory.createCollection("Test Art", "TART", producer, wallets, shares, 1000, "https://example.com/collection", makeAddr("minter"), registryAddr);
    }

    function test_createCollection() public {
        (uint256 index, address nftAddr, address splitterAddr, address vaultAddr) = _createCollection();

        assertEq(index, 0);
        assertTrue(nftAddr != address(0));
        assertTrue(splitterAddr != address(0));
        assertTrue(vaultAddr != address(0));

        // Verify NFT config
        CollectionNFT nft = CollectionNFT(nftAddr);
        assertEq(nft.name(), "Test Art");
        assertEq(nft.symbol(), "TART");
        assertEq(nft.owner(), producer);
        assertEq(nft.splitter(), splitterAddr);

        // Verify splitter config
        ArtistsSplitter splitter = ArtistsSplitter(payable(splitterAddr));
        assertEq(splitter.owner(), producer);
        assertEq(splitter.beneficiaryCount(), 2);
        assertEq(address(splitter.registry()), registryAddr);

        // Verify market config
        NFTMarket vault = NFTMarket(vaultAddr);
        assertEq(address(vault.nftContract()), nftAddr);
        assertEq(address(vault.splitter()), splitterAddr);
        assertEq(vault.owner(), producer);
    }

    function test_collectionCount() public {
        assertEq(factory.collectionCount(), 0);
        _createCollection();
        assertEq(factory.collectionCount(), 1);
    }

    function test_ownerCollections() public {
        _createCollection();
        _createCollection();

        uint256[] memory indices = factory.getOwnerCollections(producer);
        assertEq(indices.length, 2);
        assertEq(indices[0], 0);
        assertEq(indices[1], 1);
    }

    function test_fullFlow() public {
        // Create collection (NFT + Splitter + Market)
        (, address nftAddr, address splitterAddr, address vaultAddr) = _createCollection();
        CollectionNFT nft = CollectionNFT(nftAddr);
        ArtistsSplitter splitter = ArtistsSplitter(payable(splitterAddr));
        NFTMarket vault = NFTMarket(vaultAddr);

        address buyer1 = makeAddr("buyer1");
        vm.deal(buyer1, 20 ether);
        address buyer2 = makeAddr("buyer2");
        vm.deal(buyer2, 20 ether);

        // === PRIMARY SALE via Market ===

        // Owner mints NFT to market
        vm.prank(producer);
        uint256 tokenId = nft.mint(address(vault), "ipfs://QmArtwork");
        assertEq(nft.ownerOf(tokenId), address(vault));

        // Owner sets price on market
        vm.prank(producer);
        vault.setPrice(tokenId, 10 ether);

        // Buyer1 purchases from market — funds pushed directly to beneficiaries via registry
        vm.prank(buyer1);
        vault.purchase{value: 10 ether}(tokenId, 0);
        assertEq(nft.ownerOf(tokenId), buyer1);

        // Check beneficiary balances: 60% artist, 40% gallery (pushed directly)
        assertEq(artist.balance, 6 ether);
        assertEq(gallery.balance, 4 ether);

        // === SECONDARY SALE (transfers are free) ===

        // Buyer1 transfers to buyer2 (free transfer, no on-chain marketplace)
        vm.prank(buyer1);
        nft.transferFrom(buyer1, buyer2, tokenId);
        assertEq(nft.ownerOf(tokenId), buyer2);

        // Simulate secondary royalty: marketplace sends 10% royalty to splitter
        (bool ok, ) = address(splitter).call{value: 1 ether}("");
        assertTrue(ok);

        // Artist: 6 ether (primary) + 0.6 ether (secondary) = 6.6 ether
        assertEq(artist.balance, 6.6 ether);
        // Gallery: 4 ether (primary) + 0.4 ether (secondary) = 4.4 ether
        assertEq(gallery.balance, 4.4 ether);
    }

    // Test that an unauthorized caller cannot create a collection
    function test_createCollection_revert_unauthorized() public {
        address[] memory wallets = new address[](2);
        wallets[0] = artist;
        wallets[1] = gallery;

        uint256[] memory shares = new uint256[](2);
        shares[0] = 6000;
        shares[1] = 4000;

        address unauthorized = makeAddr("unauthorized");
        vm.prank(unauthorized);
        vm.expectRevert(CollectionFactory.NotOwner.selector);
        factory.createCollection("Test Art", "TART", producer, wallets, shares, 1000, "https://example.com/collection", makeAddr("minter"), registryAddr);
    }

    function test_collectionCreatedEvent() public {
        address[] memory wallets = new address[](2);
        wallets[0] = artist;
        wallets[1] = gallery;
        uint256[] memory shares = new uint256[](2);
        shares[0] = 6000;
        shares[1] = 4000;

        vm.expectEmit(true, false, false, false);
        emit CollectionCreated(0, address(0), address(0), address(0), address(0), "", "");
        vm.prank(producer);
        factory.createCollection("Test", "TST", producer, wallets, shares, 1000, "https://example.com/collection", makeAddr("minter"), registryAddr);
    }
}
