// SPDX-License-Identifier: UNLICENSE// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.5.16;

contract CalcFee {

    // Uniswap stores reserves as uint112s, this means we can multiply by uint144 without overflowing
    // (256 - 112 = 144) = UINT144 = 22300745198530623141535718272648361505980416
    // However, using 144 bits of decimal accuracy for a 112 bit divisor is overkill, so let's use 128 & 128
  
    // ASSERT: SQUARED_ACCURACY, ACCURACY, & FEE_ACCURACY all fit within a uint128 (2**128 - 1)
    uint256 public constant SQUARED_ACCURACY = 100_000_000_000_000_000_000_000_000_000_000_000_000; // 100000000000000000000000000000000000000
    uint256 public constant ACCURACY         = 10_000_000_000_000_000_000;                          // 10000000000000000000
    uint16  public constant FEE_ACCURACY     = 10_000;

    function sqrt(uint y) public pure returns (uint z) {
        if (y > 3) {
            z = y;
            uint x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }

    // Guide for calling:
    function calculate_fee(uint256 new_k, uint256 old_k, uint256 protocol_fee, uint256 circulating_shares) public pure returns (uint256 sharesToMint) {
        if (new_k > 2**128 -1) { return 0; }
        if (old_k > 2**128 -1) { return 0; }
        if (circulating_shares > FEE_ACCURACY) { return 0; }
        if (circulating_shares > 2**128 -1) { return 0; }
        
        uint256 _scaledGrowth = sqrt((new_k * SQUARED_ACCURACY) / old_k);                   // Assert: < uint256
        uint256 _scaledMultiplier = ACCURACY - (SQUARED_ACCURACY / _scaledGrowth);          // Assert: < uint128
        uint256 _scaledTargetOwnership = _scaledMultiplier * protocol_fee / FEE_ACCURACY;   // Assert: < uint144 during maths, ends < uint128

        // NOTE: circulating_shares in uniV2 is initialized by taking the sqrt(token_a * token_b) ensuring that as a number it will be larger
        // than the large of the two numbers. So if token_a has 18 decimals and token_b has 10 decimals we can expect circulating_shares / liquidity
        // to have ~14 decimals. This places a bound that no reasonable tokens should exceed ~128 bits (would allow for 1e20 balances with decimals).
        // Neverthelss, it would be worth adding an escape valve that if the liquidity exceeeds the intended accuracy we return 0 and set the fee to 0
        uint256 _sharesToIssueAsFee = (_scaledTargetOwnership * circulating_shares) / (ACCURACY - _scaledTargetOwnership); // Assert: < uint256 during maths, assuming circulating shares < uint128
        
        return _sharesToIssueAsFee;
    }
    
    function sqrt_calculate_fee(uint256 new_k, uint256 old_k, uint256 protocol_fee, uint256 circulating_shares) public pure returns (uint256 sharesToMint) {
        if (circulating_shares > FEE_ACCURACY) { return 0; }
        if (circulating_shares > 2**128 -1) { return 0; }
        
        uint256 _sqrtNewK = sqrt(new_k);
        uint256 _sqrtOldK = sqrt(old_k);
    
        uint256 _scaledGrowth = (_sqrtNewK * ACCURACY) / _sqrtOldK;                // Assert: < uint256
        uint256 _scaledMultiplier = ACCURACY - (SQUARED_ACCURACY / _scaledGrowth);         // Assert: < uint128
        uint256 _scaledTargetOwnership = _scaledMultiplier * protocol_fee / FEE_ACCURACY;  // Assert: < uint144 during maths, ends < uint128

        // NOTE: circulating_shares in uniV2 is initialized by taking the sqrt(token_a * token_b) ensuring that as a number it will be larger
        // than the large of the two numbers. So if token_a has 18 decimals and token_b has 10 decimals we can expect circulating_shares / liquidity
        // to have ~14 decimals. This places a bound that no reasonable tokens should exceed ~128 bits (would allow for 1e20 balances with decimals).
        // Neverthelss, it would be worth adding an escape valve that if the liquidity exceeeds the intended accuracy we return 0 and set the fee to 0
        uint256 _sharesToIssueAsFee = (_scaledTargetOwnership * circulating_shares) / (ACCURACY - _scaledTargetOwnership); // Assert: < uint256 during maths, assuming circulating shares < uint128
        
        return _sharesToIssueAsFee;
    }

}
