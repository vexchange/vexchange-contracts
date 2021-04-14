pragma solidity >=0.5.0;

interface IUniswapV2Factory {
    event PairCreated(address indexed token0, address indexed token1, address pair, uint);

    function feeTo() external view returns (address);

    function defaultSwapFee() external view returns (uint);
    function defaultPlatformFee() external view returns (uint);
    function defaultRecoverer() external view returns (address);

    function allPairsLength() external view returns (uint);

    function createPair(address tokenA, address tokenB) external returns (address pair);

    function setFeeTo(address) external;

    function setDefaultSwapFee(uint) external;
    function setDefaultPlatformFee(uint) external;
    function setDefaultRecoverer(address) external;

    function setSwapFeeForPair(address, uint) external;
    function setPlatformFeeForPair(address, uint) external;
    function setRecovererForPair(address, address) external;

    function MAX_PLATFORM_FEE() external view returns (uint);
    function MIN_SWAP_FEE() external view returns (uint);
    function MAX_SWAP_FEE() external view returns (uint);
}
