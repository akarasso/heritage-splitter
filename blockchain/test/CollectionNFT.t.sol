// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "forge-std/Test.sol";
import "../src/CollectionNFT.sol";

contract CollectionNFTTest is Test {
    CollectionNFT public nft;
    address public owner = makeAddr("owner");
    address public splitter = makeAddr("splitter");
    address public user = makeAddr("user");
    address public minter = makeAddr("minter");

    function setUp() public {
        nft = new CollectionNFT("Heritage Art", "HART", splitter, 1000, owner, "https://example.com/collection", minter);
    }

    function test_constructor() public view {
        assertEq(nft.name(), "Heritage Art");
        assertEq(nft.symbol(), "HART");
        assertEq(nft.splitter(), splitter);
        assertEq(nft.owner(), owner);
    }

    function test_mint() public {
        vm.prank(owner);
        uint256 tokenId = nft.mint(user, "ipfs://QmTest");

        assertEq(tokenId, 0);
        assertEq(nft.ownerOf(0), user);
        assertEq(nft.tokenURI(0), "ipfs://QmTest");
    }

    function test_mintBatch() public {
        string[] memory uris = new string[](3);
        uris[0] = "ipfs://Qm1";
        uris[1] = "ipfs://Qm2";
        uris[2] = "ipfs://Qm3";

        vm.prank(owner);
        uint256[] memory ids = nft.mintBatch(user, uris);

        assertEq(ids.length, 3);
        assertEq(ids[0], 0);
        assertEq(ids[1], 1);
        assertEq(ids[2], 2);
        assertEq(nft.ownerOf(0), user);
        assertEq(nft.ownerOf(2), user);
        assertEq(nft.totalSupply(), 3);
    }

    function test_mint_onlyOwner() public {
        vm.prank(user);
        vm.expectRevert();
        nft.mint(user, "ipfs://QmTest");
    }

    function test_royaltyInfo() public view {
        (address receiver, uint256 amount) = nft.royaltyInfo(0, 10000);
        assertEq(receiver, splitter);
        assertEq(amount, 1000); // 10%
    }

    function test_supportsInterface() public view {
        // ERC-721
        assertTrue(nft.supportsInterface(0x80ac58cd));
        // ERC-2981
        assertTrue(nft.supportsInterface(0x2a55205a));
    }

    function test_transferFrom_works() public {
        vm.prank(owner);
        uint256 tokenId = nft.mint(user, "ipfs://QmTest");

        address buyer = makeAddr("buyer");
        vm.prank(user);
        nft.transferFrom(user, buyer, tokenId);
        assertEq(nft.ownerOf(tokenId), buyer);
    }

    function test_enumerable() public {
        string[] memory uris = new string[](3);
        uris[0] = "ipfs://Qm1";
        uris[1] = "ipfs://Qm2";
        uris[2] = "ipfs://Qm3";

        vm.prank(owner);
        nft.mintBatch(user, uris);

        // totalSupply
        assertEq(nft.totalSupply(), 3);

        // tokenByIndex
        assertEq(nft.tokenByIndex(0), 0);
        assertEq(nft.tokenByIndex(1), 1);
        assertEq(nft.tokenByIndex(2), 2);

        // tokenOfOwnerByIndex
        assertEq(nft.tokenOfOwnerByIndex(user, 0), 0);
        assertEq(nft.tokenOfOwnerByIndex(user, 1), 1);
        assertEq(nft.tokenOfOwnerByIndex(user, 2), 2);
    }

    function test_enumerable_interface() public view {
        // ERC721Enumerable interface id = 0x780e9d63
        assertTrue(nft.supportsInterface(0x780e9d63));
    }

    function test_contractURI() public view {
        assertEq(nft.contractURI(), "https://example.com/collection");
    }

    // burnBatch success — mint 3 tokens, burn all 3, verify totalSupply is 0
    function test_burnBatch_success() public {
        string[] memory uris = new string[](3);
        uris[0] = "ipfs://Qm1";
        uris[1] = "ipfs://Qm2";
        uris[2] = "ipfs://Qm3";

        vm.prank(owner);
        uint256[] memory ids = nft.mintBatch(user, uris);

        assertEq(nft.totalSupply(), 3);

        vm.prank(user);
        nft.burnBatch(ids);

        assertEq(nft.totalSupply(), 0);
    }

    // mintBatch with 101 URIs should revert
    function test_mintBatch_tooLarge() public {
        string[] memory uris = new string[](101);
        for (uint256 i = 0; i < 101; i++) {
            uris[i] = "ipfs://QmTest";
        }
        vm.prank(owner);
        vm.expectRevert("Batch too large");
        nft.mintBatch(user, uris);
    }

    // burnBatch with 101 tokenIds should revert
    function test_burnBatch_tooLarge() public {
        // First mint 101 tokens (in two batches since mintBatch is capped at 100)
        string[] memory uris100 = new string[](100);
        for (uint256 i = 0; i < 100; i++) {
            uris100[i] = "ipfs://QmTest";
        }
        vm.prank(owner);
        nft.mintBatch(user, uris100);

        string[] memory uris1 = new string[](1);
        uris1[0] = "ipfs://QmTest";
        vm.prank(owner);
        nft.mintBatch(user, uris1);

        uint256[] memory ids = new uint256[](101);
        for (uint256 i = 0; i < 101; i++) {
            ids[i] = i;
        }
        vm.prank(user);
        vm.expectRevert("Batch too large");
        nft.burnBatch(ids);
    }

    // test revokeMinter — mint succeeds, then revoke, then mint reverts
    function test_revokeMinter() public {
        vm.prank(minter);
        nft.mint(user, "ipfs://QmTest");
        assertEq(nft.ownerOf(0), user);

        vm.prank(owner);
        nft.revokeMinter();

        vm.prank(minter);
        vm.expectRevert(CollectionNFT.NotAuthorized.selector);
        nft.mint(user, "ipfs://QmTest2");
    }

    // burnBatch reverts if caller doesn't own all tokens
    function test_burnBatch_notOwner_reverts() public {
        address other = makeAddr("other");

        // Mint token 0 to user, token 1 to other
        vm.prank(owner);
        nft.mint(user, "ipfs://Qm1");
        vm.prank(owner);
        nft.mint(other, "ipfs://Qm2");

        uint256[] memory ids = new uint256[](2);
        ids[0] = 0;
        ids[1] = 1;

        // user tries to burn both — should revert on token 1
        vm.prank(user);
        vm.expectRevert(CollectionNFT.NotTokenOwner.selector);
        nft.burnBatch(ids);
    }
}
