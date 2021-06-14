pragma solidity =0.6.6;

import './ext-v2-core/IVexchangeV2Factory.sol';
import './ext-lib/TransferHelper.sol';

import './interfaces/IVexchangeV2Router02.sol';
import './libraries/VexchangeV2Library.sol';
import './libraries/SafeMath.sol';
import './interfaces/IERC20.sol';
import './interfaces/IVVET.sol';

contract VexchangeV2Router02 is IVexchangeV2Router02 {
    using SafeMath for uint;

    address public immutable override factory;
    address public immutable override VVET;

    modifier ensure(uint deadline) {
        require(deadline >= block.timestamp, 'VexchangeV2Router: EXPIRED');
        _;
    }

    constructor(address _factory, address _VVET) public {
        factory = _factory;
        VVET = _VVET;
    }

    receive() external payable {
        assert(msg.sender == VVET); // only accept VET via fallback from the VVET contract
    }

    // **** ADD LIQUIDITY ****
    function _addLiquidity(
        address tokenA,
        address tokenB,
        uint amountADesired,
        uint amountBDesired,
        uint amountAMin,
        uint amountBMin
    ) internal virtual returns (uint amountA, uint amountB) {
        // create the pair if it doesn't exist yet
        if (IVexchangeV2Factory(factory).getPair(tokenA, tokenB) == address(0)) {
            IVexchangeV2Factory(factory).createPair(tokenA, tokenB);
        }
        (uint reserveA, uint reserveB) = VexchangeV2Library.getReserves(factory, tokenA, tokenB);
        if (reserveA == 0 && reserveB == 0) {
            (amountA, amountB) = (amountADesired, amountBDesired);
        } else {
            uint amountBOptimal = VexchangeV2Library.quote(amountADesired, reserveA, reserveB);
            if (amountBOptimal <= amountBDesired) {
                require(amountBOptimal >= amountBMin, 'VexchangeV2Router: INSUFFICIENT_B_AMOUNT');
                (amountA, amountB) = (amountADesired, amountBOptimal);
            } else {
                uint amountAOptimal = VexchangeV2Library.quote(amountBDesired, reserveB, reserveA);
                assert(amountAOptimal <= amountADesired);
                require(amountAOptimal >= amountAMin, 'VexchangeV2Router: INSUFFICIENT_A_AMOUNT');
                (amountA, amountB) = (amountAOptimal, amountBDesired);
            }
        }
    }
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint amountADesired,
        uint amountBDesired,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) external virtual override ensure(deadline) returns (uint amountA, uint amountB, uint liquidity) {
        (amountA, amountB) = _addLiquidity(tokenA, tokenB, amountADesired, amountBDesired, amountAMin, amountBMin);
        address pair = VexchangeV2Library.pairFor(factory, tokenA, tokenB);
        TransferHelper.safeTransferFrom(tokenA, msg.sender, pair, amountA);
        TransferHelper.safeTransferFrom(tokenB, msg.sender, pair, amountB);
        liquidity = IVexchangeV2Pair(pair).mint(to);
    }
    function addLiquidityVET(
        address token,
        uint amountTokenDesired,
        uint amountTokenMin,
        uint amountVETMin,
        address to,
        uint deadline
    ) external virtual override payable ensure(deadline) returns (uint amountToken, uint amountVET, uint liquidity) {
        (amountToken, amountVET) = _addLiquidity(
            token,
            VVET,
            amountTokenDesired,
            msg.value,
            amountTokenMin,
            amountVETMin
        );
        address pair = VexchangeV2Library.pairFor(factory, token, VVET);
        TransferHelper.safeTransferFrom(token, msg.sender, pair, amountToken);
        IVVET(VVET).deposit{value: amountVET}();
        assert(IVVET(VVET).transfer(pair, amountVET));
        liquidity = IVexchangeV2Pair(pair).mint(to);
        // refund dust eth, if any
        if (msg.value > amountVET) TransferHelper.safeTransferVET(msg.sender, msg.value - amountVET);
    }

    // **** REMOVE LIQUIDITY ****
    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint liquidity,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) public virtual override ensure(deadline) returns (uint amountA, uint amountB) {
        address pair = VexchangeV2Library.pairFor(factory, tokenA, tokenB);
        IVexchangeV2Pair(pair).transferFrom(msg.sender, pair, liquidity); // send liquidity to pair
        (uint amount0, uint amount1) = IVexchangeV2Pair(pair).burn(to);
        (address token0,) = VexchangeV2Library.sortTokens(tokenA, tokenB);
        (amountA, amountB) = tokenA == token0 ? (amount0, amount1) : (amount1, amount0);
        require(amountA >= amountAMin, 'VexchangeV2Router: INSUFFICIENT_A_AMOUNT');
        require(amountB >= amountBMin, 'VexchangeV2Router: INSUFFICIENT_B_AMOUNT');
    }
    function removeLiquidityVET(
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountVETMin,
        address to,
        uint deadline
    ) public virtual override ensure(deadline) returns (uint amountToken, uint amountVET) {
        (amountToken, amountVET) = removeLiquidity(
            token,
            VVET,
            liquidity,
            amountTokenMin,
            amountVETMin,
            address(this),
            deadline
        );
        TransferHelper.safeTransfer(token, to, amountToken);
        IVVET(VVET).withdraw(amountVET);
        TransferHelper.safeTransferVET(to, amountVET);
    }
    function removeLiquidityWithPermit(
        address tokenA,
        address tokenB,
        uint liquidity,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline,
        bool approveMax, uint8 v, bytes32 r, bytes32 s
    ) external virtual override returns (uint amountA, uint amountB) {
        address pair = VexchangeV2Library.pairFor(factory, tokenA, tokenB);
        uint value = approveMax ? uint(-1) : liquidity;
        IVexchangeV2Pair(pair).permit(msg.sender, address(this), value, deadline, v, r, s);
        (amountA, amountB) = removeLiquidity(tokenA, tokenB, liquidity, amountAMin, amountBMin, to, deadline);
    }
    function removeLiquidityVETWithPermit(
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountVETMin,
        address to,
        uint deadline,
        bool approveMax, uint8 v, bytes32 r, bytes32 s
    ) external virtual override returns (uint amountToken, uint amountVET) {
        address pair = VexchangeV2Library.pairFor(factory, token, VVET);
        uint value = approveMax ? uint(-1) : liquidity;
        IVexchangeV2Pair(pair).permit(msg.sender, address(this), value, deadline, v, r, s);
        (amountToken, amountVET) = removeLiquidityVET(token, liquidity, amountTokenMin, amountVETMin, to, deadline);
    }

    // **** REMOVE LIQUIDITY (supporting fee-on-transfer tokens) ****
    function removeLiquidityVETSupportingFeeOnTransferTokens(
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountVETMin,
        address to,
        uint deadline
    ) public virtual override ensure(deadline) returns (uint amountVET) {
        (, amountVET) = removeLiquidity(
            token,
            VVET,
            liquidity,
            amountTokenMin,
            amountVETMin,
            address(this),
            deadline
        );
        TransferHelper.safeTransfer(token, to, IERC20(token).balanceOf(address(this)));
        IVVET(VVET).withdraw(amountVET);
        TransferHelper.safeTransferVET(to, amountVET);
    }
    function removeLiquidityVETWithPermitSupportingFeeOnTransferTokens(
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountVETMin,
        address to,
        uint deadline,
        bool approveMax, uint8 v, bytes32 r, bytes32 s
    ) external virtual override returns (uint amountVET) {
        address pair = VexchangeV2Library.pairFor(factory, token, VVET);
        uint value = approveMax ? uint(-1) : liquidity;
        IVexchangeV2Pair(pair).permit(msg.sender, address(this), value, deadline, v, r, s);
        amountVET = removeLiquidityVETSupportingFeeOnTransferTokens(
            token, liquidity, amountTokenMin, amountVETMin, to, deadline
        );
    }

    // **** SWAP ****
    // requires the initial amount to have already been sent to the first pair
    function _swap(uint[] memory amounts, address[] memory path, address _to) internal virtual {
        for (uint i; i < path.length - 1; i++) {
            (address input, address output) = (path[i], path[i + 1]);
            (address token0,) = VexchangeV2Library.sortTokens(input, output);
            uint amountOut = amounts[i + 1];
            (uint amount0Out, uint amount1Out) = input == token0 ? (uint(0), amountOut) : (amountOut, uint(0));
            address to = i < path.length - 2 ? VexchangeV2Library.pairFor(factory, output, path[i + 2]) : _to;
            IVexchangeV2Pair(VexchangeV2Library.pairFor(factory, input, output)).swap(
                amount0Out, amount1Out, to, new bytes(0)
            );
        }
    }
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external virtual override ensure(deadline) returns (uint[] memory amounts) {
        amounts = VexchangeV2Library.getAmountsOut(factory, amountIn, path);
        require(amounts[amounts.length - 1] >= amountOutMin, 'VexchangeV2Router: INSUFFICIENT_OUTPUT_AMOUNT');
        TransferHelper.safeTransferFrom(
            path[0], msg.sender, VexchangeV2Library.pairFor(factory, path[0], path[1]), amounts[0]
        );
        _swap(amounts, path, to);
    }
    function swapTokensForExactTokens(
        uint amountOut,
        uint amountInMax,
        address[] calldata path,
        address to,
        uint deadline
    ) external virtual override ensure(deadline) returns (uint[] memory amounts) {
        amounts = VexchangeV2Library.getAmountsIn(factory, amountOut, path);
        require(amounts[0] <= amountInMax, 'VexchangeV2Router: EXCESSIVE_INPUT_AMOUNT');
        TransferHelper.safeTransferFrom(
            path[0], msg.sender, VexchangeV2Library.pairFor(factory, path[0], path[1]), amounts[0]
        );
        _swap(amounts, path, to);
    }
    function swapExactVETForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline)
        external
        virtual
        override
        payable
        ensure(deadline)
        returns (uint[] memory amounts)
    {
        require(path[0] == VVET, 'VexchangeV2Router: INVALID_PATH');
        amounts = VexchangeV2Library.getAmountsOut(factory, msg.value, path);
        require(amounts[amounts.length - 1] >= amountOutMin, 'VexchangeV2Router: INSUFFICIENT_OUTPUT_AMOUNT');
        IVVET(VVET).deposit{value: amounts[0]}();
        assert(IVVET(VVET).transfer(VexchangeV2Library.pairFor(factory, path[0], path[1]), amounts[0]));
        _swap(amounts, path, to);
    }
    function swapTokensForExactVET(uint amountOut, uint amountInMax, address[] calldata path, address to, uint deadline)
        external
        virtual
        override
        ensure(deadline)
        returns (uint[] memory amounts)
    {
        require(path[path.length - 1] == VVET, 'VexchangeV2Router: INVALID_PATH');
        amounts = VexchangeV2Library.getAmountsIn(factory, amountOut, path);
        require(amounts[0] <= amountInMax, 'VexchangeV2Router: EXCESSIVE_INPUT_AMOUNT');
        TransferHelper.safeTransferFrom(
            path[0], msg.sender, VexchangeV2Library.pairFor(factory, path[0], path[1]), amounts[0]
        );
        _swap(amounts, path, address(this));
        IVVET(VVET).withdraw(amounts[amounts.length - 1]);
        TransferHelper.safeTransferVET(to, amounts[amounts.length - 1]);
    }
    function swapExactTokensForVET(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline)
        external
        virtual
        override
        ensure(deadline)
        returns (uint[] memory amounts)
    {
        require(path[path.length - 1] == VVET, 'VexchangeV2Router: INVALID_PATH');
        amounts = VexchangeV2Library.getAmountsOut(factory, amountIn, path);
        require(amounts[amounts.length - 1] >= amountOutMin, 'VexchangeV2Router: INSUFFICIENT_OUTPUT_AMOUNT');
        TransferHelper.safeTransferFrom(
            path[0], msg.sender, VexchangeV2Library.pairFor(factory, path[0], path[1]), amounts[0]
        );
        _swap(amounts, path, address(this));
        IVVET(VVET).withdraw(amounts[amounts.length - 1]);
        TransferHelper.safeTransferVET(to, amounts[amounts.length - 1]);
    }
    function swapVETForExactTokens(uint amountOut, address[] calldata path, address to, uint deadline)
        external
        virtual
        override
        payable
        ensure(deadline)
        returns (uint[] memory amounts)
    {
        require(path[0] == VVET, 'VexchangeV2Router: INVALID_PATH');
        amounts = VexchangeV2Library.getAmountsIn(factory, amountOut, path);
        require(amounts[0] <= msg.value, 'VexchangeV2Router: EXCESSIVE_INPUT_AMOUNT');
        IVVET(VVET).deposit{value: amounts[0]}();
        assert(IVVET(VVET).transfer(VexchangeV2Library.pairFor(factory, path[0], path[1]), amounts[0]));
        _swap(amounts, path, to);
        // refund dust eth, if any
        if (msg.value > amounts[0]) TransferHelper.safeTransferVET(msg.sender, msg.value - amounts[0]);
    }

    // **** SWAP (supporting fee-on-transfer tokens) ****
    // requires the initial amount to have already been sent to the first pair
    function _swapSupportingFeeOnTransferTokens(address[] memory path, address _to) internal virtual {
        for (uint i; i < path.length - 1; i++) {
            (address input, address output) = (path[i], path[i + 1]);
            (address token0,) = VexchangeV2Library.sortTokens(input, output);
            IVexchangeV2Pair pair = IVexchangeV2Pair(VexchangeV2Library.pairFor(factory, input, output));
            uint amountInput;
            uint amountOutput;
            { // scope to avoid stack too deep errors
            (uint reserve0, uint reserve1,) = pair.getReserves();
            (uint reserveInput, uint reserveOutput) = input == token0 ? (reserve0, reserve1) : (reserve1, reserve0);
            amountInput = IERC20(input).balanceOf(address(pair)).sub(reserveInput);
            amountOutput = VexchangeV2Library.getAmountOut(amountInput, reserveInput, reserveOutput, pair.swapFee());
            }
            (uint amount0Out, uint amount1Out) = input == token0 ? (uint(0), amountOutput) : (amountOutput, uint(0));
            address to = i < path.length - 2 ? VexchangeV2Library.pairFor(factory, output, path[i + 2]) : _to;
            pair.swap(amount0Out, amount1Out, to, new bytes(0));
        }
    }
    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external virtual override ensure(deadline) {
        TransferHelper.safeTransferFrom(
            path[0], msg.sender, VexchangeV2Library.pairFor(factory, path[0], path[1]), amountIn
        );
        uint balanceBefore = IERC20(path[path.length - 1]).balanceOf(to);
        _swapSupportingFeeOnTransferTokens(path, to);
        require(
            IERC20(path[path.length - 1]).balanceOf(to).sub(balanceBefore) >= amountOutMin,
            'VexchangeV2Router: INSUFFICIENT_OUTPUT_AMOUNT'
        );
    }
    function swapExactVETForTokensSupportingFeeOnTransferTokens(
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    )
        external
        virtual
        override
        payable
        ensure(deadline)
    {
        require(path[0] == VVET, 'VexchangeV2Router: INVALID_PATH');
        uint amountIn = msg.value;
        IVVET(VVET).deposit{value: amountIn}();
        assert(IVVET(VVET).transfer(VexchangeV2Library.pairFor(factory, path[0], path[1]), amountIn));
        uint balanceBefore = IERC20(path[path.length - 1]).balanceOf(to);
        _swapSupportingFeeOnTransferTokens(path, to);
        require(
            IERC20(path[path.length - 1]).balanceOf(to).sub(balanceBefore) >= amountOutMin,
            'VexchangeV2Router: INSUFFICIENT_OUTPUT_AMOUNT'
        );
    }
    function swapExactTokensForVETSupportingFeeOnTransferTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    )
        external
        virtual
        override
        ensure(deadline)
    {
        require(path[path.length - 1] == VVET, 'VexchangeV2Router: INVALID_PATH');
        TransferHelper.safeTransferFrom(
            path[0], msg.sender, VexchangeV2Library.pairFor(factory, path[0], path[1]), amountIn
        );
        _swapSupportingFeeOnTransferTokens(path, address(this));
        uint amountOut = IERC20(VVET).balanceOf(address(this));
        require(amountOut >= amountOutMin, 'VexchangeV2Router: INSUFFICIENT_OUTPUT_AMOUNT');
        IVVET(VVET).withdraw(amountOut);
        TransferHelper.safeTransferVET(to, amountOut);
    }

    // **** LIBRARY FUNCTIONS ****
    function quote(uint amountA, uint reserveA, uint reserveB) public pure virtual override returns (uint amountB) {
        return VexchangeV2Library.quote(amountA, reserveA, reserveB);
    }

    function getAmountOut(uint amountIn, uint reserveIn, uint reserveOut, uint swapFee)
        public
        pure
        virtual
        override
        returns (uint amountOut)
    {
        return VexchangeV2Library.getAmountOut(amountIn, reserveIn, reserveOut, swapFee);
    }

    function getAmountIn(uint amountOut, uint reserveIn, uint reserveOut, uint swapFee)
        public
        pure
        virtual
        override
        returns (uint amountIn)
    {
        return VexchangeV2Library.getAmountIn(amountOut, reserveIn, reserveOut, swapFee);
    }

    function getAmountsOut(uint amountIn, address[] memory path)
        public
        view
        virtual
        override
        returns (uint[] memory amounts)
    {
        return VexchangeV2Library.getAmountsOut(factory, amountIn, path);
    }

    function getAmountsIn(uint amountOut, address[] memory path)
        public
        view
        virtual
        override
        returns (uint[] memory amounts)
    {
        return VexchangeV2Library.getAmountsIn(factory, amountOut, path);
    }
}
