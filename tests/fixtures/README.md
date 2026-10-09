# 联调媒体样本

与 Server 的 `tests/fixtures` 使用同一组程序生成音频，不使用私人音乐或平台账号。

- 原流：PCM WAV，包含分段频率标记，用于播放、暂停、定位。
- 处理输入：由 Server 样本生成器生成浏览器不支持的格式，须先在目标浏览器实测直放失败，再测试处理后的流。
- 另含零字节、损坏、长时长及版本变化样本；生成参数、许可与 SHA-512 摘要以 Server fixture 清单为准。
- 单元测试 DTO 是明确的 Mock，只证明状态与协议处理，不证明浏览器解码或可听声音。

W0.4 样本种类已选定；具体生成与真实声音验证由 Server/Web 联调记录补齐。

## NCM 合成封装样本

`ncm.ts` 仅在测试临时目录将 Server 的 CC0 `vbr-untagged.mp3` 和 `lossless.flac` 封装为 NCM，不使用私人下载文件或账号凭据，也不调用 Server 自己的 NCM 测试生成器。原始音频不改变；每次生成记录原始/封装 SHA-512、大小和参数。

格式参考为 MIT 授权的 [ncmdump-go](https://git.taurusxin.com/taurusxin/ncmdump-go/src/branch/main/ncmcrypt/ncmcrypt.go) 与 [ncmdump.rs](https://github.com/iqiziqi/ncmdump.rs/blob/master/crates/ncmdump/src/ncmdump.rs)。此处按公开文件布局独立写入：AES-128-ECB/PKCS#7 的密钥及元信息区、NCM 音频字节掩码；固定常量属于文件格式，不是用户凭据。封面帧包含32字节，其中声明图片数据仅4字节，特意验证读取器会跨过整个帧空间再定位音频。

另生成只有截断头部和越界长度的 `corrupt.ncm`。NCM MP3 内含原始样本的2秒静音前缀，真实解码检查会先定位到非静音段；NCM FLAC 使用6秒分段标记，可在4秒定位处核验660Hz标记。封装成功只证明测试数据生成，兼容性须以真实插件、Server与浏览器结果为准。
