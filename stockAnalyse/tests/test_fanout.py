from types import SimpleNamespace

from stock_report.fanout import (
    code_of,
    order_quotes,
    split_for_users,
    stock_dict,
    telegram_target,
    union_watchlist,
)


def quote(symbol, name="名称"):
    return SimpleNamespace(
        symbol=symbol,
        name=name,
        price=10,
        change_pct=1,
        from_open_pct=0.5,
        volume=1,
        amount=2,
    )


def test_union_keeps_config_metadata_and_dedupes():
    users = [
        {"id": 1, "picks": [{"symbol": "600089", "name": "忽略", "position": 1}, {"symbol": "600519", "position": 0}]},
        {"id": 2, "picks": [{"symbol": "600089", "position": 0}, {"symbol": "601398", "name": "工商银行", "position": 1}]},
        {"id": 3, "picks": []},
    ]
    base = [{"code": "600089", "name": "特变电工", "add_below": 18, "risk_above": 22}]
    union = union_watchlist(users, base)
    assert [item["code"] for item in union] == ["600519", "600089", "601398"]
    assert union[1]["add_below"] == 18
    assert union[1]["name"] == "特变电工"
    assert union[2] == {"code": "601398", "name": "工商银行"}


def test_split_is_per_user_and_analyzes_overlap_once():
    shared = quote("sh600519", "贵州茅台")
    only_b = quote("sh601398", "工商银行")
    users = [
        {"id": 1, "role": "admin", "login": "admin", "picks": [{"symbol": "600519", "position": 0}]},
        {"id": 2, "role": "user", "login": "b", "picks": [{"symbol": "601398", "position": 0}, {"symbol": "600519", "position": 1}]},
        {"id": 3, "role": "user", "login": "empty", "picks": []},
    ]
    split = split_for_users(users, [shared, only_b])
    assert 3 not in split
    assert [code_of(item.symbol) for item in split[1]] == ["600519"]
    assert [code_of(item.symbol) for item in split[2]] == ["601398", "600519"]
    assert split[1][0] is split[2][1]
    assert telegram_target(users)["login"] == "admin"
    assert telegram_target([users[1], users[2]]) is None


def test_note_payload_has_no_user_sentence():
    zone = SimpleNamespace(
        zone="中性持有",
        reason="区间",
        pe=1,
        pb=2,
        pe_pctl=3,
        pb_pctl=4,
        dy=5,
        week52_pctl=6,
    )
    payload = stock_dict(quote("sh600519", "贵州茅台"), zone)
    assert "remark" not in payload
    assert "sentence" not in payload
    assert payload["symbol"] == "600519"
    assert payload["zone"] == "中性持有"
    ordered = order_quotes([quote("sz300750"), quote("sh600519")], ["600519"])
    assert [code_of(item.symbol) for item in ordered] == ["600519"]
