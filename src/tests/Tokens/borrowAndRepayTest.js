const {
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
  pretendBorrow
} = require('../Utils/0xlend');

const borrowAmount = etherUnsigned(10e3);
const repayAmount = etherUnsigned(10e2);

async function preBorrow(xtoken, borrower, borrowAmount) {
  await send(xtoken.xtroller, 'setBorrowAllowed', [true]);
  await send(xtoken.xtroller, 'setBorrowVerify', [true]);
  await send(xtoken.interestRateModel, 'setFailBorrowRate', [false]);
  await send(xtoken.underlying, 'harnessSetBalance', [xtoken._address, borrowAmount]);
  await send(xtoken, 'harnessSetFailTransferToAddress', [borrower, false]);
  await send(xtoken, 'harnessSetAccountBorrows', [borrower, 0, 0]);
  await send(xtoken, 'harnessSetTotalBorrows', [0]);
}

async function borrowFresh(xtoken, borrower, borrowAmount) {
  return send(xtoken, 'harnessBorrowFresh', [borrower, borrowAmount]);
}

async function borrow(xtoken, borrower, borrowAmount, opts = {}) {
  // make sure to have a block delta so we accrue interest
  await send(xtoken, 'harnessFastForward', [1]);
  return send(xtoken, 'borrow', [borrowAmount], {from: borrower});
}

async function preRepay(xtoken, benefactor, borrower, repayAmount) {
  // setup either benefactor OR borrower for success in repaying
  await send(xtoken.xtroller, 'setRepayBorrowAllowed', [true]);
  await send(xtoken.xtroller, 'setRepayBorrowVerify', [true]);
  await send(xtoken.interestRateModel, 'setFailBorrowRate', [false]);
  await send(xtoken.underlying, 'harnessSetFailTransferFromAddress', [benefactor, false]);
  await send(xtoken.underlying, 'harnessSetFailTransferFromAddress', [borrower, false]);
  await pretendBorrow(xtoken, borrower, 1, 1, repayAmount);
  await preApprove(xtoken, benefactor, repayAmount);
  await preApprove(xtoken, borrower, repayAmount);
}

async function repayBorrowFresh(xtoken, payer, borrower, repayAmount) {
  return send(xtoken, 'harnessRepayBorrowFresh', [payer, borrower, repayAmount], {from: payer});
}

async function repayBorrow(xtoken, borrower, repayAmount) {
  // make sure to have a block delta so we accrue interest
  await send(xtoken, 'harnessFastForward', [1]);
  return send(xtoken, 'repayBorrow', [repayAmount], {from: borrower});
}

async function repayBorrowBehalf(xtoken, payer, borrower, repayAmount) {
  // make sure to have a block delta so we accrue interest
  await send(xtoken, 'harnessFastForward', [1]);
  return send(xtoken, 'repayBorrowBehalf', [borrower, repayAmount], {from: payer});
}

describe('xtoken', function () {
  let xtoken, root, borrower, benefactor, accounts;
  beforeEach(async () => {
    [root, borrower, benefactor, ...accounts] = saddle.accounts;
    xtoken = await makextoken({xtrollerOpts: {kind: 'bool'}});
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

    it("fails if error if protocol has less than borrowAmount of underlying", async () => {
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

    it("transfers the underlying cash, tokens, and emits Transfer, Borrow events", async () => {
      const beforeProtocolCash = await balanceOf(xtoken.underlying, xtoken._address);
      const beforeProtocolBorrows = await totalBorrows(xtoken);
      const beforeAccountCash = await balanceOf(xtoken.underlying, borrower);
      const result = await borrowFresh(xtoken, borrower, borrowAmount);
      expect(result).toSucceed();
      expect(await balanceOf(xtoken.underlying, borrower)).toEqualNumber(beforeAccountCash.plus(borrowAmount));
      expect(await balanceOf(xtoken.underlying, xtoken._address)).toEqualNumber(beforeProtocolCash.minus(borrowAmount));
      expect(await totalBorrows(xtoken)).toEqualNumber(beforeProtocolBorrows.plus(borrowAmount));
      expect(result).toHaveLog('Transfer', {
        from: xtoken._address,
        to: borrower,
        amount: borrowAmount.toString()
      });
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
      await expect(borrow(xtoken, borrower, borrowAmount)).rejects.toRevert("revert INTEREST_RATE_MODEL_ERROR");
    });

    it("returns error from borrowFresh without emitting any extra logs", async () => {
      expect(await borrow(xtoken, borrower, borrowAmount.plus(1))).toHaveTokenFailure('TOKEN_INSUFFICIENT_CASH', 'BORROW_CASH_NOT_AVAILABLE');
    });

    it("returns success from borrowFresh and transfers the correct amount", async () => {
      const beforeAccountCash = await balanceOf(xtoken.underlying, borrower);
      await fastForward(xtoken);
      expect(await borrow(xtoken, borrower, borrowAmount)).toSucceed();
      expect(await balanceOf(xtoken.underlying, borrower)).toEqualNumber(beforeAccountCash.plus(borrowAmount));
    });
  });

  describe('repayBorrowFresh', () => {
    [true, false].forEach((benefactorIsPayer) => {
      let payer;
      const label = benefactorIsPayer ? "benefactor paying" : "borrower paying";
      describe(label, () => {
        beforeEach(async () => {
          payer = benefactorIsPayer ? benefactor : borrower;
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

        it("fails if insufficient approval", async() => {
          await preApprove(xtoken, payer, 1);
          await expect(repayBorrowFresh(xtoken, payer, borrower, repayAmount)).rejects.toRevert('revert Insufficient allowance');
        });

        it("fails if insufficient balance", async() => {
          await setBalance(xtoken.underlying, payer, 1);
          await expect(repayBorrowFresh(xtoken, payer, borrower, repayAmount)).rejects.toRevert('revert Insufficient balance');
        });


        it("returns an error if calculating account new account borrow balance fails", async () => {
          await pretendBorrow(xtoken, borrower, 1, 1, 1);
          await expect(repayBorrowFresh(xtoken, payer, borrower, repayAmount)).rejects.toRevert("revert REPAY_BORROW_NEW_ACCOUNT_BORROW_BALANCE_CALCULATION_FAILED");
        });

        it("returns an error if calculation of new total borrow balance fails", async () => {
          await send(xtoken, 'harnessSetTotalBorrows', [1]);
          await expect(repayBorrowFresh(xtoken, payer, borrower, repayAmount)).rejects.toRevert("revert REPAY_BORROW_NEW_TOTAL_BALANCE_CALCULATION_FAILED");
        });


        it("reverts if doTransferIn fails", async () => {
          await send(xtoken.underlying, 'harnessSetFailTransferFromAddress', [payer, true]);
          await expect(repayBorrowFresh(xtoken, payer, borrower, repayAmount)).rejects.toRevert("revert TOKEN_TRANSFER_IN_FAILED");
        });

        xit("reverts if repayBorrowVerify fails", async() => {
          await send(xtoken.xtroller, 'setRepayBorrowVerify', [false]);
          await expect(repayBorrowFresh(xtoken, payer, borrower, repayAmount)).rejects.toRevert("revert repayBorrowVerify rejected repayBorrow");
        });

        it("transfers the underlying cash, and emits Transfer, RepayBorrow events", async () => {
          const beforeProtocolCash = await balanceOf(xtoken.underlying, xtoken._address);
          const result = await repayBorrowFresh(xtoken, payer, borrower, repayAmount);
          expect(await balanceOf(xtoken.underlying, xtoken._address)).toEqualNumber(beforeProtocolCash.plus(repayAmount));
          expect(result).toHaveLog('Transfer', {
            from: payer,
            to: xtoken._address,
            amount: repayAmount.toString()
          });
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

    it("emits a repay borrow failure if interest accrual fails", async () => {
      await send(xtoken.interestRateModel, 'setFailBorrowRate', [true]);
      await expect(repayBorrow(xtoken, borrower, repayAmount)).rejects.toRevert("revert INTEREST_RATE_MODEL_ERROR");
    });

    it("returns error from repayBorrowFresh without emitting any extra logs", async () => {
      await setBalance(xtoken.underlying, borrower, 1);
      await expect(repayBorrow(xtoken, borrower, repayAmount)).rejects.toRevert('revert Insufficient balance');
    });

    it("returns success from repayBorrowFresh and repays the right amount", async () => {
      await fastForward(xtoken);
      const beforeAccountBorrowSnap = await borrowSnapshot(xtoken, borrower);
      expect(await repayBorrow(xtoken, borrower, repayAmount)).toSucceed();
      const afterAccountBorrowSnap = await borrowSnapshot(xtoken, borrower);
      expect(afterAccountBorrowSnap.principal).toEqualNumber(beforeAccountBorrowSnap.principal.minus(repayAmount));
    });

    it("repays the full amount owed if payer has enough", async () => {
      await fastForward(xtoken);
      expect(await repayBorrow(xtoken, borrower, UInt256Max())).toSucceed();
      const afterAccountBorrowSnap = await borrowSnapshot(xtoken, borrower);
      expect(afterAccountBorrowSnap.principal).toEqualNumber(0);
    });

    it("fails gracefully if payer does not have enough", async () => {
      await setBalance(xtoken.underlying, borrower, 3);
      await fastForward(xtoken);
      await expect(repayBorrow(xtoken, borrower, UInt256Max())).rejects.toRevert('revert Insufficient balance');
    });
  });

  describe('repayBorrowBehalf', () => {
    let payer;

    beforeEach(async () => {
      payer = benefactor;
      await preRepay(xtoken, payer, borrower, repayAmount);
    });

    it("emits a repay borrow failure if interest accrual fails", async () => {
      await send(xtoken.interestRateModel, 'setFailBorrowRate', [true]);
      await expect(repayBorrowBehalf(xtoken, payer, borrower, repayAmount)).rejects.toRevert("revert INTEREST_RATE_MODEL_ERROR");
    });

    it("returns error from repayBorrowFresh without emitting any extra logs", async () => {
      await setBalance(xtoken.underlying, payer, 1);
      await expect(repayBorrowBehalf(xtoken, payer, borrower, repayAmount)).rejects.toRevert('revert Insufficient balance');
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
