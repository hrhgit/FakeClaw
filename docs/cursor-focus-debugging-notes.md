# Cursor Focus 调试经验

本文只记录 `Cursor` 相对通用流程的差异点。共性经验见 [桌面 IDE 自动化通用经验](./desktop-ide-automation-shared-notes.md)。

## 结论先行

- `Cursor` 的自动化布局是典型右侧聊天栏模式，输入框位于窗口右下角。
- 当前稳定命中的真实输入区是标准 `Edit`，不是 `Codex` 那种 `ProseMirror` 容器。
- `Cursor` 的专用选择器应该优先利用“右侧 + 下方 + 聊天输入特征”来缩小范围。
- `Cursor` 的根 UIA 节点 `BoundingRectangle` 不稳定，窗口边界必须优先用 Win32 `GetWindowRect`。

## 本次实际观测

当前主窗口标题：

- `chapter4 - Cursor`

当前稳定命中的输入控件：

- `ControlType.Edit`
- `ClassName = aislash-editor-input`
- `Bounds = Left 1598 / Top 879 / Width 294 / Height 59`

这说明：

- `Cursor` 当前输入区就是右下角聊天输入框。
- 这个输入区适合按标准 `Edit` 处理。
- 与 `Codex` 相比，`Cursor` 更像“侧边聊天面板”而不是“底部主编辑器”。

## 本次遇到的关键问题

### 1. Cursor 多进程里只有少数进程是真主窗口

问题表现：

- `Get-Process Cursor` 能看到很多进程。
- 其中大多数 `MainWindowHandle = 0`。

根因：

- `Cursor` 是典型多进程 Electron 应用。
- 真正能自动化附着的只有承载主窗口的那一个进程。

修复方式：

- 先筛 `MainWindowHandle -ne 0`。
- 再按 `StartTime` 倒序找最新主窗口进程。
- 用标题里包含 `Cursor` 再做一次确认。

### 2. UIA 根节点窗口边界不可信

问题表现：

- 用 `AutomationElement.FromHandle(...)` 拿到根节点后，`BoundingRectangle` 可能返回异常值。
- 后续“右侧 / 下方区域”判断会直接失真。

根因：

- `Cursor` 当前版本的根节点没有稳定暴露可用窗口矩形。

修复方式：

- 用 Win32 `GetWindowRect` 作为窗口边界主来源。
- 只有 Win32 失败时才回退到 UIA 根节点矩形。

### 3. Cursor 的正确思路是“右下角聊天输入框”，不是底部主编辑器

问题表现：

- 按 `Codex` 的底部编辑器思路做 `focus`，早期容易失败。

根因：

- `Cursor` 聊天区在右侧。
- 输入区在右下角，不在主区底部大编辑器位置。

修复方式：

- 增加 `Cursor` 专用右下角选择器。
- 只在这些区域中选候选：
  - 窗口右侧区域
  - 窗口下半部分
- 同时限制候选宽度，避免误命中整个右侧面板背景。

## 最终采用的定位策略

### 第一层：Cursor 专用定位

直接查找满足以下条件的控件：

- 位于窗口右侧
- 位于窗口下半区域
- `ControlType` 属于 `Edit / Document / Group / Pane / Custom`
- 宽度不能大到覆盖整个右侧面板
- 命中以下特征会加分：
  - `composer`
  - `prompt`
  - `chat`
  - `message`
  - `input`
  - `editor`
  - `textarea`
  - `ask`

### 第二层：通用回退

如果 `Cursor` 专用规则找不到目标，再回退到共享文档中的通用候选打分规则。

## 当前已验证结果

- `open` 成功
- `focus` 成功
- `paste` 成功

## 当前假设与风险

当前成立的假设：

- 聊天面板位于窗口右侧
- 输入框位于右下角
- 当前版本仍然暴露 `aislash-editor-input`

仍然存在的风险：

- 如果聊天面板被移动、折叠或改成别的布局，规则可能失效。
- 如果输入控件类名变化，专用规则稳定性会下降。

## 一句话原则

`Cursor` 应视为右侧聊天栏 IDE，先锁定右下角聊天输入区，再做输入动作。
