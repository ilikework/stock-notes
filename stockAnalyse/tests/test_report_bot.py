from datetime import datetime
from zoneinfo import ZoneInfo

from main import parse_time
from stock_report.report_bot import (
    NewsItem,
    Quote,
    build_report,
    is_a_share_trading_day,
    market_symbol,
    parse_tencent_response,
    split_telegram_text,
)


def test_market_symbol():
    assert market_symbol("600570") == "sh600570"
    assert market_symbol("515100") == "sh515100"
    assert market_symbol("002867") == "sz002867"


def test_parse_tencent_response():
    parts = [""] * 60
    parts[1] = "恒生电子"
    parts[2] = "600570"
    parts[3] = "31.50"
    parts[4] = "30.00"
    parts[5] = "30.50"
    parts[30] = "20260717100000"
    parts[32] = "5.00"
    parts[36] = "1234"
    parts[37] = "388.71"
    text = 'v_sh600570="' + "~".join(parts) + '";'

    quote = parse_tencent_response(text, {"sh600570": "恒生电子"})["sh600570"]

    assert quote.price == 31.5
    assert quote.change_pct == 5.0
    assert quote.volume == 123_400
    assert quote.amount == 3_887_100
    assert round(quote.from_open_pct, 2) == 3.28


def test_build_open_report():
    quote = Quote(
        symbol="sh000001",
        name="上证指数",
        price=3200,
        previous_close=3180,
        open_price=3190,
        volume=100_000_000,
        amount=50_000_000_000,
        change_pct=0.63,
    )
    report = build_report(
        "open",
        datetime(2026, 7, 17, 10, 0, tzinfo=ZoneInfo("Asia/Shanghai")),
        [quote],
        [quote],
        [NewsItem("测试新闻", "2026-07-17 09:55", symbol_name="恒生电子")],
        [],
    )

    assert "A股开盘30分钟报告" in report
    assert "较开盘" in report
    assert "自选区间" in report
    assert "暂无估值区间" in report
    assert "[恒生电子] 测试新闻" in report
    assert "不构成投资建议" in report


def test_split_telegram_text():
    messages = split_telegram_text("第一行\n第二行\n第三行", limit=4)
    assert messages == ["第一行", "第二行", "第三行"]


def test_parse_time():
    assert parse_time("10:00") == (10, 0)
    assert parse_time("15:05") == (15, 5)


def test_a_share_trading_calendar():
    assert is_a_share_trading_day(datetime(2026, 7, 17).date())
    assert not is_a_share_trading_day(datetime(2026, 7, 18).date())
