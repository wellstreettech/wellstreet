// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Minimal self-contained ERC-20 mock for forge tests (no framework
///         dependency — full control over edge-case behavior).
contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public decimals = 18;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory name_, string memory symbol_) {
        name = name_;
        symbol = symbol_;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function burn(address from, uint256 amount) external {
        balanceOf[from] -= amount;
        totalSupply -= amount;
        emit Transfer(from, address(0), amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external virtual returns (bool) {
        return _transfer(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external virtual returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        return _transfer(from, to, amount);
    }

    function _transfer(address from, address to, uint256 amount) internal returns (bool) {
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

/// @notice Mock token that taxes every transfer (10% skimmed to address(this)) —
///         used to prove fee-on-transfer deposits REVERT in the vault.
contract MockFeeOnTransferToken is MockERC20 {
    uint256 public constant TAX_BPS = 1000; // 10%

    constructor() MockERC20("Fee On Transfer", "FOT") {}

    function transfer(address to, uint256 amount) external override returns (bool) {
        return _taxedTransfer(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        return _taxedTransfer(from, to, amount);
    }

    function _taxedTransfer(address from, address to, uint256 amount) internal returns (bool) {
        uint256 tax = (amount * TAX_BPS) / 10_000;
        uint256 net = amount - tax;
        balanceOf[from] -= amount;
        balanceOf[to] += net;
        balanceOf[address(this)] += tax;
        emit Transfer(from, to, net);
        return true;
    }
}

/// @notice Mock token that under-delivers transfers INTO one configured recipient
///         (10% skimmed to address(this)) and is clean everywhere else. Models the
///         audit F-03b credit-path loss — an issuer upgrade taxing the
///         harvester -> vault leg — while every other leg stays intact, so the
///         empirical-credit harden is isolated in the harvest tests.
contract MockLossyTransferToken is MockERC20 {
    uint256 public constant TAX_BPS = 1000; // 10%
    address public lossyRecipient;

    constructor() MockERC20("Lossy Transfer", "LOSSY") {}

    function setLossyRecipient(address to) external {
        lossyRecipient = to;
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        return _lossyTransfer(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        return _lossyTransfer(from, to, amount);
    }

    function _lossyTransfer(address from, address to, uint256 amount) internal returns (bool) {
        if (to != lossyRecipient) {
            return _transfer(from, to, amount);
        }
        uint256 tax = (amount * TAX_BPS) / 10_000;
        uint256 net = amount - tax;
        balanceOf[from] -= amount;
        balanceOf[to] += net;
        balanceOf[address(this)] += tax;
        emit Transfer(from, to, net);
        return true;
    }
}

/// @notice Mock token whose issuer can UPGRADE it into fee-on-transfer behavior at
///         any time (clean until setFot(true)) — models the audit F-03 issuer-upgrade
///         scenario on the withdraw path (deposits happen on the clean token, exits
///         run on the taxed one).
contract MockToggleableFeeOnTransferToken is MockERC20 {
    uint256 public constant TAX_BPS = 1000; // 10%
    bool public fot;

    constructor() MockERC20("Upgradeable FOT", "UFOT") {}

    function setFot(bool enabled) external {
        fot = enabled;
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        return _maybeTaxedTransfer(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        return _maybeTaxedTransfer(from, to, amount);
    }

    function _maybeTaxedTransfer(address from, address to, uint256 amount) internal returns (bool) {
        if (!fot) {
            return _transfer(from, to, amount);
        }
        uint256 tax = (amount * TAX_BPS) / 10_000;
        uint256 net = amount - tax;
        balanceOf[from] -= amount;
        balanceOf[to] += net;
        balanceOf[address(this)] += tax;
        emit Transfer(from, to, net);
        return true;
    }
}
/// @notice Mock token whose transfers RETURN FALSE without reverting (ERC-20
///         non-compliance). Used by the invariant battery to prove a false-returning
///         token can neither move vault accounting (SafeERC20 reverts on the false
///         return) nor reach the LP principal. Reserved for the deposit-rejection and
///         hostile-inertness invariants — NEVER fed to invariant_RedeemNeverTrapped
///         (token-level censorship is out of that invariant's scope by pin).
contract MockFalseReturnToken is MockERC20 {
    constructor() MockERC20("False Return", "FALSE") {}

    function transfer(address, uint256) external override returns (bool) {
        return false; // silently fails — the compliant caller must treat this as a failure
    }

    function transferFrom(address, address, uint256) external override returns (bool) {
        return false;
    }
}

/// @notice Mock token that calls back into a configured target (the vault under test)
///         from inside transfer/transferFrom — models a reentrant hostile token. The
///         callback REVERTS (the vault's ReentrancyGuard blocks it) and the mock
///         propagates the failure, so every money-path entry through this token reverts.
///         Same invariant scoping as MockFalseReturnToken (never RedeemNeverTrapped).
contract MockReentrantToken is MockERC20 {
    address public callbackTarget;

    constructor() MockERC20("Reentrant", "REENT") {}

    function setCallbackTarget(address target) external {
        callbackTarget = target;
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        _reenter();
        return _transfer(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        _reenter();
        return _transfer(from, to, amount);
    }

    function _reenter() internal {
        if (callbackTarget != address(0)) {
            // Re-enter a GUARDED vault path (redeem -> _withdraw carries the
            // ReentrancyGuard): inside a deposit the guard holds and this reverts,
            // which propagates and reverts the whole transfer.
            (bool ok,) = callbackTarget.call(
                abi.encodeWithSignature("redeem(uint256,address,address)", 0, address(this), address(this))
            );
            require(ok, "reentrant callback failed (guard held)");
        }
    }
}

/// @notice Mock token with an issuer-style BLOCKLIST that reverts transfers touching a
///         blocked account (sender or receiver). Used by the invariant battery's
///         deposit-rejection group — the blocklist is TOKEN-level censorship, out of
///         the standard-asset RedeemNeverTrapped scope by pin.
contract MockBlacklistToken is MockERC20 {
    mapping(address => bool) public blocked;

    constructor() MockERC20("Blacklist", "BLIST") {}

    function setBlocked(address who, bool yes) external {
        blocked[who] = yes;
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        require(!blocked[msg.sender] && !blocked[to], "blocked");
        return _transfer(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        require(!blocked[from] && !blocked[to] && !blocked[msg.sender], "blocked");
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        return _transfer(from, to, amount);
    }
}
