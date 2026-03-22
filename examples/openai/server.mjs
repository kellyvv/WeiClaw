/**
 * OpenAI Codex Agent — 通过 Codex CLI 调用（账号登录，不需要 API key）
 *
 * 前置：
 *   npm install -g @openai/codex
 *   codex login
 *
 * 用法:
 *   node server.mjs
 */

import { createServer } from "node:http";
import { execFile } from "node:child_process";

const PORT = 3001;

/** 调用 codex exec 非交互模式 */
function runCodex(prompt) {
  return new Promise((resolve, reject) => {
    execFile("codex", ["exec", prompt], {
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (err) {
        const output = (stdout + "\n" + stderr).trim();
        reject(new Error(output || err.message));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

const server = createServer(async (req, res) => {
  if (req.method === "POST" && req.url.endsWith("/chat/completions")) {
    let body = "";
    for await (const chunk of req) body += chunk;

    try {
      const { messages } = JSON.parse(body);
      const lastMsg = messages[messages.length - 1];

      // 提取文本（支持多模态格式）
      let prompt;
      if (typeof lastMsg.content === "string") {
        prompt = lastMsg.content;
      } else if (Array.isArray(lastMsg.content)) {
        prompt = lastMsg.content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("\n");
      }

      if (!prompt) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "No text content" }));
        return;
      }

      console.log(`← ${prompt.slice(0, 80)}`);
      const reply = await runCodex(prompt);
      console.log(`→ ${reply.slice(0, 80)}`);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        choices: [{ message: { role: "assistant", content: reply } }],
      }));
    } catch (err) {
      console.error(`❌ ${err.message.slice(0, 100)}`);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
  } else {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", agent: "codex" }));
  }
});

server.listen(PORT, () => {
  console.log(`🤖 Codex Agent 运行在 http://localhost:${PORT}/v1`);
  console.log(`   然后运行: npx wechat-to-anything http://localhost:${PORT}/v1`);
});
