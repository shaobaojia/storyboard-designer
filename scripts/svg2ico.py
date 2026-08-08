#!/usr/bin/env python3
"""SVG → ICO 转换（分镜管理器窗口标题栏图标）
用法: python svg2ico.py <in.svg> <out.ico>
输出多尺寸 ICO（16/24/32/48/64/128/256），透明背景。
"""
import io
import sys

from PIL import Image
from reportlab.graphics import renderPM
from svglib.svglib import svg2rlg


def main():
    src, dst = sys.argv[1], sys.argv[2]
    drawing = svg2rlg(src)
    if drawing is None:
        raise SystemExit('svg2rlg failed')
    # 放大渲染再缩（抗锯齿），目标最大 256
    scale = 512 / max(drawing.width, drawing.height)
    drawing.width = drawing.width * scale
    drawing.height = drawing.height * scale
    drawing.scale(scale, scale)
    buf = io.BytesIO()
    # RGBA 后端输出透明背景（bg=None + backendFmt='RGBA'）
    img = renderPM.drawToPIL(drawing, dpi=72, bg=None, backendFmt='RGBA')
    print('rendered size:', img.size)

    # 多尺寸 ICO
    sizes = [16, 24, 32, 48, 64, 128, 256]
    img.save(dst, format='ICO', sizes=[(s, s) for s in sizes])
    print('saved:', dst)


if __name__ == '__main__':
    main()
