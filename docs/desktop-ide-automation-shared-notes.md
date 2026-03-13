# 桌面 IDE 自动化通用经验

本文提炼 `Codex`、`Cursor`、`Antigravity` 三类桌面 IDE 自动化里重复出现的通用规律，只记录可复用的方法，不重复写每个应用的专属差异。

## 结论先行

- `open / focus / paste / send / screenshot` 应拆成独立阶段，不要把“拉起应用”和“定位输入框”混成一步。
- Electron 类应用不能只靠进程名判断成功，必须进一步确认 `MainWindowHandle` 和真实主窗口标题。
- UIA 根节点的 `BoundingRectangle` 不是总可信，窗口边界应优先使用 Win32 `GetWindowRect`。
- 输入区定位应优先走“应用专用选择器”，通用打分只做兜底。
- 如果目标应用的 UIA 树只暴露渲染表面而不暴露真实输入控件，就不要继续强堆 UIA 规则，直接准备基于窗口相对坐标的点击兜底。
- `SetFocus()` 只能算辅助动作，真正稳定的链路仍然是“激活窗口 + 点击输入区 + 粘贴 + 按需发送”。
- 调试失败时，截图、命中控件信息、候选控件信息要一起保留，否则很难知道是“没找到窗口”还是“找错了控件”。
- 与窗口尺寸强相关的阈值不要继续硬编码在脚本里，统一放到 `config/desktop-automation.config.json`。

## 推荐流程

### 1. 启动阶段

- 只负责拉起目标应用。
- 如果应用已存在，优先复用现有主窗口。
- 如果 `LaunchCommand` 为空，允许走“只附着已打开窗口”的路径。

### 2. 主窗口确认

- 先筛 `MainWindowHandle -ne 0` 的进程。
- 再按 `StartTime` 倒序优先选最新主窗口进程。
- 用窗口标题或应用名做二次确认，避免误选子进程或无标题窗口。

### 3. 窗口边界获取

- 优先用 Win32 `GetWindowRect` 获取真实窗口矩形。
- 只有 Win32 不可用时才回退 UIA 根节点 `BoundingRectangle`。
- 如果坐标、截图、点击位置总是“差一点”，先查 DPI 和缩放，再怀疑选择器逻辑。

### 4. 输入区定位

- 先走应用专用定位逻辑，利用控件类型、类名、空间区域和尺寸约束缩小搜索范围。
- 找不到专用目标时，再回退通用候选打分。
- 尺寸约束优先使用相对窗口比例，像素值只做下限或上限兜底。
- 通用候选只保留真正可能承载输入的控件类型：
  - `Edit`
  - `Document`
  - `Group`
  - `Pane`
  - `Custom`

## 配置文件

桌面自动化的布局阈值统一放在：

- `config/desktop-automation.config.json`

适合放进配置文件的内容包括：

- 右侧区域起始比例
- 底部区域起始比例
- 输入框最小宽高
- 输入框最大宽高
- 各目标应用专用选择器的尺寸阈值

如果某个人的自定义布局和默认假设差异较大，不要继续改脚本里的硬编码，直接跑校准脚本：

```powershell
powershell -File .\scripts\calibrate-desktop-automation.ps1 -TargetApp cursor -Mode analyze
powershell -File .\scripts\calibrate-desktop-automation.ps1 -TargetApp cursor -Mode calibrate
```

校准脚本的职责边界：

- `analyze`：全量扫描当前窗口 UIA 树，输出候选输入区和推断阈值
- `calibrate`：把目标应用的 `composerSearch` 写回 `config/desktop-automation.config.json`
- 优先更新目标应用专用阈值，不直接覆盖共享区间配置，避免一处校准误伤其他应用

### 5. 噪声控件排除

- 必须显式排除明显不是输入区的控件。
- 常见高噪声节点包括：
  - `Thumb`
  - `Button`
  - `Image`
  - `ListItem`
  - `TabItem`
  - `xterm-helper-textarea`
  - `search`
  - `command palette`

### 6. 实际输入动作

1. 激活主窗口。
2. 定位目标输入区。
3. 尝试 `SetFocus()`，但不把它当成唯一成功条件。
4. 鼠标点击输入区中心。
5. 写剪贴板并执行粘贴。
6. 如果是 `send`，再发送回车。

## 为什么通用规则不能单独承担主流程

- 现代桌面 IDE 大多是 Electron/Chromium 技术栈，UIA 树里会有大量“看起来像编辑器”的节点。
- 只靠通用打分，最容易误命中的是尺寸大、位置对、但功能不对的结构容器。
- 真正稳定的方案不是“更复杂的通用规则”，而是“应用专用规则优先，通用规则保底”。

## 调试时必须保留的观测信息

每次 `focus / paste / send` 失败，至少记录：

- 当前模式：`open / focus / paste / send`
- 目标进程 ID
- 主窗口标题
- 命中的控件类型
- 命中的类名
- 命中的 bounds
- 失败原因分类
- 当前桌面截图

如果还在调规则，建议额外记录：

- 候选控件 Top N
- 是否命中应用专用选择器
- 是否使用 Win32 `GetWindowRect`

## 建议统一的失败分类

- `app_not_found`
- `window_activation_failed`
- `focus_input_failed`
- `focus_input_ambiguous`
- `prompt_required`
- `clipboard_write_failed`
- `paste_failed`
- `send_failed`
- `screenshot_failed`
- `dpi_unaware_capture`

## 一句话原则

对于现代桌面 IDE 自动化，先确认真实主窗口，再用应用特化规则找输入区，最后用点击加粘贴完成输入，不要把纯 UIA 聚焦当成核心前提。
