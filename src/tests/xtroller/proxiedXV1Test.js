const { address, etherMantissa } = require('../Utils/Ethereum');

const { makextroller, makextoken, makePriceOracle } = require('../Utils/0xlend');

describe('xtrollerV1', function() {
  let root, accounts;
  let xUnitroller;
  let brains;
  let oracle;

  beforeEach(async () => {
    [root, ...accounts] = saddle.accounts;
    oracle = await makePriceOracle();
    brains = await deploy('xtrollerG1');
    xUnitroller = await deploy('xUnitroller');
  });

  let initializeBrains = async (priceOracle, closeFactor, maxAssets) => {
    await send(xUnitroller, '_setPendingImplementation', [brains._address]);
    await send(brains, '_become', [xUnitroller._address, priceOracle._address, closeFactor, maxAssets, false]);
    return await saddle.getContractAt('xtrollerG1', xUnitroller._address);
  };

  let reinitializeBrains = async () => {
    await send(xUnitroller, '_setPendingImplementation', [brains._address]);
    await send(brains, '_become', [xUnitroller._address, address(0), 0, 0, true]);
    return await saddle.getContractAt('xtrollerG1', xUnitroller._address);
  };

  describe('delegating to xtroller v1', () => {
    const closeFactor = etherMantissa(0.051);
    const maxAssets = 10;
    let xUnitrollerAsxtroller, xtoken;

    beforeEach(async () => {
      xUnitrollerAsxtroller = await initializeBrains(oracle, etherMantissa(0.06), 30);
      xtoken = await makextoken({ xtroller: xUnitrollerAsxtroller });
    });

    describe('becoming brains sets initial state', () => {
      it('reverts if this is not the pending implementation', async () => {
        await expect(
          send(brains, '_become', [xUnitroller._address, oracle._address, 0, 10, false])
        ).rejects.toRevert('revert change not authorized');
      });

      it('on success it sets admin to caller of constructor', async () => {
        expect(await call(xUnitrollerAsxtroller, 'admin')).toEqual(root);
        expect(await call(xUnitrollerAsxtroller, 'pendingAdmin')).toBeAddressZero();
      });

      it('on success it sets closeFactor and maxAssets as specified', async () => {
        const xtroller = await initializeBrains(oracle, closeFactor, maxAssets);
        expect(await call(xtroller, 'closeFactorMantissa')).toEqualNumber(closeFactor);
        expect(await call(xtroller, 'maxAssets')).toEqualNumber(maxAssets);
      });

      it("on reinitialization success, it doesn't set closeFactor or maxAssets", async () => {
        let xtroller = await initializeBrains(oracle, closeFactor, maxAssets);
        expect(await call(xUnitroller, 'xtrollerImplementation')).toEqual(brains._address);
        expect(await call(xtroller, 'closeFactorMantissa')).toEqualNumber(closeFactor);
        expect(await call(xtroller, 'maxAssets')).toEqualNumber(maxAssets);

        // Create new brains
        brains = await deploy('xtrollerG1');
        xtroller = await reinitializeBrains();

        expect(await call(xUnitroller, 'xtrollerImplementation')).toEqual(brains._address);
        expect(await call(xtroller, 'closeFactorMantissa')).toEqualNumber(closeFactor);
        expect(await call(xtroller, 'maxAssets')).toEqualNumber(maxAssets);
      });

      it('reverts on invalid closeFactor', async () => {
        await send(xUnitroller, '_setPendingImplementation', [brains._address]);
        await expect(
          send(brains, '_become', [xUnitroller._address, oracle._address, 0, maxAssets, false])
        ).rejects.toRevert('revert set close factor error');
      });

      it('allows 0 maxAssets', async () => {
        const xtroller = await initializeBrains(oracle, closeFactor, 0);
        expect(await call(xtroller, 'maxAssets')).toEqualNumber(0);
      });

      it('allows 5000 maxAssets', async () => {
        // 5000 is an arbitrary number larger than what we expect to ever actually use
        const xtroller = await initializeBrains(oracle, closeFactor, 5000);
        expect(await call(xtroller, 'maxAssets')).toEqualNumber(5000);
      });
    });

    describe('_setCollateralFactor', () => {
      const half = etherMantissa(0.5),
        one = etherMantissa(1);

      it('fails if not called by admin', async () => {
        expect(
          await send(xUnitrollerAsxtroller, '_setCollateralFactor', [xtoken._address, half], {
            from: accounts[1]
          })
        ).toHaveTrollFailure('UNAUTHORIZED', 'SET_COLLATERAL_FACTOR_OWNER_CHECK');
      });

      it('fails if asset is not listed', async () => {
        expect(
          await send(xUnitrollerAsxtroller, '_setCollateralFactor', [xtoken._address, half])
        ).toHaveTrollFailure('MARKET_NOT_LISTED', 'SET_COLLATERAL_FACTOR_NO_EXISTS');
      });

      it('fails if factor is too high', async () => {
        const xtoken = await makextoken({ supportMarket: true, xtroller: xUnitrollerAsxtroller });
        expect(
          await send(xUnitrollerAsxtroller, '_setCollateralFactor', [xtoken._address, one])
        ).toHaveTrollFailure('INVALID_COLLATERAL_FACTOR', 'SET_COLLATERAL_FACTOR_VALIDATION');
      });

      it('fails if factor is set without an underlying price', async () => {
        const xtoken = await makextoken({ supportMarket: true, xtroller: xUnitrollerAsxtroller });
        expect(
          await send(xUnitrollerAsxtroller, '_setCollateralFactor', [xtoken._address, half])
        ).toHaveTrollFailure('PRICE_ERROR', 'SET_COLLATERAL_FACTOR_WITHOUT_PRICE');
      });

      it('succeeds and sets market', async () => {
        const xtoken = await makextoken({ supportMarket: true, xtroller: xUnitrollerAsxtroller });
        await send(oracle, 'setUnderlyingPrice', [xtoken._address, 1]);
        expect(
          await send(xUnitrollerAsxtroller, '_setCollateralFactor', [xtoken._address, half])
        ).toHaveLog('NewCollateralFactor', {
          xtoken: xtoken._address,
          oldCollateralFactorMantissa: '0',
          newCollateralFactorMantissa: half.toString()
        });
      });
    });

    describe('_supportMarket', () => {
      it('fails if not called by admin', async () => {
        expect(
          await send(xUnitrollerAsxtroller, '_supportMarket', [xtoken._address], { from: accounts[1] })
        ).toHaveTrollFailure('UNAUTHORIZED', 'SUPPORT_MARKET_OWNER_CHECK');
      });

      it('fails if asset is not a xtoken', async () => {
        const notAxtoken = await makePriceOracle();
        await expect(send(xUnitrollerAsxtroller, '_supportMarket', [notAxtoken._address])).rejects.toRevert();
      });

      it('succeeds and sets market', async () => {
        const result = await send(xUnitrollerAsxtroller, '_supportMarket', [xtoken._address]);
        expect(result).toHaveLog('MarketListed', { xtoken: xtoken._address });
      });

      it('cannot list a market a second time', async () => {
        const result1 = await send(xUnitrollerAsxtroller, '_supportMarket', [xtoken._address]);
        const result2 = await send(xUnitrollerAsxtroller, '_supportMarket', [xtoken._address]);
        expect(result1).toHaveLog('MarketListed', { xtoken: xtoken._address });
        expect(result2).toHaveTrollFailure('MARKET_ALREADY_LISTED', 'SUPPORT_MARKET_EXISTS');
      });

      it('can list two different markets', async () => {
        const xtoken1 = await makextoken({ xtroller: xUnitroller });
        const xtoken2 = await makextoken({ xtroller: xUnitroller });
        const result1 = await send(xUnitrollerAsxtroller, '_supportMarket', [xtoken1._address]);
        const result2 = await send(xUnitrollerAsxtroller, '_supportMarket', [xtoken2._address]);
        expect(result1).toHaveLog('MarketListed', { xtoken: xtoken1._address });
        expect(result2).toHaveLog('MarketListed', { xtoken: xtoken2._address });
      });
    });
  });
});
