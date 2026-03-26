# 贵金属监测平台（Vercel）

这是一个可分享的贵金属监测站，包含黄金、白银、铂金、钯金监测页和市场建议中心。

## 当前更新机制

截至 2026 年 3 月 26 日：

- 页面显示刷新：每 1 分钟
- 数据文件更新：GitHub Actions 每天 1 次
- 趋势图粒度：24 小时分钟级，历史按月聚合

说明：市场建议目前是“自动定时更新的数据文件”，不是实时新闻流。

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
