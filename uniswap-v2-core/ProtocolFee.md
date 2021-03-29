VexchangeV1:
 - Stores rootKLast to compare with current rootK
     
Example:
 - `platformFee`: 25%
 - Start at 10 ETH 10 USD, K = 100
 - End at 40 ETH, 10 USD, K = 400
 - Balanced would be 20 ETH, 20 USD, K = 400
 - So this scenario represents 100% growth for LPs, expecting 25% to go to platform
 - Target final balances:
    - LPs: 35 ETH, 8.75 USD (87.5%)
    - Platform: 5 ETH, 1.25 USD (12.5%)

Brute-forced formula:
 - `PlatformFee` = 0.25
 - `InitialShares` = 10
 - `OldInvariant` = 100
 - `NewInvariant` = 400
 - `Growth` = sqrt(400 / 100) = 2
 - `PlatformFeeMultiplier` = PlatformFee * (2 - 1) = 0.25
 - `SharesToMultiply` = InitialShares / Growth = 5
 - `PlatformSharesToMint` = SharesToMultiply * PlatformFeeMultiplier = 1.25 shares
 - Final balances:
     - LP Shares: 10
     - Platform Shares: 1.25
     - Assets per share: (40/11.25) ETH, (10/11.25) USD
        - LP Assets: 35.5555555556 ETH, 8.888888889 USD
        - Platform Assets: 4.444444 ETH, 1.1111111 USD

New scenario:
 - Shares: 10
 - Assets: 10 ETH, 10 USD, K = 100
 - Final Assets: 20 ETH, 20 USD, K = 400
 - Target Split:
     - User: 87.5%
     - Platform: 12.5%

Formula:
 - Growth: sqrt(400 / 100) - 1 = 1 (100%)
 - Shares owed: 0.25 * 100% return converted to shares
    - (newRootK - oldRootK)
