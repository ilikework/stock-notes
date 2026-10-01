"""Split one market run across per-user watchlists.

Market math stays in stock_report.zones and stock_report.report_bot.
This module only unions symbols, writes one note per user, and keeps
Telegram limited to the admin copy.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime
from typing import Any
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

import requests


LOGGER = logging.getLogger(__name__)


def code_of(symbol: str) -> str:
    if len(symbol) > 2 and symbol[:2] in {"sh", "sz", "bj"}:
        return symbol[2:]
    return symbol


def union_watchlist(users: list[dict[str, Any]], base_watchlist: list[dict[str, Any]]) -> list[dict[str, Any]]:
    meta = {item["code"]: item for item in base_watchlist if item.get("code")}
    seen: set[str] = set()
    ordered: list[dict[str, Any]] = []
    for user in users:
        picks = sorted(
            user.get("picks") or [],
            key=lambda pick: (pick.get("position", 0), str(pick.get("symbol") or "")),
        )
        for pick in picks:
            code = str(pick.get("symbol") or "")
            if not code or code in seen:
                continue
            seen.add(code)
            if code in meta:
                ordered.append(dict(meta[code]))
            else:
                ordered.append({"code": code, "name": pick.get("name") or code})
    return ordered


def order_quotes(quotes: list[Any], codes: list[str]) -> list[Any]:
    by_code = {code_of(quote.symbol): quote for quote in quotes}
    return [by_code[code] for code in codes if code in by_code]


def split_for_users(users: list[dict[str, Any]], quotes: list[Any]) -> dict[Any, list[Any]]:
    split: dict[Any, list[Any]] = {}
    for user in users:
        picks = user.get("picks") or []
        if not picks:
            continue
        codes = [
            str(pick.get("symbol") or "")
            for pick in sorted(picks, key=lambda pick: (pick.get("position", 0), str(pick.get("symbol") or "")))
        ]
        split[user.get("id")] = order_quotes(quotes, [code for code in codes if code])
    return split


def telegram_target(users: list[dict[str, Any]]) -> dict[str, Any] | None:
    for user in users:
        if user.get("role") == "admin" and user.get("picks"):
            return user
    return None


def stock_dict(quote: Any, zone: Any) -> dict[str, Any]:
    return {
        "symbol": code_of(quote.symbol),
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
    }


def worker_origin() -> str:
    raw = os.environ.get(
        "STOCK_REPORT_CLOUDFLARE_URL",
        "https://stock-report.stocknotes.workers.dev/api/reports",
    )
    parts = urlsplit(raw)
    if not parts.scheme or not parts.netloc:
        raise RuntimeError("worker url is invalid")
    return f"{parts.scheme}://{parts.netloc}"


def _auth_headers() -> dict[str, str]:
    key = os.environ.get("STOCK_REPORT_WRITE_KEY")
    if not key:
        raise RuntimeError("STOCK_REPORT_WRITE_KEY is unset")
    return {"Authorization": "Bearer " + key}


def fetch_watchlists() -> list[dict[str, Any]]:
    response = requests.get(
        worker_origin() + "/api/internal/watchlists",
        headers=_auth_headers(),
        timeout=20,
    )
    response.raise_for_status()
    body = response.json()
    if not body.get("ok"):
        raise RuntimeError("watchlist request was rejected")
    users = body.get("users") or []
    if not isinstance(users, list):
        raise RuntimeError("watchlist response is invalid")
    return users


def push_user_note(user_id: int, report_type: str, now: datetime, stocks: list[Any], zones: dict[str, Any]) -> None:
    payload_stocks = [stock_dict(quote, zones.get(code_of(quote.symbol))) for quote in stocks]
    body = {
        "user_id": user_id,
        "session_date": now.strftime("%Y-%m-%d"),
        "session": report_type,
        "title": report_type,
        "stocks": payload_stocks,
    }
    response = requests.post(
        worker_origin() + "/api/internal/notes",
        headers={**_auth_headers(), "Content-Type": "application/json"},
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        timeout=30,
    )
    response.raise_for_status()


def dry_run_summary() -> dict[str, Any]:
    users = fetch_watchlists()
    active = [user for user in users if user.get("picks")]
    target = telegram_target(active)
    return {
        "enabled": len(users),
        "with_picks": [
            {
                "login": user.get("login"),
                "role": user.get("role"),
                "count": len(user.get("picks") or []),
            }
            for user in active
        ],
        "union": len(union_watchlist(active, [])),
        "telegram_login": None if target is None else target.get("login"),
    }


def distribute_report(
    report_type: str,
    config: dict[str, Any],
    *,
    now: datetime | None = None,
    send: bool = False,
) -> str | None:
    from stock_report.report_bot import build_report, fetch_all_quotes, fetch_today_news, send_telegram
    from stock_report.zones import assess_watchlist

    timezone = ZoneInfo(config.get("timezone", "Asia/Tokyo"))
    current = now or datetime.now(timezone)
    try:
        users = fetch_watchlists()
    except Exception:
        LOGGER.exception("拉取选股失败，本次不写笔记也不发送 Telegram")
        return None
    active = [user for user in users if user.get("picks")]
    if not active:
        LOGGER.info("没有启用用户持有选股，跳过")
        return ""
    run_config = dict(config)
    run_config["watchlist"] = union_watchlist(active, config.get("watchlist") or [])
    indices, stocks, errors = fetch_all_quotes(run_config)
    try:
        zones, zone_errors = assess_watchlist(run_config, stocks)
        errors.extend(zone_errors)
    except Exception as exc:
        LOGGER.exception("Zone assessment failed")
        zones = {}
        errors.append(f"估值区间计算失败：{exc}")
    news: list[Any] = []
    if report_type == "open":
        LOGGER.info("估值完成，开始拉取今日新闻")
        news, news_errors = fetch_today_news(run_config, current.date())
        errors.extend(news_errors)
    zone_map = zones or {}
    for user in active:
        codes = [str(pick.get("symbol") or "") for pick in user.get("picks") or []]
        user_stocks = order_quotes(stocks, codes)
        try:
            push_user_note(int(user["id"]), report_type, current, user_stocks, zone_map)
        except Exception:
            LOGGER.exception("笔记写入失败 user=%s", user.get("login"))
    admin = telegram_target(active)
    if admin is None:
        LOGGER.info("没有带选股的管理员，不发送 Telegram")
        return ""
    admin_codes = {str(pick.get("symbol") or "") for pick in admin.get("picks") or []}
    admin_stocks = order_quotes(stocks, [str(pick.get("symbol") or "") for pick in admin.get("picks") or []])
    admin_zones = {code: zone for code, zone in zone_map.items() if code in admin_codes}
    text = build_report(report_type, current, indices, admin_stocks, news, errors, admin_zones)
    if send:
        send_telegram(text)
    return text
