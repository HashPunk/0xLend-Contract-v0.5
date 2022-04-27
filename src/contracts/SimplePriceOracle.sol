pragma solidity ^0.5.16;

import "./PriceOracle.sol";
import "./xkcc20.sol";

contract SimplePriceOracle is PriceOracle {
    mapping(address => uint) prices;
    event PricePosted(address asset, uint previousPriceMantissa, uint requestedPriceMantissa, uint newPriceMantissa);

    function _getUnderlyingAddress(xtoken xtoken) private view returns (address) {
        address asset;
        if (compareStrings(xtoken.symbol(), "cETH")) {
            asset = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
        } else {
            asset = address(xkcc20(address(xtoken)).underlying());
        }
        return asset;
    }

    function getUnderlyingPrice(xtoken xtoken) public view returns (uint) {
        return prices[_getUnderlyingAddress(xtoken)];
    }

    function setUnderlyingPrice(xtoken xtoken, uint underlyingPriceMantissa) public {
        address asset = _getUnderlyingAddress(xtoken);
        emit PricePosted(asset, prices[asset], underlyingPriceMantissa, underlyingPriceMantissa);
        prices[asset] = underlyingPriceMantissa;
    }

    function setDirectPrice(address asset, uint price) public {
        emit PricePosted(asset, prices[asset], price, price);
        prices[asset] = price;
    }

    // v1 price oracle interface for use as backing of proxy
    function assetPrices(address asset) external view returns (uint) {
        return prices[asset];
    }

    function compareStrings(string memory a, string memory b) internal pure returns (bool) {
        return (keccak256(abi.encodePacked((a))) == keccak256(abi.encodePacked((b))));
    }
}
