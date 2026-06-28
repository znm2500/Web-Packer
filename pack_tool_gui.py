#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
Web资源打包工具 (EXE + APK 双格式)
流程:
  1. 复制 打包器\ 模板到工作目录
  2. 把选中Web资源复制进 打包器\www\  (确保有index.html, 没有则自动识别/重命名)
  3. 图标策略: 用户图标→Pillow缩放 或 直接使用 打包器\www\icons\ 默认图标
  4. 若是 Scratch 项目: 自动注入CSS隐藏控制栏+JS绑定F4(全屏)/F2(绿旗)
  5. EXE分支: ctypes + Win32 API 修改 game.exe 内嵌图标 + 更新 package.json + 重命名 AppName.exe → 7z
  6. APK分支: template.APK 写入 assets/www + manifest 包名/版本/名称 patch + 签名 → APK
"""
import sys
import os
import io
import json
import shutil
import struct
import tempfile
import zipfile
import tarfile
import subprocess
import ctypes
import ctypes.wintypes as wintypes
from pathlib import Path
from datetime import datetime
from typing import List, Tuple, Optional

# =========================================================
# PyQt5 / PyQt6 自动兼容层
# =========================================================
try:
    from PyQt5.QtWidgets import (
        QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
        QLabel, QLineEdit, QPushButton, QFileDialog, QComboBox, QCheckBox,
        QProgressBar, QTextEdit, QGroupBox, QMessageBox, QRadioButton,
        QButtonGroup, QSpinBox, QTabWidget, QStatusBar, QSizePolicy,
        QListWidget, QListWidgetItem, QSplitter, QTableWidget, QTableWidgetItem,
        QHeaderView, QAbstractItemView, QDialog, QDialogButtonBox, QFormLayout,
        QFrame
    )
    from PyQt5.QtCore import Qt, QThread, pyqtSignal, QSize
    from PyQt5.QtGui import QIcon, QFont, QColor, QTextCursor
    USING_PYQT6 = False
    QT_VERSION_STR = "PyQt5"
except Exception:
    try:
        from PyQt6.QtWidgets import (
            QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
            QLabel, QLineEdit, QPushButton, QFileDialog, QComboBox, QCheckBox,
            QProgressBar, QTextEdit, QGroupBox, QMessageBox, QRadioButton,
            QButtonGroup, QSpinBox, QTabWidget, QStatusBar, QSizePolicy,
            QListWidget, QListWidgetItem, QSplitter, QTableWidget, QTableWidgetItem,
            QHeaderView, QAbstractItemView, QDialog, QDialogButtonBox, QFormLayout,
            QFrame
        )
        from PyQt6.QtCore import Qt, QThread, pyqtSignal, QSize
        from PyQt6.QtGui import QIcon, QFont, QColor, QTextCursor
        USING_PYQT6 = True
        QT_VERSION_STR = "PyQt6"
    except Exception as e:
        print("ERROR: 既未安装 PyQt5 也未安装 PyQt6！请执行:")
        print("    pip install PyQt5 Pillow py7zr")
        print("或: pip install PyQt6 Pillow py7zr")
        sys.exit(1)


# =========================================================
# 可选依赖: Pillow (图标生成) / py7zr (7z压缩)
# =========================================================
try:
    from PIL import Image, ImageDraw, ImageFont
    HAS_PILLOW = True
except ImportError:
    HAS_PILLOW = False

try:
    import py7zr
    HAS_PY7ZR = True
except ImportError:
    HAS_PY7ZR = False


BASE_DIR = Path(__file__).resolve().parent
PACKAGER_TEMPLATE = BASE_DIR / "打包器"
APK_TEMPLATE = BASE_DIR / "template.APK"
CONTROLS_JS = BASE_DIR / "controls.js"
CONFIG_FILE = BASE_DIR / "gui_config.json"

ICON_SIZES = [16, 32, 64, 128, 256, 512]


# =========================================================
# 通用工具函数
# =========================================================
def load_json(path: Path) -> dict:
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def save_json(path: Path, data: dict):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent='\t')


def load_gui_config() -> dict:
    default = {
        'output_dir': str(Path.home()),
        'app_name': 'MyApp',
        'app_version': '1.0.0.0',
        'window_size': [900, 720]
    }
    if CONFIG_FILE.exists():
        try:
            default.update(load_json(CONFIG_FILE))
        except Exception:
            pass
    return default


def save_gui_config(cfg: dict):
    try:
        save_json(CONFIG_FILE, cfg)
    except Exception:
        pass


def extract_archive(src: Path, dest: Path) -> Tuple[bool, str]:
    """解压 zip/rar(仅无密码)/7z/tar 等压缩包到 dest"""
    dest.mkdir(parents=True, exist_ok=True)
    sfx = src.suffix.lower()
    try:
        if sfx in ('.zip',):
            with zipfile.ZipFile(src, 'r') as z:
                z.extractall(dest)
        elif sfx in ('.tar', '.gz', '.bz2', '.xz', '.tgz'):
            mode = 'r:*'
            with tarfile.open(src, mode) as t:
                t.extractall(dest)
        elif sfx in ('.7z',) and HAS_PY7ZR:
            with py7zr.SevenZipFile(src, mode='r') as z:
                z.extractall(dest)
        else:
            # 其他类型尝试用 zipfile，失败则让用户自己解压
            if HAS_PY7ZR:
                try:
                    with py7zr.SevenZipFile(src, mode='r') as z:
                        z.extractall(dest)
                    return True, f"解压完成 (py7zr): {src.name}"
                except Exception:
                    pass
            with zipfile.ZipFile(src, 'r') as z:
                z.extractall(dest)
        return True, f"解压完成: {src.name}"
    except Exception as e:
        return False, f"解压失败: {e}"


def find_index_html(root: Path) -> Optional[Path]:
    """在目录下找最合适的 index.html (或主HTML入口)"""
    candidates_index = []
    candidates_main = []
    others = []
    for p in root.rglob('*.html'):
        if p.is_dir():
            continue
        name = p.name.lower()
        if name == 'index.html':
            candidates_index.append(p)
        elif name in ('main.html', 'app.html', 'home.html', 'start.html'):
            candidates_main.append(p)
        else:
            others.append(p)
    if candidates_index:
        # 优先最短路径 (最接近root)
        candidates_index.sort(key=lambda x: len(x.parts))
        return candidates_index[0]
    if candidates_main:
        candidates_main.sort(key=lambda x: len(x.parts))
        return candidates_main[0]
    if others:
        others.sort(key=lambda x: (len(x.parts), x.stat().st_size * -1))
        return others[0]
    return None


def ensure_index_html(www_dir: Path, log_fn) -> Tuple[bool, str]:
    """确保 www_dir 里有 index.html；如果没有，找主HTML文件重命名为index.html"""
    target = www_dir / 'index.html'
    if target.exists() and target.is_file():
        return True, "已存在 index.html"
    best = find_index_html(www_dir)
    if best is None:
        return False, ("未找到任何 .html 文件，请确认你的 Web 资源中至少包含一个 HTML 页面，"
                       "例如 index.html / main.html / app.html 等。")
    try:
        shutil.move(str(best), str(target))
    except Exception as e:
        return False, f"重命名 {best.name} → index.html 失败: {e}"
    return True, f"自动将入口 {best.relative_to(www_dir)} 重命名为 index.html"


# =========================================================
# Scratch 项目检测与注入补丁
#   1. 检测: index.html 特征(含 scratch-gui / vm / scratch-render / scratch-svg-renderer / ScratchVM
#            或 www 下存在 project.json / assets / 大量 md5ext 资源)
#   2. 补丁: 注入 CSS 隐藏控制栏 + 绑定 F4(全屏切换) / F2(绿旗 vm.greenFlag())
# =========================================================
SCRATCH_TEXT_SIGNALS = [
    'scratch-gui', 'scratch-render', 'scratch-svg-renderer',
    'scratch-audio', 'scratch-vm', 'Scratch.VM', 'ScratchVM',
    'new (window scratch', 'window.vm', 'vm.greenFlag', 'vm.stopAll',
    'ScratchStorage', 'makeProject', 'loadProject', 'project.json'
]


def is_scratch_project(www_dir: Path) -> Tuple[bool, str]:
    """判断 www_dir 是否为 Scratch 生成的前端项目"""
    index_path = www_dir / 'index.html'
    # 1) 文件/目录特征: project.json / assets/ 目录
    if (www_dir / 'project.json').exists():
        return True, "检测到 Scratch 项目文件: project.json"
    assets = www_dir / 'assets'
    if assets.exists() and assets.is_dir():
        md5_count = len(list(assets.glob('*.*')))
        if md5_count >= 3:
            return True, f"检测到 Scratch 风格 assets/ 资源目录 (含 {md5_count} 个文件)"
    # 2) index.html 文本特征
    if index_path.exists():
        try:
            text = index_path.read_text(encoding='utf-8', errors='ignore')
        except Exception as e:
            return False, f"无法读取 index.html: {e}"
        text_lower = text.lower()
        hits = [kw for kw in SCRATCH_TEXT_SIGNALS if kw.lower() in text_lower]
        if len(hits) >= 2:
            return True, f"检测到 Scratch 关键字命中: {hits[:5]}"
        # 3) 引用的 .js 文件也扫一下
        for js in list(www_dir.rglob('*.js')):
            try:
                js_text = js.read_text(encoding='utf-8', errors='ignore')[:200_000]
            except Exception:
                continue
            if 'vm.greenflag' in js_text.lower() or 'scratch-gui' in js_text.lower():
                return True, f"检测到 Scratch JS 特征于: {js.relative_to(www_dir)}"
    return False, "未检测到 Scratch 相关特征"


PATCH_STYLE = """
/* ---- Scratch 控制栏自动隐藏 (注入 by pack_tool_gui) ---- */
.control-button {
    display: none !important;
}
""".strip()

PATCH_SCRIPT = r"""
<!-- Scratch 快捷键补丁: F4 全屏切换 / F2 绿旗 (注入 by pack_tool_gui) -->
<script>
(function () {
  // F4: 全屏切换
  document.addEventListener('keydown', function (e) {
    if (e.key === 'F4') {
      e.preventDefault();
      if (!document.fullscreenElement) {
        var el = document.documentElement;
        var req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen || el.mozRequestFullScreen;
        if (req) req.call(el).catch(function (err) { console.error('无法进入全屏:', err && err.message ? err.message : err); });
      } else {
        var exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen || document.mozCancelFullScreen;
        if (exit) exit.call(document);
      }
    }
  });

  // F2: 触发绿旗 (vm.greenFlag())
  document.addEventListener('keydown', function (e) {
    if (e.key === 'F2') {
      e.preventDefault();
      var vm = null;
      try {
        if (typeof window !== 'undefined') {
          vm = window.vm;
          if (!vm && window.Scratch && window.Scratch.vm) vm = window.Scratch.vm;
          if (!vm && window.__scratchGui && window.__scratchGui.getVm) vm = window.__scratchGui.getVm();
        }
      } catch (_) { vm = null; }
      if (vm && typeof vm.greenFlag === 'function') {
        try { vm.greenFlag(); console.log('[Scratch 补丁] F2 触发 vm.greenFlag() 成功'); }
        catch (err) { console.error('[Scratch 补丁] 调用 vm.greenFlag() 失败:', err); }
      } else {
        console.warn('[Scratch 补丁] 未找到全局 vm 对象，F2 无效；请确认页面已初始化 Scratch VM');
      }
    }
  });
})();
</script>
""".strip()


def _inject_html_patch(index_path: Path, style_block: str, script_block: str) -> Tuple[bool, str]:
    """把 style_block 注入到 </head> 前；script_block 注入到 </body> 前(没有</head/body则追加)"""
    try:
        html = index_path.read_text(encoding='utf-8', errors='ignore')
    except Exception as e:
        return False, f"读取 index.html 失败: {e}"

    original = html

    # ---- 注入 STYLE 到 </head> 之前 (避免重复注入
    if 'Scratch 控制栏自动隐藏' not in html:
        style_html = f'\n<style>\n{style_block}\n</style>\n'
        lower = html.lower()
        idx = lower.find('</head>')
        if idx >= 0:
            html = html[:idx] + style_html + html[idx:]
        else:
            # 无 </head>，插到 <html 后
            html = style_html + html

    # ---- 注入 SCRIPT 到 </body> 之前
    if 'Scratch 快捷键补丁' not in html:
        script_html = f'\n{script_block}\n'
        lower2 = html.lower()
        idx2 = lower2.find('</body>')
        if idx2 >= 0:
            html = html[:idx2] + script_html + html[idx2:]
        else:
            html += script_html

    if html == original:
        return True, "补丁已存在，跳过注入"

    try:
        index_path.write_text(html, encoding='utf-8')
    except Exception as e:
        return False, f"写回 index.html 失败: {e}"
    return True, "已注入 Scratch 补丁 (控制栏隐藏 + F4全屏 / F2绿旗)"


def inject_scratch_patch_if_needed(www_dir: Path, log_fn) -> Tuple[bool, str]:
    """检测到 Scratch 时，就自动打补丁"""
    is_scratch, reason = is_scratch_project(www_dir)
    if not is_scratch:
        return True, f"非 Scratch 项目，跳过注入补丁"
    log_fn(f"检测为 Scratch 项目 → {reason}", 'info')
    index_path = www_dir / 'index.html'
    if not index_path.exists():
        return False, "检测为 Scratch 项目但未找到 index.html"
    ok, msg = _inject_html_patch(index_path, PATCH_STYLE, PATCH_SCRIPT)
    return ok, msg


# =========================================================
# 图标处理
#   用户未提供图标 → 直接复用模板默认 icons (copytree 已复制)
#   用户提供图标   → 用 Pillow 缩放到 16/32/64/128/256/512 覆盖默认图标
# =========================================================
def generate_icons(icons_dir: Path, user_icon: Optional[Path], app_name: str, log_fn) -> Tuple[bool, str, Path]:
    """
    处理图标:
      - 无 user_icon: 直接使用模板 打包器\\www\\icons\\ 中的默认图标 (copytree 阶段已复制)
      - 有 user_icon: 用 Pillow 缩放到 16/32/64/128/256/512 后写入 www/icons 覆盖默认
    返回 (成功, 信息, 512尺寸PNG路径)
    """
    icons_dir.mkdir(parents=True, exist_ok=True)
    target_512 = icons_dir / 'icon-512.png'

    if user_icon is None:
        # 用户无自定义图标 → 直接使用模板中已有的默认图标 (无需 Pillow)
        if target_512.exists():
            return True, "使用模板默认图标 (www/icons/icon-*.png)", target_512
        # 万一模板里也缺 (不应该发生)，给出明确错误
        missing = [s for s in ICON_SIZES if not (icons_dir / f'icon-{s}.png').exists()]
        if missing:
            return (False,
                    f"模板 打包器\\www\\icons\\ 中缺少尺寸图标: {missing}，请补齐或提供自定义图标",
                    None)
        return True, "使用模板默认图标", target_512

    # ---- 用户提供了自定义图标，需要用 Pillow 缩放覆盖 ----
    if not user_icon.exists():
        log_fn(f"自定义图标文件不存在，回退使用模板默认图标: {user_icon}", 'warning')
        return True, "自定义图标不存在，使用模板默认图标", target_512
    if not HAS_PILLOW:
        log_fn("已指定自定义图标但 Pillow 未安装，无法缩放图标，回退使用模板默认图标。(安装: pip install Pillow)",
               'warning')
        return True, "缺少 Pillow，使用模板默认图标", target_512

    try:
        base_img = Image.open(user_icon).convert('RGBA')
    except Exception as e:
        log_fn(f"自定义图标加载失败: {e}，回退使用模板默认图标", 'warning')
        return True, "自定义图标损坏，使用模板默认图标", target_512

    log_fn(f"使用用户自定义图标: {user_icon.name} ({base_img.size[0]}x{base_img.size[1]})", 'info')
    for sz in ICON_SIZES:
        target = icons_dir / f'icon-{sz}.png'
        try:
            img = base_img.resize((sz, sz), Image.LANCZOS)
            img.save(target, 'PNG')
        except Exception as e:
            return False, f"生成 {sz}x{sz} 图标失败: {e}", None
    return True, "已根据用户图标生成 16/32/64/128/256/512 尺寸PNG (覆盖默认)", target_512


# =========================================================
# 修改 exe 图标资源 (ctypes + Win32 API)
# =========================================================
# Win32 资源类型常量
RT_ICON = 3
RT_GROUP_ICON = 14
IMAGE_ICON = 1
LR_LOADFROMFILE = 0x00000010

kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)

BeginUpdateResourceW = kernel32.BeginUpdateResourceW
BeginUpdateResourceW.restype = wintypes.HANDLE
BeginUpdateResourceW.argtypes = [wintypes.LPCWSTR, wintypes.BOOL]

UpdateResourceW = kernel32.UpdateResourceW
UpdateResourceW.restype = wintypes.BOOL
UpdateResourceW.argtypes = [
    wintypes.HANDLE, ctypes.c_void_p, ctypes.c_void_p,
    wintypes.WORD, ctypes.c_void_p, wintypes.DWORD
]

EndUpdateResourceW = kernel32.EndUpdateResourceW
EndUpdateResourceW.restype = wintypes.BOOL
EndUpdateResourceW.argtypes = [wintypes.HANDLE, wintypes.BOOL]


def _png_to_ico_bytes(png_paths: List[Path], sizes: List[int]) -> bytes:
    """
    把多尺寸PNG (16/32/64/128/256/512) 打包成 ICO 格式字节 (用于生成 .ico)
    同时返回: (ico_bytes, icon_entries_data_list, group_bytes)
    """
    entries_header = b''
    raw_images = []
    for sz in sizes:
        png_path = [p for p in png_paths if p.name == f'icon-{sz}.png']
        if not png_path:
            continue
        png_path = png_path[0]
        data = png_path.read_bytes()
        w = sz if sz < 256 else 0
        h = sz if sz < 256 else 0
        color_count = 0
        reserved = 0
        planes = 1
        bit_count = 32
        bytes_in_res = len(data)
        image_offset = 0  # 后面再填
        entries_header += struct.pack(
            '<BBBBHHII',
            w, h, color_count, reserved, planes, bit_count,
            bytes_in_res, image_offset
        )
        raw_images.append(data)

    # 计算每个 image 的 offset
    id_count = len(raw_images)
    icondir = struct.pack('<HHH', 0, 1, id_count)
    header_size = len(icondir) + len(entries_header)
    offset = header_size
    new_entries = b''
    i = 0
    entry_size = 16
    group_entries_info = []
    pos = 0
    for data in raw_images:
        entry = entries_header[pos:pos + entry_size]
        w, h, cc, res, planes, bc, size_bytes, _ = struct.unpack('<BBBBHHII', entry)
        new_entry = struct.pack('<BBBBHHII', w, h, cc, res, planes, bc, size_bytes, offset)
        new_entries += new_entry
        group_entries_info.append((w, h, cc, planes, bc, size_bytes, i + 1))
        offset += size_bytes
        i += 1
        pos += entry_size

    ico_bytes = icondir + new_entries + b''.join(raw_images)
    return ico_bytes, group_entries_info


def _make_group_icon_resource_bytes(group_entries_info: List[Tuple]) -> bytes:
    """构建 RT_GROUP_ICON 的资源内容 (GRPICONDIR)"""
    id_count = len(group_entries_info)
    data = struct.pack('<HHH', 0, 1, id_count)
    for (w, h, cc, planes, bc, size_bytes, id) in group_entries_info:
        # GRPICONDIRENTRY: 14 bytes (最后字段是 WORD id，非 DWORD offset)
        data += struct.pack('<BBBBHHIH', w, h, cc, 0, planes, bc, size_bytes, id)
    return data


def change_exe_icon(exe_path: Path, icons_dir: Path, sizes: List[int]) -> Tuple[bool, str]:
    """调用 Win32 API 把 exe 的图标资源改成 icons_dir 下的多尺寸 PNG"""
    png_paths = [icons_dir / f'icon-{s}.png' for s in sizes]
    missing = [p for p in png_paths if not p.exists()]
    if missing:
        return False, f"缺少图标文件: {[p.name for p in missing]}"

    try:
        ico_bytes, group_entries_info = _png_to_ico_bytes(png_paths, sizes)
    except Exception as e:
        return False, f"打包ICO数据失败: {e}"

    # 1) 写出临时 ICO 文件 (仅保留，便于用户复用)
    ico_temp = icons_dir / 'app.ico'
    ico_temp.write_bytes(ico_bytes)

    # 2) UpdateResource 写入 RT_ICON (每个尺寸一个ID) 和 RT_GROUP_ICON (ID 通常 101 或 32512 = IDI_APPLICATION)
    exe_str = str(exe_path)
    h = BeginUpdateResourceW(exe_str, False)
    if not h:
        err = ctypes.get_last_error()
        return False, f"BeginUpdateResourceW 失败, 错误码: {err} (请确保 {exe_path.name} 未被占用且有写入权限)"

    ok_all = True
    last_err = 0
    # 每个 png 作为独立 RT_ICON 资源，id 从 1 开始
    for idx, (png_path, sz) in enumerate(zip(png_paths, sizes), start=1):
        data = png_path.read_bytes()
        id_resource = idx
        # RT_ICON 资源是 ICONIMAGE (PNG)，类型=RT_ICON=3
        res = UpdateResourceW(
            h,
            ctypes.c_void_p(RT_ICON),
            ctypes.c_void_p(id_resource),
            0x0409,  # MAKELANGID(LANG_NEUTRAL, SUBLANG_NEUTRAL) = 0
            ctypes.c_char_p(data),
            len(data)
        )
        if not res:
            last_err = ctypes.get_last_error()
            # 忽略单个尺寸失败，继续
    # 写 group 资源，常用 ID 32512 = IDI_APPLICATION
    group_data = _make_group_icon_resource_bytes(group_entries_info)
    IDI_APPLICATION = 32512
    res = UpdateResourceW(
        h,
        ctypes.c_void_p(RT_GROUP_ICON),
        ctypes.c_void_p(IDI_APPLICATION),
        0x0409,
        ctypes.c_char_p(group_data),
        len(group_data)
    )
    if not res:
        last_err = ctypes.get_last_error()
        ok_all = False

    discard = not ok_all
    end_ok = EndUpdateResourceW(h, discard)
    if not end_ok:
        last_err = ctypes.get_last_error()
        return False, f"EndUpdateResourceW 失败, 错误码: {last_err}"
    if not ok_all:
        return False, f"部分资源写入失败, 最后错误码: {last_err}"
    return True, f"已成功修改 {exe_path.name} 的内嵌图标 (含 {len(group_entries_info)} 个尺寸)"


# =========================================================
# 7z 压缩
# =========================================================
def make_7z(source_dir: Path, output_7z: Path, log_fn) -> Tuple[bool, str]:
    """把 source_dir 整个目录压缩为 output_7z"""
    if not HAS_PY7ZR:
        # Fallback: zip
        output_zip = output_7z.with_suffix('.zip')
        try:
            base_name = source_dir.name
            with zipfile.ZipFile(output_zip, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
                for f in source_dir.rglob('*'):
                    if f.is_file():
                        arcname = f'{base_name}/{f.relative_to(source_dir)}'
                        zf.write(f, arcname)
            msg = (f"py7zr 未安装，已使用 ZIP 格式代替: {output_zip.name}\n"
                   "安装后可获得 .7z 文件: pip install py7zr")
            log_fn(msg, 'warning')
            return True, msg
        except Exception as e:
            return False, f"ZIP 压缩失败: {e}"

    try:
        with py7zr.SevenZipFile(output_7z, 'w') as z:
            z.writeall(source_dir, arcname=source_dir.name)
        size_mb = output_7z.stat().st_size / (1024 * 1024)
        return True, f"7z 压缩完成: {output_7z.name} ({size_mb:.2f} MB)"
    except Exception as e:
        return False, f"7z 压缩失败: {e}"


# =========================================================
# APK 直接导出: template.APK + assets/www + manifest patch + jarsigner
# =========================================================
APK_PACKAGE_PLACEHOLDER = 'Scratch.YourPort.GameByGamePortCreatorMobileByYou'
APK_NAME_PLACEHOLDER = 'YourGameName'
APK_VERSION_PLACEHOLDER = '1.0.0'
APK_SIGNATURE_PREFIXES = ('META-INF/',)
APK_ICON_TARGETS = {
    'res/mipmap-ldpi-v4/icon.png': 32,
    'res/mipmap-mdpi-v4/icon.png': 64,
    'res/mipmap-hdpi-v4/icon.png': 64,
    'res/mipmap-xhdpi-v4/icon.png': 128,
    'res/mipmap-xxhdpi-v4/icon.png': 256,
    'res/mipmap-xxxhdpi-v4/icon.png': 512,
}


def patch_controls_script(www_dir: Path, log_fn) -> Tuple[bool, str]:
    """确保 controls.js 放在 www 根目录，并在 index.html 中引用它。"""
    index_path = www_dir / 'index.html'
    if not index_path.exists():
        return False, "未找到 index.html，无法注入 controls.js 引用"
    if not CONTROLS_JS.exists():
        return False, f"找不到 controls.js: {CONTROLS_JS}"
    try:
        shutil.copy2(CONTROLS_JS, www_dir / 'controls.js')
        html = index_path.read_text(encoding='utf-8', errors='ignore')
        if 'src="controls.js"' in html or "src='controls.js'" in html:
            return True, "controls.js 已存在并已引用，跳过 script patch"
        script_tag = '\n<script defer src="controls.js"></script>\n'
        lower = html.lower()
        idx = lower.find('</head>')
        if idx >= 0:
            html = html[:idx] + script_tag + html[idx:]
        else:
            idx = lower.find('</body>')
            html = html[:idx] + script_tag + html[idx:] if idx >= 0 else html + script_tag
        index_path.write_text(html, encoding='utf-8')
        return True, "已复制 controls.js 并注入 <script defer src=\"controls.js\"></script>"
    except Exception as e:
        return False, f"controls.js script patch 失败: {e}"


def _sanitize_android_package(app_id: str) -> str:
    parts = []
    for raw in (app_id or '').strip().split('.'):
        part = ''.join(ch if (ch.isalnum() or ch == '_') else '_' for ch in raw)
        if not part:
            continue
        if part[0].isdigit():
            part = '_' + part
        parts.append(part)
    if len(parts) < 2:
        parts = ['com', 'example', 'myapp']
    return '.'.join(parts)


def _axml_decode_length(data: bytes, pos: int, utf8: bool) -> Tuple[int, int]:
    if utf8:
        first = data[pos]
        if first & 0x80:
            return ((first & 0x7f) << 8) | data[pos + 1], pos + 2
        return first, pos + 1
    first = struct.unpack_from('<H', data, pos)[0]
    if first & 0x8000:
        second = struct.unpack_from('<H', data, pos + 2)[0]
        return ((first & 0x7fff) << 16) | second, pos + 4
    return first, pos + 2


def _axml_encode_length(length: int, utf8: bool) -> bytes:
    if utf8:
        if length > 0x7f:
            return bytes([0x80 | ((length >> 8) & 0x7f), length & 0xff])
        return bytes([length])
    if length > 0x7fff:
        return struct.pack('<HH', 0x8000 | ((length >> 16) & 0x7fff), length & 0xffff)
    return struct.pack('<H', length)


def patch_axml_strings(axml: bytes, replacements: dict) -> bytes:
    """重写 Android binary XML 的 string pool，适合替换包名/应用名/versionName。"""
    if len(axml) < 36:
        raise ValueError('AndroidManifest.xml 太短，无法解析')
    xml_type, xml_header_size, xml_size = struct.unpack_from('<HHI', axml, 0)
    if xml_type != 0x0003:
        raise ValueError('不是 Android binary XML 文件')
    pool_off = xml_header_size
    chunk_type, header_size, chunk_size = struct.unpack_from('<HHI', axml, pool_off)
    if chunk_type != 0x0001:
        raise ValueError('AndroidManifest.xml 未找到 string pool')
    string_count, style_count, flags, strings_start, styles_start = struct.unpack_from('<IIIII', axml, pool_off + 8)
    utf8 = bool(flags & 0x00000100)
    offsets_base = pool_off + header_size
    strings_base = pool_off + strings_start
    string_offsets = [struct.unpack_from('<I', axml, offsets_base + i * 4)[0] for i in range(string_count)]
    old_strings_end = pool_off + (styles_start if styles_start else chunk_size)
    strings = []
    for off in string_offsets:
        pos = strings_base + off
        if utf8:
            char_len, pos = _axml_decode_length(axml, pos, True)
            byte_len, pos = _axml_decode_length(axml, pos, True)
            raw = axml[pos:pos + byte_len]
            text = raw.decode('utf-8', errors='replace')
        else:
            char_len, pos = _axml_decode_length(axml, pos, False)
            raw = axml[pos:pos + char_len * 2]
            text = raw.decode('utf-16le', errors='replace')
        for old, new in replacements.items():
            text = text.replace(old, new)
        strings.append(text)

    new_offsets = bytearray()
    new_data = bytearray()
    for text in strings:
        new_offsets += struct.pack('<I', len(new_data))
        if utf8:
            raw = text.encode('utf-8')
            new_data += _axml_encode_length(len(text), True)
            new_data += _axml_encode_length(len(raw), True)
            new_data += raw + b'\x00'
        else:
            raw = text.encode('utf-16le')
            new_data += _axml_encode_length(len(text), False)
            new_data += raw + b'\x00\x00'
    while len(new_data) % 4:
        new_data += b'\x00'

    old_offsets_end = offsets_base + (string_count + style_count) * 4
    styles_data = axml[old_strings_end:pool_off + chunk_size] if styles_start else b''
    before_offsets = bytearray(axml[pool_off:offsets_base])
    new_styles_start = strings_start + len(new_data) if styles_start else 0
    new_chunk_size = strings_start + len(new_data) + len(styles_data)
    struct.pack_into('<I', before_offsets, 4, new_chunk_size)
    struct.pack_into('<I', before_offsets, 24, new_styles_start)

    new_pool = bytes(before_offsets) + bytes(new_offsets) + axml[offsets_base + string_count * 4:old_offsets_end] + bytes(new_data) + styles_data
    delta = len(new_pool) - chunk_size
    out = bytearray(axml[:pool_off] + new_pool + axml[pool_off + chunk_size:])
    struct.pack_into('<I', out, 4, xml_size + delta)
    return bytes(out)


def _copy_zip_entry(src_zip: zipfile.ZipFile, dst_zip: zipfile.ZipFile, info: zipfile.ZipInfo, data: bytes):
    zi = zipfile.ZipInfo(info.filename, info.date_time)
    zi.comment = info.comment
    zi.extra = info.extra
    zi.internal_attr = info.internal_attr
    zi.external_attr = info.external_attr
    zi.create_system = info.create_system
    zi.compress_type = info.compress_type
    dst_zip.writestr(zi, data)


def _pick_icon_for_apk(icons_dir: Path, desired: int) -> Optional[Path]:
    available = []
    for size in ICON_SIZES:
        p = icons_dir / f'icon-{size}.png'
        if p.exists():
            available.append((abs(size - desired), size, p))
    if not available:
        return None
    return sorted(available, key=lambda item: (item[0], -item[1]))[0][2]


def repack_template_apk(template_apk: Path, out_apk: Path, prepared_www: Path, params: dict, replace_icon: bool, log_fn) -> Tuple[bool, str]:
    app_id = _sanitize_android_package(params.get('app_id') or 'com.example.myapp')
    app_name = (params.get('app_name') or 'MyApp').strip() or 'MyApp'
    version = (params.get('app_version') or APK_VERSION_PLACEHOLDER).strip() or APK_VERSION_PLACEHOLDER
    replacements = {
        APK_PACKAGE_PLACEHOLDER: app_id,
        APK_NAME_PLACEHOLDER: app_name,
        APK_VERSION_PLACEHOLDER: version,
    }
    added = 0
    try:
        with zipfile.ZipFile(template_apk, 'r') as zin, zipfile.ZipFile(out_apk, 'w') as zout:
            skipped_assets = {'assets/www/删掉我.txt'}
            for info in zin.infolist():
                name = info.filename
                if name.startswith(APK_SIGNATURE_PREFIXES):
                    continue
                if name in skipped_assets:
                    continue
                if name.startswith('assets/www/'):
                    continue
                data = zin.read(info)
                if name == 'AndroidManifest.xml':
                    data = patch_axml_strings(data, replacements)
                elif replace_icon and name in APK_ICON_TARGETS:
                    src_icon = _pick_icon_for_apk(prepared_www / 'icons', APK_ICON_TARGETS[name])
                    if src_icon:
                        data = src_icon.read_bytes()
                _copy_zip_entry(zin, zout, info, data)
            for f in prepared_www.rglob('*'):
                if not f.is_file():
                    continue
                arc = 'assets/www/' + f.relative_to(prepared_www).as_posix()
                zout.write(f, arc, compress_type=zipfile.ZIP_DEFLATED)
                added += 1
        return True, f"APK 模板重打包完成: assets/www 写入 {added} 个文件，包名={app_id}, versionName={version}"
    except Exception as e:
        return False, f"APK 模板重打包失败: {e}"


def _find_tool(names: List[str]) -> Optional[str]:
    for name in names:
        p = shutil.which(name)
        if p:
            return p
    common_roots = [Path(os.environ.get('JAVA_HOME', '')) / 'bin', Path(r'C:\Program Files\Java')]
    for root in common_roots:
        if not root.exists():
            continue
        for name in names:
            hits = list(root.rglob(name)) if root.is_dir() else []
            if hits:
                return str(hits[0])
    return None


def sign_apk_with_jarsigner(apk_path: Path, work_dir: Path, log_fn) -> Tuple[bool, str]:
    keytool = _find_tool(['keytool.exe', 'keytool'])
    jarsigner = _find_tool(['jarsigner.exe', 'jarsigner'])
    if not keytool or not jarsigner:
        return False, "未找到 JDK keytool/jarsigner，无法签名 APK；请安装 JDK 17+ 或配置 JAVA_HOME"
    ks_path = work_dir / 'packtool-debug.keystore'
    alias = 'packtool'
    storepass = 'packtool123'
    try:
        if not ks_path.exists():
            cmd = [keytool, '-genkeypair', '-v', '-keystore', str(ks_path), '-storepass', storepass,
                   '-keypass', storepass, '-alias', alias, '-keyalg', 'RSA', '-keysize', '2048',
                   '-validity', '10000', '-dname', 'CN=PackTool Debug,O=PackTool,C=CN']
            proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=60)
            if proc.returncode != 0:
                return False, f"生成调试 keystore 失败: {proc.stdout[-1000:]}"
        cmd = [jarsigner, '-keystore', str(ks_path), '-storepass', storepass, '-keypass', storepass,
               '-sigalg', 'SHA256withRSA', '-digestalg', 'SHA-256', str(apk_path), alias]
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=120)
        if proc.returncode != 0:
            return False, f"APK 签名失败: {proc.stdout[-1200:]}"
        return True, "APK 已使用调试 keystore 完成 jarsigner 签名"
    except Exception as e:
        return False, f"APK 签名异常: {e}"


def build_apk_from_template(work_root: Path, prepared_www: Path, params: dict, replace_icon: bool, log_fn) -> Tuple[Path, bool, str]:
    app_name = (params.get('app_name') or 'MyApp').strip()
    safe = ''.join(c if c not in r'\/:*?"<>| ' else '_' for c in app_name) or 'App'
    unsigned_apk = work_root / f"{safe}_unsigned.apk"
    final_apk = work_root.parent / f"{safe}.apk"
    ok, msg = repack_template_apk(APK_TEMPLATE, unsigned_apk, prepared_www, params, replace_icon, log_fn)
    log_fn("[APK] " + msg, 'success' if ok else 'error')
    if not ok:
        return final_apk, False, msg
    ok, msg = sign_apk_with_jarsigner(unsigned_apk, work_root, log_fn)
    log_fn("[APK] " + msg, 'success' if ok else 'error')
    if not ok:
        return final_apk, False, msg
    try:
        if final_apk.exists():
            final_apk.unlink()
        shutil.move(str(unsigned_apk), str(final_apk))
        size_mb = final_apk.stat().st_size / (1024 * 1024)
        return final_apk, True, f"APK 导出完成: {final_apk.name} ({size_mb:.2f} MB)"
    except Exception as e:
        return final_apk, False, f"移动签名 APK 到输出目录失败: {e}"

# =========================================================
# 各平台「工程包」生成 (EXE外的平台，目前输出 Cordova/.app/AppDir 结构占位 7z)
#   真实后端接入点:
#     APK:      build_apk_cordova_project    → 接入 cordova build android / gradlew assembleRelease
#     macOS:    build_macapp_project         → 接入 electron-osx-sign / pkgbuild / productbuild
#     AppImage: build_appimage_appdir        → 接入 appimagetool (linuxdeploy + AppImageKit)
# =========================================================
def _write_readme(path: Path, body: str):
    try:
        path.write_text(body, encoding='utf-8')
    except Exception:
        pass


def build_apk_cordova_project(work_root: Path, prepared_www: Path, params: dict, log_fn) -> Tuple[Path, bool, str]:
    """
    生成 Apache Cordova 风格的 Android 工程包占位。
    结构: <work_root>/<AppName>_apk/
        config.xml
        package.json (cordova 工程)
        www/  (已包含处理后的 Scratch补丁 + 图标)
        platforms/android/CordovaLib/ 占位
        hooks/ 占位
        plugins/ 占位
        README_ANDROID_BUILD.txt (说明接入 gradlew / cordova build android)
        keystore/ (用户 keystore 如果提供则复制)
    返回 (最终7z压缩路径, success, message)
    """
    app_name = (params.get('app_name') or 'MyApp').strip()
    app_id = (params.get('app_id') or 'com.example.myapp').strip()
    version = (params.get('app_version') or '1.0.0.0').strip()
    safe = ''.join(c if c not in r'\/:*?"<>| ' else '_' for c in app_name) or 'App'
    project = work_root / f"{safe}_apk_project"
    if project.exists():
        shutil.rmtree(project, ignore_errors=True)
    (project / 'www').mkdir(parents=True)
    (project / 'platforms' / 'android' / 'CordovaLib' / 'src').mkdir(parents=True, exist_ok=True)
    (project / 'platforms' / 'android' / 'app' / 'src' / 'main' / 'res' / 'mipmap-anydpi-v26').mkdir(parents=True, exist_ok=True)
    (project / 'hooks').mkdir(exist_ok=True)
    (project / 'plugins').mkdir(exist_ok=True)
    (project / 'keystore').mkdir(exist_ok=True)

    # 复制准备好的 www 资源 (已含 Scratch补丁 + 图标)
    for item in prepared_www.iterdir():
        dst = project / 'www' / item.name
        if item.is_dir():
            shutil.copytree(item, dst)
        else:
            shutil.copy2(item, dst)

    # 图标也同步拷贝一份到 android res 目录 (占位: 取 48/72/96/144/192 对应 mdpi~xxxhdpi)
    size_map = {
        'mipmap-mdpi': 48, 'mipmap-hdpi': 72, 'mipmap-xhdpi': 96,
        'mipmap-xxhdpi': 144, 'mipmap-xxxhdpi': 192
    }
    icon_srcs = {s: (prepared_www / 'icons' / f'icon-{s}.png') for s in (32, 64, 128, 256, 512)}
    def _pick_closest(size: int) -> Path:
        # 选比 size 大的最小PNG，没有则选最大
        cands = sorted(icon_srcs.values())
        for s in (512, 256, 128, 64, 32):
            p = icon_srcs[s]
            if p.exists() and s >= size:
                return p
        return icon_srcs[512]
    for folder, size in size_map.items():
        out_dir = project / 'platforms' / 'android' / 'app' / 'src' / 'main' / 'res' / folder
        out_dir.mkdir(parents=True, exist_ok=True)
        src = _pick_closest(size)
        if src.exists():
            shutil.copy2(src, out_dir / 'ic_launcher.png')

    # config.xml
    cfg_xml = f"""<?xml version='1.0' encoding='utf-8'?>
<widget id="{app_id}" version="{version}" xmlns="http://www.w3.org/ns/widgets" xmlns:cdv="http://cordova.apache.org/ns/1.0">
  <name>{app_name}</name>
  <description>{params.get('app_comment', 'Web App packaged by pack_tool_gui.py')}</description>
  <author email="dev@example.com" href="https://example.com/">Developer</author>
  <content src="index.html" />
  <preference name="WebViewEngine" value="system" />
  <preference name="AndroidInsecureFileModeEnabled" value="true" />
  <preference name="AndroidLaunchMode" value="singleTask" />
  <preference name="Orientation" value="default" />
  <preference name="Fullscreen" value="false" />
  <preference name="android-minSdkVersion" value="{params.get('android_min_sdk', 23)}" />
  <preference name="android-targetSdkVersion" value="{params.get('android_target_sdk', 34)}" />
  <preference name="android-architectures" value="{params.get('android_arch', 'arm64-v8a,armeabi-v7a')}" />
  <preference name="SplashScreen" value="screen" />
  <preference name="SplashScreenDelay" value="0" />
  <preference name="ShowTitle" value="false" />
  <access origin="*" />
  <allow-navigation href="*" />
  <allow-intent href="http://*/*" />
  <allow-intent href="https://*/*" />
  <platform name="android">
    <allow-intent href="market:*" />
    <preference name="AndroidPersistentFileLocation" value="Compatibility" />
  </platform>
  <engine name="android" spec="12.0.1" />
</widget>
"""
    (project / 'config.xml').write_text(cfg_xml, encoding='utf-8')

    # 工程 package.json
    cordova_pkg = {
        "name": safe.lower(),
        "displayName": app_name,
        "version": version,
        "description": params.get('app_comment', 'Cordova 工程包占位，由 pack_tool_gui.py 生成'),
        "main": "index.js",
        "scripts": {
            "build": "cordova build android --release",
            "debug": "cordova build android",
            "run": "cordova run android"
        },
        "keywords": ["cordova", "android", "webview", safe.lower()],
        "author": "Developer",
        "license": "MIT",
        "dependencies": {},
        "cordova": {
            "platforms": ["android"],
            "plugins": {}
        }
    }
    save_json(project / 'package.json', cordova_pkg)

    # AndroidManifest.xml 占位 (gradle 构建时会由 Cordova 合并生成；这里仅放一份可读性强的占位)
    manifest = f"""<?xml version="1.0" encoding="utf-8"?>
<!-- 【占位说明】本 AndroidManifest.xml 仅用于预览，真实构建时由 Cordova/gradle 合并生成。 -->
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="{app_id}"
    android:versionCode="1"
    android:versionName="{version}">
    <uses-sdk android:minSdkVersion="{params.get('android_min_sdk',23)}" android:targetSdkVersion="{params.get('android_target_sdk',34)}" />
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <application
        android:label="{app_name}"
        android:icon="@mipmap/ic_launcher"
        android:usesCleartextTraffic="true"
        android:hardwareAccelerated="true">
        <activity android:name=".MainActivity"
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale"
            android:launchMode="singleTask"
            android:theme="@android:style/Theme.DeviceDefault.NoActionBar">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
"""
    (project / 'platforms' / 'android' / 'AndroidManifest.preview.xml').write_text(manifest, encoding='utf-8')

    # 拷贝用户 keystore
    ks = params.get('keystore_path')
    if ks and Path(ks).exists():
        try:
            shutil.copy2(Path(ks), project / 'keystore' / Path(ks).name)
            # build.json for cordova
            alias = params.get('keystore_alias') or 'androiddebugkey'
            build_json = {
                "android": {
                    "release": {
                        "keystore": f"keystore/{Path(ks).name}",
                        "alias": alias,
                        "storePassword": params.get('keystore_pass', ''),
                        "password": params.get('keystore_alias_pass', ''),
                        "keystoreType": ""
                    }
                }
            }
            save_json(project / 'build.json', build_json)
            log_fn(f"已写入 build.json 与 keystore: {Path(ks).name}", 'info')
        except Exception as e:
            log_fn(f"复制 keystore 失败(不阻塞工程包输出): {e}", 'warning')

    # README
    readme = f"""# 🤖 {app_name} APK 工程包 (Cordova 结构占位)

【状态】本目录是 **可直接接入 Cordova 构建** 的工程目录结构占位，
      Web 资源({len(list(prepared_www.rglob('*')))} 个文件) 已完整复制到 `www/`，
      并已套用 Scratch 补丁 (若命中)、图标已放入 `platforms/android/app/src/main/res/mipmap-*/`。

## 使用方法 (二选一)

### 方案 A: Cordova CLI 构建 (需要 Node.js + JDK 11+ + Android SDK + Gradle)
```bash
cd {project.name}
# 1) 安装 Cordova
npm install -g cordova
# 2) 安装依赖 (首次)
npm install
# 3) 调试 APK
cordova build android
# 4) 正式签名版 APK (需提前准备 build.json 与 keystore，本工程已写入)
cordova build android --release --buildConfig=build.json
```

### 方案 B: Android Studio 构建 (需要 Android Studio)
把目录 `platforms/android/` 导入 Android Studio，直接执行 Build → Generate Signed Bundle/APK。

## 本工程已内置
- ✅ config.xml (包名={app_id}, version={version})
- ✅ package.json 依赖与脚本
- ✅ www/ 目录 (含 index.html + assets + icons + Scratch补丁)
- ✅ mipmap-*hdpi 启动图标
- ✅ build.json (签名配置，仅当你指定了 keystore 时生成)
- ✅ AndroidManifest.preview.xml (仅预览)
- ✅ keystore/ 目录
"""
    _write_readme(project / 'README_ANDROID_BUILD.txt', readme)

    # 压缩为 7z
    archive_out = work_root.parent / f"{safe}_APK工程包.7z"
    ok, msg = make_7z(project, archive_out, log_fn)
    return archive_out, ok, msg


# =========================================================
# 核心打包流水线 (在 QThread 中执行)
# =========================================================
class PackWorker(QThread):
    progress = pyqtSignal(int, str)
    log = pyqtSignal(str, str)
    finished_ok = pyqtSignal(bool, str, dict)

    def __init__(self, params: dict, parent=None):
        super().__init__(parent)
        self.params = params
        self._stop = False

    def stop(self):
        self._stop = True

    def _log(self, msg, level='info'):
        self.log.emit(msg, level)

    def _set_progress(self, pct, text):
        self.progress.emit(max(0, min(100, int(pct))), text)

    def run(self):
        params = self.params
        try:
            if not PACKAGER_TEMPLATE.exists():
                self.finished_ok.emit(False, f"找不到打包器模板目录: {PACKAGER_TEMPLATE}", {})
                return
            formats_list = params.get('formats') or ['exe']
            self._log(f"本次构建目标格式: {formats_list}", 'info')
            if not formats_list:
                self.finished_ok.emit(False, "未选择任何输出格式", {})
                return

            self._set_progress(2, "正在创建输出目录与工作副本...")
            app_name = (params.get('app_name') or 'MyApp').strip()
            safe_name = ''.join(c if c not in r'\/:*?"<>| ' else '_' for c in app_name) or 'App'
            output_dir = Path(params.get('output_dir') or Path.home())
            output_dir.mkdir(parents=True, exist_ok=True)

            # 目录结构:
            #   <output_dir>/<app_name>_build/
            #       _prepared/    公共准备目录 (已含: 模板/资源复制/www/Scratch补丁/图标处理)
            #       <AppName>/    EXE 的最终目录
            #       <AppName>_apk_project/  APK Cordova工程目录
            work_root = output_dir / f"{safe_name}_build"
            if work_root.exists():
                shutil.rmtree(work_root, ignore_errors=True)
            work_root.mkdir(parents=True, exist_ok=True)

            # ==========================================================
            # 【公共准备阶段】生成 _prepared/www + 图标
            #   后续所有格式共享这一份"已准备好的www资源"
            # ==========================================================
            prepared_root = work_root / '_prepared'
            prepared_root.mkdir(parents=True, exist_ok=True)
            # 先复制模板 (含 game.exe, package.json, 默认 icons/ 等)
            shutil.copytree(PACKAGER_TEMPLATE, prepared_root / 'template')
            prepared_www = prepared_root / 'www'
            prepared_www.mkdir(parents=True, exist_ok=True)
            # 模板自带的 www/* (比如 controls.js) 先保留
            tmpl_www = prepared_root / 'template' / 'www'
            if tmpl_www.exists():
                for it in tmpl_www.iterdir():
                    if it.is_dir():
                        dst = prepared_www / it.name
                        if dst.exists():
                            shutil.rmtree(dst)
                        shutil.copytree(it, dst)
                    else:
                        shutil.copy2(it, prepared_www / it.name)
            if self._stop: return self._abort()

            # ---- 1) 把用户资源拷贝/解压到 prepared_www ----
            self._set_progress(10, "[公共准备] 正在复制 Web 资源到 www/ ...")
            source_path = Path(params.get('source_path') or '')
            if not source_path.exists():
                self.finished_ok.emit(False, f"资源路径不存在: {source_path}", {})
                return
            tmp_extract = None
            if source_path.is_file():
                if source_path.suffix.lower() in ('.html', '.htm'):
                    shutil.copy2(source_path, prepared_www / 'index.html')
                    self._log("已将单HTML作为入口复制为 www/index.html", 'info')
                else:
                    tmp_extract = Path(tempfile.mkdtemp(prefix='res_'))
                    self._log(f"检测为压缩包，正在解压到 {tmp_extract} ...", 'info')
                    ok, msg = extract_archive(source_path, tmp_extract)
                    self._log(msg, 'success' if ok else 'error')
                    if not ok:
                        self.finished_ok.emit(False, msg, {})
                        return
                    source_path = tmp_extract
            if source_path.is_dir():
                cur = source_path
                for _ in range(3):
                    subs = [x for x in cur.iterdir() if x.is_dir() and not x.name.startswith('__') and x.name != 'www']
                    htmls_here = [x for x in cur.glob('*.html') if x.is_file()]
                    if subs and not htmls_here and len(subs) == 1:
                        cur = subs[0]
                    else:
                        break
                self._log(f"Web 资源根目录定位: {cur}", 'debug')
                for item in cur.iterdir():
                    dest = prepared_www / item.name
                    if dest.exists():
                        if dest.is_dir(): shutil.rmtree(dest, ignore_errors=True)
                        else: dest.unlink(missing_ok=True)
                    if item.is_dir():
                        shutil.copytree(item, dest)
                    else:
                        shutil.copy2(item, dest)
                if tmp_extract:
                    shutil.rmtree(tmp_extract, ignore_errors=True)
            if self._stop: return self._abort()

            # ---- 2) 确保 index.html ----
            self._set_progress(22, "[公共准备] 检测/补全入口 index.html ...")
            ok, msg = ensure_index_html(prepared_www, self._log)
            self._log(msg, 'success' if ok else 'error')
            if not ok:
                self.finished_ok.emit(False, msg, {})
                return
            if self._stop: return self._abort()

            # ---- 3) Scratch 自动补丁 ----
            self._set_progress(26, "[公共准备] 注入 controls.js 控制脚本 ...")
            ok, msg = patch_controls_script(prepared_www, self._log)
            self._log(msg, 'success' if ok else 'error')
            if not ok:
                self.finished_ok.emit(False, msg, {})
                return
            if self._stop: return self._abort()

            self._set_progress(28, "[公共准备] Scratch 检测与注入控制栏隐藏/F2/F4快捷键 ...")
            ok, msg = inject_scratch_patch_if_needed(prepared_www, self._log)
            self._log(msg, 'success' if ok else 'warning')
            if self._stop: return self._abort()

            # ---- 4) 图标处理 (默认图标/用户自定义缩放) ----
            self._set_progress(34, "[公共准备] 正在处理图标 (默认图标 / 用户自定义缩放) ...")
            icons_dir = prepared_www / 'icons'
            user_icon = None
            has_custom_icon = False
            if params.get('icon_path'):
                user_icon = Path(params['icon_path'])
                if not user_icon.exists():
                    self._log(f"用户图标不存在，将使用模板默认图标: {user_icon}", 'warning')
                    user_icon = None
                else:
                    has_custom_icon = True
            ok, msg, _png_512 = generate_icons(icons_dir, user_icon, app_name, self._log)
            self._log(msg, 'success' if ok else 'error')
            if not ok:
                self.finished_ok.emit(False, msg, {})
                return
            if self._stop: return self._abort()

            self._set_progress(40, "[公共准备] 已完成资源准备；接下来按所选格式分别构建 ...")
            self._log("公共资源准备完成 ✅，开始进入各平台构建环节", 'success')

            results = {}
            overall_ok = True

            # ==========================================================
            # EXE 格式（真实后端: package.json → 改exe图标 → 重命名 → 7z）
            # ==========================================================
            if 'exe' in formats_list:
                self._set_progress(45, "[1/2 EXE] 拷贝准备好的资源到 EXE 工作目录 ...")
                exe_work = work_root / safe_name
                shutil.copytree(prepared_root / 'template', exe_work)
                # 覆盖 www 资源 (已准备好)
                exe_www = exe_work / 'www'
                if exe_www.exists(): shutil.rmtree(exe_www, ignore_errors=True)
                shutil.copytree(prepared_www, exe_www)
                if self._stop: return self._abort()

                self._set_progress(54, "[1/2 EXE] 正在更新 package.json ...")
                pjson_path = exe_work / 'package.json'
                if pjson_path.exists():
                    pjson = load_json(pjson_path)
                    version = (params.get('app_version') or '1.0.0.0').strip()
                    pjson['name'] = safe_name.lower() or app_name
                    pjson.setdefault('window', {})
                    pjson['window']['title'] = app_name
                    pjson['window']['icon'] = "www\\icons\\icon-512.png"
                    if 'project-details' in pjson:
                        pjson['project-details']['name'] = app_name
                        pjson['project-details']['version'] = version
                    elif 'version' in pjson:
                        pjson['version'] = version
                    save_json(pjson_path, pjson)
                    self._log(f"[EXE] package.json 已更新: displayName={app_name}, version={version}", 'success')
                else:
                    self._log("[EXE] 未找到 package.json，跳过", 'warning')
                if self._stop: return self._abort()

                self._set_progress(68, "[1/2 EXE] 正在写入 EXE 内嵌图标资源 (RT_ICON + RT_GROUP_ICON) ...")


                if self._stop: return self._abort()

                self._set_progress(86, "[1/2 EXE] 正在压缩为 EXE 工程 7z 包 ...")
                exe_archive = output_dir / f"{safe_name}_EXE.7z"
                ok, msg = make_7z(exe_work.parent if False else exe_work, exe_archive, self._log)
                self._log("[EXE] " + msg, 'success' if ok else 'error')
                if ok:
                    results['exe'] = {'archive': str(exe_archive if HAS_PY7ZR else exe_archive.with_suffix('.zip'))}
                else:
                    overall_ok = False
                    results['exe'] = {'error': msg}

            # ==========================================================
            # APK 格式 (template.APK → assets/www → manifest patch → 签名)
            # ==========================================================
            if 'apk' in formats_list:
                self._set_progress(50 if 'exe' not in formats_list else 70,
                                   f"[{2 if 'exe' in formats_list else 1}/2 APK] 正在写入 template.APK 并签名 ...")
                apk_params = {
                    'app_name': app_name,
                    'app_id': (params.get('app_id') or 'com.example.myapp').strip(),
                    'app_version': (params.get('app_version') or '1.0.0.0').strip(),
                    'android_min_sdk': params.get('android_min_sdk', 23),
                    'android_target_sdk': params.get('android_target_sdk', 34),
                    'android_arch': params.get('android_arch', 'arm64-v8a,armeabi-v7a'),
                    'keystore_path': params.get('keystore_path', ''),
                    'keystore_alias': params.get('keystore_alias', 'androiddebugkey'),
                    'keystore_pass': params.get('keystore_pass', 'android'),
                    'keystore_alias_pass': params.get('keystore_alias_pass', 'android'),
                }
                apk_path, ok, msg = build_apk_from_template(work_root, prepared_www, apk_params, has_custom_icon, self._log)
                self._log("[APK] " + msg, 'success' if ok else 'error')
                if self._stop: return self._abort()
                if ok:
                    self._set_progress(92, f"[{2 if 'exe' in formats_list else 1}/2 APK] APK导出完成: {apk_path.name}")
                    results['apk'] = {'archive': str(apk_path)}
                else:
                    overall_ok = False
                    results['apk'] = {'error': msg}

            # ==========================================================
            # 清理工作副本 (用户勾选『保留』时保留)
            # ==========================================================
            keep = bool(params.get('keep_workdir'))
            self._set_progress(97, f"清理工作副本 (保留={keep}) ...")
            if not keep:
                try:
                    shutil.rmtree(work_root, ignore_errors=True)
                    self._log("已清理工作副本", 'debug')
                except Exception as e:
                    self._log(f"清理失败(不影响产物): {e}", 'debug')
            else:
                self._log(f"按用户要求保留工作副本目录: {work_root}", 'info')

            # ---- 完成 ----
            self._set_progress(100, "✅ 打包任务结束")
            summary_parts = []
            for k, v in results.items():
                if v.get('archive'):
                    summary_parts.append(f"{k.upper()} → {v['archive']}")
                elif v.get('error'):
                    summary_parts.append(f"{k.upper()} 失败: {v['error']}")
            final_msg = "全部成功:\n" + ("\n".join(summary_parts) if summary_parts else "无输出") if overall_ok else \
                ("部分失败或有警告:\n" + "\n".join(summary_parts))
            self.finished_ok.emit(overall_ok, final_msg, {
                'results': results,
                'app_name': app_name,
            })
        except Exception as e:
            import traceback
            tb = traceback.format_exc()
            self._log(f"[未捕获异常] {e}\n{tb}", 'error')
            self.finished_ok.emit(False, f"未预期错误: {e}", {})

    def _abort(self):
        self.finished_ok.emit(False, "用户已取消任务", {})


# =========================================================
# GUI 组件
# =========================================================
class LogPanel(QTextEdit):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setReadOnly(True)
        self.setFont(QFont('Consolas', 9))
        self.setStyleSheet("""
            QTextEdit {
                background-color: #1e1e1e; color: #d4d4d4;
                border: 1px solid #3c3c3c; border-radius: 4px; padding: 6px;
            }
        """)

    def append_log(self, message, level='info'):
        ts = datetime.now().strftime('%H:%M:%S')
        colors = {
            'info': '#d4d4d4', 'success': '#4ec9b0',
            'warning': '#dcdcaa', 'error': '#f44747', 'debug': '#808080'
        }
        tags = {'info': 'INFO', 'success': 'OK  ', 'warning': 'WARN',
                'error': 'ERR ', 'debug': 'DBG '}
        color = colors.get(level, '#d4d4d4')
        tag = tags.get(level, 'INFO')
        html = (f'<span style="color:#808080">[{ts}]</span> '
                f'<span style="color:{color};font-weight:bold">[{tag}]</span> '
                f'<span style="color:{color}">{message}</span>')
        self.append(html)
        self.moveCursor(QTextCursor.MoveOperation.End if USING_PYQT6 else QTextCursor.End)


class SettingsDialog(QDialog):
    def __init__(self, cfg: dict, parent=None):
        super().__init__(parent)
        self.setWindowTitle("程序设置")
        self.setMinimumWidth(440)
        self.cfg = cfg.copy()
        self._build()

    def _build(self):
        v = QVBoxLayout(self)
        f = QFormLayout()
        self.edit_out = QLineEdit(self.cfg.get('output_dir', str(Path.home())))
        b1 = QPushButton("浏览...")
        b1.clicked.connect(lambda: self.edit_out.setText(
            QFileDialog.getExistingDirectory(self, "选择输出目录", self.edit_out.text()) or self.edit_out.text()
        ))
        row = QHBoxLayout()
        row.addWidget(self.edit_out, 1)
        row.addWidget(b1)
        w = QWidget()
        w.setLayout(row)
        f.addRow("默认输出目录:", w)

        self.edit_name = QLineEdit(self.cfg.get('app_name', 'MyApp'))
        f.addRow("默认应用名:", self.edit_name)
        self.edit_appid_def = QLineEdit(self.cfg.get('app_id', 'com.example.myapp'))
        f.addRow("默认 AppId:", self.edit_appid_def)
        self.edit_ver = QLineEdit(self.cfg.get('app_version', '1.0.0.0'))
        f.addRow("默认版本:", self.edit_ver)
        v.addLayout(f)

        tips = QLabel(f"(当前使用 Qt 绑定: <b>{QT_VERSION_STR}</b>)\n"
                      f"{'✅ Pillow 可用 (可处理自定义图标)' if HAS_PILLOW else '⚠ Pillow 未安装 (仅能使用模板默认图标)'}\n"
                      f"{'✅ py7zr 可用 (输出 .7z)' if HAS_PY7ZR else '⚠ py7zr 未安装 (将回退为 .zip 格式)'}")
        tips.setStyleSheet("color:#57606a;padding:6px;")
        v.addWidget(tips)

        bb = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        bb.accepted.connect(self._accept)
        bb.rejected.connect(self.reject)
        v.addWidget(bb)

    def _accept(self):
        self.cfg['output_dir'] = self.edit_out.text().strip() or str(Path.home())
        self.cfg['app_name'] = self.edit_name.text().strip() or 'MyApp'
        self.cfg['app_id'] = self.edit_appid_def.text().strip() or 'com.example.myapp'
        self.cfg['app_version'] = self.edit_ver.text().strip() or '1.0.0.0'
        self.accept()

    def get_cfg(self):
        return self.cfg


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.cfg = load_gui_config()
        self.worker: Optional[PackWorker] = None
        self._build_ui()
        self._apply_window_settings()

    # ------------------------------------------------------------------ UI
    def _build_ui(self):
        self.setWindowTitle(f"📦 Web资源打包工具  (基于模板 打包器\\)")
        self.setMinimumSize(880, 640)

        root = QWidget()
        self.setCentralWidget(root)
        vl = QVBoxLayout(root)
        vl.setContentsMargins(6, 6, 6, 6)
        vl.setSpacing(6)

        # Header
        header = QFrame()
        header.setStyleSheet("""
            QFrame {
                background: qlineargradient(x1:0,y1:0,x2:1,y2:0,stop:0 #2b5876,stop:1 #4e4376);
                border-radius:6px;
            } QLabel { color:white; }
        """)
        hl = QHBoxLayout(header)
        hl.setContentsMargins(16, 12, 16, 12)
        t1 = QLabel("📦  Web资源 → EXE (7z打包)")
        t1.setFont(QFont('Microsoft YaHei', 14, QFont.Weight.Bold))
        t2 = QLabel("  复制资源 → 生成多尺寸图标 → 修改EXE图标 → 7z压缩")
        t2.setFont(QFont('Microsoft YaHei', 9))
        hl.addWidget(t1)
        hl.addWidget(t2)
        hl.addStretch(1)
        b_set = QPushButton("⚙ 设置")
        b_set.setStyleSheet("""
            QPushButton { background:rgba(255,255,255,20); color:white;
                border:1px solid rgba(255,255,255,60); border-radius:4px; padding:6px 14px; }
            QPushButton:hover { background:rgba(255,255,255,40); }
        """)
        b_set.clicked.connect(self._open_settings)
        b_about = QPushButton("ℹ 关于")
        b_about.setStyleSheet(b_set.styleSheet())
        b_about.clicked.connect(self._show_about)
        hl.addWidget(b_set)
        hl.addSpacing(6)
        hl.addWidget(b_about)
        vl.addWidget(header)

        self.tabs = QTabWidget()
        self.tabs.setStyleSheet("""
            QTabWidget::pane { border:1px solid #d0d7de; border-radius:4px; top:-1px; }
            QTabBar::tab {
                padding:8px 20px; font-size:10pt;
                border:1px solid #d0d7de; border-bottom:none;
                border-top-left-radius:6px; border-top-right-radius:6px; margin-right:2px;
            }
            QTabBar::tab:selected {
                background:white; border-bottom:2px solid #2d8cf0;
                font-weight:bold; color:#2d8cf0;
            }
            QTabBar::tab:!selected { background:#f6f8fa; color:#57606a; }
            QTabBar::tab:!selected:hover { background:#eef3f8; }
        """)
        self.tab_local = QWidget()
        self._build_local_tab(self.tab_local)
        self.tabs.addTab(self.tab_local, "💻 本地Web资源 → 多平台打包")
        vl.addWidget(self.tabs, 1)

        # Progress
        prog_row = QHBoxLayout()
        self.lbl_progress = QLabel("就绪")
        self.lbl_progress.setStyleSheet("color:#57606a; font-weight:bold;")
        self.progress = QProgressBar()
        self.progress.setRange(0, 100)
        self.progress.setValue(0)
        self.progress.setTextVisible(True)
        self.progress.setStyleSheet("""
            QProgressBar { border:1px solid #d0d7de; border-radius:4px;
                background-color:#f6f8fa; text-align:center; height:20px; }
            QProgressBar::chunk {
                background: qlineargradient(x1:0,y1:0,x2:1,y2:0,stop:0 #2d8cf0,stop:1 #57a3ff);
                border-radius:3px;
            }
        """)
        prog_row.addWidget(self.lbl_progress, 0)
        prog_row.addWidget(self.progress, 1)
        vl.addLayout(prog_row)

        ltitle = QLabel("📋 操作日志:")
        ltitle.setStyleSheet("font-weight:bold;color:#24292f;")
        vl.addWidget(ltitle)
        self.log_panel = LogPanel()
        self.log_panel.setMinimumHeight(180)
        vl.addWidget(self.log_panel, 1)

        sb = QStatusBar()
        self.setStatusBar(sb)
        self.sb = sb
        self.sb.showMessage(f"就绪 · Qt绑定: {QT_VERSION_STR}"
                            f"{' · Pillow=✅(自定义图标可用)' if HAS_PILLOW else ' · Pillow=❌(仅模板默认图标)'}"
                            f"{' · py7zr=✅' if HAS_PY7ZR else ' · py7zr=❌(回退ZIP)'}"
                            "  ·  选择资源路径后点击『开始构建』")
        if not HAS_PILLOW:
            self.sb.showMessage("ℹ 未安装 Pillow：不影响打包（直接使用模板默认图标）；需要自定义图标时请: pip install Pillow")

    def _build_local_tab(self, parent):
        v = QVBoxLayout(parent)
        v.setContentsMargins(12, 12, 12, 12)
        v.setSpacing(10)

        g1 = QGroupBox("① 选择本地 Web 资源")
        hl = QHBoxLayout(g1)
        hl.addWidget(QLabel("资源路径:"))
        self.edit_source = QLineEdit()
        self.edit_source.setPlaceholderText("选择文件夹 / 压缩包(.zip/.7z/.rar/.tar) / 单HTML文件")
        b1 = QPushButton("浏览文件夹...")
        b1.clicked.connect(self._browse_src_folder)
        b2 = QPushButton("浏览文件...")
        b2.clicked.connect(self._browse_src_file)
        hl.addWidget(self.edit_source, 1)
        hl.addWidget(b1)
        hl.addWidget(b2)
        v.addWidget(g1)

        g2 = QGroupBox("② 打包配置 · 通用")
        f = QFormLayout(g2)

        # EXE和APK通用的只剩下名称（用于决定输出的7z文件名）和图标
        self.edit_app_name = QLineEdit(self.cfg.get('app_name', 'MyApp'))
        self.edit_app_name.setMinimumWidth(260)
        self.edit_app_name.setPlaceholderText("仅用于决定输出的压缩包名称，例如: MyApp")
        f.addRow("输出压缩包名称:", self.edit_app_name)

        row_icon = QHBoxLayout()
        self.edit_icon = QLineEdit()
        self.edit_icon.setPlaceholderText("可选: .png / .jpg / .bmp / .ico (留空则使用默认图标)")
        bi = QPushButton("选择图标...")
        bi.clicked.connect(self._browse_icon)
        row_icon.addWidget(self.edit_icon, 1)
        row_icon.addWidget(bi)
        w = QWidget()
        w.setLayout(row_icon)
        f.addRow("自定义图标:", w)

        row_fmt = QHBoxLayout()
        row_fmt.addWidget(QLabel("输出格式:"))
        self.chk_exe = QCheckBox("🪟 Windows EXE (打包为 7z)")
        self.chk_exe.setChecked(True)
        self.chk_apk = QCheckBox("🤖 Android APK (直接导出签名 APK)")
        self.chk_apk.setChecked(False)
        for c in (self.chk_exe, self.chk_apk):
            c.stateChanged.connect(self._on_format_changed)
        row_fmt.addWidget(self.chk_exe)
        row_fmt.addWidget(self.chk_apk)
        row_fmt.addStretch(1)
        b_all = QPushButton("✅ 全选/反选 (2 种)")
        b_all.clicked.connect(self._toggle_all_formats)
        row_fmt.addWidget(b_all)
        f.addRow(row_fmt)
        v.addWidget(g2)

        # ----------- EXE 专属参数 -----------
        self.box_exe_cfg = QGroupBox("🪟 EXE 专属参数")
        fe = QFormLayout(self.box_exe_cfg)
        self.chk_exe_no_console = QCheckBox("无控制台窗口 (Windows GUI 子系统)")
        self.chk_exe_no_console.setChecked(True)
        fe.addRow("", self.chk_exe_no_console)
        self.chk_exe_admin = QCheckBox("请求管理员权限 (requireAdministrator)")
        fe.addRow("", self.chk_exe_admin)
        v.addWidget(self.box_exe_cfg)
        # ----------- APK 专属参数 -----------
        self.box_apk_cfg = QGroupBox("🤖 APK 专属参数")
        fa = QFormLayout(self.box_apk_cfg)
        # 将包名和版本挪到了这里，只有勾选APK时才显示
        self.edit_appid = QLineEdit(self.cfg.get('app_id', 'com.example.myapp'))
        self.edit_appid.setPlaceholderText("例如: com.example.myapp")
        fa.addRow("应用包名 (AppId):", self.edit_appid)

        self.edit_ver = QLineEdit(self.cfg.get('app_version', '1.0.0.0'))
        fa.addRow("应用版本号:", self.edit_ver)
        v.addWidget(self.box_apk_cfg)

        g3 = QGroupBox("③ 输出设置")
        f2 = QFormLayout(g3)
        row_out = QHBoxLayout()
        self.edit_outdir = QLineEdit(self.cfg.get('output_dir', str(Path.home())))
        bo = QPushButton("浏览...")
        bo.clicked.connect(lambda: self.edit_outdir.setText(
            QFileDialog.getExistingDirectory(self, "选择输出目录", self.edit_outdir.text()) or self.edit_outdir.text()
        ))
        row_out.addWidget(self.edit_outdir, 1)
        row_out.addWidget(bo)
        w2 = QWidget()
        w2.setLayout(row_out)
        f2.addRow("输出目录:", w2)
        self.chk_keep_workdir = QCheckBox("保留工作副本 (便于调试，默认自动删除)")
        f2.addRow("", self.chk_keep_workdir)
        v.addWidget(g3)

        # 按钮
        btn_row = QHBoxLayout()
        btn_row.addStretch(1)
        self.btn_start = QPushButton("🚀 开始构建: EXE")
        self.btn_start.setMinimumHeight(42)
        self.btn_start.setStyleSheet("""
            QPushButton { background:#2d8cf0; color:white; font-weight:bold;
                border:none; border-radius:6px; padding:8px 28px; font-size:10pt; }
            QPushButton:hover { background:#419ff9; }
            QPushButton:disabled { background:#8c9ab4; }
        """)
        self.btn_start.clicked.connect(self._on_start)
        self.btn_stop = QPushButton("⏹ 停止")
        self.btn_stop.setMinimumHeight(42)
        self.btn_stop.setEnabled(False)
        self.btn_stop.setStyleSheet("""
            QPushButton { background:#ed4014; color:white; font-weight:bold;
                border:none; border-radius:6px; padding:8px 20px; }
            QPushButton:hover { background:#ff5533; }
            QPushButton:disabled { background:#b8a5a0; }
        """)
        self.btn_stop.clicked.connect(self._on_stop)
        btn_row.addWidget(self.btn_start, 3)
        btn_row.addSpacing(12)
        btn_row.addWidget(self.btn_stop, 2)
        btn_row.addStretch(1)
        v.addLayout(btn_row)
        v.addStretch(1)

        # 初始化显隐
        self._on_format_changed()

    def _toggle_all_formats(self):
        any_unchecked = any(not c.isChecked() for c in (self.chk_exe, self.chk_apk))
        for c in (self.chk_exe, self.chk_apk):
            c.setChecked(any_unchecked)

    def _on_format_changed(self):
        # 只要选中了 EXE，就显示 EXE 专属参数
        self.box_exe_cfg.setVisible(self.chk_exe.isChecked())

        # 只要选中了 APK，就显示 APK 专属参数（包名、版本）
        self.box_apk_cfg.setVisible(self.chk_apk.isChecked())

        # 动态更新按钮文字
        if self.chk_exe.isChecked() and self.chk_apk.isChecked():
            self.btn_start.setText("🚀 开始构建: EXE + APK")
        elif self.chk_apk.isChecked():
            self.btn_start.setText("🚀 开始构建: APK")
        else:
            self.btn_start.setText("🚀 开始构建: EXE")

    # ---------------------------------------------------------- window
    def _apply_window_settings(self):
        sz = self.cfg.get('window_size', [900, 720])
        if isinstance(sz, list) and len(sz) == 2:
            self.resize(sz[0], sz[1])

    def closeEvent(self, event):
        try:
            self.cfg['window_size'] = [self.width(), self.height()]
            self.cfg['app_name'] = self.edit_app_name.text().strip() or self.cfg.get('app_name', 'MyApp')
            self.cfg['app_id'] = self.edit_appid.text().strip() or self.cfg.get('app_id', 'com.example.myapp')
            self.cfg['app_version'] = self.edit_ver.text().strip() or self.cfg.get('app_version', '1.0.0.0')
            self.cfg['output_dir'] = self.edit_outdir.text().strip() or self.cfg.get('output_dir', str(Path.home()))
            save_gui_config(self.cfg)
        except Exception:
            pass
        if self.worker and self.worker.isRunning():
            ret = QMessageBox.question(
                self, "确认退出", "当前有打包任务正在执行，退出将强制终止，确定吗？",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                QMessageBox.StandardButton.No
            )
            if ret != QMessageBox.StandardButton.Yes:
                event.ignore()
                return
            self.worker.stop()
            self.worker.wait(2000)
        event.accept()

    # --------------------------------------------------------- actions
    def _browse_src_folder(self):
        d = QFileDialog.getExistingDirectory(self, "选择包含 index.html 的 Web 资源目录")
        if d:
            self.edit_source.setText(d)

    def _browse_src_file(self):
        f, _ = QFileDialog.getOpenFileName(
            self, "选择 Web 资源 (压缩包或单HTML)", "",
            "所有支持的文件 (*.html *.htm *.zip *.7z *.rar *.tar *.gz *.bz2 *.xz *.tgz);;所有文件 (*.*)"
        )
        if f:
            self.edit_source.setText(f)

    def _browse_icon(self):
        f, _ = QFileDialog.getOpenFileName(
            self, "选择图标文件", "",
            "图片 / 图标 (*.png *.jpg *.jpeg *.bmp *.ico);;所有文件 (*.*)"
        )
        if f:
            self.edit_icon.setText(f)

    def _open_settings(self):
        dlg = SettingsDialog(self.cfg, self)
        if dlg.exec() == (QDialog.DialogCode.Accepted if USING_PYQT6 else QDialog.Accepted):
            self.cfg = dlg.get_cfg()
            save_gui_config(self.cfg)
            self.edit_app_name.setText(self.cfg.get('app_name', 'MyApp'))
            self.edit_appid.setText(self.cfg.get('app_id', 'com.example.myapp'))
            self.edit_ver.setText(self.cfg.get('app_version', '1.0.0.0'))
            self.edit_outdir.setText(self.cfg.get('output_dir', str(Path.home())))
            self._on_format_changed()
            self.log_panel.append_log("设置已保存", "success")



    def _show_about(self):
        QMessageBox.about(
            self, "关于",
            f"<h3>📦 Web资源 → EXE(7z) + APK 双平台打包工具</h3>"
            f"<p>基于 打包器\\ 模板目录进行加工，支持两种目标产物:</p>"
            f"<ul>"
            f"<li>🪟 <b>Windows EXE</b>: 真实后端实现 (模板拷贝→资源→Scratch补丁→图标→改exe资源→重命名→7z)</li>"
            f"<li>🤖 <b>Android APK</b>: 基于 template.APK 直接写入 assets/www，patch manifest 包名/版本/名称，并使用 JDK 调试证书签名输出 .apk</li>"
            f"</ul>"
            f"<hr/>"
            f"<b>打包流水线 (两种格式共享 ①~④ 公共准备阶段):</b>"
            f"<ol>"
            f"<li>创建 输出目录/AppName_build/ 工作区</li>"
            f"<li>【公共准备】①拷贝模板+资源 到 www/ ②确保 index.html ③注入 controls.js ④<b>Scratch 自动补丁</b> (隐藏控制栏 + F4全屏切换 + F2绿旗) ⑤图标 (模板默认 / 用户自定义缩放)</li>"
            f"<li>【EXE 分支】拷贝 prepared 模板 → 更新 package.json → Win32 API 注入图标到 exe → 重命名 <AppName>.exe → 7z 压缩输出 <b>AppName_EXE.7z</b></li>"
            f"<li>【APK 分支】复制 template.APK → 清旧签名 → 写入 assets/www → patch manifest → 按需替换图标 → jarsigner 签名 → 输出 <b>AppName.apk</b></li>"
            f"</ol>"
            f"<p><i>Qt绑定: {QT_VERSION_STR}  ·  Pillow(自定义图标缩放): {'✅' if HAS_PILLOW else '❌(仅模板默认图标可用)'}  ·  py7zr(压缩): {'✅.7z' if HAS_PY7ZR else '❌回退.zip'}</i></p>"
        )

    def _on_stop(self):
        if self.worker and self.worker.isRunning():
            self.worker.stop()
            self.log_panel.append_log("用户已请求停止任务...", "warning")

    def _on_start(self):
        if self.worker and self.worker.isRunning():
            QMessageBox.information(self, "任务中", "已有任务在运行，请等待完成或先停止")
            return
        src = self.edit_source.text().strip()
        if not src:
            QMessageBox.warning(self, "缺少资源路径", "请选择 Web 资源路径 (文件夹/压缩包/单HTML)")
            return
        src_path = Path(src)
        if not src_path.exists():
            QMessageBox.warning(self, "路径不存在", f"路径不存在:\n{src}")
            return
        app_name = self.edit_app_name.text().strip()
        if not app_name:
            QMessageBox.warning(self, "缺少应用名", "请输入应用名称")
            return

        # ---- 输出格式校验 ----
        formats_list = []
        if self.chk_exe.isChecked(): formats_list.append('exe')
        if self.chk_apk.isChecked(): formats_list.append('apk')
        if not formats_list:
            QMessageBox.warning(self, "未选格式", "请至少选择一种输出格式 (EXE / APK)")
            return

        params = {
            'source_path': str(src_path),
            'app_name': self.edit_app_name.text().strip(),
            'formats': formats_list,
            # 仅在勾选时才传入对应的值，否则传默认值或空
            'app_id': self.edit_appid.text().strip() if self.chk_apk.isChecked() else 'com.default.app',
            'app_version': self.edit_ver.text().strip() if self.chk_apk.isChecked() else '1.0.0',
            'icon_path': self.edit_icon.text().strip() or None,
            'output_dir': self.edit_outdir.text().strip() or str(Path.home()),
            'keep_workdir': self.chk_keep_workdir.isChecked(),
            'formats': formats_list,
            # EXE 参数
            'exe_no_console': self.chk_exe_no_console.isChecked(),
            'exe_admin': self.chk_exe_admin.isChecked(),
            # APK 参数 (采用最稳妥的默认值，不再通过界面读取)
            'android_min_sdk': 23,
            'android_target_sdk': 34,
            'android_arch': 'arm64-v8a,armeabi-v7a',
            'keystore_path': '',
            'keystore_alias': 'androiddebugkey',
            'keystore_pass': 'android',
            'keystore_alias_pass': 'android',
        }
        self.btn_start.setEnabled(False)
        self.btn_stop.setEnabled(True)
        self.progress.setValue(0)
        self.lbl_progress.setText("启动打包任务...")
        self.log_panel.append_log(f"{'=' * 50}", 'debug')
        self.log_panel.append_log(
            f"开始打包: app={params['app_name']} id={params['app_id']} ver={params['app_version']} formats={formats_list}",
            'info')
        self.log_panel.append_log(f"资源: {src}  → 输出目录: {params['output_dir']}", 'debug')

        self.worker = PackWorker(params)
        self.worker.progress.connect(self._on_progress)
        self.worker.log.connect(self.log_panel.append_log)
        self.worker.finished_ok.connect(self._on_finished)
        self.worker.start()

    def _on_progress(self, pct, text):
        self.progress.setValue(pct)
        self.lbl_progress.setText(f"{text} ({pct}%)")

    def _on_finished(self, ok, msg, extra):
        self.btn_start.setEnabled(True)
        self.btn_stop.setEnabled(False)
        results = extra.get('results') or {}
        # 汇总所有产物路径
        archives = []
        for plat in ('exe', 'apk'):
            r = results.get(plat) or {}
            if r.get('archive'):
                archives.append((plat, r['archive']))
        if ok:
            self.log_panel.append_log(f"🎉 任务结束，成功产物 {len(archives)} 个", 'success')
            for plat, a in archives:
                self.log_panel.append_log(f"  → {plat.upper()}: {a}", 'success')
            head = "✅ 打包成功!\n" if not any('error' in (results.get(p) or {}) for p in results) else "✅ 打包完成 (部分格式有警告)\n"
            info = f"{head}\n{msg}"
            if archives:
                info += "\n\n产物列表:"
                for plat, a in archives:
                    # 显示绝对路径，文件大小
                    try:
                        sz = Path(a).stat().st_size / (1024 * 1024)
                        info += f"\n  [{plat.upper()}] {a}   ({sz:.2f} MB)"
                    except Exception:
                        info += f"\n  [{plat.upper()}] {a}"
            if archives:
                latest = Path(archives[-1][1]).parent
                if latest.exists():
                    self.sb.showMessage(f"完成: {len(archives)} 个产物 → {latest}")
                    try:
                        # Windows 打开输出文件夹
                        if sys.platform.startswith('win'):
                            os.startfile(str(latest))  # noqa: E301
                    except Exception:
                        pass
            QMessageBox.information(self, "打包完成", info)
        else:
            self.log_panel.append_log(f"❌ 失败或取消: {msg}", 'error')
            self.sb.showMessage("任务失败 / 已取消")
            if "取消" not in msg:
                QMessageBox.critical(self, "打包失败", f"❌ 打包失败:\n\n{msg}")


def main():
    app = QApplication(sys.argv)
    app.setStyle("Fusion")
    app.setStyleSheet("""
        QWidget { font-family:'Microsoft YaHei','Segoe UI',sans-serif; font-size:9pt; }
        QGroupBox {
            font-weight:bold; border:1px solid #d0d7de;
            border-radius:6px; margin-top:10px; padding-top:12px;
        }
        QGroupBox::title {
            subcontrol-origin:margin; left:12px; padding:0 6px; color:#2d8cf0;
        }
        QLineEdit, QComboBox, QSpinBox {
            padding:5px 8px; border:1px solid #d0d7de;
            border-radius:4px; background:white; selection-background-color:#2d8cf0;
        }
        QLineEdit:focus, QComboBox:focus, QSpinBox:focus { border:1px solid #2d8cf0; }
        QPushButton {
            padding:5px 14px; border:1px solid #d0d7de;
            border-radius:4px; background:#f6f8fa;
        }
        QPushButton:hover { background:#eef3f8; border-color:#2d8cf0; }
        QPushButton:pressed { background:#e1e8ef; }
        QCheckBox { spacing:6px; }
        QStatusBar { background:#f6f8fa; border-top:1px solid #d0d7de; }
    """)
    if USING_PYQT6:
        app.setAttribute(Qt.ApplicationAttribute.AA_EnableHighDpiScaling, True)
        app.setAttribute(Qt.ApplicationAttribute.AA_UseHighDpiPixmaps, True)
    else:
        app.setAttribute(Qt.AA_EnableHighDpiScaling, True)
        app.setAttribute(Qt.AA_UseHighDpiPixmaps, True)

    win = MainWindow()
    win.show()
    sys.exit(app.exec())


if __name__ == '__main__':
    main()
