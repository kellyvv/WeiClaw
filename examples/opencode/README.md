# OpenCode + wechat-to-anything

## 前置条件

```bash
# 安装 OpenCode (任选一种)
brew install anomalyco/tap/opencode
# 或
npm i -g opencode-ai
```

然后配置 AI provider，参考 [opencode.ai/docs](https://opencode.ai/docs)。

## 启动

```bash
# 终端 1: 启动 OpenCode HTTP 服务
node server.mjs

# 终端 2: 启动微信桥
npx wechat-to-anything http://localhost:3000/v1
```

完成！微信消息会自动转发给 OpenCode，回复会发回微信。
