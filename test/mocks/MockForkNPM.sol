// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Mock of the pinned fork position manager (0x73991a25…0D3) modeling ONLY the
///         real behavior the FleetRouter battery depends on — pinned from the verified
///         deployed source in docs/ops/phase0/npm-mint-payer-semantics.md (2026-09-20):
///          1. mint PULLS the consumed amounts from msg.sender (the mint caller) via
///             ERC-20 transferFrom — the payer is the caller, who must have approved
///             the NPM (PeripheryPayments.pay -> TransferHelper.safeTransferFrom).
///          2. Consumed amounts can be STRICTLY LESS than desired (one side binds at
///             the pool price) — modeled with per-side consume caps; the caller's
///             refund is desired-minus-consumed.
///          3. Slippage is enforced INSIDE the NPM with the periphery message
///             'Price slippage check'; the deadline with 'Transaction too old'.
///          4. The position NFT is minted to params.recipient (the pool-side owner is
///             the NPM itself — modeled implicitly, the battery only reads ownerOf).
///         NEVER canonical Uniswap periphery assumptions (audit F-11: this fork's
///         collect() auto-pokes — a behavior outside this battery's scope, which does
///         not exercise collect).
contract MockForkNPM {
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

    struct Position {
        address owner;
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
    }

    uint256 public nextId = 1;
    mapping(uint256 => Position) public positions;

    /// @notice Per-side consume caps: 0 = consume the full desired amount; > 0 = the
    ///         pool price binds that side at the cap (consumed = min(desired, cap)).
    uint256 public consumeCap0;
    uint256 public consumeCap1;

    /// @notice Evidence trail of the LAST mint's pull — proves the payer is the mint
    ///         caller (msg.sender), the pin the whole custody model rests on.
    address public lastPayer;
    uint256 public lastPulled0;
    uint256 public lastPulled1;

    function setConsumeCaps(uint256 cap0, uint256 cap1) external {
        consumeCap0 = cap0;
        consumeCap1 = cap1;
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        return positions[tokenId].owner;
    }

    function mint(MintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        require(block.timestamp <= params.deadline, "Transaction too old");

        amount0 = params.amount0Desired;
        amount1 = params.amount1Desired;
        if (consumeCap0 != 0 && amount0 > consumeCap0) amount0 = consumeCap0;
        if (consumeCap1 != 0 && amount1 > consumeCap1) amount1 = consumeCap1;

        require(amount0 >= params.amount0Min && amount1 >= params.amount1Min, "Price slippage check");

        // THE PIN: pull from msg.sender (the mint caller) via transferFrom — the router
        // must be approved; a direct caller must be approved. Same code path both ways.
        if (amount0 > 0) IERC20(params.token0).transferFrom(msg.sender, address(this), amount0);
        if (amount1 > 0) IERC20(params.token1).transferFrom(msg.sender, address(this), amount1);
        lastPayer = msg.sender;
        lastPulled0 = amount0;
        lastPulled1 = amount1;

        // Deterministic liquidity: a pure function of the consumed amounts, so two
        // mints with identical calldata and identical pool state land identical
        // positions (the verbatim-mint equivalence assertion).
        liquidity = uint128(amount0 + amount1);

        tokenId = nextId++;
        positions[tokenId] = Position({
            owner: params.recipient,
            token0: params.token0,
            token1: params.token1,
            fee: params.fee,
            tickLower: params.tickLower,
            tickUpper: params.tickUpper,
            liquidity: liquidity
        });
    }
}

/// @notice Minimal stand-in for the TreasuryTimelock fee pocket: accepts native ETH and
///         tracks the running total (the real WellstreetTimelock has a payable
///         fallback at WellstreetTimelock.sol:124; the fee-forward path only needs
///         "accepts ETH and can be pranked as an address").
contract MockFeeReceiver {
    uint256 public totalReceived;

    receive() external payable {
        totalReceived += msg.value;
    }
}

/// @notice Hostile token that re-enters the router's guarded open from inside its
///         transferFrom (the router's own PULL leg) with the configured calldata and
///         value, RECORDING the (ok, returndata) of the re-entry instead of propagating
///         it — so the outer open completes and the battery can assert the inner call
///         reverted with exactly the guard's selector (ReentrancyGuardReentrantCall).
///         Self-contained minimal ERC-20 surface (mint/approve/transferFrom only).
contract MockReenteringOpenToken {
    address public attackRouter;
    uint256 public attackValue;
    bytes public attackCalldata;
    bool public lastAttackOk = true;
    bytes public lastAttackReturndata;
    bool private attacking;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function setAttack(address router_, uint256 value_, bytes calldata cd) external {
        attackRouter = router_;
        attackValue = value_;
        attackCalldata = cd;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (attackRouter != address(0) && to == attackRouter && !attacking) {
            attacking = true;
            (bool ok, bytes memory ret) = attackRouter.call{value: attackValue}(attackCalldata);
            lastAttackOk = ok;
            lastAttackReturndata = ret;
            attacking = false;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
