from __future__ import annotations

import json
import logging
import os
import threading
import time
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any, Callable, Iterable, TypeVar
from zoneinfo import ZoneInfo

import pandas as pd
import requests

from stock_report.zones import ZoneResult, assess_watchlist, summarize_zones


LOGGER = logging.getLogger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG = PROJECT_ROOT / "config.example.json"
T = TypeVar("T")


def _call_with_timeout(func: Callable[[], T], timeout: float) -> T:
    """Run func in a daemon thread so a hung HTTP call cannot block process exit."""
    box: dict[str, Any] = {}

    def target() -> None:
        try:
            box["value"] = func()
        except Exception as exc:
            box["error"] = exc

    thread = threading.Thread(target=target, daemon=True)
    thread.start()
    thread.join(timeout)
    if thread.is_alive():
        raise TimeoutError(f"timed out after {timeout:.0f}s")
    if "error" in box:
        raise box["error"]
    return box["value"]


@dataclass(frozen=True)
class Quote:
    symbol: str
    name: str
    price: float | None
    previous_close: float | None
    open_price: float | None
    volume: float | None
    amount: float | None
    change_pct: float | None
    updated_at: str | None = None

    @property
    def from_open_pct(self) -> float | None:
        if self.price is None or not self.open_price:
            return None
        return (self.price / self.open_price - 1) * 100


@dataclass(frozen=True)
class NewsItem:
    title: str
    published_at: str
    source: str = ""
    symbol_name: str = ""
    url: str = ""


def load_config(path: str | Path | None = None) -> dict[str, Any]:
    configured_path = path or os.environ.get("STOCK_REPORT_CONFIG")
    config_path = Path(configured_path) if configured_path else DEFAULT_CONFIG
    with config_path.open("r", encoding="utf-8") as file:
        return json.load(file)


def market_symbol(code: str) -> str:
    if code.startswith(("5", "6", "9")):
        return f"sh{code}"
    return f"sz{code}"


def _number(value: Any) -> float | None:
    try:
        if value in (None, "", "-") or pd.isna(value):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _request_with_retry(
    method: str,
    url: str,
    *,
    attempts: int = 3,
    timeout: int = 12,
    **kwargs: Any,
) -> requests.Response:
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            response = requests.request(method, url, timeout=timeout, **kwargs)
            response.raise_for_status()
            return response
        except requests.RequestException as exc:
            last_error = exc
            if attempt + 1 < attempts:
                time.sleep(1.5 * (attempt + 1))
    assert last_error is not None
    raise last_error


def parse_tencent_response(
    text: str, names: dict[str, str]
) -> dict[str, Quote]:
    quotes: dict[str, Quote] = {}
    for raw_line in text.split(";"):
        if "=" not in raw_line:
            continue
        variable, payload = raw_line.split("=", 1)
        symbol = variable.rsplit("_", 1)[-1].strip()
        parts = payload.strip().strip('"').split("~")
        if len(parts) < 38:
            continue

        code = parts[2]
        display_name = names.get(symbol) or names.get(code) or parts[1] or code
        volume_lots = _number(parts[36]) or _number(parts[6])
        amount_10k = _number(parts[37])
        quotes[symbol] = Quote(
            symbol=symbol,
            name=display_name,
            price=_number(parts[3]),
            previous_close=_number(parts[4]),
            open_price=_number(parts[5]),
            volume=volume_lots * 100 if volume_lots is not None else None,
            amount=amount_10k * 10_000 if amount_10k is not None else None,
            change_pct=_number(parts[32]),
            updated_at=parts[30] if len(parts) > 30 else None,
        )
    return quotes


def fetch_tencent_quotes(
    symbols: Iterable[str], names: dict[str, str]
) -> dict[str, Quote]:
    requested = list(symbols)
    if not requested:
        return {}
    url = "https://qt.gtimg.cn/q=" + ",".join(requested)
    response = _request_with_retry(
        "GET", url, headers={"User-Agent": "Mozilla/5.0"}
    )
    response.encoding = "gbk"
    return parse_tencent_response(response.text, names)


def fetch_nikkei_quote(name: str = "日经225") -> Quote:
    url = "https://query1.finance.yahoo.com/v8/finance/chart/%5EN225"
    response = _request_with_retry(
        "GET",
        url,
        params={"interval": "1m", "range": "1d"},
        headers={"User-Agent": "Mozilla/5.0"},
    )
    result = response.json()["chart"]["result"][0]
    meta = result["meta"]
    timestamps = result.get("timestamp") or []
    quote_data = (result.get("indicators", {}).get("quote") or [{}])[0]
    closes = quote_data.get("close") or []
    opens = quote_data.get("open") or []
    volumes = quote_data.get("volume") or []

    latest_index = next(
        (index for index in range(len(closes) - 1, -1, -1) if closes[index] is not None),
        None,
    )
    price = (
        _number(closes[latest_index])
        if latest_index is not None
        else _number(meta.get("regularMarketPrice"))
    )
    open_price = next(
        (_number(value) for value in opens if _number(value) is not None),
        None,
    )
    previous_close = _number(
        meta.get("chartPreviousClose") or meta.get("previousClose")
    )
    change_pct = (
        (price / previous_close - 1) * 100
        if price is not None and previous_close
        else None
    )
    updated_at = None
    if latest_index is not None and latest_index < len(timestamps):
        updated_at = datetime.fromtimestamp(
            timestamps[latest_index], tz=ZoneInfo("Asia/Tokyo")
        ).strftime("%Y-%m-%d %H:%M")

    return Quote(
        symbol="^N225",
        name=name,
        price=price,
        previous_close=previous_close,
        open_price=open_price,
        volume=sum(_number(value) or 0 for value in volumes) or None,
        amount=None,
        change_pct=change_pct,
        updated_at=updated_at,
    )


def fetch_all_quotes(config: dict[str, Any]) -> tuple[list[Quote], list[Quote], list[str]]:
    index_configs = config["indices"]
    watchlist = config["watchlist"]
    tencent_indices = [
        item for item in index_configs if item.get("source") == "tencent"
    ]
    stock_symbols = [market_symbol(item["code"]) for item in watchlist]
    tencent_symbols = [item["symbol"] for item in tencent_indices] + stock_symbols
    names = {
        **{item["symbol"]: item["name"] for item in tencent_indices},
        **{
            market_symbol(item["code"]): item["name"]
            for item in watchlist
        },
    }
    errors: list[str] = []
    tencent_quotes: dict[str, Quote] = {}
    try:
        tencent_quotes = fetch_tencent_quotes(tencent_symbols, names)
    except Exception as exc:
        LOGGER.exception("Tencent quote request failed")
        errors.append(f"A股行情获取失败：{exc}")

    indices = [
        tencent_quotes[item["symbol"]]
        for item in tencent_indices
        if item["symbol"] in tencent_quotes
    ]
    if any(item.get("source") == "yahoo" for item in index_configs):
        try:
            indices.append(fetch_nikkei_quote())
        except Exception as exc:
            LOGGER.exception("Nikkei quote request failed")
            errors.append(f"日经225行情获取失败：{exc}")

    stocks = [
        tencent_quotes[symbol] for symbol in stock_symbols if symbol in tencent_quotes
    ]
    missing = len(tencent_indices) + len(stock_symbols) - len(tencent_quotes)
    if missing:
        errors.append(f"有 {missing} 个A股标的未返回行情")
    return indices, stocks, errors


def _first_column(frame: pd.DataFrame, candidates: Iterable[str]) -> str | None:
    return next((column for column in candidates if column in frame.columns), None)


def _news_from_frame(
    frame: pd.DataFrame, *, symbol_name: str = "", today: date
) -> list[NewsItem]:
    if frame is None or frame.empty:
        return []
    title_column = _first_column(frame, ["新闻标题", "标题"])
    time_column = _first_column(frame, ["发布时间", "发布日期", "时间"])
    source_column = _first_column(frame, ["文章来源", "来源"])
    url_column = _first_column(frame, ["新闻链接", "链接"])
    if not title_column:
        return []

    items: list[NewsItem] = []
    for _, row in frame.iterrows():
        title = str(row.get(title_column, "")).strip()
        published = str(row.get(time_column, "")).strip() if time_column else ""
        if not title:
            continue
        parsed_time = pd.to_datetime(published, errors="coerce")
        if not pd.isna(parsed_time) and parsed_time.date() != today:
            continue
        items.append(
            NewsItem(
                title=title,
                published_at=published,
                source=str(row.get(source_column, "")).strip() if source_column else "",
                symbol_name=symbol_name,
                url=str(row.get(url_column, "")).strip() if url_column else "",
            )
        )
    return items


def fetch_today_news(config: dict[str, Any], today: date) -> tuple[list[NewsItem], list[str]]:
    news_config = config.get("news", {})
    if not news_config.get("enabled", True):
        return [], []
    try:
        import akshare as ak
    except ImportError:
        return [], ["未安装 AKShare，已跳过新闻"]

    LOGGER.info("正在拉取今日新闻")
    errors: list[str] = []
    candidates: list[NewsItem] = []
    try:
        frame = _call_with_timeout(ak.stock_info_global_cls, 12)
        candidates.extend(_news_from_frame(frame, today=today))
    except TimeoutError:
        LOGGER.warning("Market news timed out")
        errors.append("市场快讯超时")
    except Exception as exc:
        LOGGER.warning("Market news request failed: %s", exc)
        errors.append("市场快讯获取失败")

    watchlist = config["watchlist"][: int(news_config.get("max_symbols", 17))]
    collected: dict[str, list[NewsItem]] = {}

    def fetch_symbol(item: dict[str, str]) -> None:
        try:
            frame = ak.stock_news_em(symbol=item["code"])
            collected[item["code"]] = _news_from_frame(
                frame, symbol_name=item["name"], today=today
            )
        except Exception as exc:
            LOGGER.warning("News request failed for %s: %s", item["code"], exc)

    threads = [
        threading.Thread(target=fetch_symbol, args=(item,), daemon=True)
        for item in watchlist
    ]
    for thread in threads:
        thread.start()
    deadline = time.monotonic() + 25
    for thread in threads:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        thread.join(remaining)
    unfinished = sum(1 for thread in threads if thread.is_alive())
    if unfinished:
        LOGGER.warning("News still pending for %s symbols, continue without them", unfinished)
        errors.append(f"{unfinished} 只个股新闻超时，已跳过")

    for items in collected.values():
        candidates.extend(items)

    unique: dict[str, NewsItem] = {}
    for item in candidates:
        unique.setdefault(item.title, item)
    ordered = sorted(
        unique.values(), key=lambda item: item.published_at, reverse=True
    )
    return ordered[: int(news_config.get("max_items", 10))], errors


def is_a_share_trading_day(day: date) -> bool:
    import exchange_calendars as xcals

    calendar = xcals.get_calendar("XSHG")
    return bool(calendar.is_session(pd.Timestamp(day)))


def _format_number(value: float | None, digits: int = 2) -> str:
    return "-" if value is None else f"{value:,.{digits}f}"


def _format_volume(value: float | None) -> str:
    if value is None:
        return "-"
    if value >= 100_000_000:
        return f"{value / 100_000_000:.2f}亿股"
    if value >= 10_000:
        return f"{value / 10_000:.2f}万股"
    return f"{value:,.0f}股"


def _format_amount(value: float | None) -> str:
    if value is None:
        return "-"
    if value >= 100_000_000:
        return f"{value / 100_000_000:.2f}亿元"
    if value >= 10_000:
        return f"{value / 10_000:.2f}万元"
    return f"{value:,.0f}元"


def _zone_line(zone: ZoneResult) -> str:
    return f"  【{zone.zone}】{zone.reason}"


def _quote_line(quote: Quote, include_from_open: bool) -> str:
    direction = "▲" if (quote.change_pct or 0) > 0 else "▼" if (quote.change_pct or 0) < 0 else "■"
    code = quote.symbol[2:] if quote.symbol[:2] in {"sh", "sz"} else ""
    label = (
        f"{quote.name}({code})"
        if code and code not in {"000001", "399001", "000688", "399006"}
        else quote.name
    )
    parts = [
        f"{direction} {label}",
        _format_number(quote.price),
        f"{_format_number(quote.change_pct)}%",
    ]
    if include_from_open:
        parts.append(f"较开盘 {_format_number(quote.from_open_pct)}%")
    parts.append(f"量 {_format_volume(quote.volume)}")
    if quote.amount is not None:
        parts.append(f"额 {_format_amount(quote.amount)}")
    return "｜".join(parts)


def build_report(
    report_type: str,
    now: datetime,
    indices: list[Quote],
    stocks: list[Quote],
    news: list[NewsItem],
    errors: list[str],
    zones: dict[str, ZoneResult] | None = None,
) -> str:
    is_open = report_type == "open"
    title = "A股开盘30分钟报告" if is_open else "A股收盘报告"
    lines = [f"【{title}】{now:%Y-%m-%d %H:%M}", "", "大盘表现"]
    lines.extend(_quote_line(quote, is_open) for quote in indices)
    lines.extend(["", "自选区间"])
    zone_map = zones or {}
    if zone_map:
        lines.append(summarize_zones(zone_map))
    else:
        lines.append("暂无估值区间")
    lines.extend(["", "自选股表现"])
    for quote in stocks:
        lines.append(_quote_line(quote, is_open))
        code = quote.symbol[2:] if quote.symbol[:2] in {"sh", "sz"} else quote.symbol
        zone = zone_map.get(code)
        if zone:
            lines.append(_zone_line(zone))

    if is_open:
        lines.extend(["", "今日最新消息"])
        if news:
            for item in news:
                label = f"[{item.symbol_name}] " if item.symbol_name else ""
                source = f"（{item.source}）" if item.source else ""
                lines.append(f"• {label}{item.title}{source}")
                if item.url:
                    lines.append(f"  {item.url}")
        else:
            lines.append("• 暂无可用的当日新闻")

    if errors:
        lines.extend(["", "数据提示"])
        lines.extend(f"• {error}" for error in errors)
    lines.extend(["", "数据仅供参考，不构成投资建议。"])
    return "\n".join(lines)


def split_telegram_text(text: str, limit: int = 3900) -> list[str]:
    if len(text) <= limit:
        return [text]
    messages: list[str] = []
    current: list[str] = []
    current_length = 0
    for line in text.splitlines():
        added = len(line) + (1 if current else 0)
        if current and current_length + added > limit:
            messages.append("\n".join(current))
            current = [line]
            current_length = len(line)
        else:
            current.append(line)
            current_length += added
    if current:
        messages.append("\n".join(current))
    return messages


def send_telegram(text: str) -> None:
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        raise RuntimeError(
            "请设置 TELEGRAM_BOT_TOKEN 和 TELEGRAM_CHAT_ID 环境变量"
        )
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    for message in split_telegram_text(text):
        _request_with_retry(
            "POST",
            url,
            data={
                "chat_id": chat_id,
                "text": message,
                "disable_web_page_preview": "true",
            },
        )


def generate_report(
    report_type: str,
    config: dict[str, Any],
    *,
    now: datetime | None = None,
) -> str:
    timezone = ZoneInfo(config.get("timezone", "Asia/Shanghai"))
    current = now or datetime.now(timezone)
    indices, stocks, errors = fetch_all_quotes(config)
    try:
        zones, zone_errors = assess_watchlist(config, stocks)
        errors.extend(zone_errors)
    except Exception as exc:
        LOGGER.exception("Zone assessment failed")
        zones = {}
        errors.append(f"估值区间计算失败：{exc}")
    news: list[NewsItem] = []
    if report_type == "open":
        LOGGER.info("估值完成，开始拉取今日新闻")
        news, news_errors = fetch_today_news(config, current.date())
        errors.extend(news_errors)
    LOGGER.info("报告生成完成")
    text = build_report(report_type, current, indices, stocks, news, errors, zones)
    try:
        push_cloudflare(report_type, current, stocks, zones)
    except Exception:
        LOGGER.exception("Cloudflare push failed")
    return text

def push_cloudflare(report_type, now, stocks, zones):
    write_key = os.environ.get("STOCK_REPORT_WRITE_KEY")
    if not write_key:
        LOGGER.info("Cloudflare push skipped; write key is unset")
        return
    url = os.environ.get(
        "STOCK_REPORT_CLOUDFLARE_URL",
        "https://stock-report.stocknotes.workers.dev/api/reports",
    )
    zone_map = zones or {}
    payload_stocks = []
    for quote in stocks:
        prefix = quote.symbol[:2]
        code = quote.symbol[2:] if prefix in {"sh", "sz", "bj"} else quote.symbol
        zone = zone_map.get(code)
        payload_stocks.append({
            "symbol": code,
            "name": quote.name,
            "price": quote.price,
            "change_pct": quote.change_pct,
            "from_open_pct": quote.from_open_pct,
            "volume": quote.volume,
            "amount": quote.amount,
            "zone": zone.zone if zone else "",
            "reason": zone.reason if zone else "",
            "pe": zone.pe if zone else None,
            "pb": zone.pb if zone else None,
            "pe_pctl": zone.pe_pctl if zone else None,
            "pb_pctl": zone.pb_pctl if zone else None,
            "dy": zone.dy if zone else None,
            "week52_pctl": zone.week52_pctl if zone else None,
        })
    body = {
        "session_date": now.strftime("%Y-%m-%d"),
        "session": report_type,
        "title": report_type,
        "stocks": payload_stocks,
    }
    response = _request_with_retry(
        "POST",
        url,
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + write_key,
        },
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
    )
    LOGGER.info("Cloudflare push ok %s %s", report_type, response.status_code)
