# 译读小更新包：修订2

更新目标为译读0.5.61 / versionCode82。助手0.5.61.1 / versionCode83，沿用修订2安装核心，从精确原签名0.5.60还原完整0.5.61。

1. 覆盖安装新版更新助手，打开“译读更新助手”，点“准备更新”。
2. 点击安装译读；如需允许安装来源，授权并返回后会自动继续，不再停留在刷新按钮。
3. 在系统页面确认安装。返回助手后核验译读实际版本、包名、原证书和目标APK摘要，核验通过才能显示完成并打开译读。
4. 系统取消、冲突、空间不足或拒绝安装会显示对应状态。可点“复制更新诊断”反馈；也可直接用原签名完整包覆盖安装译读，无需卸载译读或清除数据。完成后可卸载助手。

助手包名app.lumi.reader.update，与主程序app.lumi.reader不同；仅安装助手或授予安装权限不会改变译读版本。已有新版译读不会降级。准备缓存约需一个完整APK大小，系统安装另需空间。助手不读取图书、笔记或主程序私有数据，无网络或存储权限。

## 实现与验证

Delta流式还原并验证基础/目标SHA256、尺寸、指令边界和gzip完整性，失败清理输出。目标包名/版本/证书再次验证后才交给系统。

修订2使用PackageInstaller.Session：完整写入、fsync、关闭输出后commit。系统结果通过显式、未导出的InstallStatusReceiver接收，绑定随机nonce、会话ID和包名。target35回调必须可变，因此PendingIntent明确锁定私有receiver；不会用隐式可变Intent。旧ApkProvider和临时文件URI授权已移除。

STATUS_PENDING_USER_ACTION只提取经验证的系统、exported组件，检查固定CONFIRM_INSTALL动作与会话；前台Activity重新创建仅含固定动作/组件/会话ID的确认Intent，不转发原始嵌套Intent、URI授权或任意extras。安装结果和实际已安装译读核验分开，成功状态本身不等于安装已生效；取消/错误可恢复，授权返回只继续一次。

构建前通过环境变量提供签名参数。导出 `TRANSREAD_SIGNING_KEYSTORE`（密钥库路径）、`TRANSREAD_SIGNING_KEY_ALIAS`（密钥别名）、`TRANSREAD_SIGNING_STORE_PASSWORD` 和 `TRANSREAD_SIGNING_KEY_PASSWORD`。现有完整 APK 不变时运行 `bash updater/build.sh`。主程序发生变化才先bash build.sh，随后必须重建补丁/助手，不能混发不同字节的完整包与助手。助手版本独立于目标版本。

测试：test/update-core-0555.py为生产Delta和一份真实签名APK还原21项；test/update-session-r2.py为生产会话/回调/持久状态/授权恢复46项。test/update-provider-0555.py保留旧命令入口，转调新版会话测试；旧Provider29项仅为历史证据。详细安全范围和diff见test/update-security-r2.md。

没有实体Android设备，本轮不声称OEM授权页、系统安装确认与最终覆盖安装已真机通过；46项宿主测试的Android替身只验证明确的调用边界和逻辑。完整包保留作为备用。
