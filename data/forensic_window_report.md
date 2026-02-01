# Forensic Window Analysis: Did We Have Time?
**Hypothesis**: High volatility requires faster scans. This report measures the "Reaction Window" (blocks detectable before liquidation).

| Time | User | Profit | Liquidation Block | Detectable Start | Window (Blocks) | Feasible Tier |
|---|---|---|---|---|---|---|
| 18:44:05 | 0x2aFc | $12196 | 41547849 | Atomic | 0 | ❌ IMPOSSIBLE |
| 14:27:27 | 0x429c | $16867 | 41540150 | Atomic | 0 | ❌ IMPOSSIBLE |
| 14:38:23 | 0x9842 | $30191 | 41540478 | Atomic | 0 | ❌ IMPOSSIBLE |
| 17:10:29 | 0xF3fe | $16138 | 41545041 | Atomic | 0 | ❌ IMPOSSIBLE |
| 18:44:05 | 0xd86B | $12025 | 41547849 | Atomic | 0 | ❌ IMPOSSIBLE |
| 17:10:25 | 0x8915 | $8531 | 41545039 | Atomic | 0 | ❌ IMPOSSIBLE |
| 18:24:33 | 0x9842 | $76890 | 41547263 | 41547262 | 1 | ⚡ TIER 1 (Alchemy) |
| 17:12:25 | 0x9610 | $11747 | 41545099 | Atomic | 0 | ❌ IMPOSSIBLE |
| 18:44:05 | 0xc559 | $7320 | 41547849 | Atomic | 0 | ❌ IMPOSSIBLE |
| 18:44:05 | 0xAB82 | $4923 | 41547849 | Atomic | 0 | ❌ IMPOSSIBLE |
| 17:08:55 | 0x8b6B | $4340 | 41544994 | Atomic | 0 | ❌ IMPOSSIBLE |
| 17:11:55 | 0x0156 | $6707 | 41545084 | Atomic | 0 | ❌ IMPOSSIBLE |
| 18:38:45 | 0xa8dB | $6041 | 41547689 | Atomic | 0 | ❌ IMPOSSIBLE |
| 17:12:59 | 0xab15 | $6177 | 41545116 | Atomic | 0 | ❌ IMPOSSIBLE |
| 17:10:55 | 0xDDDa | $3133 | 41545054 | Atomic | 0 | ❌ IMPOSSIBLE |
| 14:23:23 | 0xfa82 | $2512 | 41540028 | Atomic | 0 | ❌ IMPOSSIBLE |
| 18:40:57 | 0x8EbA | $2257 | 41547755 | Atomic | 0 | ❌ IMPOSSIBLE |
| 17:12:25 | 0xC717 | $2457 | 41545099 | Atomic | 0 | ❌ IMPOSSIBLE |
| 17:12:29 | 0x93a1 | $2211 | 41545101 | Atomic | 0 | ❌ IMPOSSIBLE |
| 18:40:55 | 0x407e | $2221 | 41547754 | Atomic | 0 | ❌ IMPOSSIBLE |
| 18:43:35 | 0x4A79 | $2195 | 41547834 | Atomic | 0 | ❌ IMPOSSIBLE |
| 18:44:05 | 0xA872 | $2183 | 41547849 | Atomic | 0 | ❌ IMPOSSIBLE |
| 17:10:55 | 0xF372 | $1716 | 41545054 | Atomic | 0 | ❌ IMPOSSIBLE |
| 18:44:07 | 0x4c8C | $1699 | 41547850 | Atomic | 0 | ❌ IMPOSSIBLE |
| 18:43:39 | 0x929E | $1646 | 41547836 | Atomic | 0 | ❌ IMPOSSIBLE |
| 18:44:07 | 0xe128 | $1556 | 41547850 | Atomic | 0 | ❌ IMPOSSIBLE |
| 17:12:55 | 0x124B | $1550 | 41545114 | Atomic | 0 | ❌ IMPOSSIBLE |
| 18:44:11 | 0x9f82 | $3373 | 41547852 | 41547849 | 3 | ⚠️ TIER 2 (DRPC) |
| 18:18:43 | 0xc5a5 | $1490 | 41547088 | Atomic | 0 | ❌ IMPOSSIBLE |
| 17:10:59 | 0x41DC | $1434 | 41545056 | Atomic | 0 | ❌ IMPOSSIBLE |
| 18:44:05 | 0x6A19 | $1251 | 41547849 | Atomic | 0 | ❌ IMPOSSIBLE |
| 18:44:05 | 0x22d1 | $1206 | 41547849 | Atomic | 0 | ❌ IMPOSSIBLE |
| 17:11:55 | 0x39D0 | $1149 | 41545084 | Atomic | 0 | ❌ IMPOSSIBLE |
| 17:05:57 | 0x5391 | $1006 | 41544905 | Atomic | 0 | ❌ IMPOSSIBLE |
| 14:38:53 | 0xB0b5 | $1002 | 41540493 | Atomic | 0 | ❌ IMPOSSIBLE |
| 17:10:25 | 0x251c | $931 | 41545039 | Atomic | 0 | ❌ IMPOSSIBLE |
| 18:39:23 | 0x10Ea | $1448 | 41547708 | 41547705 | 3 | ⚠️ TIER 2 (DRPC) |
| 18:39:23 | 0x3185 | $1112 | 41547708 | 41547705 | 3 | ⚠️ TIER 2 (DRPC) |
| 18:44:05 | 0x2Df2 | $927 | 41547849 | Atomic | 0 | ❌ IMPOSSIBLE |
| 18:40:57 | 0xfb40 | $919 | 41547755 | Atomic | 0 | ❌ IMPOSSIBLE |
| 18:44:09 | 0xB291 | $955 | 41547851 | 41547849 | 2 | ⚠️ TIER 2 (DRPC) |
| 18:26:15 | 0x8eDb | $918 | 41547314 | Atomic | 0 | ❌ IMPOSSIBLE |
| 17:11:55 | 0x5473 | $862 | 41545084 | Atomic | 0 | ❌ IMPOSSIBLE |
| 18:23:43 | 0x991c | $847 | 41547238 | Atomic | 0 | ❌ IMPOSSIBLE |
| 18:43:47 | 0x3f83 | $1016 | 41547840 | 41547836 | 4 | ⚠️ TIER 2 (DRPC) |
| 18:44:07 | 0x0c23 | $870 | 41547850 | 41547849 | 1 | ⚡ TIER 1 (Alchemy) |
| 18:38:45 | 0x052D | $791 | 41547689 | Atomic | 0 | ❌ IMPOSSIBLE |
| 17:35:27 | 0x57D7 | $778 | 41545790 | Atomic | 0 | ❌ IMPOSSIBLE |
| 18:43:35 | 0xb6a8 | $775 | 41547834 | Atomic | 0 | ❌ IMPOSSIBLE |
| 18:44:11 | 0xd087 | $804 | 41547852 | 41547849 | 3 | ⚠️ TIER 2 (DRPC) |