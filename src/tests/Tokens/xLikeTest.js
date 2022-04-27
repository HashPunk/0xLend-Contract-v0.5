const {
  makextoken,
} = require('../Utils/0xlend');


describe('CCompLikeDelegate', function () {
  describe("_delegateCompLikeTo", () => {
    it("does not delegate if not the admin", async () => {
      const [root, a1] = saddle.accounts;
      const xtoken = await makextoken({kind: 'ccomp'});
      await expect(send(xtoken, '_delegateCompLikeTo', [a1], {from: a1})).rejects.toRevert('revert only the admin may set the led-like delegate');
    });

    it("delegates successfully if the admin", async () => {
      const [root, a1] = saddle.accounts, amount = 1;
      const cCOMP = await makextoken({kind: 'ccomp'}), led = cCOMP.underlying;
      const tx1 = await send(cCOMP, '_delegateCompLikeTo', [a1]);
      const tx2 = await send(led, 'transfer', [cCOMP._address, amount]);
      await expect(await call(led, 'getCurrentVotes', [a1])).toEqualNumber(amount);
    });
  });
});