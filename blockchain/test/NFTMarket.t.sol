// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "forge-std/Test.sol";
import "../src/NFTMarket.sol";
import "../src/CollectionNFT.sol";
import "../src/ArtistsSplitter.sol";
import "../src/PaymentRegistry.sol";
import "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";

contract NFTMarketTest is Test {
    NFTMarket public market;
    CollectionNFT public nft;
    ArtistsSplitter public splitter;
    PaymentRegistry public registry;

    address public producer = makeAddr("producer");
    address payable public artist = payable(makeAddr("artist"));
    address payable public gallery = payable(makeAddr("gallery"));
    address payable public droitDeSuite = payable(makeAddr("droitDeSuite"));

    address public minter = makeAddr("minter");
    address public buyer = makeAddr("buyer");

    function setUp() public {
        // Deploy registry behind proxy
        PaymentRegistry impl = new PaymentRegistry();
        bytes memory initData = abi.encodeCall(PaymentRegistry.initialize, (address(this)));
        TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(address(impl), address(this), initData);
        registry = PaymentRegistry(payable(address(proxy)));

        address[] memory wallets = new address[](3);
        wallets[0] = artist;
        wallets[1] = gallery;
        wallets[2] = droitDeSuite;

        uint256[] memory shares = new uint256[](3);
        shares[0] = 5000;
        shares[1] = 3500;
        shares[2] = 1500;

        splitter = new ArtistsSplitter(producer, wallets, shares, address(registry));
        nft = new CollectionNFT("Heritage Art", "HART", address(splitter), 1000, producer, "https://example.com/collection", minter);
        market = new NFTMarket(producer, minter);

        vm.deal(buyer, 100 ether);
    }

    /// @dev Helper: mint an NFT to producer, approve market, list it
    function _mintAndList(uint256 price) internal returns (uint256 listingId) {
        vm.prank(producer);
        uint256 tokenId = nft.mint(producer, "ipfs://QmTest");

        vm.startPrank(producer);
        nft.approve(address(market), tokenId);
        listingId = market.list(address(nft), tokenId, price);
        vm.stopPrank();
    }

    function test_constructor() public view {
        assertEq(market.owner(), producer);
        assertEq(market.minter(), minter);
    }

    function test_list() public {
        uint256 listingId = _mintAndList(1 ether);

        assertEq(listingId, 0);
        assertEq(market.listingCount(), 1);
        assertEq(market.availableCount(), 1);

        // NFT should be held by market
        assertEq(nft.ownerOf(0), address(market));
    }

    function test_list_onlyAuthorized() public {
        vm.prank(producer);
        uint256 tokenId = nft.mint(buyer, "ipfs://QmTest");

        vm.prank(buyer);
        vm.expectRevert(NFTMarket.NotAuthorized.selector);
        market.list(address(nft), tokenId, 1 ether);
    }

    function test_list_alreadyListed() public {
        _mintAndList(1 ether);

        // Try to list the same NFT again (it's already in the market)
        vm.prank(producer);
        vm.expectRevert(NFTMarket.AlreadyListed.selector);
        market.list(address(nft), 0, 2 ether);
    }

    function test_delist() public {
        _mintAndList(1 ether);

        vm.prank(producer);
        market.delist(0);

        assertEq(market.availableCount(), 0);
        // NFT returned to seller (producer)
        assertEq(nft.ownerOf(0), producer);
    }

    function test_setPrice() public {
        _mintAndList(1 ether);

        vm.prank(producer);
        market.setPrice(0, 2 ether);

        (,, uint256 price,,) = market.listings(0);
        assertEq(price, 2 ether);
    }

    function test_setPrice_onlyAuthorized() public {
        _mintAndList(1 ether);

        vm.prank(buyer);
        vm.expectRevert(NFTMarket.NotAuthorized.selector);
        market.setPrice(0, 2 ether);
    }

    function test_purchase() public {
        _mintAndList(1 ether);

        vm.prank(buyer);
        market.purchase{value: 1 ether}(0);

        assertEq(nft.ownerOf(0), buyer);
        assertEq(market.availableCount(), 0);

        // Funds pushed to beneficiaries via splitter: 50%, 35%, 15%
        assertEq(artist.balance, 0.5 ether);
        assertEq(gallery.balance, 0.35 ether);
        assertEq(droitDeSuite.balance, 0.15 ether);
    }

    function test_purchaseFor() public {
        _mintAndList(1 ether);
        address recipient = makeAddr("recipient");

        // purchaseFor is open — no allowedCallers check needed
        vm.prank(buyer);
        market.purchaseFor{value: 1 ether}(0, recipient);

        // NFT goes to recipient, not buyer
        assertEq(nft.ownerOf(0), recipient);
    }

    function test_purchase_insufficientPayment() public {
        _mintAndList(1 ether);

        vm.prank(buyer);
        vm.expectRevert(NFTMarket.InsufficientPayment.selector);
        market.purchase{value: 0.5 ether}(0);
    }

    function test_purchase_listingNotActive() public {
        _mintAndList(1 ether);

        // Delist first
        vm.prank(producer);
        market.delist(0);

        vm.prank(buyer);
        vm.expectRevert(NFTMarket.ListingNotActive.selector);
        market.purchase{value: 1 ether}(0);
    }

    function test_purchase_overpaymentRefund() public {
        _mintAndList(1 ether);

        uint256 buyerBalBefore = buyer.balance;

        vm.prank(buyer);
        market.purchase{value: 3 ether}(0);

        assertEq(buyer.balance, buyerBalBefore - 1 ether);
        assertEq(nft.ownerOf(0), buyer);
    }

    function test_listBatch() public {
        // Mint 3 NFTs and approve market
        vm.startPrank(producer);
        nft.mint(producer, "ipfs://Qm1");
        nft.mint(producer, "ipfs://Qm2");
        nft.mint(producer, "ipfs://Qm3");
        nft.setApprovalForAll(address(market), true);
        vm.stopPrank();

        address[] memory nfts = new address[](3);
        nfts[0] = address(nft);
        nfts[1] = address(nft);
        nfts[2] = address(nft);

        uint256[] memory tokenIds = new uint256[](3);
        tokenIds[0] = 0;
        tokenIds[1] = 1;
        tokenIds[2] = 2;

        uint256[] memory prices = new uint256[](3);
        prices[0] = 1 ether;
        prices[1] = 2 ether;
        prices[2] = 3 ether;

        vm.prank(producer);
        uint256[] memory listingIds = market.listBatch(nfts, tokenIds, prices);

        assertEq(listingIds.length, 3);
        assertEq(market.availableCount(), 3);
    }

    function test_listAvailable() public {
        _mintAndList(1 ether);
        _mintAndList(2 ether);
        _mintAndList(3 ether);

        NFTMarket.Listing[] memory available = market.listAvailable(0, 10);
        assertEq(available.length, 3);
        assertEq(available[0].price, 1 ether);
        assertEq(available[1].price, 2 ether);
        assertEq(available[2].price, 3 ether);
    }

    function test_listAvailable_paginated() public {
        _mintAndList(1 ether);
        _mintAndList(2 ether);
        _mintAndList(3 ether);
        _mintAndList(4 ether);
        _mintAndList(5 ether);

        // offset=0, limit=2
        NFTMarket.Listing[] memory page1 = market.listAvailable(0, 2);
        assertEq(page1.length, 2);
        assertEq(page1[0].price, 1 ether);
        assertEq(page1[1].price, 2 ether);

        // offset=2, limit=2
        NFTMarket.Listing[] memory page2 = market.listAvailable(2, 2);
        assertEq(page2.length, 2);
        assertEq(page2[0].price, 3 ether);
        assertEq(page2[1].price, 4 ether);

        // offset past end
        NFTMarket.Listing[] memory page3 = market.listAvailable(10, 5);
        assertEq(page3.length, 0);
    }

    function test_availableCount() public {
        assertEq(market.availableCount(), 0);

        _mintAndList(1 ether);
        assertEq(market.availableCount(), 1);

        _mintAndList(2 ether);
        assertEq(market.availableCount(), 2);

        // Purchase one
        vm.prank(buyer);
        market.purchase{value: 1 ether}(0);
        assertEq(market.availableCount(), 1);
    }

    function test_multiCollection() public {
        // Create a second NFT collection
        CollectionNFT nft2 = new CollectionNFT("Second Art", "SART", address(splitter), 500, producer, "https://example.com/col2", address(0));

        // Mint from both collections and list on same market
        vm.startPrank(producer);
        nft.mint(producer, "ipfs://col1-1");
        nft2.mint(producer, "ipfs://col2-1");

        nft.approve(address(market), 0);
        nft2.approve(address(market), 0);

        market.list(address(nft), 0, 1 ether);
        market.list(address(nft2), 0, 2 ether);
        vm.stopPrank();

        assertEq(market.availableCount(), 2);

        // Buy from collection 2
        vm.prank(buyer);
        market.purchase{value: 2 ether}(1);
        assertEq(nft2.ownerOf(0), buyer);
        assertEq(market.availableCount(), 1);
    }

    function test_claimRefund_nothingToRefund() public {
        vm.prank(buyer);
        vm.expectRevert(NFTMarket.NothingToRefund.selector);
        market.claimRefund();
    }

    function test_claimRefund_emitsEvent() public {
        RejectEther rejecter = new RejectEther();
        vm.deal(address(rejecter), 10 ether);

        _mintAndList(1 ether);

        // Purchase from rejecter — overpayment refund will fail
        vm.prank(address(rejecter));
        market.purchase{value: 3 ether}(0);

        assertEq(market.pendingRefunds(address(rejecter)), 2 ether);

        // Now enable receiving and claim
        rejecter.setAccept(true);

        vm.prank(address(rejecter));
        vm.expectEmit(true, false, false, true);
        emit NFTMarket.RefundClaimed(address(rejecter), 2 ether);
        market.claimRefund();

        assertEq(market.pendingRefunds(address(rejecter)), 0);
    }

    function test_rescueETH_success() public {
        vm.deal(address(market), 5 ether);

        address payable recipient = payable(makeAddr("rescueRecipient"));

        vm.prank(producer);
        vm.expectEmit(true, false, false, true);
        emit NFTMarket.ETHRescued(recipient, 5 ether);
        market.rescueETH(recipient);

        assertEq(address(market).balance, 0);
        assertEq(recipient.balance, 5 ether);
    }

    function test_rescueETH_nothingToRescue() public {
        address payable recipient = payable(makeAddr("rescueRecipient"));

        vm.prank(producer);
        vm.expectRevert(NFTMarket.NothingToRescue.selector);
        market.rescueETH(recipient);
    }

    function test_rescueETH_onlyOwner() public {
        vm.deal(address(market), 1 ether);
        address payable recipient = payable(makeAddr("rescueRecipient"));

        vm.prank(buyer);
        vm.expectRevert(NFTMarket.OnlyOwner.selector);
        market.rescueETH(recipient);
    }

    function test_rescueETH_cannotDrainPendingRefunds() public {
        RejectEther rejecter = new RejectEther();
        vm.deal(address(rejecter), 100 ether);

        _mintAndList(1 ether);

        // Purchase with overpayment from contract that rejects refunds
        vm.prank(address(rejecter));
        market.purchase{value: 3 ether}(0);
        assertEq(market.pendingRefunds(address(rejecter)), 2 ether);
        assertEq(market.totalPendingRefunds(), 2 ether);

        // Market balance = 2 ETH (pending refund)
        assertEq(address(market).balance, 2 ether);

        // rescueETH should revert — all balance is pending refunds
        address payable recipient = payable(makeAddr("rescueRecipient"));
        vm.prank(producer);
        vm.expectRevert(NFTMarket.NothingToRescue.selector);
        market.rescueETH(recipient);

        // Send extra ETH
        vm.deal(address(market), 5 ether);

        // Should only rescue non-reserved portion (5 - 2 = 3 ETH)
        vm.prank(producer);
        market.rescueETH(recipient);
        assertEq(recipient.balance, 3 ether);
        assertEq(address(market).balance, 2 ether);

        // Buyer can still claim
        rejecter.setAccept(true);
        vm.prank(address(rejecter));
        market.claimRefund();
        assertEq(market.totalPendingRefunds(), 0);
    }

    function test_fullPurchaseFlow() public {
        _mintAndList(10 ether);

        vm.prank(buyer);
        market.purchase{value: 10 ether}(0);
        assertEq(nft.ownerOf(0), buyer);

        // Funds pushed to beneficiaries: 50%, 35%, 15%
        assertEq(artist.balance, 5 ether);
        assertEq(gallery.balance, 3.5 ether);
        assertEq(droitDeSuite.balance, 1.5 ether);
    }

    function test_minterCanList() public {
        vm.prank(producer);
        nft.mint(minter, "ipfs://QmTest");

        vm.startPrank(minter);
        nft.approve(address(market), 0);
        market.list(address(nft), 0, 1 ether);
        vm.stopPrank();

        assertEq(market.availableCount(), 1);
    }

    function test_minterCanSetPrice() public {
        _mintAndList(1 ether);

        vm.prank(minter);
        market.setPrice(0, 5 ether);

        (,, uint256 price,,) = market.listings(0);
        assertEq(price, 5 ether);
    }
}

/// @dev Helper contract that rejects ETH by default, can be toggled to accept.
///      Implements IERC721Receiver so it can receive NFTs via safeTransferFrom.
contract RejectEther is IERC721Receiver {
    bool public acceptEther;

    function setAccept(bool _accept) external {
        acceptEther = _accept;
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {
        if (!acceptEther) revert("rejected");
    }
}
