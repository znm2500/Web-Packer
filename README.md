# 📦 Web资源打包工具

一个基于 PyQt5/PyQt6 的 GUI 打包工具，将本地 Web 资源（HTML/JS/CSS 项目、Scratch 导出项目等）一键打包为 **Windows EXE**（7z 压缩）和 **Android APK**（已签名）双平台产物。

---

## ✨ 功能特性

- 🪟 **Windows EXE 打包**：基于 WebView2 模板 `game.exe`，自动注入图标、更新配置、打包为 7z/ZIP
- 🤖 **Android APK 打包**：基于 `template.APK` 模板，直接写入 `assets/www`，Patch Manifest 包名/版本/名称，JDK jarsigner 自动签名
- 🎨 **多尺寸图标自动生成**：自定义 PNG/JPG 图标自动缩放到 16/32/64/128/256/512 全套尺寸（需要 Pillow）
- 🧩 **Scratch 项目自动识别与补丁**：
  - 检测 Scratch 项目特征（`project.json`、`assets/`、scratch-* 关键字等）
  - 自动注入 CSS 隐藏控制栏
  - 绑定快捷键：**F2 = 触发绿旗**、**F4 = 全屏切换**
- 📁 **灵活的资源输入**：支持文件夹 / 压缩包（.zip/.7z/.rar/.tar/.gz）/ 单 .html 文件
- 🚀 **流水线式打包**：公共准备阶段（资源→HTML入口→控件补丁→Scratch补丁→图标）一次处理，多格式并行构建
- 💾 **GUI 配置持久化**：输出目录、应用名、AppId、版本号、窗口大小自动保存到 `gui_config.json`

---

## 📁 目录结构

```
GameJolt_Download/
├── pack_tool_gui.py          # 主程序入口 (GUI + 打包核心逻辑)
├── controls.js               # Scratch 移动端控制脚本注入到 www/ 根目录
├── template.APK              # APK 模板文件（构建时写入 assets/www + Patch）
├── gui_config.json           # GUI 配置（自动生成/保存）
│
└── 打包器/                    # EXE 模板目录
    ├── game.exe              # WebView2 运行时容器
    ├── WebView2Loader.dll    # WebView2 加载器
    ├── package.json          # EXE 配置模板（构建时自动更新）
    └── www/
        ├── icons/            # 默认图标集 (icon-16/32/64/128/256/512.png)
        └── ...               # 其他静态资源
```

---

## 🔧 环境要求

### 必选
- **Python 3.8+**
- **PyQt5 或 PyQt6**（两者任一自动识别）

### 可选依赖
| 依赖 | 用途 | 缺失行为 |
|------|------|----------|
| `Pillow` | 自定义图标缩放到多尺寸 PNG | 使用模板默认图标，无法自定义图标 |
| `py7zr` | 输出 7z 格式压缩包 | 回退为标准 ZIP 格式（.zip） |
| **JDK 17+** | APK 签名 (keytool + jarsigner) | APK 格式无法输出 |

### 安装命令

```bash
# 基础依赖（仅 EXE 打包 + 默认图标 + ZIP 输出）
pip install PyQt5

# 完整依赖（推荐：含自定义图标 + 7z 输出）
pip install PyQt5 Pillow py7zr

# PyQt6 用户可替换为
pip install PyQt6 Pillow py7zr
```

---

## 🚀 使用方法

### 启动 GUI

```bash
python pack_tool_gui.py
```

### 打包步骤

1. **① 选择本地 Web 资源**
   - 点击「浏览文件夹…」选择包含 `index.html` 的项目目录
   - 或「浏览文件…」选择压缩包（.zip/.7z/.tar 等）或单 .html 文件

2. **② 打包配置**
   - **输出压缩包名称**：决定最终产物文件名（建议英文/数字，不含特殊字符）
   - **自定义图标**（可选）：选择一张 PNG/JPG/BMP/ICO 图片，自动生成全套尺寸图标
   - **输出格式勾选**：
     - 🪟 Windows EXE（7z 打包）
     - 🤖 Android APK（直接导出签名 APK）
     - 点击「✅ 全选/反选 (2 种)」快速切换

3. **③ EXE 专属参数**（仅勾选 EXE 时显示）
   - 无控制台窗口 (Windows GUI 子系统)
   - 请求管理员权限 (requireAdministrator)

4. **④ APK 专属参数**（仅勾选 APK 时显示）
   - 应用包名 (AppId)：如 `com.example.myapp`
   - 应用版本号：如 `1.0.0.0`

5. **⑤ 输出设置**
   - 选择输出目录（默认：用户主目录）
   - 「保留工作副本」用于调试时查看中间产物

6. **点击 🚀 开始构建**
   - 构建过程实时显示进度条 + 彩色日志
   - 构建完成后自动打开输出目录，弹窗展示产物列表与大小

---

## 🏭 打包流水线详解

```
┌─────────────────────────────────────────────────────────┐
│  公共准备阶段（所有格式共享）                             │
├─────────────────────────────────────────────────────────┤
│  1. 创建 <输出目录>/<AppName>_build/ 工作区              │
│  2. 复制 打包器/ 模板 → 工作区副本                        │
│  3. 拷贝/解压用户 Web 资源 → www/                        │
│  4. 确保 index.html 存在（自动查找并重命名主 HTML）       │
│  5. 注入 controls.js 控制脚本（APK 触屏适配等）          │
│  6. Scratch 自动补丁（若命中）                            │
│     ├─ CSS: 隐藏 .control-button 控制栏                  │
│     └─ JS:  F2=vm.greenFlag()  F4=全屏切换               │
│  7. 图标处理（用户自定义缩放 / 模板默认）                 │
└─────────────────────────────────────────────────────────┘
          │              │
          ▼              ▼
┌─────────────────┐ ┌───────────────────────────┐
│ EXE 分支        │ │ APK 分支                  │
├─────────────────┤ ├───────────────────────────┤
│ • 更新 package.json │ │ • template.APK 清旧签名 │
│   (name/title/version/icon) │ │ • 写入 assets/www  │
│ • Win32 API 修改        │ │ • patch AXML string pool │
│   game.exe 内嵌图标资源  │ │   (包名/名称/版本)      │
│ • 7z 压缩 →             │ │ • 按需替换 mipmap 图标   │
│   <AppName>_EXE.7z      │ │ • jarsigner 调试签名     │
│                         │ │ → <AppName>.apk         │
└─────────────────┘       └───────────────────────────┘
```

---

## 🎮 Scratch 项目快捷键（自动注入）

| 快捷键 | 功能 |
|--------|------|
| `F2` | 触发绿旗（调用 `vm.greenFlag()`） |
| `F4` | 切换全屏（进入/退出 fullscreen） |

---

## 📦 输出产物

### EXE 格式
```
<输出目录>/
└── <AppName>_EXE.7z  (或 .zip，当缺少 py7zr 时)
    └── <AppName>/
        ├── game.exe          (已注入自定义图标)
        ├── WebView2Loader.dll
        ├── package.json      (已更新名称/版本/图标)
        └── www/              (完整 Web 资源 + 图标 + 补丁)
```

### APK 格式
```
<输出目录>/
└── <AppName>.apk  (已使用 jarsigner 调试 keystore 签名)
```

首次 APK 构建时会自动生成 `packtool-debug.keystore` 并存放在工作区（密码：`packtool123`，别名：`packtool`）。

---

## 🛠️ 技术要点

- **EXE 图标修改**：使用 `ctypes` 直接调用 Win32 API `BeginUpdateResourceW` / `UpdateResourceW` / `EndUpdateResourceW` 写入 `RT_ICON` 和 `RT_GROUP_ICON` 资源，无需额外 exe 打包工具
- **APK Manifest Patch**：手动解析 Android Binary XML (AXML) 的 string pool chunk，按偏移重写包名/应用名/versionName，避免使用 aapt/apktool 等外部依赖
- **PyQt5/PyQt6 双兼容**：启动时优先尝试 PyQt5 import，失败则回退 PyQt6，通过 `USING_PYQT6` 标志统一 API 差异（如 enum 写法）

---

## 📝 常见问题

**Q: EXE 启动提示缺少 WebView2 运行时？**  
A: 用户需安装 [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)（Win10/11 通常已内置）。

**Q: APK 安装提示「解析包错误」？**  
A: 请确认 JDK 17+ 已安装且 `JAVA_HOME` 已配置，日志中会提示 jarsigner 签名结果。

**Q: 自定义图标不生效？**  
A: 检查是否已安装 Pillow：`pip install Pillow`，或查看日志中的警告信息。

**Q: Scratch 项目 F2/F4 没反应？**  
A: 注入补丁依赖全局 `window.vm` / `window.Scratch.vm` 对象。确认 Scratch 导出时未启用 VM 隔离。
