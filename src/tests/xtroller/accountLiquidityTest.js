const {
  makextroller,
  makextoken,
  enterMarkets,
  quickMint
} = require('../Utils/0xlend');

describe('xtroller', () => {
  let root, accounts;

  beforeEach(async () => {
    [root, ...accounts] = saddle.accounts;
  });

  describe('liquidity', () => {
    it("fails if a price has not been set", async () => {
      const xtoken = await makextoken({supportMarket: true});
      await enterMarkets([xtoken], accounts[1]);
      let result = await call(xtoken.xtroller, 'getAccountLiquidity', [accounts[1]]);
      expect(result).toHaveTrollError('PRICE_ERROR');
    });

    it("allows a borrow up to collateralFactor, but not more", async () => {
      const collateralFactor = 0.5, underlyingPrice = 1, user = accounts[1], amount = 1e6;
      const xtoken = await makextoken({supportMarket: true, collateralFactor, underlyingPrice});

      let error, liquidity, shortfall;

      // not in market yet, hypothetical borrow should have no effect
      ({1: liquidity, 2: shortfall} = await call(xtoken.xtroller, 'getHypotheticalAccountLiquidity', [user, xtoken._address, 0, amount]));
      expect(liquidity).toEqualNumber(0);
      expect(shortfall).toEqualNumber(0);

      await enterMarkets([xtoken], user);
      await quickMint(xtoken, user, amount);

      // total account liquidity after supplying `amount`
      ({1: liquidity, 2: shortfall} = await call(xtoken.xtroller, 'getAccountLiquidity', [user]));
      expect(liquidity).toEqualNumber(amount * collateralFactor);
      expect(shortfall).toEqualNumber(0);

      // hypothetically borrow `amount`, should shortfall over collateralFactor
      ({1: liquidity, 2: shortfall} = await call(xtoken.xtroller, 'getHypotheticalAccountLiquidity', [user, xtoken._address, 0, amount]));
      expect(liquidity).toEqualNumber(0);
      expect(shortfall).toEqualNumber(amount * (1 - collateralFactor));

      // hypothetically redeem `amount`, should be back to even
      ({1: liquidity, 2: shortfall} = await call(xtoken.xtroller, 'getHypotheticalAccountLiquidity', [user, xtoken._address, amount, 0]));
      expect(liquidity).toEqualNumber(0);
      expect(shortfall).toEqualNumber(0);
    }, 20000);

    it("allows entering 3 markets, supplying to 2 and borrowing up to collateralFactor in the 3rd", async () => {
      const amount1 = 1e6, amount2 = 1e3, user = accounts[1];
      const cf1 = 0.5, cf2 = 0.666, cf3 = 0, up1 = 3, up2 = 2.718, up3 = 1;
      const c1 = amount1 * cf1 * up1, c2 = amount2 * cf2 * up2, collateral = Math.floor(c1 + c2);
      const xtoken1 = await makextoken({supportMarket: true, collateralFactor: cf1, underlyingPrice: up1});
      const xtoken2 = await makextoken({supportMarket: true, xtroller: xtoken1.xtroller, collateralFactor: cf2, underlyingPrice: up2});
      const xtoken3 = await makextoken({supportMarket: true, xtroller: xtoken1.xtroller, collateralFactor: cf3, underlyingPrice: up3});

      await enterMarkets([xtoken1, xtoken2, xtoken3], user);
      await quickMint(xtoken1, user, amount1);
      await quickMint(xtoken2, user, amount2);

      let error, liquidity, shortfall;

      ({0: error, 1: liquidity, 2: shortfall} = await call(xtoken3.xtroller, 'getAccountLiquidity', [user]));
      expect(error).toEqualNumber(0);
      expect(liquidity).toEqualNumber(collateral);
      expect(shortfall).toEqualNumber(0);

      ({1: liquidity, 2: shortfall} = await call(xtoken3.xtroller, 'getHypotheticalAccountLiquidity', [user, xtoken3._address, Math.floor(c2), 0]));
      expect(liquidity).toEqualNumber(collateral);
      expect(shortfall).toEqualNumber(0);

      ({1: liquidity, 2: shortfall} = await call(xtoken3.xtroller, 'getHypotheticalAccountLiquidity', [user, xtoken3._address, 0, Math.floor(c2)]));
      expect(liquidity).toEqualNumber(c1);
      expect(shortfall).toEqualNumber(0);

      ({1: liquidity, 2: shortfall} = await call(xtoken3.xtroller, 'getHypotheticalAccountLiquidity', [user, xtoken3._address, 0, collateral + c1]));
      expect(liquidity).toEqualNumber(0);
      expect(shortfall).toEqualNumber(c1);

      ({1: liquidity, 2: shortfall} = await call(xtoken1.xtroller, 'getHypotheticalAccountLiquidity', [user, xtoken1._address, amount1, 0]));
      expect(liquidity).toEqualNumber(Math.floor(c2));
      expect(shortfall).toEqualNumber(0);
    });
  });

  describe("getAccountLiquidity", () => {
    it("returns 0 if not 'in' any markets", async () => {
      const xtroller = await makextroller();
      const {0: error, 1: liquidity, 2: shortfall} = await call(xtroller, 'getAccountLiquidity', [accounts[0]]);
      expect(error).toEqualNumber(0);
      expect(liquidity).toEqualNumber(0);
      expect(shortfall).toEqualNumber(0);
    });
  });

  describe("getHypotheticalAccountLiquidity", () => {
    it("returns 0 if not 'in' any markets", async () => {
      const xtoken = await makextoken();
      const {0: error, 1: liquidity, 2: shortfall} = await call(xtoken.xtroller, 'getHypotheticalAccountLiquidity', [accounts[0], xtoken._address, 0, 0]);
      expect(error).toEqualNumber(0);
      expect(liquidity).toEqualNumber(0);
      expect(shortfall).toEqualNumber(0);
    });

    it("returns collateral factor times dollar amount of tokens minted in a single market", async () => {
      const collateralFactor = 0.5, exchangeRate = 1, underlyingPrice = 1;
      const xtoken = await makextoken({supportMarket: true, collateralFactor, exchangeRate, underlyingPrice});
      const from = accounts[0], balance = 1e7, amount = 1e6;
      await enterMarkets([xtoken], from);
      await send(xtoken.underlying, 'harnessSetBalance', [from, balance], {from});
      await send(xtoken.underlying, 'approve', [xtoken._address, balance], {from});
      await send(xtoken, 'mint', [amount], {from});
      const {0: error, 1: liquidity, 2: shortfall} = await call(xtoken.xtroller, 'getHypotheticalAccountLiquidity', [from, xtoken._address, 0, 0]);
      expect(error).toEqualNumber(0);
      expect(liquidity).toEqualNumber(amount * collateralFactor * exchangeRate * underlyingPrice);
      expect(shortfall).toEqualNumber(0);
    });
  });
});
