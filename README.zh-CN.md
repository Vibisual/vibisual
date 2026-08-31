<div align="center">

# Vibisual

### 首个面向 AI 编程代理的可视化开发环境。

</div>

<img src="docs/media/demo.gif" alt="Vibisual 演示 —— hook 事件流入气泡地图，子代理以可视化方式配置" width="100%" />

<div align="center">

在画布上设计你的代理团队，看着它们工作，并就地修改。

*See your AI agents think.*

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Downloads](https://img.shields.io/github/downloads/Vibisual/vibisual/total?label=downloads&color=blue)](https://github.com/Vibisual/vibisual/releases)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](https://nodejs.org)
[![Built with Claude Code](https://img.shields.io/badge/built%20with-Claude%20Code-7c3aed)](https://claude.com/claude-code)
[![Status: early](https://img.shields.io/badge/status-early-orange)](#)

[English](README.md) · 简体中文

</div>

---

## IDE → ADE → VDE

编程代理不打字。它们**行动** —— 读文件、执行命令、派生别的代理。可我们用来观察它们的工具
依然是文本：一个终端、一段对话记录、一张任务清单。

| | 谁写代码 | 你做什么 | 例子 |
|---|---|---|---|
| **IDE** | 你 | **敲**代码 | VS Code、Cursor |
| **ADE** | 代理 | **读**终端 | Warp |
| **VDE** | 一群代理 | **看**地图 | **Vibisual** |

可视化开发环境把代理的工作画成**空间**而不是文本 —— 并且把设计、执行、观察和编辑
留在同一个平面上。

## 它能做什么

### 1. 把运行过程画成实时地图

Claude Code 的 hook 事件 —— 包括 `PreToolUse`、`PostToolUse`、`UserPromptSubmit`
和 `SessionStart` —— 会变成实时画布上的节点。子代理的派生变成连线，工具调用变成子气泡，
被触碰到的文件夹和文件会亮起来。

多代理会话的产物，本质上是一棵树，却被打印成一堵文字墙。Vibisual 在这棵树生长的同时把它画出来。

### 2. 把代理团队设计成一张可视化的图

气泡地图既是运行时视图，**也是**你这套 harness 的设计平面。你不必在文本编辑器里改
`settings.json`，而是在画布上把它搭出来：

- **把代理放成节点。** 往画布上放一个气泡，就定义了一个新的子代理。每个节点带着自己的
  配置 —— 模型、权限模式、工具、隔离方式、最大轮数、思考强度、技能，以及针对该代理的规则。
- **用连线把它们接起来。** 用任务连线连接代理，定义彼此之间的交接与依赖。这些连线就是
  你这套 harness 的控制流图。
- **图本身就是 harness。** 在当前的早期版本里，Vibisual 读取这张图并启动对应的
  Claude Code 子代理工作流。你用来设计的那块画布，就是你看它运行的那块画布。

过去埋在 `settings.json` 深处的那棵树，现在是一条你随时能看见、能改、能重排的工作流。

### 3. 让你不用离开地图就能动手

双击一个气泡，工作区就地展开：代理的实时输出流、文件树、带语法高亮的代码编辑器、diff，
以及一个终端 —— 全部和画布在同一个窗口里。

你来指挥，代理来建造；需要人手的时候，你当场修，而不是切到另一个应用去。

## 完整演示

[![Vibisual —— YouTube 完整演示](https://img.youtube.com/vi/asJ_Z-75uqc/maxresdefault.jpg)](https://youtu.be/asJ_Z-75uqc)

▶ [在 YouTube 上观看 —— 2 分钟演示](https://youtu.be/asJ_Z-75uqc)

## 快速开始

### 安装

Vibisual 运行在 [Claude CLI](https://claude.com/claude-code) 之上，你需要先安装它，
并确保它在 PATH 中可用。

如果你不想自己挑文件，一行就够。两个脚本都只做一件事：从 GitHub 下载已发布的安装包，
交给你系统自己的安装器 —— 运行前建议先读一遍
（[install.sh](scripts/install.sh)、[install.ps1](scripts/install.ps1)）。

```bash
# macOS 与 Linux
curl -fsSL https://raw.githubusercontent.com/Vibisual/vibisual/main/scripts/install.sh | sh
```

```powershell
# Windows
irm https://raw.githubusercontent.com/Vibisual/vibisual/main/scripts/install.ps1 | iex
```

或者从[发布页](https://github.com/Vibisual/vibisual/releases/latest)下载对应平台的安装包：

| 平台 | 文件 | 首次启动 |
|---|---|---|
| Windows (x64) | `Vibisual-<version>-setup.exe` | 直接运行。没有安装向导，装完自动启动。 |
| Debian / Ubuntu / Mint | `vibisual_<version>_amd64.deb` | 双击打开，或 `sudo apt install ./vibisual_<version>_amd64.deb`。依赖会自动解决。 |
| Fedora / RHEL / openSUSE | `vibisual-<version>.x86_64.rpm` | 双击打开，或 `sudo dnf install ./vibisual-<version>.x86_64.rpm`。 |
| 其他 Linux | `Vibisual-<version>.AppImage` | 需要 `libfuse2`，见下文。发行版能装 .deb/.rpm 的话优先用那个。 |
| macOS (Apple Silicon) | `Vibisual-<version>-arm64.dmg` | 需要多执行一条命令，见下文。 |
| macOS (Intel) | `Vibisual-<version>.dmg` | 需要多执行一条命令，见下文。 |

#### macOS —— 应用还没有代码签名

macOS 构建尚未签名，所以 Gatekeeper 会拦下首次启动：你看到的是一个警告框而不是应用。
把 `Vibisual.app` 移到 `/Applications`，然后清除一次隔离属性：

```bash
xattr -cr /Applications/Vibisual.app
```

之后就能正常打开，也不需要再执行第二次。这不是猜测 —— CI 会在真实的 macOS runner 上
下载已发布的 dmg，给它加上浏览器式的隔离属性，确认应用确实被拦下，再确认上面这条命令
能解开它，Apple Silicon 和 Intel 两边都验过。

出于同样的原因，macOS 上的更新是以通知形式送达而不是就地安装 —— 就地更新需要签名。

#### Linux —— 能装 .deb 或 .rpm 就装它

它们和普通软件包一样安装，不需要你做别的：包管理器会把依赖拉齐，Vibisual 会出现在
应用菜单里。

```bash
sudo apt install ./vibisual_<version>_amd64.deb     # Debian、Ubuntu、Mint
sudo dnf install ./vibisual-<version>.x86_64.rpm    # Fedora、RHEL、openSUSE
```

#### Linux —— AppImage 需要 libfuse2

AppImage 是给两种格式都不吃的发行版准备的（Arch、NixOS 之类）。AppImage 用的是 FUSE 2，
而较新的发行版已经不再自带 —— Ubuntu 24.04 只带 FUSE 3，没有 FUSE 2 时文件会立刻退出，
报 `dlopen(): error loading libfuse.so.2`。装一次即可：

```bash
sudo apt install libfuse2t64      # Ubuntu 24.04+ —— 22.04 及更早叫 "libfuse2"
chmod +x Vibisual-<version>.AppImage
./Vibisual-<version>.AppImage
```

如果你什么都不想装，也可以把它解开来跑。`AppRun` 从 `APPDIR` 读取自身位置，平时这个变量
由 AppImage 运行时填好，所以跑解压版时需要你自己设：

```bash
./Vibisual-<version>.AppImage --appimage-extract
APPDIR="$PWD/squashfs-root" ./squashfs-root/AppRun
```

### 从源码构建（贡献者）

```bash
git clone https://github.com/Vibisual/vibisual.git
cd vibisual
pnpm install

# 先构建所有包，再启动桌面应用
pnpm build
pnpm --filter @vibisual/desktop preview

# 构建对应平台的安装包
pnpm build:win     # 也可以是 build:mac、build:linux
```

### 关于 hook 安装器

首次启动时，Vibisual 会往 `~/.claude/settings.json` 写入一段受管理的 hook 配置，
好让 Claude CLI 的会话能流进气泡地图。原文件会带时间戳备份在旁边
（`.bak-vibisual-*`）。如果你想自己接线，在首次启动前设置
`VIBISUAL_SKIP_HOOK_INSTALL=1`。

面向 Windows、macOS（Apple Silicon 与 Intel）和 Linux 发布的安装包，都会在对应操作系统
的真实 runner 上被下载、安装并启动，所以三个平台都确认过能起来。日常开发在 Windows 上进行。

## 状态

Vibisual 目前是早期预览版。这条 0.1.x 线适合用来尝试、演示和提反馈：请预期会遇到 bug、
未完成的功能、粗糙的边角，以及偶尔的破坏性变更。需要一个不再变动的版本，就把版本号钉住。

**主要在 Windows 上测试。** 日常开发都在 Windows 上进行，所以 macOS 和 Linux 上手实测的
机会少得多。如果在这两个平台上遇到问题，请
[提一个 issue](https://github.com/Vibisual/vibisual/issues/new) —— 我们会尽快修。

它完全跑在你自己的机器上 —— 没有账号，没有遥测，也不会把任何东西发给我们 —— 所以拿它
对着什么由你决定，你的代码不会因为试用它而离开这台机器。

## 安全与隐私

Vibisual 通过 Claude Code hooks 来可视化代理活动。hook 载荷中可能包含提示词、工具调用、
文件路径、shell 命令、会话元数据，以及其他本地开发上下文。

在把 Vibisual 对准含有密钥、凭据、私有代码、客户数据或生产环境访问权限的仓库之前，
请先检查生成的 hook 配置 —— 就像你审视任何一个代你执行命令的工具那样。

Claude Code 的命令 hook 以你本地用户账户的权限运行。只安装和运行你信任的代码里的 hook。

Vibisual 不收集任何东西 —— 没有账号，没有遥测，没有分析，也没有崩溃上报。
[PRIVACY.md](PRIVACY.md) 逐条列出了什么会离开你的机器、在什么时候；
[SECURITY.md](SECURITY.md) 说明了安全模型，以及如何私下报告漏洞。

## 定价

桌面应用 —— 画布、IDE、代理、插件 —— 安装即用，不需要账号，不需要许可证密钥，
也没有用量上限，遵循 Apache-2.0。

之后可能会有付费的增值部分：额外的算力额度、跑在你自己机器之外的工作、为团队做的功能。

## 许可证

Apache License 2.0 —— 见 [LICENSE](LICENSE)。"Vibisual" 与 Vibisual 标志是
길근오（项目所有者）的商标；政策见 [TRADEMARK.md](TRADEMARK.md)。

## 参与贡献

提交贡献即表示你同意 DCO 签署要求，以及 [CONTRIBUTING.md](CONTRIBUTING.md) 中描述的
附加贡献条款，其中包括允许项目所有者为将来的商业产品对贡献进行再许可。

## 免责声明

Vibisual 是一个独立的开源项目，与 Anthropic 无关联、未获其背书、也未受其赞助。

Claude、Claude Code 和 Anthropic 是 Anthropic, PBC 的商标或注册商标。
所有产品名称、标志和品牌均为其各自所有者的财产。
