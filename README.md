# Obsidian Link

使用 Vault 里的 .link 文件作为界面快捷方式。点击文件时，将当前标签页切换为绑定的 Obsidian 视图（或执行指定命令），而不是打开 Markdown 中间页面。

## 功能

- 将当前打开的 Obsidian 视图或插件视图保存为 .link 文件。
- 从已打开的视图、已注册的视图类型、插件命令、Vault 文件中选择目标；也可手动输入视图类型。
- 点击 .link 自动打开目标；右键创建与编辑；支持原生文件管理器及 Notebook Navigator 的独立菜单 API。
- 文件是可移植 UTF-8 JSON 文本，位于 Vault 任意目录，可随 Synchrun 等同步工具同步。

## 安装

推荐通过 BRAT 添加 GitHub 仓库 Pycnocline/obsidian.link。推送主分支后 GitHub Actions 将测试、构建并发布包含 main.js、manifest.json、styles.css 的 Release。也可以从 Release 下载这三个文件放进 Vault 的 .obsidian/plugins/obsidian-link/ 目录，重启或重新加载插件后启用。

## 使用

1. 打开命令面板，执行“Obsidian Link: 为当前界面创建快捷方式”，或“创建界面快捷方式”。
2. 选择目标，填写文件名和目录，保存。
3. 在 Obsidian 文件浏览器或 Notebook Navigator 中点击新建的 .link 文件。

.link 文件示例：

~~~json
{
  "format": "obsidian-link",
  "version": 1,
  "target": { "kind": "view", "viewType": "some-plugin-view", "state": {} }
}
~~~

目标还支持命令方式 { "kind": "command", "commandId": "plugin:open" }，文件方式 { "kind": "file", "path": "笔记/首页.md" }。

## 兼容性说明

- 使用 WorkspaceLeaf API 直接切换视图。插件视图状态的还原准确度取决于插件本身实现的 getState/setState。
- 没有注册视图类型但有打开命令的插件，可用命令快捷方式启动。Obsidian 未公开跨插件命令执行接口，版本兼容性需实际测试。
- .link 文件保存视图状态，可能含其他插件的私有字段，请勿将包含敏感状态的文件发布到不可信位置。
- 手机端要求目标插件支持移动端。找不到目标时显示可修复的错误界面。
- Notebook Navigator 的文件类型过滤请选择“Supported (opens in Obsidian)”或“All”；若前者过滤 .link，请改用 All。
- 若其他插件同时注册 .link 扩展名，请解除冲突。

## 开发

Node.js 20+，依次运行 npm ci、npm run check。主分支推送后 GitHub Actions 自动发布与 manifest 版本匹配的 BRAT Release。MIT License。
