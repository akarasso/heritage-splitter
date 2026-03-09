// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title PaymentRegistry
 * @notice Platform-wide payment registry using push-first, pull-fallback pattern.
 * @dev Deployed behind a TransparentUpgradeableProxy. All ArtistsSplitters
 *      forward payments here so each beneficiary has a single place to check/withdraw.
 */
contract PaymentRegistry is Initializable, ReentrancyGuard {
    address public owner;
    address public pendingOwner;

    /// @notice Pending withdrawals for beneficiaries whose direct transfer failed
    mapping(address => uint256) public pendingWithdrawals;

    /// @dev Slot preserved for upgrade compatibility (was: redirects mapping). Do not reuse.
    mapping(address => address) private __deprecated_redirects;

    event PaymentSent(address indexed beneficiary, uint256 amount);
    event PaymentDeferred(address indexed beneficiary, uint256 amount);
    event Withdrawn(address indexed beneficiary, uint256 amount);

    error NothingToWithdraw();
    error WithdrawFailed();
    error NotOwner();
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

    /// @notice Pay a beneficiary — push-first, pull-fallback
    /// @param beneficiary The address to pay
    function pay(address beneficiary) external payable {
        (bool ok, ) = beneficiary.call{value: msg.value, gas: 2300}("");
        if (ok) {
            emit PaymentSent(beneficiary, msg.value);
        } else {
            pendingWithdrawals[beneficiary] += msg.value;
            emit PaymentDeferred(beneficiary, msg.value);
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
    ///      + pendingWithdrawals (1 slot) + __deprecated_redirects (1 slot) = 5 slots used.
    ///      Gap = 50 - 5 = 45 slots, maintaining a total of 50 reserved slots for upgrade safety.
    uint256[45] private __gap;
}
