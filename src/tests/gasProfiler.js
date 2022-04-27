const {
  etherUnsigned,
  etherMantissa,
  etherExp,
} = require('./Utils/Ethereum');

const {
  makextroller,
  makextoken,
  preApprove,
  preSupply,
  quickRedeem,
} = require('./Utils/0xlend');

async function compBalance(xtroller, user) {
  return etherUnsigned(await call(xtroller.led, 'balanceOf', [user]))
}

async function compAccrued(xtroller, user) {
  return etherUnsigned(await call(xtroller, 'compAccrued', [user]));
}

async function fastForwardPatch(patch, xtroller, blocks) {
  if (patch == 'xUnitroller') {
    return await send(xtroller, 'harnessFastForward', [blocks]);
  } else {
    return await send(xtroller, 'fastForward', [blocks]);
  }
}

const fs = require('fs');
const util = require('util');
const diffStringsUnified = require('jest-diff').default;


async function preRedeem(
  xtoken,
  redeemer,
  redeemTokens,
  redeemAmount,
  exchangeRate
) {
  await preSupply(xtoken, redeemer, redeemTokens);
  await send(xtoken.underlying, 'harnessSetBalance', [
    xtoken._address,
    redeemAmount
  ]);
}

const sortOpcodes = (opcodesMap) => {
  return Object.values(opcodesMap)
    .map(elem => [elem.fee, elem.name])
    .sort((a, b) => b[0] - a[0]);
};

const getGasCostFile = name => {
  try {
    const jsonString = fs.readFileSync(name);
    return JSON.parse(jsonString);
  } catch (err) {
    console.log(err);
    return {};
  }
};

const recordGasCost = (totalFee, key, filename, opcodes = {}) => {
  let fileObj = getGasCostFile(filename);
  const newCost = {fee: totalFee, opcodes: opcodes};
  console.log(diffStringsUnified(fileObj[key], newCost));
  fileObj[key] = newCost;
  fs.writeFileSync(filename, JSON.stringify(fileObj, null, ' '), 'utf-8');
};

async function mint(xtoken, minter, mintAmount, exchangeRate) {
  expect(await preApprove(xtoken, minter, mintAmount, {})).toSucceed();
  return send(xtoken, 'mint', [mintAmount], { from: minter });
}

async function claimComp(xtroller, holder) {
  return send(xtroller, 'claimComp', [holder], { from: holder });
}

/// GAS PROFILER: saves a digest of the gas prices of common xtoken operations
/// transiently fails, not sure why

describe('Gas report', () => {
  let root, minter, redeemer, accounts, xtoken;
  const exchangeRate = 50e3;
  const preMintAmount = etherUnsigned(30e4);
  const mintAmount = etherUnsigned(10e4);
  const mintTokens = mintAmount.div(exchangeRate);
  const redeemTokens = etherUnsigned(10e3);
  const redeemAmount = redeemTokens.multipliedBy(exchangeRate);
  const filename = './gasCosts.json';

  describe('xtoken', () => {
    beforeEach(async () => {
      [root, minter, redeemer, ...accounts] = saddle.accounts;
      xtoken = await makextoken({
        xtrollerOpts: { kind: 'bool'}, 
        interestRateModelOpts: { kind: 'white-paper'},
        exchangeRate
      });
    });

    it('first mint', async () => {
      await send(xtoken, 'harnessSetAccrualBlockNumber', [40]);
      await send(xtoken, 'harnessSetBlockNumber', [41]);

      const trxReceipt = await mint(xtoken, minter, mintAmount, exchangeRate);
      recordGasCost(trxReceipt.gasUsed, 'first mint', filename);
    });

    it('second mint', async () => {
      await mint(xtoken, minter, mintAmount, exchangeRate);

      await send(xtoken, 'harnessSetAccrualBlockNumber', [40]);
      await send(xtoken, 'harnessSetBlockNumber', [41]);

      const mint2Receipt = await mint(xtoken, minter, mintAmount, exchangeRate);
      expect(Object.keys(mint2Receipt.events)).toEqual(['AccrueInterest', 'Transfer', 'Mint']);

      console.log(mint2Receipt.gasUsed);
      const opcodeCount = {};

      await saddle.trace(mint2Receipt, {
        execLog: log => {
          if (log.lastLog != undefined) {
            const key = `${log.op} @ ${log.gasCost}`;
            opcodeCount[key] = (opcodeCount[key] || 0) + 1;
          }
        }
      });

      recordGasCost(mint2Receipt.gasUsed, 'second mint', filename, opcodeCount);
    });

    it('second mint, no interest accrued', async () => {
      await mint(xtoken, minter, mintAmount, exchangeRate);

      await send(xtoken, 'harnessSetAccrualBlockNumber', [40]);
      await send(xtoken, 'harnessSetBlockNumber', [40]);

      const mint2Receipt = await mint(xtoken, minter, mintAmount, exchangeRate);
      expect(Object.keys(mint2Receipt.events)).toEqual(['Transfer', 'Mint']);
      recordGasCost(mint2Receipt.gasUsed, 'second mint, no interest accrued', filename);

      // console.log("NO ACCRUED");
      // const opcodeCount = {};
      // await saddle.trace(mint2Receipt, {
      //   execLog: log => {
      //     opcodeCount[log.op] = (opcodeCount[log.op] || 0) + 1;
      //   }
      // });
      // console.log(getOpcodeDigest(opcodeCount));
    });

    it('redeem', async () => {
      await preRedeem(xtoken, redeemer, redeemTokens, redeemAmount, exchangeRate);
      const trxReceipt = await quickRedeem(xtoken, redeemer, redeemTokens);
      recordGasCost(trxReceipt.gasUsed, 'redeem', filename);
    });

    it.skip('print mint opcode list', async () => {
      await preMint(xtoken, minter, mintAmount, mintTokens, exchangeRate);
      const trxReceipt = await quickMint(xtoken, minter, mintAmount);
      const opcodeCount = {};
      await saddle.trace(trxReceipt, {
        execLog: log => {
          opcodeCount[log.op] = (opcodeCount[log.op] || 0) + 1;
        }
      });
      console.log(getOpcodeDigest(opcodeCount));
    });
  });

  describe.each([
    ['xUnitroller-g6'],
    ['xUnitroller']
  ])('led claims %s', (patch) => {
    beforeEach(async () => {
      [root, minter, redeemer, ...accounts] = saddle.accounts;
      xtroller = await makextroller({ kind: patch });
      let interestRateModelOpts = {borrowRate: 0.000001};
      xtoken = await makextoken({xtroller, supportMarket: true, underlyingPrice: 2, interestRateModelOpts});
      if (patch == 'xUnitroller') {
        await send(xtroller, '_setCompSpeeds', [[xtoken._address], [etherExp(0.05)], [etherExp(0.05)]]);
      } else {
        await send(xtroller, '_addCompMarkets', [[xtoken].map(c => c._address)]);
        await send(xtroller, 'setCompSpeed', [xtoken._address, etherExp(0.05)]);
      }
      await send(xtroller.led, 'transfer', [xtroller._address, etherUnsigned(50e18)], {from: root});
    });

    it(`${patch} second mint with led accrued`, async () => {
      await mint(xtoken, minter, mintAmount, exchangeRate);

      await fastForwardPatch(patch, xtroller, 10);

      console.log('led balance before mint', (await compBalance(xtroller, minter)).toString());
      console.log('led accrued before mint', (await compAccrued(xtroller, minter)).toString());
      const mint2Receipt = await mint(xtoken, minter, mintAmount, exchangeRate);
      console.log('led balance after mint', (await compBalance(xtroller, minter)).toString());
      console.log('led accrued after mint', (await compAccrued(xtroller, minter)).toString());
      recordGasCost(mint2Receipt.gasUsed, `${patch} second mint with led accrued`, filename);
    });

    it(`${patch} claim led`, async () => {
      await mint(xtoken, minter, mintAmount, exchangeRate);

      await fastForwardPatch(patch, xtroller, 10);

      console.log('led balance before claim', (await compBalance(xtroller, minter)).toString());
      console.log('led accrued before claim', (await compAccrued(xtroller, minter)).toString());
      const claimReceipt = await claimComp(xtroller, minter);
      console.log('led balance after claim', (await compBalance(xtroller, minter)).toString());
      console.log('led accrued after claim', (await compAccrued(xtroller, minter)).toString());
      recordGasCost(claimReceipt.gasUsed, `${patch} claim led`, filename);
    });
  });
});
