from __future__ import annotations

import argparse
import logging
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger

from stock_report.report_bot import (
    is_a_share_trading_day,
    load_config,
)


LOGGER = logging.getLogger("stock-report")


def parse_time(value: str) -> tuple[int, int]:
    try:
        hour_text, minute_text = value.split(":", 1)
        hour, minute = int(hour_text), int(minute_text)
    except (AttributeError, TypeError, ValueError) as exc:
        raise ValueError(f"无效时间：{value}，应为 HH:MM") from exc
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        raise ValueError(f"无效时间：{value}，应为 HH:MM")
    return hour, minute


def run_report(report_type: str, config: dict, *, force: bool = False) -> bool:
    timezone = ZoneInfo(config.get("timezone", "Asia/Tokyo"))
    now = datetime.now(timezone)
    if not force:
        try:
            trading_day = is_a_share_trading_day(now.date())
        except Exception:
            LOGGER.exception("交易日历检查失败，本次不发送以避免节假日误报")
            return False
        if not trading_day:
            LOGGER.info("%s 不是A股交易日，跳过报告", now.date())
            return False

    if report_type == "close":
        try:
            from stock_report.symbol_catalog import refresh_symbol_catalog
            refresh_symbol_catalog(config, now=now)
        except Exception:
            LOGGER.exception("名单更新失败，沿用旧名单")

    from stock_report.fanout import distribute_report

    text = distribute_report(report_type, config, now=now, send=True)
    if text is None:
        return False
    LOGGER.info("%s报告处理完成", "开盘" if report_type == "open" else "收盘")
    return True


def start_scheduler(config: dict) -> None:
    timezone_name = config.get("timezone", "Asia/Tokyo")
    timezone = ZoneInfo(timezone_name)
    scheduler = BlockingScheduler(timezone=timezone)
    schedule = config.get("schedule", {})

    for report_type, key, default in (
        ("open", "open_report", "10:30"),
        ("close", "close_report", "16:05"),
    ):
        hour, minute = parse_time(schedule.get(key, default))
        scheduler.add_job(
            run_report,
            CronTrigger(
                day_of_week="mon-fri",
                hour=hour,
                minute=minute,
                timezone=timezone,
            ),
            args=[report_type, config],
            id=f"{report_type}_report",
            name=f"{report_type} market report",
            max_instances=1,
            coalesce=True,
            misfire_grace_time=900,
        )

    LOGGER.info(
        "定时服务已启动：开盘报告 %s，收盘报告 %s（%s）",
        schedule.get("open_report", "10:30"),
        schedule.get("close_report", "16:05"),
        timezone_name,
    )
    scheduler.start()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="A股与日经225 Telegram 定时报告")
    parser.add_argument("--config", help="配置文件路径")
    parser.add_argument(
        "--once",
        choices=("open", "close"),
        help="立即生成一次指定报告，不启动定时服务",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="只拉取各用户选股并打印数量，不拉行情、不写笔记、不发 Telegram",
    )
    parser.add_argument(
        "--send",
        action="store_true",
        help="与 --once 一起使用时发送 Telegram；默认仅打印",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="忽略交易日检查（仅影响立即发送）",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    try:
        config = load_config(args.config)
        if args.once:
            if args.dry_run:
                from stock_report.fanout import dry_run_summary
                import json as _json
                print(_json.dumps(dry_run_summary(), ensure_ascii=False))
                return 0
            if args.send:
                run_report(args.once, config, force=args.force)
            else:
                from stock_report.fanout import distribute_report
                text = distribute_report(args.once, config, send=False)
                if text:
                    print(text)
            return 0
        start_scheduler(config)
        return 0
    except KeyboardInterrupt:
        return 0
    except Exception:
        LOGGER.exception("运行失败")
        return 1


if __name__ == "__main__":
    sys.exit(main())
