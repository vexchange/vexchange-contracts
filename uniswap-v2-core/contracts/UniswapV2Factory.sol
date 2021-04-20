pragma solidity =0.5.16;

import './interfaces/IUniswapV2Factory.sol';
import './UniswapV2Pair.sol';
import './libraries/Ownable.sol';

contract UniswapV2Factory is IUniswapV2Factory, Ownable {
    uint public constant MAX_PLATFORM_FEE = 5000;   // 50.00%
    uint public constant MIN_SWAP_FEE     = 5;      //  0.05%
    uint public constant MAX_SWAP_FEE     = 200;    //  2.00%

    uint public defaultSwapFee;
    uint public defaultPlatformFee;
    address public defaultRecoverer;

    address public feeTo;

    mapping(address => mapping(address => address)) public getPair;
    address[] public allPairs;

    event PairCreated(address indexed token0, address indexed token1, address pair, uint);
    event FeeToChanged(address oldFeeTo, address newFeeTo);
    event DefaultSwapFeeChanged(uint oldDefaultSwapFee, uint newDefaultSwapFee);
    event DefaultPlatformFeeChanged(uint oldDefaultPlatformFee, uint newDefaultPlatformFee);
    event DefaultRecovererChanged(address oldDefaultRecoverer, address newDefaultRecoverer);

    constructor(uint _defaultSwapFee, uint _defaultPlatformFee, address _defaultRecoverer) public {
        defaultSwapFee = _defaultSwapFee;
        defaultPlatformFee = _defaultPlatformFee;
        defaultRecoverer = _defaultRecoverer;
    }

    function allPairsLength() external view returns (uint) {
        return allPairs.length;
    }

    function createPair(address tokenA, address tokenB) external returns (address pair) {
        require(tokenA != tokenB, 'UniswapV2: IDENTICAL_ADDRESSES');
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0), 'UniswapV2: ZERO_ADDRESS');
        require(getPair[token0][token1] == address(0), 'UniswapV2: PAIR_EXISTS'); // single check is sufficient
        bytes memory bytecode = type(UniswapV2Pair).creationCode;
        bytes32 salt = keccak256(abi.encodePacked(token0, token1));
        assembly {
            pair := create2(0, add(bytecode, 32), mload(bytecode), salt)
        }
        IUniswapV2Pair(pair).initialize(token0, token1, defaultSwapFee, defaultPlatformFee);
        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair; // populate mapping in the reverse direction
        allPairs.push(pair);
        emit PairCreated(token0, token1, pair, allPairs.length);
    }

    function setFeeTo(address _feeTo) external onlyOwner {
        emit FeeToChanged(feeTo, _feeTo);
        feeTo = _feeTo;
    }
    
    function setDefaultSwapFee(uint _swapFee) external onlyOwner {
        require(_swapFee < MAX_SWAP_FEE, "Vexchange: INVALID_SWAP_FEE");
        require(_swapFee > MIN_SWAP_FEE, "Vexchange: INVALID_SWAP_FEE");
        
        emit DefaultSwapFeeChanged(defaultSwapFee, _swapFee);
        defaultSwapFee = _swapFee;
    }
    
    function setDefaultPlatformFee(uint _platformFee) external onlyOwner {
        require(_platformFee < MAX_PLATFORM_FEE, "Vexchange: INVALID_PLATFORM_FEE");
        
        emit DefaultPlatformFeeChanged(defaultPlatformFee, _platformFee);
        defaultPlatformFee = _platformFee;
    }
    
    function setDefaultRecoverer(address _recoverer) external onlyOwner {
        emit DefaultRecovererChanged(defaultRecoverer, _recoverer);
        defaultRecoverer = _recoverer;
    }
    
    function setSwapFeeForPair(address _pair, uint _swapFee) external onlyOwner {
        IUniswapV2Pair(_pair).setSwapFee(_swapFee);
    }
    
    function setPlatformFeeForPair(address _pair, uint _platformFee) external onlyOwner {
        IUniswapV2Pair(_pair).setPlatformFee(_platformFee);
    }
    
    function setRecovererForPair(address _pair, address _recoverer) external onlyOwner {
        IUniswapV2Pair(_pair).setRecoverer(_recoverer);
    }
}
