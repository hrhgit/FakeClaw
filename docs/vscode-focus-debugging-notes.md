# VS Code Focus 调试经验

本文记录 `VS Code` 自动化当前采用的定位策略。这里的 `VS Code` 指宿主窗口本身，右下角输入区通常来自 AI 扩展面板，而不是 VS Code 核心编辑器。

## 结论先行

- `VS Code` 不应直接复用 `Cursor` 作为唯一规则。
- 正确做法是先走 `VS Code` 专用定位，再回退到通用右下角规则。
- `VS Code` 的真正稳定目标通常是右侧聊天面板里的输入区，而不是主编辑器、终端输入框或搜索框。

## 当前采用的策略

### 第一层：VS Code 专用定位

优先查找满足以下条件的控件：

- 位于窗口右侧下方
- `ControlType` 属于 `Edit / Document / Group / Pane / Custom`
- 宽度不能大到覆盖整个右侧面板
- 命中以下特征会显著加分：
  - `chat`
  - `agent`
  - `assistant`
  - `copilot`
  - `cline`
  - `roo`
  - `continue`
  - `composer`
  - `prompt`
  - `message`
  - `ask`
  - `textarea`
  - `input`
  - `editor`

同时明确排除：

- `Terminal input`
- `xterm-helper-textarea`
- 搜索框
- Command Palette

### 第二层：通用回退

如果 `VS Code` 专用规则没有找到候选，再回退到共享的右下角候选打分规则。

这样做的原因是：

- `VS Code` 宿主窗口里真正可输入的 AI 面板类型很多。
- 不同扩展的类名未必一致，但“右下角聊天输入区”这一空间假设通常仍然成立。
- 因此要先用扩展相关语义特征缩小范围，再用通用规则兜底。

## 当前假设与风险

当前成立的假设：

- AI 聊天面板位于窗口右侧或右下侧
- 输入区仍然暴露在 UIA 树里
- 输入区描述中仍能看到 `chat / assistant / copilot / agent` 等语义线索之一

仍然存在的风险：

- 如果用户把聊天面板移动到左侧、底部或浮动窗口，专用规则命中率会下降。
- 如果扩展完全不暴露可用 UIA 节点，仍可能退化为通用规则甚至失败。
- 当前策略是“经验型专用规则”，还需要真实 `analyze` 结果继续收敛到具体扩展。

## 一句话原则

`VS Code` 的稳定性取决于扩展聊天面板，而不是宿主 IDE 名称本身；先按扩展语义特征找右下角输入区，再用通用规则保底。
