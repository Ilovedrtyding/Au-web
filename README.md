# 金价实时监测网页

这是一个已经整理成适合 Vercel 分享的金价监测站。

## 当前方案

为了兼容你现在的条件，这个项目已经调整为：

- 前端部署到 Vercel
- 数据文件存放在仓库的 `public/data`
- GitHub Actions 每 5 分钟自动更新一次数据
- 页面本身每 1 分钟自动刷新一次显示

这样你不需要国外信用卡，也能拿到一个可直接分享的网址。

## 为什么不是 1 分钟服务端采集

截至 2026 年 3 月 25 日，我核对了官方文档后，这套免费组合里有两个限制：

- GitHub Actions 的定时任务最短通常是 5 分钟
- Vercel Hobby 的 Cron Jobs 不是为你这种稳定 1 分钟持久采集场景准备的

所以我把它做成了：

- 服务端数据更新：每 5 分钟
- 页面自动刷新：每 1 分钟
- 24 小时图：按分钟粒度展示，缺失分钟会用最近一次价格补齐

## 你现在需要做的事

### 1. 在本地生成一份初始数据并提交

```powershell
cd D:\Claude\Au-web
npm.cmd install
npm.cmd run update:data
```

然后提交并推送：

```powershell
git add .
git commit -m "Prepare Vercel deployment"
git push origin main
```

### 2. 在 Vercel 导入 GitHub 仓库

你的仓库地址是：

```text
https://github.com/Ilovedrtyding/Au-web
```

在 Vercel 中：

1. 点击 `Add New...`
2. 选择 `Project`
3. 导入这个 GitHub 仓库
4. 保持默认设置，直接部署

仓库中已经有：

- `vercel.json`：告诉 Vercel 直接发布 `public` 目录
- `.github/workflows/refresh-data.yml`：每 5 分钟更新一次静态数据

### 3. 开启 GitHub Actions

确保仓库的 `Actions` 没有被禁用。
第一次你也可以手动进入 `Refresh Gold Data` 工作流点一次 `Run workflow`，这样页面会马上拿到初始数据。

## 项目结构

- `public/index.html`：页面
- `public/app.js`：图表与数据读取逻辑
- `public/data/*.json`：Vercel 直接读取的静态数据
- `scripts/update-data.js`：生成和更新数据的脚本
- `.github/workflows/refresh-data.yml`：定时更新数据
- `vercel.json`：Vercel 部署配置

## 本地模式

如果你本地仍想跑原来的 Node 服务：

```powershell
npm.cmd start
```

页面会优先读取本地 `/api/*`；如果没有 API，则自动回退到 `public/data/*.json`。
