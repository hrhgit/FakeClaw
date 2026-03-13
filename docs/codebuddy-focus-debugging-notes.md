# CodeBuddy Focus 调试经验

本文只记录 `CodeBuddy` 相对通用流程的差异点。共性经验见 [桌面 IDE 自动化通用经验](./desktop-ide-automation-shared-notes.md)。

## 结论先行

- `CodeBuddy` 的聊天输入区位于窗口右侧下方，空间布局假设与 `Cursor`、`Antigravity` 接近。
- 但它当前几乎不暴露可用的 UIA 子树，不能按 `Edit / Document / Group` 之类常规输入控件去命中。
- 对这类应用，稳定方案不是继续堆 UIA 规则，而是改成“窗口激活 + 相对坐标点击 + 粘贴/发送”的坐标兜底。
- 一键校准脚本对 `CodeBuddy` 已改为 `fallbackOnly` 模式：扫不到候选控件时，直接写入右下角点击兜底配置。

## 本次实际观测

当前主窗口进程：

- `ProcessName = CodeBuddy CN`
- `MainWindowTitle = wipeout - CodeBuddy CN`

当前 UIA 根节点：

- `ControlType.Window`
- `ClassName = Chrome_WidgetWin_1`

当前主窗口只暴露了 2 个后代节点：

- `ControlType.Pane / Chrome_RenderWidgetHostHWND / Chrome Legacy Window`
- `ControlType.Pane / Intermediate D3D Window`

这说明：

- `CodeBuddy` 当前版本把主要界面包在渲染表面里。
- 现有 UIA 扫描拿不到真实输入框。
- `composerSearch` 这条基于控件筛选的路线在这里不成立。

## 本次采用的修复策略

### 1. 增加 `codebuddy` 自动化目标

接入位置：

- Node 侧自动化目标枚举与命令解析
- PowerShell 自动化脚本
- 最小化窗口脚本
- 一键校准批处理脚本
- README / `.env.example`

远程指令现已支持：

- `/codebuddy <prompt>`
- `/codebuddy send <prompt>`
- `/codebuddy paste <prompt>`
- `/codebuddy open`
- `/codebuddy focus`
- `/codebuddy screenshot`

### 2. 对 `CodeBuddy` 增加坐标兜底

当前配置写入：

- `targets.codebuddy.clickFallback.xRatio = 0.853`
- `targets.codebuddy.clickFallback.yRatio = 0.84`
- `targets.codebuddy.clickFallback.widthPx = 24`
- `targets.codebuddy.clickFallback.heightPx = 24`

含义：

- 先拿真实窗口矩形。
- 再按相对坐标点击右下角输入区附近。
- `focus / paste / send` 都可复用这条链路。

### 3. 一键校准改为可接受 `fallbackOnly`

当前 `CodeBuddy` 跑校准时不会再因为 `no_candidates_found` 直接失败。

现在的行为是：

- `analyze` 返回 `fallbackOnly = true`
- `calibrate` 会把 `clickFallback` 写回 `config/desktop-automation.config.json`

## 当前验证结果

- `powershell -File .\scripts\calibrate-desktop-automation.ps1 -TargetApp codebuddy -Mode analyze` 成功
- 返回 `fallbackOnly = true`
- `powershell -File .\scripts\codex-automation.ps1 -TargetApp codebuddy -Mode focus` 成功
- 命中信息为：
  - `selectedControlType = CoordinateFallback`
  - `selectedClassName = CoordinateFallback`
  - `bounds = Left 1632.114 / Top 850.92 / Width 24 / Height 24`
- `calibrate-desktop-automation.bat codebuddy calibrate n` 已成功写回配置

## 当前假设与风险

当前成立的假设：

- 聊天面板仍位于窗口右侧
- 输入框仍位于右下角
- 当前点击点落在真实可输入区域内

仍然存在的风险：

- 如果 `CodeBuddy` 改版后把聊天面板挪位置，坐标兜底会偏掉。
- 当前验证覆盖了 `analyze / focus / calibrate`，但没有做真实文本发送，`paste / send` 仍建议你在实际会话里补一次端到端确认。
- 如果后续 `CodeBuddy` 开始暴露真实输入控件，应优先回到 UIA 专用选择器，而不是长期依赖坐标点击。

## 一句话原则

`CodeBuddy` 当前不是“找输入框”的问题，而是“看不到输入框”的问题；这类应用应直接转成坐标兜底自动化。
