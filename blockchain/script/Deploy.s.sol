// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "forge-std/Script.sol";
import "../src/CollectionFactory.sol";
import "../src/NFTMarket.sol";
import "../src/DocumentRegistry.sol";
import "../src/PaymentRegistry.sol";
import "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";

contract DeployScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);

        CollectionFactory factory = new CollectionFactory();
        NFTMarket market = new NFTMarket(deployer, deployer);
        DocumentRegistry docRegistry = new DocumentRegistry();

        // Deploy PaymentRegistry behind a TransparentUpgradeableProxy
        PaymentRegistry paymentImpl = new PaymentRegistry();
        bytes memory initData = abi.encodeCall(PaymentRegistry.initialize, (deployer));
        TransparentUpgradeableProxy paymentProxy = new TransparentUpgradeableProxy(
            address(paymentImpl),
            deployer,
            initData
        );

        vm.stopBroadcast();

        console.log("CollectionFactory deployed at:", address(factory));
        console.log("NFTMarket deployed at:", address(market));
        console.log("DocumentRegistry deployed at:", address(docRegistry));
        console.log("PaymentRegistry (proxy) deployed at:", address(paymentProxy));
        console.log("PaymentRegistry (impl) deployed at:", address(paymentImpl));
    }
}
