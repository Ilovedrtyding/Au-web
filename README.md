# 贵金属监测平台（Vercel）

这是一个可分享的贵金属监测站，包含黄金、白银、铂金、钯金监测页和市场建议中心。

## 当前更新机制

截至 2026 年 3 月 26 日：

- 页面显示刷新：每 1 分钟
- 数据文件更新：GitHub Actions 每天 1 次
- 趋势图粒度：24 小时分钟级，历史按月聚合

说明：市场建议目前是“自动定时更新的数据文件”，不是实时新闻流。

## 数据源配置（免费版）

当前保留原有结构，新增免费 ALAPI 作为主源，仅黄金使用：

优先顺序：`ALAPI -> gold-api.com`

环境变量：

- `ALAPI_TOKEN`：ALAPI Token
- `ALAPI_GOLD_TYPE`：可选，用于指定 ALAPI 返回数组中的品类名称
- `PRICE_SOURCE_MODE`：可选，`alapi` 或 `goldapi_com`

注意：系统只接受 USD/oz 单位的价格，若返回币种或单位不匹配将自动跳过。

## 部署方式

- 前端：Vercel 静态部署（读取 `public`）
- 数据：`public/data/*.json`
- 定时更新：`.github/workflows/refresh-data.yml`

## 本地使用

```powershell
cd D:\Claude\Au-web
npm.cmd install
npm.cmd run update:data
npm.cmd start
```

## 关键目录

- `public/index.html`：首页
- `public/gold.html` / `silver.html` / `platinum.html` / `palladium.html`：四个金属监测台
- `public/market.html`：市场建议中心
- `public/app.js`：监测页图表与交互逻辑
- `public/market.js`：建议页筛选与渲染
- `scripts/update-data.js`：数据生成脚本
