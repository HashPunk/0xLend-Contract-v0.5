pragma solidity ^0.5.16;

import "./xtoken.sol";
import "./PriceOracle.sol";

contract xUnitrollerAdminStorage {
    /**
    * @notice Administrator for this contract
    */
    address public admin;

    /**
    * @notice Pending administrator for this contract
    */
    address public pendingAdmin;

    /**
    * @notice Active brains of xUnitroller
    */
    address public xtrollerImplementation;

    /**
    * @notice Pending brains of xUnitroller
    */
    address public pendingxtrollerImplementation;
}

contract xtrollerV1Storage is xUnitrollerAdminStorage {

    /**
     * @notice Oracle which gives the price of any given asset
     */
    PriceOracle public oracle;

    /**
     * @notice Multiplier used to calculate the maximum repayAmount when liquidating a borrow
     */
    uint public closeFactorMantissa;

    /**
     * @notice Multiplier representing the discount on collateral that a liquidator receives
     */
    uint public liquidationIncentiveMantissa;

    /**
     * @notice Max number of assets a single account can participate in (borrow or use as collateral)
     */
    uint public maxAssets;

    /**
     * @notice Per-account mapping of "assets you are in", capped by maxAssets
     */
    mapping(address => xtoken[]) public accountAssets;

}

contract xtrollerV2Storage is xtrollerV1Storage {
    struct Market {
        /// @notice Whether or not this market is listed
        bool isListed;

        /**
         * @notice Multiplier representing the most one can borrow against their collateral in this market.
         *  For instance, 0.9 to allow borrowing 90% of collateral value.
         *  Must be between 0 and 1, and stored as a mantissa.
         */
        uint collateralFactorMantissa;

        /// @notice Per-market mapping of "accounts in this asset"
        mapping(address => bool) accountMembership;

        /// @notice Whether or not this market receives led
        bool isComped;
    }

    /**
     * @notice Official mapping of xtokens -> Market metadata
     * @dev Used e.g. to determine if a market is supported
     */
    mapping(address => Market) public markets;


    /**
     * @notice The Pause Guardian can pause certain actions as a safety mechanism.
     *  Actions which allow users to remove their own assets cannot be paused.
     *  Liquidation / seizing / transfer can only be paused globally, not by market.
     */
    address public pauseGuardian;
    bool public _mintGuardianPaused;
    bool public _borrowGuardianPaused;
    bool public transferGuardianPaused;
    bool public seizeGuardianPaused;
    mapping(address => bool) public mintGuardianPaused;
    mapping(address => bool) public borrowGuardianPaused;
}

contract xtrollerV3Storage is xtrollerV2Storage {
    struct CompMarketState {
        /// @notice The market's last updated compBorrowIndex or compSupplyIndex
        uint224 index;

        /// @notice The block number the index was last updated at
        uint32 block;
    }

    /// @notice A list of all markets
    xtoken[] public allMarkets;

    /// @notice The rate at which the flywheel distributes led, per block
    uint public compRate;

    /// @notice The portion of compRate that each market currently receives
    mapping(address => uint) public compSpeeds;

    /// @notice The led market supply state for each market
    mapping(address => CompMarketState) public compSupplyState;

    /// @notice The led market borrow state for each market
    mapping(address => CompMarketState) public compBorrowState;

    /// @notice The led borrow index for each market for each supplier as of the last time they accrued led
    mapping(address => mapping(address => uint)) public compSupplierIndex;

    /// @notice The led borrow index for each market for each borrower as of the last time they accrued led
    mapping(address => mapping(address => uint)) public compBorrowerIndex;

    /// @notice The led accrued but not yet transferred to each user
    mapping(address => uint) public compAccrued;
}

contract xtrollerV4Storage is xtrollerV3Storage {
    // @notice The borrowCapGuardian can set borrowCaps to any number for any market. Lowering the borrow cap could disable borrowing on the given market.
    address public borrowCapGuardian;

    // @notice Borrow caps enforced by borrowAllowed for each xtoken address. Defaults to zero which corresponds to unlimited borrowing.
    mapping(address => uint) public borrowCaps;
}

contract xtrollerV5Storage is xtrollerV4Storage {
    /// @notice The portion of led that each contributor receives per block
    mapping(address => uint) public compContributorSpeeds;

    /// @notice Last block at which a contributor's led rewards have been allocated
    mapping(address => uint) public lastContributorBlock;
}

contract xtrollerV6Storage is xtrollerV5Storage {
    /// @notice The rate at which led is distributed to the corresponding borrow market (per block)
    mapping(address => uint) public compBorrowSpeeds;

    /// @notice The rate at which led is distributed to the corresponding supply market (per block)
    mapping(address => uint) public compSupplySpeeds;
}

contract xtrollerV7Storage is xtrollerV6Storage {
    /// @notice Flag indicating whether the function to fix led accruals has been executed (RE: proposal 62 bug)
    bool public proposal65FixExecuted;

    /// @notice Accounting storage mapping account addresses to how much led they owe the protocol.
    mapping(address => uint) public compReceivable;
}
