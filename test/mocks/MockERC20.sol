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
