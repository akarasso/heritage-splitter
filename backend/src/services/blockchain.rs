use alloy::sol;
use alloy::providers::{Provider, ProviderBuilder};
use alloy::signers::local::PrivateKeySigner;
use alloy::primitives::{Address, U256};
use alloy::sol_types::SolEvent;
use alloy::rpc::types::Filter;
use serde::Serialize;
use std::str::FromStr;

/// Convert a decimal AVAX string (e.g. "0.2") to wei U256 (200000000000000000)
fn avax_to_wei(avax: &str) -> U256 {
    let trimmed = avax.trim();
    if trimmed.is_empty() {
        return U256::ZERO;
    }
    let parts: Vec<&str> = trimmed.split('.').collect();
    let (whole, frac) = match parts.len() {
        1 => (parts[0], ""),
        2 => (parts[0], parts[1]),
        _ => return U256::ZERO,
    };
    let whole_val = U256::from_str(whole).unwrap_or(U256::ZERO);
    let frac_str = format!("{:0<18}", frac); // pad right to 18 digits
    let frac_trimmed = &frac_str[..18];
    let frac_val = U256::from_str(frac_trimmed).unwrap_or(U256::ZERO);
    let wei_per_avax = U256::from(10u64).pow(U256::from(18u64));
    whole_val * wei_per_avax + frac_val
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_avax_to_wei() {
        assert_eq!(avax_to_wei("0.2"), U256::from(200000000000000000u64));
        assert_eq!(avax_to_wei("1"), U256::from(1000000000000000000u64));
        assert_eq!(avax_to_wei("0"), U256::ZERO);
        assert_eq!(avax_to_wei("0.1"), U256::from(100000000000000000u64));
        assert_eq!(avax_to_wei("1.5"), U256::from(1500000000000000000u64));
    }
}

sol! {
    #[sol(rpc)]
    contract CollectionFactory {
        event CollectionCreated(
            uint256 indexed index,
            address nft,
            address splitter,
            address owner,
            string name,
            string symbol
        );

        function createCollection(
            string calldata name,
            string calldata symbol,
            address owner,
            address[] calldata wallets,
            uint256[] calldata shares,
            uint96 royaltyBps,
            string calldata contractURI,
            address registry,
            address minterAddr
        ) external returns (uint256 index, address nftAddr, address splitterAddr);
    }

    #[sol(rpc)]
    contract CollectionNFT {
        function mintBatch(address to, string[] calldata uris) external returns (uint256[] memory);
        function setMinter(address minter) external;
        function setApprovalForAll(address operator, bool approved) external;
    }

    #[sol(rpc)]
    contract NFTMarket {
        function list(address nft, uint256 tokenId, uint256 price) external returns (uint256 listingId);
        function listBatch(address[] calldata nfts, uint256[] calldata tokenIds, uint256[] calldata prices) external returns (uint256[] memory);
        function delist(uint256 listingId) external;
        function setPrice(uint256 listingId, uint256 price) external;
        function purchase(uint256 listingId) external payable;
        function purchaseFor(uint256 listingId, address recipient) external payable;
        function setMinter(address minter) external;
        function listingCount() external view returns (uint256);
        function listings(uint256 index) external view returns (address nftContract, uint256 tokenId, uint256 price, address seller, bool active);
        event Listed(uint256 indexed listingId, address indexed nftContract, uint256 indexed tokenId, uint256 price, address seller);
        event NFTPurchased(uint256 indexed listingId, address indexed buyer, uint256 price);
    }

    #[sol(rpc, bytecode = "60a034620000dc57601f62001b1438819003918201601f19168301916001600160401b03831184841017620000e057808492606094604052833981010312620000dc576200004d81620000f4565b6200006960406200006160208501620000f4565b9301620000f4565b60015f556001600160a01b0391821691908215620000ca578116928315620000ca5760018060a01b03199283600154161760015516906003541617600355608052604051611a0a90816200010a82396080518181816109380152610aa40152f35b60405163d92e233d60e01b8152600490fd5b5f80fd5b634e487b7160e01b5f52604160045260245ffd5b51906001600160a01b0382168203620000dc5756fe60806040818152600480361015610014575f80fd5b5f925f3560e01c90816302f68ad91461126f5750806304824e70146111c5578063088c8fa214610fd35780630cc12d8214610d845780632177b1db14610d665780632f73a15114610c545780636bfb0d0114610c375780636e3ccf3814610bc05780636f33a00314610b4e57806379ba509714610ad35780637b10399914610a905780638da5cb5b14610a685780638de932221461073f57806396214735146106bc578063ade03d8a14610593578063b5545a3c146104e6578063b613b114146104ae578063b8a80aac146103d2578063d5f39488146103a9578063e30c39781461037c578063e54b4d91146101a75763f2fde38b14610112575f80fd5b346101a35760203660031901126101a35761012b61153c565b6001546001600160a01b039081169291338490036101935716928315610186575050600280546001600160a01b031916831790557faad8688f6907cacd3dba30507a5a58098d62ba47703407004d22ede69ad581bb8380a380f35b5163d92e233d60e01b8152fd5b8451635fc483c560e01b81528390fd5b8280fd5b50346101a35760a03660031901126101a35767ffffffffffffffff908035828111610378576101d9903690830161149c565b602493919335828111610374576101f3903690850161149c565b936044358481116103705761020b903690830161149c565b949060643582811161036c57610224903690850161149c565b9490926084359081116103685761023e903690860161149c565b96909460018060a01b039b60019c80600154163314159081610359575b5061034c57821561033f578a8314801590610335575b801561032b575b8015610321575b61031157606483116103045750508b5b81811061029a578c80f35b808080808f948f8f8f8f92918f92858c6102b392611552565b6102bc90611576565b976102c7918d611552565b35956102d3918d611552565b6102dc90611576565b926102e7918d611552565b35926102f3918d611552565b35926102fe94611738565b0161028f565b516305beb17160e11b8152fd5b516001621398b960e31b03198152fd5b508883141561027f565b5087831415610278565b5089831415610271565b5163521299a960e01b8152fd5b51630ccfaf4560e21b8152fd5b9050600354163314155f61025b565b8b80fd5b8a80fd5b8880fd5b8680fd5b8480fd5b5050346103a557816003193601126103a55760025490516001600160a01b039091168152602090f35b5080fd5b5050346103a557816003193601126103a55760035490516001600160a01b039091168152602090f35b5091346104ab57816003193601126104ab576103ec61153c565b825160609190911b6001600160601b0319166020820190815260243560348301529061042581605481015b03601f1981018352826115b2565b519020815260056020528181205490811561049c575f1982019182116104895750916104526080936115f5565b5060018060a01b036002820154169260ff600560038401549484015493015416928151948552602085015283015215156060820152f35b634e487b7160e01b815260118452602490fd5b50505163d3ed043d60e01b8152fd5b80fd5b5050346103a55760203660031901126103a55760209181906001600160a01b036104d661153c565b1681526006845220549051908152f35b5090346101a357826003193601126101a3576105006119b3565b338352600660205280832054918215610585573384526006602052838281205561052c836007546115d4565b6007558380808086335af161053f61162e565b50156105775750519081527f358fe4192934d3bf28ae181feda1f4bd08ca67f5e2fad55582cce5eb67304ae960203392a26001815580f35b9051631dd2a28360e11b8152fd5b905163f76aef6560e01b8152fd5b50346101a357816003193601126101a3576105ac61153c565b600154602435936001600160a01b039390918416331415806106ae575b6106a0578151606084901b6001600160601b0319166020820190815260348201879052906105fa8160548101610417565b519020908187526005602052828720548015610691575f19810190811161067e576106266005916115f5565b50019081549060ff821615610670575060ff19169055855260056020528420849055167f12dd6d17459a077ac7246eca5e7869f84ddb95e9ef70a0dd67b7bf6acc8f76378380a380f35b8451631ef25ee760e11b8152fd5b634e487b7160e01b885260118252602488fd5b50825163d3ed043d60e01b8152fd5b9051630ccfaf4560e21b8152fd5b5083600354163314156105c9565b5090346101a35760203660031901126101a3576106d761153c565b60015490926001600160a01b039290918316330361073257505080600354921691826001600160601b0360a01b821617600355167f4590909f6ea280ffff8f32337577f35ec6cbec73ab17ad9723c587bf0af57d668380a380f35b51635fc483c560e01b8152fd5b5090806003193601126109cf5761075461153c565b916024356107606119b3565b8251606085901b6001600160601b031916602080830191825260348301849052959161078f8160548101610417565b51902091825f5260058652845f20548015610a58575f198101908111610a45576107b8906115f5565b50600581019485549460ff861615610a3657600283019260018060a01b03978885541692600383019260a08c6024865491518098819363de74e57b60e01b83528b8301525afa8015610a2c575f955f916109f3575b50156109e35785019161082183548661172b565b998a34106109d35760ff191690555f90815260058c528a8120555493549054908816803b156109cf5760445f928b51948593849263179707b960e31b8452888401523360248401525af180156109c5576109b0575b5090889181610935575b5050506108ba937f0a1de378243658f901b5f4608adbb7dc1e15c04e84e07fd06d5fbd877f2272fb8787519286845233951692a4346115d4565b91826108c9575b836001815580f35b8380808086335af16108d961162e565b506108c1577faf73b0b217208b61be286bbc37095bce7eb8b9ccf617244c2f0f154e8e04e3ff913385526006825280852061091585825461172b565b90556109238460075461172b565b600755519283523392a25f80806108c1565b867f00000000000000000000000000000000000000000000000000000000000000001691876001541690833b156103785784926024918b519586948593630c11dedd60e01b85528401525af180156109a657610992575b80610880565b61099b9061158a565b61037457865f61098c565b87513d84823e3d90fd5b6109bc9192995061158a565b5f97905f610876565b88513d5f823e3d90fd5b5f80fd5b8c5163cd1c886760e01b81528790fd5b8b51633c3226c960e21b81528690fd5b9050610a1891955060a03d60a011610a25575b610a1081836115b2565b8101906116ed565b979350509050945f61080d565b503d610a06565b8c513d5f823e3d90fd5b508651631ef25ee760e11b8152fd5b601185634e487b7160e01b5f525260245ffd5b855163d3ed043d60e01b81528590fd5b82346109cf575f3660031901126109cf5760015490516001600160a01b039091168152602090f35b82346109cf575f3660031901126109cf57517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b50346109cf575f3660031901126109cf576002546001600160a01b038082169390929033859003610b41575050600180546001600160a01b031980821686179092559116600255167f8934ce4adea8d9ce0d714d2c22b86790e41b7731c84b926fbbdc1d40ff6533c95f80a3005b51630614e5c760e21b8152fd5b5090346109cf575f3660031901126109cf576001546001600160a01b03919082163303610bb1575f826003546001600160601b0360a01b8116600355167f4590909f6ea280ffff8f32337577f35ec6cbec73ab17ad9723c587bf0af57d668280a3005b51635fc483c560e01b81529050fd5b5090346109cf5760a03660031901126109cf57610bdb61153c565b604435916001600160a01b0380841684036109cf5780600154163314159081610c28575b50610c1957610c176084356064358560243586611738565b005b51630ccfaf4560e21b81528390fd5b90506003541633141585610bff565b5090346109cf575f3660031901126109cf57602091549051908152f35b5090346109cf5760603660031901126109cf57610c6f61153c565b91602435926044359260018060a01b0392836001541633141580610d58575b6106a0578151606084901b6001600160601b031916602082019081526034820188905290610cbf8160548101610417565b5190205f526005602052815f20548015610d49575f198101908111610d3657610ce7906115f5565b5060ff60058201541615610d2757018490555192835216907feb55da044c050cbd8be1e9dc9c460a326a9d5fc05bc4ad006a5b13727ba5865d90602090a3005b509051631ef25ee760e11b8152fd5b601182634e487b7160e01b5f525260245ffd5b50905163d3ed043d60e01b8152fd5b508360035416331415610c8e565b82346109cf575f3660031901126109cf576020906007549051908152f35b50346109cf575f3660031901126109cf578054905f805b838110610fa15750610dac81611693565b92610db682611693565b610dbf83611693565b90610dc984611693565b92610ddc610dd686611693565b95611693565b955f905f5b838110610e60575050505092610e4060c09593610e3289610e4e95610e25610e5c99610e1784519d8d8f9e8f90815201906114cd565b8c810360208e015290611509565b918a8303908b01526114cd565b908782036060890152611509565b908582036080870152611509565b9083820360a0850152611509565b0390f35b60ff6005610e6d836115f5565b50015416610e7e575b600101610de1565b91610f6b600191610e8e856115f5565b508c610ea483868060a01b0380945416926116c5565b5283610eaf876115f5565b500154610ebc838a6116c5565b528d610ec7876115f5565b50918060028094015416610edb858d6116c5565b52610ee5886115f5565b50928c610ef886600380970154926116c5565b528d610f11868a610f088d6115f5565b500154926116c5565b52610f1b896115f5565b5001541691610f29886115f5565b500154905191829163de74e57b60e01b83528783015281602460a09384935afa9182915f93610f7d575b5050610f7357505f610f65828d6116c5565b5261166d565b929050610e76565b610f65828d6116c5565b610f94929350803d10610a2557610a1081836115b2565b5050915050908f80610f53565b60ff6005610fae836115f5565b50015416610fbf575b600101610d9b565b90610fcb60019161166d565b919050610fb7565b50346109cf57816003193601126109cf5767ffffffffffffffff9181358381116109cf57611004903690840161149c565b6024929192946024359081116109cf57611021903690860161149c565b91909360018060a01b03936001978560015416331415806111b7575b6111a7578315611197578484036111845760648411611174575f5b84811061106157005b61107461106f828787611552565b611576565b61107f82888b611552565b845160609290921b6001600160601b03191660208084019182529135603484015290916110af8160548101610417565b51902090815f52600591828252855f20548015611164575f198101908111611152576110db84916115f5565b5001805460ff8116156111425760ff191690555f90815291905283812055899061110961106f828888611552565b88611115838a8d611552565b3591167f12dd6d17459a077ac7246eca5e7869f84ddb95e9ef70a0dd67b7bf6acc8f76375f80a301611058565b8751631ef25ee760e11b81528e90fd5b8560118e634e487b7160e01b5f52525ffd5b865163d3ed043d60e01b81528d90fd5b81516305beb17160e11b81528890fd5b81516001621398b960e31b031981528890fd5b815163521299a960e01b81528890fd5b8151630ccfaf4560e21b81528890fd5b50856003541633141561103d565b50346109cf5760203660031901126109cf5780356001600160a01b0381811693918490036109cf576001541633036107325782156101865761120a47600754906115d4565b918215611262575f80808086885af161122161162e565b501561125457507fb3579861130e4da8bb7b87c54d2d139937f23bcd6e4ebed9e75d0f78ab1cc1189160209151908152a2005b905163b8eaf7a160e01b8152fd5b9051620f6b2160e41b8152fd5b8383346109cf5760603660031901126109cf5767ffffffffffffffff9181358381116109cf576112a2903690840161149c565b92906024946024358181116109cf576112be903690850161149c565b90916044359081116109cf576112d7903690860161149c565b91909660018060a01b039460019a86600154163314158061148e575b6114805750811561147057828214801590611466575b6114535760648211611443575f5b82811061132057005b61132e61106f828585611552565b611339828689611552565b8a5160609290921b6001600160601b03191660208084019182529135603484015290916113698160548101610417565b5190205f5260058082528a5f20548015611433575f1981019081116114215761139360ff916115f5565b50918201541615611411578a7feb55da044c050cbd8be1e9dc9c460a326a9d5fc05bc4ad006a5b13727ba5865d8f94938b8f946114028f8d8f938a8f8f8f836113f5928f926113fb97839a6113ec858c61106f98611552565b35910155611552565b96611552565b3598611552565b3594519485521692a301611317565b8a51631ef25ee760e11b81528a90fd5b8d60118c634e487b7160e01b5f52525ffd5b8b5163d3ed043d60e01b81528b90fd5b87516305beb17160e11b81528790fd5b87516001621398b960e31b031981528790fd5b5083821415611309565b875163521299a960e01b81528790fd5b630ccfaf4560e21b81528790fd5b5086600354163314156112f3565b9181601f840112156109cf5782359167ffffffffffffffff83116109cf576020808501948460051b0101116109cf57565b9081518082526020808093019301915f5b8281106114ec575050505090565b83516001600160a01b0316855293810193928101926001016114de565b9081518082526020808093019301915f5b828110611528575050505090565b83518552938101939281019260010161151a565b600435906001600160a01b03821682036109cf57565b91908110156115625760051b0190565b634e487b7160e01b5f52603260045260245ffd5b356001600160a01b03811681036109cf5790565b67ffffffffffffffff811161159e57604052565b634e487b7160e01b5f52604160045260245ffd5b90601f8019910116810190811067ffffffffffffffff82111761159e57604052565b919082039182116115e157565b634e487b7160e01b5f52601160045260245ffd5b6004548110156115625760069060045f52027f8a35acfbc15ff81a39ae7d344fd709f28e8600b4aa8c65c6b64bfe7fe36bd19b01905f90565b3d15611668573d9067ffffffffffffffff821161159e576040519161165d601f8201601f1916602001846115b2565b82523d5f602084013e565b606090565b5f1981146115e15760010190565b67ffffffffffffffff811161159e5760051b60200190565b9061169d8261167b565b6116aa60405191826115b2565b82815280926116bb601f199161167b565b0190602036910137565b80518210156115625760209160051b010190565b51906001600160a01b03821682036109cf57565b908160a09103126109cf57611701816116d9565b91602082015191604081015191608061171c606084016116d9565b92015180151581036109cf5790565b919082018092116115e157565b90936001600160a01b039392841692909190831580156119a9575b611997576040805163de74e57b60e01b8152600480820184905291939060a0816024818a5afa90811561198d5790889392918a5f80925f94611963575b508487169b168b1480159290611958575b5050611948571561193957845160609190911b6001600160601b03191660208201908152603482018a9052906117da8160548101610417565b51902091825f526005602052845f205461192a57845160c0810181811067ffffffffffffffff821117611917578652888152602081018a8152868201898152606083019087825260808401928a845260a0850195600187528754680100000000000000008110156119045780600161185492018a556115f5565b9690966118f257927f436d9be9a78ebfddbca18337c5d2cc5f7e0b60c725f9784675a53f103b9d5f189d9b99979592826005969360609f9d9b99965116916001600160601b0360a01b928388541617875551600187015560028601925116908254161790555160038301555184820155019051151560ff8019835416911617905554905f526005602052825f205581519384526020840152820152a3565b5f89634e487b7160e01b82525260245ffd5b604189634e487b7160e01b5f525260245ffd5b604184634e487b7160e01b5f525260245ffd5b5083516328f560bb60e21b8152fd5b508351633c3226c960e21b8152fd5b85516364b7af6f60e01b81528390fd5b141590508a5f6117a1565b91935050611980915060a03d60a011610a2557610a1081836115b2565b94929391505f9050611790565b85513d5f823e3d90fd5b60405163d92e233d60e01b8152600490fd5b5084821615611753565b60025f54146119c25760025f55565b604051633ee5aeb560e01b8152600490fdfea2646970667358221220f81c52296a51ac39b55f648aa6bd61b2be7284fd4b53c23b0bff9dd94b44d2af64736f6c63430008160033")]
    contract Showroom {
        constructor(address _owner, address _deployer, address _registry);
        function addItem(address nft, uint256 tokenId, address market, uint256 listingId, uint256 margin) external;
        function addItemBatch(address[] calldata nfts, uint256[] calldata tokenIds, address[] calldata markets, uint256[] calldata listingIds, uint256[] calldata margins) external;
        function setMargin(address nft, uint256 tokenId, uint256 margin) external;
        function setMarginBatch(address[] calldata nfts, uint256[] calldata tokenIds, uint256[] calldata margins) external;
        function removeItem(address nft, uint256 tokenId) external;
        function removeItemBatch(address[] calldata nfts, uint256[] calldata tokenIds) external;
        function purchase(address nft, uint256 tokenId) external payable;
        function getItem(address nft, uint256 tokenId) external view returns (address market, uint256 marketListingId, uint256 margin, bool active);
        function listAvailable() external view returns (address[] memory nftContracts, uint256[] memory tokenIds, address[] memory markets, uint256[] memory marketListingIds, uint256[] memory margins, uint256[] memory basePrices);
        function itemCount() external view returns (uint256);
        function owner() external view returns (address);
        function deployer() external view returns (address);
        function registry() external view returns (address);
        function setDeployer(address _deployer) external;
        function revokeDeployer() external;
        function transferOwnership(address newOwner) external;
        event ItemAdded(address indexed nftContract, uint256 indexed tokenId, address market, uint256 marketListingId, uint256 margin);
    }
}

pub struct ShowroomDeployItem {
    pub nft_contract: String,
    pub token_id: u64,
    pub market_address: String,
    pub market_listing_id: u64,
    pub margin_wei: String,
}

#[derive(Debug, Clone)]
pub struct DeployResult {
    pub nft_address: String,
    pub splitter_address: String,
    pub block_number: u64,
}

/// Deploy a collection on-chain:
/// 1. Call factory.createCollection() → NFT + Splitter
/// 2. Set backend wallet as minter on NFT
/// 3. Mint NFTs to backend wallet (minter)
/// 4. Approve market for all NFTs
/// 5. List NFTs on market with prices
pub async fn deploy_collection(
    rpc_url: &str,
    private_key: &str,
    factory_address: &str,
    market_address: &str,
    producer_address: &str,
    collection_name: &str,
    collection_symbol: &str,
    wallets: Vec<String>,
    shares: Vec<u64>,
    royalty_bps: u64,
    nft_uris: Vec<String>,
    nft_prices_wei: Vec<U256>,
    registry_address: &str,
    metadata_base_url: Option<&str>,
) -> anyhow::Result<DeployResult> {
    let signer: PrivateKeySigner = private_key.parse()?;
    let minter_address = signer.address();

    let provider = ProviderBuilder::new()
        .wallet(alloy::network::EthereumWallet::from(signer))
        .connect_http(rpc_url.parse()?);

    let factory_addr = Address::from_str(factory_address)?;
    let market_addr = Address::from_str(market_address)?;
    let producer_addr = Address::from_str(producer_address)?;
    let registry_addr = Address::from_str(registry_address)?;

    // Convert wallets to Address
    let wallet_addrs: Vec<Address> = wallets
        .iter()
        .map(|w| Address::from_str(w))
        .collect::<Result<_, _>>()?;
    let share_vals: Vec<U256> = shares.iter().map(|s| U256::from(*s)).collect();

    // Step 1: Deploy via factory (minter set at deploy time, no separate setMinter needed)
    let factory = CollectionFactory::new(factory_addr, &provider);
    let tx = factory
        .createCollection(
            collection_name.to_string(),
            collection_symbol.to_string(),
            producer_addr,
            wallet_addrs,
            share_vals,
            alloy::primitives::Uint::<96, 2>::from(royalty_bps),
            String::new(), // contractURI
            registry_addr,
            minter_address,
        )
        .send()
        .await?;

    let receipt = tx.get_receipt().await?;

    // Extract addresses from CollectionCreated event
    let event = receipt
        .inner
        .logs()
        .iter()
        .find_map(|log| {
            CollectionFactory::CollectionCreated::decode_log(&log.inner).ok()
        })
        .ok_or_else(|| anyhow::anyhow!("CollectionCreated event not found"))?;

    let nft_address = format!("{:?}", event.data.nft);
    let splitter_address = format!("{:?}", event.data.splitter);
    let block_number = receipt.block_number.unwrap_or(0);

    // Validate addresses from event log before storing in DB
    for (label, addr) in [("NFT", &nft_address), ("Splitter", &splitter_address)] {
        if Address::from_str(addr).is_err() {
            return Err(anyhow::anyhow!("Invalid {} address from event log: {}", label, addr));
        }
    }

    tracing::info!(
        "Collection deployed: NFT={}, Splitter={}, Block={}",
        nft_address, splitter_address, block_number
    );

    // Step 2: Mint NFTs to minter (backend wallet)
    let nft = CollectionNFT::new(event.data.nft, &provider);
    if !nft_uris.is_empty() {
        // If metadata_base_url is provided, construct proper metadata URLs
        let final_uris = if let Some(base) = metadata_base_url {
            (0..nft_uris.len())
                .map(|i| format!("{}/{}/{}", base.trim_end_matches('/'), nft_address, i))
                .collect()
        } else {
            nft_uris
        };

        let mint_tx = nft
            .mintBatch(minter_address, final_uris)
            .send()
            .await?;
        let mint_receipt = mint_tx.get_receipt().await?;
        tracing::info!("NFTs minted to minter, tx: {:?}", mint_receipt.transaction_hash);

        // Step 4: Approve market for all NFTs
        let approve_tx = nft
            .setApprovalForAll(market_addr, true)
            .send()
            .await?;
        let approve_receipt = approve_tx.get_receipt().await?;
        tracing::info!("Market approved for NFTs, tx: {:?}", approve_receipt.transaction_hash);

        // Step 5: List NFTs on market with prices
        let nfts_with_prices: Vec<(usize, &U256)> = nft_prices_wei
            .iter()
            .enumerate()
            .filter(|(_, p)| **p > U256::ZERO)
            .collect();

        if !nfts_with_prices.is_empty() {
            let nft_addrs: Vec<Address> = nfts_with_prices.iter().map(|_| event.data.nft).collect();
            let token_ids: Vec<U256> = nfts_with_prices.iter().map(|(i, _)| U256::from(*i)).collect();
            let prices: Vec<U256> = nfts_with_prices.iter().map(|(_, p)| **p).collect();

            let market = NFTMarket::new(market_addr, &provider);
            let list_tx = market
                .listBatch(nft_addrs, token_ids, prices)
                .send()
                .await?;
            let list_receipt = list_tx.get_receipt().await?;
            tracing::info!("NFTs listed on market, tx: {:?}", list_receipt.transaction_hash);
        }
    }

    Ok(DeployResult {
        nft_address,
        splitter_address,
        block_number,
    })
}

/// Mint additional NFTs and list them on the market
pub async fn mint_additional_nfts(
    rpc_url: &str,
    private_key: &str,
    nft_address: &str,
    market_address: &str,
    uris: Vec<String>,
    token_ids: Vec<u64>,
    prices_wei: Vec<U256>,
) -> anyhow::Result<()> {
    let signer: PrivateKeySigner = private_key.parse()?;
    let minter_address = signer.address();
    let provider = ProviderBuilder::new()
        .wallet(alloy::network::EthereumWallet::from(signer))
        .connect_http(rpc_url.parse()?);

    let nft_addr = Address::from_str(nft_address)?;
    let market_addr = Address::from_str(market_address)?;

    // Mint to minter (backend wallet)
    let nft = CollectionNFT::new(nft_addr, &provider);
    let mint_tx = nft.mintBatch(minter_address, uris).send().await?;
    let mint_receipt = mint_tx.get_receipt().await?;
    tracing::info!("Additional NFTs minted to minter, tx: {:?}", mint_receipt.transaction_hash);

    // Approve market for all NFTs (idempotent if already approved)
    let approve_tx = nft.setApprovalForAll(market_addr, true).send().await?;
    let approve_receipt = approve_tx.get_receipt().await?;
    tracing::info!("Market approved for NFTs, tx: {:?}", approve_receipt.transaction_hash);

    // List on market with prices
    let nfts_with_prices: Vec<(u64, &U256)> = token_ids
        .iter()
        .zip(prices_wei.iter())
        .filter(|(_, p)| **p > U256::ZERO)
        .map(|(id, p)| (*id, p))
        .collect();

    if !nfts_with_prices.is_empty() {
        let nft_addrs: Vec<Address> = nfts_with_prices.iter().map(|_| nft_addr).collect();
        let ids: Vec<U256> = nfts_with_prices.iter().map(|(id, _)| U256::from(*id)).collect();
        let prices: Vec<U256> = nfts_with_prices.iter().map(|(_, p)| **p).collect();

        let market = NFTMarket::new(market_addr, &provider);
        let list_tx = market.listBatch(nft_addrs, ids, prices).send().await?;
        let list_receipt = list_tx.get_receipt().await?;
        tracing::info!("NFTs listed on market, tx: {:?}", list_receipt.transaction_hash);
    }

    Ok(())
}

/// Delist an NFT from the market (returns it to the seller)
pub async fn delist_nft(
    rpc_url: &str,
    private_key: &str,
    market_address: &str,
    listing_id: u64,
) -> anyhow::Result<()> {
    let signer: PrivateKeySigner = private_key.parse()?;
    let provider = ProviderBuilder::new()
        .wallet(alloy::network::EthereumWallet::from(signer))
        .connect_http(rpc_url.parse()?);

    let market_addr = Address::from_str(market_address)?;
    let market = NFTMarket::new(market_addr, &provider);
    let tx = market.delist(U256::from(listing_id)).send().await?;
    let receipt = tx.get_receipt().await?;
    tracing::info!("NFT delisted (listing {}), tx: {:?}", listing_id, receipt.transaction_hash);
    Ok(())
}

/// Relist an NFT on the market (re-list after delist)
pub async fn relist_nft(
    rpc_url: &str,
    private_key: &str,
    nft_address: &str,
    market_address: &str,
    token_id: u64,
    price_wei: U256,
) -> anyhow::Result<u64> {
    let signer: PrivateKeySigner = private_key.parse()?;
    let provider = ProviderBuilder::new()
        .wallet(alloy::network::EthereumWallet::from(signer))
        .connect_http(rpc_url.parse()?);

    let nft_addr = Address::from_str(nft_address)?;
    let market_addr = Address::from_str(market_address)?;

    // Approve market (idempotent)
    let nft = CollectionNFT::new(nft_addr, &provider);
    let approve_tx = nft.setApprovalForAll(market_addr, true).send().await?;
    approve_tx.get_receipt().await?;

    // List on market
    let market = NFTMarket::new(market_addr, &provider);
    let list_tx = market.list(nft_addr, U256::from(token_id), price_wei).send().await?;
    let receipt = list_tx.get_receipt().await?;
    tracing::info!("NFT relisted (token {}), tx: {:?}", token_id, receipt.transaction_hash);

    // Extract listing ID from Listed event
    let listing_id = receipt.inner.logs().iter()
        .find_map(|log| NFTMarket::Listed::decode_log(&log.inner).ok())
        .map(|e| e.data.listingId.to::<u64>())
        .unwrap_or(0);

    Ok(listing_id)
}

/// Get listing info for a token from the market
pub async fn get_listing_for_token(
    rpc_url: &str,
    market_address: &str,
    nft_address: &str,
    token_id: u64,
) -> anyhow::Result<Option<(u64, bool)>> {
    let provider = ProviderBuilder::new()
        .connect_http(rpc_url.parse()?);

    let market_addr = Address::from_str(market_address)?;
    let market = NFTMarket::new(market_addr, &provider);

    let count = market.listingCount().call().await?;
    let count_val: u64 = count.to();

    for i in 0..count_val {
        let listing = market.listings(U256::from(i)).call().await?;
        if listing.nftContract == Address::from_str(nft_address)? && listing.tokenId == U256::from(token_id) {
            return Ok(Some((i, listing.active)));
        }
    }
    Ok(None)
}

/// Deploy a Showroom contract on-chain.
/// The producer is owner, the backend signer is deployer (can manage items/margins).
/// Returns the deployed contract address.
pub async fn deploy_showroom(
    rpc_url: &str,
    private_key: &str,
    producer_address: &str,
    registry_address: &str,
    items: Vec<ShowroomDeployItem>,
) -> anyhow::Result<String> {
    let signer: PrivateKeySigner = private_key.parse()?;
    let deployer_address = signer.address();
    let provider = ProviderBuilder::new()
        .wallet(alloy::network::EthereumWallet::from(signer))
        .connect_http(rpc_url.parse()?);

    let producer_addr = Address::from_str(producer_address)?;
    let registry_addr = Address::from_str(registry_address)?;

    // Deploy: producer is owner, backend wallet is deployer, registry for margin payments
    let contract = Showroom::deploy(&provider, producer_addr, deployer_address, registry_addr).await?;
    let address = format!("{:?}", contract.address());

    tracing::info!("Showroom deployed at {} (owner={}, deployer={})", address, producer_address, deployer_address);

    // Add items if any (deployer can call addItemBatch)
    if !items.is_empty() {
        let nfts: Vec<Address> = items.iter()
            .map(|item| Address::from_str(&item.nft_contract))
            .collect::<Result<_, _>>()?;
        let token_ids: Vec<U256> = items.iter()
            .map(|item| U256::from(item.token_id))
            .collect();
        let markets: Vec<Address> = items.iter()
            .map(|item| Address::from_str(&item.market_address))
            .collect::<Result<_, _>>()?;
        let listing_ids: Vec<U256> = items.iter()
            .map(|item| U256::from(item.market_listing_id))
            .collect();
        let margins: Vec<U256> = items.iter()
            .map(|item| avax_to_wei(&item.margin_wei))
            .collect();

        let batch_tx = contract.addItemBatch(nfts, token_ids, markets, listing_ids, margins)
            .send().await?
            .get_receipt().await?;
        tracing::info!("Showroom items added, tx: {:?}", batch_tx.transaction_hash);
    }

    Ok(address)
}

/// Update the margin for an item in a deployed Showroom contract, keyed by (nft, tokenId).
pub async fn set_showroom_margin(
    rpc_url: &str,
    private_key: &str,
    showroom_address: &str,
    nft_contract: &str,
    token_id: u64,
    margin_wei: &str,
) -> anyhow::Result<()> {
    let signer: PrivateKeySigner = private_key.parse()?;
    let provider = ProviderBuilder::new()
        .wallet(alloy::network::EthereumWallet::from(signer))
        .connect_http(rpc_url.parse()?);

    let showroom_addr = Address::from_str(showroom_address)?;
    let nft_addr = Address::from_str(nft_contract)?;
    let contract = Showroom::new(showroom_addr, &provider);
    let margin = avax_to_wei(margin_wei);

    let tx = contract.setMargin(nft_addr, U256::from(token_id), margin)
        .send().await?
        .get_receipt().await?;
    tracing::info!("Showroom margin updated (nft={}, tokenId={}, margin={}), tx: {:?}", nft_contract, token_id, margin_wei, tx.transaction_hash);
    Ok(())
}

/// Get all active token IDs from a market contract for a given NFT contract.
/// Returns a set of token IDs that are still listed and active.
pub async fn get_active_token_ids(
    rpc_url: &str,
    market_address: &str,
    nft_address: &str,
) -> anyhow::Result<std::collections::HashSet<u64>> {
    let provider = ProviderBuilder::new()
        .connect_http(rpc_url.parse()?);

    let market_addr = Address::from_str(market_address)?;
    let nft_addr = Address::from_str(nft_address)?;
    let market = NFTMarket::new(market_addr, &provider);

    let count = market.listingCount().call().await?;
    let count_val: u64 = count.to();

    let mut active_tokens = std::collections::HashSet::new();
    for i in 0..count_val {
        let listing = market.listings(U256::from(i)).call().await?;
        if listing.nftContract == nft_addr && listing.active {
            active_tokens.insert(listing.tokenId.to::<u64>());
        }
    }
    Ok(active_tokens)
}

// ── On-chain event indexing ─────────────────────────────────────────

sol! {
    // ERC-721 Transfer event
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    // NFTMarket purchase event (listingId instead of tokenId)
    event NFTPurchased(uint256 indexed listingId, address indexed buyer, uint256 price);
    // ArtistsSplitter payment event
    event Paid(address indexed beneficiary, uint256 amount);
    // Splitter received event
    event Received(uint256 amount);
}

#[derive(Debug, Clone, Serialize)]
pub struct TokenTransferEvent {
    pub from: String,
    pub to: String,
    pub token_id: u64,
    pub block_number: u64,
    pub tx_hash: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PurchaseEvent {
    pub listing_id: u64,
    pub buyer: String,
    pub price_wei: String,
    pub block_number: u64,
    pub tx_hash: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PaymentEvent {
    pub beneficiary: String,
    pub amount_wei: String,
    pub block_number: u64,
    pub tx_hash: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TokenHistory {
    pub transfers: Vec<TokenTransferEvent>,
    pub purchases: Vec<PurchaseEvent>,
    pub payments: Vec<PaymentEvent>,
    pub total_revenue_wei: String,
}

const LOG_CHUNK_SIZE: u64 = 2048;

/// Fetch logs in chunks to avoid RPC block range limits.
async fn get_logs_chunked(
    provider: &impl Provider,
    base_filter: Filter,
    latest_block: u64,
    deploy_block: u64,
) -> anyhow::Result<Vec<alloy::rpc::types::Log>> {
    let mut all_logs = Vec::new();
    let mut from = deploy_block;
    while from <= latest_block {
        let to = (from + LOG_CHUNK_SIZE - 1).min(latest_block);
        let filter = base_filter.clone().from_block(from).to_block(to);
        let logs = provider.get_logs(&filter).await?;
        all_logs.extend(logs);
        from = to + 1;
    }
    Ok(all_logs)
}

/// Result of an incremental scan — includes the last block scanned.
pub struct ScanResult {
    pub transfers: Vec<TokenTransferEvent>,
    pub purchases: Vec<PurchaseEvent>,
    pub payments: Vec<PaymentEvent>,
    pub last_scanned_block: u64,
}

/// Fetch on-chain events for a collection, starting from `from_block`.
/// Returns only the NEW events since `from_block`.
pub async fn fetch_collection_events(
    rpc_url: &str,
    nft_address: &str,
    market_address: &str,
    splitter_address: &str,
    from_block: u64,
) -> anyhow::Result<ScanResult> {
    let provider = ProviderBuilder::new()
        .connect_http(rpc_url.parse()?);

    let nft_addr = Address::from_str(nft_address)?;
    let market_addr = Address::from_str(market_address)?;
    let splitter_addr = Address::from_str(splitter_address)?;

    let latest_block = provider.get_block_number().await?;
    if from_block > latest_block {
        return Ok(ScanResult {
            transfers: vec![], purchases: vec![], payments: vec![],
            last_scanned_block: latest_block,
        });
    }

    // Query Transfer events from NFT contract
    let transfer_filter = Filter::new()
        .address(nft_addr)
        .event_signature(Transfer::SIGNATURE_HASH);

    let transfer_logs = get_logs_chunked(&provider, transfer_filter, latest_block, from_block).await?;

    let transfers: Vec<TokenTransferEvent> = transfer_logs.iter().filter_map(|log| {
        let decoded = Transfer::decode_log(&log.inner).ok()?;
        Some(TokenTransferEvent {
            from: format!("{:?}", decoded.data.from),
            to: format!("{:?}", decoded.data.to),
            token_id: decoded.data.tokenId.try_into().ok()?,
            block_number: log.block_number?,
            tx_hash: format!("{:?}", log.transaction_hash?),
        })
    }).collect();

    // Query NFTPurchased events from Market
    let purchase_filter = Filter::new()
        .address(market_addr)
        .event_signature(NFTPurchased::SIGNATURE_HASH);

    let purchase_logs = get_logs_chunked(&provider, purchase_filter, latest_block, from_block).await?;

    let purchases: Vec<PurchaseEvent> = purchase_logs.iter().filter_map(|log| {
        let decoded = NFTPurchased::decode_log(&log.inner).ok()?;
        Some(PurchaseEvent {
            listing_id: decoded.data.listingId.try_into().ok()?,
            buyer: format!("{:?}", decoded.data.buyer),
            price_wei: decoded.data.price.to_string(),
            block_number: log.block_number?,
            tx_hash: format!("{:?}", log.transaction_hash?),
        })
    }).collect();

    // Query Paid events from Splitter
    let paid_filter = Filter::new()
        .address(splitter_addr)
        .event_signature(Paid::SIGNATURE_HASH);

    let paid_logs = get_logs_chunked(&provider, paid_filter, latest_block, from_block).await?;

    let payments: Vec<PaymentEvent> = paid_logs.iter().filter_map(|log| {
        let decoded = Paid::decode_log(&log.inner).ok()?;
        Some(PaymentEvent {
            beneficiary: format!("{:?}", decoded.data.beneficiary),
            amount_wei: decoded.data.amount.to_string(),
            block_number: log.block_number?,
            tx_hash: format!("{:?}", log.transaction_hash?),
        })
    }).collect();

    Ok(ScanResult {
        transfers,
        purchases,
        payments,
        last_scanned_block: latest_block,
    })
}
