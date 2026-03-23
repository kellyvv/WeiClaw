/**
 * OpenCode → OpenAI 兼容 HTTP 服务
 *
 * 通过 `opencode run "prompt"` 子进程调用 OpenCode，
 * 包装成标准 HTTP 接口供 wechat-to-anything 连接。
 *
 * 前置条件:
 *   npm i -g opencode-ai    (或 brew install anomalyco/tap/opencode)
 *   配置好 AI provider:  opencode providers login
 *
 * 用法:
 *   node server.mjs
 *   # 然后另一个终端:
 *   npx wechat-to-anything http://localhost:3000/v1
 *
 * 可选环境变量:
 *   PORT=3000              HTTP 端口
 *   OPENCODE_MODEL=xxx     指定模型 (格式: provider/model)
 */

import { createServer } from "node:http";
import { spawn } from "node:child_process";

const PORT = process.env.PORT || 3000;
const MODEL = process.env.OPENCODE_MODEL || "";

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
    const result = await runOpenCode(userMessage);

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
    console.error(`  ✗ ${err.message.slice(0, 120)}`);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, () => {
  console.log(`⌬ OpenCode Agent 运行在 http://localhost:${PORT}/v1`);
  if (MODEL) console.log(`  模型: ${MODEL}`);
  console.log(
    `  然后运行: npx wechat-to-anything http://localhost:${PORT}/v1`
  );
});

/**
 * 通过 opencode run "prompt" 非交互模式调用
 */
function runOpenCode(prompt) {
  return new Promise((resolve, reject) => {
    const args = ["run", prompt];
    if (MODEL) args.push("-m", MODEL);

    const child = spawn("opencode", args, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 300_000,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));

    child.on("close", (code) => {
      // opencode run 输出可能包含 ANSI 颜色码，清理掉
      const clean = (s) => s.replace(/\x1b\[[0-9;]*m/g, "").trim();
      if (code !== 0) {
        const errMsg = clean(stderr + stdout) || `exit code ${code}`;
        reject(new Error(errMsg.slice(0, 300)));
      } else {
        resolve(clean(stdout) || "(empty response)");
      }
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
