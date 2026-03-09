// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./ArtistsSplitter.sol";

interface INFTMarket {
    function listings(uint256 listingId) external view returns (
        address nftContract,
        uint256 tokenId,
        uint256 price,
        address seller,
        bool active
    );
    function purchaseFor(uint256 listingId, address recipient) external payable;
}

/**
 * @title Showroom
 * @notice Producer storefront that references NFTMarket listings with a margin.
 * @dev Items are keyed by (nftContract, tokenId) instead of sequential IDs.
 *      The deployer role (backend wallet) can manage items and margins even after
 *      ownership is transferred to the producer.
 *      Margins are forwarded to the PaymentRegistry (same as ArtistsSplitter),
 *      so the producer receives funds in the same place as artists.
 */
contract Showroom is ReentrancyGuard {

    struct ShopItem {
        address nftContract;
        uint256 tokenId;
        address market;
        uint256 marketListingId;
        uint256 margin;
        bool active;
    }

    address public owner;
    address public pendingOwner;
    address public deployer;          // backend wallet — can manage items/margins
    IPaymentRegistry public immutable registry;

    ShopItem[] internal _items;       // array for enumeration
    // fast lookup: keccak256(nftContract, tokenId) → index+1 (0 = not found)
    mapping(bytes32 => uint256) internal _lookup;

    /// @notice Pending refunds for buyers whose overpayment refund failed
    mapping(address => uint256) public pendingRefunds;
    /// @notice Total ETH held for pending refunds (protected from rescueETH)
    uint256 public totalPendingRefunds;

    error OnlyOwner();
    error OnlyOwnerOrDeployer();
    error NotPendingOwner();
    error ZeroAddress();
    error ItemNotFound();
    error ItemNotActive();
    error AlreadyListed();
    error InsufficientPayment();
    error MarketListingNotActive();
    error BatchTooLarge();
    error EmptyArray();
    error LengthMismatch();
    error MarketListingMismatch();
    error NothingToRefund();
    error RefundClaimFailed();
    error NothingToRescue();
    error RescueFailed();

    event ItemAdded(address indexed nftContract, uint256 indexed tokenId, address market, uint256 marketListingId, uint256 margin);
    event ItemRemoved(address indexed nftContract, uint256 indexed tokenId);
    event MarginUpdated(address indexed nftContract, uint256 indexed tokenId, uint256 newMargin);
    event ItemPurchased(address indexed nftContract, uint256 indexed tokenId, address indexed buyer, uint256 totalPrice);
    event OwnerTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnerTransferred(address indexed previousOwner, address indexed newOwner);
    event DeployerUpdated(address indexed previousDeployer, address indexed newDeployer);
    event RefundFailed(address indexed buyer, uint256 amount);
    event RefundClaimed(address indexed buyer, uint256 amount);
    event ETHRescued(address indexed to, uint256 amount);

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier onlyOwnerOrDeployer() {
        if (msg.sender != owner && msg.sender != deployer) revert OnlyOwnerOrDeployer();
        _;
    }

    constructor(address _owner, address _deployer, address _registry) {
        if (_owner == address(0)) revert ZeroAddress();
        if (_registry == address(0)) revert ZeroAddress();
        owner = _owner;
        deployer = _deployer; // can be address(0) if no deployer needed
        registry = IPaymentRegistry(_registry);
    }

    // ── Ownership ──────────────────────────────────────────────

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnerTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        address oldOwner = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnerTransferred(oldOwner, owner);
    }

    function setDeployer(address _deployer) external onlyOwner {
        address old = deployer;
        deployer = _deployer;
        emit DeployerUpdated(old, _deployer);
    }

    function revokeDeployer() external onlyOwner {
        address old = deployer;
        deployer = address(0);
        emit DeployerUpdated(old, address(0));
    }

    // ── Item Management ────────────────────────────────────────

    function addItem(
        address nft, uint256 tokenId,
        address market, uint256 listingId, uint256 margin
    ) external onlyOwnerOrDeployer {
        _addItem(nft, tokenId, market, listingId, margin);
    }

    function addItemBatch(
        address[] calldata nfts, uint256[] calldata tokenIds,
        address[] calldata markets, uint256[] calldata listingIds,
        uint256[] calldata margins
    ) external onlyOwnerOrDeployer {
        uint256 len = nfts.length;
        if (len == 0) revert EmptyArray();
        if (len != tokenIds.length || len != markets.length || len != listingIds.length || len != margins.length) revert LengthMismatch();
        if (len > 100) revert BatchTooLarge();
        for (uint256 i = 0; i < len; i++) {
            _addItem(nfts[i], tokenIds[i], markets[i], listingIds[i], margins[i]);
        }
    }

    function removeItem(address nft, uint256 tokenId) external onlyOwnerOrDeployer {
        bytes32 key = keccak256(abi.encodePacked(nft, tokenId));
        uint256 idx1 = _lookup[key];
        if (idx1 == 0) revert ItemNotFound();
        ShopItem storage item = _items[idx1 - 1];
        if (!item.active) revert ItemNotActive();
        item.active = false;
        delete _lookup[key]; // allow re-adding later
        emit ItemRemoved(nft, tokenId);
    }

    function removeItemBatch(
        address[] calldata nfts, uint256[] calldata tokenIds
    ) external onlyOwnerOrDeployer {
        if (nfts.length == 0) revert EmptyArray();
        if (nfts.length != tokenIds.length) revert LengthMismatch();
        if (nfts.length > 100) revert BatchTooLarge();
        for (uint256 i = 0; i < nfts.length; i++) {
            bytes32 key = keccak256(abi.encodePacked(nfts[i], tokenIds[i]));
            uint256 idx1 = _lookup[key];
            if (idx1 == 0) revert ItemNotFound();
            ShopItem storage item = _items[idx1 - 1];
            if (!item.active) revert ItemNotActive();
            item.active = false;
            delete _lookup[key];
            emit ItemRemoved(nfts[i], tokenIds[i]);
        }
    }

    function setMargin(address nft, uint256 tokenId, uint256 margin) external onlyOwnerOrDeployer {
        bytes32 key = keccak256(abi.encodePacked(nft, tokenId));
        uint256 idx1 = _lookup[key];
        if (idx1 == 0) revert ItemNotFound();
        ShopItem storage item = _items[idx1 - 1];
        if (!item.active) revert ItemNotActive();
        item.margin = margin;
        emit MarginUpdated(nft, tokenId, margin);
    }

    function setMarginBatch(
        address[] calldata nfts, uint256[] calldata tokenIds,
        uint256[] calldata margins
    ) external onlyOwnerOrDeployer {
        if (nfts.length == 0) revert EmptyArray();
        if (nfts.length != tokenIds.length || nfts.length != margins.length) revert LengthMismatch();
        if (nfts.length > 100) revert BatchTooLarge();
        for (uint256 i = 0; i < nfts.length; i++) {
            bytes32 key = keccak256(abi.encodePacked(nfts[i], tokenIds[i]));
            uint256 idx1 = _lookup[key];
            if (idx1 == 0) revert ItemNotFound();
            ShopItem storage item = _items[idx1 - 1];
            if (!item.active) revert ItemNotActive();
            item.margin = margins[i];
            emit MarginUpdated(nfts[i], tokenIds[i], margins[i]);
        }
    }

    // ── Purchase ───────────────────────────────────────────────

    function purchase(address nft, uint256 tokenId) external payable nonReentrant {
        bytes32 key = keccak256(abi.encodePacked(nft, tokenId));
        uint256 idx1 = _lookup[key];
        if (idx1 == 0) revert ItemNotFound();
        ShopItem storage item = _items[idx1 - 1];
        if (!item.active) revert ItemNotActive();

        // Read base price from market
        (,,uint256 basePrice,, bool marketActive) = INFTMarket(item.market).listings(item.marketListingId);
        if (!marketActive) revert MarketListingNotActive();

        uint256 totalPrice = basePrice + item.margin;
        if (msg.value < totalPrice) revert InsufficientPayment();

        // Effects
        item.active = false;
        delete _lookup[key];
        uint256 marginAmount = item.margin;

        // Interactions: forward base price to market, NFT goes directly to buyer
        INFTMarket(item.market).purchaseFor{value: basePrice}(item.marketListingId, msg.sender);

        // Forward margin to PaymentRegistry for the producer (same pattern as ArtistsSplitter)
        if (marginAmount > 0) {
            registry.pay{value: marginAmount}(owner);
        }

        emit ItemPurchased(nft, tokenId, msg.sender, totalPrice);

        // Refund overpayment (pull-fallback pattern)
        uint256 excess = msg.value - totalPrice;
        if (excess > 0) {
            (bool refunded,) = payable(msg.sender).call{value: excess}("");
            if (!refunded) {
                pendingRefunds[msg.sender] += excess;
                totalPendingRefunds += excess;
                emit RefundFailed(msg.sender, excess);
            }
        }
    }

    // ── Refunds & Rescue ───────────────────────────────────────

    function claimRefund() external nonReentrant {
        uint256 amount = pendingRefunds[msg.sender];
        if (amount == 0) revert NothingToRefund();
        pendingRefunds[msg.sender] = 0;
        totalPendingRefunds -= amount;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert RefundClaimFailed();
        emit RefundClaimed(msg.sender, amount);
    }

    function rescueETH(address payable to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        uint256 rescuable = address(this).balance - totalPendingRefunds;
        if (rescuable == 0) revert NothingToRescue();
        (bool ok,) = to.call{value: rescuable}("");
        if (!ok) revert RescueFailed();
        emit ETHRescued(to, rescuable);
    }

    // ── Views ──────────────────────────────────────────────────

    function itemCount() external view returns (uint256) {
        return _items.length;
    }

    /// @notice Get a single item by (nft, tokenId)
    function getItem(address nft, uint256 tokenId) external view returns (
        address market, uint256 marketListingId, uint256 margin, bool active
    ) {
        bytes32 key = keccak256(abi.encodePacked(nft, tokenId));
        uint256 idx1 = _lookup[key];
        if (idx1 == 0) revert ItemNotFound();
        ShopItem storage item = _items[idx1 - 1];
        return (item.market, item.marketListingId, item.margin, item.active);
    }

    /// @notice List all active items with total prices
    function listAvailable() external view returns (
        address[] memory nftContracts,
        uint256[] memory tokenIds,
        address[] memory markets,
        uint256[] memory marketListingIds,
        uint256[] memory margins,
        uint256[] memory basePrices
    ) {
        uint256 activeCount = 0;
        for (uint256 i = 0; i < _items.length; i++) {
            if (_items[i].active) activeCount++;
        }

        nftContracts = new address[](activeCount);
        tokenIds = new uint256[](activeCount);
        markets = new address[](activeCount);
        marketListingIds = new uint256[](activeCount);
        margins = new uint256[](activeCount);
        basePrices = new uint256[](activeCount);

        uint256 idx = 0;
        for (uint256 i = 0; i < _items.length; i++) {
            if (_items[i].active) {
                nftContracts[idx] = _items[i].nftContract;
                tokenIds[idx] = _items[i].tokenId;
                markets[idx] = _items[i].market;
                marketListingIds[idx] = _items[i].marketListingId;
                margins[idx] = _items[i].margin;
                try INFTMarket(_items[i].market).listings(_items[i].marketListingId) returns (
                    address, uint256, uint256 price, address, bool
                ) {
                    basePrices[idx] = price;
                } catch {
                    basePrices[idx] = 0;
                }
                idx++;
            }
        }
    }

    // ── Internals ──────────────────────────────────────────────

    function _addItem(
        address nft, uint256 tokenId,
        address market, uint256 listingId, uint256 margin
    ) internal {
        if (market == address(0) || nft == address(0)) revert ZeroAddress();

        // Validate that listingId matches the expected (nft, tokenId) on the market
        (address listedNft, uint256 listedTokenId,,, bool listedActive) = INFTMarket(market).listings(listingId);
        if (listedNft != nft || listedTokenId != tokenId) revert MarketListingMismatch();
        if (!listedActive) revert MarketListingNotActive();

        bytes32 key = keccak256(abi.encodePacked(nft, tokenId));
        if (_lookup[key] != 0) revert AlreadyListed();
        _items.push(ShopItem({
            nftContract: nft,
            tokenId: tokenId,
            market: market,
            marketListingId: listingId,
            margin: margin,
            active: true
        }));
        _lookup[key] = _items.length; // index+1
        emit ItemAdded(nft, tokenId, market, listingId, margin);
    }
}
