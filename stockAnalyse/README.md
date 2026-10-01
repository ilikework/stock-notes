# A股与日经225定时报告

在 A 股交易日自动生成并通过 Telegram 发送：

- 10:30（东京时间，与北京时间相同）：开盘报告。各用户选股合并后每只股票只分析一次，再按用户拆开写入笔记。Telegram 只发管理员那一份。
- 16:05（东京时间）：收盘报告。空选股的用户跳过。用户自己写的句子不进 Telegram，也不会被下一场分析覆盖。

默认跟踪上证指数、深证成指、科创50、创业板指、日经225和
`config.example.json` 中的自选股。A 股行情沿用 `monitor` 项目验证过的腾讯行情接口，
日经225使用 Yahoo Finance，新闻使用 AKShare。

## 安装

```powershell
cd D:\personal\stockAnalyse
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

如需修改自选股或时间，复制并编辑配置：

```powershell
Copy-Item config.example.json config.json
$env:STOCK_REPORT_CONFIG = "D:\personal\stockAnalyse\config.json"
```

## Telegram 配置

1. 在 Telegram 中通过 `@BotFather` 创建机器人并取得 Bot Token。
2. 先向机器人发送一条消息。
3. 访问 `https://api.telegram.org/bot<TOKEN>/getUpdates`，从返回内容取得 `chat.id`。
4. 用环境变量保存凭据，不要写进配置文件或提交到 Git：

```powershell
$env:TELEGRAM_BOT_TOKEN = "新生成的 Bot Token"
$env:TELEGRAM_CHAT_ID = "你的 Chat ID"
```

`D:\personal\monitor\config.example.json` 中已有疑似真实 Token，建议先在 BotFather
撤销并重新生成，再使用新 Token。

## 验证

只生成报告并打印，不发送 Telegram（仍会按用户写入笔记）。不想拉行情时用 `--dry-run`：

```powershell
python main.py --once open --dry-run
python main.py --once open
python main.py --once close
```

测试发送（`--force` 可在非交易日使用）：

```powershell
python main.py --once open --send --force
```

运行测试：

```powershell
pytest
```

## 启动定时服务

```powershell
python main.py
```

进程必须持续运行。长期使用建议部署到常开服务器，由 systemd、Docker 或 Windows
任务计划程序负责开机启动和失败重启。程序会用上交所交易日历过滤周末和 A 股休市日；
即使日本市场当天休市，报告仍会展示日经225数据源返回的最近行情时间。

### Windows 自动安装

下面的脚本会创建虚拟环境、安装依赖、运行测试，从旧 `monitor` 配置迁移 Telegram
凭据到当前 Windows 用户环境变量，然后注册并立即启动 `StockReport-Service`：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup_windows.ps1
```

该任务在用户登录时启动，并在异常退出后自动重启。实际报告时间由程序按
`Asia/Shanghai` 计算，因此 Windows 即使设为日本时区也不会提前一小时。

查看状态或日志：

```powershell
Get-ScheduledTask -TaskName StockReport-Service
Get-Content .\logs\service.err.log
```

卸载任务：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\remove_windows_task.ps1
```

## 说明

- “科创板”默认以科创50指数（`000688`）代表。
- 涨跌幅以昨收为基准；开盘报告另列“较开盘”涨跌幅。
- 每只自选股/基金会附带投资区间：`适合关注`、`中性持有`、`不宜追高`、`风险偏高`。
  股票默认用近 5 年 PE/PB 分位（PB 优先，避免周期股 PE 失真）；红利 ETF 看绝对 PE 和股息相对国债，不单看分位。
  也可在自选股上设置 `add_below` / `risk_above` 价格线，例如特变电工 18 元以下才标适合关注。
- 股票成交量由腾讯接口的“手”换算为“股”，成交额换算为人民币。
- 日经225数据源不稳定提供成交额，因此通常仅展示成交量。
- 新闻抓取失败不会阻止行情报告发送，报告末尾会列出数据提示。
- 所有内容仅供参考，不构成投资建议。
