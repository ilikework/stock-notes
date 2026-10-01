"""Refresh the pick-search list after the close, on A-share sessions only.

This does not price symbols, write notes, or send Telegram.
A failed download is not uploaded, so the worker keeps the previous list.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Callable
from zoneinfo import ZoneInfo

import requests
from pypinyin import Style, pinyin

LOGGER = logging.getLogger(__name__)

MIN_COUNT = 2000
NODES = ("sh_a", "sz_a", "etf_hq_fund")
PAGE_SIZE = 100
SINA = "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center."


def initials(name: str) -> str:
    parts = pinyin(name, style=Style.FIRST_LETTER, errors="default")
    return "".join(part[0] for part in parts if part).lower()


def stock_ok(code: str, symbol: str) -> bool:
    if symbol.startswith("sh"):
        return code.startswith(("600", "601", "603", "605", "688", "689")) and len(code) == 6
    if symbol.startswith("sz"):
        return code.startswith(("000", "001", "002", "003", "300", "301")) and len(code) == 6
    return False


def fund_ok(code: str, symbol: str) -> bool:
    if not (symbol.startswith("sh") or symbol.startswith("sz")):
        return False
    return len(code) == 6 and code.startswith(("15", "51", "56", "58"))


def rows_problem(rows: list[list[str]]) -> str:
    if len(rows) < MIN_COUNT:
        return "名单不完整"
    seen: set[str] = set()
    found = False
    for row in rows:
        if len(row) < 2:
            return "名单格式无效"
        code, name = row[0], row[1].strip()
        if len(code) != 6 or not code.isdigit() or not name or code in seen:
            return "名单格式无效"
        seen.add(code)
        if code == "515100":
            found = True
    if not found:
        return "缺少515100"
    return ""


def build_rows(raw: dict[str, dict[str, str]], aliases: dict[str, str]) -> list[list[str]]:
    rows: list[list[str]] = []
    for code, info in raw.items():
        symbol = info.get("symbol") or ""
        name = (info.get("name") or "").strip()
        if not name:
            continue
        if info.get("node") == "etf_hq_fund":
            if not fund_ok(code, symbol):
                continue
        elif not stock_ok(code, symbol):
            continue
        alias = aliases.get(code) or ""
        row = [code, name, initials(name)]
        if alias and alias != name:
            row.append(alias)
        rows.append(row)
    rows.sort(key=lambda item: item[0])
    return rows


def _session() -> requests.Session:
    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://vip.stock.finance.sina.com.cn/",
    })
    return session


def fetch_raw(get: Callable[..., Any] | None = None) -> dict[str, dict[str, str]]:
    session = None if get else _session()

    def fetch(url: str) -> Any:
        if get:
            return get(url)
        assert session is not None
        last: Exception | None = None
        for _ in range(3):
            try:
                response = session.get(url, timeout=30)
                response.raise_for_status()
                text = response.text.strip()
                if text.startswith('"') and text.endswith('"') and text[1:-1].isdigit():
                    return int(text[1:-1])
                return response.json()
            except Exception as exc:
                last = exc
        raise RuntimeError("名单拉取失败") from last

    collected: dict[str, dict[str, str]] = {}
    for node in NODES:
        count = fetch(SINA + "getHQNodeStockCount?node=" + node)
        if not isinstance(count, int) or count < 1:
            raise RuntimeError("名单拉取失败")
        pages = (count + PAGE_SIZE - 1) // PAGE_SIZE
        got = 0
        for page in range(1, pages + 1):
            url = (
                SINA
                + f"getHQNodeData?page={page}&num={PAGE_SIZE}&sort=symbol&asc=1&node={node}"
            )
            batch = fetch(url)
            if not isinstance(batch, list) or not batch:
                raise RuntimeError("名单拉取失败")
            for item in batch:
                code = str(item.get("code") or "")
                name = str(item.get("name") or "").strip()
                symbol = str(item.get("symbol") or "")
                if len(code) == 6 and code.isdigit() and name:
                    collected[code] = {"name": name, "symbol": symbol, "node": node}
            got += len(batch)
        if got < int(count * 0.95):
            raise RuntimeError("名单拉取失败")
    return collected


def _post(path: str, payload: dict[str, Any], post: Callable[..., Any] | None) -> None:
    if post:
        post(path, payload)
        return
    from stock_report.fanout import _auth_headers, worker_origin

    response = requests.post(
        worker_origin() + path,
        headers={**_auth_headers(), "Content-Type": "application/json"},
        json=payload,
        timeout=60,
    )
    response.raise_for_status()
    body = response.json()
    if payload.get("rows") and not body.get("ok"):
        raise RuntimeError("名单写入被拒绝")


def refresh_symbol_catalog(
    config: dict[str, Any],
    *,
    now: datetime | None = None,
    get: Callable[..., Any] | None = None,
    post: Callable[..., Any] | None = None,
) -> bool:
    timezone = ZoneInfo(config.get("timezone", "Asia/Tokyo"))
    current = now or datetime.now(timezone)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone)
    from stock_report.report_bot import is_a_share_trading_day

    try:
        trading = is_a_share_trading_day(current.date())
    except Exception:
        LOGGER.exception("交易日历检查失败，不更新名单")
        _post("/api/internal/symbols", {"error": "交易日历检查失败"}, post)
        return False
    if not trading:
        LOGGER.info("%s 不是A股交易日，不更新名单", current.date())
        return False
    aliases = {
        str(item.get("code")): str(item.get("name") or "")
        for item in (config.get("watchlist") or [])
        if item.get("code") and item.get("name")
    }
    try:
        rows = build_rows(fetch_raw(get), aliases)
    except Exception:
        LOGGER.exception("名单拉取失败，保留旧名单")
        _post("/api/internal/symbols", {"error": "名单拉取失败"}, post)
        return False
    problem = rows_problem(rows)
    if problem:
        LOGGER.error("名单未通过检查：%s", problem)
        _post("/api/internal/symbols", {"error": problem}, post)
        return False
    _post("/api/internal/symbols", {"rows": rows}, post)
    LOGGER.info("名单已更新，共 %s 条", len(rows))
    return True
