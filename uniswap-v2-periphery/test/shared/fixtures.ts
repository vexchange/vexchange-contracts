import { Wallet, Contract } from 'ethers'
import { Web3Provider } from 'ethers/providers'
import { deployContract } from 'ethereum-waffle'

import { expandTo18Decimals } from './utilities'

import VexchangeV2Factory from '../../../uniswap-v2-core/build/VexchangeV2Factory.json'
import IVexchangeV2Pair from '../../../uniswap-v2-core/build/IVexchangeV2Pair.json'

import ERC20 from '../../build/ERC20.json'
import VVET9 from '../../build/VVET9.json'
import VexchangeV1Exchange from '../../build/VexchangeV1Exchange.json'
import VexchangeV1Factory from '../../build/VexchangeV1Factory.json'
import VexchangeV2Router01 from '../../build/VexchangeV2Router01.json'
import VexchangeV2Migrator from '../../build/VexchangeV2Migrator.json'
import VexchangeV2Router02 from '../../build/VexchangeV2Router02.json'
import RouterEventEmitter from '../../build/RouterEventEmitter.json'

const overrides = {
  gasLimit: 9999999
}

interface V2Fixture {
  token0: Contract
  token1: Contract
  VVET: Contract
  VVETPartner: Contract
  factoryV1: Contract
  factoryV2: Contract
  router01: Contract
  router02: Contract
  routerEventEmitter: Contract
  router: Contract
  migrator: Contract
  VVETExchangeV1: Contract
  pair: Contract
  VVETPair: Contract
}

export async function v2Fixture(provider: Web3Provider, [wallet]: Wallet[]): Promise<V2Fixture> {

  // deploy tokens
  const tokenA = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)])
  const tokenB = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)])
  const VVET = await deployContract(wallet, VVET9)
  const VVETPartner = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)])

  // deploy V1
  const factoryV1 = await deployContract(wallet, VexchangeV1Factory, [])
  await factoryV1.initializeFactory((await deployContract(wallet, VexchangeV1Exchange, [])).address)

  // deploy V2
  const defaultSwapFee = 30    // Align swapFee with uniswap-V2 original fee
  const defaultPlatformFee = 0 // set platform to zero, equivalent to fee-off in uniswap-V2.
  const platformFeeTo = '0x3000000000000000000000000000000000000000'
  const factoryV2 = await deployContract(wallet, VexchangeV2Factory, [defaultSwapFee, defaultPlatformFee, platformFeeTo, wallet.address], overrides)

  // deploy routers
  const router01 = await deployContract(wallet, VexchangeV2Router01, [factoryV2.address, VVET.address], overrides)
  const router02 = await deployContract(wallet, VexchangeV2Router02, [factoryV2.address, VVET.address], overrides)

  // event emitter for testing
  const routerEventEmitter = await deployContract(wallet, RouterEventEmitter, [])

  // deploy migrator
  const migrator = await deployContract(wallet, VexchangeV2Migrator, [factoryV1.address, router01.address], overrides)

  // initialize V1
  await factoryV1.createExchange(VVETPartner.address, overrides)
  const VVETExchangeV1Address = await factoryV1.getExchange(VVETPartner.address)
  const VVETExchangeV1 = new Contract(VVETExchangeV1Address, JSON.stringify(VexchangeV1Exchange.abi), provider).connect(
    wallet
  )

  // initialize V2
  await factoryV2.createPair(tokenA.address, tokenB.address)
  const pairAddress = await factoryV2.getPair(tokenA.address, tokenB.address)
  const pair = new Contract(pairAddress, JSON.stringify(IVexchangeV2Pair.abi), provider).connect(wallet)

  const token0Address = await pair.token0()
  const token0 = tokenA.address === token0Address ? tokenA : tokenB
  const token1 = tokenA.address === token0Address ? tokenB : tokenA

  await factoryV2.createPair(VVET.address, VVETPartner.address)
  const VVETPairAddress = await factoryV2.getPair(VVET.address, VVETPartner.address)
  const VVETPair = new Contract(VVETPairAddress, JSON.stringify(IVexchangeV2Pair.abi), provider).connect(wallet)

  return {
    token0,
    token1,
    VVET,
    VVETPartner,
    factoryV1,
    factoryV2,
    router01,
    router02,
    router: router02, // the default router, 01 had a minor bug
    routerEventEmitter,
    migrator,
    VVETExchangeV1,
    pair,
    VVETPair
  }
}
