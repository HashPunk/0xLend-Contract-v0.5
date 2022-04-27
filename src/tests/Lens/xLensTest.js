const {
  address,
  encodeParameters,
  etherExp,
} = require('../Utils/Ethereum');
const {
  makextroller,
  makextoken,
} = require('../Utils/0xlend');

function cullTuple(tuple) {
  return Object.keys(tuple).reduce((acc, key) => {
    if (Number.isNaN(Number(key))) {
      return {
        ...acc,
        [key]: tuple[key]
      };
    } else {
      return acc;
    }
  }, {});
}

describe('0xlendLens', () => {
  let 0xlendLens;
  let acct;

  beforeEach(async () => {
    0xlendLens = await deploy('0xlendLens');
    acct = accounts[0];
  });

  describe('xtokenMetadata', () => {
    it('is correct for a xkcc20', async () => {
      let xkcc20 = await makextoken();
      expect(
        cullTuple(await call(0xlendLens, 'xtokenMetadata', [xkcc20._address]))
      ).toEqual(
        {
          xtoken: xkcc20._address,
          exchangeRateCurrent: "1000000000000000000",
          supplyRatePerBlock: "0",
          borrowRatePerBlock: "0",
          reserveFactorMantissa: "0",
          totalBorrows: "0",
          totalReserves: "0",
          totalSupply: "0",
          totalCash: "0",
          isListed:false,
          collateralFactorMantissa: "0",
          underlyingAssetAddress: await call(xkcc20, 'underlying', []),
          xtokenDecimals: "8",
          underlyingDecimals: "18",
          compSupplySpeed: "0",
          compBorrowSpeed: "0",
          borrowCap: "0",
        }
      );
    });

    it('is correct for cEth', async () => {
      let cEth = await makextoken({kind: 'xkcc'});
      expect(
        cullTuple(await call(0xlendLens, 'xtokenMetadata', [cEth._address]))
      ).toEqual({
        borrowRatePerBlock: "0",
        xtoken: cEth._address,
        xtokenDecimals: "8",
        collateralFactorMantissa: "0",
        exchangeRateCurrent: "1000000000000000000",
        isListed: false,
        reserveFactorMantissa: "0",
        supplyRatePerBlock: "0",
        totalBorrows: "0",
        totalCash: "0",
        totalReserves: "0",
        totalSupply: "0",
        underlyingAssetAddress: "0x0000000000000000000000000000000000000000",
        underlyingDecimals: "18",
        compSupplySpeed: "0",
        compBorrowSpeed: "0",
        borrowCap: "0",
      });
    });
    it('is correct for xkcc20 with set led speeds', async () => {
      let xtroller = await makextroller();
      let xkcc20 = await makextoken({xtroller, supportMarket: true});
      await send(xtroller, '_setCompSpeeds', [[xkcc20._address], [etherExp(0.25)], [etherExp(0.75)]]);
      expect(
        cullTuple(await call(0xlendLens, 'xtokenMetadata', [xkcc20._address]))
      ).toEqual(
        {
          xtoken: xkcc20._address,
          exchangeRateCurrent: "1000000000000000000",
          supplyRatePerBlock: "0",
          borrowRatePerBlock: "0",
          reserveFactorMantissa: "0",
          totalBorrows: "0",
          totalReserves: "0",
          totalSupply: "0",
          totalCash: "0",
          isListed: true,
          collateralFactorMantissa: "0",
          underlyingAssetAddress: await call(xkcc20, 'underlying', []),
          xtokenDecimals: "8",
          underlyingDecimals: "18",
          compSupplySpeed: "250000000000000000",
          compBorrowSpeed: "750000000000000000",
          borrowCap: "0",
        }
      );
    });
  });

  describe('xtokenMetadataAll', () => {
    it('is correct for a xkcc20 and xkcc', async () => {
      let xkcc20 = await makextoken();
      let cEth = await makextoken({kind: 'xkcc'});
      expect(
        (await call(0xlendLens, 'xtokenMetadataAll', [[xkcc20._address, cEth._address]])).map(cullTuple)
      ).toEqual([
        {
          xtoken: xkcc20._address,
          exchangeRateCurrent: "1000000000000000000",
          supplyRatePerBlock: "0",
          borrowRatePerBlock: "0",
          reserveFactorMantissa: "0",
          totalBorrows: "0",
          totalReserves: "0",
          totalSupply: "0",
          totalCash: "0",
          isListed:false,
          collateralFactorMantissa: "0",
          underlyingAssetAddress: await call(xkcc20, 'underlying', []),
          xtokenDecimals: "8",
          underlyingDecimals: "18",
          compSupplySpeed: "0",
          compBorrowSpeed: "0",
          borrowCap: "0",
        },
        {
          borrowRatePerBlock: "0",
          xtoken: cEth._address,
          xtokenDecimals: "8",
          collateralFactorMantissa: "0",
          exchangeRateCurrent: "1000000000000000000",
          isListed: false,
          reserveFactorMantissa: "0",
          supplyRatePerBlock: "0",
          totalBorrows: "0",
          totalCash: "0",
          totalReserves: "0",
          totalSupply: "0",
          underlyingAssetAddress: "0x0000000000000000000000000000000000000000",
          underlyingDecimals: "18",
          compSupplySpeed: "0",
          compBorrowSpeed: "0",
          borrowCap: "0",
        }
      ]);
    });
  });

  describe('xtokenBalances', () => {
    it('is correct for xkcc20', async () => {
      let xkcc20 = await makextoken();
      expect(
        cullTuple(await call(0xlendLens, 'xtokenBalances', [xkcc20._address, acct]))
      ).toEqual(
        {
          balanceOf: "0",
          balanceOfUnderlying: "0",
          borrowBalanceCurrent: "0",
          xtoken: xkcc20._address,
          tokenAllowance: "0",
          tokenBalance: "10000000000000000000000000",
        }
      );
    });

    it('is correct for cETH', async () => {
      let cEth = await makextoken({kind: 'xkcc'});
      let ethBalance = await web3.eth.getBalance(acct);
      expect(
        cullTuple(await call(0xlendLens, 'xtokenBalances', [cEth._address, acct], {gasPrice: '0'}))
      ).toEqual(
        {
          balanceOf: "0",
          balanceOfUnderlying: "0",
          borrowBalanceCurrent: "0",
          xtoken: cEth._address,
          tokenAllowance: ethBalance,
          tokenBalance: ethBalance,
        }
      );
    });
  });

  describe('xtokenBalancesAll', () => {
    it('is correct for cEth and xkcc20', async () => {
      let xkcc20 = await makextoken();
      let cEth = await makextoken({kind: 'xkcc'});
      let ethBalance = await web3.eth.getBalance(acct);
      
      expect(
        (await call(0xlendLens, 'xtokenBalancesAll', [[xkcc20._address, cEth._address], acct], {gasPrice: '0'})).map(cullTuple)
      ).toEqual([
        {
          balanceOf: "0",
          balanceOfUnderlying: "0",
          borrowBalanceCurrent: "0",
          xtoken: xkcc20._address,
          tokenAllowance: "0",
          tokenBalance: "10000000000000000000000000",
        },
        {
          balanceOf: "0",
          balanceOfUnderlying: "0",
          borrowBalanceCurrent: "0",
          xtoken: cEth._address,
          tokenAllowance: ethBalance,
          tokenBalance: ethBalance,
        }
      ]);
    })
  });

  describe('xtokenUnderlyingPrice', () => {
    it('gets correct price for xkcc20', async () => {
      let xkcc20 = await makextoken();
      expect(
        cullTuple(await call(0xlendLens, 'xtokenUnderlyingPrice', [xkcc20._address]))
      ).toEqual(
        {
          xtoken: xkcc20._address,
          underlyingPrice: "0",
        }
      );
    });

    it('gets correct price for cEth', async () => {
      let cEth = await makextoken({kind: 'xkcc'});
      expect(
        cullTuple(await call(0xlendLens, 'xtokenUnderlyingPrice', [cEth._address]))
      ).toEqual(
        {
          xtoken: cEth._address,
          underlyingPrice: "0",
        }
      );
    });
  });

  describe('xtokenUnderlyingPriceAll', () => {
    it('gets correct price for both', async () => {
      let xkcc20 = await makextoken();
      let cEth = await makextoken({kind: 'xkcc'});
      expect(
        (await call(0xlendLens, 'xtokenUnderlyingPriceAll', [[xkcc20._address, cEth._address]])).map(cullTuple)
      ).toEqual([
        {
          xtoken: xkcc20._address,
          underlyingPrice: "0",
        },
        {
          xtoken: cEth._address,
          underlyingPrice: "0",
        }
      ]);
    });
  });

  describe('getAccountLimits', () => {
    it('gets correct values', async () => {
      let xtroller = await makextroller();

      expect(
        cullTuple(await call(0xlendLens, 'getAccountLimits', [xtroller._address, acct]))
      ).toEqual({
        liquidity: "0",
        markets: [],
        shortfall: "0"
      });
    });
  });

  describe('governance', () => {
    let led, gov;
    let targets, values, signatures, callDatas;
    let proposalBlock, proposalId;

    beforeEach(async () => {
      led = await deploy('led', [acct]);
      gov = await deploy('GovernorAlpha', [address(0), led._address, address(0)]);
      targets = [acct];
      values = ["0"];
      signatures = ["getBalanceOf(address)"];
      callDatas = [encodeParameters(['address'], [acct])];
      await send(led, 'delegate', [acct]);
      await send(gov, 'propose', [targets, values, signatures, callDatas, "do nothing"]);
      proposalBlock = +(await web3.eth.getBlockNumber());
      proposalId = await call(gov, 'latestProposalIds', [acct]);
    });

    describe('getGovReceipts', () => {
      it('gets correct values', async () => {
        expect(
          (await call(0xlendLens, 'getGovReceipts', [gov._address, acct, [proposalId]])).map(cullTuple)
        ).toEqual([
          {
            hasVoted: false,
            proposalId: proposalId,
            support: false,
            votes: "0",
          }
        ]);
      })
    });

    describe('getGovProposals', () => {
      it('gets correct values', async () => {
        expect(
          (await call(0xlendLens, 'getGovProposals', [gov._address, [proposalId]])).map(cullTuple)
        ).toEqual([
          {
            againstVotes: "0",
            calldatas: callDatas,
            canceled: false,
            endBlock: (Number(proposalBlock) + 17281).toString(),
            eta: "0",
            executed: false,
            forVotes: "0",
            proposalId: proposalId,
            proposer: acct,
            signatures: signatures,
            startBlock: (Number(proposalBlock) + 1).toString(),
            targets: targets
          }
        ]);
      })
    });
  });

  describe('led', () => {
    let led, currentBlock;

    beforeEach(async () => {
      currentBlock = +(await web3.eth.getBlockNumber());
      led = await deploy('led', [acct]);
    });

    describe('getCompBalanceMetadata', () => {
      it('gets correct values', async () => {
        expect(
          cullTuple(await call(0xlendLens, 'getCompBalanceMetadata', [led._address, acct]))
        ).toEqual({
          balance: "10000000000000000000000000",
          delegate: "0x0000000000000000000000000000000000000000",
          votes: "0",
        });
      });
    });

    describe('getCompBalanceMetadataExt', () => {
      it('gets correct values', async () => {
        let xtroller = await makextroller();
        await send(xtroller, 'setCompAccrued', [acct, 5]); // harness only

        expect(
          cullTuple(await call(0xlendLens, 'getCompBalanceMetadataExt', [led._address, xtroller._address, acct]))
        ).toEqual({
          balance: "10000000000000000000000000",
          delegate: "0x0000000000000000000000000000000000000000",
          votes: "0",
          allocated: "5"
        });
      });
    });

    describe('getCompVotes', () => {
      it('gets correct values', async () => {
        expect(
          (await call(0xlendLens, 'getCompVotes', [led._address, acct, [currentBlock, currentBlock - 1]])).map(cullTuple)
        ).toEqual([
          {
            blockNumber: currentBlock.toString(),
            votes: "0",
          },
          {
            blockNumber: (Number(currentBlock) - 1).toString(),
            votes: "0",
          }
        ]);
      });

      it('reverts on future value', async () => {
        await expect(
          call(0xlendLens, 'getCompVotes', [led._address, acct, [currentBlock + 1]])
        ).rejects.toRevert('revert led::getPriorVotes: not yet determined')
      });
    });
  });
});
