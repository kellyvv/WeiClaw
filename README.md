# wechat-to-anything

> 在微信里用 Claude Code 写代码

```
你 (微信) → "帮我写个排序算法"
Claude Code  → 生成代码、解释、调试
```

## 快速开始

```bash
npx wechat-to-anything
```

填入 Anthropic API Key → 扫码登录微信 → 在微信里直接和 Claude Code 对话。

## 它做了什么

```
微信消息 ←→ OpenClaw Gateway ←→ Claude Code
```

[OpenClaw](https://openclaw.ai) 是开源 AI 网关，[微信 ClawBot](https://github.com/nicepkg/openclaw-weixin) 是微信接入插件。

`wechat-to-anything` 把这些配置自动化成一条命令，让你在微信里就能：

- 💬 用自然语言让 Claude Code 写代码
- 🐛 发一段报错信息，Claude Code 帮你调试
- 📖 问任何编程问题，得到专业回答

## 为什么叫 "to-anything"

Claude Code 只是第一个示例。同样的方式可以连接任何 AI Agent：

```bash
# 未来支持
npx wechat-to-anything --agent deepseek
npx wechat-to-anything --agent ollama
npx wechat-to-anything --agent dify
```

## License

[MIT](LICENSE)
