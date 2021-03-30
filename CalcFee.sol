// SPDX-License-Identifier: UNLICENSE// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.7.0 <0.9.0;

contract CalcFee {

    // Uniswap stores reserves as uint112s, this means we can multiply by uint144 without overflowing
    // (256 - 112 = 144) = UINT144 = 22300745198530623141535718272648361505980416
    
    uint256 public constant SQUARED_ACCURACY = 1_000_000_000_000_000_000_000_000_000_000_000_000_000_000; // 1000000000000000000000000000000000000000000
    uint256 public constant ACCURACY         = 1_000_000_000_000_000_000_000; // 1000000000000000000000
    uint16  public constant FEE_ACCURACY     = 10_000;

    function sqrt(uint y) internal pure returns (uint z) {
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

    function calculate_fee(uint256 new_k, uint256 old_k, uint256 protocol_fee, uint256 circulating_shares) public pure returns (uint256){
        // NOTE: Assumes new_k fits within uin112, this may require storing invariant as a uin112, or more likely uint128 and adjusting ACCURACY to be uin128
        // NTOE: _scaledGrowth peaks at 256 bits if we assume new_k and SQUARED_ACCURACY together are <=256 bits, need to test the extremes for overflow
        uint256 _scaledGrowth = sqrt((new_k * SQUARED_ACCURACY) / old_k);                   // Assert: < uint256
        uint256 _scaledMultiplier = ACCURACY - (SQUARED_ACCURACY / _scaledGrowth);          // Assert: < uint128
        uint256 _scaledtargetOwnership = _scaledMultiplier * protocol_fee / FEE_ACCURACY;   // Assert: < uint144 during maths, ends < uint128
        uint256 _sharesToIssueAsFee = (_scaledtargetOwnership * circulating_shares) / (ACCURACY - _scaledtargetOwnership); // Assert: < uint256 during maths, assuming circulating shares < uint128
        
        return _sharesToIssueAsFee;
    }

}
