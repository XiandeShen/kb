# 椿沐智库（CHUNMU BK）

一个**没有后端**的个人知识库：页面是静态的，文章存在你自己的 GitHub 仓库里，用访问令牌直连 GitHub API 读写。

## 特点

- **零服务器**：静态页面 + GitHub 当数据库，数据始终在你自己的仓库
- **多端一致**：网页与安卓 App 共用同一份数据，改一端另一端刷新即见
- **Markdown 编辑**：实时预览、图片粘贴、附件上传、标签与紧急标记
- **阅读体验**：多图查看器、表格/代码样式对齐 GitHub、目录锚点
- **离线可看**：正文缓存在本地，弱网也能翻已看过的内容

## 目录结构

```
index.html          页面骨架（登录 / 列表 / 阅读 / 编辑）
css/                base 基础样式、components 组件、editor 编辑器、viewer 查看器
js/
  core.js           虚拟列表、排序、Markdown 渲染
  github.js         GitHub API 读写
  auth-sync.js      登录、令牌校验、同步
  doc-view.js       阅读视图
  events.js         交互事件（新建 / 编辑 / 保存 / 搜索）
  attachments.js    附件上传与下载
  viewer.js         多图查看器
  ui-core.js        弹窗、加载态、列表与分类渲染
vendor/             marked、DOMPurify、Tailwind、Remix Icon
```

## 本地运行

纯静态，任何静态服务器都行：

```bash
python -m http.server 8080     # 打开 http://localhost:8080
```

> 不要直接双击 `index.html`：`file://` 下 GitHub API 的跨域会被浏览器拦截。

## 部署

推到 GitHub 仓库并开启 Pages（仓库根目录）。`.nojekyll` 已就位，避免 Jekyll 忽略下划线开头的文件。

## 安卓 App

WebView 壳，内置同一份网页，额外提供：附件保存到本地、返回键分层、外链走系统浏览器、沉浸式状态栏、页面禁止缩放。

| 项 | 值 |
| --- | --- |
| 包名 | `com.chunmu.zhiku` |
| 版本 | 6.1.3 |
| 系统 | Android 8.0+ |

> App 内置的是打包那一刻的网页，**改网页后必须重新打包**才会生效。

## 数据与安全

- 访问令牌只存在本机 `localStorage`，不上传任何服务器
- 所有读写走 GitHub API，权限由令牌决定（建议只给目标仓库 Contents 权限）
- 仓库里每篇文章一个 `.md`，附件放在同目录

## 排序规则

列表按**最后修改时间倒序**，紧急条目置顶；改过的文档会自动浮上来。
