# OpenAI Codex 示例

通过 Codex CLI 调用（账号登录，不需要 API key）。支持图片识别。

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

## 功能

- **文字对话**：微信发文字 → Codex 回复
- **图片识别**：微信先发图片，再发问题 → Codex 看图回答（gpt-5.4）
- **账号登录**：通过 `codex login` 登录，使用 Plus 订阅额度

## 技术细节

- 使用 `codex exec` 非交互模式
- 图片通过 `-i <file>` 参数传入
- 回复通过 `-o <file>` 输出（避免 stdout 被进度信息污染）
- 加速参数：`--skip-git-repo-check --ephemeral`
