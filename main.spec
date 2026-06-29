# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller 打包配置 —— pack_tool_gui.py (Web资源打包工具)
构建命令:
    pip install pyinstaller pillow py7zr pyqt5
    pyinstaller main.spec --clean
产物:
    dist/Web资源打包工具/Web资源打包工具.exe  (onedir 模式)
    onedir 根下并列: 打包器/  template.APK  controls.js  tools/
"""

import os
from pathlib import Path

block_cipher = None

PROJECT_ROOT = Path(SPECPATH).resolve()


def collect_dir(src_dir: Path, dest_rel: str) -> list:
    """递归收集目录下所有文件，返回 [(src_abs, dest_rel_dir), ...] 列表。"""
    items = []
    if not src_dir.exists() or not src_dir.is_dir():
        return items
    for root, _dirs, files in os.walk(src_dir):
        for f in files:
            src_file = Path(root) / f
            rel = src_file.relative_to(src_dir)
            dest_sub = os.path.join(dest_rel, str(rel.parent)) if str(rel.parent) != '.' else dest_rel
            items.append((str(src_file), dest_sub))
    return items


datas = []

datas += collect_dir(PROJECT_ROOT / '打包器', '打包器')
datas += collect_dir(PROJECT_ROOT / 'tools', 'tools')

for single_file in ('template.APK', 'controls.js'):
    p = PROJECT_ROOT / single_file
    if p.exists():
        datas.append((str(p), '.'))

hiddenimports = [
    'PyQt5.QtCore',
    'PyQt5.QtGui',
    'PyQt5.QtWidgets',
    'PIL.Image',
    'PIL.ImageDraw',
    'PIL.ImageFont',
    'py7zr',
]

a = Analysis(
    ['pack_tool_gui.py'],
    pathex=[str(PROJECT_ROOT)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='Web资源打包工具',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='icon.ico',
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='Web资源打包工具',
)
