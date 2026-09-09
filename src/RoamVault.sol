// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @dev The roamer surface RoamVault drives (the vault-authorized deploy/egress pair).
///      The roamer's own minimal view of THIS contract lives in RoamingHarvester.sol —
///      the two interfaces are deliberately hand-kept and battery-pinned.
interface IRoamHarvesterTarget {
    /// @notice Deploy `capitalUsdg` of vault capital into the allowlisted book described
    ///         by `key` (a BookKey payload; the band is capital-driven — sized by the
    ///         roamer's own band math from the capital received). Returns (deployedVal,
    ///         residual): the USDG-denominated value actually locked into the position
    ///         and the un-deployed USDG leftover (returned to the vault, NEVER the burn
    ///         accrual). Only the bound vault may call it.
    function vaultDeploy(bytes calldata key, uint256 capitalUsdg)
        external
        returns (uint256 deployedVal, uint256 residual);

    /// @notice Close pro-rata decrease-only slices of open vault-tagged positions until
    ///         at least `shortfallUsdg` USDG is raised (or every vault position is
    ///         exhausted), fee-collect into the accrual lane FIRST so redeemer payouts
    ///         stay principal-side, convert the non-USDG legs on the position's own
    ///         venue, and transfer the proceeds to the vault. Returns the USDG proceeds
    ///         actually delivered (<= requested when positions are worth less than
    ///         marked — the divergence lands on the redeemer's own slice). NOT a
    ///         migration: never consumes MAX_MIGRATIONS_PER_PERIOD, never gated by
    ///         MIN_HOLD. Only the bound vault may call it.
    function vaultEgress(uint256 shortfallUsdg) external returns (uint256 proceedsUsdg);
}

/// @title RoamVault — the user-seeded roamer vault (USDG anchor, ERC-4626)
/// @notice FORK of the audited YieldShares chassis (audit-inherited machinery kept
///         line-for-line where possible; every delta carries a ROAMVAULT comment):
///          INHERITED (audited): virtual share offset (first-depositor inflation
///          fails), STORAGE-based totalAssets (donation neutrality), fee-on-transfer
///          rejection, deposits-pausable-only (redemptions structurally unpausable),
///          excess-bounded harvest() credit, backingCoverage observability.
///          ROAMVAULT DELTAS (the capital-flight extension):
///          1. DEPOSITOR CAPITAL IS THE FARMED PRINCIPAL — the timelock-queued
///             vaultDeploy moves idle USDG into the allowlisted v4 books through the
///             roamer's vault-authorized deploy seam; egress pulls it back for
///             redemptions. A DEPLOYED-CAPITAL BOOK marks deployed capital AT PAR in
///             USDG; totalAssets() = idle book + deployed book, so the share price
///             never marks down merely because capital deployed and never claims idle
///             capital that is not there.
///          2. HONEST IL — realized IL writes the share price DOWN: the roamer pushes
///             its realized-IL mark at vault-tagged migration completion through
///             applyRealizedIL (harvester-gated); losses debit the deployed book
///             (floored at zero), gains restore it only up to the outstanding
///             deploy-time par (write-up above par happens only through actual egress
///             proceeds and the yield lane). Egress slippage and post-mark divergence
///             are realized ONCE, through actual proceeds vs the redeemer's claim —
///             never a ledger-driven second deduction.
///          3. 90/10 YIELD SPLIT AS NAMED CONSTANTS — DEPOSITOR_BPS = 9000 of the
///             vault lane's accounted yield is swapped to USDG by the roamer and
///             pushed into the vault via the excess-bounded harvest() seam (share
///             price rises); BURN_BPS = 1000 burns $WELL through the roamer's
///             sweepToBurn machinery. Dev take STRUCTURALLY ZERO: there is no feeBps,
///             no setFeeBps, no treasury cut anywhere on this path.
///          4. DEPOSIT_CAP — a Safe-settable cap with an IMMUTABLE ceiling, enforced
///             via maxDeposit() AND maxMint() BOTH (overriding only maxDeposit would
///             leave mint() as a cap bypass).
///          5. WITHDRAWAL LIVENESS — redeem() serves IDLE-FIRST and closes pro-rata
///             decrease-only slices of vault-tagged positions ONLY for the shortfall;
///             depositor exits are never gated by roamer MIN_HOLD; minOut floors are
///             per-call and REDEEMER-bounded (redeemWithMinOut); the vanilla ERC-4626
///             redeem defaults its floor to the roamer's house ±SWAP_SLIPPAGE_BPS
///             band, never 0.
///         SAFETY-SEQUENCE PIN: the constructor INIT-PAUSES deposits
///         (depositsPaused = true — the chassis default is false and its constructor
///         never touches it). Deposits open only after the composition audit lands
///         AND DEPOSIT_CAP is set — contract-enforced, not intention-enforced.
contract RoamVault is ERC4626, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;

    // ------------------------------------------------------------------
    // ROAMVAULT: the 90/10 split as NAMED CONSTANTS (never bare digits)
    // ------------------------------------------------------------------

    /// @notice Share of the vault lane's accounted yield that belongs to depositors:
    ///         the roamer swaps it to USDG and pushes it into the vault via the
    ///         excess-bounded harvest() seam (share price rises). Read by the roamer.
    uint256 public constant DEPOSITOR_BPS = 9000;
    /// @notice Share of the vault lane's accounted yield that burns $WELL through the
    ///         roamer's sweepToBurn machinery (a protocol fee that BURNS, not team
    ///         income — the dev take is structurally zero on this path). Read by the
    ///         roamer. DEPOSITOR_BPS + BURN_BPS == BPS.
    uint256 public constant BURN_BPS = 1000;

    /// @notice Virtual share offset for the ERC-4626 conversion math (anti
    ///         first-depositor inflation — audited chassis machinery, inherited).
    uint8 private constant _SHARE_DECIMALS_OFFSET = 6;

    // ------------------------------------------------------------------
    // ROAMVAULT: the deposit cap (Safe-settable start, IMMUTABLE ceiling)
    // ------------------------------------------------------------------

    /// @notice IMMUTABLE ceiling on DEPOSIT_CAP: 250,000 USDG (6 decimals). The cap
    ///         bounds pro-rata exit gas and per-book impact; raised only through the
    ///         48h timelock, never above this ceiling.
    uint256 public immutable DEPOSIT_CAP_CEILING;
    /// @notice The operating deposit cap (Safe-settable within the ceiling; deploy
    ///         start 25,000 USDG). Enforced on BOTH the deposit and mint routes.
    uint256 public DEPOSIT_CAP;

    /// @notice The 48h treasury timelock: the only admin of this vault (cap, pause
    ///         policy, pause-role revocation, harvester wiring, deploys).
    address public immutable timelock;

    /// @notice Function-limited pause authority. Can ONLY call setDepositPaused.
    ///         Revocable by the timelock via setPauser(address(0)).
    address public pauser;

    /// @notice The roamer contract — the only address allowed to raise the idle book
    ///         (harvest), debit the deployed book (applyRealizedIL), and move capital
    ///         (vaultDeploy/vaultEgress). Re-settable by the timelock (the roamer must
    ///         stay replaceable — NOT one-shot; the ONE-SHOT binding is the roamer's
    ///         setVault).
    address public harvester;

    /// @notice STORAGE-based IDLE book (audited chassis accounting). Donations to the
    ///         vault are deliberately excluded: they sit as unaccounted excess backing,
    ///         move no price, and are claimable by nobody.
    uint256 private _totalAssetsStored;

    /// @notice ROAMVAULT: the DEPLOYED-CAPITAL BOOK — vault capital deployed into the
    ///         roamer's books, marked AT PAR in USDG minus realized-IL debits. A
    ///         MARKING device, not an additive loss ledger.
    uint256 private _deployedBook;

    /// @notice ROAMVAULT: outstanding deploy-time par (gross deployed at par minus
    ///         par released at egress) — the ceiling that IL GAINS may restore the
    ///         book to (write-up above par happens only through actual proceeds).
    uint256 private _deployedPar;

    /// @notice Deposit pause flag. Checked ONLY on the deposit/mint path.
    ///         SAFETY-SEQUENCE PIN: the constructor sets this TRUE (init-paused).
    bool public depositsPaused;

    /// @notice ROAMVAULT: realized-IL marks reported in a NON-USDG denomination are
    ///         RECORDED here and surfaced on-chain but NOT applied to the USDG book —
    ///         v1 scope discloses them rather than silently converting with an
    ///         unpriced rate (no oracle). Vault books are USDG-paired, so the wired
    ///         topology reports USDG-denominated marks; this registry exists so a
    ///         foreign-denomination mark is never silently dropped.
    mapping(address => int256) public pendingIlByCurrency;

    event DepositPauseSet(bool paused, address indexed by);
    event PauserSet(address indexed oldPauser, address indexed newPauser);
    event HarvesterSet(address indexed oldHarvester, address indexed newHarvester);
    event DepositCapSet(uint256 oldCap, uint256 newCap);
    event YieldHarvested(uint256 indexed assets, uint256 newIdleBook);
    event VaultDeployed(bytes32 indexed keyHash, uint256 capital, uint256 deployedVal, uint256 residual);
    event VaultEgressSettled(uint256 requested, uint256 proceeds);
    event VaultILApplied(int256 indexed il, address indexed ilCurrency, uint256 newDeployedBook, bool appliedToBook);

    error ZeroAddress();
    error NotTimelock(address caller);
    error NotPauser(address caller);
    error NotHarvester(address caller);
    error DepositsPaused();
    error FeeOnTransferDetected(uint256 debited, uint256 received);
    error ExcessTooSmall(uint256 requested, uint256 excess);
    error ZeroHarvest();
    error CapAboveCeiling(uint256 requested, uint256 ceiling);
    error DeployExceedsIdle(uint256 requested, uint256 idle);
    error InsufficientBacking(uint256 requested, uint256 backing);
    error PayoutBelowMin(uint256 payout, uint256 minPayout);
    error HarvesterRequired();

    /// @notice Accept NATIVE residual from the roamer's deploy/migration residual
    ///         routing (ROAMVAULT item 5, DECISION 3ii/3iii): a vault book paired with
    ///         native (USDG/ETH) can return an ETH rounding residual. Native is NOT the
    ///         vault asset — it sits as unaccounted native excess (claimable by nobody,
    ///         the same custody-safe home as foreign-token residual dust), never
    ///         enters the USDG accounting, and idle vault capital never idles inside
    ///         the roamer.
    receive() external payable {}

    /// @param asset_    The vault asset: USDG (6 decimals).
    /// @param name_     Share token name (e.g. "Wellstreet Roam").
    /// @param symbol_   Share token symbol (e.g. "ws-ROAM").
    /// @param timelock_ The 48h treasury timelock (sole admin).
    /// @param pauser_   The function-limited pause-only EOA (may be address(0) to skip).
    /// @param depositCap_ Initial DEPOSIT_CAP (<= DEPOSIT_CAP_CEILING; deploy start
    ///                    25,000 USDG raw).
    constructor(
        IERC20 asset_,
        string memory name_,
        string memory symbol_,
        address timelock_,
        address pauser_,
        uint256 depositCap_
    ) ERC20(name_, symbol_) ERC4626(asset_) ReentrancyGuard() {
        if (timelock_ == address(0)) revert ZeroAddress();
        timelock = timelock_;
        pauser = pauser_;
        DEPOSIT_CAP_CEILING = 250_000 * 1e6; // IMMUTABLE ceiling (250,000 USDG, 6 dec)
        if (depositCap_ > DEPOSIT_CAP_CEILING) revert CapAboveCeiling(depositCap_, DEPOSIT_CAP_CEILING);
        DEPOSIT_CAP = depositCap_;
        // SAFETY-SEQUENCE PIN (structural): init-paused. The chassis default is false
        // and its constructor never touches this flag — the fork DEPLOYS PAUSED until
        // the timelock (or pauser) opens deposits after the composition audit + cap.
        depositsPaused = true;
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    /// @notice STORAGE-based totalAssets = the IDLE book + the DEPLOYED book marked at
    ///         par (minus realized-IL debits). NOT the vault's raw token balance:
    ///         donations never move the share price, and deployed capital is marked —
    ///         never claimed as idle, never marked down merely for being deployed.
    function totalAssets() public view override returns (uint256) {
        return _totalAssetsStored + _deployedBook;
    }

    /// @notice ROAMVAULT: the deployed-capital book on-chain (with its events, this
    ///         makes per-depositor IL windows derivable without an indexer).
    function deployedBook() external view returns (uint256) {
        return _deployedBook;
    }

    /// @notice ROAMVAULT: the idle book alone (capital physically custodyable here).
    function idleBook() external view returns (uint256) {
        return _totalAssetsStored;
    }

    /// @notice ROAMVAULT: outstanding deploy-time par — the ceiling IL gains may
    ///         restore the deployed book to (write-up above par happens only through
    ///         actual proceeds and the yield lane, never through a mark).
    function deployedPar() external view returns (uint256) {
        return _deployedPar;
    }

    /// @notice Tokens held by the vault above the accounting figure: donations and
    ///         yield pushed by the harvester that has not been credited yet. Claimable
    ///         by nobody; only a harvester push (harvest) converts excess into
    ///         accounted assets, and only by the exact pushed amount.
    function unaccountedAssets() external view returns (uint256) {
        uint256 balance = IERC20(asset()).balanceOf(address(this));
        return balance > totalAssets() ? balance - totalAssets() : 0;
    }

    /// @notice On-chain backing coverage: the vault's raw asset balance scaled against
    ///         the STORED IDLE book, in 1e18 fixed point (audited chassis semantics,
    ///         YieldShares.sol:152-156 — the denominator is the idle book, NOT
    ///         totalAssets(): with capital deployed both sides of that ratio fall by X
    ///         together, so coverage stays 1e18 while capital is deployed — the
    ///         invariant the deploy debit preserves by construction. The deployed
    ///         capital is marked separately in the deployed book and disclosed via
    ///         deployedBook()/deployedPar(); the idle book it backs is fully physical,
    ///         which is exactly what redeems IDLE-FIRST). ROAMVAULT fix 2026-09-08:
    ///         the fork initially divided by totalAssets() (idle + deployed), which
    ///         contradicts the chassis form and breaks the pinned property.
    function backingCoverage() external view returns (uint256) {
        if (_totalAssetsStored == 0) return 1e18;
        return Math.mulDiv(IERC20(asset()).balanceOf(address(this)), 1e18, _totalAssetsStored);
    }

    /// @dev Virtual share offset applied to the ERC-4626 conversion math (anti
    ///      first-depositor inflation).
    function _decimalsOffset() internal pure override returns (uint8) {
        return _SHARE_DECIMALS_OFFSET;
    }

    /// @notice Shares <-> assets at the marked price (idle + deployed book). Explicit
    ///         overrides keep the conversion surface visible in THIS contract's source
    ///         (the composition audit reads this file, not the inheritance chain).
    function convertToShares(uint256 assets) public view override returns (uint256) {
        return super.convertToShares(assets);
    }

    /// @notice See convertToShares.
    function convertToAssets(uint256 shares) public view override returns (uint256) {
        return super.convertToAssets(shares);
    }

    /// @notice 0 when deposits are paused, else the remaining cap headroom — the cap
    ///         is enforced on BOTH routes (this view backs deposit()).
    function maxDeposit(address) public view override returns (uint256) {
        return depositsPaused ? 0 : _capHeadroom();
    }

    /// @notice 0 when deposits are paused, else the remaining cap headroom — the cap
    ///         is enforced on BOTH routes (this view backs mint(); overriding only
    ///         maxDeposit would leave mint() as a cap bypass).
    function maxMint(address) public view override returns (uint256) {
        return depositsPaused ? 0 : _capHeadroom();
    }

    /// @dev Remaining DEPOSIT_CAP headroom over the accounted figure (floored at 0).
    function _capHeadroom() internal view returns (uint256) {
        uint256 ta = totalAssets();
        return DEPOSIT_CAP > ta ? DEPOSIT_CAP - ta : 0;
    }

    // ------------------------------------------------------------------
    // ERC-4626 entry overrides (explicit, so the audit reads one file)
    // ------------------------------------------------------------------

    /// @notice Deposit assets for shares — bounded by maxDeposit (pause + cap).
    function deposit(uint256 assets, address receiver) public override returns (uint256) {
        return super.deposit(assets, receiver);
    }

    /// @notice Mint shares for assets — bounded by maxMint (pause + cap: the SAME cap
    ///         as the deposit route, by construction).
    function mint(uint256 shares, address receiver) public override returns (uint256) {
        return super.mint(shares, receiver);
    }

    /// @notice Redeem shares for assets: idle-first, pro-rata instant exit, NO pause
    ///         path (redemptions are structurally unpausable). The slippage floor is
    ///         the roamer's house ±SWAP_SLIPPAGE_BPS band applied per converted leg —
    ///         never 0, never a vault-held global floor. For a redeemer-set floor use
    ///         redeemWithMinOut.
    function redeem(uint256 shares, address receiver, address owner) public override returns (uint256) {
        uint256 assets = previewRedeem(shares);
        _redeem(msg.sender, receiver, owner, assets, shares, 0);
        return assets;
    }

    /// @notice Redeem with a REDEEMER-BOUNDED per-call payout floor: reverts when the
    ///         idle-plus-egress payout lands below `minPayout`. The floor lives for
    ///         THIS call only (a stale vault-held global floor would be a redemption
    ///         trap).
    function redeemWithMinOut(uint256 shares, address receiver, address owner, uint256 minPayout)
        external
        returns (uint256)
    {
        uint256 assets = previewRedeem(shares);
        _redeem(msg.sender, receiver, owner, assets, shares, minPayout);
        return assets;
    }

    /// @notice Withdraw a target asset amount: idle-first, pro-rata instant exit, no
    ///         pause path.
    function withdraw(uint256 assets, address receiver, address owner) public override returns (uint256) {
        uint256 shares = previewWithdraw(assets);
        _redeem(msg.sender, receiver, owner, assets, shares, 0);
        return shares;
    }

    // ------------------------------------------------------------------
    // Timelock-only admin
    // ------------------------------------------------------------------

    modifier onlyTimelock() {
        if (msg.sender != timelock) revert NotTimelock(msg.sender);
        _;
    }

    /// @notice Set the operating deposit cap. ONLY the treasury timelock, hard-bounded
    ///         by the IMMUTABLE DEPOSIT_CAP_CEILING (start low, raise via the 48h
    ///         timelock within the ceiling; the mandatory composition audit precedes
    ///         gates opening).
    function setDepositCap(uint256 newCap) external onlyTimelock {
        if (newCap > DEPOSIT_CAP_CEILING) revert CapAboveCeiling(newCap, DEPOSIT_CAP_CEILING);
        emit DepositCapSet(DEPOSIT_CAP, newCap);
        DEPOSIT_CAP = newCap;
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
    function setPauser(address newPauser) external onlyTimelock {
        emit PauserSet(pauser, newPauser);
        pauser = newPauser;
    }

    /// @notice Wire the roamer contract. ONLY the treasury timelock, RE-SETTABLE (the
    ///         roamer stays replaceable — the ONE-SHOT custody binding is the roamer's
    ///         own setVault). The deploy flow queues BOTH bindings: this AND
    ///         roamer.setVault(vault, asset).
    function setHarvester(address newHarvester) external onlyTimelock {
        emit HarvesterSet(harvester, newHarvester);
        harvester = newHarvester;
    }

    // ------------------------------------------------------------------
    // Harvester-gated yield (the 90% depositor lane's landing seam)
    // ------------------------------------------------------------------

    /// @notice Credit `assets` of freshly pushed vault-lane yield WITHOUT minting any
    ///         shares: the IDLE book rises, so every existing depositor's share price
    ///         rises pro-rata. ONLY the harvester (the roamer) may call this, and the
    ///         credit is bounded by the vault's unaccounted excess — the roamer
    ///         transfers the yield in BEFORE calling and can never credit more than
    ///         physically arrived (audited chassis machinery, unchanged in form).
    function harvest(uint256 assets) external nonReentrant {
        if (msg.sender != harvester) revert NotHarvester(msg.sender);
        if (assets == 0) revert ZeroHarvest();
        uint256 balance = IERC20(asset()).balanceOf(address(this));
        uint256 excess = balance > _totalAssetsStored ? balance - _totalAssetsStored : 0;
        if (assets > excess) revert ExcessTooSmall(assets, excess);
        _totalAssetsStored += assets;
        emit YieldHarvested(assets, _totalAssetsStored);
    }

    // ------------------------------------------------------------------
    // ROAMVAULT: the capital-flight seams (timelock-queued deploy + the
    // roamer-gated IL mark + the idle-first egress settlement)
    // ------------------------------------------------------------------

    /// @notice DEPLOY DEBIT (DECISION 9a): move `assets` of IDLE vault capital into the
    ///         roamer's allowlisted book (`key` = the roamer's BookKey payload,
    ///         `liquidity` = the Safe's off-chain sizing). ONLY the treasury timelock —
    ///         Safe-QUEUED through the 48h timelock and PERMISSIONLESSLY executable
    ///         (house seed custody pattern; deploy trigger v1, vault-auto-deploy is
    ///         deferred to v2). The idle book is debited by `assets`; the deployed book
    ///         is credited by the USDG value actually locked into the position; the
    ///         un-deployed residual RETURNS TO THE VAULT (credited back to the idle
    ///         book — never the burn accrual). backingCoverage stays 1e18 across the
    ///         deploy because both sides of that ratio fall by the deployed amount
    ///         together.
    function vaultDeploy(bytes calldata key, uint256 assets) external onlyTimelock nonReentrant {
        address roamer = harvester;
        if (roamer == address(0)) revert HarvesterRequired();
        if (assets > _totalAssetsStored) revert DeployExceedsIdle(assets, _totalAssetsStored);
        if (assets > IERC20(asset()).balanceOf(address(this))) revert InsufficientBacking(assets, IERC20(asset()).balanceOf(address(this)));

        _totalAssetsStored -= assets;
        IERC20(asset()).safeTransfer(roamer, assets);

        (uint256 deployedVal, uint256 residual) = IRoamHarvesterTarget(roamer).vaultDeploy(key, assets);
        _totalAssetsStored += residual; // deploy residual returns to the vault (DECISION 3iii)
        _deployedBook += deployedVal;
        _deployedPar += deployedVal; // the outstanding par baseline grows by the par deployed
        emit VaultDeployed(keccak256(abi.encodePacked(key)), assets, deployedVal, residual);
    }

    /// @notice HONEST IL (DECISION 9c): the roamer pushes its realized-IL mark at
    ///         VAULT-TAGGED migration completion. Roamer convention (>= 0 is a loss,
    ///         < 0 a gain): losses DEBIT the deployed book (floored so it never goes
    ///         negative — the share price writes the loss DOWN honestly); gains restore
    ///         the book only up to the outstanding deploy-time par (_deployedPar) —
    ///         write-up above par happens through actual egress proceeds and the 90%
    ///         yield lane, never through a mark. Marks denominated in a NON-USDG
    ///         currency are recorded in pendingIlByCurrency and surfaced via the event
    ///         (appliedToBook = false) — never silently dropped, never converted with
    ///         an unpriced rate (no oracle). The only entry that lowers the share-price
    ///         numerator besides the redemption/egress-settlement paths (harvest() is
    ///         credit-only). The roamer's RealizedIL event remains the crystallization
    ///         record; this event is the vault-side book movement.
    function applyRealizedIL(int256 il, address ilCurrency) external nonReentrant {
        if (msg.sender != harvester) revert NotHarvester(msg.sender);
        bool applied;
        if (ilCurrency == asset()) {
            applied = true;
            if (il >= 0) {
                uint256 loss = uint256(il);
                _deployedBook = loss < _deployedBook ? _deployedBook - loss : 0; // floored, never negative
            } else {
                uint256 gain = uint256(-1 * il);
                uint256 restored = _deployedBook + gain;
                _deployedBook = restored <= _deployedPar ? restored : _deployedPar; // capped at deploy-time par
            }
        } else {
            pendingIlByCurrency[ilCurrency] += il; // recorded + surfaced, NOT applied (no unpriced conversion)
        }
        emit VaultILApplied(il, ilCurrency, _deployedBook, applied);
    }

    // ------------------------------------------------------------------
    // ERC-4626 overrides (fee-on-transfer rejection + storage accounting
    // + the idle-first pro-rata instant-exit settlement)
    // ------------------------------------------------------------------

    /// @dev Deposit flow with fee-on-transfer rejection: the vault must receive EXACTLY
    ///      `assets`, otherwise the whole deposit reverts. Also the ONLY pause
    ///      checkpoint in the entire contract (redemptions are structurally unpausable).
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
        _totalAssetsStored += assets; // deposits always land in the IDLE book
        _mint(receiver, shares);
    }

    /// @dev WITHDRAWAL LIVENESS (DECISION 2): serve the payout IDLE-FIRST from the
    ///      vault's own balance, then close PRO-RATA DECREASE-ONLY slices of
    ///      vault-tagged roamer positions for the shortfall. The redeemer's payout is
    ///      principal-side (the roamer fee-collects into the accrual lane BEFORE the
    ///      principal decrease). Conversion slippage and post-mark divergence land on
    ///      the redeemer's own slice through the ACTUAL proceeds — the books debit
    ///      exactly the claim (idle leg + the deployed book's marked share), never a
    ///      second deduction of the same loss. NO pause check exists on this path.
    ///      ROAMVAULT V-1 note 2026-09-08: this override is DEAD CODE — both OZ
    ///      entries that would reach it (redeem/withdraw) are overridden above to
    ///      call _redeem directly; the guard and the settlement live on _redeem.
    function _withdraw(address caller, address receiver, address owner, uint256 assets, uint256 shares)
        internal
        override
        nonReentrant
    {
        _redeem(caller, receiver, owner, assets, shares, 0);
    }

    /// @dev The unified redemption settlement (redeem/withdraw/redeemWithMinOut all
    ///      land here). `minPayout` = the redeemer's per-call floor (0 for the vanilla
    ///      entries — the house per-leg band inside the roamer is the default floor).
    ///      ROAMVAULT V-1 fix 2026-09-08 (composition audit): the design pin houses
    ///      nonReentrant on EVERY state-changing entry — the three live redemption
    ///      entries converge HERE, so the guard lives here (the OZ _withdraw override
    ///      above is unreachable dead code: both OZ entries that would reach it are
    ///      overridden). Checks-effects-interactions is now TRUE rather than
    ///      commented: the shares burn and BOTH books debit — the deployed book AND
    ///      the outstanding par (V-3) — BEFORE the egress external call, and the
    ///      proceeds pass straight out in the payout, so a mid-egress reentrant
    ///      state-write can no longer clobber a stale post-call cache (the audited
    ///      chassis guards its one shared internal hook the same way,
    ///      YieldShares.sol:269-278).
    function _redeem(address caller, address receiver, address owner, uint256 assets, uint256 shares, uint256 minPayout)
        internal
        nonReentrant
    {
        if (caller != owner) {
            _spendAllowance(owner, caller, shares);
        }
        uint256 idle = _totalAssetsStored;
        uint256 deployed = _deployedBook;
        if (assets > idle + deployed) revert InsufficientBacking(assets, idle + deployed);

        // Effects first: burn the shares, split the claim into the idle leg and the
        // deployed-book shortfall (the shortfall is <= the deployed book whenever the
        // claim is backed — floored defensively anyway), and release BOTH the book
        // and the outstanding par (V-3 fix 2026-09-08: the par decrements WITH the
        // book, so the IL-gain cap tracks the OUTSTANDING deploy-time par — gross
        // deployed minus par released — never the gross-ever figure; DECISION 9).
        _burn(owner, shares);
        uint256 idlePaid = assets <= idle ? assets : idle;
        uint256 shortfall = assets - idlePaid;
        if (shortfall > deployed) shortfall = deployed; // defensive floor, never egress past the marked book
        _totalAssetsStored = idle - idlePaid;
        if (shortfall > 0) {
            _deployedBook = deployed - shortfall; // release at the CURRENT marked value (par minus marks)
            _deployedPar = _deployedPar >= shortfall ? _deployedPar - shortfall : 0; // outstanding par releases with the book
        }

        // Interactions: egress the shortfall through the roamer (pro-rata
        // decrease-only slices; never gated by MIN_HOLD, never consuming the
        // migration cap). The proceeds pass straight out to the receiver below —
        // the books debit exactly the claim; any proceeds-vs-marked divergence is
        // the redeemer's slice (DECISION 9b, realized ONCE through actual proceeds).
        uint256 proceeds = 0;
        if (shortfall > 0) {
            address roamer = harvester;
            if (roamer == address(0)) revert HarvesterRequired();
            proceeds = IRoamHarvesterTarget(roamer).vaultEgress(shortfall);
            emit VaultEgressSettled(shortfall, proceeds);
        }

        uint256 payout = idlePaid + proceeds;
        if (minPayout > 0 && payout < minPayout) revert PayoutBelowMin(payout, minPayout);
        IERC20(asset()).safeTransfer(receiver, payout);
    }
}
