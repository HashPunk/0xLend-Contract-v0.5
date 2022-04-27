const {
  etherGasCost,
  etherMantissa,
  etherUnsigned,
  sendFallback
} = require('../Utils/Ethereum');

const {
  makextoken,
  balanceOf,
  fastForward,
  setBalance,
  setEtherBalance,
  getBalances,
  adjustBalances,
} = require('../Utils/0xlend');

const exchangeRate = 5;
const mintAmount = etherUnsigned(1e5);
const mintTokens = mintAmount.dividedBy(exchangeRate);
const redeemTokens = etherUnsigned(10e3);
const redeemAmount = redeemTokens.multipliedBy(exchangeRate);

async function preMint(xtoken, minter, mintAmount, mintTokens, exchangeRate) {
  await send(xtoken.xtroller, 'setMintAllowed', [true]);
  await send(xtoken.xtroller, 'setMintVerify', [true]);
  await send(xtoken.interestRateModel, 'setFailBorrowRate', [false]);
  await send(xtoken, 'harnessSetExchangeRate', [etherMantissa(exchangeRate)]);
}

async function mintExplicit(xtoken, minter, mintAmount) {
  return send(xtoken, 'mint', [], {from: minter, value: mintAmount});
}

async function mintFallback(xtoken, minter, mintAmount) {
  return sendFallback(xtoken, {from: minter, value: mintAmount});
}

async function preRedeem(xtoken, redeemer, redeemTokens, redeemAmount, exchangeRate) {
  await send(xtoken.xtroller, 'setRedeemAllowed', [true]);
  await send(xtoken.xtroller, 'setRedeemVerify', [true]);
  await send(xtoken.interestRateModel, 'setFailBorrowRate', [false]);
  await send(xtoken, 'harnessSetExchangeRate', [etherMantissa(exchangeRate)]);
  await setEtherBalance(xtoken, redeemAmount);
  await send(xtoken, 'harnessSetTotalSupply', [redeemTokens]);
  await setBalance(xtoken, redeemer, redeemTokens);
}

async function redeemxtokens(xtoken, redeemer, redeemTokens, redeemAmount) {
  return send(xtoken, 'redeem', [redeemTokens], {from: redeemer});
}

async function redeemUnderlying(xtoken, redeemer, redeemTokens, redeemAmount) {
  return send(xtoken, 'redeemUnderlying', [redeemAmount], {from: redeemer});
}

describe('xkcc', () => {
  let root, minter, redeemer, accounts;
  let xtoken;

  beforeEach(async () => {
    [root, minter, redeemer, ...accounts] = saddle.accounts;
    xtoken = await makextoken({kind: 'xkcc', xtrollerOpts: {kind: 'bool'}});
    await fastForward(xtoken, 1);
  });

  [mintExplicit, mintFallback].forEach((mint) => {
    describe(mint.name, () => {
      beforeEach(async () => {
        await preMint(xtoken, minter, mintAmount, mintTokens, exchangeRate);
      });

      it("reverts if interest accrual fails", async () => {
        await send(xtoken.interestRateModel, 'setFailBorrowRate', [true]);
        await expect(mint(xtoken, minter, mintAmount)).rejects.toRevert("revert INTEREST_RATE_MODEL_ERROR");
      });

      it("returns success from mintFresh and mints the correct number of tokens", async () => {
        const beforeBalances = await getBalances([xtoken], [minter]);
        const receipt = await mint(xtoken, minter, mintAmount);
        const afterBalances = await getBalances([xtoken], [minter]);
        expect(receipt).toSucceed();
        expect(mintTokens).not.toEqualNumber(0);
        expect(afterBalances).toEqual(await adjustBalances(beforeBalances, [
          [xtoken, 'eth', mintAmount],
          [xtoken, 'tokens', mintTokens],
          [xtoken, minter, 'eth', -mintAmount.plus(await etherGasCost(receipt))],
          [xtoken, minter, 'tokens', mintTokens]
        ]));
      });
    });
  });

  [redeemxtokens, redeemUnderlying].forEach((redeem) => {
    describe(redeem.name, () => {
      beforeEach(async () => {
        await preRedeem(xtoken, redeemer, redeemTokens, redeemAmount, exchangeRate);
      });

      it("emits a redeem failure if interest accrual fails", async () => {
        await send(xtoken.interestRateModel, 'setFailBorrowRate', [true]);
        await expect(redeem(xtoken, redeemer, redeemTokens, redeemAmount)).rejects.toRevert("revert INTEREST_RATE_MODEL_ERROR");
      });

      it("returns error from redeemFresh without emitting any extra logs", async () => {
        expect(await redeem(xtoken, redeemer, redeemTokens.multipliedBy(5), redeemAmount.multipliedBy(5))).toHaveTokenFailure('MATH_ERROR', 'REDEEM_NEW_TOTAL_SUPPLY_CALCULATION_FAILED');
      });

      it("returns success from redeemFresh and redeems the correct amount", async () => {
        await fastForward(xtoken);
        const beforeBalances = await getBalances([xtoken], [redeemer]);
        const receipt = await redeem(xtoken, redeemer, redeemTokens, redeemAmount);
        expect(receipt).toTokenSucceed();
        const afterBalances = await getBalances([xtoken], [redeemer]);
        expect(redeemTokens).not.toEqualNumber(0);
        expect(afterBalances).toEqual(await adjustBalances(beforeBalances, [
          [xtoken, 'eth', -redeemAmount],
          [xtoken, 'tokens', -redeemTokens],
          [xtoken, redeemer, 'eth', redeemAmount.minus(await etherGasCost(receipt))],
          [xtoken, redeemer, 'tokens', -redeemTokens]
        ]));
      });
    });
  });
});
