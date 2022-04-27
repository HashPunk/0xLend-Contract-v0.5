"use strict";

const { dfn } = require('./JS');
const {
  encodeParameters,
  etherBalance,
  etherMantissa,
  etherUnsigned,
  mergeInterface
} = require('./Ethereum');
const BigNumber = require('bignumber.js');

async function makextroller(opts = {}) {
  const {
    root = saddle.account,
    kind = 'xUnitroller'
  } = opts || {};

  if (kind == 'bool') {
    return await deploy('Boolxtroller');
  }

  if (kind == 'false-marker') {
    return await deploy('FalseMarkerMethodxtroller');
  }

  if (kind == 'v1-no-proxy') {
    const xtroller = await deploy('xtrollerHarness');
    const priceOracle = opts.priceOracle || await makePriceOracle(opts.priceOracleOpts);
    const closeFactor = etherMantissa(dfn(opts.closeFactor, .051));

    await send(xtroller, '_setCloseFactor', [closeFactor]);
    await send(xtroller, '_setPriceOracle', [priceOracle._address]);

    return Object.assign(xtroller, { priceOracle });
  }

  if (kind == 'xUnitroller-g2') {
    const xUnitroller = opts.xUnitroller || await deploy('xUnitroller');
    const xtroller = await deploy('xtrollerScenarioG2');
    const priceOracle = opts.priceOracle || await makePriceOracle(opts.priceOracleOpts);
    const closeFactor = etherMantissa(dfn(opts.closeFactor, .051));
    const maxAssets = etherUnsigned(dfn(opts.maxAssets, 10));
    const liquidationIncentive = etherMantissa(1);

    await send(xUnitroller, '_setPendingImplementation', [xtroller._address]);
    await send(xtroller, '_become', [xUnitroller._address]);
    mergeInterface(xUnitroller, xtroller);
    await send(xUnitroller, '_setLiquidationIncentive', [liquidationIncentive]);
    await send(xUnitroller, '_setCloseFactor', [closeFactor]);
    await send(xUnitroller, '_setMaxAssets', [maxAssets]);
    await send(xUnitroller, '_setPriceOracle', [priceOracle._address]);

    return Object.assign(xUnitroller, { priceOracle });
  }

  if (kind == 'xUnitroller-g3') {
    const xUnitroller = opts.xUnitroller || await deploy('xUnitroller');
    const xtroller = await deploy('xtrollerScenarioG3');
    const priceOracle = opts.priceOracle || await makePriceOracle(opts.priceOracleOpts);
    const closeFactor = etherMantissa(dfn(opts.closeFactor, .051));
    const maxAssets = etherUnsigned(dfn(opts.maxAssets, 10));
    const liquidationIncentive = etherMantissa(1);
    const compRate = etherUnsigned(dfn(opts.compRate, 1e18));
    const compMarkets = opts.compMarkets || [];
    const otherMarkets = opts.otherMarkets || [];

    await send(xUnitroller, '_setPendingImplementation', [xtroller._address]);
    await send(xtroller, '_become', [xUnitroller._address, compRate, compMarkets, otherMarkets]);
    mergeInterface(xUnitroller, xtroller);
    await send(xUnitroller, '_setLiquidationIncentive', [liquidationIncentive]);
    await send(xUnitroller, '_setCloseFactor', [closeFactor]);
    await send(xUnitroller, '_setMaxAssets', [maxAssets]);
    await send(xUnitroller, '_setPriceOracle', [priceOracle._address]);

    return Object.assign(xUnitroller, { priceOracle });
  }

  if (kind == 'xUnitroller-g6') {
    const xUnitroller = opts.xUnitroller || await deploy('xUnitroller');
    const xtroller = await deploy('xtrollerScenarioG6');
    const priceOracle = opts.priceOracle || await makePriceOracle(opts.priceOracleOpts);
    const closeFactor = etherMantissa(dfn(opts.closeFactor, .051));
    const liquidationIncentive = etherMantissa(1);
    const led = opts.led || await deploy('led', [opts.compOwner || root]);
    const compRate = etherUnsigned(dfn(opts.compRate, 1e18));

    await send(xUnitroller, '_setPendingImplementation', [xtroller._address]);
    await send(xtroller, '_become', [xUnitroller._address]);
    mergeInterface(xUnitroller, xtroller);
    await send(xUnitroller, '_setLiquidationIncentive', [liquidationIncentive]);
    await send(xUnitroller, '_setCloseFactor', [closeFactor]);
    await send(xUnitroller, '_setPriceOracle', [priceOracle._address]);
    await send(xUnitroller, '_setCompRate', [compRate]);
    await send(xUnitroller, 'setCompAddress', [led._address]); // harness only

    return Object.assign(xUnitroller, { priceOracle, led });
  }

  if (kind == 'xUnitroller') {
    const xUnitroller = opts.xUnitroller || await deploy('xUnitroller');
    const xtroller = await deploy('xtrollerHarness');
    const priceOracle = opts.priceOracle || await makePriceOracle(opts.priceOracleOpts);
    const closeFactor = etherMantissa(dfn(opts.closeFactor, .051));
    const liquidationIncentive = etherMantissa(1);
    const led = opts.led || await deploy('led', [opts.compOwner || root]);
    const compRate = etherUnsigned(dfn(opts.compRate, 1e18));

    await send(xUnitroller, '_setPendingImplementation', [xtroller._address]);
    await send(xtroller, '_become', [xUnitroller._address]);
    mergeInterface(xUnitroller, xtroller);
    await send(xUnitroller, '_setLiquidationIncentive', [liquidationIncentive]);
    await send(xUnitroller, '_setCloseFactor', [closeFactor]);
    await send(xUnitroller, '_setPriceOracle', [priceOracle._address]);
    await send(xUnitroller, 'setCompAddress', [led._address]); // harness only
    await send(xUnitroller, 'harnessSetCompRate', [compRate]);

    return Object.assign(xUnitroller, { priceOracle, led });
  }
}

async function makextoken(opts = {}) {
  const {
    root = saddle.account,
    kind = 'xkcc20'
  } = opts || {};

  const xtroller = opts.xtroller || await makextroller(opts.xtrollerOpts);
  const interestRateModel = opts.interestRateModel || await makeInterestRateModel(opts.interestRateModelOpts);
  const exchangeRate = etherMantissa(dfn(opts.exchangeRate, 1));
  const decimals = etherUnsigned(dfn(opts.decimals, 8));
  const symbol = opts.symbol || (kind === 'xkcc' ? 'cETH' : 'cOMG');
  const name = opts.name || `xtoken ${symbol}`;
  const admin = opts.admin || root;

  let xtoken, underlying;
  let cDelegator, cDelegatee, cDaiMaker;

  switch (kind) {
    case 'xkcc':
      xtoken = await deploy('xkccHarness',
        [
          xtroller._address,
          interestRateModel._address,
          exchangeRate,
          name,
          symbol,
          decimals,
          admin
        ])
      break;

    case 'cdai':
      cDaiMaker  = await deploy('CDaiDelegateMakerHarness');
      underlying = cDaiMaker;
      cDelegatee = await deploy('CDaiDelegateHarness');
      cDelegator = await deploy('xkcc20Delegator',
        [
          underlying._address,
          xtroller._address,
          interestRateModel._address,
          exchangeRate,
          name,
          symbol,
          decimals,
          admin,
          cDelegatee._address,
          encodeParameters(['address', 'address'], [cDaiMaker._address, cDaiMaker._address])
        ]
      );
      xtoken = await saddle.getContractAt('CDaiDelegateHarness', cDelegator._address);
      break;
    
    case 'ccomp':
      underlying = await deploy('led', [opts.compHolder || root]);
      cDelegatee = await deploy('xkcc20DelegateHarness');
      cDelegator = await deploy('xkcc20Delegator',
        [
          underlying._address,
          xtroller._address,
          interestRateModel._address,
          exchangeRate,
          name,
          symbol,
          decimals,
          admin,
          cDelegatee._address,
          "0x0"
        ]
      );
      xtoken = await saddle.getContractAt('xkcc20DelegateHarness', cDelegator._address);
      break;

    case 'xkcc20':
    default:
      underlying = opts.underlying || await makeToken(opts.underlyingOpts);
      cDelegatee = await deploy('xkcc20DelegateHarness');
      cDelegator = await deploy('xkcc20Delegator',
        [
          underlying._address,
          xtroller._address,
          interestRateModel._address,
          exchangeRate,
          name,
          symbol,
          decimals,
          admin,
          cDelegatee._address,
          "0x0"
        ]
      );
      xtoken = await saddle.getContractAt('xkcc20DelegateHarness', cDelegator._address);
      break;
      
  }

  if (opts.supportMarket) {
    await send(xtroller, '_supportMarket', [xtoken._address]);
  }

  if (opts.addCompMarket) {
    await send(xtroller, '_addCompMarket', [xtoken._address]);
  }

  if (opts.underlyingPrice) {
    const price = etherMantissa(opts.underlyingPrice);
    await send(xtroller.priceOracle, 'setUnderlyingPrice', [xtoken._address, price]);
  }

  if (opts.collateralFactor) {
    const factor = etherMantissa(opts.collateralFactor);
    expect(await send(xtroller, '_setCollateralFactor', [xtoken._address, factor])).toSucceed();
  }

  return Object.assign(xtoken, { name, symbol, underlying, xtroller, interestRateModel });
}

async function makeInterestRateModel(opts = {}) {
  const {
    root = saddle.account,
    kind = 'harnessed'
  } = opts || {};

  if (kind == 'harnessed') {
    const borrowRate = etherMantissa(dfn(opts.borrowRate, 0));
    return await deploy('InterestRateModelHarness', [borrowRate]);
  }

  if (kind == 'false-marker') {
    const borrowRate = etherMantissa(dfn(opts.borrowRate, 0));
    return await deploy('FalseMarkerMethodInterestRateModel', [borrowRate]);
  }

  if (kind == 'white-paper') {
    const baseRate = etherMantissa(dfn(opts.baseRate, 0));
    const multiplier = etherMantissa(dfn(opts.multiplier, 1e-18));
    return await deploy('WhitePaperInterestRateModel', [baseRate, multiplier]);
  }

  if (kind == 'jump-rate') {
    const baseRate = etherMantissa(dfn(opts.baseRate, 0));
    const multiplier = etherMantissa(dfn(opts.multiplier, 1e-18));
    const jump = etherMantissa(dfn(opts.jump, 0));
    const kink = etherMantissa(dfn(opts.kink, 0));
    return await deploy('JumpRateModel', [baseRate, multiplier, jump, kink]);
  }
}

async function makePriceOracle(opts = {}) {
  const {
    root = saddle.account,
    kind = 'simple'
  } = opts || {};

  if (kind == 'simple') {
    return await deploy('SimplePriceOracle');
  }
}

async function makeToken(opts = {}) {
  const {
    root = saddle.account,
    kind = 'erc20'
  } = opts || {};

  if (kind == 'erc20') {
    const quantity = etherUnsigned(dfn(opts.quantity, 1e25));
    const decimals = etherUnsigned(dfn(opts.decimals, 18));
    const symbol = opts.symbol || 'OMG';
    const name = opts.name || `Erc20 ${symbol}`;
    return await deploy('ERC20Harness', [quantity, name, decimals, symbol]);
  }
}

async function balanceOf(token, account) {
  return etherUnsigned(await call(token, 'balanceOf', [account]));
}

async function totalSupply(token) {
  return etherUnsigned(await call(token, 'totalSupply'));
}

async function borrowSnapshot(xtoken, account) {
  const { principal, interestIndex } = await call(xtoken, 'harnessAccountBorrows', [account]);
  return { principal: etherUnsigned(principal), interestIndex: etherUnsigned(interestIndex) };
}

async function totalBorrows(xtoken) {
  return etherUnsigned(await call(xtoken, 'totalBorrows'));
}

async function totalReserves(xtoken) {
  return etherUnsigned(await call(xtoken, 'totalReserves'));
}

async function enterMarkets(xtokens, from) {
  return await send(xtokens[0].xtroller, 'enterMarkets', [xtokens.map(c => c._address)], { from });
}

async function fastForward(xtoken, blocks = 5) {
  return await send(xtoken, 'harnessFastForward', [blocks]);
}

async function setBalance(xtoken, account, balance) {
  return await send(xtoken, 'harnessSetBalance', [account, balance]);
}

async function setEtherBalance(xkcc, balance) {
  const current = await etherBalance(xkcc._address);
  const root = saddle.account;
  expect(await send(xkcc, 'harnessDoTransferOut', [root, current])).toSucceed();
  expect(await send(xkcc, 'harnessDoTransferIn', [root, balance], { value: balance })).toSucceed();
}

async function getBalances(xtokens, accounts) {
  const balances = {};
  for (let xtoken of xtokens) {
    const cBalances = balances[xtoken._address] = {};
    for (let account of accounts) {
      cBalances[account] = {
        eth: await etherBalance(account),
        cash: xtoken.underlying && await balanceOf(xtoken.underlying, account),
        tokens: await balanceOf(xtoken, account),
        borrows: (await borrowSnapshot(xtoken, account)).principal
      };
    }
    cBalances[xtoken._address] = {
      eth: await etherBalance(xtoken._address),
      cash: xtoken.underlying && await balanceOf(xtoken.underlying, xtoken._address),
      tokens: await totalSupply(xtoken),
      borrows: await totalBorrows(xtoken),
      reserves: await totalReserves(xtoken)
    };
  }
  return balances;
}

async function adjustBalances(balances, deltas) {
  for (let delta of deltas) {
    let xtoken, account, key, diff;
    if (delta.length == 4) {
      ([xtoken, account, key, diff] = delta);
    } else {
      ([xtoken, key, diff] = delta);
      account = xtoken._address;
    }
    balances[xtoken._address][account][key] = new BigNumber(balances[xtoken._address][account][key]).plus(diff);
  }
  return balances;
}


async function preApprove(xtoken, from, amount, opts = {}) {
  if (dfn(opts.faucet, true)) {
    expect(await send(xtoken.underlying, 'harnessSetBalance', [from, amount], { from })).toSucceed();
  }

  return send(xtoken.underlying, 'approve', [xtoken._address, amount], { from });
}

async function quickMint(xtoken, minter, mintAmount, opts = {}) {
  // make sure to accrue interest
  await fastForward(xtoken, 1);

  if (dfn(opts.approve, true)) {
    expect(await preApprove(xtoken, minter, mintAmount, opts)).toSucceed();
  }
  if (dfn(opts.exchangeRate)) {
    expect(await send(xtoken, 'harnessSetExchangeRate', [etherMantissa(opts.exchangeRate)])).toSucceed();
  }
  return send(xtoken, 'mint', [mintAmount], { from: minter });
}

async function quickBorrow(xtoken, minter, borrowAmount, opts = {}) {
  // make sure to accrue interest
  await fastForward(xtoken, 1);

  if (dfn(opts.exchangeRate))
    expect(await send(xtoken, 'harnessSetExchangeRate', [etherMantissa(opts.exchangeRate)])).toSucceed();

  return send(xtoken, 'borrow', [borrowAmount], { from: minter });
}


async function preSupply(xtoken, account, tokens, opts = {}) {
  if (dfn(opts.total, true)) {
    expect(await send(xtoken, 'harnessSetTotalSupply', [tokens])).toSucceed();
  }
  return send(xtoken, 'harnessSetBalance', [account, tokens]);
}

async function quickRedeem(xtoken, redeemer, redeemTokens, opts = {}) {
  await fastForward(xtoken, 1);

  if (dfn(opts.supply, true)) {
    expect(await preSupply(xtoken, redeemer, redeemTokens, opts)).toSucceed();
  }
  if (dfn(opts.exchangeRate)) {
    expect(await send(xtoken, 'harnessSetExchangeRate', [etherMantissa(opts.exchangeRate)])).toSucceed();
  }
  return send(xtoken, 'redeem', [redeemTokens], { from: redeemer });
}

async function quickRedeemUnderlying(xtoken, redeemer, redeemAmount, opts = {}) {
  await fastForward(xtoken, 1);

  if (dfn(opts.exchangeRate)) {
    expect(await send(xtoken, 'harnessSetExchangeRate', [etherMantissa(opts.exchangeRate)])).toSucceed();
  }
  return send(xtoken, 'redeemUnderlying', [redeemAmount], { from: redeemer });
}

async function setOraclePrice(xtoken, price) {
  return send(xtoken.xtroller.priceOracle, 'setUnderlyingPrice', [xtoken._address, etherMantissa(price)]);
}

async function setBorrowRate(xtoken, rate) {
  return send(xtoken.interestRateModel, 'setBorrowRate', [etherMantissa(rate)]);
}

async function getBorrowRate(interestRateModel, cash, borrows, reserves) {
  return call(interestRateModel, 'getBorrowRate', [cash, borrows, reserves].map(etherUnsigned));
}

async function getSupplyRate(interestRateModel, cash, borrows, reserves, reserveFactor) {
  return call(interestRateModel, 'getSupplyRate', [cash, borrows, reserves, reserveFactor].map(etherUnsigned));
}

async function pretendBorrow(xtoken, borrower, accountIndex, marketIndex, principalRaw, blockNumber = 2e7) {
  await send(xtoken, 'harnessSetTotalBorrows', [etherUnsigned(principalRaw)]);
  await send(xtoken, 'harnessSetAccountBorrows', [borrower, etherUnsigned(principalRaw), etherMantissa(accountIndex)]);
  await send(xtoken, 'harnessSetBorrowIndex', [etherMantissa(marketIndex)]);
  await send(xtoken, 'harnessSetAccrualBlockNumber', [etherUnsigned(blockNumber)]);
  await send(xtoken, 'harnessSetBlockNumber', [etherUnsigned(blockNumber)]);
}

module.exports = {
  makextroller,
  makextoken,
  makeInterestRateModel,
  makePriceOracle,
  makeToken,

  balanceOf,
  totalSupply,
  borrowSnapshot,
  totalBorrows,
  totalReserves,
  enterMarkets,
  fastForward,
  setBalance,
  setEtherBalance,
  getBalances,
  adjustBalances,

  preApprove,
  quickMint,
  quickBorrow,

  preSupply,
  quickRedeem,
  quickRedeemUnderlying,

  setOraclePrice,
  setBorrowRate,
  getBorrowRate,
  getSupplyRate,
  pretendBorrow
};
