# Codex Focus 调试经验

本文只记录 `Codex` 相对通用流程的差异点。共性经验见 [桌面 IDE 自动化通用经验](./desktop-ide-automation-shared-notes.md)。

## 结论先行

- `Codex` 的输入区不是普通 `Edit`，而是底部编辑器容器。
- 当前稳定命中的核心特征是 `ProseMirror` 类名，而不是标准文本框类型。
- 对 `Codex` 来说，优先命中底部 `ProseMirror` 容器，比依赖通用输入框打分更稳定。
- `Codex` 的空间布局更像“主区底部编辑器”，不是 `Cursor` / `Antigravity` 那种右侧聊天栏。

## 本次实际观测

当前稳定命中的输入控件：

- `ControlType.Group`
- `ClassName = ProseMirror` 或 `ProseMirror ProseMirror-focused`

这说明：

- 不能把“找到 `Edit`”当成 `Codex` 成功命中的前提。
- `Codex` 更适合按“底部富文本编辑器容器”建专用规则。

## 本次遇到的关键问题

### 1. `open` 的问题不在启动，而在句柄转换

问题表现：

- `/codex open` 早期返回失败。
- 报错里出现 `Multiple ambiguous overloads found for "new"`。

根因：

- PowerShell 里直接用 `[System.IntPtr]::new(...)` 处理窗口句柄时，触发了重载歧义。

修复方式：

- 改成显式转换：`[System.IntPtr]([int64]$Process.MainWindowHandle)`。

这条经验更偏 PowerShell / Win32 交互层，和具体应用无关，但问题是在 `Codex` 调试阶段暴露出来的。

### 2. 第一版规则误命中了底部结构控件，不是输入区

问题表现：

- `focus` 可能返回成功。
- 但命中的实际是底部结构节点，例如分隔条或无输入能力的容器。

根因：

- `Codex` 底部区域有不少尺寸和位置都“像输入区”的结构控件。
- 如果只按“靠底部、够大、可聚焦”打分，容易把结构元素当成输入区。

修复方式：

- 专用规则只优先查找 `ClassName` 含 `ProseMirror` 的控件。
- 控件类型收窄到：
  - `Group`
  - `Document`
  - `Custom`
- 区域限制为主区底部。

### 3. `Codex` 的正确目标是“编辑器容器”，不是“文本框”

问题表现：

- 用传统桌面输入框思路找 `Edit` 时，结果不稳定。

根因：

- `Codex` 的输入区是富文本编辑器容器，不是标准 Win32 文本框。
- UIA 树里真正可输入的节点未必暴露为 `Edit`。

修复方式：

- 先接受“命中编辑器容器”这个事实。
- 后续输入动作仍然走：
  - 激活窗口
  - 点击容器中心
  - 粘贴
  - 按需发送

## 最终采用的定位策略

### 第一层：Codex 专用定位

直接查找满足以下条件的控件：

- 位于主窗口底部区域
- `ClassName` 包含 `ProseMirror`
- `ControlType` 属于 `Group / Document / Custom`
- 尺寸符合底部输入容器范围

### 第二层：通用回退

如果 `ProseMirror` 容器找不到，再回退到共享文档中的通用候选打分规则。

## 当前已验证结果

- `open` 成功
- `focus` 成功
- `paste` 成功

## 当前假设与风险

当前成立的假设：

- 输入区仍然位于主窗口底部
- 当前版本仍然暴露 `ProseMirror` 容器

仍然存在的风险：

- 如果后续版本更换编辑器实现，`ProseMirror` 特征可能失效。
- 如果布局大改，底部区域限制可能需要重调。

## 一句话原则

`Codex` 不要按“普通文本框”来找输入区，而要按“底部富文本编辑器容器”来找。
