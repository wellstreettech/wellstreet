// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title FleetRouter — self-custodied one-tx LP entry router (v1)
/// @notice A THIN FORWARDER: one entry point that opens an LP position on a fee-tier
///         book of the pinned fork position manager, in a single transaction, with the
///         caller keeping everything. The caller supplies the full position params; the
///         router runs NO trading logic, NO price feeds, NO pool discovery and NO
///         custody — it never holds the position NFT (the recipient is forced to
///         msg.sender) and holds no post-mint authority.
///
/// CUSTODY MODEL — PULL-FORWARD-REFUND (pinned by the blocking pre-flight artifact
/// docs/ops/phase0/npm-mint-payer-semantics.md): the fork NPM at
/// 0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3 pulls the mint amounts from msg.sender
/// via safeTransferFrom in its mint callback (payer = the mint caller, verified from the
/// deployed Blockscout source, 2026-09-20). Therefore the router: (1) pulls the desired
/// amounts from the caller, (2) approves the NPM, (3) lets the NPM pull the exact-owed
/// amounts from the router during mint, (4) refunds desired-minus-owed to the caller in
/// the SAME transaction, and (5) asserts the end-of-tx zero-balance invariant: the
/// router's token0/token1/native balances are 0 on every path.
///
/// FEE POLICY — flat native-ETH fee, 100% recycled into the protocol endowment
/// (docs/public/whitepaper.md §6.1 Lane 3: the protocol pocket is the vault feeBps plus
/// the router flat fee, recycled into principal — the dev take is structurally 0). The
/// starting fee is 0.0005 ETH (user-ratified 2026-09-20, A11(i)); it changes ONLY via
/// setFee, gated to the treasury timelock (2-of-3 Safe + 48h — A11(iv): the recipient
/// TreasuryTimelock is a CONSTRUCTOR ARG, never hardcoded). MAX_FEE = 0.05 ETH is a
/// defense-in-depth ceiling added BEYOND amendments A6/A7: even a compromised or
/// captured timelock cannot raise the fee past a tenth of an ETH per position.
///
/// STATUS — NOT-YET-DEPLOYED. No router address is pinned anywhere (site config,
/// skills, datasets) until an on-chain broadcast exists in a separate, user-gated act.
/// Until then — and forever after (MIT, permissionless chain: this router can never be
/// mandatory) — the FREE fallback is a direct mint on the NPM: approve the NPM for the
/// two tokens, call mint with recipient = your own address. The router's only value
/// over that fallback is one-transaction convenience plus the fee-forwarding lane; it
/// adds no permission, no privilege and no exclusivity.
///
/// LIMITATIONS (honest tape): caller must supply standard ERC20s (fee-on-transfer or
/// rebasing tokens break the refund math and the zero-balance assertion reverts the
/// whole open — no funds are stranded, the caller loses only gas); the caller must wrap
/// native ETH itself where a book is WETH-denominated (the router only moves the flat
/// fee in native ETH); non-standard balanceOf implementations fail the end-of-tx
/// assertion the same way.
contract FleetRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice The pinned fork position manager (script/Deploy.s.sol:65 at deploy time;
    ///         the CONSTRUCTOR ARG is the source of truth — see the deploy-gated rule).
    address public immutable npm;

    /// @notice The treasury timelock (the endowment pocket, 2-of-3 Safe + 48h). Receives
    ///         every fee and is the ONLY caller of setFee. Constructor arg, never a
    ///         hardcoded address (A11(iv)).
    address public immutable timelock;

    /// @notice Flat fee per open, in wei of native ETH. Starts at 0.0005 ETH
    ///         (user-ratified A11(i)); settable only by the timelock, capped by MAX_FEE.
    uint256 public fee;

    /// @notice Hard ceiling on the fee — defense-in-depth BEYOND A6/A7 (disclosed in the
    ///         header). Even the timelock cannot set a fee above 0.05 ETH.
    uint256 public constant MAX_FEE = 0.05 ether;

    /// @notice Emitted on every successful open. `caller` is the payer/fund source and
    ///         the NFT recipient; (token0, token1, feeTier) is the book identity.
    event FleetPositionOpened(
        address indexed caller,
        address indexed token0,
        address indexed token1,
        uint24 feeTier,
        int24 tickLower,
        int24 tickUpper,
        uint256 tokenId,
        uint128 liquidity,
        uint256 amount0,
        uint256 amount1
    );

    /// @notice The timelock changed the flat fee.
    event FeeUpdated(uint256 oldFee, uint256 newFee);

    error WrongFee(uint256 expected, uint256 received);
    error OnlyTimelock();
    error FeeAboveCeiling(uint256 requested, uint256 ceiling);
    error FeeForwardFailed();
    error BalanceLeak(address token, uint256 amount);
    error NativeLeak(uint256 amount);

    /// @notice Position parameters, modeled 1:1 on the REAL mint params of the pinned
    ///         fork NPM (docs/ops/phase0/npm-mint-payer-semantics.md) MINUS the
    ///         recipient field: the recipient is FORCED to msg.sender and is therefore
    ///         not caller-suppliable — structurally absent rather than overwritten.
    struct PositionParams {
        address token0;
        address token1;
        uint24 feeTier;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    /// @param npm_ the fork position manager this router forwards into (pinned at
    ///        script/Deploy.s.sol:65 for the current deployment).
    /// @param timelock_ the TreasuryTimelock that receives fees and controls setFee.
    constructor(address npm_, address timelock_) {
        npm = npm_;
        timelock = timelock_;
        fee = 0.0005 ether;
    }

    /// @notice Open an LP position on a book in ONE transaction. Pulls the desired
    ///         amounts from the caller, forwards into the NPM's mint (which pulls the
    ///         exact-owed amounts from this router), refunds desired-minus-owed to the
    ///         caller, forwards the flat fee to the timelock, and asserts the
    ///         end-of-tx zero-balance invariant. The position NFT is minted directly to
    ///         the caller — this router retains nothing but the fee lane.
    /// @param p full position params (recipient deliberately absent — forced to caller).
    /// @return tokenId the NFT id of the new position (owned by msg.sender).
    /// @return liquidity the position liquidity minted.
    /// @return amount0 the ACTUAL amount0 consumed (pulled by the NPM).
    /// @return amount1 the ACTUAL amount1 consumed (pulled by the NPM).
    function openPosition(PositionParams calldata p)
        external
        payable
        nonReentrant
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        // Exact fee — no refund path for overpayment (A6: require(msg.value == fee)).
        if (msg.value != fee) revert WrongFee(fee, msg.value);

        // 1. PULL: desired amounts from the caller into the router.
        if (p.amount0Desired > 0) {
            IERC20(p.token0).safeTransferFrom(msg.sender, address(this), p.amount0Desired);
        }
        if (p.amount1Desired > 0) {
            IERC20(p.token1).safeTransferFrom(msg.sender, address(this), p.amount1Desired);
        }

        // 2. APPROVE: the NPM pulls via safeTransferFrom (ERC20 allowance — NOT
        //    setApprovalForAll; see the pinned payer semantics artifact).
        if (p.amount0Desired > 0) IERC20(p.token0).forceApprove(npm, p.amount0Desired);
        if (p.amount1Desired > 0) IERC20(p.token1).forceApprove(npm, p.amount1Desired);

        // 3. FORWARD: thin passthrough into the NPM mint, recipient FORCED to msg.sender
        //    (the caller owns the position; the router never holds the NFT). Slippage
        //    (amount0Min/amount1Min) and deadline are enforced INSIDE the NPM.
        (tokenId, liquidity, amount0, amount1) = INonfungiblePositionManagerFork(npm).mint(
            INonfungiblePositionManagerFork.MintParams({
                token0: p.token0,
                token1: p.token1,
                fee: p.feeTier,
                tickLower: p.tickLower,
                tickUpper: p.tickUpper,
                amount0Desired: p.amount0Desired,
                amount1Desired: p.amount1Desired,
                amount0Min: p.amount0Min,
                amount1Min: p.amount1Min,
                recipient: msg.sender,
                deadline: p.deadline
            })
        );

        // Effects first: clear the NPM allowances before any external refund transfer
        // (checks-effects-interactions ordering on the mint path).
        if (p.amount0Desired > 0) IERC20(p.token0).forceApprove(npm, 0);
        if (p.amount1Desired > 0) IERC20(p.token1).forceApprove(npm, 0);

        // 4. REFUND: desired-minus-owed back to the caller, same transaction.
        if (p.amount0Desired > amount0) {
            IERC20(p.token0).safeTransfer(msg.sender, p.amount0Desired - amount0);
        }
        if (p.amount1Desired > amount1) {
            IERC20(p.token1).safeTransfer(msg.sender, p.amount1Desired - amount1);
        }

        // 5. FEE FORWARD: flat fee to the endowment pocket (the timelock accepts native
        //    ETH — WellstreetTimelock.sol:124). 100% recycles into the endowment.
        (bool ok,) = timelock.call{value: fee}("");
        if (!ok) revert FeeForwardFailed();

        // 6. END-OF-TX ZERO-BALANCE INVARIANT: the router retains NOTHING (A6 —
        //    asserted after BOTH the refund and the fee forward, on every path).
        uint256 left0 = IERC20(p.token0).balanceOf(address(this));
        uint256 left1 = IERC20(p.token1).balanceOf(address(this));
        if (left0 != 0) revert BalanceLeak(p.token0, left0);
        if (left1 != 0) revert BalanceLeak(p.token1, left1);
        uint256 leftNative = address(this).balance;
        if (leftNative != 0) revert NativeLeak(leftNative);

        emit FleetPositionOpened(
            msg.sender, p.token0, p.token1, p.feeTier, p.tickLower, p.tickUpper, tokenId, liquidity, amount0, amount1
        );
    }

    /// @notice Change the flat fee. The ONLY fee knob (A6) — callable exclusively by
    ///         the treasury timelock (2-of-3 Safe + 48h queue), capped by MAX_FEE.
    function setFee(uint256 newFee) external {
        require(msg.sender == timelock, "ONLY_TIMELOCK");
        if (newFee > MAX_FEE) revert FeeAboveCeiling(newFee, MAX_FEE);
        uint256 old = fee;
        fee = newFee;
        emit FeeUpdated(old, newFee);
    }
}

/// @notice Minimal external view of the pinned fork position manager's mint, modeled on
///         the verified deployed source (docs/ops/phase0/npm-mint-payer-semantics.md):
///         mint pulls amounts from msg.sender (payer = the mint caller) via
///         safeTransferFrom in its mint callback, enforces amount0Min/amount1Min and the
///         deadline internally, and mints the position NFT to params.recipient.
interface INonfungiblePositionManagerFork {
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    function mint(MintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
}
