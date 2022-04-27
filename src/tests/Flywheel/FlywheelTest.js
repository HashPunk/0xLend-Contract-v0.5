const {
  makextroller,
  makextoken,
  balanceOf,
  fastForward,
  pretendBorrow,
  quickMint,
  quickBorrow,
  enterMarkets
} = require('../Utils/0xlend');
const {
  etherExp,
  etherDouble,
  etherUnsigned,
  etherMantissa
} = require('../Utils/Ethereum');

const compRate = etherUnsigned(1e18);

const compInitialIndex = 1e36;

async function compAccrued(xtroller, user) {
  return etherUnsigned(await call(xtroller, 'compAccrued', [user]));
}

async function compBalance(xtroller, user) {
  return etherUnsigned(await call(xtroller.led, 'balanceOf', [user]))
}

async function totalCompAccrued(xtroller, user) {
  return (await compAccrued(xtroller, user)).plus(await compBalance(xtroller, user));
}

describe('Flywheel upgrade', () => {
  describe('becomes the xtroller', () => {
    it('adds the led markets', async () => {
      let root = saddle.accounts[0];
      let xUnitroller = await makextroller({kind: 'xUnitroller-g2'});
      let compMarkets = await Promise.all([1, 2, 3].map(async _ => {
        return makextoken({xtroller: xUnitroller, supportMarket: true});
      }));
      compMarkets = compMarkets.map(c => c._address);
      xUnitroller = await makextroller({kind: 'xUnitroller-g3', xUnitroller, compMarkets});
      expect(await call(xUnitroller, 'getCompMarkets')).toEqual(compMarkets);
    });

    it('adds the other markets', async () => {
      let root = saddle.accounts[0];
      let xUnitroller = await makextroller({kind: 'xUnitroller-g2'});
      let allMarkets = await Promise.all([1, 2, 3].map(async _ => {
        return makextoken({xtroller: xUnitroller, supportMarket: true});
      }));
      allMarkets = allMarkets.map(c => c._address);
      xUnitroller = await makextroller({
        kind: 'xUnitroller-g3',
        xUnitroller,
        compMarkets: allMarkets.slice(0, 1),
        otherMarkets: allMarkets.slice(1)
      });
      expect(await call(xUnitroller, 'getAllMarkets')).toEqual(allMarkets);
      expect(await call(xUnitroller, 'getCompMarkets')).toEqual(allMarkets.slice(0, 1));
    });

    it('_supportMarket() adds to all markets, and only once', async () => {
      let root = saddle.accounts[0];
      let xUnitroller = await makextroller({kind: 'xUnitroller-g3'});
      let allMarkets = [];
      for (let _ of Array(10)) {
        allMarkets.push(await makextoken({xtroller: xUnitroller, supportMarket: true}));
      }
      expect(await call(xUnitroller, 'getAllMarkets')).toEqual(allMarkets.map(c => c._address));
      expect(
        makextroller({
          kind: 'xUnitroller-g3',
          xUnitroller,
          otherMarkets: [allMarkets[0]._address]
        })
      ).rejects.toRevert('revert market already added');
    });
  });
});

describe('Flywheel', () => {
  let root, a1, a2, a3, accounts;
  let xtroller, cLOW, cREP, cZRX, cEVIL;
  beforeEach(async () => {
    let interestRateModelOpts = {borrowRate: 0.000001};
    [root, a1, a2, a3, ...accounts] = saddle.accounts;
    xtroller = await makextroller();
    cLOW = await makextoken({xtroller, supportMarket: true, underlyingPrice: 1, interestRateModelOpts});
    cREP = await makextoken({xtroller, supportMarket: true, underlyingPrice: 2, interestRateModelOpts});
    cZRX = await makextoken({xtroller, supportMarket: true, underlyingPrice: 3, interestRateModelOpts});
    cEVIL = await makextoken({xtroller, supportMarket: false, underlyingPrice: 3, interestRateModelOpts});
    cUSD = await makextoken({xtroller, supportMarket: true, underlyingPrice: 1, collateralFactor: 0.5, interestRateModelOpts});
  });

  describe('_grantComp()', () => {
    beforeEach(async () => {
      await send(xtroller.led, 'transfer', [xtroller._address, etherUnsigned(50e18)], {from: root});
    });

    it('should award led if called by admin', async () => {
      const tx = await send(xtroller, '_grantComp', [a1, 100]);
      expect(tx).toHaveLog('CompGranted', {
        recipient: a1,
        amount: 100
      });
    });

    it('should revert if not called by admin', async () => {
      await expect(
        send(xtroller, '_grantComp', [a1, 100], {from: a1})
      ).rejects.toRevert('revert only admin can grant led');
    });

    it('should revert if insufficient led', async () => {
      await expect(
        send(xtroller, '_grantComp', [a1, etherUnsigned(1e20)])
      ).rejects.toRevert('revert insufficient led for grant');
    });
  });

  describe('getCompMarkets()', () => {
    it('should return the led markets', async () => {
      for (let mkt of [cLOW, cREP, cZRX]) {
        await send(xtroller, '_setCompSpeeds', [[mkt._address], [etherExp(0.5)], [etherExp(0.5)]]);
      }
      expect(await call(xtroller, 'getCompMarkets')).toEqual(
        [cLOW, cREP, cZRX].map((c) => c._address)
      );
    });
  });

  describe('_setCompSpeeds()', () => {
    it('should update market index when calling setCompSpeed', async () => {
      const mkt = cREP;
      await send(xtroller, 'setBlockNumber', [0]);
      await send(mkt, 'harnessSetTotalSupply', [etherUnsigned(10e18)]);

      await send(xtroller, '_setCompSpeeds', [[mkt._address], [etherExp(0.5)], [etherExp(0.5)]]);
      await fastForward(xtroller, 20);
      await send(xtroller, '_setCompSpeeds', [[mkt._address], [etherExp(1)], [etherExp(0.5)]]);

      const {index, block} = await call(xtroller, 'compSupplyState', [mkt._address]);
      expect(index).toEqualNumber(2e36);
      expect(block).toEqualNumber(20);
    });

    it('should correctly drop a led market if called by admin', async () => {
      for (let mkt of [cLOW, cREP, cZRX]) {
        await send(xtroller, '_setCompSpeeds', [[mkt._address], [etherExp(0.5)], [etherExp(0.5)]]);
      }
      const tx = await send(xtroller, '_setCompSpeeds', [[cLOW._address], [0], [0]]);
      expect(await call(xtroller, 'getCompMarkets')).toEqual(
        [cREP, cZRX].map((c) => c._address)
      );
      expect(tx).toHaveLog('CompBorrowSpeedUpdated', {
        xtoken: cLOW._address,
        newSpeed: 0
      });
      expect(tx).toHaveLog('CompSupplySpeedUpdated', {
        xtoken: cLOW._address,
        newSpeed: 0
      });
    });

    it('should correctly drop a led market from middle of array', async () => {
      for (let mkt of [cLOW, cREP, cZRX]) {
        await send(xtroller, '_setCompSpeeds', [[mkt._address], [etherExp(0.5)], [etherExp(0.5)]]);
      }
      await send(xtroller, '_setCompSpeeds', [[cREP._address], [0], [0]]);
      expect(await call(xtroller, 'getCompMarkets')).toEqual(
        [cLOW, cZRX].map((c) => c._address)
      );
    });

    it('should not drop a led market unless called by admin', async () => {
      for (let mkt of [cLOW, cREP, cZRX]) {
        await send(xtroller, '_setCompSpeeds', [[mkt._address], [etherExp(0.5)], [etherExp(0.5)]]);
      }
      await expect(
        send(xtroller, '_setCompSpeeds', [[cLOW._address], [0], [etherExp(0.5)]], {from: a1})
      ).rejects.toRevert('revert only admin can set led speed');
    });

    it('should not add non-listed markets', async () => {
      const cBAT = await makextoken({ xtroller, supportMarket: false });
      await expect(
        send(xtroller, 'harnessAddCompMarkets', [[cBAT._address]])
      ).rejects.toRevert('revert led market is not listed');

      const markets = await call(xtroller, 'getCompMarkets');
      expect(markets).toEqual([]);
    });
  });

  describe('updateCompBorrowIndex()', () => {
    it('should calculate led borrower index correctly', async () => {
      const mkt = cREP;
      await send(xtroller, '_setCompSpeeds', [[mkt._address], [etherExp(0.5)], [etherExp(0.5)]]);
      await send(xtroller, 'setBlockNumber', [100]);
      await send(mkt, 'harnessSetTotalBorrows', [etherUnsigned(11e18)]);
      await send(xtroller, 'harnessUpdateCompBorrowIndex', [
        mkt._address,
        etherExp(1.1),
      ]);
      /*
        100 blocks, 10e18 origin total borrows, 0.5e18 borrowSpeed

        borrowAmt   = totalBorrows * 1e18 / borrowIdx
                    = 11e18 * 1e18 / 1.1e18 = 10e18
        compAccrued = deltaBlocks * borrowSpeed
                    = 100 * 0.5e18 = 50e18
        newIndex   += 1e36 + compAccrued * 1e36 / borrowAmt
                    = 1e36 + 50e18 * 1e36 / 10e18 = 6e36
      */

      const {index, block} = await call(xtroller, 'compBorrowState', [mkt._address]);
      expect(index).toEqualNumber(6e36);
      expect(block).toEqualNumber(100);
    });

    it('should not revert or update compBorrowState index if xtoken not in led markets', async () => {
      const mkt = await makextoken({
        xtroller: xtroller,
        supportMarket: true,
        addCompMarket: false,
      });
      await send(xtroller, 'setBlockNumber', [100]);
      await send(xtroller, 'harnessUpdateCompBorrowIndex', [
        mkt._address,
        etherExp(1.1),
      ]);

      const {index, block} = await call(xtroller, 'compBorrowState', [mkt._address]);
      expect(index).toEqualNumber(compInitialIndex);
      expect(block).toEqualNumber(100);
      const supplySpeed = await call(xtroller, 'compSupplySpeeds', [mkt._address]);
      expect(supplySpeed).toEqualNumber(0);
      const borrowSpeed = await call(xtroller, 'compBorrowSpeeds', [mkt._address]);
      expect(borrowSpeed).toEqualNumber(0);
    });

    it('should not update index if no blocks passed since last accrual', async () => {
      const mkt = cREP;
      await send(xtroller, '_setCompSpeeds', [[mkt._address], [etherExp(0.5)], [etherExp(0.5)]]);
      await send(xtroller, 'harnessUpdateCompBorrowIndex', [
        mkt._address,
        etherExp(1.1),
      ]);

      const {index, block} = await call(xtroller, 'compBorrowState', [mkt._address]);
      expect(index).toEqualNumber(compInitialIndex);
      expect(block).toEqualNumber(0);
    });

    it('should not update index if led speed is 0', async () => {
      const mkt = cREP;
      await send(xtroller, '_setCompSpeeds', [[mkt._address], [etherExp(0.5)], [etherExp(0.5)]]);
      await send(xtroller, 'setBlockNumber', [100]);
      await send(xtroller, '_setCompSpeeds', [[mkt._address], [etherExp(0)], [etherExp(0)]]);
      await send(xtroller, 'harnessUpdateCompBorrowIndex', [
        mkt._address,
        etherExp(1.1),
      ]);

      const {index, block} = await call(xtroller, 'compBorrowState', [mkt._address]);
      expect(index).toEqualNumber(compInitialIndex);
      expect(block).toEqualNumber(100);
    });
  });

  describe('updateCompSupplyIndex()', () => {
    it('should calculate led supplier index correctly', async () => {
      const mkt = cREP;
      await send(xtroller, '_setCompSpeeds', [[mkt._address], [etherExp(0.5)], [etherExp(0.5)]]);
      await send(xtroller, 'setBlockNumber', [100]);
      await send(mkt, 'harnessSetTotalSupply', [etherUnsigned(10e18)]);
      await send(xtroller, 'harnessUpdateCompSupplyIndex', [mkt._address]);
      /*
        suppyTokens = 10e18
        compAccrued = deltaBlocks * supplySpeed
                    = 100 * 0.5e18 = 50e18
        newIndex   += compAccrued * 1e36 / supplyTokens
                    = 1e36 + 50e18 * 1e36 / 10e18 = 6e36
      */
      const {index, block} = await call(xtroller, 'compSupplyState', [mkt._address]);
      expect(index).toEqualNumber(6e36);
      expect(block).toEqualNumber(100);
    });

    it('should not update index on non-led markets', async () => {
      const mkt = await makextoken({
        xtroller: xtroller,
        supportMarket: true,
        addCompMarket: false
      });
      await send(xtroller, 'setBlockNumber', [100]);
      await send(xtroller, 'harnessUpdateCompSupplyIndex', [
        mkt._address
      ]);

      const {index, block} = await call(xtroller, 'compSupplyState', [mkt._address]);
      expect(index).toEqualNumber(compInitialIndex);
      expect(block).toEqualNumber(100);
      const supplySpeed = await call(xtroller, 'compSupplySpeeds', [mkt._address]);
      expect(supplySpeed).toEqualNumber(0);
      const borrowSpeed = await call(xtroller, 'compBorrowSpeeds', [mkt._address]);
      expect(borrowSpeed).toEqualNumber(0);
      // xtoken could have no led speed or led supplier state if not in led markets
      // this logic could also possibly be implemented in the allowed hook
    });

    it('should not update index if no blocks passed since last accrual', async () => {
      const mkt = cREP;
      await send(xtroller, 'setBlockNumber', [0]);
      await send(mkt, 'harnessSetTotalSupply', [etherUnsigned(10e18)]);
      await send(xtroller, '_setCompSpeeds', [[mkt._address], [etherExp(0.5)], [etherExp(0.5)]]);
      await send(xtroller, 'harnessUpdateCompSupplyIndex', [mkt._address]);

      const {index, block} = await call(xtroller, 'compSupplyState', [mkt._address]);
      expect(index).toEqualNumber(compInitialIndex);
      expect(block).toEqualNumber(0);
    });

    it('should not matter if the index is updated multiple times', async () => {
      const compRemaining = compRate.multipliedBy(100)
      await send(xtroller, 'harnessAddCompMarkets', [[cLOW._address]]);
      await send(xtroller.led, 'transfer', [xtroller._address, compRemaining], {from: root});
      await pretendBorrow(cLOW, a1, 1, 1, 100);
      await send(xtroller, 'harnessRefreshCompSpeeds');

      await quickMint(cLOW, a2, etherUnsigned(10e18));
      await quickMint(cLOW, a3, etherUnsigned(15e18));

      const a2Accrued0 = await totalCompAccrued(xtroller, a2);
      const a3Accrued0 = await totalCompAccrued(xtroller, a3);
      const a2Balance0 = await balanceOf(cLOW, a2);
      const a3Balance0 = await balanceOf(cLOW, a3);

      await fastForward(xtroller, 20);

      const txT1 = await send(cLOW, 'transfer', [a2, a3Balance0.minus(a2Balance0)], {from: a3});

      const a2Accrued1 = await totalCompAccrued(xtroller, a2);
      const a3Accrued1 = await totalCompAccrued(xtroller, a3);
      const a2Balance1 = await balanceOf(cLOW, a2);
      const a3Balance1 = await balanceOf(cLOW, a3);

      await fastForward(xtroller, 10);
      await send(xtroller, 'harnessUpdateCompSupplyIndex', [cLOW._address]);
      await fastForward(xtroller, 10);

      const txT2 = await send(cLOW, 'transfer', [a3, a2Balance1.minus(a3Balance1)], {from: a2});

      const a2Accrued2 = await totalCompAccrued(xtroller, a2);
      const a3Accrued2 = await totalCompAccrued(xtroller, a3);

      expect(a2Accrued0).toEqualNumber(0);
      expect(a3Accrued0).toEqualNumber(0);
      expect(a2Accrued1).not.toEqualNumber(0);
      expect(a3Accrued1).not.toEqualNumber(0);
      expect(a2Accrued1).toEqualNumber(a3Accrued2.minus(a3Accrued1));
      expect(a3Accrued1).toEqualNumber(a2Accrued2.minus(a2Accrued1));

      expect(txT1.gasUsed).toBeLessThan(200000);
      expect(txT1.gasUsed).toBeGreaterThan(140000);
      expect(txT2.gasUsed).toBeLessThan(150000);
      expect(txT2.gasUsed).toBeGreaterThan(100000);
    });
  });

  describe('distributeBorrowerComp()', () => {

    it('should update borrow index checkpoint but not compAccrued for first time user', async () => {
      const mkt = cREP;
      await send(xtroller, "setCompBorrowState", [mkt._address, etherDouble(6), 10]);
      await send(xtroller, "setCompBorrowerIndex", [mkt._address, root, etherUnsigned(0)]);

      await send(xtroller, "harnessDistributeBorrowerComp", [mkt._address, root, etherExp(1.1)]);
      expect(await call(xtroller, "compAccrued", [root])).toEqualNumber(0);
      expect(await call(xtroller, "compBorrowerIndex", [ mkt._address, root])).toEqualNumber(6e36);
    });

    it('should transfer led and update borrow index checkpoint correctly for repeat time user', async () => {
      const mkt = cREP;
      await send(xtroller.led, 'transfer', [xtroller._address, etherUnsigned(50e18)], {from: root});
      await send(mkt, "harnessSetAccountBorrows", [a1, etherUnsigned(5.5e18), etherExp(1)]);
      await send(xtroller, "setCompBorrowState", [mkt._address, etherDouble(6), 10]);
      await send(xtroller, "setCompBorrowerIndex", [mkt._address, a1, etherDouble(1)]);

      /*
      * 100 delta blocks, 10e18 origin total borrows, 0.5e18 borrowSpeed => 6e18 compBorrowIndex
      * this tests that an acct with half the total borrows over that time gets 25e18 led
        borrowerAmount = borrowBalance * 1e18 / borrow idx
                       = 5.5e18 * 1e18 / 1.1e18 = 5e18
        deltaIndex     = marketStoredIndex - userStoredIndex
                       = 6e36 - 1e36 = 5e36
        borrowerAccrued= borrowerAmount * deltaIndex / 1e36
                       = 5e18 * 5e36 / 1e36 = 25e18
      */
      const tx = await send(xtroller, "harnessDistributeBorrowerComp", [mkt._address, a1, etherUnsigned(1.1e18)]);
      expect(await compAccrued(xtroller, a1)).toEqualNumber(25e18);
      expect(await compBalance(xtroller, a1)).toEqualNumber(0);
      expect(tx).toHaveLog('DistributedBorrowerComp', {
        xtoken: mkt._address,
        borrower: a1,
        compDelta: etherUnsigned(25e18).toFixed(),
        compBorrowIndex: etherDouble(6).toFixed()
      });
    });

    it('should not transfer led automatically', async () => {
      const mkt = cREP;
      await send(xtroller.led, 'transfer', [xtroller._address, etherUnsigned(50e18)], {from: root});
      await send(mkt, "harnessSetAccountBorrows", [a1, etherUnsigned(5.5e17), etherExp(1)]);
      await send(xtroller, "setCompBorrowState", [mkt._address, etherDouble(1.0019), 10]);
      await send(xtroller, "setCompBorrowerIndex", [mkt._address, a1, etherDouble(1)]);
      /*
        borrowerAmount = borrowBalance * 1e18 / borrow idx
                       = 5.5e17 * 1e18 / 1.1e18 = 5e17
        deltaIndex     = marketStoredIndex - userStoredIndex
                       = 1.0019e36 - 1e36 = 0.0019e36
        borrowerAccrued= borrowerAmount * deltaIndex / 1e36
                       = 5e17 * 0.0019e36 / 1e36 = 0.00095e18
        0.00095e18 < compClaimThreshold of 0.001e18
      */
      await send(xtroller, "harnessDistributeBorrowerComp", [mkt._address, a1, etherExp(1.1)]);
      expect(await compAccrued(xtroller, a1)).toEqualNumber(0.00095e18);
      expect(await compBalance(xtroller, a1)).toEqualNumber(0);
    });

    it('should not revert or distribute when called with non-led market', async () => {
      const mkt = await makextoken({
        xtroller: xtroller,
        supportMarket: true,
        addCompMarket: false,
      });

      await send(xtroller, "harnessDistributeBorrowerComp", [mkt._address, a1, etherExp(1.1)]);
      expect(await compAccrued(xtroller, a1)).toEqualNumber(0);
      expect(await compBalance(xtroller, a1)).toEqualNumber(0);
      expect(await call(xtroller, 'compBorrowerIndex', [mkt._address, a1])).toEqualNumber(compInitialIndex);
    });
  });

  describe('distributeSupplierComp()', () => {
    it('should transfer led and update supply index correctly for first time user', async () => {
      const mkt = cREP;
      await send(xtroller.led, 'transfer', [xtroller._address, etherUnsigned(50e18)], {from: root});

      await send(mkt, "harnessSetBalance", [a1, etherUnsigned(5e18)]);
      await send(xtroller, "setCompSupplyState", [mkt._address, etherDouble(6), 10]);
      /*
      * 100 delta blocks, 10e18 total supply, 0.5e18 supplySpeed => 6e18 compSupplyIndex
      * confirming an acct with half the total supply over that time gets 25e18 led:
        supplierAmount  = 5e18
        deltaIndex      = marketStoredIndex - userStoredIndex
                        = 6e36 - 1e36 = 5e36
        suppliedAccrued+= supplierTokens * deltaIndex / 1e36
                        = 5e18 * 5e36 / 1e36 = 25e18
      */

      const tx = await send(xtroller, "harnessDistributeAllSupplierComp", [mkt._address, a1]);
      expect(await compAccrued(xtroller, a1)).toEqualNumber(0);
      expect(await compBalance(xtroller, a1)).toEqualNumber(25e18);
      expect(tx).toHaveLog('DistributedSupplierComp', {
        xtoken: mkt._address,
        supplier: a1,
        compDelta: etherUnsigned(25e18).toFixed(),
        compSupplyIndex: etherDouble(6).toFixed()
      });
    });

    it('should update led accrued and supply index for repeat user', async () => {
      const mkt = cREP;
      await send(xtroller.led, 'transfer', [xtroller._address, etherUnsigned(50e18)], {from: root});

      await send(mkt, "harnessSetBalance", [a1, etherUnsigned(5e18)]);
      await send(xtroller, "setCompSupplyState", [mkt._address, etherDouble(6), 10]);
      await send(xtroller, "setCompSupplierIndex", [mkt._address, a1, etherDouble(2)])
      /*
        supplierAmount  = 5e18
        deltaIndex      = marketStoredIndex - userStoredIndex
                        = 6e36 - 2e36 = 4e36
        suppliedAccrued+= supplierTokens * deltaIndex / 1e36
                        = 5e18 * 4e36 / 1e36 = 20e18
      */

      await send(xtroller, "harnessDistributeAllSupplierComp", [mkt._address, a1]);
      expect(await compAccrued(xtroller, a1)).toEqualNumber(0);
      expect(await compBalance(xtroller, a1)).toEqualNumber(20e18);
    });

    it('should not transfer when compAccrued below threshold', async () => {
      const mkt = cREP;
      await send(xtroller.led, 'transfer', [xtroller._address, etherUnsigned(50e18)], {from: root});

      await send(mkt, "harnessSetBalance", [a1, etherUnsigned(5e17)]);
      await send(xtroller, "setCompSupplyState", [mkt._address, etherDouble(1.0019), 10]);
      /*
        supplierAmount  = 5e17
        deltaIndex      = marketStoredIndex - userStoredIndex
                        = 1.0019e36 - 1e36 = 0.0019e36
        suppliedAccrued+= supplierTokens * deltaIndex / 1e36
                        = 5e17 * 0.0019e36 / 1e36 = 0.00095e18
      */

      await send(xtroller, "harnessDistributeSupplierComp", [mkt._address, a1]);
      expect(await compAccrued(xtroller, a1)).toEqualNumber(0.00095e18);
      expect(await compBalance(xtroller, a1)).toEqualNumber(0);
    });

    it('should not revert or distribute when called with non-led market', async () => {
      const mkt = await makextoken({
        xtroller: xtroller,
        supportMarket: true,
        addCompMarket: false,
      });

      await send(xtroller, "harnessDistributeSupplierComp", [mkt._address, a1]);
      expect(await compAccrued(xtroller, a1)).toEqualNumber(0);
      expect(await compBalance(xtroller, a1)).toEqualNumber(0);
      expect(await call(xtroller, 'compBorrowerIndex', [mkt._address, a1])).toEqualNumber(0);
    });

  });

  describe('transferComp', () => {
    it('should transfer led accrued when amount is above threshold', async () => {
      const compRemaining = 1000, a1AccruedPre = 100, threshold = 1;
      const compBalancePre = await compBalance(xtroller, a1);
      const tx0 = await send(xtroller.led, 'transfer', [xtroller._address, compRemaining], {from: root});
      const tx1 = await send(xtroller, 'setCompAccrued', [a1, a1AccruedPre]);
      const tx2 = await send(xtroller, 'harnessTransferComp', [a1, a1AccruedPre, threshold]);
      const a1AccruedPost = await compAccrued(xtroller, a1);
      const compBalancePost = await compBalance(xtroller, a1);
      expect(compBalancePre).toEqualNumber(0);
      expect(compBalancePost).toEqualNumber(a1AccruedPre);
    });

    it('should not transfer when led accrued is below threshold', async () => {
      const compRemaining = 1000, a1AccruedPre = 100, threshold = 101;
      const compBalancePre = await call(xtroller.led, 'balanceOf', [a1]);
      const tx0 = await send(xtroller.led, 'transfer', [xtroller._address, compRemaining], {from: root});
      const tx1 = await send(xtroller, 'setCompAccrued', [a1, a1AccruedPre]);
      const tx2 = await send(xtroller, 'harnessTransferComp', [a1, a1AccruedPre, threshold]);
      const a1AccruedPost = await compAccrued(xtroller, a1);
      const compBalancePost = await compBalance(xtroller, a1);
      expect(compBalancePre).toEqualNumber(0);
      expect(compBalancePost).toEqualNumber(0);
    });

    it('should not transfer led if led accrued is greater than led remaining', async () => {
      const compRemaining = 99, a1AccruedPre = 100, threshold = 1;
      const compBalancePre = await compBalance(xtroller, a1);
      const tx0 = await send(xtroller.led, 'transfer', [xtroller._address, compRemaining], {from: root});
      const tx1 = await send(xtroller, 'setCompAccrued', [a1, a1AccruedPre]);
      const tx2 = await send(xtroller, 'harnessTransferComp', [a1, a1AccruedPre, threshold]);
      const a1AccruedPost = await compAccrued(xtroller, a1);
      const compBalancePost = await compBalance(xtroller, a1);
      expect(compBalancePre).toEqualNumber(0);
      expect(compBalancePost).toEqualNumber(0);
    });
  });

  describe('claimComp', () => {
    it('should accrue led and then transfer led accrued', async () => {
      const compRemaining = compRate.multipliedBy(100), mintAmount = etherUnsigned(12e18), deltaBlocks = 10;
      await send(xtroller.led, 'transfer', [xtroller._address, compRemaining], {from: root});
      await pretendBorrow(cLOW, a1, 1, 1, 100);
      await send(xtroller, '_setCompSpeeds', [[cLOW._address], [etherExp(0.5)], [etherExp(0.5)]]);
      await send(xtroller, 'harnessRefreshCompSpeeds');
      const supplySpeed = await call(xtroller, 'compSupplySpeeds', [cLOW._address]);
      const borrowSpeed = await call(xtroller, 'compBorrowSpeeds', [cLOW._address]);
      const a2AccruedPre = await compAccrued(xtroller, a2);
      const compBalancePre = await compBalance(xtroller, a2);
      await quickMint(cLOW, a2, mintAmount);
      await fastForward(xtroller, deltaBlocks);
      const tx = await send(xtroller, 'claimComp', [a2]);
      const a2AccruedPost = await compAccrued(xtroller, a2);
      const compBalancePost = await compBalance(xtroller, a2);
      expect(tx.gasUsed).toBeLessThan(500000);
      expect(supplySpeed).toEqualNumber(compRate);
      expect(borrowSpeed).toEqualNumber(compRate);
      expect(a2AccruedPre).toEqualNumber(0);
      expect(a2AccruedPost).toEqualNumber(0);
      expect(compBalancePre).toEqualNumber(0);
      expect(compBalancePost).toEqualNumber(compRate.multipliedBy(deltaBlocks).minus(1)); // index is 8333...
    });

    it('should accrue led and then transfer led accrued in a single market', async () => {
      const compRemaining = compRate.multipliedBy(100), mintAmount = etherUnsigned(12e18), deltaBlocks = 10;
      await send(xtroller.led, 'transfer', [xtroller._address, compRemaining], {from: root});
      await pretendBorrow(cLOW, a1, 1, 1, 100);
      await send(xtroller, 'harnessAddCompMarkets', [[cLOW._address]]);
      await send(xtroller, 'harnessRefreshCompSpeeds');
      const supplySpeed = await call(xtroller, 'compSupplySpeeds', [cLOW._address]);
      const borrowSpeed = await call(xtroller, 'compBorrowSpeeds', [cLOW._address]);
      const a2AccruedPre = await compAccrued(xtroller, a2);
      const compBalancePre = await compBalance(xtroller, a2);
      await quickMint(cLOW, a2, mintAmount);
      await fastForward(xtroller, deltaBlocks);
      const tx = await send(xtroller, 'claimComp', [a2, [cLOW._address]]);
      const a2AccruedPost = await compAccrued(xtroller, a2);
      const compBalancePost = await compBalance(xtroller, a2);
      expect(tx.gasUsed).toBeLessThan(170000);
      expect(supplySpeed).toEqualNumber(compRate);
      expect(borrowSpeed).toEqualNumber(compRate);
      expect(a2AccruedPre).toEqualNumber(0);
      expect(a2AccruedPost).toEqualNumber(0);
      expect(compBalancePre).toEqualNumber(0);
      expect(compBalancePost).toEqualNumber(compRate.multipliedBy(deltaBlocks).minus(1)); // index is 8333...
    });

    it('should claim when led accrued is below threshold', async () => {
      const compRemaining = etherExp(1), accruedAmt = etherUnsigned(0.0009e18)
      await send(xtroller.led, 'transfer', [xtroller._address, compRemaining], {from: root});
      await send(xtroller, 'setCompAccrued', [a1, accruedAmt]);
      await send(xtroller, 'claimComp', [a1, [cLOW._address]]);
      expect(await compAccrued(xtroller, a1)).toEqualNumber(0);
      expect(await compBalance(xtroller, a1)).toEqualNumber(accruedAmt);
    });

    it('should revert when a market is not listed', async () => {
      const cNOT = await makextoken({xtroller});
      await expect(
        send(xtroller, 'claimComp', [a1, [cNOT._address]])
      ).rejects.toRevert('revert market must be listed');
    });
  });

  describe('claimComp batch', () => {
    it('should revert when claiming led from non-listed market', async () => {
      const compRemaining = compRate.multipliedBy(100), deltaBlocks = 10, mintAmount = etherExp(10);
      await send(xtroller.led, 'transfer', [xtroller._address, compRemaining], {from: root});
      let [_, __, ...claimAccts] = saddle.accounts;

      for(let from of claimAccts) {
        expect(await send(cLOW.underlying, 'harnessSetBalance', [from, mintAmount], { from })).toSucceed();
        send(cLOW.underlying, 'approve', [cLOW._address, mintAmount], { from });
        send(cLOW, 'mint', [mintAmount], { from });
      }

      await pretendBorrow(cLOW, root, 1, 1, etherExp(10));
      await send(xtroller, 'harnessRefreshCompSpeeds');

      await fastForward(xtroller, deltaBlocks);

      await expect(send(xtroller, 'claimComp', [claimAccts, [cLOW._address, cEVIL._address], true, true])).rejects.toRevert('revert market must be listed');
    });

    it('should claim the expected amount when holders and xtokens arg is duplicated', async () => {
      const compRemaining = compRate.multipliedBy(100), deltaBlocks = 10, mintAmount = etherExp(10);
      await send(xtroller.led, 'transfer', [xtroller._address, compRemaining], {from: root});
      let [_, __, ...claimAccts] = saddle.accounts;
      for(let from of claimAccts) {
        expect(await send(cLOW.underlying, 'harnessSetBalance', [from, mintAmount], { from })).toSucceed();
        send(cLOW.underlying, 'approve', [cLOW._address, mintAmount], { from });
        send(cLOW, 'mint', [mintAmount], { from });
      }
      await pretendBorrow(cLOW, root, 1, 1, etherExp(10));
      await send(xtroller, 'harnessAddCompMarkets', [[cLOW._address]]);
      await send(xtroller, 'harnessRefreshCompSpeeds');

      await fastForward(xtroller, deltaBlocks);

      const tx = await send(xtroller, 'claimComp', [[...claimAccts, ...claimAccts], [cLOW._address, cLOW._address], false, true]);
      // led distributed => 10e18
      for(let acct of claimAccts) {
        expect(await call(xtroller, 'compSupplierIndex', [cLOW._address, acct])).toEqualNumber(etherDouble(1.125));
        expect(await compBalance(xtroller, acct)).toEqualNumber(etherExp(1.25));
      }
    });

    it('claims led for multiple suppliers only', async () => {
      const compRemaining = compRate.multipliedBy(100), deltaBlocks = 10, mintAmount = etherExp(10);
      await send(xtroller.led, 'transfer', [xtroller._address, compRemaining], {from: root});
      let [_, __, ...claimAccts] = saddle.accounts;
      for(let from of claimAccts) {
        expect(await send(cLOW.underlying, 'harnessSetBalance', [from, mintAmount], { from })).toSucceed();
        send(cLOW.underlying, 'approve', [cLOW._address, mintAmount], { from });
        send(cLOW, 'mint', [mintAmount], { from });
      }
      await pretendBorrow(cLOW, root, 1, 1, etherExp(10));
      await send(xtroller, 'harnessAddCompMarkets', [[cLOW._address]]);
      await send(xtroller, 'harnessRefreshCompSpeeds');

      await fastForward(xtroller, deltaBlocks);

      const tx = await send(xtroller, 'claimComp', [claimAccts, [cLOW._address], false, true]);
      // led distributed => 10e18
      for(let acct of claimAccts) {
        expect(await call(xtroller, 'compSupplierIndex', [cLOW._address, acct])).toEqualNumber(etherDouble(1.125));
        expect(await compBalance(xtroller, acct)).toEqualNumber(etherExp(1.25));
      }
    });

    it('claims led for multiple borrowers only, primes uninitiated', async () => {
      const compRemaining = compRate.multipliedBy(100), deltaBlocks = 10, mintAmount = etherExp(10), borrowAmt = etherExp(1), borrowIdx = etherExp(1)
      await send(xtroller.led, 'transfer', [xtroller._address, compRemaining], {from: root});
      let [_,__, ...claimAccts] = saddle.accounts;

      for(let acct of claimAccts) {
        await send(cLOW, 'harnessIncrementTotalBorrows', [borrowAmt]);
        await send(cLOW, 'harnessSetAccountBorrows', [acct, borrowAmt, borrowIdx]);
      }
      await send(xtroller, 'harnessAddCompMarkets', [[cLOW._address]]);
      await send(xtroller, 'harnessRefreshCompSpeeds');

      await send(xtroller, 'harnessFastForward', [10]);

      const tx = await send(xtroller, 'claimComp', [claimAccts, [cLOW._address], true, false]);
      for(let acct of claimAccts) {
        expect(await call(xtroller, 'compBorrowerIndex', [cLOW._address, acct])).toEqualNumber(etherDouble(2.25));
        expect(await call(xtroller, 'compSupplierIndex', [cLOW._address, acct])).toEqualNumber(0);
      }
    });

    it('should revert when a market is not listed', async () => {
      const cNOT = await makextoken({xtroller});
      await expect(
        send(xtroller, 'claimComp', [[a1, a2], [cNOT._address], true, true])
      ).rejects.toRevert('revert market must be listed');
    });
  });

  describe('harnessRefreshCompSpeeds', () => {
    it('should start out 0', async () => {
      await send(xtroller, 'harnessRefreshCompSpeeds');
      const supplySpeed = await call(xtroller, 'compSupplySpeeds', [cLOW._address]);
      const borrowSpeed = await call(xtroller, 'compBorrowSpeeds', [cLOW._address]);
      expect(supplySpeed).toEqualNumber(0);
      expect(borrowSpeed).toEqualNumber(0);
    });

    it('should get correct speeds with borrows', async () => {
      await pretendBorrow(cLOW, a1, 1, 1, 100);
      await send(xtroller, 'harnessAddCompMarkets', [[cLOW._address]]);
      const tx = await send(xtroller, 'harnessRefreshCompSpeeds');
      const supplySpeed = await call(xtroller, 'compSupplySpeeds', [cLOW._address]);
      const borrowSpeed = await call(xtroller, 'compBorrowSpeeds', [cLOW._address]);
      expect(supplySpeed).toEqualNumber(compRate);
      expect(borrowSpeed).toEqualNumber(compRate);
      expect(tx).toHaveLog(['CompBorrowSpeedUpdated', 0], {
        xtoken: cLOW._address,
        newSpeed: borrowSpeed
      });
      expect(tx).toHaveLog(['CompSupplySpeedUpdated', 0], {
        xtoken: cLOW._address,
        newSpeed: supplySpeed
      });
    });

    it('should get correct speeds for 2 assets', async () => {
      await pretendBorrow(cLOW, a1, 1, 1, 100);
      await pretendBorrow(cZRX, a1, 1, 1, 100);
      await send(xtroller, 'harnessAddCompMarkets', [[cLOW._address, cZRX._address]]);
      await send(xtroller, 'harnessRefreshCompSpeeds');
      const supplySpeed1 = await call(xtroller, 'compSupplySpeeds', [cLOW._address]);
      const borrowSpeed1 = await call(xtroller, 'compBorrowSpeeds', [cLOW._address]);
      const supplySpeed2 = await call(xtroller, 'compSupplySpeeds', [cREP._address]);
      const borrowSpeed2 = await call(xtroller, 'compBorrowSpeeds', [cREP._address]);
      const supplySpeed3 = await call(xtroller, 'compSupplySpeeds', [cZRX._address]);
      const borrowSpeed3 = await call(xtroller, 'compBorrowSpeeds', [cZRX._address]);
      expect(supplySpeed1).toEqualNumber(compRate.dividedBy(4));
      expect(borrowSpeed1).toEqualNumber(compRate.dividedBy(4));
      expect(supplySpeed2).toEqualNumber(0);
      expect(borrowSpeed2).toEqualNumber(0);
      expect(supplySpeed3).toEqualNumber(compRate.dividedBy(4).multipliedBy(3));
      expect(borrowSpeed3).toEqualNumber(compRate.dividedBy(4).multipliedBy(3));
    });
  });

  describe('harnessSetCompSpeeds', () => {
    it('should correctly set differing led supply and borrow speeds', async () => {
      const desiredCompSupplySpeed = 3;
      const desiredCompBorrowSpeed = 20;
      await send(xtroller, 'harnessAddCompMarkets', [[cLOW._address]]);
      const tx = await send(xtroller, '_setCompSpeeds', [[cLOW._address], [desiredCompSupplySpeed], [desiredCompBorrowSpeed]]);
      expect(tx).toHaveLog(['CompBorrowSpeedUpdated', 0], {
        xtoken: cLOW._address,
        newSpeed: desiredCompBorrowSpeed
      });
      expect(tx).toHaveLog(['CompSupplySpeedUpdated', 0], {
        xtoken: cLOW._address,
        newSpeed: desiredCompSupplySpeed
      });
      const currentCompSupplySpeed = await call(xtroller, 'compSupplySpeeds', [cLOW._address]);
      const currentCompBorrowSpeed = await call(xtroller, 'compBorrowSpeeds', [cLOW._address]);
      expect(currentCompSupplySpeed).toEqualNumber(desiredCompSupplySpeed);
      expect(currentCompBorrowSpeed).toEqualNumber(desiredCompBorrowSpeed);
    });

    it('should correctly get differing led supply and borrow speeds for 4 assets', async () => {
      const cBAT = await makextoken({ xtroller, supportMarket: true });
      const cDAI = await makextoken({ xtroller, supportMarket: true });

      const borrowSpeed1 = 5;
      const supplySpeed1 = 10;

      const borrowSpeed2 = 0;
      const supplySpeed2 = 100;

      const borrowSpeed3 = 0;
      const supplySpeed3 = 0;

      const borrowSpeed4 = 13;
      const supplySpeed4 = 0;

      await send(xtroller, 'harnessAddCompMarkets', [[cREP._address, cZRX._address, cBAT._address, cDAI._address]]);
      await send(xtroller, '_setCompSpeeds', [[cREP._address, cZRX._address, cBAT._address, cDAI._address], [supplySpeed1, supplySpeed2, supplySpeed3, supplySpeed4], [borrowSpeed1, borrowSpeed2, borrowSpeed3, borrowSpeed4]]);

      const currentSupplySpeed1 = await call(xtroller, 'compSupplySpeeds', [cREP._address]);
      const currentBorrowSpeed1 = await call(xtroller, 'compBorrowSpeeds', [cREP._address]);
      const currentSupplySpeed2 = await call(xtroller, 'compSupplySpeeds', [cZRX._address]);
      const currentBorrowSpeed2 = await call(xtroller, 'compBorrowSpeeds', [cZRX._address]);
      const currentSupplySpeed3 = await call(xtroller, 'compSupplySpeeds', [cBAT._address]);
      const currentBorrowSpeed3 = await call(xtroller, 'compBorrowSpeeds', [cBAT._address]);
      const currentSupplySpeed4 = await call(xtroller, 'compSupplySpeeds', [cDAI._address]);
      const currentBorrowSpeed4 = await call(xtroller, 'compBorrowSpeeds', [cDAI._address]);

      expect(currentSupplySpeed1).toEqualNumber(supplySpeed1);
      expect(currentBorrowSpeed1).toEqualNumber(borrowSpeed1);
      expect(currentSupplySpeed2).toEqualNumber(supplySpeed2);
      expect(currentBorrowSpeed2).toEqualNumber(borrowSpeed2);
      expect(currentSupplySpeed3).toEqualNumber(supplySpeed3);
      expect(currentBorrowSpeed3).toEqualNumber(borrowSpeed3);
      expect(currentSupplySpeed4).toEqualNumber(supplySpeed4);
      expect(currentBorrowSpeed4).toEqualNumber(borrowSpeed4);
    });

    const checkAccrualsBorrowAndSupply = async (compSupplySpeed, compBorrowSpeed) => {
      const mintAmount = etherUnsigned(1000e18), borrowAmount = etherUnsigned(1e18), borrowCollateralAmount = etherUnsigned(1000e18), compRemaining = compRate.multipliedBy(100), deltaBlocks = 10;

      // Transfer led to the xtroller
      await send(xtroller.led, 'transfer', [xtroller._address, compRemaining], {from: root});

      // Setup xtroller
      await send(xtroller, 'harnessAddCompMarkets', [[cLOW._address, cUSD._address]]);

      // Set led speeds to 0 while we setup
      await send(xtroller, '_setCompSpeeds', [[cLOW._address, cUSD._address], [0, 0], [0, 0]]);

      // a2 - supply
      await quickMint(cLOW, a2, mintAmount); // a2 is the supplier

      // a1 - borrow (with supplied collateral)
      await quickMint(cUSD, a1, borrowCollateralAmount);
      await enterMarkets([cUSD], a1);
      await quickBorrow(cLOW, a1, borrowAmount); // a1 is the borrower

      // Initialize led speeds
      await send(xtroller, '_setCompSpeeds', [[cLOW._address], [compSupplySpeed], [compBorrowSpeed]]);

      // Get initial led balances
      const a1TotalCompPre = await totalCompAccrued(xtroller, a1);
      const a2TotalCompPre = await totalCompAccrued(xtroller, a2);

      // Start off with no led accrued and no led balance
      expect(a1TotalCompPre).toEqualNumber(0);
      expect(a2TotalCompPre).toEqualNumber(0);

      // Fast forward blocks
      await fastForward(xtroller, deltaBlocks);

      // Accrue led
      await send(xtroller, 'claimComp', [[a1, a2], [cLOW._address], true, true]);

      // Get accrued led balances
      const a1TotalCompPost = await totalCompAccrued(xtroller, a1);
      const a2TotalCompPost = await totalCompAccrued(xtroller, a2);

      // check accrual for borrow
      expect(a1TotalCompPost).toEqualNumber(Number(compBorrowSpeed) > 0 ? compBorrowSpeed.multipliedBy(deltaBlocks).minus(1) : 0);

      // check accrual for supply
      expect(a2TotalCompPost).toEqualNumber(Number(compSupplySpeed) > 0 ? compSupplySpeed.multipliedBy(deltaBlocks) : 0);
    };

    it('should accrue led correctly with only supply-side rewards', async () => {
      await checkAccrualsBorrowAndSupply(/* supply speed */ etherExp(0.5), /* borrow speed */ 0);
    });

    it('should accrue led correctly with only borrow-side rewards', async () => {
      await checkAccrualsBorrowAndSupply(/* supply speed */ 0, /* borrow speed */ etherExp(0.5));
    });
  });

  describe('harnessAddCompMarkets', () => {
    it('should correctly add a led market if called by admin', async () => {
      const cBAT = await makextoken({xtroller, supportMarket: true});
      const tx1 = await send(xtroller, 'harnessAddCompMarkets', [[cLOW._address, cREP._address, cZRX._address]]);
      const tx2 = await send(xtroller, 'harnessAddCompMarkets', [[cBAT._address]]);
      const markets = await call(xtroller, 'getCompMarkets');
      expect(markets).toEqual([cLOW, cREP, cZRX, cBAT].map((c) => c._address));
      expect(tx2).toHaveLog('CompBorrowSpeedUpdated', {
        xtoken: cBAT._address,
        newSpeed: 1
      });
      expect(tx2).toHaveLog('CompSupplySpeedUpdated', {
        xtoken: cBAT._address,
        newSpeed: 1
      });
    });

    it('should not write over a markets existing state', async () => {
      const mkt = cLOW._address;
      const bn0 = 10, bn1 = 20;
      const idx = etherUnsigned(1.5e36);

      await send(xtroller, "harnessAddCompMarkets", [[mkt]]);
      await send(xtroller, "setCompSupplyState", [mkt, idx, bn0]);
      await send(xtroller, "setCompBorrowState", [mkt, idx, bn0]);
      await send(xtroller, "setBlockNumber", [bn1]);
      await send(xtroller, "_setCompSpeeds", [[mkt], [0], [0]]);
      await send(xtroller, "harnessAddCompMarkets", [[mkt]]);

      const supplyState = await call(xtroller, 'compSupplyState', [mkt]);
      expect(supplyState.block).toEqual(bn1.toString());
      expect(supplyState.index).toEqual(idx.toFixed());

      const borrowState = await call(xtroller, 'compBorrowState', [mkt]);
      expect(borrowState.block).toEqual(bn1.toString());
      expect(borrowState.index).toEqual(idx.toFixed());
    });
  });


  describe('updateContributorRewards', () => {
    it('should not fail when contributor rewards called on non-contributor', async () => {
      const tx1 = await send(xtroller, 'updateContributorRewards', [a1]);
    });

    it('should accrue led to contributors', async () => {
      const tx1 = await send(xtroller, '_setContributorCompSpeed', [a1, 2000]);
      await fastForward(xtroller, 50);

      const a1Accrued = await compAccrued(xtroller, a1);
      expect(a1Accrued).toEqualNumber(0);

      const tx2 = await send(xtroller, 'updateContributorRewards', [a1], {from: a1});
      const a1Accrued2 = await compAccrued(xtroller, a1);
      expect(a1Accrued2).toEqualNumber(50 * 2000);
    });

    it('should accrue led with late set', async () => {
      await fastForward(xtroller, 1000);
      const tx1 = await send(xtroller, '_setContributorCompSpeed', [a1, 2000]);
      await fastForward(xtroller, 50);

      const tx2 = await send(xtroller, 'updateContributorRewards', [a1], {from: a1});
      const a1Accrued2 = await compAccrued(xtroller, a1);
      expect(a1Accrued2).toEqualNumber(50 * 2000);
    });
  });

  describe('_setContributorCompSpeed', () => {
    it('should revert if not called by admin', async () => {
      await expect(
        send(xtroller, '_setContributorCompSpeed', [a1, 1000], {from: a1})
      ).rejects.toRevert('revert only admin can set led speed');
    });

    it('should start led stream if called by admin', async () => {
      const tx = await send(xtroller, '_setContributorCompSpeed', [a1, 1000]);
      expect(tx).toHaveLog('ContributorCompSpeedUpdated', {
        contributor: a1,
        newSpeed: 1000
      });
    });

    it('should reset led stream if set to 0', async () => {
      const tx1 = await send(xtroller, '_setContributorCompSpeed', [a1, 2000]);
      await fastForward(xtroller, 50);

      const tx2 = await send(xtroller, '_setContributorCompSpeed', [a1, 0]);
      await fastForward(xtroller, 50);

      const tx3 = await send(xtroller, 'updateContributorRewards', [a1], {from: a1});
      const a1Accrued = await compAccrued(xtroller, a1);
      expect(a1Accrued).toEqualNumber(50 * 2000);
    });
  });
});
