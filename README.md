# 📦 Web资源打包工具

一个基于 **PyQt5** 的 GUI 打包工具，将本地 Web 资源（HTML/JS/CSS 项目、Scratch 导出项目等）一键打包为 **Windows EXE（7z/ZIP 压缩包）** 和 **Android APK（已签名）** 双平台产物。

APK 签名依赖项目内置的 JRE + apksigner，无需用户额外安装 JDK。

---

## ✨ 功能特性

- 🪟 **Windows EXE 打包**：基于 WebView2 模板 `打包器/game.exe`，自动更新 `package.json`（标题/版本/入口图标），将完整工程压缩为 7z / ZIP
- 🤖 **Android APK 打包**：基于 `template.APK` 模板，直接写入 `assets/www`，Patch Manifest 的包名/应用名/versionName，使用内置 `tools/jre` + `apksigner.jar` + `tools/w.jks` 自动签名
- 🎨 **多尺寸图标自动生成**：自定义 PNG/JPG 图标经 Pillow 缩放到 16/32/64/128/256/512 全套 PNG，覆盖 `打包器/www/icons/` 和 APK mipmap 资源
- 🧩 **Scratch 项目自动识别与补丁**：
  - 检测 `project.json`、`assets/` 目录、HTML/JS 中 scratch-gui / scratch-vm / `vm.greenFlag` 等特征
  - 自动注入 CSS 隐藏 `.control-button` 控制栏
  - 注入脚本绑定 **F2 = 触发绿旗 vm.greenFlag()**、**F4 = 全屏切换**
- 📱 **controls.js 触屏脚本**：自动注入 `controls.js` 到 `www/` 并在 `index.html` 中引用（Scratch 移动端按钮/摇杆控制）
- 📁 **灵活的资源输入**：支持文件夹 / 压缩包（.zip / .7z / .tar / .gz / .bz2 / .xz / .tgz）/ 单 .html 文件
- 🚀 **流水线式打包**：公共准备阶段（资源 → 入口 HTML → controls.js → Scratch 补丁 → 图标）一次处理，多格式分别构建
- 💾 **GUI 配置持久化**：输出目录、应用名、AppId、版本号、窗口大小保存到配置文件
  - 开发态：`gui_config.json`（项目根目录）
  - 打包态：`%APPDATA%\WebPacker\gui_config.json`（避免写入只读目录失败）

---

## 📁 项目结构

```
Web-Packer/
├── pack_tool_gui.py          # 主程序入口 (PyQt5 GUI + 打包核心流水线)
├── main.spec                 # PyInstaller onedir 打包配置（详见下文"发布 EXE 工具"）
├── controls.js               # Scratch 移动端触屏控制脚本（构建时注入到 www/）
├── template.APK              # APK 构建模板（写入 assets/www + Patch manifest + 签名）
├── gui_config.json           # 开发态 GUI 配置（首次运行后自动生成）
├── README.md                 # 本文档
│
├── 打包器/                    # EXE 模板目录（原样输出到产物 7z 中）
│   ├── game.exe              # WebView2 运行时容器
│   ├── WebView2Loader.dll    # WebView2 加载器
│   ├── package.json          # EXE 配置模板（构建时更新 name / title / version / icon）
│   └── www/
│       └── icons/            # 默认图标集（被用户自定义图标覆盖时替换）
│           ├── icon-16.png
│           ├── icon-32.png
│           ├── icon-64.png
│           ├── icon-128.png
│           ├── icon-256.png
│           └── icon-512.png
│
└── tools/                     # APK 签名相关（无需用户安装 JDK）
    ├── jre/                   # 内置 JRE（java.exe 用于运行 apksigner.jar）
    ├── apksigner.jar          # Google 官方 apksigner
    ├── w.jks                  # 内置签名证书（别名 key0 / 密码 123456789）
    └── zipalign.exe           # APK 对齐工具（当前流程已内嵌，预留）
```

---

## 🔧 环境要求

### 必选

- **Python 3.8+**
- **PyQt5**（代码当前锁定 PyQt5 import，不再自动回退 PyQt6）

### 可选依赖

| 依赖     | 用途                                                    | 缺失行为                                                |
| -------- | ------------------------------------------------------- | ------------------------------------------------------- |
| `Pillow` | 自定义 PNG/JPG 图标缩放到 16/32/64/128/256/512 全套尺寸 | 仅使用模板 `打包器/www/icons/` 默认图标，无法自定义图标 |
| `py7zr`  | 输出 **.7z** 格式压缩包                                 | 回退为标准 ZIP 格式（`.zip`），压缩比较低但兼容性好     |

> APK 签名**无需用户安装 JDK**：程序通过内置 `tools/jre/bin/java.exe` 运行 `tools/apksigner.jar`，并使用 `tools/w.jks` 作为签名证书。

### 安装命令

```bash
# 最小依赖（仅 EXE 打包 + 默认图标 + ZIP 输出；APK 始终可用因为 JRE/apksigner 内置）
pip install PyQt5

# 推荐完整依赖（含自定义图标缩放 + 7z 输出）
pip install PyQt5 Pillow py7zr
```

---

## 🚀 使用方法

### 启动 GUI

```bash
python pack_tool_gui.py
```

### 打包步骤

1. **① 选择本地 Web 资源**
   - 点击「**浏览文件夹…**」选择包含 `index.html` 的 Web 项目目录
   - 或「**浏览文件…**」选择压缩包（.zip / .7z / .tar 等）或单 `.html` 文件
   - 如入口不是 `index.html`，程序会自动扫描最合适的 HTML 并重命名

2. **② 打包配置 · 通用**
   - **输出压缩包名称**：决定最终 EXE .7z / APK 文件名（建议英文/数字/下划线，避免特殊字符）
   - **自定义图标**（可选）：选择一张 PNG/JPG/BMP/ICO 图片，自动缩放到 6 种尺寸分别用于 EXE 工程的 `www/icons/` 和 APK 的 `res/mipmap-*`
   - **输出格式**：
     - 🪟 **Windows EXE**（输出 `<AppName>_EXE.7z` 或 `.zip`）
     - 🤖 **Android APK**（输出已签名 `<AppName>.apk`）
     - 点击「**✅ 全选/反选 (2 种)**」快速切换

3. **③ EXE 专属参数**（勾选 EXE 时显示）
   - 无控制台窗口 (Windows GUI 子系统)
   - 请求管理员权限 (requireAdministrator)
   - 注：当前版本参数**保留显示**供后续扩展使用

4. **④ APK 专属参数**（勾选 APK 时显示）
   - **应用包名 (AppId)**：如 `com.example.myapp`（非字母数字会被替换为下划线，不足两段自动补全）
   - **应用版本号**：如 `1.0.0.0`

5. **⑤ 输出设置**
   - **输出目录**：默认用户主目录，可随时更改并自动记忆
   - **保留工作副本**：调试时查看 `<AppName>_build/` 中间产物，默认自动删除

6. **点击 🚀 开始构建**
   - 实时进度条 + 彩色操作日志（INFO / OK / WARN / ERR / DBG）
   - 构建完成后自动打开输出目录，弹窗展示产物列表、文件大小

---

## 🏭 打包流水线详解

```
┌───────────────────────────────────────────────────────────────┐
│  公共准备阶段（所有输出格式共享一次准备结果）                    │
├───────────────────────────────────────────────────────────────┤
│  1. 创建  <输出目录>/<AppName>_build/  工作区                  │
│  2. 复制 打包器/ 模板 →  _prepared/template/                   │
│  3. 拷贝/解压用户 Web 资源 →  _prepared/www/                   │
│     (压缩包自动用 zipfile / tarfile / py7zr 解压)              │
│  4. 确保 index.html 存在                                       │
│     (index.html 缺失时：自动选最适合的 HTML 重命名)            │
│  5. patch_controls_script：                                    │
│     ├─ 复制 controls.js → www/controls.js                     │
│     └─ 在 </head> 或 </body> 注入                              │
│        <script defer src="controls.js"></script>               │
│  6. Scratch 自动补丁（若命中特征）                              │
│     ├─ CSS：注入 .control-button { display:none }             │
│     └─ JS：  document keydown 监听                             │
│             F2 → vm.greenFlag()                               │
│             F4 → 进入/退出 requestFullscreen                  │
│  7. 图标处理 generate_icons：                                  │
│     有自定义图标 + Pillow → PNG 缩放覆盖 www/icons/icon-*.png  │
│     否则 → 直接复用模板 www/icons/ 默认图标                    │
└───────────────────────────────────────────────────────────────┘
          │                    │
          ▼                    ▼
┌─────────────────────┐  ┌──────────────────────────────────┐
│  EXE 分支           │  │  APK 分支                         │
├─────────────────────┤  ├──────────────────────────────────┤
│  • 拷贝 template  →  │  │  • 用 template.APK 作为 Zip 源    │
│    <AppName>/        │  │  • 跳过 META-INF/ 旧签名 &        │
│  • 用 prepared/www   │  │    assets/www/ 占位               │
│    覆盖 www/         │  │  • 写入 assets/www/ 全部资源      │
│  • 更新 package.json │  │  • patch_axml_strings：           │
│    (name/title/version │  │   AndroidManifest binary XML   │
│     /window.icon)    │  │   string-pool 替换包名/名称/ver  │
│  • make_7z：         │  │  • 按需替换 APK mipmap-* 图标    │
│    7z 或 ZIP 压缩    │  │  • sign_apk_with_pyapksigner：   │
│    → <AppName>_EXE.7z│  │    内置 JRE 运行 apksigner.jar   │
│    (或 .zip)         │  │    w.jks 签名 → <AppName>.apk    │
└─────────────────────┘  └──────────────────────────────────┘
```

---

## 🎮 Scratch 项目快捷键（打包后自动注入）

| 快捷键        | 功能                                                                    |
| ------------- | ----------------------------------------------------------------------- |
| `F2`          | 触发绿旗（调用全局 `vm.greenFlag()` / `window.Scratch.vm.greenFlag()`） |
| `F4`          | 切换全屏（进入 / 退出 fullscreenElement）                               |
| `controls.js` | 触屏虚拟按钮/摇杆（详见注入到 www 根的脚本）                            |

---

## 📦 输出产物

### EXE 格式

```
<输出目录>/
└── <AppName>_EXE.7z     (或 .zip，缺失 py7zr 时回退)
    └── <AppName>/
        ├── game.exe              # WebView2 容器
        ├── WebView2Loader.dll
        ├── package.json          # 已更新 name/title/version/window.icon
        └── www/
            ├── index.html        # (已可能注入 Scratch CSS/JS + controls.js 引用)
            ├── controls.js
            ├── icons/
            │   ├── icon-16.png ~ icon-512.png
            │   └── (若自定义图标：app.ico 仅中间产物)
            └── ……用户原始 Web 资源
```

### APK 格式

```
<输出目录>/
└── <AppName>.apk          # 已使用 apksigner + tools/w.jks 签名
                           # 包名/应用名/versionName/APK 图标已替换
```

**APK 签名参数（内置固定）**

- 证书：`tools/w.jks`
- 别名：`key0`
- 密钥库密码 / 密钥密码：`123456789`
- 签名命令使用的是 Google 官方 `apksigner.jar sign --ks …` 流程（`--in` 和 `--out` 指向同一路径，原地签名）

---

## 🏗️ 发布 EXE 工具（PyInstaller onedir）

本项目可以通过 `main.spec` 用 **PyInstaller** 构建成**独立的 Windows GUI EXE 工具**，对普通用户免安装 Python。

### 构建命令

```bash
pip install pyinstaller Pillow py7zr PyQt5
pyinstaller main.spec --clean
```

### 产物

```
dist/Web资源打包工具/
├── Web资源打包工具.exe      # 启动器（GUI 无控制台）
├── 打包器/                  # → PACKAGER_TEMPLATE 模板
├── template.APK            # → APK_TEMPLATE
├── controls.js             # → CONTROLS_JS
└── tools/                  # → TOOLS_DIR (JRE + apksigner.jar + w.jks + zipalign.exe)
```

**路径解析规则（`_resolve_base_dir`）**：

| 运行模式                              | `BASE_DIR` 解析来源                                                          |
| ------------------------------------- | ---------------------------------------------------------------------------- |
| 源码运行（`python pack_tool_gui.py`） | `Path(__file__).parent`                                                      |
| PyInstaller onefile                   | `sys._MEIPASS`（临时解包目录）                                               |
| PyInstaller onedir（推荐）            | `sys.executable` 所在目录，即 `dist/Web资源打包工具/`（与上面 4 个目录并列） |

**配置文件路径（`_resolve_config_dir`）**：

- 打包后：`%APPDATA%\WebPacker\gui_config.json`（避免 `_MEIPASS` 只读目录写入失败）
- 开发态：`<项目根>/gui_config.json`

---

## 🛠️ 技术要点

- **EXE 图标资源更新接口已实现**（`change_exe_icon`）：使用 `ctypes` 直接调用 Win32 API `BeginUpdateResourceW / UpdateResourceW / EndUpdateResourceW` 写入 `RT_ICON` 和 `RT_GROUP_ICON` 资源，可在不依赖外部工具的前提下替换 PE 文件内嵌图标（当前流水线已预留进度条步骤，后续可启用将 `game.exe` 重命名为 `<AppName>.exe` 并调用之）。
- **APK Manifest Patch**：不依赖 `aapt` / `apktool`，而是通过 `patch_axml_strings` 手动解析 Android Binary XML (AXML) 的 string pool chunk（0x0001 Chunk），按 UTF-8/UTF-16 长度编码规则就地替换占位符包名/应用名/versionName，并修正 chunk size 和文件头 total size。
- **APK 资源拷贝**：`repack_template_apk` 用 `zipfile.ZipFile` 流式搬运，删除 `META-INF/*`（旧签名）、旧 `assets/www/`，然后整体写入新 `assets/www/`；命中自定义图标时替换 APK 内 `res/mipmap-*/icon.png`。
- **PyQt5/PyQt6 差异**：代码当前优先固定 PyQt5 import，`USING_PYQT6` 标志仍保留用于个别 enum 兼容写法（如 `QTextCursor.End` / `QDialog.Accepted`）。

---

## 📝 常见问题

**Q：EXE 打开提示缺少 WebView2 运行时？**  
A：用户机器需安装 [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)（Windows 10/11 较新版本已内置）。产物中已包含 `WebView2Loader.dll`，仅缺 Runtime 时会提示下载。

**Q：APK 安装提示「解析包错误」？**  
A：请查看日志中「[APK] 签名失败」行，排查以下原因：

1. `tools/jre/bin/java.exe` 丢失（若使用 PyInstaller 发布：请确认 `tools/` 目录是否被正确 COLLECT 到 onedir 根）
2. `tools/apksigner.jar` 或 `tools/w.jks` 丢失
3. 包名含不合法字符（程序会自动 sanitize，但仍建议使用标准 `com.xxx.yyy` 格式）

**Q：自定义图标不生效？**  
A：确认已安装 Pillow 并重启 GUI：`pip install Pillow`。若图片损坏或格式不被 PIL 支持，日志会出现「自定义图标加载失败，回退默认图标」告警。

**Q：Scratch 项目 F2 / F4 无反应？**  
A：注入脚本依赖全局 `window.vm` / `window.Scratch.vm` / `window.__scratchGui.getVm()` 三种常见暴露方式；若 Scratch 导出时启用了严格隔离（无全局 VM 引用），需手动调整导出模式。

**Q：PyInstaller 发布后 APK 功能报找不到 JRE？**  
A：检查 `dist/Web资源打包工具/` 是否存在 `tools/jre/` 目录。若缺失，说明构建时 `collect_dir` 未生效；请用最新 `main.spec`（含 `tools/` 收集逻辑）重新执行：`pyinstaller main.spec --clean`。
