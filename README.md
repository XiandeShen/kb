# 椿沐智库（CHUNMU BK）

一个**没有后端**的个人知识库：页面是静态的，文章存在你自己的 GitHub 仓库里，用访问令牌直连 GitHub API 读写。

---

## 特点

- **零服务器**：纯静态 + GitHub 当数据库，数据永远在你自己的仓库里
- **多端一致**：网页和安卓 App 用同一份数据，改一端另一端刷新即见
- **Markdown 编辑**：实时预览、图片粘贴、附件上传、标签与紧急标记
- **好用的阅读体验**：多图查看器（缩略图/切换）、代码高亮、目录锚点
- **离线缓存**：文档正文缓存在本地，弱网也能翻已看过的内容

## 目录结构

```
index.html          页面骨架（登录 / 列表 / 阅读 / 编辑）
css/                base 基础样式、components 组件、editor 编辑器、viewer 查看器
js/
  core.js           虚拟列表、数据模型、Markdown 渲染
  github.js         GitHub API 读写
  auth-sync.js      登录、令牌校验、同步
  doc-view.js       阅读视图
  events.js         交互事件（新建/编辑/保存/搜索）
  attachments.js    附件上传与下载
  viewer.js         多图查看器
  ui-core.js        弹窗、加载态、列表与分类渲染
vendor/             marked、DOMPurify、Tailwind、Remix Icon
```

## 本地运行

纯静态，任何静态服务器都行：

```bash
python -m http.server 8080
# 打开 http://localhost:8080
```

> 不要直接双击 `index.html`：`file://` 下 GitHub API 的跨域会被拦。

## 部署

推到 GitHub 仓库，开启 Pages（仓库根目录）即可。`.nojekyll` 已就位，避免 Jekyll 忽略下划线开头的文件。

## 安卓 App

WebView 壳，内置网页副本，额外提供：附件保存到本地、返回键分层、外链走系统浏览器、沉浸式状态栏、禁止页面缩放。

| 项 | 值 |
| --- | --- |
| 包名 | `com.chunmu.zhiku.v2` |
| 版本 | 4.2.5（4205） |
| 系统 | Android 8.0+ |

## 数据与安全

- 访问令牌只存在本机 `localStorage`，不上传任何服务器
- 所有读写都走 GitHub API，权限由令牌决定（建议只给目标仓库的 Contents 权限）
- 仓库结构：每篇文章一个 `.md`，附件放在同目录，重命名/删除都由页面完成

## 版本

更新记录见 [更新日志.md](更新日志.md)，下载页见 [安卓版下载.md](安卓版下载.md)。
