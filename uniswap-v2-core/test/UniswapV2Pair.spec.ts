import chai, { assert, expect } from 'chai'
import {Contract, constants} from 'ethers'
import { solidity, MockProvider, createFixtureLoader } from 'ethereum-waffle'
import { BigNumber, bigNumberify, SupportedAlgorithms } from 'ethers/utils'

import { expandTo18Decimals, mineBlock, encodePrice, MAX_UINT_256, MAX_UINT_128, MAX_UINT_112, bigNumberSqrt, closeTo } from './shared/utilities'
import { pairFixture } from './shared/fixtures'
import { AddressZero } from 'ethers/constants'

const MINIMUM_LIQUIDITY = bigNumberify(10).pow(3)

chai.use(solidity)

const overrides = {
  gasLimit: 9999999
}

describe('UniswapV2Pair', () => {
  const provider = new MockProvider({
    hardfork: 'constantinople',
    mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
    gasLimit: 9999999
  })
  const [wallet, other] = provider.getWallets()
  const loadFixture = createFixtureLoader(provider, [wallet])

  let factory: Contract
  let token0: Contract
  let token1: Contract
  let pair: Contract
  beforeEach(async () => {
    const fixture = await loadFixture(pairFixture)
    factory = fixture.factory
    token0 = fixture.token0
    token1 = fixture.token1
    pair = fixture.pair
  })

  it('mint', async () => {
    const token0Amount = expandTo18Decimals(1)
    const token1Amount = expandTo18Decimals(4)
    await token0.transfer(pair.address, token0Amount)
    await token1.transfer(pair.address, token1Amount)

    const expectedLiquidity = expandTo18Decimals(2)
    await expect(pair.mint(wallet.address, overrides))
      .to.emit(pair, 'Transfer')
      .withArgs(AddressZero, AddressZero, MINIMUM_LIQUIDITY)
      .to.emit(pair, 'Transfer')
      .withArgs(AddressZero, wallet.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
      .to.emit(pair, 'Sync')
      .withArgs(token0Amount, token1Amount)
      .to.emit(pair, 'Mint')
      .withArgs(wallet.address, token0Amount, token1Amount)

    expect(await pair.totalSupply()).to.eq(expectedLiquidity)
    expect(await pair.balanceOf(wallet.address)).to.eq(expectedLiquidity.sub(MINIMUM_LIQUIDITY))
    expect(await token0.balanceOf(pair.address)).to.eq(token0Amount)
    expect(await token1.balanceOf(pair.address)).to.eq(token1Amount)
    const reserves = await pair.getReserves()
    expect(reserves[0]).to.eq(token0Amount)
    expect(reserves[1]).to.eq(token1Amount)
  })

  async function addLiquidity(token0Amount: BigNumber, token1Amount: BigNumber) {
    await token0.transfer(pair.address, token0Amount)
    await token1.transfer(pair.address, token1Amount)
    await pair.mint(wallet.address, overrides)
  }
  const swapTestCases: BigNumber[][] = [
    [1, 5, 10, '1662497915624478906'],
    [1, 10, 5, '453305446940074565'],

    [2, 5, 10, '2851015155847869602'],
    [2, 10, 5, '831248957812239453'],

    [1, 10, 10, '906610893880149131'],
    [1, 100, 100, '987158034397061298'],
    [1, 1000, 1000, '996006981039903216']
  ].map(a => a.map(n => (typeof n === 'string' ? bigNumberify(n) : expandTo18Decimals(n))))
  swapTestCases.forEach((swapTestCase, i) => {
    it(`getInputPrice:${i}`, async () => {
      const [swapAmount, token0Amount, token1Amount, expectedOutputAmount] = swapTestCase
      await addLiquidity(token0Amount, token1Amount)
      await token0.transfer(pair.address, swapAmount)
      await expect(pair.swap(0, expectedOutputAmount.add(1), wallet.address, '0x', overrides)).to.be.revertedWith(
        'UniswapV2: K'
      )
      await pair.swap(0, expectedOutputAmount, wallet.address, '0x', overrides)
    })
  })

  const optimisticTestCases: BigNumber[][] = [
    ['997000000000000000', 5, 10, 1], // given amountIn, amountOut = floor(amountIn * .997)
    ['997000000000000000', 10, 5, 1],
    ['997000000000000000', 5, 5, 1],
    [1, 5, 5, '1003009027081243732'] // given amountOut, amountIn = ceiling(amountOut / .997)
  ].map(a => a.map(n => (typeof n === 'string' ? bigNumberify(n) : expandTo18Decimals(n))))
  optimisticTestCases.forEach((optimisticTestCase, i) => {
 
    it(`optimistic:${i}`, async () => {
      // Ensure the the swap fee is set to 0.3% (per assumptions in data-set above)
      await factory.setSwapFeeForPair( pair.address, 30 );

      // Ensure the platform fee is zero (equiv to original uniswap 'feeTo' off)
      await factory.setPlatformFeeForPair( pair.address, 0 );

      const [outputAmount, token0Amount, token1Amount, inputAmount] = optimisticTestCase
      await addLiquidity(token0Amount, token1Amount)
      await token0.transfer(pair.address, inputAmount)
      await expect(pair.swap(outputAmount.add(1), 0, wallet.address, '0x', overrides)).to.be.revertedWith(
        'UniswapV2: K'
      )
      await pair.swap(outputAmount, 0, wallet.address, '0x', overrides)
    })
  })

  it('swap:token0', async () => {
    const token0Amount = expandTo18Decimals(5)
    const token1Amount = expandTo18Decimals(10)
    await addLiquidity(token0Amount, token1Amount)

    const swapAmount = expandTo18Decimals(1)
    const expectedOutputAmount = bigNumberify('1662497915624478906')
    await token0.transfer(pair.address, swapAmount)
    await expect(pair.swap(0, expectedOutputAmount, wallet.address, '0x', overrides))
      .to.emit(token1, 'Transfer')
      .withArgs(pair.address, wallet.address, expectedOutputAmount)
      .to.emit(pair, 'Sync')
      .withArgs(token0Amount.add(swapAmount), token1Amount.sub(expectedOutputAmount))
      .to.emit(pair, 'Swap')
      .withArgs(wallet.address, swapAmount, 0, 0, expectedOutputAmount, wallet.address)

    const reserves = await pair.getReserves()
    expect(reserves[0]).to.eq(token0Amount.add(swapAmount))
    expect(reserves[1]).to.eq(token1Amount.sub(expectedOutputAmount))
    expect(await token0.balanceOf(pair.address)).to.eq(token0Amount.add(swapAmount))
    expect(await token1.balanceOf(pair.address)).to.eq(token1Amount.sub(expectedOutputAmount))
    const totalSupplyToken0 = await token0.totalSupply()
    const totalSupplyToken1 = await token1.totalSupply()
    expect(await token0.balanceOf(wallet.address)).to.eq(totalSupplyToken0.sub(token0Amount).sub(swapAmount))
    expect(await token1.balanceOf(wallet.address)).to.eq(totalSupplyToken1.sub(token1Amount).add(expectedOutputAmount))
  })

  it('swap:token1', async () => {
    const token0Amount = expandTo18Decimals(5)
    const token1Amount = expandTo18Decimals(10)
    await addLiquidity(token0Amount, token1Amount)

    const swapAmount = expandTo18Decimals(1)
    const expectedOutputAmount = bigNumberify('453305446940074565')
    await token1.transfer(pair.address, swapAmount)
    await expect(pair.swap(expectedOutputAmount, 0, wallet.address, '0x', overrides))
      .to.emit(token0, 'Transfer')
      .withArgs(pair.address, wallet.address, expectedOutputAmount)
      .to.emit(pair, 'Sync')
      .withArgs(token0Amount.sub(expectedOutputAmount), token1Amount.add(swapAmount))
      .to.emit(pair, 'Swap')
      .withArgs(wallet.address, 0, swapAmount, expectedOutputAmount, 0, wallet.address)

    const reserves = await pair.getReserves()
    expect(reserves[0]).to.eq(token0Amount.sub(expectedOutputAmount))
    expect(reserves[1]).to.eq(token1Amount.add(swapAmount))
    expect(await token0.balanceOf(pair.address)).to.eq(token0Amount.sub(expectedOutputAmount))
    expect(await token1.balanceOf(pair.address)).to.eq(token1Amount.add(swapAmount))
    const totalSupplyToken0 = await token0.totalSupply()
    const totalSupplyToken1 = await token1.totalSupply()
    expect(await token0.balanceOf(wallet.address)).to.eq(totalSupplyToken0.sub(token0Amount).add(expectedOutputAmount))
    expect(await token1.balanceOf(wallet.address)).to.eq(totalSupplyToken1.sub(token1Amount).sub(swapAmount))
  })

  it('swap:gas', async () => {
    const token0Amount = expandTo18Decimals(5)
    const token1Amount = expandTo18Decimals(10)
    await addLiquidity(token0Amount, token1Amount)

    // ensure that setting price{0,1}CumulativeLast for the first time doesn't affect our gas math
    await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
    await pair.sync(overrides)

    const swapAmount = expandTo18Decimals(1)
    const expectedOutputAmount = bigNumberify('453305446940074565')
    await token1.transfer(pair.address, swapAmount)
    await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
    const tx = await pair.swap(expectedOutputAmount, 0, wallet.address, '0x', overrides)
    const receipt = await tx.wait()

    // Hard-coded gas cost based on current extension
    expect(receipt.gasUsed).to.eq(67219)
  })

  it('burn', async () => {
    const token0Amount = expandTo18Decimals(3)
    const token1Amount = expandTo18Decimals(3)
    await addLiquidity(token0Amount, token1Amount)

    const expectedLiquidity = expandTo18Decimals(3)
    await pair.transfer(pair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
    await expect(pair.burn(wallet.address, overrides))
      .to.emit(pair, 'Transfer')
      .withArgs(pair.address, AddressZero, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
      .to.emit(token0, 'Transfer')
      .withArgs(pair.address, wallet.address, token0Amount.sub(1000))
      .to.emit(token1, 'Transfer')
      .withArgs(pair.address, wallet.address, token1Amount.sub(1000))
      .to.emit(pair, 'Sync')
      .withArgs(1000, 1000)
      .to.emit(pair, 'Burn')
      .withArgs(wallet.address, token0Amount.sub(1000), token1Amount.sub(1000), wallet.address)

    expect(await pair.balanceOf(wallet.address)).to.eq(0)
    expect(await pair.totalSupply()).to.eq(MINIMUM_LIQUIDITY)
    expect(await token0.balanceOf(pair.address)).to.eq(1000)
    expect(await token1.balanceOf(pair.address)).to.eq(1000)
    const totalSupplyToken0 = await token0.totalSupply()
    const totalSupplyToken1 = await token1.totalSupply()
    expect(await token0.balanceOf(wallet.address)).to.eq(totalSupplyToken0.sub(1000))
    expect(await token1.balanceOf(wallet.address)).to.eq(totalSupplyToken1.sub(1000))
  })

  it('price{0,1}CumulativeLast', async () => {
    const token0Amount = expandTo18Decimals(3)
    const token1Amount = expandTo18Decimals(3)
    await addLiquidity(token0Amount, token1Amount)

    const blockTimestamp = (await pair.getReserves())[2]
    await mineBlock(provider, blockTimestamp + 1)
    await pair.sync(overrides)

    const initialPrice = encodePrice(token0Amount, token1Amount)
    expect(await pair.price0CumulativeLast(), "Initial price 0").to.eq(initialPrice[0])
    expect(await pair.price1CumulativeLast(), "Initial price 1").to.eq(initialPrice[1])
    expect((await pair.getReserves())[2], "Initial price timestamp").to.eq(blockTimestamp + 1)

    const swapAmount = expandTo18Decimals(3)
    await token0.transfer(pair.address, swapAmount)
    await mineBlock(provider, blockTimestamp + 10)
    // swap to a new price eagerly instead of syncing
    await pair.swap(0, expandTo18Decimals(1), wallet.address, '0x', overrides) // make the price nice

    expect(await pair.price0CumulativeLast(), "Price 0 post swap").to.eq(initialPrice[0].mul(10))
    expect(await pair.price1CumulativeLast(), "Price 1 post swap").to.eq(initialPrice[1].mul(10))
    expect((await pair.getReserves())[2], "Post swap timestamp").to.eq(blockTimestamp + 10)

    await mineBlock(provider, blockTimestamp + 20)
    await pair.sync(overrides)

    const newPrice = encodePrice(expandTo18Decimals(6), expandTo18Decimals(2))
    expect(await pair.price0CumulativeLast(), "Price 0 post sync").to.eq(initialPrice[0].mul(10).add(newPrice[0].mul(10)))
    expect(await pair.price1CumulativeLast(), "Price 1 post sync").to.eq(initialPrice[1].mul(10).add(newPrice[1].mul(10)))
    expect((await pair.getReserves())[2], "Price 0 post sync").to.eq(blockTimestamp + 20)
  })

  /**
   * calcSwapWithdraw
   * Returns the maximum withdrawl amount, based on the input amount and the 
   * pair's (variable) fee. 
   * 
   * Note that this function is deliberately verbose.
   *
   * @param {number} aSwapFee The current swap-fee for the pair.
   * @param {BigNumber} aSwapAmount The amount being swapped.
   * @param {BigNumber} aToken0Balance The current balance of token-0 in the pair.
   * @param {BigNumber} aToken1Balance The current balance of token-1 in the pair.
   * @return {number} The max swapped amount to withdraw..
   */
  function calcSwapWithdraw( aSwapFee: number, aSwapAmount: BigNumber, 
                            aWithdrawTokenBalance: BigNumber, aDepositTokenBalance: BigNumber ) : BigNumber
  {
    // The pair invariant for the pool
    const pairInvariant: BigNumber = aWithdrawTokenBalance.mul(aDepositTokenBalance)

    // The amount added to the liquidity pool after fees
    const depositAfterFees : BigNumber = aSwapAmount.mul(10000-aSwapFee).div(10000)

    // The new token1 total (add the incoming liquidity)
    const depositTokenAfterDeposit: BigNumber = aDepositTokenBalance.add(depositAfterFees)

    // Using the invariant, calculate the impact on token 0 from the new liquidity
    let maxWithdrawTokenAvail: BigNumber = pairInvariant.div(depositTokenAfterDeposit)

    // Check for rounding error (BigNumber division will floor instead of rounding);
    // If product of token0Impact & token1AfterDeposity is less than invariant, increment the token0Impact.
    if ( pairInvariant.gt( maxWithdrawTokenAvail.mul(depositTokenAfterDeposit) ) )
    maxWithdrawTokenAvail = maxWithdrawTokenAvail.add(1)

    // Calculate the new aWithdrawTokenBalance delta, which is the maximum amount that could be
    // removed and still maintain the invariant
    const maxTokenToWithdraw: BigNumber =  aWithdrawTokenBalance.sub(maxWithdrawTokenAvail)

    return maxTokenToWithdraw 
  } // calcSwapWithdraw

  /**
   * Test the calcSwapWithdraw function defined above, using pre-existing uniswap test-case mappings.
   */
  const calcMaxWithdrawTestCases: BigNumber[][] = [
    [1, 5, 10, '1662497915624478906'],
    [1, 10, 5, '453305446940074565'],
 
    [2, 5, 10, '2851015155847869602'],
    [2, 10, 5, '831248957812239453'],
 
    [1, 10, 10, '906610893880149131'],
    [1, 100, 100, '987158034397061298'],
    [1, 1000, 1000, '996006981039903216']
  ].map(a => a.map(n => (typeof n === 'string' ? bigNumberify(n) : expandTo18Decimals(n))))
  calcMaxWithdrawTestCases.forEach((swapFeeTestCase, i) => {
    it(`calcMaxWithdraw:${i}`, async () => {
      const [swapAmount, depositTokenBalance, withdrawTokenBalance, expectedOutputAmount] = swapFeeTestCase

      expect( calcSwapWithdraw( 30, swapAmount, withdrawTokenBalance, depositTokenBalance ) ).to.eq( expectedOutputAmount )
    })
  })

  /**
   * Platform Fee off baseline case.
   */
  it('platformFeeTo:off', async () => {
    // Ensure the the swap fee is set to 0.3%
    await factory.setSwapFeeForPair( pair.address, 30 );

    // Ensure the platform fee is zero (equiv to original 'feeTo' off)
    await factory.setPlatformFeeForPair( pair.address, 0 );

    const token0Amount = expandTo18Decimals(1000)
    const token1Amount = expandTo18Decimals(1000)
    await addLiquidity(token0Amount, token1Amount)

    // Confirm liquidity is established
    const expectedLiquidity = expandTo18Decimals(1000) // geometric mean of token0Amount and token1Amount
    expect(await pair.totalSupply(), "Initial total supply").to.eq(expectedLiquidity)
    
    const lSwapFee : number = await pair.swapFee()
    const swapAmount = expandTo18Decimals(1)

    let expectedOutputAmount: BigNumber = calcSwapWithdraw( lSwapFee, swapAmount, token0Amount, token1Amount )

    await token1.transfer(pair.address, swapAmount)
    const tx = await pair.swap(expectedOutputAmount, 0, wallet.address, '0x', overrides)
    const receipt = await tx.wait()

    // Gas price seems to be inconsistent for the swap
    expect(receipt.gasUsed).to.satisfy( function(gas: number) {
      return ((gas==56403) || (gas==97219));
    })

    // Drain the liquidity to verify no fee has been extracted on exit
    await pair.transfer(pair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
    await pair.burn(wallet.address, overrides)
    expect(await pair.totalSupply(), "Final total supply").to.eq(MINIMUM_LIQUIDITY)
  })

  
  /**
   * Platform Fee on basic base.
   */
  it('platformFeeTo:on', async () => {
    await factory.setPlatformFeeTo(other.address)

    const testSwapFee: number = 30
    const testPlatformFee: number = 1667

    // Also set the platform fee to
    await factory.setSwapFeeForPair( pair.address, testSwapFee );
    await factory.setPlatformFeeForPair( pair.address, testPlatformFee );

    // Prepare basic liquidity of 10^18 on each token
    const token0Amount = expandTo18Decimals(1000)
    const token1Amount = expandTo18Decimals(1000)    
    await addLiquidity(token0Amount, token1Amount)

    // Confirm liquidity is established
    const expectedLiquidity = expandTo18Decimals(1000) // geometric mean of token0Amount and token1Amount
    expect(await pair.totalSupply(), "Initial total supply").to.eq(expectedLiquidity)

    // Prepare for the swap - send tokens from test account (caller) into the pair
    const swapAmount = expandTo18Decimals(1)
    let expectedOutputAmount: BigNumber = calcSwapWithdraw( testSwapFee, swapAmount, token0Amount, token1Amount )
    await token1.transfer(pair.address, swapAmount)

    // Confirm the token1 balance in the pair, post transfer
    expect(await token1.balanceOf(pair.address), "New token1 balance allocated to pair").to.eq(token1Amount.add(swapAmount))

    // Perform the swap from token 1 to token 0
    const tx = await pair.swap(expectedOutputAmount, 0, wallet.address, '0x', overrides)
    const receipt = await tx.wait()

    // Gas price seems to be inconsistent for the swap; most likely due to test framework. (TBC)
    // Every ~ 1 in 4 runs will see the higher gas cost.
    expect(receipt.gasUsed).to.satisfy( function(gas: number) {
      return ((gas==56403) || (gas==97219));
    })

    const newToken0Balance = await token0.balanceOf(pair.address)
    const newToken1Balance = await token1.balanceOf(pair.address)

    // Now transfer out the maximum liquidity in order to verify the remaining supply & fees etc
    await pair.transfer(pair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
    const burnTx = await pair.burn(wallet.address, overrides)
    const burnReceipt = await burnTx.wait()

    // Gas price seems to be inconsistent for the swap; most likely due to test framework. (TBC)
    // Every ~ 1 in 10 runs will see the higher gas cost.
    expect(burnReceipt.gasUsed, "Check burn op gas cost (expect 159865 or 119049)").to.satisfy( function(gas: number) {
      return ((gas==159865) || (gas==119049));
    })
    
    // Expected fee @ 1/6 or 0.1667% is calculated at 249800449363715 which is a ~0.02% error off the original uniswap.
    // (Original uniswap v2 equivalent ==> 249750499251388)
    const expectedPlatformFee: BigNumber = bigNumberify(249800449363715)

    const expectedTotalSupply: BigNumber = MINIMUM_LIQUIDITY.add(expectedPlatformFee)

    // Check the new total-supply: should be MINIMUM_LIQUIDITY + platform fee
    expect(await pair.totalSupply(), "Total supply").to.eq(expectedTotalSupply)

    // Check that the fee receiver (account set to platformFeeTo) received the fees
    expect(await pair.balanceOf(other.address), "Fee receiver balance").to.eq(expectedPlatformFee)

    // The (inverted) target max variance of 0.02% of Vexchange platform fee to UniswapV2.
    // This variance is due to the max-precision of the platform fee and fee-pricing algorithm; inverted due to integer division math.
    const targetInverseVariance: number = 5000;

    // Verify a +/- 5% range around the variance
    const minInverseVariance: number = targetInverseVariance * 0.95;
    const maxInverseVariance: number = targetInverseVariance * 1.05;

    // Compare 1/6 uniswapV2 fee, using 0.1667 Vexchange Platform fee: run check to confirm ~ 0.02% variance.
    const token0ExpBalUniswapV2: BigNumber = bigNumberify( '249501683697445' )
    const token0ExpBalVexchange: BigNumber = bigNumberify( '249551584034184' )
    const token0Variance: number = token0ExpBalUniswapV2.div(token0ExpBalVexchange.sub(token0ExpBalUniswapV2)).toNumber();
    expect(token0Variance, "token 0 variance from uniswap v2 fee" ).to.be.within(minInverseVariance, maxInverseVariance)

    // Compare 1/6 uniswapV2 fee, using 0.1667 Vexchange Platform fee: run check to confirm ~ 0.02% variance.
    const token1ExpBalUniswapV2: BigNumber = bigNumberify( '250000187312969' )
    const token1ExpBalVexchange: BigNumber = bigNumberify( '250050187350431' )
    const token1Variance: number = token1ExpBalUniswapV2.div(token1ExpBalVexchange.sub(token1ExpBalUniswapV2)).toNumber();
    expect(token1Variance, "token 1 variance from uniswap v2 fee" ).to.be.within(minInverseVariance, maxInverseVariance)

    // using 1000 here instead of the symbolic MINIMUM_LIQUIDITY because the amounts only happen to be equal...
    // ...because the initial liquidity amounts were equal
    expect(await token0.balanceOf(pair.address), "Token 0 balance of pair").to.eq(bigNumberify(1000).add(token0ExpBalVexchange))
    expect(await token1.balanceOf(pair.address), "Token 1 balance of pair").to.eq(bigNumberify(1000).add(token1ExpBalVexchange))
  })

  /**
   * calcPlatformFee
   * 
   * Note that this function is deliberately verbose.
   * 
   */
  function calcPlatformFee( aPlatformFee: BigNumber,
                            aToken0Balance: BigNumber, aToken1Balance: BigNumber,
                            aNewToken0Balance: BigNumber, aNewToken1Balance: BigNumber ) : BigNumber
  {
    // Constants from UniswapV2Pair _calcFee
    const ACCURACY_SQRD : BigNumber = bigNumberify('10000000000000000000000000000000000000000000000000000000000000000000000000000')
    const ACCURACY      : BigNumber = bigNumberify('100000000000000000000000000000000000000')
    const FEE_ACCURACY  : BigNumber = bigNumberify(10000)

    const lTotalSupply  : BigNumber = bigNumberSqrt(aToken0Balance.mul(aToken1Balance))

    // The pair invariants for the pool (sqrt'd)
    const pairSqrtInvariantOriginal: BigNumber = bigNumberSqrt( aToken0Balance.mul(aToken1Balance) )
    const pairSqrtInvariantNew: BigNumber = bigNumberSqrt( aNewToken0Balance.mul(aNewToken1Balance) )

    // Assertions made but not enforced by Pair contract
    expect( pairSqrtInvariantOriginal, 'pairSqrtINvariantOriginal < 112bit' ).to.lte(MAX_UINT_112)
    expect( pairSqrtInvariantNew, 'pairSqrtInvariantNew < 112bit' ).to.lte(MAX_UINT_112)
    expect( aPlatformFee, 'platformFee < FeeAccuracy' ).to.lte(FEE_ACCURACY)
    expect( lTotalSupply, 'totalSupply < 112bit' ).to.lte(MAX_UINT_112)

    // The algorithm from UniswapV2Pair _calcFee
    const lScaledGrowth = pairSqrtInvariantNew.mul(ACCURACY).div(pairSqrtInvariantOriginal)
    expect( lScaledGrowth, 'scaled-growth < 256bit' ).to.lte( MAX_UINT_256 )

    const lScaledMultiplier = ACCURACY.sub( ACCURACY_SQRD.div( lScaledGrowth ) )
    expect( lScaledMultiplier, 'scaled-multiplier < 128bit' ).to.lte( MAX_UINT_128 )

    const lScaledTargetOwnership = lScaledMultiplier.mul( aPlatformFee ).div( FEE_ACCURACY )
    expect( lScaledTargetOwnership, 'scaled-tTarget-ownership < 128bit' ).to.lte( MAX_UINT_128 )

    const resultantFee = lScaledTargetOwnership.mul(lTotalSupply).div(ACCURACY.sub(lScaledTargetOwnership)); 

    return resultantFee 
  } // calcPlatformFee

  /**
   * Verify the calcPlatformFee in terms of straight-forward use-cases;
   * based on platformFee, initial balances & final balances.
   * 
   * (Last-k and new-k invariants are derived from the intial & final balances)
   * 
   * Test values: 
   *   platformFee, token0Initial, token1Initial, token0Final, token1Final, resultantFee
   * 
   * Expected resultantFee below has been verified with eq (6) of uniswap v2 whitepaper.
   * https://uniswap.org/whitepaper.pdf
   */
  const calcPlatformFeeTestCases: BigNumber[][] = [
    [    0,  10000,  10000,   20000,   20000,     0 ], //< Zero plaform-fee.
    [    5,  10000,  10000,   10000,   10000,     0 ], //< Equivalent liquidity, so growth & zero fee: not technically possible from _mintFee.
    [    5,  10000,   5000,   10000,    5000,     0 ], //< Equivalent liquidity, so growth & zero fee: not technically possible from _mintFee.
    [    5,  10000,   5000,    5000,   10000,     0 ], //< Equivalent liquidity, so growth & zero fee: not technically possible from _mintFee.
    [    5,   5000,  10000,   10000,    5000,     0 ], //< Equivalent liquidity, so growth & zero fee: not technically possible from _mintFee.
    [    5,  10000,  10000,   20000,   20000,     2 ],
    [   10,  10000,  10000,   20000,   20000,     5 ],
    [   25,  10000,  10000,   50000,   50000,    20 ],
    [   50,  10000,  10000,   20000,   20000,    25 ],
    [  100,  10000,  10000,   20000,   20000,    50 ],
    [  500,  10000,  10000,   20000,   20000,   256 ],
    [ 1000,  10000,  10000,   20000,   20000,   526 ],
    [ 1000, 100000, 100000,  160000,  160000,  3896 ],
    [ 1000, 100000, 100000,  500000,  500000,  8695 ],
    [ 1667,  10000,  10000,   20000,   20000,   909 ],
    [ 2000,  10000,  10000,   20000,   20000,  1111 ],
    [ 2500,  10000,  10000,   20000,   20000,  1428 ],
    [ 2500,  10000,  10000,   15000,   10000,   480 ],
    [ 2500,  10000,  10000,   10000,   15000,   480 ],
    [ 2500,   5000,  20000,   10000,   15000,   480 ],
    [ 2500,  20000,   5000,   10000,   15000,   480 ],
    [ 2500,   5000,  10000,   10000,    5000,     0 ], //< Equivalent liquidity, so growth & zero fee: not technically possible from _mintFee.
    [ 2500,  10000,   5000,    5000,   10000,     0 ], //< Equivalent liquidity, so growth & zero fee: not technically possible from _mintFee.
    [ 2500,  10000,   5000,   20000,   10000,  1010 ],
    [ 2500,  10000,  10000,   50000,   50000,  2500 ],
    [ 2500,  20000,  20000,   60000,   60000,  3999 ],
    [ 2500, 100000, 100000,  500000,  500000, 25000 ], 
    [ 3000,  10000,  10000,   12000,   12000,   526 ],
    [ 5000,  10000,  10000,   50000,   50000,  6666 ],
    [ 5000, 100000, 100000,  500000,  500000, 66666 ],
    [ 5000, 100000, 100000, 1000000, 1000000, 81818 ],
    [ 5000, 100000, 100000, 2000000, 2000000, 90476 ],
  ].map(a => a.map(n => (bigNumberify(n))))
  calcPlatformFeeTestCases.forEach((platformFeeTestCase, i) => {
    it(`calcPlatformFee:${i}`, async () => {
      const [platformFee, token0InitialBalance, token1InitialBalance, token0FinalBalance, token1FinalBalance, expectedPlatformFee] = platformFeeTestCase
      expect( calcPlatformFee( platformFee, token0InitialBalance, token1InitialBalance, token0FinalBalance, token1FinalBalance ) ).to.eq( expectedPlatformFee )
    })
  })

  /**
   * Test the platform fee calculation with a test-case curve of swapFee and plaformFee variance.
   * 
   * Verify correctness of Swap Fee & Platform Fee at balance boundaries.
   * 
   * - Add liquidity of MAX_UINT_256 - MAX_UINT_64 to both sides of the pair;
   * - Swap MAX_UINT_64 from token0 to token1, taking token1 to its maximum.
   * - Remove all funds, and verify the remainder is as expected (minimum liquidity)
   * 
   * Test Values: swapFee, platformFee (in basis points)
   */
   const swapAndPlatformFeeTestCases: BigNumber[][] = [
      [5, 500],
      [5, 1667],
      [5, 2500],
      [5, 5000],
      [15, 500],
      [15, 1667],
      [15, 2500],
      [15, 5000],
      [30, 500],
      [30, 1667],
      [30, 3000],
      [30, 5000],
      [50, 500],
      [50, 1667],
      [50, 2500],
      [50, 5000],
      [100, 500],
      [100, 1667],
      [100, 2500],
      [100, 5000],
      [150, 500],
      [150, 1667],
      [150, 2500],
      [150, 5000],
      [200, 500],
      [200, 1667],
      [200, 2500],
      [200, 5000]
    ].map(a => a.map(n => (bigNumberify(n))))
    swapAndPlatformFeeTestCases.forEach((swapAndPlatformTestCase, i) => {
      it(`platformFeeRange:${i}`, async () => {
        const [swapFee, platformFee] = swapAndPlatformTestCase
    
        // Setup the platform and swap fee
        await factory.setSwapFeeForPair( pair.address, swapFee );
        await factory.setPlatformFeeForPair( pair.address, platformFee );
        await factory.setPlatformFeeTo(other.address)
    
        const swapAmount : BigNumber = bigNumberify( expandTo18Decimals(1) );
    
        // Setup liquidity in the pair - leave room for a swap to MAX one side
        const token0Liquidity = MAX_UINT_112.sub(swapAmount)
        const token1Liquidity = MAX_UINT_112.sub(swapAmount)
        await addLiquidity( token0Liquidity, token1Liquidity )
    
        const expectedLiquidity = MAX_UINT_112.sub(swapAmount)
        expect(await pair.totalSupply(), "Initial total supply").to.eq(expectedLiquidity)
    
        let expectedSwapAmount: BigNumber = calcSwapWithdraw( swapFee.toNumber(), swapAmount, token0Liquidity, token1Liquidity )
    
        await token1.transfer(pair.address, swapAmount)
        const swapTx = await pair.swap(expectedSwapAmount, 0, wallet.address, '0x', overrides)
        const swapReceipt = await swapTx.wait()
    
        // Gas price seems to be inconsistent for the swap
        expect(swapReceipt.gasUsed, "swap gas fee").to.satisfy( function(gas: number) {
          const result = ((gas==56403) || (gas==97155) || (gas==97219) || (gas==56339))
          return result
        })
    
        // Calculate the expected platform fee
        const token0PairBalanceAfterSwap = await token0.balanceOf(pair.address);
        const token1PairBalanceAfterSwap = await token1.balanceOf(pair.address);
        const expectedPlatformFee : BigNumber = calcPlatformFee( platformFee, token0Liquidity, token1Liquidity, token0PairBalanceAfterSwap, token1PairBalanceAfterSwap )
    
        // Drain the liquidity to verify no fee has been extracted on exit
        await pair.transfer(pair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
        const burnTx = await pair.burn(wallet.address, overrides)
        const burnReceipt = await burnTx.wait()
    
        // Determine the expected total supply post swap, and swapFee / platformFee removal
        const expectedTotalSupply: BigNumber = MINIMUM_LIQUIDITY.add(expectedPlatformFee)
    
        // Check the new total-supply: should be MINIMUM_LIQUIDITY + platform fee
        expect(await pair.totalSupply(), "Final total supply").to.satisfy( 
          function(a:BigNumber) { return closeTo(a, expectedTotalSupply) } )
    
        // Check the (inconsistent) gas fee
        expect(burnReceipt.gasUsed, "burn gas fee").to.satisfy( 
          function(gas: number) { return ((gas==169239) || (gas==128423)); })
    
        // Check that the fee receiver (account set to platformFeeTo) received the fees
        expect(await pair.balanceOf(other.address), "Fee receiver balance").to.eq( expectedPlatformFee )
    
        // using 1000 here instead of the symbolic MINIMUM_LIQUIDITY because the amounts only happen to be equal...
        // ...because the initial liquidity amounts were equal
    
        const token0ExpBalVexchange: BigNumber = bigNumberify( expectedPlatformFee )
        expect(await token0.balanceOf(pair.address), "Token 0 balance of pair").to.satisfy( 
          function(a:BigNumber) { return closeTo(a, bigNumberify(1000).add(token0ExpBalVexchange)) } )
        
        const token1ExpBalVexchange: BigNumber = bigNumberify( expectedPlatformFee )
        expect(await token1.balanceOf(pair.address), "Token 1 balance of pair").to.satisfy(
          function(a:BigNumber) { return closeTo(a, bigNumberify(1000).add(token1ExpBalVexchange)) } )
      })
    })

  /**
   * basicOverflow
   * 
   * Testing mint and swap handling of an overflow balance (> max-uint-112).
   */
  it('basicOverflow', async () => {
    const platformFee : BigNumber = bigNumberify( 2500 )

    // Ensure the platform fee is set
    await factory.setPlatformFeeForPair( pair.address, platformFee );
    await factory.setPlatformFeeTo(other.address)

    // Setup minimum liquidity
    const initial0Amount = MINIMUM_LIQUIDITY.add(1)
    const initial1Amount = MINIMUM_LIQUIDITY.add(1)
    await addLiquidity(initial0Amount, initial1Amount)

    const expectedInitalLiquidity = MINIMUM_LIQUIDITY.add(1)
    expect(await pair.totalSupply(), "Initial total supply").to.eq(expectedInitalLiquidity)

    // Add a lot more - taking us to the limit
    const token0Amount = MAX_UINT_112.sub(initial0Amount)
    const token1Amount = MAX_UINT_112.sub(initial1Amount)
    await addLiquidity(token0Amount, token1Amount)

    // Confirm liquidity is established
    const expectedLiquidity = MAX_UINT_112 // geometric mean of token0Amount and token1Amount (equal, so can use one)
    expect(await pair.totalSupply(), "Second stage total supply").to.eq(expectedLiquidity)

    // Confirm we cannot add even just another little wafer ... expect an overflow revert.
    await token0.transfer(pair.address, bigNumberify(1))
    await token1.transfer(pair.address, bigNumberify(1))
    await expect( pair.mint(wallet.address, overrides), 'mint with too much balance' ).to.be.revertedWith( 'UniswapV2: OVERFLOW' )

    // Reconfirm established liquidity
    expect(await pair.totalSupply(), "Total supply post failed mint").to.eq(expectedLiquidity)

    // Also try and swap the wafer
    await expect( pair.swap(bigNumberify(1), 0, wallet.address, '0x', overrides), 'swap with too much balance').to.be.revertedWith( 'UniswapV2: OVERFLOW' )
  })
})