# 随心拍素材库 自动下载脚本

推送了以下文件（cookie 和下载内容都不在里面）：

- `downloader.js` — 主脚本
- `config.json` — 配置（cookie 字段留空）
- `package.json`
- `.gitignore` — 排除了 `.env`、`downloads/`、`state.json`

以后换电脑或分享给别人用，只需要新建 `.env` 填入自己的 `PHPSESSID` 即可。

## 使用方法

1. 新建 `.env` 文件，填入你的 session cookie：
   ```
   PHPSESSID=你的PHPSESSID值
   ```

2. 执行一次（下载所有新文件）：
   ```bash
   node downloader.js
   ```

3. 持续监控模式（每 N 分钟自动检查）：
   ```bash
   node downloader.js --watch
   ```

下载的文件会自动按分类整理到 `downloads/` 文件夹下。

## 如何获取 PHPSESSID

1. 打开 **Proxyman**，确保 SSL 解密已开启
2. 打开钉钉，进入「随心拍素材库」小程序，随便滚动一下列表
3. 在 Proxyman 里找到 `xinzhi.aimei.group` 的请求
4. 点击那个请求 → 看 **Request Headers** → 找 `Cookie` 字段
5. 复制 `PHPSESSID=xxxxxx` 里的值

然后更新本地的 `.env` 文件：

```
PHPSESSID=你复制的新值
```
