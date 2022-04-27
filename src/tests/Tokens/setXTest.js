const {
  makextroller,
  makextoken
} = require('../Utils/0xlend');

describe('xtoken', function () {
  let root, accounts;
  let xtoken, oldxtroller, newxtroller;
  beforeEach(async () => {
    [root, ...accounts] = saddle.accounts;
    xtoken = await makextoken();
    oldxtroller = xtoken.xtroller;
    newxtroller = await makextroller();
    expect(newxtroller._address).not.toEqual(oldxtroller._address);
  });

  describe('_setxtroller', () => {
    it("should fail if called by non-admin", async () => {
      expect(
        await send(xtoken, '_setxtroller', [newxtroller._address], { from: accounts[0] })
      ).toHaveTokenFailure('UNAUTHORIZED', 'SET_xtroller_OWNER_CHECK');
      expect(await call(xtoken, 'xtroller')).toEqual(oldxtroller._address);
    });

    it("reverts if passed a contract that doesn't implement isxtroller", async () => {
      await expect(send(xtoken, '_setxtroller', [xtoken.underlying._address])).rejects.toRevert("revert");
      expect(await call(xtoken, 'xtroller')).toEqual(oldxtroller._address);
    });

    it("reverts if passed a contract that implements isxtroller as false", async () => {
      // extremely unlikely to occur, of course, but let's be exhaustive
      const badxtroller = await makextroller({ kind: 'false-marker' });
      await expect(send(xtoken, '_setxtroller', [badxtroller._address])).rejects.toRevert("revert marker method returned false");
      expect(await call(xtoken, 'xtroller')).toEqual(oldxtroller._address);
    });

    it("updates xtroller and emits log on success", async () => {
      const result = await send(xtoken, '_setxtroller', [newxtroller._address]);
      expect(result).toSucceed();
      expect(result).toHaveLog('Newxtroller', {
        oldxtroller: oldxtroller._address,
        newxtroller: newxtroller._address
      });
      expect(await call(xtoken, 'xtroller')).toEqual(newxtroller._address);
    });
  });
});
