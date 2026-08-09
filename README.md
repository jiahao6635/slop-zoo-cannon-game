# 黏液动物园：补给炮台

一款以 Blender 炮台模型为核心资产的浏览器 3D 街机游戏原型。玩家在 75 秒轮班中操纵补给炮，以抛物线黏液弹命中动物饲喂靶、维持连击，并在最终波避开红色清洁无人机。

[在线试玩](https://jiahao6635.github.io/slop-zoo-cannon-game/) · [游戏设计](GAME_DESIGN.md) · [参与贡献](CONTRIBUTING.md)

## 已实现

- Blender 制作的完整炮台，支持运行时水平转向、俯仰、后坐和枪口定位。
- 鼠标、触摸与键盘瞄准；按住蓄力，松开发射。
- 实时弹道预测、重力、连续线段碰撞、落地黏液和粒子飞溅。
- 熊猫、兔子、熊和青蛙移动靶，以及扣分的危险无人机。
- 三波难度、限时计分、连击倍率、自动恢复弹药和本地最高分。
- 合成音效、屏幕震动、命中提示、暂停、重开与响应式手机操作按钮。
- 程序化工业实验场、灯光、标牌和环境动画。

## 运行

需要 Node.js 20.19+ 或 22.12+。

```bash
npm install
npm run dev
```

打开终端显示的本地地址，默认是 `http://127.0.0.1:5173/`。

生产构建：

```bash
npm run build
npm run preview
```

## 操作

- 鼠标或触摸拖动：瞄准
- 按住鼠标左键或屏幕发射键：蓄力
- 松开：发射
- `WASD` / 方向键：微调瞄准
- 空格：键盘蓄力与发射
- `P` / `Esc`：暂停或继续

## Blender 素材管线

仓库已经包含可编辑源文件 `blender/slop_zoo_game_assets.blend`。安装 Blender 后可重新导出 GLB：

```bash
npm run export:assets
```

脚本会自动查找 `PATH` 中的 Blender，以及 macOS 和常见 Windows 安装位置。也可以显式指定：

```bash
BLENDER_BIN=/path/to/blender npm run export:assets
```

导出会更新：

- `public/assets/slop-cannon.glb`：Three.js 加载的发布资产。

Blender 文件包含 35 个 `CANNON_*` 网格以及以下运行时控制节点：

- `CannonYaw`：水平瞄准
- `CannonPitch`：俯仰瞄准
- `CannonRecoil`：发射后坐
- `MuzzleAnchor`：炮弹生成点

GLB 约 24,840 个应用修改器后的三角面、2 个 PBR 材质，不包含相机、灯光或 Blender 流体缓存。实时黏液弹与飞溅由 Three.js 生成，更适合游戏运行时。

## 目录

```text
index.html                         游戏界面与 HUD
src/main.js                       Three.js 场景、玩法、物理和音效
src/style.css                     响应式工业实验室视觉
public/assets/slop-cannon.glb      发布用 Blender 模型
blender/slop_zoo_game_assets.blend 可编辑派生素材
tools/export_assets.mjs            跨平台 Blender 启动器
tools/export_game_glb.py           可复现 GLB 导出脚本
GAME_DESIGN.md                    游戏设计说明
```

## 验证

- `npm run build` 通过。
- Blender 5.2 LTS 后台导出通过。
- 桌面 1280×720 与手机 390×844 浏览器布局通过。
- 已实测模型加载、开始/暂停、拖动蓄力、发射、命中计分、弹药恢复、回合结束和重开界面。

## 技术与致谢

- [Three.js](https://threejs.org/)：WebGL 3D 渲染。
- [Vite](https://vite.dev/)：本地开发与生产构建。
- [Blender](https://www.blender.org/)：炮台建模和 GLB 导出。
- Barlow Condensed 与 Rajdhani：Google Fonts，SIL Open Font License。

## 开源许可证

代码、Blender 源文件与 GLB 资产均按 [MIT License](LICENSE) 开源。素材范围说明见 [ASSET_LICENSE.md](ASSET_LICENSE.md)。
