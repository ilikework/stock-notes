from datetime import datetime
from zoneinfo import ZoneInfo

from stock_report.report_bot import Quote, build_report
from stock_report.zones import (
    ZONE_HOLD,
    ZONE_NO_CHASE,
    ZONE_RISK,
    ZONE_UNKNOWN,
    ZONE_WATCH,
    ZoneResult,
    assess_item,
    classify_zone,
    is_fund_code,
    percentile,
    summarize_zones,
)


def test_is_fund_code():
    assert is_fund_code("515100")
    assert is_fund_code("510720")
    assert is_fund_code("159545")
    assert not is_fund_code("600089")
    assert not is_fund_code("002867")


def test_percentile():
    assert percentile([1, 2, 3, 4, 5], 3) == 60
    assert percentile([], 3) is None
    assert percentile([1, 2], None) is None


def test_price_add_line_marks_watch():
    zone, reason = classify_zone(price=17.5, add_below=18)
    assert zone == ZONE_WATCH
    assert "加仓线" in reason


def test_price_above_add_line_without_risk_is_no_chase():
    zone, reason = classify_zone(price=19.06, add_below=18, pe_pctl=70, pb_pctl=43)
    assert zone == ZONE_NO_CHASE
    assert "高于加仓线" in reason


def test_price_risk_line():
    zone, _reason = classify_zone(price=23, add_below=18, risk_above=22)
    assert zone == ZONE_RISK


def test_between_add_and_risk_uses_valuation():
    zone, _reason = classify_zone(
        price=20,
        add_below=18,
        risk_above=22,
        pe_pctl=40,
        pb_pctl=40,
    )
    assert zone == ZONE_HOLD


def test_stock_pb_cheap_is_watch():
    zone, _reason = classify_zone(pe_pctl=40, pb_pctl=20)
    assert zone == ZONE_WATCH


def test_stock_pe_high_pb_not_high_is_no_chase():
    zone, reason = classify_zone(pe_pctl=75, pb_pctl=43)
    assert zone == ZONE_NO_CHASE
    assert "失真" in reason


def test_stock_pb_expensive_is_risk():
    zone, _reason = classify_zone(pe_pctl=60, pb_pctl=80)
    assert zone == ZONE_RISK


def test_dividend_absolute_cheap_high_percentile_is_hold():
    zone, reason = classify_zone(
        dividend_style=True,
        pe=8.6,
        pe_pctl=96,
        dy=4.24,
        y10=1.68,
    )
    assert zone == ZONE_HOLD
    assert "不宜追" in reason


def test_dividend_low_percentile_is_watch():
    zone, _reason = classify_zone(dividend_style=True, pe=6, pe_pctl=20, dy=5, y10=1.7)
    assert zone == ZONE_WATCH


def test_missing_data_is_unknown():
    zone, _reason = classify_zone()
    assert zone == ZONE_UNKNOWN


def test_assess_item_uses_injected_metrics():
    quote = Quote(
        symbol="sh600089",
        name="特变电工",
        price=19.06,
        previous_close=20.05,
        open_price=20.0,
        volume=1,
        amount=1,
        change_pct=-4.94,
    )
    result = assess_item(
        {"code": "600089", "name": "特变电工", "add_below": 18},
        quote,
        metrics={"pe": 16.4, "pb": 1.43, "pe_pctl": 75, "pb_pctl": 43, "last_close": 20.05},
    )
    assert result.zone == ZONE_NO_CHASE
    assert result.code == "600089"


def test_summarize_and_report_include_zones():
    zones = {
        "600089": ZoneResult("600089", ZONE_NO_CHASE, "高于加仓线18"),
        "510720": ZoneResult("510720", ZONE_HOLD, "绝对估值仍低"),
    }
    quote = Quote(
        symbol="sh600089",
        name="特变电工",
        price=19.06,
        previous_close=20.05,
        open_price=20.0,
        volume=10000,
        amount=200000,
        change_pct=-4.94,
    )
    report = build_report(
        "close",
        datetime(2026, 8, 24, 15, 5, tzinfo=ZoneInfo("Asia/Shanghai")),
        [],
        [quote],
        [],
        [],
        zones,
    )
    assert "自选区间" in report
    assert summarize_zones(zones) in report
    assert "【不宜追高】" in report
    assert "高于加仓线18" in report
