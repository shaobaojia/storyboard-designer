#!/usr/bin/env python3
"""制作 PyWebView runtime 容器 —— 一键，免安装、不污染系统环境。

产物结构（放在 <dest>/_runtime/）：
    python/         Python 3.11 embeddable + pip + pywebview（自包含）
    launcher.py     窗口启动器（本脚本同目录的 pywebview_launcher.py 拷贝）

用法（Windows 任意 Python 3.8+）：
    python make_runtime.py --dest <目标目录>
    # 目标目录通常是插件部署目录：
    #   %APPDATA%/Blender Foundation/Blender/4.5/scripts/addons/storyboard_designer

重做：删除 <dest>/_runtime 后重跑即可（脚本幂等：已存在则跳过下载/安装）。
"""
import argparse
import os
import shutil
import subprocess
import sys
import urllib.request
import zipfile

PY_VERSION = '3.11.9'
PY_URL = ('https://www.python.org/ftp/python/{v}/python-{v}-embed-amd64.zip'
          .format(v=PY_VERSION))
GET_PIP_URL = 'https://bootstrap.pypa.io/get-pip.py'


def fetch(url, dest):
    print(f'[download] {url}')
    with urllib.request.urlopen(url, timeout=120) as r, open(dest, 'wb') as f:
        shutil.copyfileobj(r, f)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dest', required=True,
                    help='目标目录（runtime 将放在 <dest>/_runtime/）')
    args = ap.parse_args()

    root = os.path.join(args.dest, '_runtime')
    pydir = os.path.join(root, 'python')
    os.makedirs(root, exist_ok=True)

    if os.path.exists(os.path.join(pydir, 'python.exe')):
        print(f'[skip] python 已存在: {pydir}')
    else:
        zip_path = os.path.join(root, 'pyembed.zip')
        fetch(PY_URL, zip_path)
        print(f'[unzip] -> {pydir}')
        os.makedirs(pydir, exist_ok=True)
        with zipfile.ZipFile(zip_path) as z:
            z.extractall(pydir)
        os.unlink(zip_path)
        # embeddable 默认无 site-packages / 无 pip：开 site + 加路径
        pth = os.path.join(pydir, 'python311._pth')
        with open(pth, 'w', encoding='ascii') as f:
            f.write('python311.zip\n.\nLib\\site-packages\n\n'
                    '# Uncomment to run site.main() automatically\n'
                    'import site\n')
        print('[pip] 安装 pip...')
        gp = os.path.join(root, 'get-pip.py')
        fetch(GET_PIP_URL, gp)
        subprocess.run([os.path.join(pydir, 'python.exe'), gp,
                        '--no-warn-script-location'], check=True)
        os.unlink(gp)

    if os.path.exists(os.path.join(pydir, 'Lib', 'site-packages', 'webview')):
        print('[skip] pywebview 已安装')
    else:
        print('[pip] 安装 pywebview (pythonnet/.NET 桥)...')
        subprocess.run([os.path.join(pydir, 'python.exe'), '-m', 'pip',
                        'install', 'pywebview', '--no-warn-script-location'],
                       check=True)

    # [patch] edgechromium.py：AdditionalBrowserArguments 合并环境变量
    # （WebView2 原生语义是显式设置覆盖环境变量，补丁改为拼接，
    #   供 launcher --cdp-port 传入 --remote-allow-origins=* 等）
    ec_path = os.path.join(pydir, 'Lib', 'site-packages', 'webview',
                           'platforms', 'edgechromium.py')
    with open(ec_path, 'r', encoding='utf-8') as f:
        ec_src = f.read()
    if '[storyboard-designer patch]' not in ec_src:
        ec_src = ec_src.replace(
            "        props.AdditionalBrowserArguments = "
            "'--disable-features=ElasticOverscroll'",
            "        # [storyboard-designer patch] 合并环境变量 "
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS\n"
            "        _extra = os.environ.get("
            "'WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS', '').strip()\n"
            "        props.AdditionalBrowserArguments = (\n"
            "            '--disable-features=ElasticOverscroll'"
            " + (' ' + _extra if _extra else '')\n"
            "        )",
        )
        with open(ec_path, 'w', encoding='utf-8') as f:
            f.write(ec_src)
        print('[patch] edgechromium.py 环境变量合并补丁已打')
    else:
        print('[patch] edgechromium.py 补丁已存在')

    # 启动器拷贝进容器
    launcher_src = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                'pywebview_launcher.py')
    launcher_dst = os.path.join(root, 'launcher.py')
    shutil.copy2(launcher_src, launcher_dst)
    print(f'[copy] launcher.py -> {launcher_dst}')

    # 自检
    check = subprocess.run(
        [os.path.join(pydir, 'python.exe'), '-c',
         'import webview; print("webview import OK")'],
        capture_output=True, text=True, timeout=60)
    print(check.stdout.strip() or check.stderr.strip())
    if check.returncode != 0:
        sys.exit(1)
    print(f'DONE: {root}')


if __name__ == '__main__':
    main()
