// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "forge-std/Test.sol";
import "../src/DocumentRegistry.sol";

contract DocumentRegistryTest is Test {
    DocumentRegistry registry;
    uint256 ownerKey = 0xA11CE;
    uint256 certifierKey = 0xB0B;
    address owner;
    address certifier;

    function setUp() public {
        owner = vm.addr(ownerKey);
        certifier = vm.addr(certifierKey);
        vm.prank(owner);
        registry = new DocumentRegistry();
    }

    function test_certify_legacy() public {
        bytes32 hash = keccak256("test document");
        vm.prank(owner);
        registry.certify(hash);

        assertGt(registry.getCertification(hash), 0);
        assertEq(registry.certifiers(hash), owner);
    }

    function test_certify_legacy_revert_not_owner() public {
        bytes32 hash = keccak256("test document");
        vm.prank(certifier);
        vm.expectRevert(DocumentRegistry.NotOwner.selector);
        registry.certify(hash);
    }

    function test_certifyFor() public {
        bytes32 hash = keccak256("test document for meta-tx");
        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce = registry.nonces(certifier);

        // Build EIP-712 digest
        bytes32 structHash = keccak256(
            abi.encode(
                registry.CERTIFY_TYPEHASH(),
                hash,
                certifier,
                nonce,
                deadline
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", registry.DOMAIN_SEPARATOR(), structHash)
        );

        // Sign with certifier's private key
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(certifierKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        // Owner submits the meta-tx
        vm.prank(owner);
        registry.certifyFor(hash, certifier, deadline, signature);

        assertGt(registry.getCertification(hash), 0);
        assertEq(registry.certifiers(hash), certifier);
        assertEq(registry.nonces(certifier), nonce + 1);
    }

    function test_certifyFor_revert_expired() public {
        bytes32 hash = keccak256("expired");
        uint256 deadline = block.timestamp - 1;
        uint256 nonce = registry.nonces(certifier);

        bytes32 structHash = keccak256(
            abi.encode(registry.CERTIFY_TYPEHASH(), hash, certifier, nonce, deadline)
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", registry.DOMAIN_SEPARATOR(), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(certifierKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(owner);
        vm.expectRevert(DocumentRegistry.SignatureExpired.selector);
        registry.certifyFor(hash, certifier, deadline, signature);
    }

    function test_certifyFor_revert_already_certified() public {
        bytes32 hash = keccak256("duplicate");
        vm.prank(owner);
        registry.certify(hash);

        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce = registry.nonces(certifier);
        bytes32 structHash = keccak256(
            abi.encode(registry.CERTIFY_TYPEHASH(), hash, certifier, nonce, deadline)
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", registry.DOMAIN_SEPARATOR(), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(certifierKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(owner);
        vm.expectRevert(DocumentRegistry.AlreadyCertified.selector);
        registry.certifyFor(hash, certifier, deadline, signature);
    }

    // S10: Test that replaying a signature with an already-used nonce is rejected
    function test_certifyFor_revert_nonce_replay() public {
        bytes32 hash1 = keccak256("document one");
        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce = registry.nonces(certifier);

        // Build and sign first meta-tx
        bytes32 structHash1 = keccak256(
            abi.encode(registry.CERTIFY_TYPEHASH(), hash1, certifier, nonce, deadline)
        );
        bytes32 digest1 = keccak256(
            abi.encodePacked("\x19\x01", registry.DOMAIN_SEPARATOR(), structHash1)
        );
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(certifierKey, digest1);
        bytes memory sig1 = abi.encodePacked(r1, s1, v1);

        // Submit first — should succeed
        vm.prank(owner);
        registry.certifyFor(hash1, certifier, deadline, sig1);
        assertEq(registry.nonces(certifier), nonce + 1);

        // Now try to certify a different document using the OLD nonce (replay)
        bytes32 hash2 = keccak256("document two");
        bytes32 structHash2 = keccak256(
            abi.encode(registry.CERTIFY_TYPEHASH(), hash2, certifier, nonce, deadline)
        );
        bytes32 digest2 = keccak256(
            abi.encodePacked("\x19\x01", registry.DOMAIN_SEPARATOR(), structHash2)
        );
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(certifierKey, digest2);
        bytes memory sig2 = abi.encodePacked(r2, s2, v2);

        // Should revert because nonce has been consumed (signature won't match current nonce)
        vm.prank(owner);
        vm.expectRevert(DocumentRegistry.InvalidSignature.selector);
        registry.certifyFor(hash2, certifier, deadline, sig2);
    }

    // S3: Test that different chain IDs produce different domain separators (cross-chain replay protection)
    function test_crossChain_domainSeparator_differs() public {
        // Deploy registry on "chain 1"
        vm.chainId(1);
        vm.prank(owner);
        DocumentRegistry registry1 = new DocumentRegistry();
        bytes32 ds1 = registry1.DOMAIN_SEPARATOR();

        // Deploy registry on "chain 43113" (Fuji)
        vm.chainId(43113);
        vm.prank(owner);
        DocumentRegistry registry2 = new DocumentRegistry();
        bytes32 ds2 = registry2.DOMAIN_SEPARATOR();

        // Domain separators must differ
        assertTrue(ds1 != ds2, "Domain separators should differ across chains");
    }

    function test_certifyFor_revert_invalid_signature() public {
        bytes32 hash = keccak256("bad sig");
        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce = registry.nonces(certifier);

        bytes32 structHash = keccak256(
            abi.encode(registry.CERTIFY_TYPEHASH(), hash, certifier, nonce, deadline)
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", registry.DOMAIN_SEPARATOR(), structHash)
        );

        // Sign with WRONG key (owner instead of certifier)
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(owner);
        vm.expectRevert(DocumentRegistry.InvalidSignature.selector);
        registry.certifyFor(hash, certifier, deadline, signature);
    }
}
