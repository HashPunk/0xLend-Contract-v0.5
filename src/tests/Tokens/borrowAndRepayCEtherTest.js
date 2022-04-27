const {
  etherGasCost,
  etherUnsigned,
  etherMantissa,
  UInt256Max
} = require('../Utils/Ethereum');

const {
  makextoken,
  balanceOf,
  borrowSnapshot,
  totalBorrows,
  fastForward,
  setBalance,
  preApprove,
  pretendBorrow,
  setEtherBalance,
  getBalances,
  adjustBalances
} = require('../Utils/0xlend');

const BigNumber = require('bignumber.js');

const borrowAmount = etherUnsigned(10e3);
const repayAmount = etherUnsigned(10e2);

async function preBorrow(xtoken, borrower, borrowAmount) {
  await send(xtoken.xtroller, 'setBorrowAllowed', [true]);
  await send(xtoken.xtroller, 'setBorrowVerify', [true]);
  await send(xtoken.interestRateModel, 'setFailBorrowRate', [false]);
  await send(xtoken, 'harnessSetFailTransferToAddress', [borrower, false]);
  await send(xtoken, 'harnessSetAccountBorrows', [borrower, 0, 0]);
  await send(xtoken, 'harnessSetTotalBorrows', [0]);
  await setEtherBalance(xtoken, borrowAmount);
}

async function borrowFresh(xtoken, borrower, borrowAmount) {
  return send(xtoken, 'harnessBorrowFresh', [borrower, borrowAmount], {from: borrower});
}

async function borrow(xtoken, borrower, borrowAmount, opts = {}) {
  await send(xtoken, 'harnessFastForward', [1]);
  return send(xtoken, 'borrow', [borrowAmount], {from: borrower});
}

async function preRepay(xtoken, benefactor, borrower, repayAmount) {
  // setup either benefactor OR borrower for success in repaying
  await send(xtoken.xtroller, 'setRepayBorrowAllowed', [true]);
  await send(xtoken.xtroller, 'setRepayBorrowVerify', [true]);
  await send(xtoken.interestRateModel, 'setFailBorrowRate', [false]);
  await pretendBorrow(xtoken, borrower, 1, 1, repayAmount);
}

async function repayBorrowFresh(xtoken, payer, borrower, repayAmount) {
  return send(xtoken, 'harnessRepayBorrowFresh', [payer, borrower, repayAmount], {from: payer, value: repayAmount});
}

async function repayBorrow(xtoken, borrower, repayAmount) {
  await send(xtoken, 'harnessFastForward', [1]);
  return send(xtoken, 'repayBorrow', [], {from: borrower, value: repayAmount});
}

async function repayBorrowBehalf(xtoken, payer, borrower, repayAmount) {
  await send(xtoken, 'harnessFastForward', [1]);
  return send(xtoken, 'repayBorrowBehalf', [borrower], {from: payer, value: repayAmount});
}

describe('xkcc', function () {
  let xtoken, root, borrower, benefactor, accounts;
  beforeEach(async () => {
    [root, borrower, benefactor, ...accounts] = saddle.accounts;
    xtoken = await makextoken({kind: 'xkcc', xtrollerOpts: {kind: 'bool'}});
  });

  describe('borrowFresh', () => {
    beforeEach(async () => await preBorrow(xtoken, borrower, borrowAmount));

    it("fails if xtroller tells it to", async () => {
      await send(xtoken.xtroller, 'setBorrowAllowed', [false]);
      expect(await borrowFresh(xtoken, borrower, borrowAmount)).toHaveTrollReject('BORROW_xtroller_REJECTION');
    });

    it("proceeds if xtroller tells it to", async () => {
      await expect(await borrowFresh(xtoken, borrower, borrowAmount)).toSucceed();
    });

    it("fails if market not fresh", async () => {
      await fastForward(xtoken);
      expect(await borrowFresh(xtoken, borrower, borrowAmount)).toHaveTokenFailure('MARKET_NOT_FRESH', 'BORROW_FRESHNESS_CHECK');
    });

    it("continues if fresh", async () => {
      await expect(await send(xtoken, 'accrueInterest')).toSucceed();
      await expect(await borrowFresh(xtoken, borrower, borrowAmount)).toSucceed();
    });

    it("fails if protocol has less than borrowAmount of underlying", async () => {
      expect(await borrowFresh(xtoken, borrower, borrowAmount.plus(1))).toHaveTokenFailure('TOKEN_INSUFFICIENT_CASH', 'BORROW_CASH_NOT_AVAILABLE');
    });

    it("fails if borrowBalanceStored fails (due to non-zero stored principal with zero account index)", async () => {
      await pretendBorrow(xtoken, borrower, 0, 3e18, 5e18);
      expect(await borrowFresh(xtoken, borrower, borrowAmount)).toHaveTokenFailure('MATH_ERROR', 'BORROW_ACCUMULATED_BALANCE_CALCULATION_FAILED');
    });

    it("fails if calculating account new total borrow balance overflows", async () => {
      await pretendBorrow(xtoken, borrower, 1e-18, 1e-18, UInt256Max());
      expect(await borrowFresh(xtoken, borrower, borrowAmount)).toHaveTokenFailure('MATH_ERROR', 'BORROW_NEW_ACCOUNT_BORROW_BALANCE_CALCULATION_FAILED');
    });

    it("fails if calculation of new total borrow balance overflows", async () => {
      await send(xtoken, 'harnessSetTotalBorrows', [UInt256Max()]);
      expect(await borrowFresh(xtoken, borrower, borrowAmount)).toHaveTokenFailure('MATH_ERROR', 'BORROW_NEW_TOTAL_BALANCE_CALCULATION_FAILED');
    });

    it("reverts if transfer out fails", async () => {
      await send(xtoken, 'harnessSetFailTransferToAddress', [borrower, true]);
      await expect(borrowFresh(xtoken, borrower, borrowAmount)).rejects.toRevert("revert TOKEN_TRANSFER_OUT_FAILED");
    });

    xit("reverts if borrowVerify fails", async() => {
      await send(xtoken.xtroller, 'setBorrowVerify', [false]);
      await expect(borrowFresh(xtoken, borrower, borrowAmount)).rejects.toRevert("revert borrowVerify rejected borrow");
    });

    it("transfers the underlying cash, tokens, and emits Borrow event", async () => {
      const beforeBalances = await getBalances([xtoken], [borrower]);
      const beforeProtocolBorrows = await totalBorrows(xtoken);
      const result = await borrowFresh(xtoken, borrower, borrowAmount);
      const afterBalances = await getBalances([xtoken], [borrower]);
      expect(result).toSucceed();
      expect(afterBalances).toEqual(await adjustBalances(beforeBalances, [
        [xtoken, 'eth', -borrowAmount],
        [xtoken, 'borrows', borrowAmount],
        [xtoken, borrower, 'eth', borrowAmount.minus(await etherGasCost(result))],
        [xtoken, borrower, 'borrows', borrowAmount]
      ]));
      expect(result).toHaveLog('Borrow', {
        borrower: borrower,
        borrowAmount: borrowAmount.toString(),
        accountBorrows: borrowAmount.toString(),
        totalBorrows: beforeProtocolBorrows.plus(borrowAmount).toString()
      });
    });

    it("stores new borrow principal and interest index", async () => {
      const beforeProtocolBorrows = await totalBorrows(xtoken);
      await pretendBorrow(xtoken, borrower, 0, 3, 0);
      await borrowFresh(xtoken, borrower, borrowAmount);
      const borrowSnap = await borrowSnapshot(xtoken, borrower);
      expect(borrowSnap.principal).toEqualNumber(borrowAmount);
      expect(borrowSnap.interestIndex).toEqualNumber(etherMantissa(3));
      expect(await totalBorrows(xtoken)).toEqualNumber(beforeProtocolBorrows.plus(borrowAmount));
    });
  });

  describe('borrow', () => {
    beforeEach(async () => await preBorrow(xtoken, borrower, borrowAmount));

    it("emits a borrow failure if interest accrual fails", async () => {
      await send(xtoken.interestRateModel, 'setFailBorrowRate', [true]);
      await send(xtoken, 'harnessFastForward', [1]);
      await expect(borrow(xtoken, borrower, borrowAmount)).rejects.toRevert("revert INTEREST_RATE_MODEL_ERROR");
    });

    it("returns error from borrowFresh without emitting any extra logs", async () => {
      expect(await borrow(xtoken, borrower, borrowAmount.plus(1))).toHaveTokenFailure('TOKEN_INSUFFICIENT_CASH', 'BORROW_CASH_NOT_AVAILABLE');
    });

    it("returns success from borrowFresh and transfers the correct amount", async () => {
      const beforeBalances = await getBalances([xtoken], [borrower]);
      await fastForward(xtoken);
      const result = await borrow(xtoken, borrower, borrowAmount);
      const afterBalances = await getBalances([xtoken], [borrower]);
      expect(result).toSucceed();
      expect(afterBalances).toEqual(await adjustBalances(beforeBalances, [
        [xtoken, 'eth', -borrowAmount],
        [xtoken, 'borrows', borrowAmount],
        [xtoken, borrower, 'eth', borrowAmount.minus(await etherGasCost(result))],
        [xtoken, borrower, 'borrows', borrowAmount]
      ]));
    });
  });

  describe('repayBorrowFresh', () => {
    [true, false].forEach(async (benefactorPaying) => {
      let payer;
      const label = benefactorPaying ? "benefactor paying" : "borrower paying";
      describe(label, () => {
        beforeEach(async () => {
          payer = benefactorPaying ? benefactor : borrower;

          await preRepay(xtoken, payer, borrower, repayAmount);
        });

        it("fails if repay is not allowed", async () => {
          await send(xtoken.xtroller, 'setRepayBorrowAllowed', [false]);
          expect(await repayBorrowFresh(xtoken, payer, borrower, repayAmount)).toHaveTrollReject('REPAY_BORROW_xtroller_REJECTION', 'MATH_ERROR');
        });

        it("fails if block number ≠ current block number", async () => {
          await fastForward(xtoken);
          expect(await repayBorrowFresh(xtoken, payer, borrower, repayAmount)).toHaveTokenFailure('MARKET_NOT_FRESH', 'REPAY_BORROW_FRESHNESS_CHECK');
        });

        it("returns an error if calculating account new account borrow balance fails", async () => {
          await pretendBorrow(xtoken, borrower, 1, 1, 1);
          await expect(repayBorrowFresh(xtoken, payer, borrower, repayAmount)).rejects.toRevert('revert REPAY_BORROW_NEW_ACCOUNT_BORROW_BALANCE_CALCULATION_FAILED');
        });

        it("returns an error if calculation of new total borrow balance fails", async () => {
          await send(xtoken, 'harnessSetTotalBorrows', [1]);
          await expect(repayBorrowFresh(xtoken, payer, borrower, repayAmount)).rejects.toRevert('revert REPAY_BORROW_NEW_TOTAL_BALANCE_CALCULATION_FAILED');
        });

        it("reverts if checkTransferIn fails", async () => {
          await expect(
            send(xtoken, 'harnessRepayBorrowFresh', [payer, borrower, repayAmount], {from: root, value: repayAmount})
          ).rejects.toRevert("revert sender mismatch");
          await expect(
            send(xtoken, 'harnessRepayBorrowFresh', [payer, borrower, repayAmount], {from: payer, value: 1})
          ).rejects.toRevert("revert value mismatch");
        });

        xit("reverts if repayBorrowVerify fails", async() => {
          await send(xtoken.xtroller, 'setRepayBorrowVerify', [false]);
          await expect(repayBorrowFresh(xtoken, payer, borrower, repayAmount)).rejects.toRevert("revert repayBorrowVerify rejected repayBorrow");
        });

        it("transfers the underlying cash, and emits RepayBorrow event", async () => {
          const beforeBalances = await getBalances([xtoken], [borrower]);
          const result = await repayBorrowFresh(xtoken, payer, borrower, repayAmount);
          const afterBalances = await getBalances([xtoken], [borrower]);
          expect(result).toSucceed();
          if (borrower == payer) {
            expect(afterBalances).toEqual(await adjustBalances(beforeBalances, [
              [xtoken, 'eth', repayAmount],
              [xtoken, 'borrows', -repayAmount],
              [xtoken, borrower, 'borrows', -repayAmount],
              [xtoken, borrower, 'eth', -repayAmount.plus(await etherGasCost(result))]
            ]));
          } else {
            expect(afterBalances).toEqual(await adjustBalances(beforeBalances, [
              [xtoken, 'eth', repayAmount],
              [xtoken, 'borrows', -repayAmount],
              [xtoken, borrower, 'borrows', -repayAmount],
            ]));
          }
          expect(result).toHaveLog('RepayBorrow', {
            payer: payer,
            borrower: borrower,
            repayAmount: repayAmount.toString(),
            accountBorrows: "0",
            totalBorrows: "0"
          });
        });

        it("stores new borrow principal and interest index", async () => {
          const beforeProtocolBorrows = await totalBorrows(xtoken);
          const beforeAccountBorrowSnap = await borrowSnapshot(xtoken, borrower);
          expect(await repayBorrowFresh(xtoken, payer, borrower, repayAmount)).toSucceed();
          const afterAccountBorrows = await borrowSnapshot(xtoken, borrower);
          expect(afterAccountBorrows.principal).toEqualNumber(beforeAccountBorrowSnap.principal.minus(repayAmount));
          expect(afterAccountBorrows.interestIndex).toEqualNumber(etherMantissa(1));
          expect(await totalBorrows(xtoken)).toEqualNumber(beforeProtocolBorrows.minus(repayAmount));
        });
      });
    });
  });

  describe('repayBorrow', () => {
    beforeEach(async () => {
      await preRepay(xtoken, borrower, borrower, repayAmount);
    });

    it("reverts if interest accrual fails", async () => {
      await send(xtoken.interestRateModel, 'setFailBorrowRate', [true]);
      await expect(repayBorrow(xtoken, borrower, repayAmount)).rejects.toRevert("revert INTEREST_RATE_MODEL_ERROR");
    });

    it("reverts when repay borrow fresh fails", async () => {
      await send(xtoken.xtroller, 'setRepayBorrowAllowed', [false]);
      await expect(repayBorrow(xtoken, borrower, repayAmount)).rejects.toRevertWithError('xtroller_REJECTION', "revert repayBorrow failed");
    });

    it("returns success from repayBorrowFresh and repays the right amount", async () => {
      await fastForward(xtoken);
      const beforeAccountBorrowSnap = await borrowSnapshot(xtoken, borrower);
      expect(await repayBorrow(xtoken, borrower, repayAmount)).toSucceed();
      const afterAccountBorrowSnap = await borrowSnapshot(xtoken, borrower);
      expect(afterAccountBorrowSnap.principal).toEqualNumber(beforeAccountBorrowSnap.principal.minus(repayAmount));
    });

    it("reverts if overpaying", async () => {
      const beforeAccountBorrowSnap = await borrowSnapshot(xtoken, borrower);
      let tooMuch = new BigNumber(beforeAccountBorrowSnap.principal).plus(1);
      await expect(repayBorrow(xtoken, borrower, tooMuch)).rejects.toRevert("revert REPAY_BORROW_NEW_ACCOUNT_BORROW_BALANCE_CALCULATION_FAILED");
      // await assert.toRevertWithError(repayBorrow(xtoken, borrower, tooMuch), 'MATH_ERROR', "revert repayBorrow failed");
    });
  });

  describe('repayBorrowBehalf', () => {
    let payer;

    beforeEach(async () => {
      payer = benefactor;
      await preRepay(xtoken, payer, borrower, repayAmount);
    });

    it("reverts if interest accrual fails", async () => {
      await send(xtoken.interestRateModel, 'setFailBorrowRate', [true]);
      await expect(repayBorrowBehalf(xtoken, payer, borrower, repayAmount)).rejects.toRevert("revert INTEREST_RATE_MODEL_ERROR");
    });

    it("reverts from within repay borrow fresh", async () => {
      await send(xtoken.xtroller, 'setRepayBorrowAllowed', [false]);
      await expect(repayBorrowBehalf(xtoken, payer, borrower, repayAmount)).rejects.toRevertWithError('xtroller_REJECTION', "revert repayBorrowBehalf failed");
    });

    it("returns success from repayBorrowFresh and repays the right amount", async () => {
      await fastForward(xtoken);
      const beforeAccountBorrowSnap = await borrowSnapshot(xtoken, borrower);
      expect(await repayBorrowBehalf(xtoken, payer, borrower, repayAmount)).toSucceed();
      const afterAccountBorrowSnap = await borrowSnapshot(xtoken, borrower);
      expect(afterAccountBorrowSnap.principal).toEqualNumber(beforeAccountBorrowSnap.principal.minus(repayAmount));
    });
  });
});
