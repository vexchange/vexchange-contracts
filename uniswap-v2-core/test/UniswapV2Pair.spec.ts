import chai, { expect } from 'chai'
import { Contract } from 'ethers'
import { solidity, MockProvider, createFixtureLoader } from 'ethereum-waffle'
import { BigNumber, bigNumberify } from 'ethers/utils'

import { expandTo18Decimals, mineBlock, encodePrice } from './shared/utilities'
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
  let token2: Contract
  let pair: Contract
  beforeEach(async () => {
    const fixture = await loadFixture(pairFixture)
    factory = fixture.factory
    token0 = fixture.token0
    token1 = fixture.token1
    token2 = fixture.token2
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
    let pairInvariant: BigNumber = aWithdrawTokenBalance.mul(aDepositTokenBalance)

    // The amount added to the liquidity pool after fees
    let depositAfterFees : BigNumber = aSwapAmount.mul(10000-aSwapFee).div(10000)

    // The new token1 total (add the incoming liquidity)
    let depositTokenAfterDeposit: BigNumber = aDepositTokenBalance.add(depositAfterFees)

    // Using the invariant, calculate the impact on token 0 from the new liquidity
    let maxWithdrawTokenAvail: BigNumber = pairInvariant.div(depositTokenAfterDeposit)

    // Check for rounding error (BigNumber division will floor instead of rounding);
    // If product of token0Impact & token1AfterDeposity is less than invariant, increment the token0Impact.
    if ( pairInvariant.gt( maxWithdrawTokenAvail.mul(depositTokenAfterDeposit) ) )
    maxWithdrawTokenAvail = maxWithdrawTokenAvail.add(1)

    // Calculate the new token 0 delta, which is the maximum amount that could be
    // removed and still maintain the invariant
    let maxTokenToWithdraw: BigNumber =  aWithdrawTokenBalance.sub(maxWithdrawTokenAvail)

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

    // Check the new total-supply: should be MINIMUM_LIQUIDITY + platform fee
    expect(await pair.totalSupply(), "Total supply").to.eq(MINIMUM_LIQUIDITY.add(expectedPlatformFee))

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
   *  recoverToken - error handling for invalid tokens 
   */
  it('recoverToken:invalidToken', async () => {
    let recoveryAddress = other.address
    await factory.setRecovererForPair(pair.address, recoveryAddress)

    await expect(pair.recoverToken(token0.address)).to.be.revertedWith('Vexchange: INVALID_TOKEN_TO_RECOVER')
    await expect(pair.recoverToken(token1.address)).to.be.revertedWith('Vexchange: INVALID_TOKEN_TO_RECOVER')  
    
    const invalidTokenAddress = "0x3704E657053C02411aA2Fd0599e75C3d817F81BC"
    await expect(pair.recoverToken(invalidTokenAddress)).to.be.reverted
  })

  /**
   *  recoverToken - failure when recoverer is AddressZero or not set
   */
  it('recoverToken:AddressZero', async () => {
    
    // recoverer should be AddressZero by default
    expect(await pair.recoverer()).to.eq(AddressZero)
    await expect(pair.recoverToken(token2.address)).to.be.revertedWith('Vexchange: RECOVERER_ZERO_ADDRESS')

    // Transfer some token2 to pair address  
    const token2Amount = expandTo18Decimals(3)
    await token2.transfer(pair.address, token2Amount)
    expect(await token2.balanceOf(pair.address)).to.eq(token2Amount)

    // recoverToken should still fail
    await expect(pair.recoverToken(token2.address)).to.be.revertedWith('Vexchange: RECOVERER_ZERO_ADDRESS')
  })

  /**
   *  recoverToken - when there are no tokens to be recovered
   */
  it('recoverToken:noAmount', async () => {
    let recoveryAddress = other.address
    
    // There should not be any token of the kind to be recovered
    // in the recoverer's account
    expect(await token2.balanceOf(recoveryAddress)).to.eq(0)
    await factory.setRecovererForPair(pair.address, recoveryAddress)
    await pair.recoverToken(token2.address)
    expect(await token2.balanceOf(recoveryAddress)).to.eq(0)    
  })

  /**
   *  recoverToken - normal use case
   */
  it('recoverToken:base' , async () => {
    const token2Amount = expandTo18Decimals(3)
    await token2.transfer(pair.address, token2Amount)
    expect(await token2.balanceOf(pair.address)).to.eq(token2Amount)
    
    let recoveryAddress = other.address
    await factory.setRecovererForPair(pair.address, recoveryAddress)
    await pair.recoverToken(token2.address)

    // All token2 should be drained from the pair 
    // and be transferred to the recoveryAddress
    expect(await token2.balanceOf(pair.address)).to.eq(0)
    expect(await token2.balanceOf(recoveryAddress)).to.eq(token2Amount)
  })
})
