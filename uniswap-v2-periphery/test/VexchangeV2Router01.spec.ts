import chai, { expect } from 'chai'
import { Contract } from 'ethers'
import { AddressZero, Zero, MaxUint256 } from 'ethers/constants'
import { BigNumber, bigNumberify } from 'ethers/utils'
import { solidity, MockProvider, createFixtureLoader } from 'ethereum-waffle'
import { ecsign } from 'ethereumjs-util'

import { expandTo18Decimals, getApprovalDigest, mineBlock, MINIMUM_LIQUIDITY, verifyGas } from './shared/utilities'
import { v2Fixture } from './shared/fixtures'

chai.use(solidity)

const overrides = {
  gasLimit: 9999999
}

enum RouterVersion {
  VexchangeV2Router01 = 'VexchangeV2Router01',
  VexchangeV2Router02 = 'VexchangeV2Router02'
}

describe('VexchangeV2Router{01,02}', () => {
  for (const routerVersion of Object.keys(RouterVersion)) {
    const provider = new MockProvider({
      hardfork: 'constantinople',
      mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
      gasLimit: 9999999
    })
    const [wallet] = provider.getWallets()
    const loadFixture = createFixtureLoader(provider, [wallet])

    let token0: Contract
    let token1: Contract
    let VVET: Contract
    let VVETPartner: Contract
    let factory: Contract
    let router: Contract
    let pair: Contract
    let VVETPair: Contract
    let routerEventEmitter: Contract
    beforeEach(async function() {
      const fixture = await loadFixture(v2Fixture)
      token0 = fixture.token0
      token1 = fixture.token1
      VVET = fixture.VVET
      VVETPartner = fixture.VVETPartner
      factory = fixture.factoryV2
      router = {
        [RouterVersion.VexchangeV2Router01]: fixture.router01,
        [RouterVersion.VexchangeV2Router02]: fixture.router02
      }[routerVersion as RouterVersion]
      pair = fixture.pair
      VVETPair = fixture.VVETPair
      routerEventEmitter = fixture.routerEventEmitter
    })

    afterEach(async function() {
      expect(await provider.getBalance(router.address)).to.eq(Zero)
    })

    describe(routerVersion, () => {
      it('factory, VVET', async () => {
        expect(await router.factory()).to.eq(factory.address)
        expect(await router.VVET()).to.eq(VVET.address)
      })

      it('addLiquidity', async () => {
        const token0Amount = expandTo18Decimals(1)
        const token1Amount = expandTo18Decimals(4)

        const expectedLiquidity = expandTo18Decimals(2)
        await token0.approve(router.address, MaxUint256)
        await token1.approve(router.address, MaxUint256)
        await expect(
          router.addLiquidity(
            token0.address,
            token1.address,
            token0Amount,
            token1Amount,
            0,
            0,
            wallet.address,
            MaxUint256,
            overrides
          )
        )
          .to.emit(token0, 'Transfer')
          .withArgs(wallet.address, pair.address, token0Amount)
          .to.emit(token1, 'Transfer')
          .withArgs(wallet.address, pair.address, token1Amount)
          .to.emit(pair, 'Transfer')
          .withArgs(AddressZero, AddressZero, MINIMUM_LIQUIDITY)
          .to.emit(pair, 'Transfer')
          .withArgs(AddressZero, wallet.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
          .to.emit(pair, 'Sync')
          .withArgs(token0Amount, token1Amount)
          .to.emit(pair, 'Mint')
          .withArgs(router.address, token0Amount, token1Amount)

        expect(await pair.balanceOf(wallet.address)).to.eq(expectedLiquidity.sub(MINIMUM_LIQUIDITY))
      })

      it('addLiquidityVET', async () => {
        const VVETPartnerAmount = expandTo18Decimals(1)
        const VETAmount = expandTo18Decimals(4)

        const expectedLiquidity = expandTo18Decimals(2)
        const VVETPairToken0 = await VVETPair.token0()
        await VVETPartner.approve(router.address, MaxUint256)
        await expect(
          router.addLiquidityVET(
            VVETPartner.address,
            VVETPartnerAmount,
            VVETPartnerAmount,
            VETAmount,
            wallet.address,
            MaxUint256,
            { ...overrides, value: VETAmount }
          )
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

      async function addLiquidity(token0Amount: BigNumber, token1Amount: BigNumber) {
        await token0.transfer(pair.address, token0Amount)
        await token1.transfer(pair.address, token1Amount)
        await pair.mint(wallet.address, overrides)
      }
      it('removeLiquidity', async () => {
        const token0Amount = expandTo18Decimals(1)
        const token1Amount = expandTo18Decimals(4)
        await addLiquidity(token0Amount, token1Amount)

        const expectedLiquidity = expandTo18Decimals(2)
        await pair.approve(router.address, MaxUint256)
        await expect(
          router.removeLiquidity(
            token0.address,
            token1.address,
            expectedLiquidity.sub(MINIMUM_LIQUIDITY),
            0,
            0,
            wallet.address,
            MaxUint256,
            overrides
          )
        )
          .to.emit(pair, 'Transfer')
          .withArgs(wallet.address, pair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
          .to.emit(pair, 'Transfer')
          .withArgs(pair.address, AddressZero, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
          .to.emit(token0, 'Transfer')
          .withArgs(pair.address, wallet.address, token0Amount.sub(500))
          .to.emit(token1, 'Transfer')
          .withArgs(pair.address, wallet.address, token1Amount.sub(2000))
          .to.emit(pair, 'Sync')
          .withArgs(500, 2000)
          .to.emit(pair, 'Burn')
          .withArgs(router.address, token0Amount.sub(500), token1Amount.sub(2000), wallet.address)

        expect(await pair.balanceOf(wallet.address)).to.eq(0)
        const totalSupplyToken0 = await token0.totalSupply()
        const totalSupplyToken1 = await token1.totalSupply()
        expect(await token0.balanceOf(wallet.address)).to.eq(totalSupplyToken0.sub(500))
        expect(await token1.balanceOf(wallet.address)).to.eq(totalSupplyToken1.sub(2000))
      })

      it('removeLiquidityVET', async () => {
        const VVETPartnerAmount = expandTo18Decimals(1)
        const VETAmount = expandTo18Decimals(4)
        await VVETPartner.transfer(VVETPair.address, VVETPartnerAmount)
        await VVET.deposit({ value: VETAmount })
        await VVET.transfer(VVETPair.address, VETAmount)
        await VVETPair.mint(wallet.address, overrides)

        const expectedLiquidity = expandTo18Decimals(2)
        const VVETPairToken0 = await VVETPair.token0()
        await VVETPair.approve(router.address, MaxUint256)
        await expect(
          router.removeLiquidityVET(
            VVETPartner.address,
            expectedLiquidity.sub(MINIMUM_LIQUIDITY),
            0,
            0,
            wallet.address,
            MaxUint256,
            overrides
          )
        )
          .to.emit(VVETPair, 'Transfer')
          .withArgs(wallet.address, VVETPair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
          .to.emit(VVETPair, 'Transfer')
          .withArgs(VVETPair.address, AddressZero, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
          .to.emit(VVET, 'Transfer')
          .withArgs(VVETPair.address, router.address, VETAmount.sub(2000))
          .to.emit(VVETPartner, 'Transfer')
          .withArgs(VVETPair.address, router.address, VVETPartnerAmount.sub(500))
          .to.emit(VVETPartner, 'Transfer')
          .withArgs(router.address, wallet.address, VVETPartnerAmount.sub(500))
          .to.emit(VVETPair, 'Sync')
          .withArgs(
            VVETPairToken0 === VVETPartner.address ? 500 : 2000,
            VVETPairToken0 === VVETPartner.address ? 2000 : 500
          )
          .to.emit(VVETPair, 'Burn')
          .withArgs(
            router.address,
            VVETPairToken0 === VVETPartner.address ? VVETPartnerAmount.sub(500) : VETAmount.sub(2000),
            VVETPairToken0 === VVETPartner.address ? VETAmount.sub(2000) : VVETPartnerAmount.sub(500),
            router.address
          )

        expect(await VVETPair.balanceOf(wallet.address)).to.eq(0)
        const totalSupplyVVETPartner = await VVETPartner.totalSupply()
        const totalSupplyVVET = await VVET.totalSupply()
        expect(await VVETPartner.balanceOf(wallet.address)).to.eq(totalSupplyVVETPartner.sub(500))
        expect(await VVET.balanceOf(wallet.address)).to.eq(totalSupplyVVET.sub(2000))
      })

      it('removeLiquidityWithPermit', async () => {
        const token0Amount = expandTo18Decimals(1)
        const token1Amount = expandTo18Decimals(4)
        await addLiquidity(token0Amount, token1Amount)

        const expectedLiquidity = expandTo18Decimals(2)

        const nonce = await pair.nonces(wallet.address)
        const digest = await getApprovalDigest(
          pair,
          { owner: wallet.address, spender: router.address, value: expectedLiquidity.sub(MINIMUM_LIQUIDITY) },
          nonce,
          MaxUint256,
          0x27
        )

        const { v, r, s } = ecsign(Buffer.from(digest.slice(2), 'hex'), Buffer.from(wallet.privateKey.slice(2), 'hex'))

        await router.removeLiquidityWithPermit(
          token0.address,
          token1.address,
          expectedLiquidity.sub(MINIMUM_LIQUIDITY),
          0,
          0,
          wallet.address,
          MaxUint256,
          false,
          v,
          r,
          s,
          overrides
        )
      })

      it('removeLiquidityVETWithPermit', async () => {
        const VVETPartnerAmount = expandTo18Decimals(1)
        const VETAmount = expandTo18Decimals(4)
        await VVETPartner.transfer(VVETPair.address, VVETPartnerAmount)
        await VVET.deposit({ value: VETAmount })
        await VVET.transfer(VVETPair.address, VETAmount)
        await VVETPair.mint(wallet.address, overrides)

        const expectedLiquidity = expandTo18Decimals(2)

        const nonce = await VVETPair.nonces(wallet.address)
        const digest = await getApprovalDigest(
          VVETPair,
          { owner: wallet.address, spender: router.address, value: expectedLiquidity.sub(MINIMUM_LIQUIDITY) },
          nonce,
          MaxUint256,
          0x27
        )

        const { v, r, s } = ecsign(Buffer.from(digest.slice(2), 'hex'), Buffer.from(wallet.privateKey.slice(2), 'hex'))

        await router.removeLiquidityVETWithPermit(
          VVETPartner.address,
          expectedLiquidity.sub(MINIMUM_LIQUIDITY),
          0,
          0,
          wallet.address,
          MaxUint256,
          false,
          v,
          r,
          s,
          overrides
        )
      })

      describe('swapExactTokensForTokens', () => {
        const token0Amount = expandTo18Decimals(5)
        const token1Amount = expandTo18Decimals(10)
        const swapAmount = expandTo18Decimals(1)
        const expectedOutputAmount = bigNumberify('1662497915624478906')

        beforeEach(async () => {
          await addLiquidity(token0Amount, token1Amount)
          await token0.approve(router.address, MaxUint256)
        })

        it('happy path', async () => {
          await expect(
            router.swapExactTokensForTokens(
              swapAmount,
              0,
              [token0.address, token1.address],
              wallet.address,
              MaxUint256,
              overrides
            )
          )
            .to.emit(token0, 'Transfer')
            .withArgs(wallet.address, pair.address, swapAmount)
            .to.emit(token1, 'Transfer')
            .withArgs(pair.address, wallet.address, expectedOutputAmount)
            .to.emit(pair, 'Sync')
            .withArgs(token0Amount.add(swapAmount), token1Amount.sub(expectedOutputAmount))
            .to.emit(pair, 'Swap')
            .withArgs(router.address, swapAmount, 0, 0, expectedOutputAmount, wallet.address)
        })

        it('amounts', async () => {
          await token0.approve(routerEventEmitter.address, MaxUint256)
          await expect(
            routerEventEmitter.swapExactTokensForTokens(
              router.address,
              swapAmount,
              0,
              [token0.address, token1.address],
              wallet.address,
              MaxUint256,
              overrides
            )
          )
            .to.emit(routerEventEmitter, 'Amounts')
            .withArgs([swapAmount, expectedOutputAmount])
        })

        it('gas', async () => {
          // ensure that setting price{0,1}CumulativeLast for the first time doesn't affect our gas math
          await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
          await pair.sync(overrides)

          await token0.approve(router.address, MaxUint256)
          await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
          const tx = await router.swapExactTokensForTokens(
            swapAmount,
            0,
            [token0.address, token1.address],
            wallet.address,
            MaxUint256,
            overrides
          )
          const receipt = await tx.wait()
          expect(receipt.gasUsed).to.eq(
            {
              [RouterVersion.VexchangeV2Router01]: 99751,
              [RouterVersion.VexchangeV2Router02]: 99773
            }[routerVersion as RouterVersion]
          )
        }).retries(3)
      })

      describe('swapTokensForExactTokens', () => {
        const token0Amount = expandTo18Decimals(5)
        const token1Amount = expandTo18Decimals(10)
        const expectedSwapAmount = bigNumberify('557227237267357629')
        const outputAmount = expandTo18Decimals(1)

        beforeEach(async () => {
          await addLiquidity(token0Amount, token1Amount)
        })

        it('happy path', async () => {
          await token0.approve(router.address, MaxUint256)
          await expect(
            router.swapTokensForExactTokens(
              outputAmount,
              MaxUint256,
              [token0.address, token1.address],
              wallet.address,
              MaxUint256,
              overrides
            )
          )
            .to.emit(token0, 'Transfer')
            .withArgs(wallet.address, pair.address, expectedSwapAmount)
            .to.emit(token1, 'Transfer')
            .withArgs(pair.address, wallet.address, outputAmount)
            .to.emit(pair, 'Sync')
            .withArgs(token0Amount.add(expectedSwapAmount), token1Amount.sub(outputAmount))
            .to.emit(pair, 'Swap')
            .withArgs(router.address, expectedSwapAmount, 0, 0, outputAmount, wallet.address)
        })

        it('amounts', async () => {
          await token0.approve(routerEventEmitter.address, MaxUint256)
          await expect(
            routerEventEmitter.swapTokensForExactTokens(
              router.address,
              outputAmount,
              MaxUint256,
              [token0.address, token1.address],
              wallet.address,
              MaxUint256,
              overrides
            )
          )
            .to.emit(routerEventEmitter, 'Amounts')
            .withArgs([expectedSwapAmount, outputAmount])
        })
      })

      describe('swapExactVETForTokens', () => {
        const VVETPartnerAmount = expandTo18Decimals(10)
        const VETAmount = expandTo18Decimals(5)
        const swapAmount = expandTo18Decimals(1)
        const expectedOutputAmount = bigNumberify('1662497915624478906')

        beforeEach(async () => {
          await VVETPartner.transfer(VVETPair.address, VVETPartnerAmount)
          await VVET.deposit({ value: VETAmount })
          await VVET.transfer(VVETPair.address, VETAmount)
          await VVETPair.mint(wallet.address, overrides)

          await token0.approve(router.address, MaxUint256)
        })

        it('happy path', async () => {
          const VVETPairToken0 = await VVETPair.token0()
          await expect(
            router.swapExactVETForTokens(0, [VVET.address, VVETPartner.address], wallet.address, MaxUint256, {
              ...overrides,
              value: swapAmount
            })
          )
            .to.emit(VVET, 'Transfer')
            .withArgs(router.address, VVETPair.address, swapAmount)
            .to.emit(VVETPartner, 'Transfer')
            .withArgs(VVETPair.address, wallet.address, expectedOutputAmount)
            .to.emit(VVETPair, 'Sync')
            .withArgs(
              VVETPairToken0 === VVETPartner.address
                ? VVETPartnerAmount.sub(expectedOutputAmount)
                : VETAmount.add(swapAmount),
              VVETPairToken0 === VVETPartner.address
                ? VETAmount.add(swapAmount)
                : VVETPartnerAmount.sub(expectedOutputAmount)
            )
            .to.emit(VVETPair, 'Swap')
            .withArgs(
              router.address,
              VVETPairToken0 === VVETPartner.address ? 0 : swapAmount,
              VVETPairToken0 === VVETPartner.address ? swapAmount : 0,
              VVETPairToken0 === VVETPartner.address ? expectedOutputAmount : 0,
              VVETPairToken0 === VVETPartner.address ? 0 : expectedOutputAmount,
              wallet.address
            )
        })

        it('amounts', async () => {
          await expect(
            routerEventEmitter.swapExactVETForTokens(
              router.address,
              0,
              [VVET.address, VVETPartner.address],
              wallet.address,
              MaxUint256,
              {
                ...overrides,
                value: swapAmount
              }
            )
          )
            .to.emit(routerEventEmitter, 'Amounts')
            .withArgs([swapAmount, expectedOutputAmount])
        })

        it('gas', async () => {
          const VVETPartnerAmount = expandTo18Decimals(10)
          const VETAmount = expandTo18Decimals(5)
          await VVETPartner.transfer(VVETPair.address, VVETPartnerAmount)
          await VVET.deposit({ value: VETAmount })
          await VVET.transfer(VVETPair.address, VETAmount)
          await VVETPair.mint(wallet.address, overrides)

          // ensure that setting price{0,1}CumulativeLast for the first time doesn't affect our gas math
          await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
          await pair.sync(overrides)

          const swapAmount = expandTo18Decimals(1)
          await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
          const tx = await router.swapExactVETForTokens(
            0,
            [VVET.address, VVETPartner.address],
            wallet.address,
            MaxUint256,
            {
              ...overrides,
              value: swapAmount
            }
          )
          const receipt = await tx.wait()
          expect(receipt.gasUsed).to.satisfy( function(gas: number) {
            if (routerVersion == RouterVersion.VexchangeV2Router01) {
              return verifyGas(gas, [104522, 134522], "swapExactVETForTokens Router01");
            }
            else if (routerVersion == RouterVersion.VexchangeV2Router02) {
              return verifyGas(gas, [104545, 134545], "swapExactVETForTokens Router02");
            }
          })
        })
      })

      describe('swapTokensForExactVET', () => {
        const VVETPartnerAmount = expandTo18Decimals(5)
        const VETAmount = expandTo18Decimals(10)
        const expectedSwapAmount = bigNumberify('557227237267357629')
        const outputAmount = expandTo18Decimals(1)

        beforeEach(async () => {
          await VVETPartner.transfer(VVETPair.address, VVETPartnerAmount)
          await VVET.deposit({ value: VETAmount })
          await VVET.transfer(VVETPair.address, VETAmount)
          await VVETPair.mint(wallet.address, overrides)
        })

        it('happy path', async () => {
          await VVETPartner.approve(router.address, MaxUint256)
          const VVETPairToken0 = await VVETPair.token0()
          await expect(
            router.swapTokensForExactVET(
              outputAmount,
              MaxUint256,
              [VVETPartner.address, VVET.address],
              wallet.address,
              MaxUint256,
              overrides
            )
          )
            .to.emit(VVETPartner, 'Transfer')
            .withArgs(wallet.address, VVETPair.address, expectedSwapAmount)
            .to.emit(VVET, 'Transfer')
            .withArgs(VVETPair.address, router.address, outputAmount)
            .to.emit(VVETPair, 'Sync')
            .withArgs(
              VVETPairToken0 === VVETPartner.address
                ? VVETPartnerAmount.add(expectedSwapAmount)
                : VETAmount.sub(outputAmount),
              VVETPairToken0 === VVETPartner.address
                ? VETAmount.sub(outputAmount)
                : VVETPartnerAmount.add(expectedSwapAmount)
            )
            .to.emit(VVETPair, 'Swap')
            .withArgs(
              router.address,
              VVETPairToken0 === VVETPartner.address ? expectedSwapAmount : 0,
              VVETPairToken0 === VVETPartner.address ? 0 : expectedSwapAmount,
              VVETPairToken0 === VVETPartner.address ? 0 : outputAmount,
              VVETPairToken0 === VVETPartner.address ? outputAmount : 0,
              router.address
            )
        })

        it('amounts', async () => {
          await VVETPartner.approve(routerEventEmitter.address, MaxUint256)
          await expect(
            routerEventEmitter.swapTokensForExactVET(
              router.address,
              outputAmount,
              MaxUint256,
              [VVETPartner.address, VVET.address],
              wallet.address,
              MaxUint256,
              overrides
            )
          )
            .to.emit(routerEventEmitter, 'Amounts')
            .withArgs([expectedSwapAmount, outputAmount])
        })
      })

      describe('swapExactTokensForVET', () => {
        const VVETPartnerAmount = expandTo18Decimals(5)
        const VETAmount = expandTo18Decimals(10)
        const swapAmount = expandTo18Decimals(1)
        const expectedOutputAmount = bigNumberify('1662497915624478906')

        beforeEach(async () => {
          await VVETPartner.transfer(VVETPair.address, VVETPartnerAmount)
          await VVET.deposit({ value: VETAmount })
          await VVET.transfer(VVETPair.address, VETAmount)
          await VVETPair.mint(wallet.address, overrides)
        })

        it('happy path', async () => {
          await VVETPartner.approve(router.address, MaxUint256)
          const VVETPairToken0 = await VVETPair.token0()
          await expect(
            router.swapExactTokensForVET(
              swapAmount,
              0,
              [VVETPartner.address, VVET.address],
              wallet.address,
              MaxUint256,
              overrides
            )
          )
            .to.emit(VVETPartner, 'Transfer')
            .withArgs(wallet.address, VVETPair.address, swapAmount)
            .to.emit(VVET, 'Transfer')
            .withArgs(VVETPair.address, router.address, expectedOutputAmount)
            .to.emit(VVETPair, 'Sync')
            .withArgs(
              VVETPairToken0 === VVETPartner.address
                ? VVETPartnerAmount.add(swapAmount)
                : VETAmount.sub(expectedOutputAmount),
              VVETPairToken0 === VVETPartner.address
                ? VETAmount.sub(expectedOutputAmount)
                : VVETPartnerAmount.add(swapAmount)
            )
            .to.emit(VVETPair, 'Swap')
            .withArgs(
              router.address,
              VVETPairToken0 === VVETPartner.address ? swapAmount : 0,
              VVETPairToken0 === VVETPartner.address ? 0 : swapAmount,
              VVETPairToken0 === VVETPartner.address ? 0 : expectedOutputAmount,
              VVETPairToken0 === VVETPartner.address ? expectedOutputAmount : 0,
              router.address
            )
        })

        it('amounts', async () => {
          await VVETPartner.approve(routerEventEmitter.address, MaxUint256)
          await expect(
            routerEventEmitter.swapExactTokensForVET(
              router.address,
              swapAmount,
              0,
              [VVETPartner.address, VVET.address],
              wallet.address,
              MaxUint256,
              overrides
            )
          )
            .to.emit(routerEventEmitter, 'Amounts')
            .withArgs([swapAmount, expectedOutputAmount])
        })
      })

      describe('swapVETForExactTokens', () => {
        const VVETPartnerAmount = expandTo18Decimals(10)
        const VETAmount = expandTo18Decimals(5)
        const expectedSwapAmount = bigNumberify('557227237267357629')
        const outputAmount = expandTo18Decimals(1)

        beforeEach(async () => {
          await VVETPartner.transfer(VVETPair.address, VVETPartnerAmount)
          await VVET.deposit({ value: VETAmount })
          await VVET.transfer(VVETPair.address, VETAmount)
          await VVETPair.mint(wallet.address, overrides)
        })

        it('happy path', async () => {
          const VVETPairToken0 = await VVETPair.token0()
          await expect(
            router.swapVETForExactTokens(
              outputAmount,
              [VVET.address, VVETPartner.address],
              wallet.address,
              MaxUint256,
              {
                ...overrides,
                value: expectedSwapAmount
              }
            )
          )
            .to.emit(VVET, 'Transfer')
            .withArgs(router.address, VVETPair.address, expectedSwapAmount)
            .to.emit(VVETPartner, 'Transfer')
            .withArgs(VVETPair.address, wallet.address, outputAmount)
            .to.emit(VVETPair, 'Sync')
            .withArgs(
              VVETPairToken0 === VVETPartner.address
                ? VVETPartnerAmount.sub(outputAmount)
                : VETAmount.add(expectedSwapAmount),
              VVETPairToken0 === VVETPartner.address
                ? VETAmount.add(expectedSwapAmount)
                : VVETPartnerAmount.sub(outputAmount)
            )
            .to.emit(VVETPair, 'Swap')
            .withArgs(
              router.address,
              VVETPairToken0 === VVETPartner.address ? 0 : expectedSwapAmount,
              VVETPairToken0 === VVETPartner.address ? expectedSwapAmount : 0,
              VVETPairToken0 === VVETPartner.address ? outputAmount : 0,
              VVETPairToken0 === VVETPartner.address ? 0 : outputAmount,
              wallet.address
            )
        })

        it('amounts', async () => {
          await expect(
            routerEventEmitter.swapVETForExactTokens(
              router.address,
              outputAmount,
              [VVET.address, VVETPartner.address],
              wallet.address,
              MaxUint256,
              {
                ...overrides,
                value: expectedSwapAmount
              }
            )
          )
            .to.emit(routerEventEmitter, 'Amounts')
            .withArgs([expectedSwapAmount, outputAmount])
        })
      })
    })
  }
})
