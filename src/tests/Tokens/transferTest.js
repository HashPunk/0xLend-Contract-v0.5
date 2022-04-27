const {makextoken} = require('../Utils/0xlend');

describe('xtoken', function () {
  let root, accounts;
  beforeEach(async () => {
    [root, ...accounts] = saddle.accounts;
  });

  describe('transfer', () => {
    it("cannot transfer from a zero balance", async () => {
      const xtoken = await makextoken({supportMarket: true});
      expect(await call(xtoken, 'balanceOf', [root])).toEqualNumber(0);
      expect(await send(xtoken, 'transfer', [accounts[0], 100])).toHaveTokenFailure('MATH_ERROR', 'TRANSFER_NOT_ENOUGH');
    });

    it("transfers 50 tokens", async () => {
      const xtoken = await makextoken({supportMarket: true});
      await send(xtoken, 'harnessSetBalance', [root, 100]);
      expect(await call(xtoken, 'balanceOf', [root])).toEqualNumber(100);
      await send(xtoken, 'transfer', [accounts[0], 50]);
      expect(await call(xtoken, 'balanceOf', [root])).toEqualNumber(50);
      expect(await call(xtoken, 'balanceOf', [accounts[0]])).toEqualNumber(50);
    });

    it("doesn't transfer when src == dst", async () => {
      const xtoken = await makextoken({supportMarket: true});
      await send(xtoken, 'harnessSetBalance', [root, 100]);
      expect(await call(xtoken, 'balanceOf', [root])).toEqualNumber(100);
      expect(await send(xtoken, 'transfer', [root, 50])).toHaveTokenFailure('BAD_INPUT', 'TRANSFER_NOT_ALLOWED');
    });

    it("rejects transfer when not allowed and reverts if not verified", async () => {
      const xtoken = await makextoken({xtrollerOpts: {kind: 'bool'}});
      await send(xtoken, 'harnessSetBalance', [root, 100]);
      expect(await call(xtoken, 'balanceOf', [root])).toEqualNumber(100);

      await send(xtoken.xtroller, 'setTransferAllowed', [false])
      expect(await send(xtoken, 'transfer', [root, 50])).toHaveTrollReject('TRANSFER_xtroller_REJECTION');

      await send(xtoken.xtroller, 'setTransferAllowed', [true])
      await send(xtoken.xtroller, 'setTransferVerify', [false])
      // no longer support verifyTransfer on xtoken end
      // await expect(send(xtoken, 'transfer', [accounts[0], 50])).rejects.toRevert("revert transferVerify rejected transfer");
    });
  });
});