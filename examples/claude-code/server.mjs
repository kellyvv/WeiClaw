/**
 * Claude Code → OpenAI 兼容 HTTP 服务
 *
 * 通过 `claude --print` 子进程调用 Claude Code，
 * 包装成标准 HTTP 接口供 wechat-to-anything 连接。
 *
 * 前置条件:
 *   npm install (安装 @anthropic-ai/claude-code)
 *   设置环境变量 ANTHROPIC_API_KEY
 *
 * 用法:
 *   ANTHROPIC_API_KEY=sk-ant-xxx node server.mjs
 */

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLAUDE_BIN = resolve(__dirname, "node_modules/.bin/claude");
const PORT = process.env.PORT || 3000;

const server = createServer(async (req, res) => {
  if (req.method !== "POST" || !req.url.startsWith("/v1/chat/completions")) {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }

  const body = await readBody(req);
  const { messages } = JSON.parse(body);
  const userMessage =
    messages?.findLast((m) => m.role === "user")?.content || "";

  try {
    const result = await runClaude(userMessage);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [
          {
            message: { role: "assistant", content: result },
          },
        ],
      })
    );
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, () => {
  console.log(`🧬 Claude Code Agent 运行在 http://localhost:${PORT}/v1`);
  console.log(
    `   然后运行: npx wechat-to-anything http://localhost:${PORT}/v1`
  );
});

/**
 * 通过 claude --print 子进程执行，stdin 关闭避免等待
 */
function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, ["--print", prompt], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));

    child.on("close", (code) => {
      if (code !== 0) reject(new Error(stderr || `exit code ${code}`));
      else resolve(stdout.trim());
    });

    child.on("error", (err) => reject(err));
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
  });
}
