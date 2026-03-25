# 金价实时监测网页

这是一个可直接部署的金价监测站，包含：

- 每 1 分钟自动采集一次最新金价
- SQLite 持久化存储，避免历史数据丢失
- 24 小时分钟级趋势图
- 历年月度趋势图（每个月一个点）
- 历史记录表（按天展示开盘、收盘、最高、最低、均价、涨跌）
- 支持稳定 API 模式与可切换的网页爬虫模式

## 本地启动

```powershell
cd D:\Claude\Au-web
npm.cmd install
npm.cmd start
```

访问地址：

```text
http://localhost:3000
```

## 数据源

- 默认：`api.gold-api.com`
- 可选：设置环境变量 `PRICE_SOURCE_MODE=scraper` 后优先尝试网页抓取，失败时自动回退到 API

## 数据库存储

本地默认数据库位置：

```text
data/gold_prices.db
```

线上部署时可通过环境变量 `DB_PATH` 指定持久化磁盘路径。

## 最推荐的分享方案

最省事的方案不是 GitHub Pages，而是：

1. 代码托管到 GitHub
2. 整个 Node 服务直接部署到 Render
3. Render 给你一个可分享的公网网址
4. SQLite 挂载到 Render Persistent Disk，避免数据丢失

仓库里已经准备好：

- `render.yaml`：Render 一键部署配置
- `.github/workflows/deploy-pages.yml`：如果你还想单独发布静态前端，也可以用 GitHub Pages
- `public/config.js`：如果以后前后端拆开，可以在这里配置 API 根地址

## 拿到线上网址的步骤

### 1. 推送到 GitHub

```powershell
git init
git add .
git commit -m "Initial gold monitor dashboard"
```

然后在 GitHub 新建仓库并执行：

```powershell
git branch -M main
git remote add origin <你的仓库地址>
git push -u origin main
```

### 2. 在 Render 部署

1. 登录 Render
2. 选择 New + > Blueprint
3. 选择你刚推送的 GitHub 仓库
4. Render 会识别仓库里的 `render.yaml`
5. 确认创建服务后等待部署完成

部署成功后，Render 会给你一个类似下面的公网地址：

```text
https://gold-monitor-dashboard.onrender.com
```

这就是可以直接分享给别人的网址。

## 重要说明

- `render.yaml` 当前使用 `starter` 方案，因为持久化磁盘需要付费实例支持
- 如果只用纯免费的静态托管，无法保留 SQLite 数据，也无法稳定实现服务端每 1 分钟采集
- 因此想要“可分享 + 自动采集 + 数据不丢失”，完整方案建议走 Render 这类后端托管
