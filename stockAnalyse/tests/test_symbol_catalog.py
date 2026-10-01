from datetime import datetime
from zoneinfo import ZoneInfo

from stock_report.symbol_catalog import build_rows, refresh_symbol_catalog, rows_problem


def test_rows_problem_rejects_partial_and_missing_fund():
    assert rows_problem([["515100", "红利低波100ETF景顺", "hldb"]]) == "名单不完整"
    rows = [[f"{i:06d}", "名称", "mc"] for i in range(2000)]
    assert rows_problem(rows) == "缺少515100"
    rows[0] = ["515100", "红利低波100ETF景顺", "hldb"]
    assert rows_problem(rows) == ""


def test_build_rows_keeps_515100_and_alias():
    raw = {
        "515100": {"name": "红利低波100ETF景顺", "symbol": "sh515100", "node": "etf_hq_fund"},
        "600519": {"name": "贵州茅台", "symbol": "sh600519", "node": "sh_a"},
        "399001": {"name": "深证成指", "symbol": "sz399001", "node": "sz_a"},
        "920000": {"name": "安达", "symbol": "bj920000", "node": "etf_hq_fund"},
    }
    rows = build_rows(raw, {"515100": "红利100"})
    by_code = {row[0]: row for row in rows}
    assert "399001" not in by_code
    assert "920000" not in by_code
    assert by_code["600519"][2] == "gzmt"
    assert by_code["515100"][1] == "红利低波100ETF景顺"
    assert by_code["515100"][3] == "红利100"


def test_failed_fetch_does_not_upload_rows():
    calls = []

    def get(url):
        raise RuntimeError("down")

    def post(path, payload):
        calls.append(payload)

    ok = refresh_symbol_catalog(
        {"timezone": "Asia/Tokyo", "watchlist": []},
        now=datetime(2026, 7, 17, 16, 5, tzinfo=ZoneInfo("Asia/Tokyo")),
        get=get,
        post=post,
    )
    assert ok is False
    assert calls == [{"error": "名单拉取失败"}]
    assert "rows" not in calls[0]


def test_non_trading_day_skips_refresh():
    calls = []

    def post(path, payload):
        calls.append(payload)

    ok = refresh_symbol_catalog(
        {"timezone": "Asia/Tokyo", "watchlist": []},
        now=datetime(2026, 7, 18, 16, 5, tzinfo=ZoneInfo("Asia/Tokyo")),
        get=lambda url: (_ for _ in ()).throw(AssertionError("should not fetch")),
        post=post,
    )
    assert ok is False
    assert calls == []


def test_complete_list_is_posted():
    posted = []

    def get(url):
        if "StockCount" in url:
            return 2
        if "node=sh_a" in url:
            return [
                {"code": "600519", "name": "贵州茅台", "symbol": "sh600519"},
                {"code": "600000", "name": "浦发银行", "symbol": "sh600000"},
            ]
        if "node=sz_a" in url:
            return [
                {"code": "000001", "name": "平安银行", "symbol": "sz000001"},
                {"code": "300750", "name": "宁德时代", "symbol": "sz300750"},
            ]
        if "node=etf_hq_fund" in url:
            return [
                {"code": "515100", "name": "红利低波100ETF景顺", "symbol": "sh515100"},
                {"code": "159915", "name": "创业板ETF", "symbol": "sz159915"},
            ]
        raise AssertionError(url)

    def post(path, payload):
        posted.append(payload)

    # Count is below the production minimum, so this complete-but-small
    # download must be rejected and must not replace the stored list.
    ok = refresh_symbol_catalog(
        {"timezone": "Asia/Tokyo", "watchlist": [{"code": "515100", "name": "红利100"}]},
        now=datetime(2026, 7, 17, 16, 5, tzinfo=ZoneInfo("Asia/Tokyo")),
        get=get,
        post=post,
    )
    assert ok is False
    assert posted == [{"error": "名单不完整"}]
