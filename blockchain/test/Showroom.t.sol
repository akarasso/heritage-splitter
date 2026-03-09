// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "forge-std/Test.sol";
import "../src/Showroom.sol";
import "../src/NFTMarket.sol";
import "../src/CollectionNFT.sol";
import "../src/ArtistsSplitter.sol";
import "../src/PaymentRegistry.sol";
import "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";

contract ShowroomTest is Test {
    Showroom public showroom;
    NFTMarket public market;
    CollectionNFT public nft;
    ArtistsSplitter public splitter;
    PaymentRegistry public registry;

    address public producer = makeAddr("producer");
    address payable public artist = payable(makeAddr("artist"));
    address payable public gallery = payable(makeAddr("gallery"));
    address public shopOwner = makeAddr("shopOwner");
    address public backendDeployer = makeAddr("backendDeployer");
    address public buyer = makeAddr("buyer");

    function setUp() public {
        PaymentRegistry impl = new PaymentRegistry();
        bytes memory initData = abi.encodeCall(PaymentRegistry.initialize, (address(this)));
        TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(address(impl), address(this), initData);
        registry = PaymentRegistry(payable(address(proxy)));

        address[] memory wallets = new address[](2);
        wallets[0] = artist;
        wallets[1] = gallery;
        uint256[] memory shares = new uint256[](2);
        shares[0] = 6000;
        shares[1] = 4000;

        splitter = new ArtistsSplitter(producer, wallets, shares, address(registry));
        nft = new CollectionNFT("Art", "ART", address(splitter), 1000, producer, "https://example.com", address(0));
        market = new NFTMarket(producer, address(0));
        showroom = new Showroom(shopOwner, backendDeployer, address(registry));

        vm.deal(buyer, 100 ether);
    }

    function _listOnMarket(uint256 price) internal returns (uint256 listingId, uint256 tokenId) {
        vm.startPrank(producer);
        tokenId = nft.mint(producer, "ipfs://QmTest");
        nft.approve(address(market), tokenId);
        listingId = market.list(address(nft), tokenId, price);
        vm.stopPrank();
    }

    // ── Constructor ────────────────────────────────────────────

    function test_constructor() public view {
        assertEq(showroom.owner(), shopOwner);
        assertEq(showroom.deployer(), backendDeployer);
        assertEq(address(showroom.registry()), address(registry));
        assertEq(showroom.itemCount(), 0);
    }

    // ── addItem keyed by (nft, tokenId) ────────────────────────

    function test_addItem_byOwner() public {
        (uint256 lid, uint256 tid) = _listOnMarket(1 ether);

        vm.prank(shopOwner);
        showroom.addItem(address(nft), tid, address(market), lid, 0.1 ether);

        assertEq(showroom.itemCount(), 1);
        (address m, uint256 mlid, uint256 margin, bool active) = showroom.getItem(address(nft), tid);
        assertEq(m, address(market));
        assertEq(mlid, lid);
        assertEq(margin, 0.1 ether);
        assertTrue(active);
    }

    function test_addItem_byDeployer() public {
        (uint256 lid, uint256 tid) = _listOnMarket(1 ether);

        vm.prank(backendDeployer);
        showroom.addItem(address(nft), tid, address(market), lid, 0.1 ether);

        assertEq(showroom.itemCount(), 1);
    }

    function test_addItem_revertUnauthorized() public {
        (uint256 lid, uint256 tid) = _listOnMarket(1 ether);

        vm.prank(buyer);
        vm.expectRevert(Showroom.OnlyOwnerOrDeployer.selector);
        showroom.addItem(address(nft), tid, address(market), lid, 0.1 ether);
    }

    function test_addItem_revertAlreadyListed() public {
        (uint256 lid, uint256 tid) = _listOnMarket(1 ether);

        vm.prank(shopOwner);
        showroom.addItem(address(nft), tid, address(market), lid, 0.1 ether);

        vm.prank(shopOwner);
        vm.expectRevert(Showroom.AlreadyListed.selector);
        showroom.addItem(address(nft), tid, address(market), lid, 0.2 ether);
    }

    // ── addItemBatch ───────────────────────────────────────────

    function test_addItemBatch() public {
        (uint256 lid1, uint256 tid1) = _listOnMarket(1 ether);
        (uint256 lid2, uint256 tid2) = _listOnMarket(2 ether);

        address[] memory nfts = new address[](2);
        nfts[0] = address(nft); nfts[1] = address(nft);
        uint256[] memory tids = new uint256[](2);
        tids[0] = tid1; tids[1] = tid2;
        address[] memory mkts = new address[](2);
        mkts[0] = address(market); mkts[1] = address(market);
        uint256[] memory lids = new uint256[](2);
        lids[0] = lid1; lids[1] = lid2;
        uint256[] memory margins = new uint256[](2);
        margins[0] = 0.1 ether; margins[1] = 0.2 ether;

        vm.prank(backendDeployer);
        showroom.addItemBatch(nfts, tids, mkts, lids, margins);

        assertEq(showroom.itemCount(), 2);
        (, , uint256 m1, ) = showroom.getItem(address(nft), tid1);
        (, , uint256 m2, ) = showroom.getItem(address(nft), tid2);
        assertEq(m1, 0.1 ether);
        assertEq(m2, 0.2 ether);
    }

    // ── setMargin by (nft, tokenId) ────────────────────────────

    function test_setMargin() public {
        (uint256 lid, uint256 tid) = _listOnMarket(1 ether);

        vm.prank(shopOwner);
        showroom.addItem(address(nft), tid, address(market), lid, 0.1 ether);

        vm.prank(backendDeployer);
        showroom.setMargin(address(nft), tid, 0.5 ether);

        (, , uint256 margin, ) = showroom.getItem(address(nft), tid);
        assertEq(margin, 0.5 ether);
    }

    function test_setMargin_revertNotFound() public {
        vm.prank(shopOwner);
        vm.expectRevert(Showroom.ItemNotFound.selector);
        showroom.setMargin(address(nft), 999, 0.1 ether);
    }

    // ── setMarginBatch ─────────────────────────────────────────

    function test_setMarginBatch() public {
        (uint256 lid1, uint256 tid1) = _listOnMarket(1 ether);
        (uint256 lid2, uint256 tid2) = _listOnMarket(2 ether);

        vm.startPrank(shopOwner);
        showroom.addItem(address(nft), tid1, address(market), lid1, 0.1 ether);
        showroom.addItem(address(nft), tid2, address(market), lid2, 0.1 ether);
        vm.stopPrank();

        address[] memory nfts = new address[](2);
        nfts[0] = address(nft); nfts[1] = address(nft);
        uint256[] memory tids = new uint256[](2);
        tids[0] = tid1; tids[1] = tid2;
        uint256[] memory margins = new uint256[](2);
        margins[0] = 0.3 ether; margins[1] = 0.4 ether;

        vm.prank(backendDeployer);
        showroom.setMarginBatch(nfts, tids, margins);

        (, , uint256 m1, ) = showroom.getItem(address(nft), tid1);
        (, , uint256 m2, ) = showroom.getItem(address(nft), tid2);
        assertEq(m1, 0.3 ether);
        assertEq(m2, 0.4 ether);
    }

    // ── removeItem ─────────────────────────────────────────────

    function test_removeItem() public {
        (uint256 lid, uint256 tid) = _listOnMarket(1 ether);

        vm.prank(shopOwner);
        showroom.addItem(address(nft), tid, address(market), lid, 0.1 ether);

        vm.prank(backendDeployer);
        showroom.removeItem(address(nft), tid);

        vm.expectRevert(Showroom.ItemNotFound.selector);
        showroom.getItem(address(nft), tid);
    }

    function test_removeItem_allowsReAdd() public {
        (uint256 lid, uint256 tid) = _listOnMarket(1 ether);

        vm.prank(shopOwner);
        showroom.addItem(address(nft), tid, address(market), lid, 0.1 ether);

        vm.prank(shopOwner);
        showroom.removeItem(address(nft), tid);

        // Can re-add after removal
        vm.prank(shopOwner);
        showroom.addItem(address(nft), tid, address(market), lid, 0.2 ether);

        (, , uint256 margin, bool active) = showroom.getItem(address(nft), tid);
        assertEq(margin, 0.2 ether);
        assertTrue(active);
    }

    // ── removeItemBatch ────────────────────────────────────────

    function test_removeItemBatch() public {
        (uint256 lid1, uint256 tid1) = _listOnMarket(1 ether);
        (uint256 lid2, uint256 tid2) = _listOnMarket(2 ether);

        vm.startPrank(shopOwner);
        showroom.addItem(address(nft), tid1, address(market), lid1, 0.1 ether);
        showroom.addItem(address(nft), tid2, address(market), lid2, 0.2 ether);
        vm.stopPrank();

        address[] memory nfts = new address[](2);
        nfts[0] = address(nft); nfts[1] = address(nft);
        uint256[] memory tids = new uint256[](2);
        tids[0] = tid1; tids[1] = tid2;

        vm.prank(backendDeployer);
        showroom.removeItemBatch(nfts, tids);

        vm.expectRevert(Showroom.ItemNotFound.selector);
        showroom.getItem(address(nft), tid1);
        vm.expectRevert(Showroom.ItemNotFound.selector);
        showroom.getItem(address(nft), tid2);
    }

    // ── purchase by (nft, tokenId) ─────────────────────────────

    function test_purchase() public {
        (uint256 lid, uint256 tid) = _listOnMarket(1 ether);

        vm.prank(shopOwner);
        showroom.addItem(address(nft), tid, address(market), lid, 0.2 ether);

        uint256 buyerBalBefore = buyer.balance;
        uint256 shopBalBefore = shopOwner.balance;

        vm.prank(buyer);
        showroom.purchase{value: 1.2 ether}(address(nft), tid);

        assertEq(nft.ownerOf(tid), buyer);
        assertEq(buyer.balance, buyerBalBefore - 1.2 ether);
        // Margin sent to producer via PaymentRegistry (push-first)
        assertEq(shopOwner.balance, shopBalBefore + 0.2 ether);
        // Artists get their shares via splitter → registry
        assertEq(artist.balance, 0.6 ether);
        assertEq(gallery.balance, 0.4 ether);
    }

    function test_purchase_insufficientPayment() public {
        (uint256 lid, uint256 tid) = _listOnMarket(1 ether);

        vm.prank(shopOwner);
        showroom.addItem(address(nft), tid, address(market), lid, 0.2 ether);

        vm.prank(buyer);
        vm.expectRevert(Showroom.InsufficientPayment.selector);
        showroom.purchase{value: 1 ether}(address(nft), tid);
    }

    function test_purchase_overpaymentRefund() public {
        (uint256 lid, uint256 tid) = _listOnMarket(1 ether);

        vm.prank(shopOwner);
        showroom.addItem(address(nft), tid, address(market), lid, 0.2 ether);

        uint256 buyerBalBefore = buyer.balance;

        vm.prank(buyer);
        showroom.purchase{value: 2 ether}(address(nft), tid);

        assertEq(buyer.balance, buyerBalBefore - 1.2 ether);
    }

    function test_purchase_itemNotActive() public {
        (uint256 lid, uint256 tid) = _listOnMarket(1 ether);

        vm.prank(shopOwner);
        showroom.addItem(address(nft), tid, address(market), lid, 0.2 ether);

        vm.prank(shopOwner);
        showroom.removeItem(address(nft), tid);

        vm.prank(buyer);
        vm.expectRevert(Showroom.ItemNotFound.selector);
        showroom.purchase{value: 1.2 ether}(address(nft), tid);
    }

    function test_purchase_zeroMargin() public {
        (uint256 lid, uint256 tid) = _listOnMarket(1 ether);

        vm.prank(shopOwner);
        showroom.addItem(address(nft), tid, address(market), lid, 0);

        vm.prank(buyer);
        showroom.purchase{value: 1 ether}(address(nft), tid);

        assertEq(nft.ownerOf(tid), buyer);
    }

    function test_purchase_marginDeferredWhenOwnerRejects() public {
        // When owner can't receive ETH, registry defers the payment
        RejectingOwner rejector = new RejectingOwner();
        Showroom rejectorShowroom = new Showroom(address(rejector), backendDeployer, address(registry));

        (uint256 lid, uint256 tid) = _listOnMarket(1 ether);

        vm.prank(address(rejector));
        rejectorShowroom.addItem(address(nft), tid, address(market), lid, 0.2 ether);

        vm.prank(buyer);
        rejectorShowroom.purchase{value: 1.2 ether}(address(nft), tid);

        assertEq(nft.ownerOf(tid), buyer);
        // Margin is deferred in the registry (push failed, pull available)
        assertEq(registry.pendingWithdrawals(address(rejector)), 0.2 ether);

        // Owner can withdraw from registry later
        rejector.setAccept(true);
        vm.prank(address(rejector));
        registry.withdraw();
        assertEq(address(rejector).balance, 0.2 ether);
    }

    // ── listAvailable ──────────────────────────────────────────

    function test_listAvailable() public {
        (uint256 lid1, uint256 tid1) = _listOnMarket(1 ether);
        (uint256 lid2, uint256 tid2) = _listOnMarket(2 ether);

        vm.startPrank(shopOwner);
        showroom.addItem(address(nft), tid1, address(market), lid1, 0.1 ether);
        showroom.addItem(address(nft), tid2, address(market), lid2, 0.2 ether);
        vm.stopPrank();

        (
            address[] memory nftContracts,
            uint256[] memory tokenIds,
            ,
            ,
            uint256[] memory mrgns,
            uint256[] memory bps
        ) = showroom.listAvailable();

        assertEq(nftContracts.length, 2);
        assertEq(nftContracts[0], address(nft));
        assertEq(tokenIds[0], tid1);
        assertEq(bps[0], 1 ether);
        assertEq(bps[1], 2 ether);
        assertEq(mrgns[0], 0.1 ether);
        assertEq(mrgns[1], 0.2 ether);
    }

    // ── Ownership ──────────────────────────────────────────────

    function test_transferOwnership() public {
        address newOwner = makeAddr("newOwner");

        vm.prank(shopOwner);
        showroom.transferOwnership(newOwner);

        vm.prank(newOwner);
        showroom.acceptOwnership();

        assertEq(showroom.owner(), newOwner);
    }

    function test_setDeployer() public {
        address newDeployer = makeAddr("newDeployer");

        vm.prank(shopOwner);
        showroom.setDeployer(newDeployer);

        assertEq(showroom.deployer(), newDeployer);
    }

    function test_revokeDeployer() public {
        vm.prank(shopOwner);
        showroom.revokeDeployer();

        assertEq(showroom.deployer(), address(0));
    }
}

/// Helper: contract that rejects ETH by default, can be toggled
contract RejectingOwner {
    bool public acceptETH;

    function setAccept(bool v) external { acceptETH = v; }

    receive() external payable {
        require(acceptETH, "rejected");
    }
}
