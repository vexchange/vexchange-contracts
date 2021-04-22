pragma solidity >=0.5.0;

interface IUniswapV2Factory {
    event PairCreated(address indexed token0, address indexed token1, address pair, uint);
    event PlatformFeeToChanged(address oldFeeTo, address newFeeTo);
    event DefaultSwapFeeChanged(uint oldDefaultSwapFee, uint newDefaultSwapFee);
    event DefaultPlatformFeeChanged(uint oldDefaultPlatformFee, uint newDefaultPlatformFee);
    event DefaultRecovererChanged(address oldDefaultRecoverer, address newDefaultRecoverer);

    function MAX_PLATFORM_FEE() external view returns (uint);
    function MIN_SWAP_FEE() external view returns (uint);
    function MAX_SWAP_FEE() external view returns (uint);

    function owner() external view returns (address);
    function transferOwnership(address newOwner) external;

    function platformFeeTo() external view returns (address);
    function setPlatformFeeTo(address) external;
    
    function getPair(address tokenA, address tokenB) external view returns (address pair);
    function allPairs(uint) external view returns (address pair);
    function allPairsLength() external view returns (uint);

    function createPair(address tokenA, address tokenB) external returns (address pair);

    function defaultSwapFee() external view returns (uint);
    function defaultPlatformFee() external view returns (uint);
    function defaultRecoverer() external view returns (address);
    function defaultPlatformFeeOn() external view returns (bool);

    function setDefaultSwapFee(uint) external;
    function setDefaultPlatformFee(uint) external;
    function setDefaultRecoverer(address) external;

    function setSwapFeeForPair(address, uint) external;
    function setPlatformFeeForPair(address, uint) external;
    function setRecovererForPair(address, address) external;
}
