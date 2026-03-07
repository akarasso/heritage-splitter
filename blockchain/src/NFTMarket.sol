// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/IERC721Enumerable.sol";

/**
 * @title NFTMarket
 * @notice Per-collection market that holds minted NFTs and orchestrates primary sales
 * @dev NFTs are minted into this market. Buyers call purchase() to buy at fixed price.
 *      100% of primary sale goes to ArtistsSplitter for distribution among beneficiaries.
 */
contract NFTMarket is ReentrancyGuard, IERC721Receiver {

    IERC721Enumerable public nftContract;
    address payable public splitter;
    address public owner;
    address public pendingOwner;
    address public minter;

    mapping(uint256 => uint256) public tokenPrice;

    /// @notice Pending refunds for buyers whose overpayment refund failed
    mapping(address => uint256) public pendingRefunds;

    /// @notice Total ETH held for pending refunds (protected from rescueETH)
    uint256 public totalPendingRefunds;

    error OnlyOwner();
    error NotAuthorized();
    error NotInVault();
    error InsufficientPayment();
    error PriceCannotBeZero();
    error PriceNotSet();
    error PaymentFailed();
    error PriceExceedsMax();
    error LengthMismatch();
    error ZeroAddress();
    error NotPendingOwner();
    error NothingToRefund();
    error RefundClaimFailed();
    error NothingToRescue();
    error RescueFailed();

    event PriceSet(uint256 indexed tokenId, uint256 price);
    event NFTPurchased(uint256 indexed tokenId, address indexed buyer, uint256 price);
    event MinterUpdated(address indexed newMinter);
    event NFTWithdrawn(uint256 indexed tokenId, address indexed to);
    event OwnerTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnerTransferred(address indexed previousOwner, address indexed newOwner);
    event RefundFailed(address indexed buyer, uint256 indexed tokenId, uint256 amount);
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

    constructor(address _nftContract, address payable _splitter, address _owner, address _minter) {
        if (_nftContract == address(0) || _splitter == address(0) || _owner == address(0)) revert ZeroAddress();
        nftContract = IERC721Enumerable(_nftContract);
        splitter = _splitter;
        owner = _owner;
        minter = _minter;
    }

    /// @notice Initiate ownership transfer (two-step)
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnerTransferStarted(owner, newOwner);
    }

    /// @notice Accept ownership transfer
    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        address oldOwner = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnerTransferred(oldOwner, owner);
    }

    /// @notice Owner withdraws an NFT from the market
    function withdrawNFT(uint256 tokenId) external onlyOwner {
        if (nftContract.ownerOf(tokenId) != address(this)) revert NotInVault();
        tokenPrice[tokenId] = 0;
        nftContract.safeTransferFrom(address(this), owner, tokenId);
        emit NFTWithdrawn(tokenId, owner);
    }

    /// @notice Owner can update the minter role
    function setMinter(address _minter) external onlyOwner {
        if (_minter == address(0)) revert ZeroAddress();
        minter = _minter;
        emit MinterUpdated(_minter);
    }

    /// @notice Owner can revoke the minter role
    function revokeMinter() external onlyOwner {
        minter = address(0);
        emit MinterUpdated(address(0));
    }

    /// @notice Set price for a token held by market
    function setPrice(uint256 tokenId, uint256 price) external onlyOwnerOrMinter {
        if (price == 0) revert PriceCannotBeZero();
        if (nftContract.ownerOf(tokenId) != address(this)) revert NotInVault();
        tokenPrice[tokenId] = price;
        emit PriceSet(tokenId, price);
    }

    /// @notice Set prices for multiple tokens at once
    /// @dev Maximum 100 items per batch call.
    function setPriceBatch(uint256[] calldata tokenIds, uint256[] calldata prices) external onlyOwnerOrMinter {
        require(tokenIds.length <= 100, "Batch too large");
        if (tokenIds.length != prices.length) revert LengthMismatch();
        for (uint256 i = 0; i < tokenIds.length; i++) {
            if (prices[i] == 0) revert PriceCannotBeZero();
            if (nftContract.ownerOf(tokenIds[i]) != address(this)) revert NotInVault();
            tokenPrice[tokenIds[i]] = prices[i];
            emit PriceSet(tokenIds[i], prices[i]);
        }
    }

    /// @notice Buy an NFT from the market — 100% goes to Splitter for primary distribution
    /// @param tokenId The NFT to purchase
    /// @param maxPrice Maximum acceptable price (slippage protection, 0 = no limit)
    function purchase(uint256 tokenId, uint256 maxPrice) external payable nonReentrant {
        // Checks
        if (nftContract.ownerOf(tokenId) != address(this)) revert NotInVault();
        uint256 price = tokenPrice[tokenId];
        if (price == 0) revert PriceNotSet();
        if (maxPrice != 0 && price > maxPrice) revert PriceExceedsMax();
        if (msg.value < price) revert InsufficientPayment();

        // Effects: clear price before external calls
        tokenPrice[tokenId] = 0;

        // Interactions: send payment to splitter, then transfer NFT
        (bool sent, ) = splitter.call{value: price}("");
        if (!sent) revert PaymentFailed();

        nftContract.safeTransferFrom(address(this), msg.sender, tokenId);
        emit NFTPurchased(tokenId, msg.sender, price);

        // Refund overpayment (uses low-level call; if buyer rejects, excess stored in pendingRefunds)
        uint256 excess = msg.value - price;
        if (excess > 0) {
            (bool refunded,) = payable(msg.sender).call{value: excess}("");
            if (!refunded) {
                pendingRefunds[msg.sender] += excess;
                totalPendingRefunds += excess;
                emit RefundFailed(msg.sender, tokenId, excess);
            }
        }
    }

    /// @notice List tokens available for purchase in the market (paginated)
    /// @param offset Starting index in the market's token list. If offset >= total tokens, returns empty arrays.
    /// @param limit Maximum number of tokens to return. Capped at 1000 regardless of input value.
    /// @dev When offset exceeds the total number of tokens held by the market, empty arrays are returned.
    ///      The effective count is min(limit, remaining, 1000).
    function listAvailableTokens(uint256 offset, uint256 limit) external view returns (uint256[] memory tokenIds, uint256[] memory prices) {
        uint256 total = nftContract.balanceOf(address(this));
        if (offset >= total) {
            return (new uint256[](0), new uint256[](0));
        }
        uint256 remaining = total - offset;
        uint256 count = limit < remaining ? limit : remaining;
        if (count > 1000) count = 1000;
        tokenIds = new uint256[](count);
        prices = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            uint256 tokenId = nftContract.tokenOfOwnerByIndex(address(this), offset + i);
            tokenIds[i] = tokenId;
            prices[i] = tokenPrice[tokenId];
        }
    }

    /// @notice List all tokens available for purchase in the market (capped at 1000)
    function listAvailableTokens() external view returns (uint256[] memory tokenIds, uint256[] memory prices) {
        uint256 count = nftContract.balanceOf(address(this));
        if (count > 1000) count = 1000;
        tokenIds = new uint256[](count);
        prices = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            uint256 tokenId = nftContract.tokenOfOwnerByIndex(address(this), i);
            tokenIds[i] = tokenId;
            prices[i] = tokenPrice[tokenId];
        }
    }

    /// @notice Number of tokens available in market
    function availableCount() external view returns (uint256) {
        return nftContract.balanceOf(address(this));
    }

    /// @notice Buyers can claim their pending refunds (from failed overpayment refunds)
    function claimRefund() external nonReentrant {
        uint256 amount = pendingRefunds[msg.sender];
        if (amount == 0) revert NothingToRefund();

        pendingRefunds[msg.sender] = 0;
        totalPendingRefunds -= amount;

        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert RefundClaimFailed();

        emit RefundClaimed(msg.sender, amount);
    }

    /// @notice Owner can rescue any ETH stuck in the market (e.g. from selfdestruct sends)
    /// @dev Only rescues ETH not reserved for pending buyer refunds.
    /// @param to The address to send rescued ETH to (allows rescue even if owner is a contract without receive())
    function rescueETH(address payable to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        uint256 rescuable = address(this).balance - totalPendingRefunds;
        if (rescuable == 0) revert NothingToRescue();
        (bool ok,) = to.call{value: rescuable}("");
        if (!ok) revert RescueFailed();
        emit ETHRescued(to, rescuable);
    }

    /// @notice Required to receive ERC721 tokens — only accepts from the intended NFT collection
    /// @dev Trust model: the `from` parameter is intentionally ignored. We only check that
    ///      `msg.sender` is the expected NFT contract. This means anyone can transfer NFTs from
    ///      this collection into the market, but only the owner can withdraw them or set prices.
    ///      The market trusts the NFT contract (set at construction) to correctly implement ERC-721.
    function onERC721Received(address, address, uint256, bytes calldata) external view override returns (bytes4) {
        if (msg.sender != address(nftContract)) revert NotAuthorized();
        return IERC721Receiver.onERC721Received.selector;
    }
}
