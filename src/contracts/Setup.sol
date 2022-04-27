pragma solidity ^0.5.16;
//xtoken
import "./xkcc20Delegator.sol";
import "./xkcc20Delegate.sol";
//xtroller
import "./xUnitroller.sol";
import "./xtrollerG1.sol";
//interestModel
import "./WhitePaperInterestRateModel.sol";
//priceOracle
import "./SimplePriceOracle.sol";

contract Setup {
    xkcc20Delegator public cUni;
    xkcc20Delegate	public cUniDelegate;
    xUnitroller		public xUnitroller;
    xtrollerG1	public xtroller;
    xtrollerG1	public xUnitrollerProxy;
    WhitePaperInterestRateModel	public whitePaper;
    SimplePriceOracle	public priceOracle;
    
    constructor() public payable{
        //先初始化priceOracle
        priceOracle = new SimplePriceOracle();
        //再初始化whitepaper
        whitePaper = new WhitePaperInterestRateModel(50000000000000000,
                                                     120000000000000000);
        //再初始化xtroller
        xUnitroller = new xUnitroller();
        xtroller = new xtrollerG1();
        xUnitrollerProxy = xtrollerG1(address(xUnitroller));

        xUnitroller._setPendingImplementation(address(xtroller));
        xtroller._become(xUnitroller, priceOracle, 500000000000000000, 20, true);

       	xUnitrollerProxy._setPriceOracle(priceOracle);
        xUnitrollerProxy._setCloseFactor(500000000000000000);
        xUnitrollerProxy._setMaxAssets(20);
        xUnitrollerProxy._setLiquidationIncentive(1080000000000000000);

        cUniDelegate = new xkcc20Delegate();
        bytes memory data = new bytes(0x00);
        cUni = new xkcc20Delegator(
            					   0x01bC347684a455A0B7dC5A37cb311Aef28BF9eF9, 
                                   xtrollerInterface(address(xUnitroller)), 
                                   InterestRateModel(address(whitePaper)),
                                   200000000000000000000000000,
                                   "0xlend Uniswap",
                                   "cUNI",
                                   8,
                                   address(uint160(address(this))),
                                   address(cUniDelegate),
                                   data
                                  );
        cUni._setImplementation(address(cUniDelegate), false, data);
        cUni._setReserveFactor(250000000000000000);
        
        //设置uni的价格
        priceOracle.setUnderlyingPrice(xtoken(address(cUni)), 1e18);
        //支持的markets
        xUnitrollerProxy._supportMarket(xtoken(address(cUni)));
        xUnitrollerProxy._setCollateralFactor(xtoken(address(cUni)), 
                                             600000000000000000);   
    }
}