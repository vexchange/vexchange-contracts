pragma solidity =0.5.16;

import './interfaces/IVexchangeV2Factory.sol';
import './VexchangeV2Pair.sol';
import './libraries/Ownable.sol';

contract VexchangeV2Factory is IVexchangeV2Factory, Ownable {
    uint public constant MAX_PLATFORM_FEE = 5000;   // 50.00%
    uint public constant MIN_SWAP_FEE     = 5;      //  0.05%
    uint public constant MAX_SWAP_FEE     = 200;    //  2.00%

    uint public defaultSwapFee;
    uint public defaultPlatformFee;
    address public defaultRecoverer;

    address public platformFeeTo;

    mapping(address => mapping(address => address)) public getPair;
    address[] public allPairs;

    event PairCreated(address indexed token0, address indexed token1, address pair, uint, uint swapFee, uint platformFee);
    event PlatformFeeToChanged(address oldFeeTo, address newFeeTo);
    event DefaultSwapFeeChanged(uint oldDefaultSwapFee, uint newDefaultSwapFee);
    event DefaultPlatformFeeChanged(uint oldDefaultPlatformFee, uint newDefaultPlatformFee);
    event DefaultRecovererChanged(address oldDefaultRecoverer, address newDefaultRecoverer);

    constructor(uint _defaultSwapFee, uint _defaultPlatformFee, address _platformFeeTo, address _defaultRecoverer) public {
        defaultSwapFee = _defaultSwapFee;
        defaultPlatformFee = _defaultPlatformFee;
        platformFeeTo = _platformFeeTo;
        defaultRecoverer = _defaultRecoverer;
    }

    function allPairsLength() external view returns (uint) {
        return allPairs.length;
    }

    function createPair(address tokenA, address tokenB) external returns (address pair) {
        require(tokenA != tokenB, 'VexchangeV2: IDENTICAL_ADDRESSES');
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0), 'VexchangeV2: ZERO_ADDRESS');
        require(getPair[token0][token1] == address(0), 'VexchangeV2: PAIR_EXISTS'); // single check is sufficient
        bytes memory bytecode = type(VexchangeV2Pair).creationCode;
        bytes32 salt = keccak256(abi.encodePacked(token0, token1));
        assembly {
            pair := create2(0, add(bytecode, 32), mload(bytecode), salt)
        }
        IVexchangeV2Pair(pair).initialize(token0, token1, defaultSwapFee, defaultPlatformFee);
        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair; // populate mapping in the reverse direction
        allPairs.push(pair);
        emit PairCreated(token0, token1, pair, allPairs.length, defaultSwapFee, defaultPlatformFee);
    }

    function getPairInitHash() public pure returns(bytes32){
        bytes memory rawInitCode = type(VexchangeV2Pair).creationCode;
        return keccak256(abi.encodePacked(rawInitCode));
    }

    function setPlatformFeeTo(address _platformFeeTo) external onlyOwner {
        emit PlatformFeeToChanged(platformFeeTo, _platformFeeTo);
        platformFeeTo = _platformFeeTo;
    }
    
    function setDefaultSwapFee(uint _swapFee) external onlyOwner {
        require(_swapFee >= MIN_SWAP_FEE && _swapFee <= MAX_SWAP_FEE, "VexchangeV2: INVALID_SWAP_FEE");
        
        emit DefaultSwapFeeChanged(defaultSwapFee, _swapFee);
        defaultSwapFee = _swapFee;
    }
    
    function defaultPlatformFeeOn() external view returns (bool _platformFeeOn)
    {
        _platformFeeOn = defaultPlatformFee > 0;
    }

    function setDefaultPlatformFee(uint _platformFee) external onlyOwner {
        require(_platformFee <= MAX_PLATFORM_FEE, "VexchangeV2: INVALID_PLATFORM_FEE");
        
        emit DefaultPlatformFeeChanged(defaultPlatformFee, _platformFee);
        defaultPlatformFee = _platformFee;
    }
    
    function setDefaultRecoverer(address _recoverer) external onlyOwner {
        emit DefaultRecovererChanged(defaultRecoverer, _recoverer);
        defaultRecoverer = _recoverer;
    }
    
    function setSwapFeeForPair(address _pair, uint _swapFee) external onlyOwner {
        IVexchangeV2Pair(_pair).setSwapFee(_swapFee);
    }
    
    function setPlatformFeeForPair(address _pair, uint _platformFee) external onlyOwner {
        IVexchangeV2Pair(_pair).setPlatformFee(_platformFee);
    }
    
    function setRecovererForPair(address _pair, address _recoverer) external onlyOwner {
        IVexchangeV2Pair(_pair).setRecoverer(_recoverer);
    }
}
