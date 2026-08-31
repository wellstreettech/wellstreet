// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {YieldShares} from "../src/YieldShares.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {Harvester} from "../src/Harvester.sol";
import {WellstreetTimelock} from "../src/WellstreetTimelock.sol";

/// @notice Deploys the Wellstreet v1 protocol on Robinhood Chain (4663):
///           1. WellstreetTimelock (48h, single proposer = the Wellstreet deployer
///              EOA, executor open) — the treasury custody contract AND the sole
///              admin of all protocol owner controls.
///           2. VaultFactory (wires the timelock, the pause-only EOA and the initial
///              fee into every created vault).
///           3. The canonical SPY vault via createVault(SPY, "Wellstreet SPY", "ws-SPY")
///              — name/symbol pinned identically in docs and frontend config.
///           4. The SPY harvester (configured for the tier-500 SPY/WETH pool) with the
///              timelock as its treasury.
///           5. Queues the vault's setHarvester(harvester) call on the timelock —
///              setHarvester is timelock-only, so yield flow starts after the 48h
///              window once anyone executes the queued call.
///
///         NOT in this script (separate launch-prep steps, all spend-gated):
///           - Minting/seeding the LP position and transferring its NFT to the
///             harvester (onERC721Received validates it is a tier-500 SPY/WETH
///             position).
///           - Funding the deployer EOA. The deployer key is read from the
///             WELLSTREET_DEPLOYER_KEY env var only — never hardcode a key anywhere.
///
///         Run (dry run, no broadcast):   forge script script/Deploy.s.sol
///         Run (broadcast):               forge script script/Deploy.s.sol \
///                                            --rpc-url robinhood --broadcast --slow
contract Deploy is Script {
    // Verified Robinhood Chain (4663) addresses — see docs/ops/phase0/ for the
    // evidence trail (Blockscout-verified contracts + live eth_call re-verification).
    address constant SPY = 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant POSITION_MANAGER = 0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3;
    address constant SWAP_ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address constant QUOTER_V2 = 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7;

    /// @notice The SPY/WETH pool exists ONLY at fee tier 500 (verified on-chain across
    ///         tiers 100/500/3000/10000).
    uint24 constant SPY_POOL_FEE = 500;

    uint256 constant TIMELOCK_DELAY = 172800; // 48h
    uint256 constant INITIAL_FEE_BPS = 1000; // 10% protocol / 90% depositors

    function run() external {
        require(block.chainid == 4663, "wrong chain: expected 4663");

        uint256 deployerKey = vm.envUint("WELLSTREET_DEPLOYER_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);
        WellstreetTimelock timelock = new WellstreetTimelock(deployer, TIMELOCK_DELAY);
        VaultFactory factory = new VaultFactory(address(timelock), deployer, INITIAL_FEE_BPS);
        address vault = factory.createVault(SPY, "Wellstreet SPY", "ws-SPY");
        Harvester harvester = new Harvester(
            vault,
            address(timelock), // position custody controller
            address(timelock), // treasury custody
            SPY,
            WETH,
            SPY_POOL_FEE,
            POSITION_MANAGER,
            SWAP_ROUTER,
            QUOTER_V2
        );
        // setHarvester is timelock-only: queue it, execute after the 48h window
        // (execution is permissionless once ready).
        timelock.queue(
            vault,
            0,
            abi.encodeCall(YieldShares.setHarvester, (address(harvester))),
            bytes32(0)
        );
        vm.stopBroadcast();

        console.log("WellstreetTimelock:", address(timelock));
        console.log("  delay (seconds):", timelock.delay());
        console.log("  proposer:", timelock.proposer());
        console.log("VaultFactory:", address(factory));
        console.log("SPY vault (Wellstreet SPY / ws-SPY):", vault);
        console.log("  feeBps:", YieldShares(vault).feeBps());
        console.log("Harvester:", address(harvester));
        console.log("  pool tier:", harvester.poolFee());
        console.log("Queued setHarvester - execute after", timelock.delay(), "seconds (permissionless)");
    }
}
