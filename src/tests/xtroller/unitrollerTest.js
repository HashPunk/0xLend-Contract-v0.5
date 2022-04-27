const {
  address,
  etherMantissa
} = require('../Utils/Ethereum');

const {
  makextroller,
  makePriceOracle
} = require('../Utils/0xlend');

describe('xUnitroller', () => {
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

  let setPending = (implementation, from) => {
    return send(xUnitroller, '_setPendingImplementation', [implementation._address], {from});
  };

  describe("constructor", () => {
    it("sets admin to caller and addresses to 0", async () => {
      expect(await call(xUnitroller, 'admin')).toEqual(root);
      expect(await call(xUnitroller, 'pendingAdmin')).toBeAddressZero();
      expect(await call(xUnitroller, 'pendingxtrollerImplementation')).toBeAddressZero();
      expect(await call(xUnitroller, 'xtrollerImplementation')).toBeAddressZero();
    });
  });

  describe("_setPendingImplementation", () => {
    describe("Check caller is admin", () => {
      let result;
      beforeEach(async () => {
        result = await setPending(brains, accounts[1]);
      });

      it("emits a failure log", async () => {
        expect(result).toHaveTrollFailure('UNAUTHORIZED', 'SET_PENDING_IMPLEMENTATION_OWNER_CHECK');
      });

      it("does not change pending implementation address", async () => {
        expect(await call(xUnitroller, 'pendingxtrollerImplementation')).toBeAddressZero()
      });
    });

    describe("succeeding", () => {
      it("stores pendingxtrollerImplementation with value newPendingImplementation", async () => {
        await setPending(brains, root);
        expect(await call(xUnitroller, 'pendingxtrollerImplementation')).toEqual(brains._address);
      });

      it("emits NewPendingImplementation event", async () => {
        expect(await send(xUnitroller, '_setPendingImplementation', [brains._address])).toHaveLog('NewPendingImplementation', {
            oldPendingImplementation: address(0),
            newPendingImplementation: brains._address
          });
      });
    });
  });

  describe("_acceptImplementation", () => {
    describe("Check caller is pendingxtrollerImplementation  and pendingxtrollerImplementation ≠ address(0) ", () => {
      let result;
      beforeEach(async () => {
        await setPending(xUnitroller, root);
        result = await send(xUnitroller, '_acceptImplementation');
      });

      it("emits a failure log", async () => {
        expect(result).toHaveTrollFailure('UNAUTHORIZED', 'ACCEPT_PENDING_IMPLEMENTATION_ADDRESS_CHECK');
      });

      it("does not change current implementation address", async () => {
        expect(await call(xUnitroller, 'xtrollerImplementation')).not.toEqual(xUnitroller._address);
      });
    });

    it.skip("rejects if pending impl is address(0)", async () => {
      // XXX TODO?
    });

    describe("the brains must accept the responsibility of implementation", () => {
      let result;
      beforeEach(async () => {
        await setPending(brains, root);
        result = await send(brains, '_become', [xUnitroller._address, oracle._address, etherMantissa(.051), 10, false]);
        expect(result).toSucceed();
      });

      it("Store xtrollerImplementation with value pendingxtrollerImplementation", async () => {
        expect(await call(xUnitroller, 'xtrollerImplementation')).toEqual(brains._address);
      });

      it("Unset pendingxtrollerImplementation", async () => {
        expect(await call(xUnitroller, 'pendingxtrollerImplementation')).toBeAddressZero();
      });

      it.skip("Emit NewImplementation(oldImplementation, newImplementation)", async () => {
        // TODO:
        // Does our log decoder expect it to come from the same contract?
        // assert.toHaveLog(
        //   result,
        //   "NewImplementation",
        //   {
        //     newImplementation: brains._address,
        //     oldImplementation: "0x0000000000000000000000000000000000000000"
        //   });
      });

      it.skip("Emit NewPendingImplementation(oldPendingImplementation, 0)", async () => {
        // TODO:
        // Does our log decoder expect it to come from the same contract?
        // Having difficulty decoding these events
        // assert.toHaveLog(
        //   result,
        //   "NewPendingImplementation",
        //   {
        //     oldPendingImplementation: brains._address,
        //     newPendingImplementation: "0x0000000000000000000000000000000000000000"
        //   });
      });
    });

    describe("fallback delegates to brains", () => {
      let troll;
      beforeEach(async () => {
        troll = await deploy('EchoTypesxtroller');
        xUnitroller = await deploy('xUnitroller');
        await setPending(troll, root);
        await send(troll, 'becomeBrains', [xUnitroller._address]);
        troll.options.address = xUnitroller._address;
      });

      it("forwards reverts", async () => {
        await expect(call(troll, 'reverty')).rejects.toRevert("revert gotcha sucka");
      });

      it("gets addresses", async () => {
        expect(await call(troll, 'addresses', [troll._address])).toEqual(troll._address);
      });

      it("gets strings", async () => {
        expect(await call(troll, 'stringy', ["yeet"])).toEqual("yeet");
      });

      it("gets bools", async () => {
        expect(await call(troll, 'booly', [true])).toEqual(true);
      });

      it("gets list of ints", async () => {
        expect(await call(troll, 'listOInts', [[1,2,3]])).toEqual(["1", "2", "3"]);
      });
    });
  });
});
