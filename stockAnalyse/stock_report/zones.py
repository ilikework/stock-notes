from __future__ import annotations

import json
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Iterable, Protocol

import pandas as pd
import requests


class _Priced(Protocol):
    symbol: str
    price: float | None


LOGGER = logging.getLogger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = PROJECT_ROOT / "cache" / "zones"
CACHE_TTL = timedelta(hours=12)
HTTP_TIMEOUT = 12
WATCHLIST_TIMEOUT = 75

ZONE_WATCH = "适合关注"
ZONE_HOLD = "中性持有"
ZONE_NO_CHASE = "不宜追高"
ZONE_RISK = "风险偏高"
ZONE_UNKNOWN = "数据不足"

# 红利类 ETF：分位高不等于绝对贵，优先看绝对 PE 和股息相对国债。
DEFAULT_INDEX_CODE = {
    "515100": "930955",
    "510720": "000151",
    "513020": "931573",
}
DEFAULT_DIVIDEND_FUNDS = {"515100", "510720"}


@dataclass(frozen=True)
class ZoneResult:
    code: str
    zone: str
    reason: str
    pe: float | None = None
    pb: float | None = None
    pe_pctl: float | None = None
    pb_pctl: float | None = None
    dy: float | None = None
    week52_pctl: float | None = None


def is_fund_code(code: str) -> bool:
    return code.startswith(("15", "51", "56", "58"))


def percentile(series: Iterable[Any], value: float | None) -> float | None:
    if value is None:
        return None
    values = pd.to_numeric(pd.Series(list(series)), errors="coerce").dropna()
    if values.empty:
        return None
    return float((values <= value).mean() * 100)


def classify_zone(
    *,
    price: float | None = None,
    add_below: float | None = None,
    risk_above: float | None = None,
    pe: float | None = None,
    pb: float | None = None,
    pe_pctl: float | None = None,
    pb_pctl: float | None = None,
    dividend_style: bool = False,
    dy: float | None = None,
    y10: float | None = None,
    week52_pctl: float | None = None,
) -> tuple[str, str]:
    """Return (zone, short reason). Price bands override valuation when set."""
    if price is not None and risk_above is not None and price >= risk_above:
        return ZONE_RISK, f"现价{_n(price)}进入风险线{_n(risk_above)}以上"
    if price is not None and add_below is not None and price <= add_below:
        return ZONE_WATCH, f"现价{_n(price)}进入加仓线{_n(add_below)}以下"
    if (
        price is not None
        and add_below is not None
        and risk_above is None
        and price > add_below
    ):
        extra = _valuation_reason(
            pe=pe,
            pb=pb,
            pe_pctl=pe_pctl,
            pb_pctl=pb_pctl,
            dividend_style=dividend_style,
            dy=dy,
            y10=y10,
            week52_pctl=week52_pctl,
        )
        reason = f"现价{_n(price)}高于加仓线{_n(add_below)}"
        if extra:
            reason = f"{reason}｜{extra}"
        return ZONE_NO_CHASE, reason

    if dividend_style:
        return _classify_dividend(
            pe=pe, pe_pctl=pe_pctl, dy=dy, y10=y10, week52_pctl=week52_pctl
        )
    return _classify_stock(
        pe=pe,
        pb=pb,
        pe_pctl=pe_pctl,
        pb_pctl=pb_pctl,
        week52_pctl=week52_pctl,
    )


def _n(value: float | None, digits: int = 2) -> str:
    if value is None:
        return "-"
    if abs(value) >= 100:
        return f"{value:.1f}"
    return f"{value:.{digits}f}"


def _pctl_text(label: str, value: float | None) -> str | None:
    if value is None:
        return None
    return f"{label}分位{_n(value, 0)}%"


def _valuation_reason(
    *,
    pe: float | None,
    pb: float | None,
    pe_pctl: float | None,
    pb_pctl: float | None,
    dividend_style: bool,
    dy: float | None,
    y10: float | None,
    week52_pctl: float | None,
) -> str:
    parts: list[str] = []
    if pe is not None:
        parts.append(f"PE{_n(pe)}")
    parts.append(_pctl_text("PE", pe_pctl) or "")
    if pb is not None:
        parts.append(f"PB{_n(pb)}")
    parts.append(_pctl_text("PB", pb_pctl) or "")
    if dividend_style and dy is not None:
        text = f"股息{_n(dy)}%"
        if y10 is not None:
            text += f" vs国债{_n(y10)}%"
        parts.append(text)
    parts.append(_pctl_text("一年价格", week52_pctl) or "")
    return "｜".join(part for part in parts if part)


def _classify_dividend(
    *,
    pe: float | None,
    pe_pctl: float | None,
    dy: float | None,
    y10: float | None,
    week52_pctl: float | None,
) -> tuple[str, str]:
    reason = _valuation_reason(
        pe=pe,
        pb=None,
        pe_pctl=pe_pctl,
        pb_pctl=None,
        dividend_style=True,
        dy=dy,
        y10=y10,
        week52_pctl=week52_pctl,
    )
    cheap_yield = (
        dy is not None and y10 is not None and dy >= y10 + 1.5
    )
    if pe is not None and pe <= 9 and (pe_pctl is None or pe_pctl >= 70) and cheap_yield:
        return ZONE_HOLD, f"绝对估值仍低、分位偏高，宜持有不宜追｜{reason}"
    if pe_pctl is not None and pe_pctl < 30:
        return ZONE_WATCH, reason or "指数估值偏低"
    if pe is not None and pe > 12 and pe_pctl is not None and pe_pctl > 70:
        return ZONE_NO_CHASE, reason or "估值偏高"
    if pe_pctl is not None and pe_pctl > 70:
        return ZONE_NO_CHASE, reason or "估值分位偏高"
    if reason:
        return ZONE_HOLD, reason
    return _classify_by_52w(week52_pctl)


def _classify_stock(
    *,
    pe: float | None,
    pb: float | None,
    pe_pctl: float | None,
    pb_pctl: float | None,
    week52_pctl: float | None,
) -> tuple[str, str]:
    reason = _valuation_reason(
        pe=pe,
        pb=pb,
        pe_pctl=pe_pctl,
        pb_pctl=pb_pctl,
        dividend_style=False,
        dy=None,
        y10=None,
        week52_pctl=week52_pctl,
    )
    if pb_pctl is not None and pb_pctl < 30 and (pe_pctl is None or pe_pctl < 70):
        return ZONE_WATCH, reason
    if pe_pctl is not None and pe_pctl < 30 and (pb_pctl is None or pb_pctl < 50):
        return ZONE_WATCH, reason
    if pb_pctl is not None and pb_pctl > 70:
        return ZONE_RISK, reason
    if pe_pctl is not None and pe_pctl > 70 and pb_pctl is not None and pb_pctl > 50:
        return ZONE_RISK, reason
    if pe_pctl is not None and pe_pctl > 70 and (pb_pctl is None or pb_pctl <= 50):
        return ZONE_NO_CHASE, f"PE分位高、PB不高，倍数或失真｜{reason}"
    if reason:
        return ZONE_HOLD, reason
    return _classify_by_52w(week52_pctl)


def _classify_by_52w(week52_pctl: float | None) -> tuple[str, str]:
    if week52_pctl is None:
        return ZONE_UNKNOWN, "缺少估值数据"
    reason = f"一年价格分位{_n(week52_pctl, 0)}%"
    if week52_pctl < 30:
        return ZONE_WATCH, reason
    if week52_pctl > 80:
        return ZONE_NO_CHASE, reason
    return ZONE_HOLD, reason


def _cache_path(code: str) -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return CACHE_DIR / f"{code}.json"


def _read_cache(code: str) -> dict[str, Any] | None:
    path = _cache_path(code)
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    fetched = payload.get("fetched_at")
    if not fetched:
        return None
    fetched_at = datetime.fromisoformat(fetched)
    if datetime.now() - fetched_at > CACHE_TTL:
        return None
    return payload.get("metrics")


def _write_cache(code: str, metrics: dict[str, Any]) -> None:
    path = _cache_path(code)
    path.write_text(
        json.dumps(
            {"fetched_at": datetime.now().isoformat(timespec="seconds"), "metrics": metrics},
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def _scale_multiple(multiple: float | None, last_close: float | None, price: float | None) -> float | None:
    if multiple is None or not last_close or price is None:
        return multiple
    return multiple * price / last_close


def fetch_stock_metrics(code: str) -> dict[str, Any]:
    url = "https://datacenter-web.eastmoney.com/api/data/v1/get"
    params = {
        "sortColumns": "TRADE_DATE",
        "sortTypes": "-1",
        "pageSize": "1500",
        "pageNumber": "1",
        "reportName": "RPT_VALUEANALYSIS_DET",
        "columns": "ALL",
        "source": "WEB",
        "client": "WEB",
        "filter": f'(SECURITY_CODE="{code}")',
    }
    response = requests.get(
        url, params=params, timeout=HTTP_TIMEOUT, headers={"User-Agent": "Mozilla/5.0"}
    )
    response.raise_for_status()
    rows = (response.json().get("result") or {}).get("data")
    if not rows:
        raise RuntimeError(f"{code} 无估值数据")
    frame = pd.DataFrame(rows)
    frame["数据日期"] = pd.to_datetime(frame["TRADE_DATE"])
    frame.sort_values("数据日期", inplace=True, ignore_index=True)
    cutoff = frame["数据日期"].max() - pd.Timedelta(days=365 * 5)
    hist = frame[frame["数据日期"] >= cutoff]
    last = hist.iloc[-1] if not hist.empty else frame.iloc[0]
    pe = _to_float(last.get("PE_TTM"))
    pb = _to_float(last.get("PB_MRQ"))
    closes = pd.to_numeric(hist["CLOSE_PRICE"], errors="coerce").dropna()
    week = closes.tail(252)
    last_close = _to_float(last.get("CLOSE_PRICE"))
    return {
        "pe": pe,
        "pb": pb,
        "pe_pctl": percentile(hist["PE_TTM"], pe),
        "pb_pctl": percentile(hist["PB_MRQ"], pb),
        "last_close": last_close,
        "week52_low": float(week.min()) if not week.empty else None,
        "week52_high": float(week.max()) if not week.empty else None,
        "asof": str(pd.Timestamp(last["数据日期"]).date()),
    }


def fetch_index_metrics(index_code: str) -> dict[str, Any]:
    end = date.today()
    start = end - timedelta(days=365 * 5 + 30)
    response = requests.get(
        "https://www.csindex.com.cn/csindex-home/perf/index-perf",
        params={
            "indexCode": index_code,
            "startDate": start.strftime("%Y%m%d"),
            "endDate": end.strftime("%Y%m%d"),
        },
        timeout=HTTP_TIMEOUT,
        headers={"User-Agent": "Mozilla/5.0"},
    )
    response.raise_for_status()
    rows = response.json().get("data")
    if not rows:
        raise RuntimeError(f"{index_code} 无指数估值")
    hist = pd.DataFrame(rows)
    date_col = "tradeDate" if "tradeDate" in hist.columns else "日期"
    hist["日期"] = pd.to_datetime(hist[date_col], format="%Y%m%d", errors="coerce")
    if hist["日期"].isna().all():
        hist["日期"] = pd.to_datetime(hist[date_col], errors="coerce")
    pe_col = "peg" if "peg" in hist.columns else "滚动市盈率"
    hist["PE"] = pd.to_numeric(hist[pe_col], errors="coerce")
    hist = hist.dropna(subset=["PE", "日期"]).sort_values("日期")
    if hist.empty:
        raise RuntimeError(f"{index_code} 无指数 PE")
    last = hist.iloc[-1]
    pe = float(last["PE"])
    dy = None
    asof = pd.Timestamp(last["日期"]).date().isoformat()
    try:
        value_resp = requests.get(
            f"https://www.csindex.com.cn/csindex-home/indexInfo/index-xbrl-plus.json",
            params={"indexCode": index_code},
            timeout=8,
            headers={"User-Agent": "Mozilla/5.0"},
        )
        if value_resp.ok:
            node = value_resp.json().get("data") or {}
            if isinstance(node, dict):
                dy = _to_float(
                    node.get("dividendYield")
                    or node.get("dividend_yield")
                    or node.get("股息率1")
                )
                pe = _to_float(node.get("pe1") or node.get("市盈率1")) or pe
    except Exception:
        LOGGER.debug("CSI extra value lookup failed for %s", index_code, exc_info=True)
    return {
        "pe": pe,
        "pb": None,
        "pe_pctl": percentile(hist["PE"], pe),
        "pb_pctl": None,
        "dy": dy,
        "asof": asof,
    }


def fetch_china_10y() -> float | None:
    cached = _read_cache("CN10Y")
    if cached and cached.get("y10") is not None:
        return float(cached["y10"])
    try:
        response = requests.get(
            "https://datacenter-web.eastmoney.com/api/data/v1/get",
            params={
                "sortColumns": "TRADE_DATE",
                "sortTypes": "-1",
                "pageSize": "5",
                "pageNumber": "1",
                "reportName": "RPT_BONDYIELD_HIST",
                "columns": "ALL",
                "source": "WEB",
                "client": "WEB",
                "filter": '(AGE="10Y")',
            },
            timeout=HTTP_TIMEOUT,
            headers={"User-Agent": "Mozilla/5.0"},
        )
        rows = (response.json().get("result") or {}).get("data") or []
        value = _to_float(rows[0].get("YIELD")) if rows else None
        if value is None:
            raise RuntimeError("empty 10Y")
        _write_cache("CN10Y", {"y10": value})
        return value
    except Exception:
        LOGGER.warning("China 10Y yield lookup failed", exc_info=True)
        return None


def _to_float(value: Any) -> float | None:
    try:
        if value in (None, "", "-") or pd.isna(value):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _week52_pctl(metrics: dict[str, Any], price: float | None) -> float | None:
    low = metrics.get("week52_low")
    high = metrics.get("week52_high")
    if price is None or low is None or high is None or high <= low:
        return metrics.get("week52_pctl")
    return max(0.0, min(100.0, (price - low) / (high - low) * 100))


def collect_metrics(item: dict[str, Any]) -> dict[str, Any]:
    code = item["code"]
    cached = _read_cache(code)
    if cached:
        return cached
    kind = item.get("kind") or ("fund" if is_fund_code(code) else "stock")
    index_code = item.get("index") or DEFAULT_INDEX_CODE.get(code)
    metrics: dict[str, Any] = {"kind": kind, "index": index_code}
    errors: list[str] = []
    if kind not in {"fund", "dividend_etf"} and not is_fund_code(code):
        try:
            metrics.update(fetch_stock_metrics(code))
        except Exception as exc:
            LOGGER.warning("Stock valuation failed for %s: %s", code, exc)
            errors.append(str(exc))
    elif index_code:
        LOGGER.info("Skip stock PE/PB for ETF %s, use index %s", code, index_code)
    if index_code:
        try:
            index_metrics = fetch_index_metrics(index_code)
            if metrics.get("pe") is None:
                metrics["pe"] = index_metrics.get("pe")
                metrics["pe_pctl"] = index_metrics.get("pe_pctl")
            metrics["dy"] = index_metrics.get("dy")
            metrics.setdefault("pe", index_metrics.get("pe"))
            metrics.setdefault("pe_pctl", index_metrics.get("pe_pctl"))
        except Exception as exc:
            LOGGER.warning("Index valuation failed for %s/%s: %s", code, index_code, exc)
            errors.append(str(exc))
    if errors and metrics.get("pe") is None and metrics.get("pb") is None:
        metrics["error"] = errors[0]
    _write_cache(code, metrics)
    return metrics


def _code_from_quote(quote: _Priced) -> str:
    symbol = quote.symbol
    if symbol[:2] in {"sh", "sz"}:
        return symbol[2:]
    return symbol


def assess_item(
    item: dict[str, Any],
    quote: _Priced | None,
    *,
    y10: float | None = None,
    metrics: dict[str, Any] | None = None,
) -> ZoneResult:
    code = item["code"]
    price = quote.price if quote else None
    data = metrics if metrics is not None else collect_metrics(item)
    last_close = data.get("last_close")
    pe = _scale_multiple(data.get("pe"), last_close, price) or data.get("pe")
    pb = _scale_multiple(data.get("pb"), last_close, price) or data.get("pb")
    dividend_style = bool(
        item.get("kind") == "dividend_etf" or code in DEFAULT_DIVIDEND_FUNDS
    )
    zone, reason = classify_zone(
        price=price,
        add_below=_to_float(item.get("add_below")),
        risk_above=_to_float(item.get("risk_above")),
        pe=pe,
        pb=pb,
        pe_pctl=_to_float(data.get("pe_pctl")),
        pb_pctl=_to_float(data.get("pb_pctl")),
        dividend_style=dividend_style,
        dy=_to_float(data.get("dy")),
        y10=y10,
        week52_pctl=_week52_pctl(data, price),
    )
    if data.get("error") and zone == ZONE_UNKNOWN:
        reason = f"估值获取失败：{data['error']}"
    return ZoneResult(
        code=code,
        zone=zone,
        reason=reason,
        pe=pe,
        pb=pb,
        pe_pctl=_to_float(data.get("pe_pctl")),
        pb_pctl=_to_float(data.get("pb_pctl")),
        dy=_to_float(data.get("dy")),
        week52_pctl=_week52_pctl(data, price),
    )


def assess_watchlist(
    config: dict[str, Any],
    quotes: list[_Priced],
) -> tuple[dict[str, ZoneResult], list[str]]:
    watchlist = config.get("watchlist") or []
    if not watchlist:
        return {}, []
    quote_map = {_code_from_quote(quote): quote for quote in quotes}
    y10 = fetch_china_10y()
    errors: list[str] = []
    results: dict[str, ZoneResult] = {}
    workers = int(config.get("zones", {}).get("request_workers", 6))

    def run(item: dict[str, Any]) -> ZoneResult:
        return assess_item(item, quote_map.get(item["code"]), y10=y10)

    with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
        futures = {executor.submit(run, item): item for item in watchlist}
        try:
            completed = as_completed(futures, timeout=WATCHLIST_TIMEOUT)
            for future in completed:
                item = futures[future]
                code = item["code"]
                try:
                    results[code] = future.result()
                    LOGGER.info("Zone ready %s %s", code, results[code].zone)
                except Exception as exc:
                    LOGGER.warning("Zone assess failed for %s: %s", code, exc)
                    errors.append(f"{item.get('name', code)} 区间判断失败")
                    results[code] = ZoneResult(
                        code=code,
                        zone=ZONE_UNKNOWN,
                        reason="估值获取失败",
                    )
        except TimeoutError:
            LOGGER.warning("Zone assessment timed out after %ss", WATCHLIST_TIMEOUT)
            errors.append("部分估值超时，已用已完成结果")
            for future, item in futures.items():
                code = item["code"]
                if code in results:
                    continue
                results[code] = ZoneResult(
                    code=code,
                    zone=ZONE_UNKNOWN,
                    reason="估值超时",
                )
    return results, errors


def summarize_zones(zones: dict[str, ZoneResult]) -> str:
    order = (ZONE_WATCH, ZONE_HOLD, ZONE_NO_CHASE, ZONE_RISK, ZONE_UNKNOWN)
    counts = {label: 0 for label in order}
    for item in zones.values():
        counts[item.zone] = counts.get(item.zone, 0) + 1
    parts = [f"{label} {counts[label]}" for label in order if counts[label]]
    return "｜".join(parts)
