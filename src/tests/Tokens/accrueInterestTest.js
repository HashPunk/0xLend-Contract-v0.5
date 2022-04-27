const {
  etherMantissa,
  etherUnsigned,
  UInt256Max
} = require('../Utils/Ethereum');
const {
  makextoken,
  setBorrowRate
} = require('../Utils/0xlend');

const blockNumber = 2e7;
const borrowIndex = 1e18;
const borrowRate = .000001;

async function pretendBlock(xtoken, accrualBlock = blockNumber, deltaBlocks = 1) {
  await send(xtoken, 'harnessSetAccrualBlockNumber', [etherUnsigned(blockNumber)]);
  await send(xtoken, 'harnessSetBlockNumber', [etherUnsigned(blockNumber + deltaBlocks)]);
  await send(xtoken, 'harnessSetBorrowIndex', [etherUnsigned(borrowIndex)]);
}

async function preAccrue(xtoken) {
  await setBorrowRate(xtoken, borrowRate);
  await send(xtoken.interestRateModel, 'setFailBorrowRate', [false]);
  await send(xtoken, 'harnessExchangeRateDetails', [0, 0, 0]);
}

describe('xtoken', () => {
  let root, accounts;
  let xtoken;
  beforeEach(async () => {
    [root, ...accounts] = saddle.accounts;
    xtoken = await makextoken({xtrollerOpts: {kind: 'bool'}});
  });

  beforeEach(async () => {
    await preAccrue(xtoken);
  });

  describe('accrueInterest', () => {
    it('reverts if the interest rate is absurdly high', async () => {
      await pretendBlock(xtoken, blockNumber, 1);
      expect(await call(xtoken, 'getBorrowRateMaxMantissa')).toEqualNumber(etherMantissa(0.000005)); // 0.0005% per block
      await setBorrowRate(xtoken, 0.001e-2); // 0.0010% per block
      await expect(send(xtoken, 'accrueInterest')).rejects.toRevert("revert borrow rate is absurdly high");
    });

    it('fails if new borrow rate calculation fails', async () => {
      await pretendBlock(xtoken, blockNumber, 1);
      await send(xtoken.interestRateModel, 'setFailBorrowRate', [true]);
      await expect(send(xtoken, 'accrueInterest')).rejects.toRevert("revert INTEREST_RATE_MODEL_ERROR");
    });

    it('fails if simple interest factor calculation fails', async () => {
      await pretendBlock(xtoken, blockNumber, 5e70);
      expect(await send(xtoken, 'accrueInterest')).toHaveTokenFailure('MATH_ERROR', 'ACCRUE_INTEREST_SIMPLE_INTEREST_FACTOR_CALCULATION_FAILED');
    });

    it('fails if new borrow index calculation fails', async () => {
      await pretendBlock(xtoken, blockNumber, 5e60);
      expect(await send(xtoken, 'accrueInterest')).toHaveTokenFailure('MATH_ERROR', 'ACCRUE_INTEREST_NEW_BORROW_INDEX_CALCULATION_FAILED');
    });

    it('fails if new borrow interest index calculation fails', async () => {
      await pretendBlock(xtoken)
      await send(xtoken, 'harnessSetBorrowIndex', [UInt256Max()]);
      expect(await send(xtoken, 'accrueInterest')).toHaveTokenFailure('MATH_ERROR', 'ACCRUE_INTEREST_NEW_BORROW_INDEX_CALCULATION_FAILED');
    });

    it('fails if interest accumulated calculation fails', async () => {
      await send(xtoken, 'harnessExchangeRateDetails', [0, UInt256Max(), 0]);
      await pretendBlock(xtoken)
      expect(await send(xtoken, 'accrueInterest')).toHaveTokenFailure('MATH_ERROR', 'ACCRUE_INTEREST_ACCUMULATED_INTEREST_CALCULATION_FAILED');
    });

    it('fails if new total borrows calculation fails', async () => {
      await setBorrowRate(xtoken, 1e-18);
      await pretendBlock(xtoken)
      await send(xtoken, 'harnessExchangeRateDetails', [0, UInt256Max(), 0]);
      expect(await send(xtoken, 'accrueInterest')).toHaveTokenFailure('MATH_ERROR', 'ACCRUE_INTEREST_NEW_TOTAL_BORROWS_CALCULATION_FAILED');
    });

    it('fails if interest accumulated for reserves calculation fails', async () => {
      await setBorrowRate(xtoken, .000001);
      await send(xtoken, 'harnessExchangeRateDetails', [0, etherUnsigned(1e30), UInt256Max()]);
      await send(xtoken, 'harnessSetReserveFactorFresh', [etherUnsigned(1e10)]);
      await pretendBlock(xtoken, blockNumber, 5e20)
      expect(await send(xtoken, 'accrueInterest')).toHaveTokenFailure('MATH_ERROR', 'ACCRUE_INTEREST_NEW_TOTAL_RESERVES_CALCULATION_FAILED');
    });

    it('fails if new total reserves calculation fails', async () => {
      await setBorrowRate(xtoken, 1e-18);
      await send(xtoken, 'harnessExchangeRateDetails', [0, etherUnsigned(1e56), UInt256Max()]);
      await send(xtoken, 'harnessSetReserveFactorFresh', [etherUnsigned(1e17)]);
      await pretendBlock(xtoken)
      expect(await send(xtoken, 'accrueInterest')).toHaveTokenFailure('MATH_ERROR', 'ACCRUE_INTEREST_NEW_TOTAL_RESERVES_CALCULATION_FAILED');
    });

    it('succeeds and saves updated values in storage on success', async () => {
      const startingTotalBorrows = 1e22;
      const startingTotalReserves = 1e20;
      const reserveFactor = 1e17;

      await send(xtoken, 'harnessExchangeRateDetails', [0, etherUnsigned(startingTotalBorrows), etherUnsigned(startingTotalReserves)]);
      await send(xtoken, 'harnessSetReserveFactorFresh', [etherUnsigned(reserveFactor)]);
      await pretendBlock(xtoken)

      const expectedAccrualBlockNumber = blockNumber + 1;
      const expectedBorrowIndex = borrowIndex + borrowIndex * borrowRate;
      const expectedTotalBorrows = startingTotalBorrows + startingTotalBorrows * borrowRate;
      const expectedTotalReserves = startingTotalReserves + startingTotalBorrows *  borrowRate * reserveFactor / 1e18;

      const receipt = await send(xtoken, 'accrueInterest')
      expect(receipt).toSucceed();
      expect(receipt).toHaveLog('AccrueInterest', {
        cashPrior: 0,
        interestAccumulated: etherUnsigned(expectedTotalBorrows).minus(etherUnsigned(startingTotalBorrows)).toFixed(),
        borrowIndex: etherUnsigned(expectedBorrowIndex).toFixed(),
        totalBorrows: etherUnsigned(expectedTotalBorrows).toFixed()
      })
      expect(await call(xtoken, 'accrualBlockNumber')).toEqualNumber(expectedAccrualBlockNumber);
      expect(await call(xtoken, 'borrowIndex')).toEqualNumber(expectedBorrowIndex);
      expect(await call(xtoken, 'totalBorrows')).toEqualNumber(expectedTotalBorrows);
      expect(await call(xtoken, 'totalReserves')).toEqualNumber(expectedTotalReserves);
    });
  });
});
