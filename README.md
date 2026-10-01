# 盘面笔记

本仓库是盘面笔记的源码备份。

## 目录

- `stockAnalyse`：Python 报告生成器。按配置生成 A 股与日经225的开盘、收盘报告，并可写入笔记、通过 Telegram 发送。Telegram 凭据和写入密钥从环境变量读取，不写在配置文件里。
- `stock-worker`：Cloudflare Worker，提供笔记页面和相关接口。
- `stock-notes-android`：Android WebView 应用，打开线上笔记页。

## 密钥

密钥不进入本仓库。`.gitignore` 排除 `.env`、`.write-key`、`.admin-password`、`keystore.properties`、`*.jks`、`*.keystore`、`.venv`、`__pycache__`、`node_modules`、`.gradle`。

线上页面：https://stock-report.stocknotes.workers.dev/
