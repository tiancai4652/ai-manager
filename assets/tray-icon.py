"""生成托盘图标 (32x32 PNG) — 铃铛形状"""
from PIL import Image, ImageDraw
import os

size = 64
img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)
fill = (44, 62, 80, 255)  # #2C3E50

# 铃铛顶部
draw.ellipse([20, 4, 44, 28], fill=fill)
# 铃铛主体
draw.rectangle([14, 20, 50, 40], fill=fill)
# 底部弧线
draw.ellipse([10, 32, 54, 48], fill=fill)
# 铃铛口
draw.ellipse([16, 40, 48, 50], fill=(0, 0, 0, 0))
# 铃舌
draw.ellipse([26, 48, 38, 58], fill=fill)
# 顶部突起
draw.ellipse([28, 0, 36, 8], fill=fill)

out = os.path.join(os.path.dirname(__file__), "tray-icon.png")
img.save(out)
print(f"图标已生成: {out}")
