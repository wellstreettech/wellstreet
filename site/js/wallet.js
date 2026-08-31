/*
 * Wellstreet site — wallet.js
 * Injected-provider wallet flows (window.ethereum) — v1 scope per the locked spec:
 * connect, chain check/switch, ERC-20 approve, ERC-4626 deposit/mint/withdraw/redeem,
 * each with an HONEST error state (no silent swallowing, no fake success).
 *
 * All write flows are gated on the vault actually being deployed — until then the
 * UI disables them with the reason shown (the vault address is PENDING_DEPLOY).
 */
(function (root, factory) {
  var api = factory(root);
  root.WS = root.WS || {};
  root.WS.wallet = api;
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
})(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {
  'use strict';

  function provider() {
    return (typeof window !== 'undefined' && window.ethereum) ? window.ethereum : null;
  }

  function isAvailable() { return provider() !== null; }

  // Connect + ensure the right chain. Returns {account, chainId} or throws a
  // described error (describeError gives the human-readable form).
  async function connect(cfg) {
    var p = provider();
    if (!p) {
      var noProvider = new Error('No injected wallet found. Install a browser wallet to use the vault.');
      noProvider.code = 'WS_NO_PROVIDER';
      throw noProvider;
    }
    var accounts = await p.request({ method: 'eth_requestAccounts' });
    if (!accounts || !accounts.length) {
      var noAccounts = new Error('Wallet returned no accounts.');
      noAccounts.code = 'WS_NO_ACCOUNTS';
      throw noAccounts;
    }
    var chainIdHex = await p.request({ method: 'eth_chainId' });
    if (Number.parseInt(chainIdHex, 16) !== cfg.chain.id) {
      await ensureChain(p, cfg);
    }
    return { account: accounts[0], chainId: Number.parseInt(chainIdHex, 16) };
  }

  async function ensureChain(p, cfg) {
    try {
      await p.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: cfg.chain.idHex }]
      });
    } catch (err) {
      // 4902 = chain not added yet (also seen as -32603 on some providers)
      if (err && (err.code === 4902 || err.code === -32603)) {
        await p.request({ method: 'wallet_addEthereumChain', params: [cfg.chain.addChainParams] });
      } else {
        throw err;
      }
    }
  }

  function onAccountsChanged(cb) {
    var p = provider();
    if (p && p.on) { p.on('accountsChanged', cb); }
  }
  function onChainChanged(cb) {
    var p = provider();
    if (p && p.on) { p.on('chainChanged', cb); }
  }

  async function sendTransaction(cfg, to, data, value) {
    var p = provider();
    if (!p) { throw describeError({ code: 'WS_NO_PROVIDER' }); }
    var accounts = await p.request({ method: 'eth_accounts' });
    if (!accounts || !accounts.length) { throw describeError({ code: 4100 }); }
    var chainIdHex = await p.request({ method: 'eth_chainId' });
    if (Number.parseInt(chainIdHex, 16) !== cfg.chain.id) {
      throw describeError({ code: 'WS_WRONG_CHAIN' });
    }
    return p.request({
      method: 'eth_sendTransaction',
      params: [{
        from: accounts[0],
        to: to,
        data: data,
        value: value || '0x0'
      }]
    });
  }

  // ---------------- ERC-20 / ERC-4626 flows (selectors derived at runtime) ----------------

  async function approve(cfg, assetAddr, spender, amount) {
    var abi = root.WS.abi;
    var data = abi.encodeCall(abi.selectorOf('approve(address,uint256)'), [spender, amount]);
    return sendTransaction(cfg, assetAddr, data);
  }

  async function deposit(cfg, vaultAddr, assets, receiver) {
    var abi = root.WS.abi;
    var data = abi.encodeCall(abi.selectorOf('deposit(uint256,address)'), [assets, receiver]);
    return sendTransaction(cfg, vaultAddr, data);
  }

  async function mint(cfg, vaultAddr, shares, receiver) {
    var abi = root.WS.abi;
    var data = abi.encodeCall(abi.selectorOf('mint(uint256,address)'), [shares, receiver]);
    return sendTransaction(cfg, vaultAddr, data);
  }

  async function withdraw(cfg, vaultAddr, assets, receiver, owner) {
    var abi = root.WS.abi;
    var data = abi.encodeCall(abi.selectorOf('withdraw(uint256,address,address)'), [assets, receiver, owner]);
    return sendTransaction(cfg, vaultAddr, data);
  }

  async function redeem(cfg, vaultAddr, shares, receiver, owner) {
    var abi = root.WS.abi;
    var data = abi.encodeCall(abi.selectorOf('redeem(uint256,address,address)'), [shares, receiver, owner]);
    return sendTransaction(cfg, vaultAddr, data);
  }

  // Read-only helpers through the site's own RPC client (not the wallet).
  async function balanceOf(client, tokenAddr, owner) {
    var abi = root.WS.abi;
    var raw = await client.call('eth_call', [{
      to: tokenAddr,
      data: abi.selectorOf('balanceOf(address)') + abi.encodeAddress(owner)
    }, 'latest']);
    return abi.decodeUint(raw);
  }

  async function allowance(client, tokenAddr, owner, spender) {
    var abi = root.WS.abi;
    var raw = await client.call('eth_call', [{
      to: tokenAddr,
      data: abi.selectorOf('allowance(address,address)') + abi.encodeAddress(owner) + abi.encodeAddress(spender)
    }, 'latest']);
    return abi.decodeUint(raw);
  }

  // ---------------- honest error mapping ----------------

  function describeError(err) {
    var code = err && (err.code !== undefined ? err.code : (err.data && err.data.code));
    if (code === 4001) {
      var rej = new Error('You rejected the request in your wallet. Nothing was sent.');
      rej.code = 4001;
      return rej;
    }
    if (code === -32002) {
      var pending = new Error('Your wallet already has a pending request — open it to continue.');
      pending.code = -32002;
      return pending;
    }
    if (code === 4100) {
      var unauth = new Error('Wallet is locked or the site is not authorized — unlock and reconnect.');
      unauth.code = 4100;
      return unauth;
    }
    if (code === 'WS_WRONG_CHAIN') {
      var wrong = new Error('Wrong network. Switch your wallet to chain 4663 (Robinhood Chain) and retry.');
      wrong.code = 'WS_WRONG_CHAIN';
      return wrong;
    }
    if (code === 'WS_NO_PROVIDER') {
      return err;
    }
    // Best-effort revert decode: Error(string) has selector 0x08c379a0
    var revertData = err && err.data && (typeof err.data === 'string' ? err.data : err.data.data);
    if (typeof revertData === 'string') {
      var reason = root.WS.abi.decodeRevertReason(revertData);
      if (reason) {
        var rev = new Error('Transaction reverted: ' + reason);
        rev.revertReason = reason;
        return rev;
      }
    }
    var msg = (err && err.message) ? err.message : 'Unknown wallet error.';
    var wrapped = new Error(msg + ' — the transaction was NOT confirmed; check your wallet and balance before retrying.');
    wrapped.original = err;
    return wrapped;
  }

  return {
    isAvailable: isAvailable,
    connect: connect,
    onAccountsChanged: onAccountsChanged,
    onChainChanged: onChainChanged,
    approve: approve,
    deposit: deposit,
    mint: mint,
    withdraw: withdraw,
    redeem: redeem,
    balanceOf: balanceOf,
    allowance: allowance,
    describeError: describeError
  };
});
