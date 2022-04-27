pragma solidity ^0.5.16;

contract xtrollerInterface {
    /// @notice Indicator that this is a xtroller contract (for inspection)
    bool public constant isxtroller = true;

    /*** Assets You Are In ***/

    function enterMarkets(address[] calldata xtokens) external returns (uint[] memory);
    function exitMarket(address xtoken) external returns (uint);

    /*** Policy Hooks ***/

    function mintAllowed(address xtoken, address minter, uint mintAmount) external returns (uint);
    function mintVerify(address xtoken, address minter, uint mintAmount, uint mintTokens) external;

    function redeemAllowed(address xtoken, address redeemer, uint redeemTokens) external returns (uint);
    function redeemVerify(address xtoken, address redeemer, uint redeemAmount, uint redeemTokens) external;

    function borrowAllowed(address xtoken, address borrower, uint borrowAmount) external returns (uint);
    function borrowVerify(address xtoken, address borrower, uint borrowAmount) external;

    function repayBorrowAllowed(
        address xtoken,
        address payer,
        address borrower,
        uint repayAmount) external returns (uint);
    function repayBorrowVerify(
        address xtoken,
        address payer,
        address borrower,
        uint repayAmount,
        uint borrowerIndex) external;

    function liquidateBorrowAllowed(
        address xtokenBorrowed,
        address xtokenCollateral,
        address liquidator,
        address borrower,
        uint repayAmount) external returns (uint);
    function liquidateBorrowVerify(
        address xtokenBorrowed,
        address xtokenCollateral,
        address liquidator,
        address borrower,
        uint repayAmount,
        uint seizeTokens) external;

    function seizeAllowed(
        address xtokenCollateral,
        address xtokenBorrowed,
        address liquidator,
        address borrower,
        uint seizeTokens) external returns (uint);
    function seizeVerify(
        address xtokenCollateral,
        address xtokenBorrowed,
        address liquidator,
        address borrower,
        uint seizeTokens) external;

    function transferAllowed(address xtoken, address src, address dst, uint transferTokens) external returns (uint);
    function transferVerify(address xtoken, address src, address dst, uint transferTokens) external;

    /*** Liquidity/Liquidation Calculations ***/

    function liquidateCalculateSeizeTokens(
        address xtokenBorrowed,
        address xtokenCollateral,
        uint repayAmount) external view returns (uint, uint);
}
