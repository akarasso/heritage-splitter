// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title PaymentRegistry
 * @notice Platform-wide payment registry using push-first, pull-fallback pattern.
 * @dev Deployed behind a TransparentUpgradeableProxy. All ArtistsSplitters
 *      forward payments here so each beneficiary has a single place to check/withdraw.
 *
 *      Redirects are resolved by following the chain (max 5 hops to prevent infinite loops).
 *      When a beneficiary changes wallet, the backend calls setRedirect.
 */
contract PaymentRegistry is Initializable, ReentrancyGuard {
    address public owner;
    address public pendingOwner;

    /// @notice Pending withdrawals for beneficiaries whose direct transfer failed
    mapping(address => uint256) public pendingWithdrawals;

    /// @notice Redirect map: payments to `from` are sent to `to` instead (single level)
    mapping(address => address) public redirects;

    event PaymentSent(address indexed beneficiary, uint256 amount);
    event PaymentDeferred(address indexed beneficiary, uint256 amount);
    event Withdrawn(address indexed beneficiary, uint256 amount);
    event RedirectSet(address indexed from, address indexed to);

    error NothingToWithdraw();
    error WithdrawFailed();
    error NotOwner();
    error NoSelfRedirect();
    error ZeroAddress();
    error NotPendingOwner();

    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    event Initialized(address indexed owner);

    function initialize(address _owner) external initializer {
        if (_owner == address(0)) revert ZeroAddress();
        owner = _owner;
        emit Initialized(_owner);
    }

    /// @notice Initiate ownership transfer (two-step)
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    /// @notice Accept ownership transfer
    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        address oldOwner = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(oldOwner, owner);
    }

    /// @notice Redirect payments from one address to another (owner only)
    /// @param from The original beneficiary address
    /// @param to The new beneficiary address (address(0) to remove redirect)
    function setRedirect(address from, address to) external onlyOwner {
        if (from == to) revert NoSelfRedirect();

        // Flatten: if `to` already has a redirect, point directly to the final target
        if (to != address(0)) {
            address finalTarget = redirects[to];
            if (finalTarget != address(0)) {
                to = finalTarget;
            }
            // Re-check after flatten
            if (from == to) revert NoSelfRedirect();
        }

        redirects[from] = to;

        // Migrate pending funds
        uint256 pending = pendingWithdrawals[from];
        if (pending > 0 && to != address(0)) {
            pendingWithdrawals[from] = 0;
            pendingWithdrawals[to] += pending;
        }

        emit RedirectSet(from, to);
    }

    /// @notice Pay a beneficiary — push-first, pull-fallback
    /// @dev Redirect resolution follows at most 5 hops to prevent infinite loops.
    ///      If a redirect chain exceeds 5 hops, payment goes to the last resolved address.
    ///      This limit is acceptable given that redirect chains are set by the owner and
    ///      are typically 1-2 levels deep.
    /// @param beneficiary The address to pay
    function pay(address beneficiary) external payable {
        // Follow redirect chain (max 5 hops to prevent infinite loops)
        address target = beneficiary;
        for (uint256 i = 0; i < 5; i++) {
            address next = redirects[target];
            if (next == address(0)) break;
            target = next;
        }

        (bool ok, ) = target.call{value: msg.value, gas: 2300}("");
        if (ok) {
            emit PaymentSent(target, msg.value);
        } else {
            pendingWithdrawals[target] += msg.value;
            emit PaymentDeferred(target, msg.value);
        }
    }

    /// @notice Withdraw deferred payments
    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        pendingWithdrawals[msg.sender] = 0;

        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert WithdrawFailed();

        emit Withdrawn(msg.sender, amount);
    }

    /// @dev Reserved storage gap for future upgrades.
    ///      Storage layout: ReentrancyGuard._status (1 slot) + owner (1 slot) + pendingOwner (1 slot)
    ///      + pendingWithdrawals (1 slot) + redirects (1 slot) = 5 slots used.
    ///      Gap = 50 - 5 = 45 slots, maintaining a total of 50 reserved slots for upgrade safety.
    uint256[45] private __gap;
}
