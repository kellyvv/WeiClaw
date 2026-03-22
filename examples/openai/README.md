# OpenAI Codex 示例

通过 Codex CLI 调用（账号登录，不需要 API key）。

## 前置

```bash
npm install -g @openai/codex
codex login
```

## 用法

```bash
node server.mjs
```

然后：

```bash
npx wechat-to-anything http://localhost:3001/v1
```

微信发消息 → Codex 回复。
