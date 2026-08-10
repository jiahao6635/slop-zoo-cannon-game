# 黏液动物园：补给炮台

一款以 Blender 炮台资产为视觉核心、用 Three.js 实现物理投射的 3D 街机游戏。玩家需要观察动物行为与机械威胁，切换黏液弹种、调整抛物线并完成动物园补给任务。

> **当前状态：Steam 级垂直切片 + Desktop Foundation + 性能基础。** 仓库已包含一个可完整通关的 5 关战役区域、安全 Electron 桌面壳、可恢复的本地档案，以及对象池、画质分级和运行时性能诊断；但它仍不是内容完整、可直接发行的 Steam 1.0 版本。

[在线试玩](https://jiahao6635.github.io/slop-zoo-cannon-game/) · [Steam 版游戏设计](GAME_DESIGN.md) · [Steam 发行计划](STEAM_RELEASE_PLAN.md) · [参与贡献](CONTRIBUTING.md)

## 当前已实现

- **5 关区域战役**：炮台资格考核、定额补给、威胁处理、有限弹药精准调度，以及三阶段机械 Boss。
- **3 种有功能差异的弹药**：精准补给的营养凝胶弹、可附着并手动引爆的黏附花苞弹、可反弹和空中爆开的弹力泡胶。
- **4 种差异化动物行为**：熊猫需要多次补给，跃跃兔冲刺跳跃，弹簧蛙有顶点空接奖励，月牙熊只在张嘴窗口接受直射补给。
- **3 种机械威胁**：会惩罚误击的清洁无人机、会拦截弹丸的偷食无人机、会为动物生成防护的屏障无人机。特殊弹药可以对其停机、震荡或绕过。
- **三阶段 Boss 战**：不同阶段分别检验投食窗口、黏附引爆、反弹与横风中的移动核心命中。
- **任务评价与成长**：C–S 评级、每关 3 枚照护徽章、积分/准确率/连击统计、顺序解锁、弹药与炮台模块奖励。
- **本地存档**：任务进度、最佳成绩、奖励、配装和统计保存在本机，带版本迁移、备份与损坏恢复逻辑。
- **5 套炮台外观配装**：配装页可在经典补给型、“龙腾新春”、“翠竹守护”、“深海鲸歌”与“星河巡游”之间切换，运行时加载对应 GLB 并继续驱动瞄准、后坐和反馈节点。五款当前均为默认永久解锁；“龙腾新春”保留免费春节限定标识，所有权与当前装备会写入版本化档案。
- **画质与辅助设置**：低/中/高画质预设、手动与动态渲染比例、阴影和粒子分级，以及 UI 缩放、弹道线、瞄准辅助、镜头震动、音量、高对比、减少动态效果与手柄参数。
- **键鼠、触摸与手柄**：包含设备自动切换、手柄菜单导航、死区/灵敏度/反转 Y 轴、支持设备的震动反馈，以及失去焦点自动暂停。
- **物理与表现**：实时弹道预测、重力、连续线段碰撞、反弹、范围补给、落地黏液、粒子、后坐、屏幕震动和合成音效。
- **稳定模拟与对象池**：玩法以固定 60 Hz 时间步更新；炮弹、粒子、污渍、黏附花苞、4 类动物、3 类无人机和 Boss 组件均复用有容量上限的实例，避免连续开火和反复重试造成对象与 GPU 资源持续增长。
- **性能诊断**：滚动统计平均 FPS、1% low、平均/P95/最大帧时间、draw calls、三角面、geometry、texture 与活动实体峰值，并对连续超限和恢复生成去抖告警；本地开发环境可按 `F7` 查看 HUD。
- **可伸缩渲染**：低/中/高预设会调整阴影、粒子密度与污渍上限；动态渲染比例根据滚动性能在预设边界内分级降升，并使用迟滞与冷却避免频繁抖动。
- **基础批处理与 LOD**：建筑框架、护栏、管道、霓虹柱、目标平台和风扇叶片等静态重复环境使用 Instancing；远距离撞击粒子使用更低面数几何体，不改变目标与炮弹的玩法轮廓。
- **经典轮班**：保留原型的 75 秒三波街机得分模式和独立最高分。
- **离线游玩**：运行时不需要账号、后端或联网服务；游戏资产、存档和设置均使用本地资源。
- **安全桌面基础**：Electron 从 `dist` 离线加载，渲染进程启用隔离与沙箱，不具有 Node.js 权限；预加载层只暴露冻结的平台信息和受控存档 KV API，并在打包时关闭 RunAsNode、`NODE_OPTIONS` 和 CLI Inspect 等高风险 Fuse。
- **桌面档案恢复**：用临时文件加原子替换写入，保留 3 份完整档案备份和最后一次正常退出快照，启动时会自动校验与恢复。
- **自动测试**：覆盖内容数据校验、任务解锁/奖励持久化、失败记录隔离、设置容错、对象池契约、动态分辨率控制器、性能统计/预算告警、桌面安全策略以及 1000 次存档写入/损坏恢复。

## 与 Steam 1.0 的距离

当前切片用一个区域验证了战役、弹种、动物行为、威胁、Boss、评价、存档、设置和手柄这条完整链路。要成为正式 Steam 1.0，仍需要：

- 扩展多个动物园区域、更多动物与关卡，形成完整游戏时长。
- 完成最终角色/环境美术、动画、音乐、叙事、本地化与全流程新手教程。
- 在最低配置 PC 与 Steam Deck 实机完成画质调优、两小时性能/内存压力测试、WebGL Context Lost 恢复、兼容性矩阵、可访问性审核与外部 QA。
- 完成桌面包的正式应用身份、代码签名与真机发布回归，并接入 Steamworks 成就、云存档、状态和 Steam Deck 验证。

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

### 桌面开发与打包

安全 Electron 桌面壳会在开发时连接本机 Vite，生产时只从 `dist` 读取离线资源：

```bash
npm run desktop:dev
npm run desktop:start
```

生成当前系统的未签名解包目录，或生成 Windows/Linux 发行包：

```bash
npm run desktop:pack
npm run desktop:dist:win
npm run desktop:dist:linux
```

Windows 与 Linux 发行包配置使用占位应用身份，不包含代码签名或真实 Steam App ID。Steamworks 在当前阶段会报告 `unavailable / local-mock`，不会阻止离线启动、游玩和存档。

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

仓库包含 5 份独立、可编辑的 Blender 5.2 炮台源文件。所有外观共用同一机械骨架与运行时节点契约，装饰、材质和发布产物则彼此隔离：

| 外观 | 设计语言 |
|---|---|
| 经典补给型 | 枪灰硬表面、老化黄铜、黏液弹药罐、输送管、充能线圈、压力表与检修面板组成的园区工业原型。 |
| 龙腾新春 `dragon-new-year` | 朱漆、帝王金、翠玉瓷与翠玉能量，配合龙角、龙须、金鳞、龙脊、獠牙、明珠、灯笼与祥云构成春节限定轮廓。 |
| 翠竹守护 `bamboo-guardian` | 墨绿竹漆、竹节金、熊猫瓷与竹叶能量，用环形竹丛、竹结挂饰、熊猫耳、眼斑、足印和炮管竹叶表现温和守护者形象。 |
| 深海鲸歌 `abyssal-whale` | 深渊海军蓝、海洋铜、珊瑚珍珠与生物荧光，通过珊瑚簇、舷窗、浮标、鲸鳍、背鳍、尾鳍、鳃裂与呼吸孔形成深海蓝鲸轮廓。 |
| 星河巡游 `stellar-voyager` | 星云紫甲、星际银铬、太阳陶瓷与跃迁能量，配置双轨道环、星芒基座、推进器、太阳能翼板、天线锅与炮口星标。 |

安装 Blender 后可复现经典炮台的升级、导出与校验：

```bash
npm run upgrade:assets
npm run export:assets
npm run check:assets:classic
```

其他四款外观使用独立命令，不会覆盖经典源文件或彼此的发布资产：

```bash
npm run upgrade:assets:dragon
npm run export:assets:dragon
npm run check:assets:dragon

npm run upgrade:assets:bamboo
npm run export:assets:bamboo
npm run check:assets:bamboo

npm run upgrade:assets:abyssal
npm run export:assets:abyssal
npm run check:assets:abyssal

npm run upgrade:assets:stellar
npm run export:assets:stellar
npm run check:assets:stellar
```

`npm run check:assets` 会一次校验全部 5 套发布资产及已提交 manifest 的路径、皮肤 ID、预算和 SHA-256。

脚本会自动查找 `PATH` 中的 Blender，以及 macOS 和常见 Windows 安装位置。也可以显式指定：

```bash
BLENDER_BIN=/path/to/blender npm run export:assets:dragon
```

每款皮肤都由独立的 Blender 源文件、运行时 GLB、许可/校验 manifest 和配装目录预览图组成：

| 外观 | Blender 源文件 | GLB / manifest | 配装预览 |
|---|---|---|---|
| 经典补给型 | `blender/slop_zoo_game_assets.blend` | `public/assets/slop-cannon.glb`<br>`public/assets/slop-cannon.asset.json` | `public/assets/previews/slop-cannon-classic.jpg` |
| 龙腾新春 | `blender/slop_zoo_game_assets_dragon_new_year.blend` | `public/assets/slop-cannon-dragon-new-year.glb`<br>`public/assets/slop-cannon-dragon-new-year.asset.json` | `public/assets/previews/slop-cannon-dragon-new-year.jpg` |
| 翠竹守护 | `blender/slop_zoo_game_assets_bamboo_guardian.blend` | `public/assets/slop-cannon-bamboo-guardian.glb`<br>`public/assets/slop-cannon-bamboo-guardian.asset.json` | `public/assets/previews/slop-cannon-bamboo-guardian.jpg` |
| 深海鲸歌 | `blender/slop_zoo_game_assets_abyssal_whale.blend` | `public/assets/slop-cannon-abyssal-whale.glb`<br>`public/assets/slop-cannon-abyssal-whale.asset.json` | `public/assets/previews/slop-cannon-abyssal-whale.jpg` |
| 星河巡游 | `blender/slop_zoo_game_assets_stellar_voyager.blend` | `public/assets/slop-cannon-stellar-voyager.glb`<br>`public/assets/slop-cannon-stellar-voyager.asset.json` | `public/assets/previews/slop-cannon-stellar-voyager.jpg` |

发布导出保留以下运行时控制节点：

- `CannonAssetRoot`：炮台资产根节点。
- `CannonYaw`：水平瞄准。
- `CannonPitch`：俯仰瞄准。
- `CannonRecoil`：发射后坐。
- `MuzzleAnchor`：炮弹生成点。
- `CannonChargeGlow`：随蓄力变化的充能线圈。
- `CannonAmmoGlow`：随弹药库存变化的黏液弹药罐。
- `CannonGaugeNeedle`：指示蓄力程度的仪表指针。
- `CannonStatusLight`：指示任务稳定度的状态灯。
- `CannonMuzzleGlow`：响应蓄力、开火与后坐的炮口光效。

五套炮台都保留上述 runtime 节点名称、层级、枢轴和反馈契约，因此切换皮肤不会改变炮弹出生点、瞄准、后坐或 HUD 反馈逻辑。全部 GLB 均为 18 个节点、8 个网格和 4 个 PBR 材质，经合批、去重与 Meshopt 压缩后的发布统计为：

| 外观 | 图元 | 三角面 | GLB 大小 |
|---|---:|---:|---:|
| 经典补给型 | 12 | 13,096 | 94,544 字节 |
| 龙腾新春 | 13 | 16,324 | 115,556 字节 |
| 翠竹守护 | 14 | 16,064 | 115,336 字节 |
| 深海鲸歌 | 14 | 15,732 | 113,600 字节 |
| 星河巡游 | 14 | 15,284 | 109,188 字节 |

经典款相较 V2 三角面减少约 52%、文件减少约 32%。五款都保持无纹理、无动画、无相机和无灯光；色漆、金属、陶瓷与发光效果全部由材质参数表现。每份独立 manifest 记录资产 ID、MIT 许可、Blender 5.2/glTF-Transform 工具链、SHA-256 与预算统计，四款非经典外观还会记录稳定皮肤 ID。导出阶段会拒绝退化面，并验证炮口/俯仰枢轴、五类反馈节点及压力表旋转轴；实时黏液弹与飞溅仍由 Three.js 生成。

配装目录使用 5 张 960×540 JPG。它们不是 GLB 纹理，而是由 `tools/render_cannon_preview.py` 直接从各自 `.blend` 文件以相同相机、灯光和背景渲染的模型展示图。模型或材质更新后可用以下命令同步重建：

```bash
/path/to/blender --background blender/slop_zoo_game_assets.blend --python tools/render_cannon_preview.py -- --output public/assets/previews/slop-cannon-classic.jpg
/path/to/blender --background blender/slop_zoo_game_assets_dragon_new_year.blend --python tools/render_cannon_preview.py -- --output public/assets/previews/slop-cannon-dragon-new-year.jpg
/path/to/blender --background blender/slop_zoo_game_assets_bamboo_guardian.blend --python tools/render_cannon_preview.py -- --output public/assets/previews/slop-cannon-bamboo-guardian.jpg
/path/to/blender --background blender/slop_zoo_game_assets_abyssal_whale.blend --python tools/render_cannon_preview.py -- --output public/assets/previews/slop-cannon-abyssal-whale.jpg
/path/to/blender --background blender/slop_zoo_game_assets_stellar_voyager.blend --python tools/render_cannon_preview.py -- --output public/assets/previews/slop-cannon-stellar-voyager.jpg
```

## 目录

```text
index.html                           主菜单、任务/配装/设置界面与 HUD
src/main.js                          Three.js 场景、任务运行时、物理、Boss 与音效
src/style.css                        界面、HUD 与响应式布局
src/content/gameContent.js           5 关、弹药、威胁、模块、奖励的数据定义
src/content/cannonSkins.js           炮台外观目录、默认解锁与安全回退规则
src/systems/inputSystem.js           键鼠/手柄输入、设备切换与震动
src/systems/saveSystem.js            版本化本地存档、备份、迁移与任务奖励
src/systems/settingsSystem.js        设置验证、持久化与运行时应用
src/platform/                        Web/桌面平台门面与存档启动迁移
src/render/objectPool.js             有容量上限的运行时对象池与生命周期统计
src/render/performanceMonitor.js     滚动帧率、帧时间、渲染预算与告警
src/render/dynamicResolution.js      带迟滞、冷却和预设边界的动态渲染比例控制器
desktop/                             Electron 主进程、preload、安全策略与原子档案
test/content-save-settings.test.js   内容、存档和设置自动测试
test/object-pool.test.js             对象池复用、容量、重置和异常契约测试
test/performance-monitor.test.js     性能统计、窗口、峰值与预算告警测试
test/dynamic-resolution.test.js      动态渲染比例阈值、迟滞、边界与恢复测试
test/platform-desktop.test.js        桌面安全、1000 次写入与损坏恢复测试
public/assets/slop-cannon.glb         发布用 Blender 炮台模型
public/assets/slop-cannon.asset.json  炮台许可、校验值与性能预算清单
blender/slop_zoo_game_assets.blend   可编辑 Blender 源文件
public/assets/slop-cannon-dragon-new-year.glb         龙腾新春发布模型
public/assets/slop-cannon-dragon-new-year.asset.json  龙腾新春许可、校验值与预算清单
blender/slop_zoo_game_assets_dragon_new_year.blend   龙腾新春独立 Blender 5.2 源文件
public/assets/slop-cannon-bamboo-guardian.glb        翠竹守护发布模型
public/assets/slop-cannon-bamboo-guardian.asset.json 翠竹守护许可、校验值与预算清单
blender/slop_zoo_game_assets_bamboo_guardian.blend  翠竹守护独立 Blender 5.2 源文件
public/assets/slop-cannon-abyssal-whale.glb          深海鲸歌发布模型
public/assets/slop-cannon-abyssal-whale.asset.json   深海鲸歌许可、校验值与预算清单
blender/slop_zoo_game_assets_abyssal_whale.blend    深海鲸歌独立 Blender 5.2 源文件
public/assets/slop-cannon-stellar-voyager.glb        星河巡游发布模型
public/assets/slop-cannon-stellar-voyager.asset.json 星河巡游许可、校验值与预算清单
blender/slop_zoo_game_assets_stellar_voyager.blend  星河巡游独立 Blender 5.2 源文件
public/assets/previews/slop-cannon-classic.jpg        经典炮台配装目录预览
public/assets/previews/slop-cannon-dragon-new-year.jpg 龙腾新春配装目录预览
public/assets/previews/slop-cannon-bamboo-guardian.jpg 翠竹守护配装目录预览
public/assets/previews/slop-cannon-abyssal-whale.jpg   深海鲸歌配装目录预览
public/assets/previews/slop-cannon-stellar-voyager.jpg 星河巡游配装目录预览
tools/render_cannon_preview.py                        五款炮台共用的 Blender 预览渲染脚本
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

Blender 5.2 LTS 后台导出已验证通过。网页切片已覆盖主菜单、任务解锁、配装、设置、暂停/重试、成功/失败结算以及 Boss 三阶段流程。CI 会额外生成未签名的 Windows x64 和 Linux x64 测试包；真实证书、Steam App ID 和 Steamworks SDK 将在发行账号准备完成后接入。

### 性能诊断与本阶段门槛

开发版在 localhost 下可按 `F7` 打开性能 HUD。当前切片的自动预算为：平均 FPS 不低于 55、1% low 不低于 45、P95 帧时间不高于 24 ms、draw calls 不高于 250、活动三角面不高于 500,000、geometry 不高于 300、texture 不高于 192、活动实体不高于 600。

本机浏览器压力验证已覆盖每个池两轮各 20,000 次获取/释放、连续任务与 Boss 重启、384 个同时活动粒子，以及预算超限后的恢复告警。测试中池创建数和 geometry/texture 数量在预热后保持平台化，常规采样约为 60 FPS、1% low 约 56.7 FPS。该结果只证明当前开发环境的基础机制有效，不能替代最低配置 PC、Steam Deck 实机和两小时发布压力测试。

## 技术与致谢

- [Three.js](https://threejs.org/)：WebGL 3D 渲染。
- [Vite](https://vite.dev/)：本地开发与生产构建。
- [Blender](https://www.blender.org/)：炮台建模和 GLB 导出。
- [Electron](https://www.electronjs.org/)：桌面封装与本地平台桥。

## 开源许可证

代码、Blender 源文件、GLB 资产与由其生成的配装预览图均按 [MIT License](LICENSE) 开源。素材范围说明见 [ASSET_LICENSE.md](ASSET_LICENSE.md)。
