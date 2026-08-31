// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title YieldShares — ERC-4626 vault wrapping a tokenized stock token on Robinhood
///        Chain (4663). Vault #1 wraps SPY; the share token is "Wellstreet SPY" /
///        "ws-SPY" (name/symbol are constructor args, pinned identically in the deploy
///        script, docs and frontend config).
/// @notice Design invariants (each has a forge test):
///          1. First-depositor inflation fails: a VIRTUAL SHARE OFFSET (see
///             _SHARE_DECIMALS_OFFSET) makes the classic "mint 1 wei, donate, steal
///             the next depositor's dust share" attack uneconomical.
///          2. Donation neutrality: totalAssets is STORAGE-based, not
///             balanceOf(address(this)). Tokens force-sent to the vault never move the
///             share price and can never be claimed by depositors or skimmed.
///          3. Fee-on-transfer assets are rejected: a deposit whose received amount
///             differs from the debited amount reverts (accounting can never drift).
///          4. Yield is HARVESTER-GATED: only the harvester contract can raise
///             totalAssets (via harvest()), and it does so WITHOUT minting shares —
///             fee income accrues pro-rata to existing depositors.
///          5. Deposits are pausable; redemptions are NOT. Two pausers exist:
///             (a) the 48h treasury timelock and (b) a function-limited pause-only EOA
///             (revocable by the timelock — a compromised pause key can be stripped).
///             There is NO pause path for redeem/withdraw: the protocol's own controls
///             can never trap user funds.
///          6. Protocol fee (feeBps, initial 1000 = 10%, hard cap MAX_FEE_BPS = 2000)
///             is settable ONLY by the treasury timelock. The harvester reads this
///             value at harvest time to split proceeds (the rest goes to depositors).
/// @dev The underlying stock token is issuer-controlled: the issuer can pause it, and
///      a fleet-wide beacon upgrade surface exists behind every tokenized stock. That
///      risk is outside this contract's control and is disclosed in the docs.
contract YieldShares is ERC4626, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    /// @notice Hard cap on feeBps (20%). This is the only structural bound on fee
    ///         escalation; changes still require a public 48h timelock queue.
    uint256 public constant MAX_FEE_BPS = 2_000;
    /// @notice Virtual share offset for the ERC-4626 conversion math. With this offset,
    ///         a depositor of `x` assets into an empty vault mints `x * 10**6` shares,
    ///         so inflating the exchange rate to steal a later depositor's shares
    ///         requires donating ~10**6 times their deposit — uneconomical.
    uint8 private constant _SHARE_DECIMALS_OFFSET = 6;

    /// @notice The 48h treasury timelock: the only admin of this vault (fee, pause
    ///         policy, pause-role revocation, harvester wiring).
    address public immutable timelock;

    /// @notice Function-limited pause authority (the Wellstreet deployer EOA at
    ///         deploy). Can ONLY call setDepositPaused. Revocable by the timelock
    ///         via setPauser(address(0)).
    address public pauser;

    /// @notice The harvester contract — the only address allowed to raise totalAssets.
    ///         Set by the timelock after the harvester is deployed (the harvester needs
    ///         the vault address, so it cannot be a constructor arg).
    address public harvester;

    /// @notice Protocol fee in bps of harvested yield (initial 1000 = 10% to the
    ///         protocol / 90% to depositors). Settable ONLY by the timelock, capped at
    ///         MAX_FEE_BPS. The harvester reads this live at every harvest.
    uint256 public feeBps;

    /// @notice STORAGE-based totalAssets. Donations to the vault are deliberately
    ///         excluded: they sit as unaccounted excess backing, move no price, and
    ///         are claimable by nobody.
    uint256 private _totalAssetsStored;

    /// @notice Deposit pause flag. Checked ONLY on the deposit/mint path.
    bool public depositsPaused;

    event DepositPauseSet(bool paused, address indexed by);
    event PauserSet(address indexed oldPauser, address indexed newPauser);
    event HarvesterSet(address indexed oldHarvester, address indexed newHarvester);
    event FeeBpsSet(uint256 oldFeeBps, uint256 newFeeBps);
    event YieldHarvested(uint256 indexed assets, uint256 newTotalAssets);

    error ZeroAddress();
    error FeeTooHigh(uint256 requested, uint256 max);
    error NotTimelock(address caller);
    error NotPauser(address caller);
    error NotHarvester(address caller);
    error DepositsPaused();
    error FeeOnTransferDetected(uint256 debited, uint256 received);
    error ExcessTooSmall(uint256 requested, uint256 excess);
    error ZeroHarvest();

    /// @param asset_    The wrapped tokenized stock token (e.g. SPY).
    /// @param name_     Share token name (e.g. "Wellstreet SPY").
    /// @param symbol_   Share token symbol (e.g. "ws-SPY").
    /// @param timelock_ The 48h treasury timelock (sole admin).
    /// @param pauser_   The function-limited pause-only EOA (may be address(0) to skip).
    /// @param feeBps_   Initial protocol fee in bps (must be <= MAX_FEE_BPS).
    constructor(
        IERC20 asset_,
        string memory name_,
        string memory symbol_,
        address timelock_,
        address pauser_,
        uint256 feeBps_
    ) ERC20(name_, symbol_) ERC4626(asset_) ReentrancyGuard() {
        if (timelock_ == address(0)) revert ZeroAddress();
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh(feeBps_, MAX_FEE_BPS);
        timelock = timelock_;
        pauser = pauser_;
        feeBps = feeBps_;
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    /// @notice STORAGE-based totalAssets — the ERC-4626 accounting figure. Deliberately
    ///         NOT the vault's raw token balance: direct token donations never move the
    ///         share price (donation neutrality) and cannot be skimmed by depositors.
    function totalAssets() public view override returns (uint256) {
        return _totalAssetsStored;
    }

    /// @notice Tokens held by the vault above the accounting figure: donations and
    ///         yield pushed by the harvester that has not been credited yet. Claimable
    ///         by nobody; only a harvester push (harvest) converts excess into
    ///         accounted assets, and only by the exact pushed amount.
    function unaccountedAssets() external view returns (uint256) {
        return IERC20(asset()).balanceOf(address(this)) - _totalAssetsStored;
    }

    /// @dev Virtual share offset applied to the ERC-4626 conversion math (anti
    ///      first-depositor inflation).
    function _decimalsOffset() internal pure override returns (uint8) {
        return _SHARE_DECIMALS_OFFSET;
    }

    /// @notice 0 when deposits are paused (frontend truth), else unbounded.
    function maxDeposit(address) public view override returns (uint256) {
        return depositsPaused ? 0 : type(uint256).max;
    }

    /// @notice 0 when deposits are paused (frontend truth), else unbounded.
    function maxMint(address) public view override returns (uint256) {
        return depositsPaused ? 0 : type(uint256).max;
    }

    // ------------------------------------------------------------------
    // Timelock-only admin
    // ------------------------------------------------------------------

    modifier onlyTimelock() {
        if (msg.sender != timelock) revert NotTimelock(msg.sender);
        _;
    }

    /// @notice Set the protocol fee in bps. ONLY the treasury timelock (via its 48h
    ///         queue). Capped at MAX_FEE_BPS (2000). The harvester picks the new value
    ///         up on its next harvest automatically.
    function setFeeBps(uint256 newFeeBps) external onlyTimelock {
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh(newFeeBps, MAX_FEE_BPS);
        emit FeeBpsSet(feeBps, newFeeBps);
        feeBps = newFeeBps;
    }

    /// @notice Pause or unpause DEPOSITS ONLY. Callable by the treasury timelock OR by
    ///         the function-limited pause-only EOA. redeem/withdraw NEVER consult this
    ///         flag — user funds are never trapped by protocol controls.
    function setDepositPaused(bool paused) external {
        if (msg.sender != timelock && msg.sender != pauser) revert NotPauser(msg.sender);
        depositsPaused = paused;
        emit DepositPauseSet(paused, msg.sender);
    }

    /// @notice Grant/rotate/revoke the pause-only role. ONLY the treasury timelock.
    ///         Revocation = setPauser(address(0)) — a compromised pause key can be
    ///         stripped within one 48h timelock window.
    function setPauser(address newPauser) external onlyTimelock {
        emit PauserSet(pauser, newPauser);
        pauser = newPauser;
    }

    /// @notice Wire the harvester contract. ONLY the treasury timelock. The harvester
    ///         is deployed after the vault (it takes the vault address as a constructor
    ///         arg), so wiring is a queued timelock call in the deploy flow.
    function setHarvester(address newHarvester) external onlyTimelock {
        emit HarvesterSet(harvester, newHarvester);
        harvester = newHarvester;
    }

    // ------------------------------------------------------------------
    // Harvester-gated yield
    // ------------------------------------------------------------------

    /// @notice Credit `assets` of freshly harvested yield WITHOUT minting any shares:
    ///         the vault's totalAssets rises, so every existing depositor's share
    ///         price rises pro-rata. ONLY the harvester contract may call this.
    /// @dev The harvester transfers the yield into the vault BEFORE calling, then
    ///      credits exactly what it pushed. The amount is bounded by the vault's
    ///      unaccounted excess, so a harvester can never credit more than physically
    ///      arrived, and donations can never be credited (the harvester only declares
    ///      what it itself transferred).
    function harvest(uint256 assets) external nonReentrant {
        if (msg.sender != harvester) revert NotHarvester(msg.sender);
        if (assets == 0) revert ZeroHarvest();
        uint256 excess = IERC20(asset()).balanceOf(address(this)) - _totalAssetsStored;
        if (assets > excess) revert ExcessTooSmall(assets, excess);
        _totalAssetsStored += assets;
        emit YieldHarvested(assets, _totalAssetsStored);
    }

    // ------------------------------------------------------------------
    // ERC-4626 overrides (fee-on-transfer rejection + storage accounting)
    // ------------------------------------------------------------------

    /// @dev Deposit flow with fee-on-transfer rejection: the vault must receive EXACTLY
    ///      `assets`, otherwise the whole deposit reverts (accounting can never drift
    ///      from reality). Also the ONLY pause checkpoint in the entire contract.
    function _deposit(address caller, address receiver, uint256 assets, uint256 shares)
        internal
        override
        nonReentrant
    {
        if (depositsPaused) revert DepositsPaused();
        IERC20 underlying = IERC20(asset());
        uint256 balanceBefore = underlying.balanceOf(address(this));
        underlying.safeTransferFrom(caller, address(this), assets);
        uint256 received = underlying.balanceOf(address(this)) - balanceBefore;
        if (received != assets) revert FeeOnTransferDetected(assets, received);
        _totalAssetsStored += assets;
        _mint(receiver, shares);
    }

    /// @dev Redeem/withdraw flow. NO pause check exists on this path — by design, the
    ///      protocol's own controls can never trap user funds. Storage accounting is
    ///      debited before the transfer (checks-effects-interactions).
    function _withdraw(address caller, address receiver, address owner, uint256 assets, uint256 shares)
        internal
        override
        nonReentrant
    {
        if (caller != owner) {
            _spendAllowance(owner, caller, shares);
        }
        _burn(owner, shares);
        _totalAssetsStored -= assets;
        IERC20(asset()).safeTransfer(receiver, assets);
    }
}
