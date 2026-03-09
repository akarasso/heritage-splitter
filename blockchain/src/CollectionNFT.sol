// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Royalty.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title CollectionNFT
 * @notice ERC-721 with on-chain enumeration and ERC-2981 royalties
 * @dev Owner = the creator (full control). Minter = backend (can mint on behalf of creator).
 *
 *      Royalty flow:
 *        - Primary sales: buyer -> NFTMarket -> ArtistsSplitter (via market.purchase())
 *        - Secondary sales: marketplace -> ArtistsSplitter directly (via ERC-2981 royaltyInfo)
 *      The splitter address is set as the royalty receiver, so secondary sale royalties bypass
 *      the market entirely. This is intentional: the market only orchestrates primary sales.
 */
contract CollectionNFT is ERC721, ERC721Enumerable, ERC721URIStorage, ERC721Royalty, Ownable {

    uint256 private _nextTokenId;
    address public splitter;
    address public minter;
    string private _contractURI;

    // Errors
    error NotTokenOwner();
    error NotAuthorized();
    error ZeroAddress();
    error EmptyArray();

    // Events
    event Minted(uint256 indexed tokenId, address indexed to, string uri);
    event BatchMinted(uint256 startTokenId, uint256 count, address indexed to);
    event MinterUpdated(address indexed newMinter);
    event Burned(uint256 indexed tokenId, address indexed burner);

    modifier onlyOwnerOrMinter() {
        if (msg.sender != owner() && msg.sender != minter) revert NotAuthorized();
        _;
    }

    constructor(
        string memory name_,
        string memory symbol_,
        address _splitter,
        uint96 _royaltyBps,
        address _owner,
        string memory contractURI_,
        address _minter
    ) ERC721(name_, symbol_) Ownable(_owner) {
        if (_splitter == address(0)) revert ZeroAddress();
        splitter = _splitter;
        minter = _minter;
        _setDefaultRoyalty(_splitter, _royaltyBps);
        _contractURI = contractURI_;
    }

    /// @notice Owner can update the minter role (use revokeMinter() to remove)
    /// @dev No timelock is enforced on minter changes. This is an intentional trade-off:
    ///      a timelock would add complexity and delay emergency revocations. The owner
    ///      is trusted to manage the minter role responsibly. A compromised minter can only mint,
    ///      not transfer or burn existing tokens, limiting the blast radius.
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

    /// @notice Mint a single NFT
    function mint(address to, string calldata uri) external onlyOwnerOrMinter returns (uint256) {
        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
        emit Minted(tokenId, to, uri);
        return tokenId;
    }

    /// @notice Mint a batch of NFTs
    /// @dev Maximum 100 items per batch call.
    function mintBatch(address to, string[] calldata uris) external onlyOwnerOrMinter returns (uint256[] memory) {
        if (uris.length == 0) revert EmptyArray();
        require(uris.length <= 100, "Batch too large");
        uint256[] memory tokenIds = new uint256[](uris.length);
        uint256 startId = _nextTokenId;

        for (uint256 i = 0; i < uris.length; i++) {
            uint256 tokenId = _nextTokenId++;
            _safeMint(to, tokenId);
            _setTokenURI(tokenId, uris[i]);
            tokenIds[i] = tokenId;
            emit Minted(tokenId, to, uris[i]);
        }

        emit BatchMinted(startId, uris.length, to);
        return tokenIds;
    }

    /// @notice Burn a token — only the token owner can burn
    function burn(uint256 tokenId) external {
        if (ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        _burn(tokenId);
        emit Burned(tokenId, msg.sender);
    }

    /// @notice Burn multiple tokens — only the token owner can burn each token
    /// @dev Maximum 100 items per batch call.
    function burnBatch(uint256[] calldata tokenIds) external {
        if (tokenIds.length == 0) revert EmptyArray();
        require(tokenIds.length <= 100, "Batch too large");
        for (uint256 i = 0; i < tokenIds.length; i++) {
            if (ownerOf(tokenIds[i]) != msg.sender) revert NotTokenOwner();
            _burn(tokenIds[i]);
            emit Burned(tokenIds[i], msg.sender);
        }
    }

    /// @notice Collection-level metadata URI
    function contractURI() external view returns (string memory) {
        return _contractURI;
    }

    // --- Overrides required by Solidity for multiple inheritance ---

    function tokenURI(uint256 tokenId) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721Enumerable, ERC721URIStorage, ERC721Royalty)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721, ERC721Enumerable)
        returns (address)
    {
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(address account, uint128 value)
        internal
        override(ERC721, ERC721Enumerable)
    {
        super._increaseBalance(account, value);
    }
}
