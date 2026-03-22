/**
 * OpenAI Codex Agent — codex exec 登录模式，支持图片
 *
 * 前置：npm install -g @openai/codex && codex login
 * 用法：node server.mjs
 */

import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { writeFile, readFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

const PORT = 3001;
const TMP_DIR = join(tmpdir(), "wechat-codex");

function runCodex(prompt, imagePaths = []) {
  return new Promise(async (resolve, reject) => {
    await mkdir(TMP_DIR, { recursive: true });
    const outFile = join(TMP_DIR, `out-${randomBytes(4).toString("hex")}.txt`);

    const args = [
      "exec",
      "--skip-git-repo-check",
      "--ephemeral",
      "-o", outFile, // 把回复写到文件，避免 stdout 被 progress 污染
    ];
    for (const img of imagePaths) args.push("-i", img);
    args.push("--", prompt);

    execFile("codex", args, {
      timeout: 300_000,
      maxBuffer: 2 * 1024 * 1024,
      cwd: tmpdir(),
    }, async (err, stdout, stderr) => {
      try {
        // 优先从输出文件读取
        const reply = await readFile(outFile, "utf-8").catch(() => "");
        await unlink(outFile).catch(() => {});

        if (reply.trim()) {
          resolve(reply.trim());
        } else if (stdout.trim()) {
          resolve(stdout.trim());
        } else if (err) {
          reject(new Error((stderr || err.message).trim().slice(0, 300)));
        } else {
          resolve("(empty response)");
        }
      } catch (e) {
        reject(e);
      }
    });
  });
}

const server = createServer(async (req, res) => {
  if (req.method === "POST" && req.url.endsWith("/chat/completions")) {
    let body = "";
    for await (const chunk of req) body += chunk;
    const tmpFiles = [];

    try {
      const { messages } = JSON.parse(body);
      const lastMsg = messages[messages.length - 1];
      let prompt = "";
      const imagePaths = [];

      if (typeof lastMsg.content === "string") {
        prompt = lastMsg.content;
      } else if (Array.isArray(lastMsg.content)) {
        await mkdir(TMP_DIR, { recursive: true });
        for (const part of lastMsg.content) {
          if (part.type === "text") {
            prompt += (prompt ? "\n" : "") + part.text;
          } else if (part.type === "image_url" && part.image_url?.url) {
            const url = part.image_url.url;
            const tmpPath = join(TMP_DIR, `img-${randomBytes(4).toString("hex")}.jpg`);
            if (url.startsWith("data:")) {
              await writeFile(tmpPath, Buffer.from(url.replace(/^data:[^;]+;base64,/, ""), "base64"));
            } else {
              const r = await fetch(url);
              if (r.ok) await writeFile(tmpPath, Buffer.from(await r.arrayBuffer()));
            }
            imagePaths.push(tmpPath);
            tmpFiles.push(tmpPath);
          }
        }
      }

      if (!prompt && imagePaths.length > 0) prompt = "请描述这张图片";
      if (!prompt) { res.writeHead(400); res.end('{"error":"empty"}'); return; }

      const label = imagePaths.length > 0 ? ` +${imagePaths.length}图` : "";
      console.log(`← ${prompt.slice(0, 80)}${label}`);

      const reply = await runCodex(prompt, imagePaths);
      console.log(`→ ${reply.slice(0, 80)}`);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: reply } }] }));
    } catch (err) {
      console.error(`❌ ${err.message.slice(0, 200)}`);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    } finally {
      for (const f of tmpFiles) unlink(f).catch(() => {});
    }
  } else {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"status":"ok","agent":"codex"}');
  }
});

server.listen(PORT, () => {
  console.log(`🤖 Codex Agent 运行在 http://localhost:${PORT}/v1`);
  console.log(`   登录模式（codex exec -o），支持图片`);
});
