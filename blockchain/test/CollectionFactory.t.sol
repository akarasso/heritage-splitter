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

    function _createCollection() internal returns (uint256 index, address nftAddr, address splitterAddr) {
        address[] memory wallets = new address[](2);
        wallets[0] = artist;
        wallets[1] = gallery;

        uint256[] memory shares = new uint256[](2);
        shares[0] = 6000;
        shares[1] = 4000;

        vm.prank(producer);
        return factory.createCollection("Test Art", "TART", producer, wallets, shares, 1000, "https://example.com/collection", registryAddr, address(0));
    }

    function test_createCollection() public {
        (uint256 index, address nftAddr, address splitterAddr) = _createCollection();

        assertEq(index, 0);
        assertTrue(nftAddr != address(0));
        assertTrue(splitterAddr != address(0));

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
        // Create collection (NFT + Splitter)
        (, address nftAddr, address splitterAddr) = _createCollection();
        CollectionNFT nft = CollectionNFT(nftAddr);
        ArtistsSplitter splitter = ArtistsSplitter(payable(splitterAddr));

        address buyer1 = makeAddr("buyer1");
        vm.deal(buyer1, 20 ether);

        // Owner mints NFT to themselves
        vm.prank(producer);
        uint256 tokenId = nft.mint(producer, "ipfs://QmArtwork");
        assertEq(nft.ownerOf(tokenId), producer);

        // Deploy a market and list the NFT
        NFTMarket market = new NFTMarket(producer, address(0));
        vm.startPrank(producer);
        nft.approve(address(market), tokenId);
        market.list(nftAddr, tokenId, 10 ether);
        vm.stopPrank();

        // Buyer purchases from market — funds go to splitter
        vm.prank(buyer1);
        market.purchase{value: 10 ether}(0);
        assertEq(nft.ownerOf(tokenId), buyer1);

        // Check beneficiary balances: 60% artist, 40% gallery
        assertEq(artist.balance, 6 ether);
        assertEq(gallery.balance, 4 ether);

        // Simulate secondary royalty: marketplace sends royalty to splitter
        (bool ok, ) = address(splitter).call{value: 1 ether}("");
        assertTrue(ok);

        assertEq(artist.balance, 6.6 ether);
        assertEq(gallery.balance, 4.4 ether);
    }

    function test_createCollection_anyoneCanDeployForOwner() public {
        address[] memory wallets = new address[](2);
        wallets[0] = artist;
        wallets[1] = gallery;

        uint256[] memory shares = new uint256[](2);
        shares[0] = 6000;
        shares[1] = 4000;

        // Anyone can deploy on behalf of an owner (backend deploys for users)
        address deployer = makeAddr("deployer");
        vm.prank(deployer);
        (uint256 idx, address nft,) = factory.createCollection("Test Art", "TART", producer, wallets, shares, 1000, "https://example.com/collection", registryAddr, address(0));
        assertGt(idx + 1, 0);
        assertTrue(nft != address(0));
    }

    function test_collectionCreatedEvent() public {
        address[] memory wallets = new address[](2);
        wallets[0] = artist;
        wallets[1] = gallery;
        uint256[] memory shares = new uint256[](2);
        shares[0] = 6000;
        shares[1] = 4000;

        vm.expectEmit(true, false, false, false);
        emit CollectionCreated(0, address(0), address(0), address(0), "", "");
        vm.prank(producer);
        factory.createCollection("Test", "TST", producer, wallets, shares, 1000, "https://example.com/collection", registryAddr, address(0));
    }

    // ── authorizedRegistry tests ──────────────────────────────

    function test_authorizedRegistry_zeroAllowsAny() public {
        // By default authorizedRegistry is address(0), any registry should work
        assertEq(factory.authorizedRegistry(), address(0));

        // Create with the real registry — should succeed
        _createCollection();
        assertEq(factory.collectionCount(), 1);

        // Create with a different registry — should also succeed when authorizedRegistry == address(0)
        address fakeRegistry = makeAddr("fakeRegistry");
        address[] memory wallets = new address[](2);
        wallets[0] = artist;
        wallets[1] = gallery;
        uint256[] memory shares = new uint256[](2);
        shares[0] = 6000;
        shares[1] = 4000;

        vm.prank(producer);
        factory.createCollection("Art2", "ART2", producer, wallets, shares, 500, "https://example.com", fakeRegistry, address(0));
        assertEq(factory.collectionCount(), 2);
    }

    function test_authorizedRegistry_blocksWrongRegistry() public {
        // Owner sets authorized registry
        factory.setAuthorizedRegistry(registryAddr);
        assertEq(factory.authorizedRegistry(), registryAddr);

        // Creating with the correct registry should succeed
        _createCollection();
        assertEq(factory.collectionCount(), 1);

        // Creating with a wrong registry should revert
        address wrongRegistry = makeAddr("wrongRegistry");
        address[] memory wallets = new address[](2);
        wallets[0] = artist;
        wallets[1] = gallery;
        uint256[] memory shares = new uint256[](2);
        shares[0] = 6000;
        shares[1] = 4000;

        vm.prank(producer);
        vm.expectRevert(CollectionFactory.RegistryNotAuthorized.selector);
        factory.createCollection("Art2", "ART2", producer, wallets, shares, 500, "https://example.com", wrongRegistry, address(0));
    }

    function test_setAuthorizedRegistry_onlyOwner() public {
        address notOwner = makeAddr("notOwner");
        vm.prank(notOwner);
        vm.expectRevert(CollectionFactory.NotOwner.selector);
        factory.setAuthorizedRegistry(registryAddr);
    }
}
