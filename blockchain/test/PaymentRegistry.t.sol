// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "forge-std/Test.sol";
import "../src/PaymentRegistry.sol";
import "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";

/// @dev Contract that refuses to receive ETH (for testing pull-fallback)
contract RejectingReceiver {
    PaymentRegistry public registry;

    constructor(PaymentRegistry _registry) {
        registry = _registry;
    }

    function claimWithdraw() external {
        registry.withdraw();
    }

    // No receive/fallback — will reject direct ETH transfers
}

/// @dev Upgraded version for testing proxy upgrade
contract PaymentRegistryV2 is Initializable, ReentrancyGuard {
    address public owner;
    address public pendingOwner;
    mapping(address => uint256) public pendingWithdrawals;
    mapping(address => address) private __deprecated_redirects; // preserved for storage compat
    uint256 public version;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _owner) external initializer {
        owner = _owner;
    }

    function pay(address beneficiary) external payable {
        (bool ok, ) = beneficiary.call{value: msg.value, gas: 2300}("");
        if (!ok) pendingWithdrawals[beneficiary] += msg.value;
    }

    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        pendingWithdrawals[msg.sender] = 0;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok);
    }

    function setVersion(uint256 _v) external {
        version = _v;
    }
}

contract PaymentRegistryTest is Test {
    PaymentRegistry public registry;
    TransparentUpgradeableProxy public proxy;
    address public proxyAdmin;

    address public owner = makeAddr("owner");
    address payable public alice = payable(makeAddr("alice"));
    address payable public bob = payable(makeAddr("bob"));

    function setUp() public {
        // Deploy implementation
        PaymentRegistry impl = new PaymentRegistry();

        // Deploy proxy with initialize(owner)
        bytes memory initData = abi.encodeCall(PaymentRegistry.initialize, (owner));
        proxy = new TransparentUpgradeableProxy(address(impl), owner, initData);

        // Cast proxy to PaymentRegistry
        registry = PaymentRegistry(payable(address(proxy)));
    }

    function test_initialize() public view {
        assertEq(registry.owner(), owner);
    }

    function test_pay_pushSuccess() public {
        uint256 balBefore = alice.balance;
        registry.pay{value: 1 ether}(alice);
        assertEq(alice.balance - balBefore, 1 ether);
        assertEq(registry.pendingWithdrawals(alice), 0);
    }

    function test_pay_pushFails_deferredWithdrawal() public {
        // Deploy a contract that rejects ETH
        RejectingReceiver rejector = new RejectingReceiver(registry);
        address rejAddr = address(rejector);

        registry.pay{value: 1 ether}(rejAddr);

        // Push failed → stored in pendingWithdrawals
        assertEq(registry.pendingWithdrawals(rejAddr), 1 ether);
    }

    function test_pay_accumulates() public {
        RejectingReceiver rejector = new RejectingReceiver(registry);
        address rejAddr = address(rejector);

        registry.pay{value: 1 ether}(rejAddr);
        registry.pay{value: 2 ether}(rejAddr);

        assertEq(registry.pendingWithdrawals(rejAddr), 3 ether);
    }

    function test_withdraw() public {
        // Use a GasHungryReceiver — push fails (2300 gas), but withdraw succeeds (full gas)
        GasHungryReceiver receiver = new GasHungryReceiver(registry);
        address recvAddr = address(receiver);

        registry.pay{value: 2 ether}(recvAddr);
        assertEq(registry.pendingWithdrawals(recvAddr), 2 ether);

        uint256 balBefore = recvAddr.balance;
        receiver.claimWithdraw();
        assertEq(recvAddr.balance - balBefore, 2 ether);
        assertEq(registry.pendingWithdrawals(recvAddr), 0);
    }

    function test_withdraw_nothingToWithdraw() public {
        vm.prank(alice);
        vm.expectRevert(PaymentRegistry.NothingToWithdraw.selector);
        registry.withdraw();
    }

    function test_upgrade_preservesState() public {
        GasHungryReceiver receiver = new GasHungryReceiver(registry);
        registry.pay{value: 5 ether}(address(receiver));
        assertEq(registry.pendingWithdrawals(address(receiver)), 5 ether);

        // Deploy V2
        PaymentRegistryV2 implV2 = new PaymentRegistryV2();

        bytes32 adminSlot = vm.load(address(proxy), bytes32(uint256(keccak256("eip1967.proxy.admin")) - 1));
        address proxyAdminAddr = address(uint160(uint256(adminSlot)));

        vm.prank(owner);
        ProxyAdmin(proxyAdminAddr).upgradeAndCall(ITransparentUpgradeableProxy(address(proxy)), address(implV2), "");

        // State preserved
        PaymentRegistryV2 registryV2 = PaymentRegistryV2(payable(address(proxy)));
        assertEq(registryV2.pendingWithdrawals(address(receiver)), 5 ether);
        assertEq(registryV2.owner(), owner);

        // New function works
        registryV2.setVersion(42);
        assertEq(registryV2.version(), 42);

        // Withdraw still works
        uint256 balBefore = address(receiver).balance;
        receiver.claimWithdraw();
        assertEq(address(receiver).balance - balBefore, 5 ether);
    }

}

/// @dev Contract that needs more than 2300 gas to receive ETH (has storage write in receive)
/// but can receive with full gas (for withdraw path)
contract GasHungryReceiver {
    PaymentRegistry public registry;
    uint256 public counter;

    constructor(PaymentRegistry _registry) {
        registry = _registry;
    }

    receive() external payable {
        // Storage write costs ~20k gas, way more than 2300
        counter += 1;
    }

    function claimWithdraw() external {
        registry.withdraw();
    }
}
