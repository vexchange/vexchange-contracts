pragma solidity >=0.5.0;

import '../ext-v2-core/IVexchangeV2Pair.sol';
import '../ext-v2-core/IVexchangeV2Factory.sol';
import '../ext-lib/Babylonian.sol';
import '../ext-lib/FullMath.sol';

import './SafeMath.sol';
import './VexchangeV2Library.sol';

// library containing some math for dealing with the liquidity shares of a pair, e.g. computing their exact value
// in terms of the underlying tokens
library VexchangeV2LiquidityMathLibrary {
    using SafeMath for uint256;

    uint256 public constant ACCURACY         = 10e37;
    uint256 public constant SQUARED_ACCURACY = 10e75;
    uint256 public constant FEE_ACCURACY     = 10_000;

    // computes the direction and magnitude of the profit-maximizing trade
    function computeProfitMaximizingTrade(
        uint256 truePriceTokenA,
        uint256 truePriceTokenB,
        uint256 reserveA,
        uint256 reserveB,
        uint256 swapFee
    ) pure internal returns (bool aToB, uint256 amountIn) {
        aToB = FullMath.mulDiv(reserveA, truePriceTokenB, reserveB) < truePriceTokenA;

        uint256 invariant = reserveA.mul(reserveB);

        uint256 leftSide = Babylonian.sqrt(
            FullMath.mulDiv(
                invariant.mul(10000),
                aToB ? truePriceTokenA : truePriceTokenB,
                (aToB ? truePriceTokenB : truePriceTokenA).mul(10000 - swapFee) 
            )
        );
        uint256 rightSide = (aToB ? reserveA.mul(10000) : reserveB.mul(10000)) / (10000 - swapFee);

        if (leftSide < rightSide) return (false, 0);

        // compute the amount that must be sent to move the price to the profit-maximizing price
        amountIn = leftSide.sub(rightSide);
    }

    // gets the reserves after an arbitrage moves the price to the profit-maximizing ratio given an externally observed true price
    function getReservesAfterArbitrage(
        address factory,
        address tokenA,
        address tokenB,
        uint256 truePriceTokenA,
        uint256 truePriceTokenB
    ) view internal returns (uint256 reserveA, uint256 reserveB) {
        // first get reserves before the swap
        (reserveA, reserveB) = VexchangeV2Library.getReserves(factory, tokenA, tokenB);

        require(reserveA > 0 && reserveB > 0, 'VexchangeV2ArbitrageLibrary: ZERO_PAIR_RESERVES');

        uint swapFee = VexchangeV2Library.getSwapFee(factory, tokenA, tokenB);

        // then compute how much to swap to arb to the true price
        (bool aToB, uint256 amountIn) = computeProfitMaximizingTrade(truePriceTokenA, truePriceTokenB, reserveA, reserveB, swapFee);

        if (amountIn == 0) {
            return (reserveA, reserveB);
        }

        // now affect the trade to the reserves
        if (aToB) {
            uint amountOut = VexchangeV2Library.getAmountOut(amountIn, reserveA, reserveB, swapFee);
            reserveA += amountIn;
            reserveB -= amountOut;
        } else {
            uint amountOut = VexchangeV2Library.getAmountOut(amountIn, reserveB, reserveA, swapFee);
            reserveB += amountIn;
            reserveA -= amountOut;
        }
    }

    // computes liquidity value given all the parameters of the pair
    function computeLiquidityValue(
        uint256 reservesA,
        uint256 reservesB,
        uint256 totalSupply,
        uint256 liquidityAmount,
        uint256 platformFee,
        uint kLast
    ) internal pure returns (uint256 tokenAAmount, uint256 tokenBAmount) {
        if (platformFee > 0 && kLast > 0) {
            uint sqrtNewK = Babylonian.sqrt(reservesA.mul(reservesB));
            uint sqrtOldK = Babylonian.sqrt(kLast);
            if (sqrtNewK > sqrtOldK) {
                uint256 _scaledGrowth = sqrtNewK.mul(ACCURACY) / sqrtOldK;                            
                uint256 _scaledMultiplier = ACCURACY.sub(SQUARED_ACCURACY / _scaledGrowth);         
                uint256 _scaledTargetOwnership = _scaledMultiplier.mul(platformFee) / FEE_ACCURACY; 
                
                uint feeLiquidity = _scaledTargetOwnership.mul(totalSupply) / ACCURACY.sub(_scaledTargetOwnership); 
                totalSupply = totalSupply.add(feeLiquidity);
            }
        }
        return (reservesA.mul(liquidityAmount) / totalSupply, reservesB.mul(liquidityAmount) / totalSupply);
    }

    // get all current parameters from the pair and compute value of a liquidity amount
    // **note this is subject to manipulation, e.g. sandwich attacks**. prefer passing a manipulation resistant price to
    // #getLiquidityValueAfterArbitrageToPrice
    function getLiquidityValue(
        address factory,
        address tokenA,
        address tokenB,
        uint256 liquidityAmount
    ) internal view returns (uint256 tokenAAmount, uint256 tokenBAmount) {
        (uint256 reservesA, uint256 reservesB) = VexchangeV2Library.getReserves(factory, tokenA, tokenB);
        IVexchangeV2Pair pair = IVexchangeV2Pair(VexchangeV2Library.pairFor(factory, tokenA, tokenB));

        uint platformFee = pair.platformFee();
        uint kLast = (platformFee > 0) ? pair.kLast() : 0;
        uint totalSupply = pair.totalSupply();
        return computeLiquidityValue(reservesA, reservesB, totalSupply, liquidityAmount, platformFee, kLast);
    }

    // given two tokens, tokenA and tokenB, and their "true price", i.e. the observed ratio of value of token A to token B,
    // and a liquidity amount, returns the value of the liquidity in terms of tokenA and tokenB
    function getLiquidityValueAfterArbitrageToPrice(
        address factory,
        address tokenA,
        address tokenB,
        uint256 truePriceTokenA,
        uint256 truePriceTokenB,
        uint256 liquidityAmount
    ) internal view returns (
        uint256 tokenAAmount,
        uint256 tokenBAmount
    ) {        
        IVexchangeV2Pair pair = IVexchangeV2Pair(VexchangeV2Library.pairFor(factory, tokenA, tokenB));
        uint platformFee = pair.platformFee();
        uint kLast = (platformFee > 0) ? pair.kLast() : 0;
        uint totalSupply = pair.totalSupply();

        // this also checks that totalSupply > 0
        require(totalSupply >= liquidityAmount && liquidityAmount > 0, 'ComputeLiquidityValue: LIQUIDITY_AMOUNT');

        (uint reservesA, uint reservesB) = getReservesAfterArbitrage(factory, tokenA, tokenB, truePriceTokenA, truePriceTokenB);

        return computeLiquidityValue(reservesA, reservesB, totalSupply, liquidityAmount, platformFee, kLast);
    }
}
