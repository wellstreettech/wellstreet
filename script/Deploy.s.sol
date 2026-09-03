// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ISafe, ISafeProxyFactory} from "../src/interfaces/ISafe.sol";
import {YieldShares} from "../src/YieldShares.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {Harvester} from "../src/Harvester.sol";
import {WellstreetTimelock} from "../src/WellstreetTimelock.sol";

/// @notice Deploys the Wellstreet v1 protocol on Robinhood Chain (4663):
///           1. WellstreetTimelock (48h, proposer = a 2-of-3 Safe multisig, executor
///              open) — the treasury custody contract AND the sole admin of all
///              protocol owner controls. The timelock is BORN UNDER SAFE: its proposer
///              is immutable and there is no setProposer, so the Safe must exist BEFORE
///              this deployment (a post-deployment handover would require redeploying).
///           2. VaultFactory (wires the timelock, the pause-only EOA and the initial
///              fee into every created vault).
///           3. The canonical SPY vault via createVault(SPY, "Wellstreet SPY", "ws-SPY")
///              — name/symbol pinned identically in docs and frontend config.
///           4. The SPY harvester (configured for the tier-500 SPY/WETH pool) with the
///              timelock as its treasury.
///
///         Consequence of being BORN UNDER SAFE (structural, measured in the dry run):
///         the deployer EOA is NOT the proposer, so the script can no longer queue the
///         initial setHarvester call directly — only the 2-of-3 Safe can queue (two
///         owner signatures, ascending signer order). Queuing setHarvester is therefore
///         a POST-DEPLOY operator step through the Safe: build
///         `queue(vault, 0, abi.encodeCall(YieldShares.setHarvester, (harvester)), 0x…)`,
///         sign with two owner keys, execute via `execTransaction` — after the 48h
///         window anyone executes the queued call and yield flow starts.
///
///         Safe proposer wiring (launch posture: 2-of-3 Safe multisig — three keys,
///         one operator, disclosed; multiple keys are NOT multiple parties):
///           - WELLSTREET_SAFE_PROXY set  → the timelock's proposer is that Safe proxy
///             (the preferred path: create the Safe first from the operator's three
///             key addresses, then broadcast this script).
///           - WELLSTREET_SAFE_PROXY unset → the Safe is created inline in the SAME
///             broadcast through the LIVE SafeProxyFactory (v1.4.1, verified deployed
///             on 4663): owners = WELLSTREET_SAFE_OWNERS (comma-separated; EXACTLY 3
///             unique non-zero addresses enforced, named errors otherwise), threshold
///             = 2, salt = WELLSTREET_SAFE_SALT (default 0).
///         The deployer EOA retains only the pause-only authority (revocable by the
///         timelock) and gas/ops duties — every owner control routes through the
///         timelock, whose proposals now require two of the three Safe keys.
///
///         NOT in this script (separate launch-prep steps, all spend-gated):
///           - Minting/seeding the LP position and transferring its NFT to the
///             harvester (onERC721Received validates it is a tier-500 SPY/WETH
///             position).
///           - Funding the deployer EOA. The deployer key is read from the
///             WELLSTREET_DEPLOYER_KEY env var only — never hardcode a key anywhere.
///             The three Safe OWNER ADDRESSES are env-provided at run time; owner
///             PRIVATE KEYS never appear in any artifact.
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

    // Live Safe v1.4.1 infrastructure on 4663 (eth_getCode-verified 2026-09-02).
    address constant SAFE_SINGLETON = 0x41675C099F32341bf84BFc5382aF534df5C7461a;
    address constant SAFE_PROXY_FACTORY = 0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67;

    /// @notice The 2-of-3 signer model: three keys, one operator, threshold 2.
    uint256 constant SAFE_THRESHOLD = 2;
    uint256 constant SAFE_OWNER_COUNT = 3;

    uint256 constant TIMELOCK_DELAY = 172800; // 48h
    uint256 constant INITIAL_FEE_BPS = 1000; // 10% protocol / 90% depositors

    error SafeProxyHasNoCode();
    error SafeOwnersUnset();
    error SafeOwnersWrongCount(uint256 expected, uint256 got);
    error SafeOwnersZeroAddress(uint256 index);
    error SafeOwnersNotUnique(uint256 index);

    function run() external {
        require(block.chainid == 4663, "wrong chain: expected 4663");

        uint256 deployerKey = vm.envUint("WELLSTREET_DEPLOYER_KEY");
        address deployer = vm.addr(deployerKey);

        // Resolve the Safe proposer BEFORE the broadcast (env reads are free); the
        // inline creation itself must happen INSIDE the broadcast — it is a deploy.
        address safeProxy = vm.envOr("WELLSTREET_SAFE_PROXY", address(0));
        bool safeProvided = safeProxy != address(0);
        if (safeProvided && safeProxy.code.length == 0) revert SafeProxyHasNoCode();

        vm.startBroadcast(deployerKey);
        if (!safeProvided) {
            safeProxy = _createSafeInline();
        }
        WellstreetTimelock timelock = new WellstreetTimelock(safeProxy, TIMELOCK_DELAY);
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
        // NOTE: no initial setHarvester queue here — the deployer EOA is not the
        // proposer anymore (the 2-of-3 Safe is). The first proposal is queued AFTER
        // this deploy through the Safe itself, with two owner signatures.
        vm.stopBroadcast();

        console.log("WellstreetTimelock:", address(timelock));
        console.log("  delay (seconds):", timelock.delay());
        console.log("  proposer (2-of-3 Safe multisig):", timelock.proposer());
        console.log("VaultFactory:", address(factory));
        console.log("SPY vault (Wellstreet SPY / ws-SPY):", vault);
        console.log("  feeBps:", YieldShares(vault).feeBps());
        console.log("Harvester:", address(harvester));
        console.log("  pool tier:", harvester.poolFee());
        console.log("NEXT STEP (operator, through the 2-of-3 Safe): queue setHarvester on the timelock, then anyone executes after", timelock.delay(), "seconds");
    }

    /// @dev Creates the 2-of-3 Safe inline through the LIVE SafeProxyFactory. Called
    ///      only when WELLSTREET_SAFE_PROXY is unset; must run INSIDE the broadcast.
    function _createSafeInline() internal returns (address safeProxy) {
        address[] memory owners = _readSafeOwners();
        uint256 saltNonce = vm.envOr("WELLSTREET_SAFE_SALT", uint256(0));
        bytes memory initializer = abi.encodeCall(
            ISafe.setup,
            (owners, SAFE_THRESHOLD, address(0), hex"", address(0), address(0), 0, payable(address(0)))
        );
        safeProxy = ISafeProxyFactory(SAFE_PROXY_FACTORY).createProxyWithNonce(SAFE_SINGLETON, initializer, saltNonce);
        console.log("Safe proxy created inline:", safeProxy);
        console.log("  owners (3 keys, one operator):");
        for (uint256 i = 0; i < owners.length; i++) {
            console.log("   ", owners[i]);
        }
        console.log("  threshold (2-of-3):", SAFE_THRESHOLD);
    }

    /// @dev Reads WELLSTREET_SAFE_OWNERS (comma-separated addresses) and enforces the
    ///      EXACTLY-3-unique-non-zero signer model with named errors.
    function _readSafeOwners() internal view returns (address[] memory owners) {
        address[] memory none = new address[](0);
        owners = vm.envOr("WELLSTREET_SAFE_OWNERS", ",", none);
        if (owners.length == 0) revert SafeOwnersUnset();
        if (owners.length != SAFE_OWNER_COUNT) revert SafeOwnersWrongCount(SAFE_OWNER_COUNT, owners.length);
        for (uint256 i = 0; i < owners.length; i++) {
            if (owners[i] == address(0)) revert SafeOwnersZeroAddress(i);
            for (uint256 j = i + 1; j < owners.length; j++) {
                if (owners[i] == owners[j]) revert SafeOwnersNotUnique(i);
            }
        }
    }
}
