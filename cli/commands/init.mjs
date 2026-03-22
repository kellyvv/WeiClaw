import * as p from "@clack/prompts";
import pc from "picocolors";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

export default async function init({ root }) {
  console.log();
  p.intro(pc.bgCyan(pc.black(" 🌉 wechat-to-anything → Claude Code ")));

  const apiKey = await p.text({
    message: "输入你的 Anthropic API Key",
    placeholder: "sk-ant-...",
    validate: (v) => {
      if (!v || v.trim().length === 0) return "API Key 不能为空";
    },
  });

  if (p.isCancel(apiKey)) {
    p.cancel("已取消");
    process.exit(0);
  }

  const s = p.spinner();
  s.start("正在生成配置...");

  const outDir = resolve(root, ".wechat-to-anything");
  await mkdir(outDir, { recursive: true });

  await writeFile(
    resolve(outDir, ".env"),
    `ANTHROPIC_API_KEY=${apiKey.trim()}\n`
  );

  await writeFile(
    resolve(outDir, "openclaw.config.yaml"),
    `# wechat-to-anything — Claude Code 配置
# 自动生成，可手动修改

providers:
  claude-code:
    baseUrl: "https://api.anthropic.com"
    api: "anthropic"
    model: "claude-sonnet-4-20250514"
    apiKey: "\${ANTHROPIC_API_KEY}"

plugins:
  - "@anthropic-ai/claude-code"
`
  );

  s.stop("配置已生成 ✅");

  p.note(
    [
      pc.cyan("运行以下命令启动:"),
      "",
      `  ${pc.green("1.")} npm install -g openclaw`,
      `  ${pc.green("2.")} cd ${outDir}`,
      `  ${pc.green("3.")} openclaw gateway run`,
      `  ${pc.green("4.")} 微信扫码 → 开始用 Claude Code 🎉`,
    ].join("\n"),
    "下一步"
  );

  p.outro(pc.green("在微信里发消息试试: 帮我写个快速排序"));
}
