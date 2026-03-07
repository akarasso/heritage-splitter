// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IPaymentRegistry {
    function pay(address beneficiary) external payable;
}

/**
 * @title ArtistsSplitter
 * @notice Proportional splitter that forwards payments to a PaymentRegistry.
 * @dev On receive: calculates each beneficiary's share and calls registry.pay().
 *      The registry handles push-first / pull-fallback logic.
 *
 *      Trust assumption: The `registry` address passed to the constructor is assumed to be a
 *      trusted IPaymentRegistry implementation. No `supportsInterface()` check is performed
 *      because the registry is deployed by the platform and its address is controlled by the
 *      CollectionFactory. A malicious registry could steal funds, so the factory must ensure
 *      only the legitimate PaymentRegistry address is provided.
 */
contract ArtistsSplitter is ReentrancyGuard {

    struct Beneficiary {
        address wallet;
        uint256 shares; // basis points (10000 = 100%)
    }

    address public immutable owner;
    IPaymentRegistry public immutable registry;

    Beneficiary[] public beneficiaries;
    uint256 public totalShares;

    event Received(uint256 amount);
    event Paid(address indexed beneficiary, uint256 amount);

    error InvalidShares();
    error NoZeroAddress();
    error LengthMismatch();
    error DuplicateWallet();

    constructor(
        address _owner,
        address[] memory _wallets,
        uint256[] memory _shares,
        address _registry
    ) {
        if (_wallets.length != _shares.length) revert LengthMismatch();
        require(_wallets.length <= 50, "Too many beneficiaries");
        if (_owner == address(0)) revert NoZeroAddress();
        if (_registry == address(0)) revert NoZeroAddress();

        owner = _owner;
        registry = IPaymentRegistry(_registry);

        uint256 total;
        for (uint256 i = 0; i < _wallets.length; i++) {
            if (_wallets[i] == address(0)) revert NoZeroAddress();
            require(_shares[i] > 0, "Zero share");
            // Check for duplicate wallets — O(n^2) but acceptable for N<=20 beneficiaries
            for (uint256 j = 0; j < i; j++) {
                if (_wallets[j] == _wallets[i]) revert DuplicateWallet();
            }
            beneficiaries.push(Beneficiary({
                wallet: _wallets[i],
                shares: _shares[i]
            }));
            total += _shares[i];
        }
        if (total != 10000) revert InvalidShares();
        totalShares = total;
    }

    /// @notice Receive ETH — forward shares to registry
    /// @dev Rounding behavior: integer division may leave dust (up to `beneficiaries.length - 1` wei).
    ///      The last beneficiary receives the remainder (`remaining`) instead of a calculated share,
    ///      ensuring no wei is left in the contract. This is the standard "last-gets-dust" approach
    ///      and is acceptable for the precision levels involved (basis points on ETH amounts).
    receive() external payable nonReentrant {
        if (msg.value == 0) return;
        uint256 total = msg.value;
        uint256 remaining = total;

        uint256 length = beneficiaries.length;
        for (uint256 i = 0; i < length; i++) {
            uint256 amount;
            if (i == length - 1) {
                // Last beneficiary gets the remainder to absorb rounding dust
                amount = remaining;
            } else {
                amount = (total * beneficiaries[i].shares) / totalShares;
                remaining -= amount;
            }

            registry.pay{value: amount}(beneficiaries[i].wallet);
            emit Paid(beneficiaries[i].wallet, amount);
        }

        emit Received(total);
    }

    /// @notice Get all beneficiaries
    function getBeneficiaries() external view returns (Beneficiary[] memory) {
        return beneficiaries;
    }

    /// @notice Get beneficiary count
    function beneficiaryCount() external view returns (uint256) {
        return beneficiaries.length;
    }

}
