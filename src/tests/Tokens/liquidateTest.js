const {
  etherGasCost,
  etherUnsigned,
  etherMantissa,
  UInt256Max, 
  etherExp
} = require('../Utils/Ethereum');

const {
  makextoken,
  fastForward,
  setBalance,
  getBalances,
  adjustBalances,
  pretendBorrow,
  preApprove,
  enterMarkets
} = require('../Utils/0xlend');

const repayAmount = etherExp(10);
const seizeTokens = repayAmount.multipliedBy(4); // forced

async function preLiquidate(xtoken, liquidator, borrower, repayAmount, xtokenCollateral) {
  // setup for success in liquidating
  await send(xtoken.xtroller, 'setLiquidateBorrowAllowed', [true]);
  await send(xtoken.xtroller, 'setLiquidateBorrowVerify', [true]);
  await send(xtoken.xtroller, 'setRepayBorrowAllowed', [true]);
  await send(xtoken.xtroller, 'setRepayBorrowVerify', [true]);
  await send(xtoken.xtroller, 'setSeizeAllowed', [true]);
  await send(xtoken.xtroller, 'setSeizeVerify', [true]);
  await send(xtoken.xtroller, 'setFailCalculateSeizeTokens', [false]);
  await send(xtoken.underlying, 'harnessSetFailTransferFromAddress', [liquidator, false]);
  await send(xtoken.interestRateModel, 'setFailBorrowRate', [false]);
  await send(xtokenCollateral.interestRateModel, 'setFailBorrowRate', [false]);
  await send(xtokenCollateral.xtroller, 'setCalculatedSeizeTokens', [seizeTokens]);
  await send(xtokenCollateral, 'harnessSetTotalSupply', [etherExp(10)]);
  await setBalance(xtokenCollateral, liquidator, 0);
  await setBalance(xtokenCollateral, borrower, seizeTokens);
  await pretendBorrow(xtokenCollateral, borrower, 0, 1, 0);
  await pretendBorrow(xtoken, borrower, 1, 1, repayAmount);
  await preApprove(xtoken, liquidator, repayAmount);
}

async function liquidateFresh(xtoken, liquidator, borrower, repayAmount, xtokenCollateral) {
  return send(xtoken, 'harnessLiquidateBorrowFresh', [liquidator, borrower, repayAmount, xtokenCollateral._address]);
}

async function liquidate(xtoken, liquidator, borrower, repayAmount, xtokenCollateral) {
  // make sure to have a block delta so we accrue interest
  await fastForward(xtoken, 1);
  await fastForward(xtokenCollateral, 1);
  return send(xtoken, 'liquidateBorrow', [borrower, repayAmount, xtokenCollateral._address], {from: liquidator});
}

async function seize(xtoken, liquidator, borrower, seizeAmount) {
  return send(xtoken, 'seize', [liquidator, borrower, seizeAmount]);
}

describe('xtoken', function () {
  let root, liquidator, borrower, accounts;
  let xtoken, xtokenCollateral;

  const protocolSeizeShareMantissa = 2.8e16; // 2.8%
  const exchangeRate = etherExp(.2);

  const protocolShareTokens = seizeTokens.multipliedBy(protocolSeizeShareMantissa).dividedBy(etherExp(1));
  const liquidatorShareTokens = seizeTokens.minus(protocolShareTokens);

  const addReservesAmount = protocolShareTokens.multipliedBy(exchangeRate).dividedBy(etherExp(1));

  beforeEach(async () => {
    [root, liquidator, borrower, ...accounts] = saddle.accounts;
    xtoken = await makextoken({xtrollerOpts: {kind: 'bool'}});
    xtokenCollateral = await makextoken({xtroller: xtoken.xtroller});
    expect(await send(xtokenCollateral, 'harnessSetExchangeRate', [exchangeRate])).toSucceed();
  });
  
  beforeEach(async () => {
    await preLiquidate(xtoken, liquidator, borrower, repayAmount, xtokenCollateral);
  });

  describe('liquidateBorrowFresh', () => {
    it("fails if xtroller tells it to", async () => {
      await send(xtoken.xtroller, 'setLiquidateBorrowAllowed', [false]);
      expect(
        await liquidateFresh(xtoken, liquidator, borrower, repayAmount, xtokenCollateral)
      ).toHaveTrollReject('LIQUIDATE_xtroller_REJECTION', 'MATH_ERROR');
    });

    it("proceeds if xtroller tells it to", async () => {
      expect(
        await liquidateFresh(xtoken, liquidator, borrower, repayAmount, xtokenCollateral)
      ).toSucceed();
    });

    it("fails if market not fresh", async () => {
      await fastForward(xtoken);
      expect(
        await liquidateFresh(xtoken, liquidator, borrower, repayAmount, xtokenCollateral)
      ).toHaveTokenFailure('MARKET_NOT_FRESH', 'LIQUIDATE_FRESHNESS_CHECK');
    });

    it("fails if collateral market not fresh", async () => {
      await fastForward(xtoken);
      await fastForward(xtokenCollateral);
      await send(xtoken, 'accrueInterest');
      expect(
        await liquidateFresh(xtoken, liquidator, borrower, repayAmount, xtokenCollateral)
      ).toHaveTokenFailure('MARKET_NOT_FRESH', 'LIQUIDATE_COLLATERAL_FRESHNESS_CHECK');
    });

    it("fails if borrower is equal to liquidator", async () => {
      expect(
        await liquidateFresh(xtoken, borrower, borrower, repayAmount, xtokenCollateral)
      ).toHaveTokenFailure('INVALID_ACCOUNT_PAIR', 'LIQUIDATE_LIQUIDATOR_IS_BORROWER');
    });

    it("fails if repayAmount = 0", async () => {
      expect(await liquidateFresh(xtoken, liquidator, borrower, 0, xtokenCollateral)).toHaveTokenFailure('INVALID_CLOSE_AMOUNT_REQUESTED', 'LIQUIDATE_CLOSE_AMOUNT_IS_ZERO');
    });

    it("fails if calculating seize tokens fails and does not adjust balances", async () => {
      const beforeBalances = await getBalances([xtoken, xtokenCollateral], [liquidator, borrower]);
      await send(xtoken.xtroller, 'setFailCalculateSeizeTokens', [true]);
      await expect(
        liquidateFresh(xtoken, liquidator, borrower, repayAmount, xtokenCollateral)
      ).rejects.toRevert('revert LIQUIDATE_xtroller_CALCULATE_AMOUNT_SEIZE_FAILED');
      const afterBalances = await getBalances([xtoken, xtokenCollateral], [liquidator, borrower]);
      expect(afterBalances).toEqual(beforeBalances);
    });

    it("fails if repay fails", async () => {
      await send(xtoken.xtroller, 'setRepayBorrowAllowed', [false]);
      expect(
        await liquidateFresh(xtoken, liquidator, borrower, repayAmount, xtokenCollateral)
      ).toHaveTrollReject('LIQUIDATE_REPAY_BORROW_FRESH_FAILED');
    });

    it("reverts if seize fails", async () => {
      await send(xtoken.xtroller, 'setSeizeAllowed', [false]);
      await expect(
        liquidateFresh(xtoken, liquidator, borrower, repayAmount, xtokenCollateral)
      ).rejects.toRevert("revert token seizure failed");
    });

    xit("reverts if liquidateBorrowVerify fails", async() => {
      await send(xtoken.xtroller, 'setLiquidateBorrowVerify', [false]);
      await expect(
        liquidateFresh(xtoken, liquidator, borrower, repayAmount, xtokenCollateral)
      ).rejects.toRevert("revert liquidateBorrowVerify rejected liquidateBorrow");
    });

    it("transfers the cash, borrows, tokens, and emits Transfer, LiquidateBorrow events", async () => {
      const beforeBalances = await getBalances([xtoken, xtokenCollateral], [liquidator, borrower]);
      const result = await liquidateFresh(xtoken, liquidator, borrower, repayAmount, xtokenCollateral);
      const afterBalances = await getBalances([xtoken, xtokenCollateral], [liquidator, borrower]);
      expect(result).toSucceed();
      expect(result).toHaveLog('LiquidateBorrow', {
        liquidator: liquidator,
        borrower: borrower,
        repayAmount: repayAmount.toString(),
        xtokenCollateral: xtokenCollateral._address,
        seizeTokens: seizeTokens.toString()
      });
      expect(result).toHaveLog(['Transfer', 0], {
        from: liquidator,
        to: xtoken._address,
        amount: repayAmount.toString()
      });
      expect(result).toHaveLog(['Transfer', 1], {
        from: borrower,
        to: liquidator,
        amount: liquidatorShareTokens.toString()
      });
      expect(result).toHaveLog(['Transfer', 2], {
        from: borrower,
        to: xtokenCollateral._address,
        amount: protocolShareTokens.toString()
      });
      expect(afterBalances).toEqual(await adjustBalances(beforeBalances, [
        [xtoken, 'cash', repayAmount],
        [xtoken, 'borrows', -repayAmount],
        [xtoken, liquidator, 'cash', -repayAmount],
        [xtokenCollateral, liquidator, 'tokens', liquidatorShareTokens],
        [xtoken, borrower, 'borrows', -repayAmount],
        [xtokenCollateral, borrower, 'tokens', -seizeTokens],
        [xtokenCollateral, xtokenCollateral._address, 'reserves', addReservesAmount],
        [xtokenCollateral, xtokenCollateral._address, 'tokens', -protocolShareTokens]
      ]));
    });
  });

  describe('liquidateBorrow', () => {
    it("emits a liquidation failure if borrowed asset interest accrual fails", async () => {
      await send(xtoken.interestRateModel, 'setFailBorrowRate', [true]);
      await expect(liquidate(xtoken, liquidator, borrower, repayAmount, xtokenCollateral)).rejects.toRevert("revert INTEREST_RATE_MODEL_ERROR");
    });

    it("emits a liquidation failure if collateral asset interest accrual fails", async () => {
      await send(xtokenCollateral.interestRateModel, 'setFailBorrowRate', [true]);
      await expect(liquidate(xtoken, liquidator, borrower, repayAmount, xtokenCollateral)).rejects.toRevert("revert INTEREST_RATE_MODEL_ERROR");
    });

    it("returns error from liquidateBorrowFresh without emitting any extra logs", async () => {
      expect(await liquidate(xtoken, liquidator, borrower, 0, xtokenCollateral)).toHaveTokenFailure('INVALID_CLOSE_AMOUNT_REQUESTED', 'LIQUIDATE_CLOSE_AMOUNT_IS_ZERO');
    });

    it("returns success from liquidateBorrowFresh and transfers the correct amounts", async () => {
      const beforeBalances = await getBalances([xtoken, xtokenCollateral], [liquidator, borrower]);
      const result = await liquidate(xtoken, liquidator, borrower, repayAmount, xtokenCollateral);
      const gasCost = await etherGasCost(result);
      const afterBalances = await getBalances([xtoken, xtokenCollateral], [liquidator, borrower]);
      expect(result).toSucceed();
      expect(afterBalances).toEqual(await adjustBalances(beforeBalances, [
        [xtoken, 'cash', repayAmount],
        [xtoken, 'borrows', -repayAmount],
        [xtoken, liquidator, 'eth', -gasCost],
        [xtoken, liquidator, 'cash', -repayAmount],
        [xtokenCollateral, liquidator, 'eth', -gasCost],
        [xtokenCollateral, liquidator, 'tokens', liquidatorShareTokens],
        [xtokenCollateral, xtokenCollateral._address, 'reserves', addReservesAmount],
        [xtoken, borrower, 'borrows', -repayAmount],
        [xtokenCollateral, borrower, 'tokens', -seizeTokens],
        [xtokenCollateral, xtokenCollateral._address, 'tokens', -protocolShareTokens], // total supply decreases
      ]));
    });
  });

  describe('seize', () => {
    // XXX verify callers are properly checked

    it("fails if seize is not allowed", async () => {
      await send(xtoken.xtroller, 'setSeizeAllowed', [false]);
      expect(await seize(xtokenCollateral, liquidator, borrower, seizeTokens)).toHaveTrollReject('LIQUIDATE_SEIZE_xtroller_REJECTION', 'MATH_ERROR');
    });

    it("fails if xtokenBalances[borrower] < amount", async () => {
      await setBalance(xtokenCollateral, borrower, 1);
      expect(await seize(xtokenCollateral, liquidator, borrower, seizeTokens)).toHaveTokenMathFailure('LIQUIDATE_SEIZE_BALANCE_DECREMENT_FAILED', 'INTEGER_UNDERFLOW');
    });

    it("fails if xtokenBalances[liquidator] overflows", async () => {
      await setBalance(xtokenCollateral, liquidator, UInt256Max());
      expect(await seize(xtokenCollateral, liquidator, borrower, seizeTokens)).toHaveTokenMathFailure('LIQUIDATE_SEIZE_BALANCE_INCREMENT_FAILED', 'INTEGER_OVERFLOW');
    });

    it("succeeds, updates balances, adds to reserves, and emits Transfer and ReservesAdded events", async () => {
      const beforeBalances = await getBalances([xtokenCollateral], [liquidator, borrower]);
      const result = await seize(xtokenCollateral, liquidator, borrower, seizeTokens);
      const afterBalances = await getBalances([xtokenCollateral], [liquidator, borrower]);
      expect(result).toSucceed();
      expect(result).toHaveLog(['Transfer', 0], {
        from: borrower,
        to: liquidator,
        amount: liquidatorShareTokens.toString()
      });
      expect(result).toHaveLog(['Transfer', 1], {
        from: borrower,
        to: xtokenCollateral._address,
        amount: protocolShareTokens.toString()
      });
      expect(result).toHaveLog('ReservesAdded', {
        benefactor: xtokenCollateral._address,
        addAmount: addReservesAmount.toString(),
        newTotalReserves: addReservesAmount.toString()
      });

      expect(afterBalances).toEqual(await adjustBalances(beforeBalances, [
        [xtokenCollateral, liquidator, 'tokens', liquidatorShareTokens],
        [xtokenCollateral, borrower, 'tokens', -seizeTokens],
        [xtokenCollateral, xtokenCollateral._address, 'reserves', addReservesAmount],
        [xtokenCollateral, xtokenCollateral._address, 'tokens', -protocolShareTokens], // total supply decreases
      ]));
    });
  });
});

describe('xtroller', () => {
  it('liquidateBorrowAllowed allows deprecated markets to be liquidated', async () => {
    let [root, liquidator, borrower] = saddle.accounts;
    let collatAmount = 10;
    let borrowAmount = 2;
    const xtokenCollat = await makextoken({supportMarket: true, underlyingPrice: 1, collateralFactor: .5});
    const xtokenBorrow = await makextoken({supportMarket: true, underlyingPrice: 1, xtroller: xtokenCollat.xtroller});
    const xtroller = xtokenCollat.xtroller;

    // borrow some tokens
    await send(xtokenCollat.underlying, 'harnessSetBalance', [borrower, collatAmount]);
    await send(xtokenCollat.underlying, 'approve', [xtokenCollat._address, collatAmount], {from: borrower});
    await send(xtokenBorrow.underlying, 'harnessSetBalance', [xtokenBorrow._address, collatAmount]);
    await send(xtokenBorrow, 'harnessSetTotalSupply', [collatAmount * 10]);
    await send(xtokenBorrow, 'harnessSetExchangeRate', [etherExp(1)]);
    expect(await enterMarkets([xtokenCollat], borrower)).toSucceed();
    expect(await send(xtokenCollat, 'mint', [collatAmount], {from: borrower})).toSucceed();
    expect(await send(xtokenBorrow, 'borrow', [borrowAmount], {from: borrower})).toSucceed();

    // show the account is healthy
    expect(await call(xtroller, 'isDeprecated', [xtokenBorrow._address])).toEqual(false);
    expect(await call(xtroller, 'liquidateBorrowAllowed', [xtokenBorrow._address, xtokenCollat._address, liquidator, borrower, borrowAmount])).toHaveTrollError('INSUFFICIENT_SHORTFALL');

    // show deprecating a market works
    expect(await send(xtroller, '_setCollateralFactor', [xtokenBorrow._address, 0])).toSucceed();
    expect(await send(xtroller, '_setBorrowPaused', [xtokenBorrow._address, true])).toSucceed();
    expect(await send(xtokenBorrow, '_setReserveFactor', [etherMantissa(1)])).toSucceed();

    expect(await call(xtroller, 'isDeprecated', [xtokenBorrow._address])).toEqual(true);

    // show deprecated markets can be liquidated even if healthy
    expect(await send(xtroller, 'liquidateBorrowAllowed', [xtokenBorrow._address, xtokenCollat._address, liquidator, borrower, borrowAmount])).toSucceed();
    
    // even if deprecated, cant over repay
    await expect(send(xtroller, 'liquidateBorrowAllowed', [xtokenBorrow._address, xtokenCollat._address, liquidator, borrower, borrowAmount * 2])).rejects.toRevert('revert Can not repay more than the total borrow');
  });
})
