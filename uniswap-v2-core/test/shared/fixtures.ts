import { Contract, Wallet } from 'ethers'
import { Web3Provider } from 'ethers/providers'
import { BigNumber, bigNumberify } from 'ethers/utils'
import { deployContract } from 'ethereum-waffle'

import { expandTo18Decimals } from './utilities'

import ERC20 from '../../build/ERC20.json'
import UniswapV2Factory from '../../build/UniswapV2Factory.json'
import UniswapV2Pair from '../../build/UniswapV2Pair.json'

interface FactoryFixture {
  factory: Contract
  defaultSwapFee: BigNumber
  defaultPlatformFee: BigNumber

}

const overrides = {
  gasLimit: 9999999
}

export async function factoryFixture(_: Web3Provider, [wallet]: Wallet[]): Promise<FactoryFixture> {
  // Initial static default - defaults to uniswap original fee structure with no 'feeTo' set.
  const defaultSwapFee: BigNumber = bigNumberify(30)
  const defaultPlatformFee: BigNumber = bigNumberify(0)

  const factory = await deployContract(wallet, UniswapV2Factory, [defaultSwapFee, defaultPlatformFee, wallet.address], overrides)
  return { factory, defaultSwapFee, defaultPlatformFee }
}

interface PairFixture extends FactoryFixture {
  token0: Contract
  token1: Contract
  pair: Contract
}

export async function pairFixture(provider: Web3Provider, [wallet]: Wallet[]): Promise<PairFixture> {
  const { factory, defaultSwapFee, defaultPlatformFee } = await factoryFixture(provider, [wallet])

  const tokenA = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)], overrides)
  const tokenB = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)], overrides)

  await factory.createPair(tokenA.address, tokenB.address, overrides)
  const pairAddress = await factory.getPair(tokenA.address, tokenB.address)
  const pair = new Contract(pairAddress, JSON.stringify(UniswapV2Pair.abi), provider).connect(wallet)

  const token0Address = (await pair.token0()).address
  const token0 = tokenA.address === token0Address ? tokenA : tokenB
  const token1 = tokenA.address === token0Address ? tokenB : tokenA

  return { factory, defaultSwapFee, defaultPlatformFee, token0, token1, pair }
}
