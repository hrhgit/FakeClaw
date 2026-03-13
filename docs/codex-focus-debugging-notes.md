# Codex Focus 调试经验

本文总结本项目在调试 Codex 桌面端 `focus / paste / send` 自动化时踩过的坑，目标是为后续 IDE 自动化流程提供可复用的方法。

## 结论先行

- `open`、`focus`、`paste`、`send` 应该拆成独立阶段，不要把“启动应用”和“定位输入区”混在一起。
- Electron/Web 技术栈中的输入区不一定暴露为 `Edit`，不能把“找到 `Edit` 控件”当成默认前提。
- 对富文本编辑器类控件，不要依赖 `UIA SetFocus()` 作为唯一成功条件；“激活窗口 + 点击输入区 + 粘贴/发送”通常更稳定。
- 如果目标应用特征明显，应优先走“应用特化定位”；通用 UIA 打分只能作为回退。
- 截图、控件树枚举、候选打分、实际命中的控件信息必须保留，否则失败时无法定位问题。

## 本次 Codex 的实际情况

在 Codex 桌面端中，真正可用的输入区并不是传统文本框，而是底部输入区域中的一个：

- `ControlType.Group`
- `ClassName = ProseMirror` 或 `ProseMirror ProseMirror-focused`

这意味着：

- 不能只搜索 `ControlType.Edit`
- 不能默认 UIA 能像 Win32 文本框那样稳定聚焦
- 需要把底部编辑器容器当成主要目标，而不是只依赖“可聚焦控件评分”

## 这次碰到的具体问题

### 1. `open` 失败不是启动失败，而是句柄转换失败

问题表现：

- `/codex open` 返回失败
- 错误信息为 `Multiple ambiguous overloads found for "new" and the argument count: "1".`

根因：

- PowerShell 中使用 `[System.IntPtr]::new($Process.MainWindowHandle)` 时触发了构造函数重载歧义

修复方式：

- 改为显式转换：`[System.IntPtr]([int64]$Process.MainWindowHandle)`

经验：

- PowerShell 调 Win32 或 UIA 时，句柄、坐标、宽高尽量显式转成 `int64/int/IntPtr`
- 不要过度依赖 `.new(...)` 构造语法

### 2. `focus` 一开始误选了分隔条而不是输入区

问题表现：

- `focus` 返回成功，但实际选中的是底部一个 `Thumb`
- 后续 `paste/send` 会失效或行为异常

根因：

- 通用打分策略把“靠近底部、可聚焦、宽度很大”的控件误判为输入区
- 底部面板分隔条正好满足其中一部分特征

修复方式：

- 显式排除这些噪声节点：
  - `Thumb`
  - `Button`
  - `Image`
  - `ListItem`
  - 终端隐藏输入框 `xterm-helper-textarea`
- 将候选类型收窄到真正可能承载编辑器的控件：
  - `Edit`
  - `Document`
  - `Group`
  - `Pane`
  - `Custom`

经验：

- 不能只做“加分”，必须做“强排除”
- IDE 自动化里最容易误命中的不是随机控件，而是“尺寸大、位置对、但功能不对”的结构控件

### 3. 通用评分仍然会被说明文本节点污染

问题表现：

- 候选打分里出现了很多带 `ProseMirror/composer/editor` 字样的文本节点
- `focus` 被判成 `focus_input_ambiguous`

根因：

- UIA 树里会出现大量可读文本节点，名称刚好包含调试输出或界面说明内容
- 如果把 `Text` 一类节点也纳入候选，就会和真正输入区一起上榜

修复方式：

- 候选集合只保留可交互容器类型
- 对同一区域重叠节点做去重

经验：

- UIA 自动化里“文本内容像目标”不等于“控件就是目标”
- 选择器优先级应该是：
  - 控件类型
  - 类名 / AutomationId
  - 区域位置
  - 尺寸
  - 文本特征

## 最终采用的定位策略

### 第一层：应用特化定位

对 Codex 直接查找：

- 主窗口右侧主区域
- 底部 35% 区域内
- `ClassName` 包含 `ProseMirror`
- 控件类型限定为 `Group / Document / Custom`
- 宽高满足输入区尺寸约束

只要命中该容器，就直接作为目标输入区。

### 第二层：通用回退

只有在第一层找不到目标时，才退回通用评分策略：

- 只在 `Edit / Document / Group / Pane / Custom` 中找候选
- 对 `Thumb / Button / Image / ListItem / xterm-helper-textarea` 做强排除
- 对根容器、大型背景容器做降权

经验：

- “应用特化优先，通用回退保底” 比“完全通用”更适合桌面 IDE 自动化
- 现代 IDE/桌面 AI 客户端大多是 Electron，完全通用的 UIA 规则通常不够稳定

## 最终采用的动作策略

最终没有把 `SetFocus()` 当成唯一动作，而是使用：

1. 激活窗口
2. 定位输入区 bounds
3. 尝试 `SetFocus()`，但不把它当成成功判断
4. 直接鼠标点击输入区中心
5. 进行粘贴
6. 如果是 `send` 模式，再发送回车

经验：

- 对富文本编辑器，点击通常比 UIA 聚焦更接近真实用户行为
- “用户行为模拟”在 Electron 编辑器里往往比“纯 UIA API 调用”更稳定

## 调试时必须保留的观测信息

建议每次自动化失败都至少记录：

- 当前模式：`open / focus / paste / send`
- 目标进程 ID 和窗口标题
- 实际命中的控件类型
- 实际命中的类名
- 控件 bounds
- 失败原因分类
- 当前桌面截图

如果还在调试阶段，建议额外保留：

- UIA 控件树枚举结果
- 候选评分明细
- 是否命中应用特化选择器

经验：

- 没有截图和命中控件信息时，`focus_input_failed` 这种错误几乎没有排查价值

## 截图问题的额外经验

这次调试里还顺手修到了截图只截左上角的问题。

根因：

- 进程未声明 DPI awareness
- 在 125% 缩放桌面上，脚本拿到的是逻辑分辨率 `1536x864`
- 实际屏幕是物理分辨率 `1920x1080`

修复方式：

- 截图脚本启动时先设置 DPI awareness
- 优先使用 `per-monitor-v2`

经验：

- 任何桌面自动化项目都要尽早处理 DPI
- 如果坐标、截图、窗口 bounds 看起来都“差一点”，先查缩放和 DPI，而不是先怀疑识别算法

## 推荐的 IDE 自动化流程模板

后续做其他 IDE 时，建议统一采用下面这套流程：

### 阶段 1：应用启动

- 只负责启动应用并激活主窗口
- 不在这个阶段处理输入框定位

### 阶段 2：窗口确认

- 根据进程名、窗口标题、主窗口句柄确认真正主窗口
- 避免误选子进程或无标题窗口

### 阶段 3：特化输入区定位

- 优先使用应用特征：
  - 类名
  - AutomationId
  - 固定区域
  - 编辑器框架特征

### 阶段 4：通用回退

- 特化定位失败后，再做通用 UIA 候选筛选和打分

### 阶段 5：输入动作

- 激活窗口
- 点击输入区
- 粘贴
- 按需发送

### 阶段 6：结果验证

- 截图
- 记录命中控件
- 记录失败分类

## 建议的失败分类

后续可以统一输出这些错误码，便于流程编排和重试：

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

对于 Codex、Cursor、Windsurf、Trae 这类现代桌面 IDE：

- 先找“编辑器容器”
- 再做“点击 + 粘贴”
- 最后才把 UIA 聚焦当成辅助能力，而不是核心前提
