# Web Packer

一个用于将本地 Web 资源快速打包为 Windows 可执行程序和 Android 安装包的工具。它适用于前端页面、Scratch 导出项目、小游戏和单页应用的轻量化分发。

本项目基于 PyQt5 构建 GUI，提供一键打包流程，自动处理资源整理、入口识别、图标生成、Scratch 补丁、Construct 2/3 兼容处理和 APK 签名等步骤。

---

## 项目简介

Web Packer 的核心目标，是让 Web 项目可以直接输出两种可交付产物：

- Windows EXE：在内置 WebView2 容器中运行页面，并输出 7z / ZIP 压缩包
- Android APK：将 Web 资源写入 APK 模板，并完成签名生成可安装应用

它支持多种输入方式，包括：

- 本地目录
- 压缩包（.zip / .7z / .tar / .gz / .bz2 / .xz / .tgz）
- 单个 HTML 文件
- Construct 2 / Construct 3 Web 导出目录

对 Scratch 项目、Construct 2/3 导出、移动端页面和默认入口自动修正等场景，程序也做了针对性的处理。

---

## 功能特性

### 1. 多种资源输入

支持以下内容作为打包源：

- Web 项目文件夹
- 压缩包文件
- 单个 HTML 文件

程序会自动检查入口文件；如果目录中没有 index.html，会尝试定位最适合的主页面并自动重命名。

### 2. 双平台输出

#### Windows EXE

- 使用内置模板目录中的 WebView2 容器
- 自动更新 package.json 中的名称、标题、版本和图标信息
- 输出为 .7z（优先）或 .zip（回退）压缩包

#### Android APK

- 使用 APK 模板写入 assets/www
- 自动替换 AndroidManifest 中的包名、应用名和版本号
- 根据配置替换 APK 图标资源
- 使用内置 JRE 与 apksigner.jar 完成签名

### 3. Scratch / Construct 自动适配

对于 Scratch 和 Construct 系列导出的项目，程序会自动检测并执行兼容补丁：

#### Scratch

- 隐藏默认控制栏
- 绑定 F2 触发绿旗逻辑
- 绑定 F4 进入 / 退出全屏
- 注入移动端触屏脚本

#### Construct 2 / 3

- 自动识别 Construct 3 的导出目录（如 data.json / workermain.js / scripts/c3runtime.js）
- 移除离线缓存与 Service Worker 相关文件，避免 Android 打包后异常
- 注入 Cordova 桥接脚本，修正 exportType 为 cordova
- 补齐图标引用，修复 Construct 3 资源路径问题
- 提供 F2 重载页面功能，便于调试和重启游戏

### 4. 图标自动生成

- 支持自定义 PNG / JPG / BMP / ICO 图标
- 使用 Pillow 自动生成 16 / 32 / 64 / 128 / 256 / 512 各尺寸图标
- 自动更新 EXE 和 APK 对应资源目录中的图标

### 5. GUI 配置持久化

- 提供 PyQt5 图形界面
- 保存输出目录、应用名、包名、版本号和窗口大小等用户配置
- 避免打包后因只读目录导致写入失败

---

## 目录结构

```text
Web-Packer/
├── pack_tool_gui.py          # 主程序入口
├── main.spec                 # PyInstaller 打包配置
├── controls.js               # 触屏控制脚本
├── template.APK              # APK 模板
├── gui_config.json           # 开发环境配置
├── README.md                 # 项目说明
├── 打包器/                   # Windows EXE 模板目录
│   ├── game.exe
│   ├── WebView2Loader.dll
│   ├── package.json
│   └── www/
│       └── icons/
│           ├── icon-16.png
│           ├── icon-32.png
│           ├── icon-64.png
│           ├── icon-128.png
│           ├── icon-256.png
│           └── icon-512.png
├── tools/                    # 内置 JRE / 签名工具
│   ├── jre/
│   ├── apksigner.jar
│   ├── w.jks
│   └── zipalign.exe
├── build/                    # 构建过程产物
└── dist/                     # PyInstaller 发布目录（如存在）
```

---

## 环境要求

### 必需依赖

- Python 3.8+
- PyQt5

### 可选依赖

- Pillow：用于自定义图标缩放
- py7zr：用于生成 .7z 压缩包

### 安装命令

```bash
# 最小运行环境
pip install PyQt5

# 推荐完整环境
pip install PyQt5 Pillow py7zr
```

> APK 签名不需要额外安装 JDK，因为工具会直接使用内置的 tools/jre 和 apksigner.jar 完成签名。

---

## 快速开始

### 1. 启动程序

```bash
python pack_tool_gui.py
```

### 2. 选择资源

在界面中执行以下步骤：

- 点击“浏览文件夹”选择 Web 项目目录
- 或点击“浏览文件”选择 ZIP / 7Z / TAR / HTML 文件
- 也可直接选择 Construct 2 / Construct 3 导出的 HTML5 项目目录

### 3. 配置打包参数

可配置项包括：

- 输出名称
- 应用名 / 包名 / 版本号
- 自定义图标
- 输出目录
- 是否输出 EXE / APK / 两者同时输出

### 4. 开始构建

点击“开始构建”后，程序会依次执行：

1. 复制模板
2. 处理输入资源
3. 检查入口 HTML
4. 注入必要脚本和图标
5. 检测 Scratch / Construct 2 / Construct 3 项目并执行兼容补丁
6. 分支生成 EXE 和 / 或 APK

构建结束后，程序会自动打开输出目录，并展示产物清单。

---

## 打包流水线

程序的处理逻辑可概括为：

```text
输入资源
  ↓
公共准备阶段
  ├─ 复制模板
  ├─ 解压或复制资源
  ├─ 确认入口 index.html
  ├─ 注入 controls.js
  ├─ 检测 Scratch / Construct 2 / Construct 3 特征并补丁
  ├─ 移除离线缓存与 Cordova 兼容修正
  └─ 生成图标
  ↓
分支构建
  ├─ EXE：更新 package.json 并压缩为 7z / ZIP
  └─ APK：写入 assets/www 并完成签名
```

---

## Scratch 项目快捷键

当识别到 Scratch 项目时，打包后的页面会自动注入以下交互：

| 快捷键 | 功能 |
| --- | --- |
| F2 | 触发绿旗，调用 vm.greenFlag() |
| F4 | 切换全屏 |
| controls.js | 提供触屏按钮 / 摇杆等支持 |

---

## 产物说明

### EXE 产物

产物目录中通常会生成类似结构：

```text
<输出目录>/
└── <AppName>_EXE.7z
    └── <AppName>/
        ├── game.exe
        ├── package.json
        ├── WebView2Loader.dll
        └── www/
            ├── index.html
            ├── controls.js
            ├── icons/
            └── ...
```

### APK 产物

```text
<输出目录>/
└── <AppName>.apk
```

生成的 APK 已使用内置签名证书完成签名，通常可直接安装测试。

---

## PyInstaller 构建说明

如果需要生成可分发的 Windows GUI 工具，可以使用 PyInstaller：

```bash
pip install pyinstaller Pillow py7zr PyQt5
pyinstaller main.spec --clean
```

生成后，程序会输出到 dist 目录中，通常包含：

```text
dist/Web资源打包工具/
├── Web资源打包工具.exe
├── 打包器/
├── template.APK
├── controls.js
├── tools/
└── ...
```

程序内部会在运行时自动解析资源路径，兼容源码运行和 PyInstaller 打包环境。

---

## 常见说明

- 程序会优先将配置保存到用户可写目录，避免打包后写入只读目录失败
- 若未安装 py7zr，则 EXE 输出会自动回退为 ZIP
- 若资源目录中没有 index.html，程序会自动搜索并选择最佳入口页面
- 若检测到 Scratch 工程，则会自动注入必要脚本和控制栏修正逻辑

---

## 适用场景

该工具适合以下使用场景：

- 将静态前端项目快速封装成桌面应用
- 将 Scratch 导出项目转为可执行文件
- 将页面包成安卓安装包做演示或测试
- 需要快速生成可交付的 Web 容器产物

如果你希望继续优化 README 风格，例如更偏“产品展示型”、更偏“技术文档型”，或者加入截图和使用示例，我也可以继续帮你完善。
