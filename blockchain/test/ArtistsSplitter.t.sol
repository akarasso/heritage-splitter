// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "forge-std/Test.sol";
import "../src/ArtistsSplitter.sol";
import "../src/PaymentRegistry.sol";
import "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";

contract ArtistsSplitterTest is Test {
    ArtistsSplitter public splitter;
    PaymentRegistry public registry;

    address public producer = makeAddr("producer");
    address payable public artist = payable(makeAddr("artist"));
    address payable public gallery = payable(makeAddr("gallery"));
    address payable public droitDeSuite = payable(makeAddr("droitDeSuite"));

    function setUp() public {
        // Deploy registry behind proxy
        PaymentRegistry impl = new PaymentRegistry();
        bytes memory initData = abi.encodeCall(PaymentRegistry.initialize, (address(this)));
        TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(address(impl), address(this), initData);
        registry = PaymentRegistry(payable(address(proxy)));

        address[] memory wallets = new address[](3);
        wallets[0] = artist;
        wallets[1] = gallery;
        wallets[2] = droitDeSuite;

        uint256[] memory shares = new uint256[](3);
        shares[0] = 5000; // 50%
        shares[1] = 3500; // 35%
        shares[2] = 1500; // 15%

        splitter = new ArtistsSplitter(producer, wallets, shares, address(registry));
    }

    function test_constructor() public view {
        assertEq(splitter.owner(), producer);
        assertEq(splitter.totalShares(), 10000);
        assertEq(splitter.beneficiaryCount(), 3);
        assertEq(address(splitter.registry()), address(registry));
    }

    function test_receive_autoDistributes() public {
        // Send ETH directly — auto-distributed via registry push
        (bool ok, ) = address(splitter).call{value: 1 ether}("");
        assertTrue(ok);

        // EOAs receive directly (push succeeds)
        assertEq(artist.balance, 0.5 ether);
        assertEq(gallery.balance, 0.35 ether);
        assertEq(droitDeSuite.balance, 0.15 ether);
    }

    function test_receive_distributes_2ether() public {
        (bool ok, ) = address(splitter).call{value: 2 ether}("");
        assertTrue(ok);

        assertEq(artist.balance, 1 ether);
        assertEq(gallery.balance, 0.7 ether);
        assertEq(droitDeSuite.balance, 0.3 ether);

        uint256 total = artist.balance + gallery.balance + droitDeSuite.balance;
        assertEq(total, 2 ether);
    }

    function test_multiple_payments_accumulate() public {
        (bool ok1, ) = address(splitter).call{value: 1 ether}("");
        assertTrue(ok1);

        (bool ok2, ) = address(splitter).call{value: 1 ether}("");
        assertTrue(ok2);

        assertEq(artist.balance, 1.0 ether);
        assertEq(gallery.balance, 0.7 ether);
        assertEq(droitDeSuite.balance, 0.3 ether);
    }

    function test_constructor_invalidShares() public {
        address[] memory wallets = new address[](1);
        wallets[0] = artist;
        uint256[] memory shares = new uint256[](1);
        shares[0] = 5000;

        vm.expectRevert(ArtistsSplitter.InvalidShares.selector);
        new ArtistsSplitter(producer, wallets, shares, address(registry));
    }

    function test_getBeneficiaries() public view {
        ArtistsSplitter.Beneficiary[] memory bens = splitter.getBeneficiaries();
        assertEq(bens.length, 3);
        assertEq(bens[0].wallet, artist);
        assertEq(bens[0].shares, 5000);
    }

    function testFuzz_distribution(uint256 amount) public {
        vm.assume(amount > 0 && amount < 100 ether);

        (bool ok, ) = address(splitter).call{value: amount}("");
        assertTrue(ok);

        uint256 total = artist.balance + gallery.balance + droitDeSuite.balance;
        assertEq(total, amount);
    }
}
