# 黏液动物园：补给炮台

## Steam 发行级技术与生产计划

> 本文把游戏设计转换为可执行的工程、平台、内容生产和 QA 任务。
> 优先目标是 Windows 与 Steam Deck；macOS 可在首发后追加。
> 当前仓库定位为 **Steam 级垂直切片 + Desktop Foundation + 性能基础**，不代表 Steamworks、Deck Verified 或 Steam 1.0 已完成。

## 1. 发布定义

达到“可以提交 Steam 审核”的版本至少满足：

- 有完整战役、明确成功与失败、正式结算和长期解锁。
- 游戏完全离线运行，不依赖字体 CDN、网页服务或额外账号。
- 从启动到退出都可使用手柄完成。
- 有版本化正式存档、自动备份和 Steam Cloud。
- 有完整显示、图形、音频、操作、语言和辅助设置。
- 接入 Steam 成就、统计、排行榜、Rich Presence 和 Overlay。
- Windows 与 Steam Deck 达到明确性能目标。
- 通过外部试玩、兼容性矩阵、存档压力测试和发布回归。
- 商店截图、预告片和文字中的所有功能都真实存在于发行版。

## 2. 当前实施状态与剩余阻断项

### 已完成：Steam 级垂直切片

- 已完成 1 个区域、5 个任务、3 种差异化弹药、4 种动物行为、3 种机械威胁和 1 个三阶段 Boss。
- 已打通选关、配装、任务成败、C–S 评价、徽章、解锁、结算和本地存档闭环，并保留 75 秒经典轮班。
- 已提供键鼠、触摸和标准 Gamepad 的玩法与菜单导航，包含死区、灵敏度、反转 Y 轴、震动、焦点丢失暂停与部分辅助设置。
- 运行时所需游戏资产全部随包提供，不再发起 Google Fonts 或其他远程资源请求。

### 已完成：Blender 炮台 V3 与资产预算管线

- 炮台已用 Mac Blender 重建为游戏级低面硬表面资产，并补充弹药罐保护框/输送管、瞄准导轨、炮口护片、压力表刻度、检修面板与基座固定夹；Three.js 会按蓄力、库存、开火和任务稳定度驱动独立反馈节点。
- 已修正压力表指针的导出局部轴与运行时旋转轴；导出管线会清理退化面和无用顶点属性、按运行时节点合批、去重、应用 Meshopt，再执行 Khronos 与自定义契约/预算验证。
- 当前发布 GLB 为 8 个网格、12 个图元、13,096 个三角面、4 个材质和 94,544 字节；相较 V2 三角面减少约 52%、文件减少约 32%，资产清单记录 MIT 许可、工具链、SHA-256 与预算数据。
- 已建立 5 套彼此独立的 Blender 5.2 源文件、发布 GLB、manifest 和配装预览，导出任一变体不会覆盖其他外观。经典补给型是枪灰/黄铜园区工业原型；“龙腾新春”以朱漆、帝王金、翠玉和龙角/龙须/鳞片/灯笼/祥云形成春节限定轮廓。
- “翠竹守护”以墨绿竹漆、竹节金、熊猫瓷和竹叶能量表现园区守护主题，加入环形竹丛、竹结挂饰、熊猫耳/眼斑/足印和炮管竹叶；“深海鲸歌”以深渊蓝、海洋铜、珊瑚珍珠和生物荧光组合珊瑚簇、舷窗、浮标、鲸鳍/背鳍/尾鳍、鳃裂与呼吸孔；“星河巡游”以星云紫、星际银铬、太阳陶瓷和跃迁能量组合双轨道环、推进器、太阳能翼板、天线锅与炮口星标。
- 五套外观都保留 `CannonYaw`、`CannonPitch`、`CannonRecoil`、`MuzzleAnchor` 及五类反馈节点的名称、层级和枢轴契约，可由同一套运行时代码驱动。每款非经典 GLB 的根节点与独立清单都写入稳定皮肤 ID、MIT 许可、工具链、SHA-256 与预算数据；所有 GLB 均保持无纹理、无动画、无相机和无灯光。
- 配装页可预览并切换全部 5 套炮台外观，加载失败会保留当前可用资产。五款当前均为默认永久解锁；“龙腾新春”保留免费限定标识，所有权和当前装备会通过存档版本迁移保存，无效或缺失的皮肤 ID 会安全回退到经典炮台。
- 资产管线提供 `:dragon`、`:bamboo`、`:abyssal` 和 `:stellar` 四组独立 upgrade/export/check 命令；`npm run check:assets` 会校验全部 5 套发布资产。这是垂直切片的外观生产管线，不代表 Steam 1.0 的完整外观内容已经完成。
- 配装目录已提供 5 张 960×540 Blender 模型预览。预览由 `tools/render_cannon_preview.py` 使用同一摄影棚配置从对应 `.blend` 源文件生成，不会作为纹理写入 GLB；模型或材质变更必须同步重渲染预览。

当前发布统计（全部为 18 个节点、8 个网格、4 个 PBR 材质）：

| 外观 | 图元 | 三角面 | GLB 大小 |
|---|---:|---:|---:|
| 经典补给型 | 12 | 13,096 | 94,544 字节 |
| 龙腾新春 | 13 | 16,324 | 115,556 字节 |
| 翠竹守护 | 14 | 16,064 | 115,336 字节 |
| 深海鲸歌 | 14 | 15,732 | 113,600 字节 |
| 星河巡游 | 14 | 15,284 | 109,188 字节 |

三款新增外观的发布路径：

| 外观 | Blender / GLB / manifest / preview |
|---|---|
| 翠竹守护 | `blender/slop_zoo_game_assets_bamboo_guardian.blend`<br>`public/assets/slop-cannon-bamboo-guardian.glb`<br>`public/assets/slop-cannon-bamboo-guardian.asset.json`<br>`public/assets/previews/slop-cannon-bamboo-guardian.jpg` |
| 深海鲸歌 | `blender/slop_zoo_game_assets_abyssal_whale.blend`<br>`public/assets/slop-cannon-abyssal-whale.glb`<br>`public/assets/slop-cannon-abyssal-whale.asset.json`<br>`public/assets/previews/slop-cannon-abyssal-whale.jpg` |
| 星河巡游 | `blender/slop_zoo_game_assets_stellar_voyager.blend`<br>`public/assets/slop-cannon-stellar-voyager.glb`<br>`public/assets/slop-cannon-stellar-voyager.asset.json`<br>`public/assets/previews/slop-cannon-stellar-voyager.jpg` |

三款新增外观的构建与校验命令：

```bash
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

预览图复现命令：

```bash
/path/to/blender --background blender/slop_zoo_game_assets.blend --python tools/render_cannon_preview.py -- --output public/assets/previews/slop-cannon-classic.jpg
/path/to/blender --background blender/slop_zoo_game_assets_dragon_new_year.blend --python tools/render_cannon_preview.py -- --output public/assets/previews/slop-cannon-dragon-new-year.jpg
/path/to/blender --background blender/slop_zoo_game_assets_bamboo_guardian.blend --python tools/render_cannon_preview.py -- --output public/assets/previews/slop-cannon-bamboo-guardian.jpg
/path/to/blender --background blender/slop_zoo_game_assets_abyssal_whale.blend --python tools/render_cannon_preview.py -- --output public/assets/previews/slop-cannon-abyssal-whale.jpg
/path/to/blender --background blender/slop_zoo_game_assets_stellar_voyager.blend --python tools/render_cannon_preview.py -- --output public/assets/previews/slop-cannon-stellar-voyager.jpg
```

### 已完成：Desktop Foundation

- Electron 生产壳从 `dist` 离线加载，启用 `contextIsolation` 和沙箱，关闭渲染进程 Node.js 权限，并限制预加载 API、导航、外链、下载与运行时权限；打包时同时关闭 RunAsNode、`NODE_OPTIONS` 与 CLI Inspect，并启用 ASAR 完整性/仅从 ASAR 加载 Fuse。
- 桌面档案使用临时文件加原子替换，保留 3 份旋转备份和最后一次正常退出快照，可从损坏主档自动恢复，并可幂等迁移现有 Web/localStorage 数据。
- 开发环境或 Steam 不可用时使用 `unavailable / local-mock`，不会阻止离线启动、游玩或存档。
- 已有 Windows x64 和 Linux x64 的未签名构建脚本与 CI 构建矩阵，并有桌面安全策略、1000 次原子写入和损坏恢复自动测试。

### 已完成：性能与画质基础

- 玩法循环使用固定 60 Hz 时间步，并为单帧追帧次数设置上限；渲染与输入仍按实际帧间隔更新。
- 炮弹池容量为 48、粒子为 384、污渍为 24、黏附花苞为 16；4 类动物与 3 类无人机各自按 8 个实例复用，Boss 投食口/储存罐/移动核心组件按 1/2/1 个实例复用，Boss 主体按单例重入。
- 对象池记录创建、复用、活动数、高水位和容量耗尽；命中结算、花苞快照和 Boss 阶段重入已处理复用对象的生命周期边界，共享 geometry/material 不会随单实例回收而销毁。
- 性能监控滚动统计平均 FPS、1% low、平均/P95/最大帧时间、draw calls、三角面、geometry、texture 与活动实体峰值，并对连续预算超限/恢复生成去抖告警；localhost 开发环境可用 `F7` 查看 HUD。
- 设置已提供低/中/高画质预设、动态渲染比例开关、手动渲染比例，以及独立阴影与粒子分级。动态比例按滚动性能逐级降低或恢复，并使用连续采样、迟滞、冷却和各预设上下界避免频繁跳变。
- 建筑框架、护栏、墙面管道、霓虹柱、目标平台和风扇叶片等静态重复环境已改为 InstancedMesh；远距离撞击粒子在出生时选择低面数几何体，池重置时恢复默认 LOD，目标和炮弹暂不做高风险的动态实例化。
- 本机浏览器压力验证已覆盖每个池两轮各 20,000 次获取/释放、20 次任务重启预热后再重启 20 次、10 次 Boss 重启预热后再重启 10 次，以及 384 个同时活动粒子。池创建数与 geometry/texture 在预热后保持平台化，强制过载可触发预算告警并在回收后恢复。

### 进行中

- `src/main.js` 仍集中了较多场景、玩法、物理、音频和 UI 职责；固定 60 Hz 基础循环已经接入，但系统拆分、渲染插值、确定性回放摘要与更完整的实体生命周期边界仍需完成。
- 对象池、画质预设、动态渲染比例、静态环境 Instancing 和最小粒子 LOD 已完成基础实现；仍需在最低配置 PC 与 Steam Deck 实机调优，完成两小时性能/内存压力测试，并加入 WebGL Context Lost 恢复。
- 当前只完成炮台的 Blender 发布资产；动物、无人机、Boss 与环境仍需模型化、动画化、LOD 化与许可清单化。
- 分辨率/显示器/窗口模式、完整输入重映射、中英文本地化、正式音乐与辅助功能审核仍属发行工作。

### 下一阶段实施顺序

1. 在 Steam Deck 1280×800 和最低配置 PC 上分别采集低/中/高画质基线，完成两小时对象池、geometry、texture、内存和动态渲染比例压力测试，再根据结果锁定默认预设。
2. 完成 WebGL Context Lost 恢复、窗口/全屏/分辨率回退和渲染插值，并继续拆分 `src/main.js` 的场景、玩法、音频与 UI 职责。
3. 把动物、无人机和 Boss 逐步替换为可编辑 Blender 资产，为每类资产建立节点契约、动画、LOD、预算和许可清单。
4. 在获得真实 Steam App ID、Steamworks SDK 与发行账号权限后，接入成就、统计、Cloud、Overlay 和 Rich Presence，并保留离线队列与 local-mock 降级路径。
5. 扩展其他区域和正式内容，同步推进签名包、真实 Steam 客户端、Steam Deck、多 GPU/分辨率与外部玩家 QA。

### 仍会阻止 Steam 提审的条件

- 尚未接入 Steamworks SDK 和真实 App ID，成就、统计、Cloud、Overlay、Rich Presence 与排行榜均未在 Steam 客户端验证。
- 尚无正式应用身份、代码签名、发布证书和真实 Windows/Linux/Steam Deck 发布回归。
- 尚未达到 Steam 1.0 的内容量、最终美术/动画/音频/本地化完成度，也未完成外部试玩和全部发布硬门槛。
- 尚未在最低配置 PC 与 Steam Deck 实机确认画质门槛，也未完成两小时性能/内存压力测试、WebGL Context Lost 恢复和完整兼容性矩阵。

## 3. 推荐技术路线

### 桌面封装

首发推荐 Electron 加受控 Steamworks 桥接。

选择理由：

- 最大程度复用现有 Vite、Three.js、DOM UI 与 Web Audio 代码。
- Windows、Linux 和 Steam Deck 的 Chromium/WebGL 行为较一致。
- JS 团队接入手柄、文件存档和 Steamworks 的学习成本较低。
- 代价是包体和内存较大，因此必须设置明确性能预算。

在正式决定前，用 1–2 周技术验证比较 Electron 与 Tauri。若 Tauri 的系统 WebView 在目标 GPU、Steam Deck 和全屏切换上表现稳定，可改用 Tauri；否则锁定 Electron，停止重复选型。

### Electron 安全要求

- 开启 contextIsolation 和沙箱。
- 关闭渲染进程 Node 权限。
- 只通过最小化 preload API 暴露存档、设置和 Steam 功能。
- 禁止生产版开发工具、任意外链导航和远程代码。
- 不携带开发服务器地址、测试 App ID 和源码映射。
- 外部链接交给系统浏览器打开，并使用域名白名单。

### 平台降级

开发环境或 Steam 未启动时，平台桥必须降级为本地模拟：

- 游戏仍能启动、存档和游玩。
- 成就和统计进入本地待同步队列。
- 排行榜和 Overlay 显示不可用状态，而不是阻塞游戏。

## 4. 代码重构目标

建议拆分为以下职责：

- src/core：游戏循环、固定时间步、状态机、事件总线、资源生命周期。
- src/gameplay：炮台、弹药、目标、危险、碰撞、计分、任务目标。
- src/content：动物、弹药、模块、关卡、遭遇和本地化数据。
- src/scenes：主菜单、工坊、区域地图、任务、结算和图鉴场景。
- src/input：键鼠、Gamepad、Steam Input、动作映射和提示图标。
- src/audio：音乐、音效、混音分组和音频设置。
- src/save：档案、迁移、备份、Cloud 冲突和统计。
- src/platform：桌面桥、Steamworks、文件系统和运行环境能力。
- src/ui：菜单焦点、HUD、弹窗、设置和可访问性。
- src/render：Three.js 渲染器、质量预设、对象池、LOD 和后处理。

### 数据驱动要求

- 关卡、动物、弹药、模块和任务目标由 JSON 或 TypeScript 数据定义。
- 设计人员无需修改主循环即可配置新关卡。
- 遭遇使用事件时间线、触发器和固定随机种子。
- 内容数据在构建或加载时进行 schema 校验。
- 缺失资源和错误配置必须在开发版中立即报错。

### 模拟一致性

- 游戏物理采用固定 60 Hz 时间步。
- 渲染可插值，但不得影响炮弹轨迹和碰撞。
- 每局记录种子、版本、难度、配装和关键输入摘要。
- 排行榜模式只接受固定种子和标准化配装。

## 5. 正式存档与 Steam Cloud

### 存档内容

- 战役进度、关卡评价和照护徽章。
- 弹药、模块、外观和图鉴解锁。
- 当前装备的炮台外观；默认免费限定外观的所有权在旧档迁移后仍会保留。
- 玩家统计、成就进度和挑战记录。
- 最近使用的配装和教程状态。

### 存档规则

- 使用带版本号的 JSON 或二进制档案，不再使用 localStorage。
- 写入临时文件后原子替换正式档。
- 保留最近 3 个自动备份和最后一次正常退出备份。
- 启动时校验并提供损坏恢复。
- 每次版本升级都必须有迁移函数和测试样本。
- 关卡结算、解锁、退出和系统挂起前自动保存。
- 删除档案必须二次确认，并允许短期恢复。

### Cloud 范围

同步：

- 战役进度、解锁、徽章、统计和成就队列。

不跨设备同步：

- 分辨率、显示器、画质和设备专属键位。

云冲突界面必须显示时间、完成度和设备来源，不能静默覆盖。

## 6. 手柄与 Steam Input

### 默认布局

- 右摇杆：瞄准。
- 右扳机：蓄力与发射。
- 左右肩键：切换弹种。
- A：确认或二段能力。
- B：返回。
- Start：暂停。
- 左摇杆或方向键：菜单导航。

### 必需能力

- 游戏和全部菜单无需鼠标完成。
- 键鼠与手柄可随时切换，提示图标立即更新。
- 支持 Xbox、DualSense、Switch Pro 和通用 XInput 图标。
- 支持热插拔、断连暂停和重新连接。
- 灵敏度、死区、加速度、反转轴、震动和瞄准辅助可调。
- 键鼠和手柄绑定分别保存，可重映射并恢复默认。
- 提供官方 Steam Input 布局。

## 7. 设置系统

### 显示

- 分辨率与显示器选择。
- 窗口、无边框和全屏。
- VSync、帧率上限和渲染比例。
- 错误显示配置在倒计时后自动回退。

### 图形

- 低、中、高质量预设。
- 阴影、抗锯齿、粒子、环境细节和后处理。
- 动态渲染比例或低配稳定模式。

当前切片已完成低/中/高预设、阴影分级、粒子密度/污渍上限分级、手动渲染比例与可关闭的动态渲染比例。抗锯齿、环境细节、后处理、分辨率/显示器/窗口模式和错误显示配置倒计时回退仍是后续发行设置。

### 音频

- 总音量、音乐、音效、环境和 UI。
- 后台静音选项。
- 输出设备变化后的安全恢复。

### 操作与游戏

- 键位和手柄重映射。
- 灵敏度、死区、反转、震动。
- 弹道线、辅助瞄准、教程提示和镜头震动。

### 辅助与语言

- UI 缩放、高对比、色觉方案、减少闪烁和减少动态。
- 按住或切换蓄力。
- 简体中文和英文。
- 所有文本通过本地化键管理，禁止把装饰性英文硬编码在逻辑中。

## 8. Steamworks 范围

### P0

- Steam 初始化与安全降级。
- 25–30 个成就。
- 全局和关卡统计。
- Steam Cloud。
- Overlay。
- Rich Presence。

### P1

- 经典轮班、试炼或每日挑战排行榜。
- 好友榜优先。
- 固定种子、固定配装和版本字段。

### 原则

- 离线可完整游玩，恢复联网后再同步。
- 成就触发必须幂等，重复启动不能重复或丢失。
- Electron 和 JS 客户端容易被修改，不宣传为严格防作弊竞技游戏。
- 不加入第三方账号、额外启动器或强制联网。

## 9. Steam Deck 目标

目标是申请 Deck Verified，而不是只做到能启动。

- 1280×800、16:10 原生布局，无文字裁切。
- 中画质目标 60 FPS，复杂 Boss 场面至少稳定 40 FPS。
- UI 和字幕在掌机距离下清晰。
- 启动、菜单、玩法、设置、结算和退出均可手柄完成。
- 无外部启动器、浏览器或鼠标必需步骤。
- 正确处理休眠、唤醒、断网、云冲突和手柄断连。
- 默认画质无需玩家手动修复即可流畅。
- Steam Deck 触控板可辅助瞄准，但不能成为必需输入。
- 原生 Linux 与 Windows Proton 均测试；技术验证后决定首发交付一种还是两种。

Valve 最终决定是否通过 Deck Verified，发布前不得自行宣称已认证。

## 10. 性能预算

### 目标

- Steam Deck 1280×800 中画质：平均 60 FPS，1% low 不低于 45 FPS。
- 最低配置 PC 1080p 低画质：稳定 60 FPS。
- 启动到主菜单少于 10 秒。
- 普通关卡加载少于 5 秒。
- 常规运行内存目标低于约 1.2 GB。
- 连续两小时游玩内存不能持续增长。

### 场景预算

- 普通场景少于约 250 draw calls。
- 活动三角面建议控制在 50 万以内。
- 炮弹、粒子、目标、无人机和污渍全部对象池化。
- 重复动物和设施使用 Instancing。
- 环境使用 LOD、烘焙光照、纹理压缩与 Meshopt 或 Draco。
- 远景、阴影和粒子根据质量预设缩放。
- 处理 WebGL Context Lost，能够恢复或安全回到主菜单。

### 本阶段自动预算与验证

当前开发版性能监控使用 10 秒滚动窗口、2 秒预热和 1 秒采样间隔；连续 3 次采样确认后才报告预算超限或恢复。自动诊断门槛为：

- 平均 FPS 不低于 55，1% low 不低于 45，P95 帧时间不高于 24 ms。
- draw calls 不高于 250，活动三角面不高于 500,000。
- geometry 不高于 300，texture 不高于 192，活动实体不高于 600。

本机 localhost 浏览器基线在常规场景约为 60 FPS、1% low 约 56.7 FPS。对象池两轮高频复用与任务/Boss 重启后，创建数和 geometry/texture 均保持平台化；强制 384 个同时活动粒子时能够触发 draw-call 超限告警，回收后产生 recovered 告警。此处是开发阶段机制验证，不等于 Steam Deck 或最低配置 PC 已达标，也不替代两小时内存压力测试。

## 11. 音频与离线资源

- 下载并随包分发获得许可的字体，移除 Google Fonts 运行时请求。
- 所有音乐、音效、图片、GLB、字体和本地化数据随安装包提供。
- 游戏不得因为断网而延迟启动或出现空白字体。
- 音频采用分组混音，暂停、失焦和系统挂起行为一致。
- 为关键音频提示提供同时出现的视觉反馈。

## 12. 自动化测试

### 单元测试

- 弹道、风场、反弹和连续碰撞。
- 计分、连击、稳定度与任务成功失败。
- 弹种、模块和动物行为状态机。
- 奖励、解锁和存档迁移。
- 固定种子的一致性。
- 对象池容量、复用、重置失败和销毁契约。
- 平均 FPS、1% low、帧时间百分位、渲染/内存峰值和预算告警恢复。
- 动态渲染比例的阈值、连续采样、迟滞、冷却、预设边界和禁用回退。
- 炮台外观目录、默认永久解锁、装备持久化、旧档迁移与无效 ID 回退。

### 集成与端到端

- 启动、主菜单、选档、选关、配装、开始、暂停、结算和重试。
- 设置应用、取消、恢复默认和显示回退。
- 手柄导航和设备热切换。
- 存档损坏恢复、Cloud 冲突和离线队列。
- Steam 初始化成功和失败两条路径。

### CI

- 每次提交构建 Web 开发版、Windows 包和 Linux 或 Steam Deck 测试包。
- 发布标签生成签名候选包、校验值和版本说明。
- 每个候选版本必须在真实 Steam 客户端环境做启动冒烟测试。

## 13. 人工 QA 矩阵

### 设备

- Windows 10、Windows 11。
- Intel、AMD、NVIDIA GPU。
- Steam Deck Stable 与 Beta 系统。
- 16:9、16:10、21:9，720p 至 4K。
- Xbox、DualSense、Switch Pro 和通用 XInput 手柄。

### 场景

- 键鼠切换手柄、热插拔和断连。
- Alt+Tab、失焦、窗口恢复、多显示器和 DPI 缩放。
- Steam Overlay、离线启动和恢复联网。
- 休眠、唤醒、Cloud 冲突和强制退出。
- 连续重试、长时间无尽模式和多次存档迁移。

## 14. 发布硬门槛

- 0 个已知 P0 或 P1 缺陷。
- 100% 菜单与玩法可用手柄完成。
- 1000 次存档写入和迁移测试无损坏。
- 2 小时压力测试无明显内存持续增长。
- 至少 30 名外部玩家完成测试。
- 至少 80% 测试者无需人工解释完成序章。
- 所有成就、统计、Cloud、Overlay 和排行榜逐项验证。
- 会话崩溃率目标低于 0.5%。
- Windows、Steam Deck、16:9 和 16:10 均完成发布回归。
- Steam 商店审核和构建审核留出至少两轮修改时间。

## 15. 优先级

### P0：决定游戏是否成立

1. 数据驱动关卡、任务胜负和正式结算。
2. 差异化动物、3 种弹药、3 种危险和一个三阶段 Boss。
3. 工坊选关、配装、评价、解锁和正式存档闭环。
4. 代码模块化、固定时间步、对象池和本地离线资源。
5. 桌面封装、完整手柄、设置和 Steam Deck 基础体验。

### P1：达到商业首发完整度

1. 完整区域和主线内容。
2. 正式音乐、音效、动物动画和叙事包装。
3. Steamworks、成就、统计、Cloud 和排行榜。
4. 中英本地化、完整辅助功能和剩余显示设置；质量预设基础已完成。
5. 外部试玩、性能优化、兼容性和完整 QA。

### P2：发售后评估

- 每日或每周挑战。
- New Game+ 与更多任务词条。
- 免费外观和额外试炼。
- macOS 原生构建。
- 本地双人合作。

不在 1.0 加入联网联机、开放世界、创意工坊、账号系统和赛季运营。

## 16. 6–9 个月生产路线

假设 3–4 名全职成员，并有兼职音频、QA 与宣传支持。

### 第 1 月：预制作与技术切片

- 完成桌面封装和 Steamworks 技术验证。
- 拆分主循环，建立固定时间步、动作输入和数据 schema。
- 实现任务成功失败、稳定度、正式结算和存档原型。
- 制作一个完整湿地代表关。
- 验收：无需修改主循环即可配置新关。

### 第 2–3 月：垂直切片与公开 Demo

- 完成 1 个区域、5 个任务、3 种弹药、3 种危险和 1 个 Boss。
- 完成工坊、选关、配装、评价、解锁和存档闭环。
- 完成手柄、基础设置、正式音效与可发布 UI。
- 第 3 月末产出 30–45 分钟高完成度 Demo。
- 上线 Steam 商店页并开始愿望单积累。

### 第 4–5 月：内容生产

- 完成第二、第三个区域和对应 Boss。
- 其余区域全部达到可通关灰盒。
- 建立动物共享骨架、环境模块和 Boss 机关生产规范。
- 同步完成音乐、动画、叙事简报和本地化。
- 若选择 6 个月缩减版，此时锁定 3 区范围。

### 第 6 月：全内容 Alpha

- 核心功能冻结，不再增加系统。
- 6 个月版进入发布候选。
- 9 个月版完成最后两个区域灰盒。
- 加入经典轮班、试炼和无尽基础版本。

### 第 7 月：Beta

- 完成推荐版全部正式美术与 Boss。
- 全量外部测试，修复教程流失、难度断层和重复感。
- 锁定中英文文本、成就和辅助选项。

### 第 8 月：发布候选

- 性能、Steam Deck、手柄、分辨率、存档和 Steamworks 专项 QA。
- 完成胶囊图、截图、预告片、商店文案和公开 Demo。
- 只接受高优先级修复，不再增加玩法。

### 第 9 月：缓冲与发行

- Steam 审核、最终回归和首日补丁。
- 处理硬件兼容与 Cloud 边界问题。
- 准备首个小型免费挑战包，但不提前承诺长期更新。

## 17. 里程碑退出条件

### 垂直切片通过

- 新玩家愿意连续玩 20–30 分钟。
- 三种弹药都有明确用途。
- 一次完整流程包含选关、配装、任务、失败、结算、解锁和存档。
- Steam Deck 可用手柄完成全部流程并达到稳定帧率。

### Alpha 通过

- 全部主线可从新档通关。
- 不再有临时功能占位和阻断性内容缺失。
- 所有存档版本都有迁移测试。

### Beta 通过

- 内容、文本、成就和本地化冻结。
- 只修缺陷、性能和平衡。
- 外部玩家能独立完成序章和至少一个区域。

### Release Candidate 通过

- 达成全部发布硬门槛。
- Steam 构建、商店素材、许可、隐私说明和支持信息一致。
- Demo 与正式版存档策略经过验证。
