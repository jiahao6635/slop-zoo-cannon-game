# 黏液动物园：补给炮台

一款以 Blender 炮台资产为视觉核心、用 Three.js 实现物理投射的 3D 街机游戏。玩家需要观察动物行为与机械威胁，切换黏液弹种、调整抛物线并完成动物园补给任务。

> **当前状态：Steam 级垂直切片。** 仓库已包含一个可完整通关的 5 关战役区域与商业版所需的部分基础系统，但它仍不是内容完整、可直接发行的 Steam 1.0 版本。

[在线试玩](https://jiahao6635.github.io/slop-zoo-cannon-game/) · [Steam 版游戏设计](GAME_DESIGN.md) · [Steam 发行计划](STEAM_RELEASE_PLAN.md) · [参与贡献](CONTRIBUTING.md)

## 当前已实现

- **5 关区域战役**：炮台资格考核、定额补给、威胁处理、有限弹药精准调度，以及三阶段机械 Boss。
- **3 种有功能差异的弹药**：精准补给的营养凝胶弹、可附着并手动引爆的黏附花苞弹、可反弹和空中爆开的弹力泡胶。
- **4 种差异化动物行为**：熊猫需要多次补给，跃跃兔冲刺跳跃，弹簧蛙有顶点空接奖励，月牙熊只在张嘴窗口接受直射补给。
- **3 种机械威胁**：会惩罚误击的清洁无人机、会拦截弹丸的偷食无人机、会为动物生成防护的屏障无人机。特殊弹药可以对其停机、震荡或绕过。
- **三阶段 Boss 战**：不同阶段分别检验投食窗口、黏附引爆、反弹与横风中的移动核心命中。
- **任务评价与成长**：C–S 评级、每关 3 枚照护徽章、积分/准确率/连击统计、顺序解锁、弹药与炮台模块奖励。
- **本地存档**：任务进度、最佳成绩、奖励、配装和统计保存在本机，带版本迁移、备份与损坏恢复逻辑。
- **完整设置菜单**：渲染精度、UI 缩放、弹道线、瞄准辅助、镜头震动、音量、高对比、减少动态效果与手柄参数。
- **键鼠、触摸与手柄**：包含设备自动切换、手柄菜单导航、死区/灵敏度/反转 Y 轴、支持设备的震动反馈，以及失去焦点自动暂停。
- **物理与表现**：实时弹道预测、重力、连续线段碰撞、反弹、范围补给、落地黏液、粒子、后坐、屏幕震动和合成音效。
- **经典轮班**：保留原型的 75 秒三波街机得分模式和独立最高分。
- **离线游玩**：运行时不需要账号、后端或联网服务；游戏资产、存档和设置均使用本地资源。
- **自动测试**：覆盖内容数据校验、任务解锁/奖励持久化、失败记录隔离和设置容错。

## 与 Steam 1.0 的距离

当前切片用一个区域验证了战役、弹种、动物行为、威胁、Boss、评价、存档、设置和手柄这条完整链路。要成为正式 Steam 1.0，仍需要：

- 扩展多个动物园区域、更多动物与关卡，形成完整游戏时长。
- 完成最终角色/环境美术、动画、音乐、叙事、本地化与全流程新手教程。
- 进行大规模玩法平衡、性能/兼容性测试、可访问性审核与外部 QA。
- 提供桌面发行封装，并接入 Steamworks 成就、云存档、状态与 Steam Deck 实机验证。

完整目标范围见 [Steam 版游戏设计](GAME_DESIGN.md)，分阶段发行工作见 [Steam 发行计划](STEAM_RELEASE_PLAN.md)。

## 运行

需要 Node.js 20.19+ 或 22.12+。

```bash
npm install
npm run dev
```

打开终端显示的本地地址，默认是 `http://127.0.0.1:5173/`。初次安装 npm 依赖需要获取软件包；游戏运行时不需要联网服务。

生产构建与本地预览：

```bash
npm run build
npm run preview
```

## 操作

### 键鼠

| 操作 | 按键 |
|---|---|
| 瞄准 | 在画面中拖动，或 `WASD` / 方向键微调 |
| 蓄力与发射 | 按住鼠标左键或空格，松开发射 |
| 选择弹药 | `1`–`3` 直接选择；`Q` / `E`、`[` / `]` 或鼠标滚轮切换 |
| 特殊动作 | `Shift` 或鼠标右键：引爆黏附花苞/空中爆开弹力泡胶 |
| 暂停/继续 | `P` 或 `Esc` |
| 重新开始当前任务 | `R` |
| 菜单确认/返回 | `Enter` / `Esc` 或 `Backspace` |

### 标准手柄（Xbox 布局）

| 操作 | 按键 |
|---|---|
| 瞄准 | 右摇杆 |
| 蓄力与发射 | `RT` |
| 上一/下一弹药 | `LB` / `RB` |
| 特殊动作 / 菜单确认 | `A` |
| 菜单返回 | `B` |
| 菜单导航 | 左摇杆或方向键 |
| 暂停/继续 | `Menu` |
| 重新开始当前任务 | `Y` |

## Blender 素材管线

仓库已经包含可编辑源文件 `blender/slop_zoo_game_assets.blend`。安装 Blender 后可重新导出 GLB：

```bash
npm run export:assets
```

脚本会自动查找 `PATH` 中的 Blender，以及 macOS 和常见 Windows 安装位置。也可以显式指定：

```bash
BLENDER_BIN=/path/to/blender npm run export:assets
```

导出会更新 `public/assets/slop-cannon.glb`，即 Three.js 加载的发布资产。

Blender 文件包含 35 个 `CANNON_*` 网格以及以下运行时控制节点：

- `CannonYaw`：水平瞄准。
- `CannonPitch`：俯仰瞄准。
- `CannonRecoil`：发射后坐。
- `MuzzleAnchor`：炮弹生成点。

GLB 约 24,840 个应用修改器后的三角面、2 个 PBR 材质，不包含相机、灯光或 Blender 流体缓存。实时黏液弹与飞溅由 Three.js 生成，更适合游戏运行时。

## 目录

```text
index.html                           主菜单、任务/配装/设置界面与 HUD
src/main.js                          Three.js 场景、任务运行时、物理、Boss 与音效
src/style.css                        界面、HUD 与响应式布局
src/content/gameContent.js           5 关、弹药、威胁、模块、奖励的数据定义
src/systems/inputSystem.js           键鼠/手柄输入、设备切换与震动
src/systems/saveSystem.js            版本化本地存档、备份、迁移与任务奖励
src/systems/settingsSystem.js        设置验证、持久化与运行时应用
test/content-save-settings.test.js   内容、存档和设置自动测试
public/assets/slop-cannon.glb         发布用 Blender 炮台模型
blender/slop_zoo_game_assets.blend   可编辑 Blender 源文件
tools/                               Blender 导出与资产净化工具
GAME_DESIGN.md                       Steam 1.0 内容设计
STEAM_RELEASE_PLAN.md                Steam 发行路线与验收门槛
```

## 验证

运行自动测试：

```bash
npm test
```

运行完整检查（自动测试、JavaScript 语法检查与生产构建）：

```bash
npm run check
```

Blender 5.2 LTS 后台导出已验证通过。网页切片已覆盖主菜单、任务解锁、配装、设置、暂停/重试、成功/失败结算以及 Boss 三阶段流程。

## 技术与致谢

- [Three.js](https://threejs.org/)：WebGL 3D 渲染。
- [Vite](https://vite.dev/)：本地开发与生产构建。
- [Blender](https://www.blender.org/)：炮台建模和 GLB 导出。

## 开源许可证

代码、Blender 源文件与 GLB 资产均按 [MIT License](LICENSE) 开源。素材范围说明见 [ASSET_LICENSE.md](ASSET_LICENSE.md)。
