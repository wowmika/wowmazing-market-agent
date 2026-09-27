from __future__ import annotations

import json

from quant_analysis import analyze_trade_quant_metrics


TEST_TRADES = [
    {
        "net_r": 2.0,
        "gross_r_before_costs": 2.1,
        "gross_r": 2.05,
    },
    {
        "net_r": -1.0,
        "gross_r_before_costs": -0.9,
        "gross_r": -0.95,
    },
    {
        "net_r": 1.5,
        "gross_r_before_costs": 1.6,
        "gross_r": 1.55,
    },
    {
        "net_r": -1.0,
        "gross_r_before_costs": -0.9,
        "gross_r": -0.95,
    },
    {
        "net_r": -0.8,
        "gross_r_before_costs": -0.7,
        "gross_r": -0.75,
    },
    {
        "net_r": 2.3,
        "gross_r_before_costs": 2.4,
        "gross_r": 2.35,
    },
]


if __name__ == "__main__":
    result = analyze_trade_quant_metrics(
        TEST_TRADES,
        {
            "risk": {
                "configured_risk_pct": 1.0,
            }
        },
    )

    print("=" * 70)
    print("WOWMAZING QUANTITATIVE ANALYSIS TEST")
    print("=" * 70)
    print()
    print(json.dumps(result, indent=2))
    print()
    print("=" * 70)
    print("QUANTITATIVE ANALYSIS TEST COMPLETE")
    print("=" * 70)
