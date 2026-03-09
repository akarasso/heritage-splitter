// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

interface ICollectionNFT {
    function splitter() external view returns (address);
}

/**
 * @title NFTMarket
 * @notice Multi-collection marketplace for primary NFT sales
 * @dev Holds NFTs from any ERC-721 collection. At purchase time, reads the splitter
 *      address from the NFT contract and sends funds there for distribution.
 */
contract NFTMarket is ReentrancyGuard, IERC721Receiver {

    struct Listing {
        address nftContract;
        uint256 tokenId;
        uint256 price;
        address seller;
        bool active;
    }

    address public owner;
    address public pendingOwner;
    address public minter;

    Listing[] public listings;
    /// @notice Fast lookup: keccak256(nftContract, tokenId) => listingId + 1 (0 = not listed)
    mapping(bytes32 => uint256) public listingIndex;

    /// @notice Pending refunds for buyers whose overpayment refund failed
    mapping(address => uint256) public pendingRefunds;

    /// @notice Total ETH held for pending refunds (protected from rescueETH)
    uint256 public totalPendingRefunds;

    error OnlyOwner();
    error NotAuthorized();
    error InsufficientPayment();
    error PriceCannotBeZero();
    error PaymentFailed();
    error LengthMismatch();
    error ZeroAddress();
    error NotPendingOwner();
    error NothingToRefund();
    error RefundClaimFailed();
    error NothingToRescue();
    error RescueFailed();
    error ListingNotActive();
    error AlreadyListed();
    error BatchTooLarge();
    error EmptyArray();
    error NotNFTOwner();
    error NoSplitter();
    event Listed(uint256 indexed listingId, address indexed nftContract, uint256 indexed tokenId, uint256 price, address seller);
    event Delisted(uint256 indexed listingId);
    event PriceUpdated(uint256 indexed listingId, uint256 newPrice);
    event NFTPurchased(uint256 indexed listingId, address indexed buyer, uint256 price);
    event MinterUpdated(address indexed newMinter);
    event OwnerTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnerTransferred(address indexed previousOwner, address indexed newOwner);
    event RefundFailed(address indexed buyer, uint256 indexed listingId, uint256 amount);
    event RefundClaimed(address indexed buyer, uint256 amount);
    event ETHRescued(address indexed to, uint256 amount);
    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier onlyOwnerOrMinter() {
        if (msg.sender != owner && msg.sender != minter) revert NotAuthorized();
        _;
    }

    constructor(address _owner, address _minter) {
        if (_owner == address(0)) revert ZeroAddress();
        owner = _owner;
        minter = _minter;
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

    function setMinter(address _minter) external onlyOwner {
        if (_minter == address(0)) revert ZeroAddress();
        minter = _minter;
        emit MinterUpdated(_minter);
    }

    function revokeMinter() external onlyOwner {
        minter = address(0);
        emit MinterUpdated(address(0));
    }

    // ── Listing ────────────────────────────────────────────────

    /// @notice List an NFT for sale. Transfers the NFT to this contract.
    function list(address nft, uint256 tokenId, uint256 price) external onlyOwnerOrMinter returns (uint256 listingId) {
        listingId = _list(nft, tokenId, price, msg.sender);
    }

    /// @notice Batch list NFTs (max 100)
    function listBatch(
        address[] calldata nfts,
        uint256[] calldata tokenIds,
        uint256[] calldata prices
    ) external onlyOwnerOrMinter returns (uint256[] memory listingIds) {
        if (nfts.length == 0) revert EmptyArray();
        if (nfts.length != tokenIds.length || nfts.length != prices.length) revert LengthMismatch();
        if (nfts.length > 100) revert BatchTooLarge();
        listingIds = new uint256[](nfts.length);
        for (uint256 i = 0; i < nfts.length; i++) {
            listingIds[i] = _list(nfts[i], tokenIds[i], prices[i], msg.sender);
        }
    }

    /// @dev Trust assumption: callers (factory-deployed collections) have already approved
    ///      this market contract to transfer the NFT on the seller's behalf via
    ///      `IERC721.approve(market, tokenId)` or `setApprovalForAll(market, true)`.
    ///      If the approval is missing, `safeTransferFrom` will revert.
    function _list(address nft, uint256 tokenId, uint256 price, address seller) internal returns (uint256 listingId) {
        if (price == 0) revert PriceCannotBeZero();
        if (nft == address(0)) revert ZeroAddress();

        bytes32 key = keccak256(abi.encodePacked(nft, tokenId));
        if (listingIndex[key] != 0) revert AlreadyListed();

        // Verify the seller actually owns the NFT
        if (IERC721(nft).ownerOf(tokenId) != seller) revert NotNFTOwner();

        // Transfer NFT to this contract (safeTransferFrom ensures ERC721Receiver is implemented)
        IERC721(nft).safeTransferFrom(seller, address(this), tokenId);

        listingId = listings.length;
        listings.push(Listing({
            nftContract: nft,
            tokenId: tokenId,
            price: price,
            seller: seller,
            active: true
        }));
        listingIndex[key] = listingId + 1;

        emit Listed(listingId, nft, tokenId, price, seller);
    }

    /// @notice Remove a listing and return the NFT to the seller
    function delist(uint256 listingId) external onlyOwnerOrMinter {
        Listing storage l = listings[listingId];
        if (!l.active) revert ListingNotActive();

        l.active = false;
        bytes32 key = keccak256(abi.encodePacked(l.nftContract, l.tokenId));
        delete listingIndex[key];

        IERC721(l.nftContract).safeTransferFrom(address(this), l.seller, l.tokenId);
        emit Delisted(listingId);
    }

    /// @notice Update the price of a listing
    function setPrice(uint256 listingId, uint256 price) external onlyOwnerOrMinter {
        if (price == 0) revert PriceCannotBeZero();
        Listing storage l = listings[listingId];
        if (!l.active) revert ListingNotActive();
        l.price = price;
        emit PriceUpdated(listingId, price);
    }

    // ── Purchase ───────────────────────────────────────────────

    /// @notice Buy an NFT — funds go to the collection's splitter
    function purchase(uint256 listingId) external payable nonReentrant {
        _purchase(listingId, msg.sender);
    }

    /// @notice Buy an NFT and send it to a recipient (used by Showroom).
    /// No caller restriction — msg.value >= price is sufficient protection.
    function purchaseFor(uint256 listingId, address recipient) external payable nonReentrant {
        if (recipient == address(0)) revert ZeroAddress();
        _purchase(listingId, recipient);
    }

    function _purchase(uint256 listingId, address recipient) internal {
        Listing storage l = listings[listingId];
        if (!l.active) revert ListingNotActive();
        uint256 price = l.price;
        if (msg.value < price) revert InsufficientPayment();

        // Effects: deactivate listing before external calls
        l.active = false;
        bytes32 key = keccak256(abi.encodePacked(l.nftContract, l.tokenId));
        delete listingIndex[key];

        // Read splitter from the NFT contract
        address splitter = ICollectionNFT(l.nftContract).splitter();
        if (splitter == address(0)) revert NoSplitter();

        // Send payment to splitter
        (bool sent,) = payable(splitter).call{value: price}("");
        if (!sent) revert PaymentFailed();

        // Transfer NFT to recipient
        IERC721(l.nftContract).safeTransferFrom(address(this), recipient, l.tokenId);
        emit NFTPurchased(listingId, recipient, price);

        // Refund overpayment
        uint256 excess = msg.value - price;
        if (excess > 0) {
            (bool refunded,) = payable(msg.sender).call{value: excess}("");
            if (!refunded) {
                pendingRefunds[msg.sender] += excess;
                totalPendingRefunds += excess;
                emit RefundFailed(msg.sender, listingId, excess);
            }
        }
    }

    // ── Views ──────────────────────────────────────────────────

    /// @notice Paginated list of active listings
    function listAvailable(uint256 offset, uint256 limit) external view returns (Listing[] memory result) {
        // First count active listings
        uint256 activeCount = 0;
        for (uint256 i = 0; i < listings.length; i++) {
            if (listings[i].active) activeCount++;
        }

        if (offset >= activeCount) {
            return new Listing[](0);
        }

        uint256 remaining = activeCount - offset;
        uint256 count = limit < remaining ? limit : remaining;
        if (count > 1000) count = 1000;

        result = new Listing[](count);
        uint256 found = 0;
        uint256 skipped = 0;
        for (uint256 i = 0; i < listings.length && found < count; i++) {
            if (listings[i].active) {
                if (skipped < offset) {
                    skipped++;
                } else {
                    result[found] = listings[i];
                    found++;
                }
            }
        }
    }

    /// @notice Number of active listings
    function availableCount() external view returns (uint256 count) {
        for (uint256 i = 0; i < listings.length; i++) {
            if (listings[i].active) count++;
        }
    }

    /// @notice Total number of listings (including inactive)
    function listingCount() external view returns (uint256) {
        return listings.length;
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

    // ── ERC721 Receiver ────────────────────────────────────────

    /// @notice Accept any ERC721 token
    function onERC721Received(address, address, uint256, bytes calldata) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}
