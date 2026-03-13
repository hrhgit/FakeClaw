# Antigravity Focus 调试经验

本文只记录 `Antigravity` 相对通用流程的差异点。共性经验见 [桌面 IDE 自动化通用经验](./desktop-ide-automation-shared-notes.md)。

## 结论先行

- `Antigravity` 的自动化布局更接近 `Cursor`，聊天面板在窗口右侧，输入框在右下角。
- 但它不能直接照搬 `Cursor` 规则，因为实际输入控件类名不同。
- `Antigravity` 当前命中的真实输入区是一个 `ControlType.Edit`，不是 `Codex` 那种 `ProseMirror` 容器。
- 如果只复用右下角通用打分，容易误命中输入框上方的 `Group` 行容器。

## 本次实际观测

当前主窗口标题：

- `wipeout - Antigravity - build-release.ps1`

当前稳定命中的输入控件：

- `ControlType.Edit`
- `ClassName = max-h-[300px] rounded cursor-text overflow-y-auto text-md p-2 outline-none transition-all duration-100 text-sm`
- `Bounds = Left 1562 / Top 896 / Width 341 / Height 43`

占位提示文本：

- `Ask anything, @ to mention, / for workflows`

这说明：

- `Antigravity` 的输入区是右下角聊天输入框。
- 这个输入框暴露为标准 `Edit`，并同时具备 `ValuePattern` / `TextPattern`。
- 与 `Cursor` 相比，`Antigravity` 更适合先精确找右下角 `Edit`，再回退到通用右下角候选规则。

## 本次遇到的关键问题

### 1. 第一版规则命中了右下区域里的错误 `Group`

问题表现：

- `focus` 返回成功。
- 但实际命中的不是输入框，而是输入框上方的一条 `Group` 容器。

实际误命中控件：

- `ControlType.Group`
- `ClassName = px-2 py-1 flex items-center justify-between cursor-pointer hover:bg-gray-500/10`
- `Bounds = Left 1551 / Top 844 / Width 358 / Height 34`

根因：

- 这个控件同样位于右下区域。
- 它的尺寸和位置满足通用候选打分条件。
- 仅靠“右侧 + 下方 + 尺寸合适”不足以唯一标识真正输入区。

修复方式：

- 给 `Antigravity` 增加专用 `Find-AntigravityComposer`。
- 只接受 `ControlType.Edit`。
- 增加更严格的区域和尺寸限制：
  - 位于窗口右侧
  - 位于窗口底部约 30% 区域
  - 宽度、高度落在输入框合理区间
- 优先要求可键盘聚焦，且至少支持 `ValuePattern` 或 `TextPattern`。

### 2. `Antigravity` 不是 `Cursor`，但又比 `Codex` 更像 `Cursor`

问题表现：

- 从界面结构看，`Antigravity` 很像右侧聊天栏模式。
- 但直接复用 `Cursor` 的经验描述仍然不够精确。

根因：

- `Cursor` 当前观测到的命中控件类名是 `aislash-editor-input`。
- `Antigravity` 当前观测到的命中控件类名是 `max-h-[300px] rounded cursor-text ... text-sm`。
- 两者布局相似，但目标控件的标识特征不同。

修复方式：

- 共享“右下角聊天输入框”这一空间假设。
- 不共享具体控件类名判断。
- 在专用规则里为 `Antigravity` 单独记录它自己的 `Edit + className` 特征。

## 最终采用的定位策略

### 第一层：Antigravity 专用定位

直接查找满足以下条件的控件：

- `ControlType = Edit`
- 位于窗口右侧
- 位于窗口底部区域
- 宽高落在聊天输入框合理范围
- 不属于终端输入、搜索框、命令面板
- 最好具备：
  - `IsKeyboardFocusable = true`
  - `ValuePattern = true`
  - `TextPattern = true`

### 第二层：复用右下角通用回退

如果专用定位失败，再回退到与 `Cursor` 同类的右下角候选规则。

这样做的原因是：

- `Antigravity` 和 `Cursor` 确实共享右侧聊天布局。
- 但 `Antigravity` 的正确命中目标更窄，应该先精确后宽松。

## 当前已验证结果

- `open` 成功
- `focus` 成功
- 已命中右下角真实输入控件

本次 `focus` 返回的命中信息：

- `selectedControlType = ControlType.Edit`
- `selectedClassName = max-h-[300px] rounded cursor-text overflow-y-auto text-md p-2 outline-none transition-all duration-100 text-sm`
- `bounds = Left 1562 / Top 896 / Width 341 / Height 43`

## 当前假设与风险

当前成立的假设：

- 聊天面板位于窗口右侧
- 输入框位于右下角
- 当前版本仍然暴露该 `Edit` 控件

仍然存在的风险：

- 如果右侧聊天面板被移动、折叠或改成别的布局，规则可能失效。
- 如果后续版本改掉输入框类名或控件类型，专用规则需要重调。
- 当前只验证了 `open` 和 `focus` 的命中正确性，`paste / send` 虽然会复用同一路径，但仍建议在真实会话里补一次端到端验证。

## 一句话原则

`Antigravity` 应视为“右侧聊天栏 IDE”，但不要偷懒直接复用 `Cursor` 的控件特征；共享布局假设，分开控件选择器。
