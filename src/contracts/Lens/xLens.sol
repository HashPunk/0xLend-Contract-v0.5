pragma solidity ^0.5.16;
pragma experimental ABIEncoderV2;

import "../xkcc20.sol";
import "../xtoken.sol";
import "../PriceOracle.sol";
import "../EIP20Interface.sol";
import "../Governance/GovernorAlpha.sol";
import "../Governance/led.sol";

interface xtrollerLensInterface {
    function markets(address) external view returns (bool, uint);
    function oracle() external view returns (PriceOracle);
    function getAccountLiquidity(address) external view returns (uint, uint, uint);
    function getAssetsIn(address) external view returns (xtoken[] memory);
    function claimComp(address) external;
    function compAccrued(address) external view returns (uint);
    function compSpeeds(address) external view returns (uint);
    function compSupplySpeeds(address) external view returns (uint);
    function compBorrowSpeeds(address) external view returns (uint);
    function borrowCaps(address) external view returns (uint);
}

interface GovernorBravoInterface {
    struct Receipt {
        bool hasVoted;
        uint8 support;
        uint96 votes;
    }
    struct Proposal {
        uint id;
        address proposer;
        uint eta;
        uint startBlock;
        uint endBlock;
        uint forVotes;
        uint againstVotes;
        uint abstainVotes;
        bool canceled;
        bool executed;
    }
    function getActions(uint proposalId) external view returns (address[] memory targets, uint[] memory values, string[] memory signatures, bytes[] memory calldatas);
    function proposals(uint proposalId) external view returns (Proposal memory);
    function getReceipt(uint proposalId, address voter) external view returns (Receipt memory);
}

contract 0xlendLens {
    struct xtokenMetadata {
        address xtoken;
        uint exchangeRateCurrent;
        uint supplyRatePerBlock;
        uint borrowRatePerBlock;
        uint reserveFactorMantissa;
        uint totalBorrows;
        uint totalReserves;
        uint totalSupply;
        uint totalCash;
        bool isListed;
        uint collateralFactorMantissa;
        address underlyingAssetAddress;
        uint xtokenDecimals;
        uint underlyingDecimals;
        uint compSupplySpeed;
        uint compBorrowSpeed;
        uint borrowCap;
    }

    function getCompSpeeds(xtrollerLensInterface xtroller, xtoken xtoken) internal returns (uint, uint) {
        // Getting led speeds is gnarly due to not every network having the
        // split led speeds from Proposal 62 and other networks don't even
        // have led speeds.
        uint compSupplySpeed = 0;
        (bool compSupplySpeedSuccess, bytes memory compSupplySpeedReturnData) =
            address(xtroller).call(
                abi.encodePacked(
                    xtroller.compSupplySpeeds.selector,
                    abi.encode(address(xtoken))
                )
            );
        if (compSupplySpeedSuccess) {
            compSupplySpeed = abi.decode(compSupplySpeedReturnData, (uint));
        }

        uint compBorrowSpeed = 0;
        (bool compBorrowSpeedSuccess, bytes memory compBorrowSpeedReturnData) =
            address(xtroller).call(
                abi.encodePacked(
                    xtroller.compBorrowSpeeds.selector,
                    abi.encode(address(xtoken))
                )
            );
        if (compBorrowSpeedSuccess) {
            compBorrowSpeed = abi.decode(compBorrowSpeedReturnData, (uint));
        }

        // If the split led speeds call doesn't work, try the  oldest non-spit version.
        if (!compSupplySpeedSuccess || !compBorrowSpeedSuccess) {
            (bool compSpeedSuccess, bytes memory compSpeedReturnData) =
            address(xtroller).call(
                abi.encodePacked(
                    xtroller.compSpeeds.selector,
                    abi.encode(address(xtoken))
                )
            );
            if (compSpeedSuccess) {
                compSupplySpeed = compBorrowSpeed = abi.decode(compSpeedReturnData, (uint));
            }
        }
        return (compSupplySpeed, compBorrowSpeed);
    }

    function xtokenMetadata(xtoken xtoken) public returns (xtokenMetadata memory) {
        uint exchangeRateCurrent = xtoken.exchangeRateCurrent();
        xtrollerLensInterface xtroller = xtrollerLensInterface(address(xtoken.xtroller()));
        (bool isListed, uint collateralFactorMantissa) = xtroller.markets(address(xtoken));
        address underlyingAssetAddress;
        uint underlyingDecimals;

        if (compareStrings(xtoken.symbol(), "cETH")) {
            underlyingAssetAddress = address(0);
            underlyingDecimals = 18;
        } else {
            xkcc20 xkcc20 = xkcc20(address(xtoken));
            underlyingAssetAddress = xkcc20.underlying();
            underlyingDecimals = EIP20Interface(xkcc20.underlying()).decimals();
        }

        (uint compSupplySpeed, uint compBorrowSpeed) = getCompSpeeds(xtroller, xtoken);

        uint borrowCap = 0;
        (bool borrowCapSuccess, bytes memory borrowCapReturnData) =
            address(xtroller).call(
                abi.encodePacked(
                    xtroller.borrowCaps.selector,
                    abi.encode(address(xtoken))
                )
            );
        if (borrowCapSuccess) {
            borrowCap = abi.decode(borrowCapReturnData, (uint));
        }

        return xtokenMetadata({
            xtoken: address(xtoken),
            exchangeRateCurrent: exchangeRateCurrent,
            supplyRatePerBlock: xtoken.supplyRatePerBlock(),
            borrowRatePerBlock: xtoken.borrowRatePerBlock(),
            reserveFactorMantissa: xtoken.reserveFactorMantissa(),
            totalBorrows: xtoken.totalBorrows(),
            totalReserves: xtoken.totalReserves(),
            totalSupply: xtoken.totalSupply(),
            totalCash: xtoken.getCash(),
            isListed: isListed,
            collateralFactorMantissa: collateralFactorMantissa,
            underlyingAssetAddress: underlyingAssetAddress,
            xtokenDecimals: xtoken.decimals(),
            underlyingDecimals: underlyingDecimals,
            compSupplySpeed: compSupplySpeed,
            compBorrowSpeed: compBorrowSpeed,
            borrowCap: borrowCap
        });
    }

    function xtokenMetadataAll(xtoken[] calldata xtokens) external returns (xtokenMetadata[] memory) {
        uint xtokenCount = xtokens.length;
        xtokenMetadata[] memory res = new xtokenMetadata[](xtokenCount);
        for (uint i = 0; i < xtokenCount; i++) {
            res[i] = xtokenMetadata(xtokens[i]);
        }
        return res;
    }

    struct xtokenBalances {
        address xtoken;
        uint balanceOf;
        uint borrowBalanceCurrent;
        uint balanceOfUnderlying;
        uint tokenBalance;
        uint tokenAllowance;
    }

    function xtokenBalances(xtoken xtoken, address payable account) public returns (xtokenBalances memory) {
        uint balanceOf = xtoken.balanceOf(account);
        uint borrowBalanceCurrent = xtoken.borrowBalanceCurrent(account);
        uint balanceOfUnderlying = xtoken.balanceOfUnderlying(account);
        uint tokenBalance;
        uint tokenAllowance;

        if (compareStrings(xtoken.symbol(), "cETH")) {
            tokenBalance = account.balance;
            tokenAllowance = account.balance;
        } else {
            xkcc20 xkcc20 = xkcc20(address(xtoken));
            EIP20Interface underlying = EIP20Interface(xkcc20.underlying());
            tokenBalance = underlying.balanceOf(account);
            tokenAllowance = underlying.allowance(account, address(xtoken));
        }

        return xtokenBalances({
            xtoken: address(xtoken),
            balanceOf: balanceOf,
            borrowBalanceCurrent: borrowBalanceCurrent,
            balanceOfUnderlying: balanceOfUnderlying,
            tokenBalance: tokenBalance,
            tokenAllowance: tokenAllowance
        });
    }

    function xtokenBalancesAll(xtoken[] calldata xtokens, address payable account) external returns (xtokenBalances[] memory) {
        uint xtokenCount = xtokens.length;
        xtokenBalances[] memory res = new xtokenBalances[](xtokenCount);
        for (uint i = 0; i < xtokenCount; i++) {
            res[i] = xtokenBalances(xtokens[i], account);
        }
        return res;
    }

    struct xtokenUnderlyingPrice {
        address xtoken;
        uint underlyingPrice;
    }

    function xtokenUnderlyingPrice(xtoken xtoken) public returns (xtokenUnderlyingPrice memory) {
        xtrollerLensInterface xtroller = xtrollerLensInterface(address(xtoken.xtroller()));
        PriceOracle priceOracle = xtroller.oracle();

        return xtokenUnderlyingPrice({
            xtoken: address(xtoken),
            underlyingPrice: priceOracle.getUnderlyingPrice(xtoken)
        });
    }

    function xtokenUnderlyingPriceAll(xtoken[] calldata xtokens) external returns (xtokenUnderlyingPrice[] memory) {
        uint xtokenCount = xtokens.length;
        xtokenUnderlyingPrice[] memory res = new xtokenUnderlyingPrice[](xtokenCount);
        for (uint i = 0; i < xtokenCount; i++) {
            res[i] = xtokenUnderlyingPrice(xtokens[i]);
        }
        return res;
    }

    struct AccountLimits {
        xtoken[] markets;
        uint liquidity;
        uint shortfall;
    }

    function getAccountLimits(xtrollerLensInterface xtroller, address account) public returns (AccountLimits memory) {
        (uint errorCode, uint liquidity, uint shortfall) = xtroller.getAccountLiquidity(account);
        require(errorCode == 0);

        return AccountLimits({
            markets: xtroller.getAssetsIn(account),
            liquidity: liquidity,
            shortfall: shortfall
        });
    }

    struct GovReceipt {
        uint proposalId;
        bool hasVoted;
        bool support;
        uint96 votes;
    }

    function getGovReceipts(GovernorAlpha governor, address voter, uint[] memory proposalIds) public view returns (GovReceipt[] memory) {
        uint proposalCount = proposalIds.length;
        GovReceipt[] memory res = new GovReceipt[](proposalCount);
        for (uint i = 0; i < proposalCount; i++) {
            GovernorAlpha.Receipt memory receipt = governor.getReceipt(proposalIds[i], voter);
            res[i] = GovReceipt({
                proposalId: proposalIds[i],
                hasVoted: receipt.hasVoted,
                support: receipt.support,
                votes: receipt.votes
            });
        }
        return res;
    }

    struct GovBravoReceipt {
        uint proposalId;
        bool hasVoted;
        uint8 support;
        uint96 votes;
    }

    function getGovBravoReceipts(GovernorBravoInterface governor, address voter, uint[] memory proposalIds) public view returns (GovBravoReceipt[] memory) {
        uint proposalCount = proposalIds.length;
        GovBravoReceipt[] memory res = new GovBravoReceipt[](proposalCount);
        for (uint i = 0; i < proposalCount; i++) {
            GovernorBravoInterface.Receipt memory receipt = governor.getReceipt(proposalIds[i], voter);
            res[i] = GovBravoReceipt({
                proposalId: proposalIds[i],
                hasVoted: receipt.hasVoted,
                support: receipt.support,
                votes: receipt.votes
            });
        }
        return res;
    }

    struct GovProposal {
        uint proposalId;
        address proposer;
        uint eta;
        address[] targets;
        uint[] values;
        string[] signatures;
        bytes[] calldatas;
        uint startBlock;
        uint endBlock;
        uint forVotes;
        uint againstVotes;
        bool canceled;
        bool executed;
    }

    function setProposal(GovProposal memory res, GovernorAlpha governor, uint proposalId) internal view {
        (
            ,
            address proposer,
            uint eta,
            uint startBlock,
            uint endBlock,
            uint forVotes,
            uint againstVotes,
            bool canceled,
            bool executed
        ) = governor.proposals(proposalId);
        res.proposalId = proposalId;
        res.proposer = proposer;
        res.eta = eta;
        res.startBlock = startBlock;
        res.endBlock = endBlock;
        res.forVotes = forVotes;
        res.againstVotes = againstVotes;
        res.canceled = canceled;
        res.executed = executed;
    }

    function getGovProposals(GovernorAlpha governor, uint[] calldata proposalIds) external view returns (GovProposal[] memory) {
        GovProposal[] memory res = new GovProposal[](proposalIds.length);
        for (uint i = 0; i < proposalIds.length; i++) {
            (
                address[] memory targets,
                uint[] memory values,
                string[] memory signatures,
                bytes[] memory calldatas
            ) = governor.getActions(proposalIds[i]);
            res[i] = GovProposal({
                proposalId: 0,
                proposer: address(0),
                eta: 0,
                targets: targets,
                values: values,
                signatures: signatures,
                calldatas: calldatas,
                startBlock: 0,
                endBlock: 0,
                forVotes: 0,
                againstVotes: 0,
                canceled: false,
                executed: false
            });
            setProposal(res[i], governor, proposalIds[i]);
        }
        return res;
    }

    struct GovBravoProposal {
        uint proposalId;
        address proposer;
        uint eta;
        address[] targets;
        uint[] values;
        string[] signatures;
        bytes[] calldatas;
        uint startBlock;
        uint endBlock;
        uint forVotes;
        uint againstVotes;
        uint abstainVotes;
        bool canceled;
        bool executed;
    }

    function setBravoProposal(GovBravoProposal memory res, GovernorBravoInterface governor, uint proposalId) internal view {
        GovernorBravoInterface.Proposal memory p = governor.proposals(proposalId);

        res.proposalId = proposalId;
        res.proposer = p.proposer;
        res.eta = p.eta;
        res.startBlock = p.startBlock;
        res.endBlock = p.endBlock;
        res.forVotes = p.forVotes;
        res.againstVotes = p.againstVotes;
        res.abstainVotes = p.abstainVotes;
        res.canceled = p.canceled;
        res.executed = p.executed;
    }

    function getGovBravoProposals(GovernorBravoInterface governor, uint[] calldata proposalIds) external view returns (GovBravoProposal[] memory) {
        GovBravoProposal[] memory res = new GovBravoProposal[](proposalIds.length);
        for (uint i = 0; i < proposalIds.length; i++) {
            (
                address[] memory targets,
                uint[] memory values,
                string[] memory signatures,
                bytes[] memory calldatas
            ) = governor.getActions(proposalIds[i]);
            res[i] = GovBravoProposal({
                proposalId: 0,
                proposer: address(0),
                eta: 0,
                targets: targets,
                values: values,
                signatures: signatures,
                calldatas: calldatas,
                startBlock: 0,
                endBlock: 0,
                forVotes: 0,
                againstVotes: 0,
                abstainVotes: 0,
                canceled: false,
                executed: false
            });
            setBravoProposal(res[i], governor, proposalIds[i]);
        }
        return res;
    }

    struct CompBalanceMetadata {
        uint balance;
        uint votes;
        address delegate;
    }

    function getCompBalanceMetadata(led led, address account) external view returns (CompBalanceMetadata memory) {
        return CompBalanceMetadata({
            balance: led.balanceOf(account),
            votes: uint256(led.getCurrentVotes(account)),
            delegate: led.delegates(account)
        });
    }

    struct CompBalanceMetadataExt {
        uint balance;
        uint votes;
        address delegate;
        uint allocated;
    }

    function getCompBalanceMetadataExt(led led, xtrollerLensInterface xtroller, address account) external returns (CompBalanceMetadataExt memory) {
        uint balance = led.balanceOf(account);
        xtroller.claimComp(account);
        uint newBalance = led.balanceOf(account);
        uint accrued = xtroller.compAccrued(account);
        uint total = add(accrued, newBalance, "sum led total");
        uint allocated = sub(total, balance, "sub allocated");

        return CompBalanceMetadataExt({
            balance: balance,
            votes: uint256(led.getCurrentVotes(account)),
            delegate: led.delegates(account),
            allocated: allocated
        });
    }

    struct CompVotes {
        uint blockNumber;
        uint votes;
    }

    function getCompVotes(led led, address account, uint32[] calldata blockNumbers) external view returns (CompVotes[] memory) {
        CompVotes[] memory res = new CompVotes[](blockNumbers.length);
        for (uint i = 0; i < blockNumbers.length; i++) {
            res[i] = CompVotes({
                blockNumber: uint256(blockNumbers[i]),
                votes: uint256(led.getPriorVotes(account, blockNumbers[i]))
            });
        }
        return res;
    }

    function compareStrings(string memory a, string memory b) internal pure returns (bool) {
        return (keccak256(abi.encodePacked((a))) == keccak256(abi.encodePacked((b))));
    }

    function add(uint a, uint b, string memory errorMessage) internal pure returns (uint) {
        uint c = a + b;
        require(c >= a, errorMessage);
        return c;
    }

    function sub(uint a, uint b, string memory errorMessage) internal pure returns (uint) {
        require(b <= a, errorMessage);
        uint c = a - b;
        return c;
    }
}
