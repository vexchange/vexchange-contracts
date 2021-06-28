import chai, { expect } from 'chai'
import { Contract } from 'ethers'
import { MaxUint256 } from 'ethers/constants'
import { BigNumber, bigNumberify, defaultAbiCoder, formatEther } from 'ethers/utils'
import { solidity, MockProvider, createFixtureLoader, deployContract } from 'ethereum-waffle'

import { expandTo18Decimals } from './shared/utilities'
import { v2Fixture } from './shared/fixtures'

import ExampleFlashSwap from '../build/ExampleFlashSwap.json'

chai.use(solidity)

const overrides = {
  gasLimit: 9999999,
  gasPrice: 0
}

describe('ExampleFlashSwap', () => {
  const provider = new MockProvider({
    hardfork: 'istanbul',
    mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
    gasLimit: 9999999
  })
  const [wallet] = provider.getWallets()
  const loadFixture = createFixtureLoader(provider, [wallet])

  let VVET: Contract
  let VVETPartner: Contract
  let VVETExchangeV1: Contract
  let VVETPair: Contract
  let flashSwapExample: Contract
  beforeEach(async function() {
    const fixture = await loadFixture(v2Fixture)

    VVET = fixture.VVET
    VVETPartner = fixture.VVETPartner
    VVETExchangeV1 = fixture.VVETExchangeV1
    VVETPair = fixture.VVETPair
    flashSwapExample = await deployContract(
      wallet,
      ExampleFlashSwap,
      [fixture.factoryV2.address, fixture.factoryV1.address, fixture.router.address],
      overrides
    )
  })

  it('vexchangeV2Call:0', async () => {
    // add liquidity to V1 at a rate of 1 VET / 200 X
    const VVETPartnerAmountV1 = expandTo18Decimals(2000)
    const VETAmountV1 = expandTo18Decimals(10)
    await VVETPartner.approve(VVETExchangeV1.address, VVETPartnerAmountV1)
    await VVETExchangeV1.addLiquidity(bigNumberify(1), VVETPartnerAmountV1, MaxUint256, {
      ...overrides,
      value: VETAmountV1
    })

    // add liquidity to V2 at a rate of 1 VET / 100 X
    const VVETPartnerAmountV2 = expandTo18Decimals(1000)
    const VETAmountV2 = expandTo18Decimals(10)
    await VVETPartner.transfer(VVETPair.address, VVETPartnerAmountV2)
    await VVET.deposit({ value: VETAmountV2 })
    await VVET.transfer(VVETPair.address, VETAmountV2)
    await VVETPair.mint(wallet.address, overrides)

    const balanceBefore = await VVETPartner.balanceOf(wallet.address)

    // now, execute arbitrage via vexchangeV2Call:
    // receive 1 VET from V2, get as much X from V1 as we can, repay V2 with minimum X, keep the rest!
    const arbitrageAmount = expandTo18Decimals(1)
    // instead of being 'hard-coded', the above value could be calculated optimally off-chain. this would be
    // better, but it'd be better yet to calculate the amount at runtime, on-chain. unfortunately, this requires a
    // swap-to-price calculation, which is a little tricky, and out of scope for the moment
    const VVETPairToken0 = await VVETPair.token0()
    const amount0 = VVETPairToken0 === VVETPartner.address ? bigNumberify(0) : arbitrageAmount
    const amount1 = VVETPairToken0 === VVETPartner.address ? arbitrageAmount : bigNumberify(0)
    await VVETPair.swap(
      amount0,
      amount1,
      flashSwapExample.address,
      defaultAbiCoder.encode(['uint'], [bigNumberify(1)]),
      overrides
    )

    const balanceAfter = await VVETPartner.balanceOf(wallet.address)
    const profit = balanceAfter.sub(balanceBefore).div(expandTo18Decimals(1))
    const reservesV1 = [
      await VVETPartner.balanceOf(VVETExchangeV1.address),
      await provider.getBalance(VVETExchangeV1.address)
    ]
    const priceV1 = reservesV1[0].div(reservesV1[1])
    const reservesV2 = (await VVETPair.getReserves()).slice(0, 2)
    const priceV2 =
      VVETPairToken0 === VVETPartner.address ? reservesV2[0].div(reservesV2[1]) : reservesV2[1].div(reservesV2[0])

    expect(profit.toString()).to.eq('69') // our profit is ~69 tokens
    expect(priceV1.toString()).to.eq('165') // we pushed the v1 price down to ~165
    expect(priceV2.toString()).to.eq('123') // we pushed the v2 price up to ~123
  })

  it('vexchangeV2Call:1', async () => {
    // add liquidity to V1 at a rate of 1 VET / 100 X
    const VVETPartnerAmountV1 = expandTo18Decimals(1000)
    const VETAmountV1 = expandTo18Decimals(10)
    await VVETPartner.approve(VVETExchangeV1.address, VVETPartnerAmountV1)
    await VVETExchangeV1.addLiquidity(bigNumberify(1), VVETPartnerAmountV1, MaxUint256, {
      ...overrides,
      value: VETAmountV1
    })

    // add liquidity to V2 at a rate of 1 VET / 200 X
    const VVETPartnerAmountV2 = expandTo18Decimals(2000)
    const VETAmountV2 = expandTo18Decimals(10)
    await VVETPartner.transfer(VVETPair.address, VVETPartnerAmountV2)
    await VVET.deposit({ value: VETAmountV2 })
    await VVET.transfer(VVETPair.address, VETAmountV2)
    await VVETPair.mint(wallet.address, overrides)

    const balanceBefore = await provider.getBalance(wallet.address)

    // now, execute arbitrage via vexchangeV2Call:
    // receive 200 X from V2, get as much VET from V1 as we can, repay V2 with minimum VET, keep the rest!
    const arbitrageAmount = expandTo18Decimals(200)
    // instead of being 'hard-coded', the above value could be calculated optimally off-chain. this would be
    // better, but it'd be better yet to calculate the amount at runtime, on-chain. unfortunately, this requires a
    // swap-to-price calculation, which is a little tricky, and out of scope for the moment
    const VVETPairToken0 = await VVETPair.token0()
    const amount0 = VVETPairToken0 === VVETPartner.address ? arbitrageAmount : bigNumberify(0)
    const amount1 = VVETPairToken0 === VVETPartner.address ? bigNumberify(0) : arbitrageAmount
    await VVETPair.swap(
      amount0,
      amount1,
      flashSwapExample.address,
      defaultAbiCoder.encode(['uint'], [bigNumberify(1)]),
      overrides
    )

    const balanceAfter = await provider.getBalance(wallet.address)
    const profit = balanceAfter.sub(balanceBefore)
    const reservesV1 = [
      await VVETPartner.balanceOf(VVETExchangeV1.address),
      await provider.getBalance(VVETExchangeV1.address)
    ]
    const priceV1 = reservesV1[0].div(reservesV1[1])
    const reservesV2 = (await VVETPair.getReserves()).slice(0, 2)
    const priceV2 =
      VVETPairToken0 === VVETPartner.address ? reservesV2[0].div(reservesV2[1]) : reservesV2[1].div(reservesV2[0])

    expect(formatEther(profit)).to.eq('0.548043441089763649') // our profit is ~.5 VET
    expect(priceV1.toString()).to.eq('143') // we pushed the v1 price up to ~143
    expect(priceV2.toString()).to.eq('161') // we pushed the v2 price down to ~161
  })
})
