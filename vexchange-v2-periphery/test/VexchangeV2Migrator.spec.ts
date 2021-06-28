import chai, { expect } from 'chai'
import { Contract } from 'ethers'
import { AddressZero, MaxUint256 } from 'ethers/constants'
import { bigNumberify } from 'ethers/utils'
import { solidity, MockProvider, createFixtureLoader } from 'ethereum-waffle'

import { v2Fixture } from './shared/fixtures'
import { expandTo18Decimals, MINIMUM_LIQUIDITY } from './shared/utilities'

chai.use(solidity)

const overrides = {
  gasLimit: 9999999
}

describe('VexchangeV2Migrator', () => {
  const provider = new MockProvider({
    hardfork: 'istanbul',
    mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
    gasLimit: 9999999
  })
  const [wallet] = provider.getWallets()
  const loadFixture = createFixtureLoader(provider, [wallet])

  let VVETPartner: Contract
  let VVETPair: Contract
  let router: Contract
  let migrator: Contract
  let VVETExchangeV1: Contract
  beforeEach(async function() {
    const fixture = await loadFixture(v2Fixture)
    VVETPartner = fixture.VVETPartner
    VVETPair = fixture.VVETPair
    router = fixture.router01 // we used router01 for this contract
    migrator = fixture.migrator
    VVETExchangeV1 = fixture.VVETExchangeV1
  })

  it('migrate', async () => {
    const VVETPartnerAmount = expandTo18Decimals(1)
    const VETAmount = expandTo18Decimals(4)
    await VVETPartner.approve(VVETExchangeV1.address, MaxUint256)
    await VVETExchangeV1.addLiquidity(bigNumberify(1), VVETPartnerAmount, MaxUint256, {
      ...overrides,
      value: VETAmount
    })
    await VVETExchangeV1.approve(migrator.address, MaxUint256)
    const expectedLiquidity = expandTo18Decimals(2)
    const VVETPairToken0 = await VVETPair.token0()
    await expect(
      migrator.migrate(VVETPartner.address, VVETPartnerAmount, VETAmount, wallet.address, MaxUint256, overrides)
    )
      .to.emit(VVETPair, 'Transfer')
      .withArgs(AddressZero, AddressZero, MINIMUM_LIQUIDITY)
      .to.emit(VVETPair, 'Transfer')
      .withArgs(AddressZero, wallet.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
      .to.emit(VVETPair, 'Sync')
      .withArgs(
        VVETPairToken0 === VVETPartner.address ? VVETPartnerAmount : VETAmount,
        VVETPairToken0 === VVETPartner.address ? VETAmount : VVETPartnerAmount
      )
      .to.emit(VVETPair, 'Mint')
      .withArgs(
        router.address,
        VVETPairToken0 === VVETPartner.address ? VVETPartnerAmount : VETAmount,
        VVETPairToken0 === VVETPartner.address ? VETAmount : VVETPartnerAmount
      )
    expect(await VVETPair.balanceOf(wallet.address)).to.eq(expectedLiquidity.sub(MINIMUM_LIQUIDITY))
  })
})
