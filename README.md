# 译读 YiDu｜安卓外文阅读与翻译

译读是一款 Android 阅读应用，将电子书阅读、点词查释义、翻译和笔记放在一起，帮助你边读边理解。

**仓库下载版本：0.5.61** · Android 应用 · 支持简体中文、繁体中文和英文界面

开发接续与已交付版本见 [项目记忆](PROJECT-MEMORY.md)。自动化开发工具入口见 [AGENTS.md](AGENTS.md)。

## 下载

- **[下载 0.5.61 安卓安装包 APK](https://github.com/v6rjhrny8d-hue/yidu-transread/raw/refs/heads/main/releases/YiDu-0.5.61.apk)**
- **[下载 0.5.61 原始源码 ZIP](https://github.com/v6rjhrny8d-hue/yidu-transread/raw/refs/heads/main/releases/TransRead-0.5.61-source.zip)**

### 0.5.57 历史下载

- **[下载 0.5.57 安卓安装包 APK](https://github.com/v6rjhrny8d-hue/yidu-transread/raw/refs/heads/main/releases/YiDu-0.5.57.apk)**
- **[下载 0.5.57 原始源码 ZIP](https://github.com/v6rjhrny8d-hue/yidu-transread/raw/refs/heads/main/releases/TransRead-0.5.57-source.zip)**

下载后在 Android 手机上打开安装。覆盖更新需要安装包与现有版本签名一致；请先备份重要图书和笔记。

## 应用截图

以下为 0.5.57 在 Android 模拟器中的真实运行截图，显示首次使用状态。

| 书架 | 个人设置 | 使用指南 |
| --- | --- | --- |
| ![书架](docs/screenshots/home.png) | ![个人设置](docs/screenshots/profile.png) | ![使用指南](docs/screenshots/guide.png) |

## 功能

- 导入 EPUB、TXT 和 PDF 阅读；保存阅读位置，整理书架。
- 点词查释义、朗读，使用笔记保存词句；支持本地词典和发音资源导入。
- 支持在线翻译和自定义翻译服务，具体可用性取决于网络及所选服务。
- 六套主题、深浅色模式，以及字体、行距等阅读偏好。
- 支持图书和笔记备份恢复。资源包要求见 [资源说明](RESOURCE-PACKS.md)。

EPUB、TXT 文件上限为 30 MB，PDF 上限为 100 MB；不支持带 DRM 保护的书籍。部分词典和语音资源需自行导入，实际兼容性取决于资源格式。

## 开发

项目由 Web 界面和 Android 原生组件组成。开发与构建细节见 [0.5.61 开发记录](DEVELOPMENT-STATE.md)、[历史说明](docs/README-HISTORY.md) 和 [资源包说明](RESOURCE-PACKS.md)。源码包不含原签名密钥，重新签名的版本不能直接覆盖原签名应用。

0.5.61 APK SHA-256：`7a4776443ac98f091ba31ef173dea64aa77583fb1f6a4fb5762b1c580902776a`

截图来自 0.5.57 模拟器。0.5.61 的变更和测试记录见下方及 [变更日志](CHANGELOG.md)。

## 0.5.61 · 2026-11-17

- 切换查词目标时复用打开的释义卡。新单词可见且卡片仍在安全区内时，只换词头、释义及高亮，保留卡片坐标与展开状态，避免重复播放入场动画。
- 新选词确实被遮挡时继续避让，较早发起的查词结果不会覆盖当前词条。

## 0.5.60 · 2026-11-17

- 拖动句子选区时复用底部「收录句子」按钮，去掉玻璃容器的位移与淡入淡出。取消选区、收录或离开阅读页时清除按钮。
- 玻璃底色、模糊强度和文字颜色跟随当前主题。六套主题的浅色与深色均核对实际模糊像素和文字对比度。

## 0.5.59 · 2026-11-17

- Google 查词卡默认展示 ECDICT 和已启用的 Free Dictionary 所有可用义项及例句，去除「更多词典释义」折叠按钮。在线失败时保留本地释义和重试入口。
- 「本句用法」点开后才发送当前句进行翻译。

## 0.5.58 · 2026-11-17

- 增加可选的 Free Dictionary 在线录音回退。默认关闭，开启后按本地录音、同口音在线录音、系统发音顺序尝试。在线查找和启动播放共用 3.5 秒等待上限。
- Google 查词卡增加「本句用法」和「更多词典释义」。按需翻译点击词所在的句子，按来源显示本地义项及 Free Dictionary 补充释义和例句。
