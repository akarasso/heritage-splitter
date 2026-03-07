// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

contract DocumentRegistry {
    address public owner;
    address public pendingOwner;

    mapping(bytes32 => uint256) public certifications;
    mapping(bytes32 => address) public certifiers;
    mapping(address => uint256) public nonces;

    bytes32 public DOMAIN_SEPARATOR;
    bytes32 public constant CERTIFY_TYPEHASH =
        keccak256("Certify(bytes32 hash,address certifier,uint256 nonce,uint256 deadline)");

    event DocumentCertified(bytes32 indexed hash, address indexed certifier, uint256 timestamp);

    error NotOwner();
    error AlreadyCertified();
    error SignatureExpired();
    error InvalidSignature();
    error ZeroAddress();

    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    error InvalidSignatureLength();
    error InvalidV();
    error InvalidS();
    error NotPendingOwner();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("DocumentRegistry"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    /// @notice Owner certifies directly
    function certify(bytes32 hash) external onlyOwner {
        if (certifications[hash] != 0) revert AlreadyCertified();
        certifications[hash] = block.timestamp;
        certifiers[hash] = msg.sender;
        emit DocumentCertified(hash, msg.sender, block.timestamp);
    }

    /// @notice Meta-tx: owner submits on behalf of a certifier who signed EIP-712
    function certifyFor(
        bytes32 hash,
        address certifier,
        uint256 deadline,
        bytes calldata signature
    ) external onlyOwner {
        if (block.timestamp > deadline) revert SignatureExpired();
        if (certifications[hash] != 0) revert AlreadyCertified();

        uint256 nonce = nonces[certifier];
        bytes32 structHash = keccak256(
            abi.encode(CERTIFY_TYPEHASH, hash, certifier, nonce, deadline)
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash)
        );

        address recovered = _recover(digest, signature);
        if (recovered != certifier) revert InvalidSignature();

        nonces[certifier] = nonce + 1;
        certifications[hash] = block.timestamp;
        certifiers[hash] = certifier;
        emit DocumentCertified(hash, certifier, block.timestamp);
    }

    function getCertification(bytes32 hash) external view returns (uint256) {
        return certifications[hash];
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        address oldOwner = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(oldOwner, owner);
    }

    /// @dev Recovers the signer from an ECDSA signature.
    ///      Expected signature format: 65 bytes, packed as `r || s || v` where:
    ///        - r: bytes 0..31  (bytes32)
    ///        - s: bytes 32..63 (bytes32)
    ///        - v: byte 64      (uint8, must be 27 or 28)
    ///      This is the standard format produced by `abi.encodePacked(r, s, v)`.
    function _recover(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) revert InvalidSignatureLength();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (v != 27 && v != 28) revert InvalidV();
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) revert InvalidS();
        address recovered = ecrecover(digest, v, r, s);
        if (recovered == address(0)) revert InvalidSignature();
        return recovered;
    }
}
