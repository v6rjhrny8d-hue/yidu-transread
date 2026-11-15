# 译读标准资源包 v1

在「个人 → 词典与发音 → 词典与发音资源」导入 RAR、ZIP、MDX、MDD 或 CSS。0.5.51 增加大文件分块导入、进度与取消；原有译读标准资源包继续可用。StarDict、任意 ONNX 文件仍不支持；整句朗读模型仍使用下方专用 ZIP 格式。

## MDX/MDD 词典与 CSS（0.5.51）

- 支持单卷、未加密的 RAR4 / RAR5（含固实压缩）和 ZIP，按文件头识别；包内放一个 MDX 及同名 MDD。也可先单独导入 MDX，再补导入同名 MDD，支持 `name.1.mdd` 等数字分片命名。数字 MDD 是词典资源拆分，不等于 RAR 多卷压缩。
- 常见 MDict 2.x、zlib/LZO 压缩及 RIPEMD-128 词条索引加密已用自编样本验证。注册保护、正文加密和 MDict 3.x 暂不支持。
- 单个导入文件及单个解压成员最多 1 GiB；整套 MDX/MDD/CSS/图片合计最多 2 GiB、最多 32 个 MDD。RAR/ZIP 解压总计上限 2 GiB；原有标准 JSONL 资源包仍为 120 MiB。超过限制的包需先在外部解压、整理，不能只改后缀。
- 保留原始文件到本地数据库，后台 Worker 建立块索引，查词时按需读取。支持跨压缩块词条、有限深度的 `@@@LINK` 别名；无词条时回退其他词典。
- 支持释义 HTML 排版、词条内 style/行内样式、同名 CSS 和 link 引用的本地 CSS。CSS 可随 RAR/ZIP 与 MDX 一起导入；已有词典也可补导入同名 CSS，例如 `Oxford.mdx` 对应 `Oxford.css`。重复导入内容不同的同路径 CSS 会替换原样式；存在多份同名词典时先停用/删除多余副本后整理导入（停用仍视为同名副本）。不同文件名的附属 CSS 请随原词典打包，保留相对目录。CSS 使用 UTF-8，每个最多 5MiB，最多32个且合计20MiB，随包图片与CSS合计32MiB。
- CSS 与 HTML 经解析后在独立 Shadow DOM 显示，不能改变 APP 的按钮、Dock 或正文。支持常见字体、颜色、间距、列表、表格、flex/grid；不执行脚本，不加载外部网页、网络图片、@import、外置字体或插件，不支持依赖 JS 的折叠/跳转。固定定位、动画等超出释义排版的样式被过滤。无有效 CSS 时沿用文字展示；收藏笔记始终保存纯文字。
- 配套 MDD 或随包本地 PNG/JPEG/GIF/WebP 图片可显示，也可作为 CSS 背景；单图最多2MiB，每词条最多64个/16MiB。MP3/WAV/OGG 可用于单词发音，释义内 sound 链接使用本词的既有朗读入口。没有兼容录音时沿用系统/已选朗读引擎；Speex/其他编解码器暂不支持。
- RAR 解析验证头部与可用的文件 CRC，MDX/MDD 数据块校验 Adler32；拒绝不安全路径、归档链接、重复文件、超限或损坏数据。先验证索引和首个词条/资源再原子启用；后续未读取的坏块可能在查词时才发现并回退。
- 可启用、停用、删除；重启后仍有效，删除同步移除 MDX/MDD 文件。不包含在图书备份中，请保留原始词典包。本版不附送牛津或其他商业词典内容。
- RAR、MDX/MDD 解码在设备本地完成，不上传词典；WebAssembly 及脚本均内置，不从 CDN 加载。大型真实词典、手机上的资源占用与全部第三方版式仍需实际文件验收。


## 大文件导入与存储

采用 File/Blob 分块读取与增量 SHA-256，WORKERFS 按需读取压缩包，64KiB 解压结果写入临时 OPFS，完成后按1MiB转换为独立Blob并原子保存到IndexedDB，不创建整个资源的ArrayBuffer。没有OPFS时使用Blob分块暂存，建议使用更新的Android WebView。解码器自身内存上限512MiB，索引块等内存仍取决于词典，不能由文件上限推断实际峰值内存。

资源卡显示阶段进度，可取消尚未提交的任务。取消终止读取与Worker、中止事务并清理临时文件，已有词典保持可用；下次启动清理异常退出遗留目录。Android系统选择器最初复制文件到私有缓存的阶段不显示这套进度。临时文件、独立Blob及IDB交接需要额外磁盘空间，建议预留输入文件两倍加解压体积三倍的空间用于交接（实际取决于WebView存储实现）。存储空间不足会停止导入并提示。

ZIP限普通单卷未加密store/deflate，不支持ZIP64；RAR密码、分卷等限制保持原样。标准JSONL包仍120MiB；图书、PDF、备份、朗读模型限制独立。

## 词典

ZIP 根目录放 `manifest.json` 和 UTF-8 编码的 `entries.jsonl`。后者每行一个 JSON 词条，不能重复，词头按 Unicode NFKC、去首尾空白、小写处理。

manifest.json：
```json
{"format":"yidu-resource","version":1,"kind":"dictionary","name":"我的英汉词典","language":"en-US"}
```

entries.jsonl：
```jsonl
{"word":"water","phonetic":"ˈwɔːtə","translation":"n. 水；v. 浇水"}
{"word":"book","phonetic":"bʊk","translation":"n. 书；v. 预订"}
```

导入后逐词索引到本机数据库，查询时按词读取，不把整个导入词库常驻内存。可同时保留多个包；启用的包按导入顺序优先匹配，可停用前面的包来切换首选词典；没有收录时沿用内置/在线回退。再次导入相同 ZIP 会拒绝；新版包可另外导入、启用后删除旧版。

## 单词录音

manifest 的 kind 使用 `pronunciation`，其余字段相同。`language` 可标记 `en-GB` 或 `en-US`，名称建议注明英音或美音。

entries.jsonl：
```jsonl
{"word":"water","audio":"audio/water.mp3"}
```

把对应的 MP3、OGG 或 WAV 文件放进 ZIP 的 `audio/` 目录；也允许其他安全的相对路径。每个录音最大 2 MiB。录音包只朗读所收录单词，整句继续交给系统 TTS。只导入你有权使用的词典及录音。

## 约束与恢复

- ZIP 解压后总计最多 120 MiB，最多 100,000 个文件；词条最多 200,000 条。
- 词头最多 200 字符，释义最多 20,000 字符，音标最多 300 字符。
- 包名称最多 120 字符，语言标记最多 30 字符。
- 先校验全部内容，再一次事务启用。错误格式、缺失音频、重复词头、越界路径或数据库写入失败都不会启用半份包。
- 显示大小为资源内容近似大小，不包含数据库内部开销。
- 图书备份不包含资源包；请保留原 ZIP，换设备后重新导入。
- `examples/YiDu-dictionary-demo.zip` 是包含三个自编释义的小型可导入示例，不是完整词典。没有附送录音或语音模型。

## 图书备份 ZIP

图书备份与资源包是两种不同格式。图书备份通过「个人 → 图书备份与恢复」生成，包含 `library.json`，有 PDF 时额外包含 `pdf/<书籍标识>.pdf`。可导出全书架或单本；已有书籍保持不变，先验证再写入数据库。

图书备份解压后总计最多 180 MiB，超出时按单本导出。PDF 原文件需在安卓端导出和恢复。备份包含书籍正文、封面插图、PDF 文件、笔记、阅读标签、各语言译文、阅读进度及按书设置，不包含账号密钥或全局服务配置。请先确认目标设备有足够空间。


## 离线朗读模型 ZIP（0.5.44）

入口：「个人 → 词典与发音 → 离线朗读模型」。支持 sherpa-onnx 1.13.8 的 VITS/Piper ONNX 配置；不接受任意 ONNX、原始 Piper 配置文件或 TAR 包。词典/单词录音与句子模型分别管理，单词录音优先，模型次之，系统朗读为默认及失败回退。

包根目录须包含 `manifest.json`：

```json
{
  "format": "yidu-tts",
  "version": 1,
  "engine": "sherpa-onnx-vits",
  "name": "My English voice",
  "language": "en-US",
  "model": "model.onnx",
  "tokens": "tokens.txt",
  "dataDir": "espeak-ng-data"
}
```

`model`、`tokens` 为包内相对文件；`dataDir` 为可选语音数据目录，Piper 英语模型通常必需。`lexicon` 可选词表文件，`ruleFsts` 可选相对文件数组。路径须对应所选模型的 sherpa-onnx 配置，不可用通用 ONNX 文件代替。默认 CPU 两线程、speaker 0；不支持 Kokoro/Matcha/声纹克隆。本版本 Android ARM64、ARMv7。

压缩包最多180MiB，解压合计300MiB、6000项；校验路径、重复文件与清单后尝试创建引擎，成功才提交。导入后点“试听”确认发声，再点“启用”；支持删除和切回系统。应用退到后台、重新朗读或切模型会取消旧播放；模型不进图书备份，保留原包。

可将官方已解压 VITS/Piper 模型目录封装：

```bash
python3 tools/pack_tts_model.py /path/to/voice voice.zip --model voice.onnx --name "English voice"
```

模型权重及声音许可由提供方决定，本包未附送模型。引擎来自 k2-fsa/sherpa-onnx v1.13.8；依赖许可保留在 assets/licenses，构建依赖可通过 tools/setup_tts.py 以固定SHA256恢复。手机的具体声音、速度、内存和系统播放仍需真机确认。


## 0.5.52 词典显示与口音

词典原始CSS可按词典开关；深色显示根据实际文字/背景对比度调整颜色，保留版式，CSS关闭仍保留净化HTML、图片和录音链接。JavaScript、远程字体/样式与网络音频不会执行或下载。复杂背景图片内嵌文字不能保证自动重绘。

英美口音识别优先使用词条的BrE/NAmE、UK/US、gb/us路径或标签；无法确定的录音不自动冒充所选口音。标准发音包若需要参与英美切换，请将manifest.language明确标为en-GB或en-US。缺失或无法播放指定口音录音时静默回退系统；全部发音失败才提示。系统没有指定口音而使用通用英语时明确标注。弱读/强读分别匹配音标和录音；未知音标不套用英美标签。离线整句模型的口音仍由模型决定。
