// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "forge-std/Test.sol";
import "../src/NFTMarket.sol";
import "../src/CollectionNFT.sol";
import "../src/ArtistsSplitter.sol";
import "../src/PaymentRegistry.sol";
import "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";

contract NFTMarketTest is Test {
    NFTMarket public vault;
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
        shares[0] = 5000; // 50%
        shares[1] = 3500; // 35%
        shares[2] = 1500; // 15%

        splitter = new ArtistsSplitter(producer, wallets, shares, address(registry));
        nft = new CollectionNFT("Heritage Art", "HART", address(splitter), 1000, producer, "https://example.com/collection", minter);
        vault = new NFTMarket(address(nft), payable(address(splitter)), producer, minter);

        vm.deal(buyer, 100 ether);
    }

    function test_constructor() public view {
        assertEq(address(vault.nftContract()), address(nft));
        assertEq(vault.splitter(), payable(address(splitter)));
        assertEq(vault.owner(), producer);
    }

    function test_setPrice() public {
        vm.prank(producer);
        uint256 tokenId = nft.mint(address(vault), "ipfs://QmTest");

        vm.prank(producer);
        vault.setPrice(tokenId, 1 ether);
        assertEq(vault.tokenPrice(tokenId), 1 ether);
    }

    function test_setPrice_onlyAuthorized() public {
        vm.prank(producer);
        uint256 tokenId = nft.mint(address(vault), "ipfs://QmTest");

        vm.prank(buyer);
        vm.expectRevert(NFTMarket.NotAuthorized.selector);
        vault.setPrice(tokenId, 1 ether);
    }

    function test_setPriceBatch() public {
        vm.startPrank(producer);
        uint256 t0 = nft.mint(address(vault), "ipfs://Qm1");
        uint256 t1 = nft.mint(address(vault), "ipfs://Qm2");
        uint256 t2 = nft.mint(address(vault), "ipfs://Qm3");
        vm.stopPrank();

        uint256[] memory tokenIds = new uint256[](3);
        tokenIds[0] = t0;
        tokenIds[1] = t1;
        tokenIds[2] = t2;

        uint256[] memory prices = new uint256[](3);
        prices[0] = 1 ether;
        prices[1] = 2 ether;
        prices[2] = 3 ether;

        vm.prank(producer);
        vault.setPriceBatch(tokenIds, prices);

        assertEq(vault.tokenPrice(t0), 1 ether);
        assertEq(vault.tokenPrice(t1), 2 ether);
        assertEq(vault.tokenPrice(t2), 3 ether);
    }

    function test_purchase() public {
        vm.prank(producer);
        uint256 tokenId = nft.mint(address(vault), "ipfs://QmTest");

        vm.prank(producer);
        vault.setPrice(tokenId, 1 ether);

        vm.prank(buyer);
        vault.purchase{value: 1 ether}(tokenId, 0);

        assertEq(nft.ownerOf(tokenId), buyer);

        // Funds pushed directly to beneficiaries via registry
        assertEq(artist.balance, 0.5 ether);
        assertEq(gallery.balance, 0.35 ether);
        assertEq(droitDeSuite.balance, 0.15 ether);
    }

    function test_purchase_insufficientPayment() public {
        vm.prank(producer);
        uint256 tokenId = nft.mint(address(vault), "ipfs://QmTest");

        vm.prank(producer);
        vault.setPrice(tokenId, 1 ether);

        vm.prank(buyer);
        vm.expectRevert(NFTMarket.InsufficientPayment.selector);
        vault.purchase{value: 0.5 ether}(tokenId, 0);
    }

    function test_purchase_notInVault() public {
        // Mint to buyer directly — setPrice should revert since token not in vault
        vm.prank(producer);
        uint256 tokenId = nft.mint(buyer, "ipfs://QmTest");

        vm.prank(producer);
        vm.expectRevert(NFTMarket.NotInVault.selector);
        vault.setPrice(tokenId, 1 ether);
    }

    function test_purchase_priceNotSet() public {
        vm.prank(producer);
        uint256 tokenId = nft.mint(address(vault), "ipfs://QmTest");

        vm.prank(buyer);
        vm.expectRevert(NFTMarket.PriceNotSet.selector);
        vault.purchase{value: 1 ether}(tokenId, 0);
    }

    function test_purchase_overpaymentRefund() public {
        vm.prank(producer);
        uint256 tokenId = nft.mint(address(vault), "ipfs://QmTest");

        vm.prank(producer);
        vault.setPrice(tokenId, 1 ether);

        uint256 buyerBalBefore = buyer.balance;

        vm.prank(buyer);
        vault.purchase{value: 3 ether}(tokenId, 0);

        assertEq(buyer.balance, buyerBalBefore - 1 ether);
        assertEq(nft.ownerOf(tokenId), buyer);
    }

    function test_listAvailableTokens() public {
        vm.startPrank(producer);
        nft.mint(address(vault), "ipfs://Qm1");
        nft.mint(address(vault), "ipfs://Qm2");
        nft.mint(address(vault), "ipfs://Qm3");

        vault.setPrice(0, 1 ether);
        vault.setPrice(1, 2 ether);
        vm.stopPrank();

        (uint256[] memory tokenIds, uint256[] memory prices) = vault.listAvailableTokens();
        assertEq(tokenIds.length, 3);
        assertEq(prices[0], 1 ether);
        assertEq(prices[1], 2 ether);
        assertEq(prices[2], 0);
    }

    function test_availableCount() public {
        assertEq(vault.availableCount(), 0);

        vm.startPrank(producer);
        nft.mint(address(vault), "ipfs://Qm1");
        assertEq(vault.availableCount(), 1);

        nft.mint(address(vault), "ipfs://Qm2");
        assertEq(vault.availableCount(), 2);
        vm.stopPrank();

        vm.prank(producer);
        vault.setPrice(0, 1 ether);

        vm.prank(buyer);
        vault.purchase{value: 1 ether}(0, 0);
        assertEq(vault.availableCount(), 1);
    }

    function test_purchase_clearsPriceAfterSale() public {
        vm.prank(producer);
        uint256 tokenId = nft.mint(address(vault), "ipfs://QmTest");

        vm.prank(producer);
        vault.setPrice(tokenId, 1 ether);

        vm.prank(buyer);
        vault.purchase{value: 1 ether}(tokenId, 0);

        // Price should be cleared after purchase
        assertEq(vault.tokenPrice(tokenId), 0);
    }

    // Test maxPrice edge cases — price exceeds max
    function test_purchase_revert_priceExceedsMax() public {
        vm.prank(producer);
        uint256 tokenId = nft.mint(address(vault), "ipfs://QmTest");

        vm.prank(producer);
        vault.setPrice(tokenId, 2 ether);

        vm.prank(buyer);
        vm.expectRevert(NFTMarket.PriceExceedsMax.selector);
        vault.purchase{value: 2 ether}(tokenId, 1 ether); // maxPrice < actual price
    }

    // Test maxPrice edge case — price equals max (should succeed)
    function test_purchase_priceEqualsMax() public {
        vm.prank(producer);
        uint256 tokenId = nft.mint(address(vault), "ipfs://QmTest");

        vm.prank(producer);
        vault.setPrice(tokenId, 1 ether);

        vm.prank(buyer);
        vault.purchase{value: 1 ether}(tokenId, 1 ether); // maxPrice == price, should succeed
        assertEq(nft.ownerOf(tokenId), buyer);
    }

    // Test maxPrice edge case — maxPrice=0 means no limit
    function test_purchase_maxPriceZero_noLimit() public {
        vm.prank(producer);
        uint256 tokenId = nft.mint(address(vault), "ipfs://QmTest");

        vm.prank(producer);
        vault.setPrice(tokenId, 5 ether);

        vm.prank(buyer);
        vault.purchase{value: 5 ether}(tokenId, 0); // maxPrice=0 = no limit
        assertEq(nft.ownerOf(tokenId), buyer);
    }

    // claimRefund with no pending refunds should revert
    function test_claimRefund_nothingToRefund() public {
        vm.prank(buyer);
        vm.expectRevert(NFTMarket.NothingToRefund.selector);
        vault.claimRefund();
    }

    // claimRefund emits RefundClaimed event
    function test_claimRefund_emitsEvent() public {
        // Create a scenario where a refund gets stored in pendingRefunds.
        // We need a buyer whose refund transfer fails. Use a contract that rejects ETH.
        RejectEther rejecter = new RejectEther();
        vm.deal(address(rejecter), 10 ether);

        // Mint, set price, purchase with overpayment from a contract that rejects refunds
        vm.prank(producer);
        uint256 tokenId = nft.mint(address(vault), "ipfs://QmTest");
        vm.prank(producer);
        vault.setPrice(tokenId, 1 ether);

        // Purchase from the rejecter — overpayment refund will fail, stored in pendingRefunds
        vm.prank(address(rejecter));
        vault.purchase{value: 3 ether}(tokenId, 0);

        // Verify pending refund exists
        assertEq(vault.pendingRefunds(address(rejecter)), 2 ether);

        // Now the rejecter enables receiving and claims the refund
        rejecter.setAccept(true);

        vm.prank(address(rejecter));
        vm.expectEmit(true, false, false, true);
        emit NFTMarket.RefundClaimed(address(rejecter), 2 ether);
        vault.claimRefund();

        assertEq(vault.pendingRefunds(address(rejecter)), 0);
    }

    // rescueETH success — send ETH to vault, rescue it, verify balance and event
    function test_rescueETH_success() public {
        // Send 5 ETH directly to the vault (simulating selfdestruct or stuck funds)
        vm.deal(address(vault), 5 ether);
        assertEq(address(vault).balance, 5 ether);

        address payable recipient = payable(makeAddr("rescueRecipient"));
        assertEq(recipient.balance, 0);

        vm.prank(producer);
        vm.expectEmit(true, false, false, true);
        emit NFTMarket.ETHRescued(recipient, 5 ether);
        vault.rescueETH(recipient);

        assertEq(address(vault).balance, 0);
        assertEq(recipient.balance, 5 ether);
    }

    // rescueETH when balance is 0 should revert with NothingToRescue
    function test_rescueETH_nothingToRescue() public {
        assertEq(address(vault).balance, 0);

        address payable recipient = payable(makeAddr("rescueRecipient"));

        vm.prank(producer);
        vm.expectRevert(NFTMarket.NothingToRescue.selector);
        vault.rescueETH(recipient);
    }

    // rescueETH from non-owner should revert with OnlyOwner
    function test_rescueETH_onlyOwner() public {
        vm.deal(address(vault), 1 ether);

        address payable recipient = payable(makeAddr("rescueRecipient"));

        vm.prank(buyer);
        vm.expectRevert(NFTMarket.OnlyOwner.selector);
        vault.rescueETH(recipient);
    }

    // setPriceBatch with 101 items should revert
    function test_setPriceBatch_tooLarge() public {
        // Mint 101 tokens to vault (in two batches)
        string[] memory uris100 = new string[](100);
        for (uint256 i = 0; i < 100; i++) {
            uris100[i] = "ipfs://QmTest";
        }
        vm.prank(producer);
        nft.mintBatch(address(vault), uris100);

        string[] memory uris1 = new string[](1);
        uris1[0] = "ipfs://QmTest";
        vm.prank(producer);
        nft.mintBatch(address(vault), uris1);

        uint256[] memory tokenIds = new uint256[](101);
        uint256[] memory prices = new uint256[](101);
        for (uint256 i = 0; i < 101; i++) {
            tokenIds[i] = i;
            prices[i] = 1 ether;
        }

        vm.prank(producer);
        vm.expectRevert("Batch too large");
        vault.setPriceBatch(tokenIds, prices);
    }

    // listAvailableTokens paginated — test offset/limit behavior
    function test_listAvailableTokens_paginated() public {
        // Mint 5 tokens to vault
        vm.startPrank(producer);
        for (uint256 i = 0; i < 5; i++) {
            nft.mint(address(vault), "ipfs://QmTest");
        }
        vm.stopPrank();

        // offset=0, limit=2 → returns first 2
        (uint256[] memory ids1, uint256[] memory prices1) = vault.listAvailableTokens(0, 2);
        assertEq(ids1.length, 2);
        assertEq(ids1[0], 0);
        assertEq(ids1[1], 1);

        // offset=2, limit=2 → returns next 2
        (uint256[] memory ids2, uint256[] memory prices2) = vault.listAvailableTokens(2, 2);
        assertEq(ids2.length, 2);
        assertEq(ids2[0], 2);
        assertEq(ids2[1], 3);

        // offset=10, limit=5 → past end, returns empty
        (uint256[] memory ids3, uint256[] memory prices3) = vault.listAvailableTokens(10, 5);
        assertEq(ids3.length, 0);
    }

    // claimRefund accumulation — multiple overpayments, single claimRefund
    function test_claimRefund_accumulation() public {
        RejectEther rejecter = new RejectEther();
        vm.deal(address(rejecter), 100 ether);

        // Mint 2 tokens and set prices
        vm.startPrank(producer);
        uint256 t0 = nft.mint(address(vault), "ipfs://Qm1");
        uint256 t1 = nft.mint(address(vault), "ipfs://Qm2");
        vault.setPrice(t0, 1 ether);
        vault.setPrice(t1, 2 ether);
        vm.stopPrank();

        // First overpayment: pay 3 ETH for 1 ETH token → 2 ETH excess
        vm.prank(address(rejecter));
        vault.purchase{value: 3 ether}(t0, 0);
        assertEq(vault.pendingRefunds(address(rejecter)), 2 ether);

        // Second overpayment: pay 5 ETH for 2 ETH token → 3 ETH excess
        vm.prank(address(rejecter));
        vault.purchase{value: 5 ether}(t1, 0);
        // Should accumulate: 2 + 3 = 5 ETH
        assertEq(vault.pendingRefunds(address(rejecter)), 5 ether);

        // Enable receiving and claim all at once
        rejecter.setAccept(true);
        uint256 balBefore = address(rejecter).balance;
        vm.prank(address(rejecter));
        vault.claimRefund();

        assertEq(vault.pendingRefunds(address(rejecter)), 0);
        assertEq(address(rejecter).balance, balBefore + 5 ether);
    }

    // rescueETH must not drain buyer pendingRefunds
    function test_rescueETH_cannotDrainPendingRefunds() public {
        RejectEther rejecter = new RejectEther();
        vm.deal(address(rejecter), 100 ether);

        // Mint token, set price, purchase with overpayment from contract that rejects refunds
        vm.prank(producer);
        uint256 tokenId = nft.mint(address(vault), "ipfs://QmTest");
        vm.prank(producer);
        vault.setPrice(tokenId, 1 ether);

        // Purchase: 3 ETH sent, 1 ETH price → 2 ETH excess stored in pendingRefunds
        vm.prank(address(rejecter));
        vault.purchase{value: 3 ether}(tokenId, 0);
        assertEq(vault.pendingRefunds(address(rejecter)), 2 ether);
        assertEq(vault.totalPendingRefunds(), 2 ether);

        // Vault balance should be exactly 2 ETH (the pending refund)
        assertEq(address(vault).balance, 2 ether);

        // rescueETH should revert — all balance is pending refunds, nothing to rescue
        address payable recipient = payable(makeAddr("rescueRecipient"));
        vm.prank(producer);
        vm.expectRevert(NFTMarket.NothingToRescue.selector);
        vault.rescueETH(recipient);

        // Send extra ETH to vault (simulating selfdestruct or stuck funds)
        vm.deal(address(vault), 5 ether); // 5 ETH total, but 2 ETH reserved

        // rescueETH should only rescue the non-reserved portion (5 - 2 = 3 ETH)
        vm.prank(producer);
        vault.rescueETH(recipient);
        assertEq(recipient.balance, 3 ether);

        // Vault should still have 2 ETH reserved for the pending refund
        assertEq(address(vault).balance, 2 ether);

        // Buyer can still claim their refund
        rejecter.setAccept(true);
        vm.prank(address(rejecter));
        vault.claimRefund();
        assertEq(vault.pendingRefunds(address(rejecter)), 0);
        assertEq(vault.totalPendingRefunds(), 0);
    }

    function test_fullPurchaseFlow() public {
        vm.prank(producer);
        uint256 tokenId = nft.mint(address(vault), "ipfs://QmArtwork");

        vm.prank(producer);
        vault.setPrice(tokenId, 10 ether);

        vm.prank(buyer);
        vault.purchase{value: 10 ether}(tokenId, 0);
        assertEq(nft.ownerOf(tokenId), buyer);

        // Funds pushed directly to beneficiaries via registry: 50%, 35%, 15%
        assertEq(artist.balance, 5 ether);
        assertEq(gallery.balance, 3.5 ether);
        assertEq(droitDeSuite.balance, 1.5 ether);
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
