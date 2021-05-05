import { Contract } from 'ethers'
import { Web3Provider } from 'ethers/providers'
import { MaxUint256 } from 'ethers/constants'
import {
  BigNumber,
  bigNumberify,
  getAddress,
  keccak256,
  defaultAbiCoder,
  toUtf8Bytes,
  solidityPack
} from 'ethers/utils'

const PERMIT_TYPEHASH = keccak256(
  toUtf8Bytes('Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)')
)

export const MAX_UINT_64: BigNumber = bigNumberify(2).pow(64).sub(1);
export const MAX_UINT_100: BigNumber = bigNumberify(2).pow(100).sub(1);
export const MAX_UINT_112: BigNumber = bigNumberify(2).pow(112).sub(1);
export const MAX_UINT_114: BigNumber = bigNumberify(2).pow(114).sub(1);
export const MAX_UINT_128: BigNumber = bigNumberify(2).pow(114).sub(1);
export const MAX_UINT_256: BigNumber = MaxUint256

export function expandTo18Decimals(n: number): BigNumber {
  return bigNumberify(n).mul(bigNumberify(10).pow(18))
}

/**
 * Assertion / comparison function for BigNumber integer comparison.
 * 
 * Includes a tolerance to accomodate rounding inaccuracy in BigNumber calculations.
 * 
 * @param valueToTest the value to compare
 * @param valueExpected the expected value to compare to
 * @param allowableVariance the amount of variance to tolerate (defaults to 1).
 * @returns true of valueToTest is close-enough to valueExpected
 */
export function closeTo( valueToTest : BigNumber, valueExpected : BigNumber, allowableVariance : BigNumber = bigNumberify(1) ) {
  return ( valueToTest == valueExpected ) || 
         ( valueToTest.gte( valueExpected.sub(allowableVariance) ) && valueToTest.lte( valueExpected.add(allowableVariance) ) );
}

/**
 * Rudimentary implementation of BigNumber square-root mathematical operation.
 * (since the current BigNumber library is lacking)
 * 
 * @param aValue value to take the square root of
 * @returns the square root of aValue, as a BigNumber
 */
export function bigNumberSqrt(aValue: BigNumber) : BigNumber {
  const ONE: BigNumber = bigNumberify(1)
  const TWO: BigNumber = bigNumberify(2)

    let x = bigNumberify(aValue);
    let z = x.add(ONE).div(TWO);
    let y = x;
    while (z.sub(y).lt(0)) {
        y = z;
        z = x.div(z).add(z).div(TWO);
    }
    return y;
}

function getDomainSeparator(name: string, tokenAddress: string, chainId: number) {
  return keccak256(
    defaultAbiCoder.encode(
      ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
      [
        keccak256(toUtf8Bytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')),
        keccak256(toUtf8Bytes(name)),
        keccak256(toUtf8Bytes('1')),
        chainId,
        tokenAddress
      ]
    )
  )
}

export function getCreate2Address(
  factoryAddress: string,
  [tokenA, tokenB]: [string, string],
  bytecode: string
): string {
  const [token0, token1] = tokenA < tokenB ? [tokenA, tokenB] : [tokenB, tokenA]
  const create2Inputs = [
    '0xff',
    factoryAddress,
    keccak256(solidityPack(['address', 'address'], [token0, token1])),
    keccak256(bytecode)
  ]
  const sanitizedInputs = `0x${create2Inputs.map(i => i.slice(2)).join('')}`
  return getAddress(`0x${keccak256(sanitizedInputs).slice(-40)}`)
}

export async function getApprovalDigest(
  token: Contract,
  approve: {
    owner: string
    spender: string
    value: BigNumber
  },
  nonce: BigNumber,
  deadline: BigNumber,
  chainId: number
): Promise<string> {
  const name = await token.name()
  const DOMAIN_SEPARATOR = getDomainSeparator(name, token.address, chainId)
  return keccak256(
    solidityPack(
      ['bytes1', 'bytes1', 'bytes32', 'bytes32'],
      [
        '0x19',
        '0x01',
        DOMAIN_SEPARATOR,
        keccak256(
          defaultAbiCoder.encode(
            ['bytes32', 'address', 'address', 'uint256', 'uint256', 'uint256'],
            [PERMIT_TYPEHASH, approve.owner, approve.spender, approve.value, nonce, deadline]
          )
        )
      ]
    )
  )
}

export async function mineBlock(provider: Web3Provider, timestamp: number): Promise<void> {
  await new Promise(async (resolve, reject) => {
    ;(provider._web3Provider.sendAsync as any)(
      { jsonrpc: '2.0', method: 'evm_mine', params: [timestamp] },
      (error: any, result: any): void => {
        if (error) {
          reject(error)
        } else {
          resolve(result)
        }
      }
    )
  })
}

export function encodePrice(reserve0: BigNumber, reserve1: BigNumber) {
  return [reserve1.mul(bigNumberify(2).pow(112)).div(reserve0), reserve0.mul(bigNumberify(2).pow(112)).div(reserve1)]
}
