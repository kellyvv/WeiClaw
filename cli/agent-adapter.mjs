/**
 * Agent 调用适配器
 *
 * 根据 URL scheme 自动选择协议：
 * - http:// / https:// → OpenAI 兼容格式
 * - acp://             → ACP (Agent Communication Protocol)
 * - cli://claude       → 内置 Claude Code CLI 适配器
 * - cli://codex        → 内置 Codex CLI 适配器
 * - cli://gemini       → 内置 Gemini CLI 适配器
 * - cli://opencode     → 内置 OpenCode CLI 适配器
 */

import { writeFile, readFile, unlink, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir, homedir } from "node:os";
import { randomBytes } from "node:crypto";
import crossSpawn from "cross-spawn";

/**
 * 统一调用接口 — 根据 URL 自动选择适配器
 */
export async function callAgentAuto(url, messages, userId) {
  if (url.startsWith("acp://")) return callACP(url, messages, userId);
  if (url.startsWith("cli://")) return callCLI(url, messages);
  return callOpenAI(url, messages, userId);
}

/**
 * 验证 Agent 是否可达
 */
export async function checkAgent(url) {
  if (url.startsWith("acp://")) {
    const { httpUrl } = parseACPUrl(url);
    const res = await fetch(`${httpUrl}/agents`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`ACP server 不可达: ${res.status}`);
    return;
  }
  if (url.startsWith("cli://")) {
    const name = url.replace("cli://", "");
    const cmd = { codex: "codex", gemini: "gemini", claude: "claude", opencode: "opencode", openclaw: "openclaw" }[name] || name;
    const installHint = { codex: "@openai/codex", gemini: "@google/gemini-cli", claude: "@anthropic-ai/claude-code", opencode: "opencode-ai", openclaw: "openclaw" }[name] || cmd;
    return new Promise((resolve, reject) => {
      const child = crossSpawn(cmd, ["--version"], { timeout: 5000 });
      // 只有 ENOENT（找不到二进制）才说明未安装；
      // 非零退出码可能只是 CLI 不支持 --version（如 gemini），但已安装
      child.on("error", (err) => {
        if (err.code === "ENOENT") reject(new Error(`${cmd} CLI 未安装（npm install -g ${installHint}）`));
        else reject(err);
      });
      child.on("close", () => resolve());
    });
  }
  await fetch(url, { signal: AbortSignal.timeout(5000) });
}

// ========== OpenAI 适配器 ==========

async function callOpenAI(agentUrl, messages, userId) {
  const res = await fetch(`${agentUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, user: userId || undefined }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "(empty response)";
}

// ========== ACP 适配器 ==========

function parseACPUrl(acpUrl) {
  const withoutScheme = acpUrl.replace(/^acp:\/\//, "");
  const slashIdx = withoutScheme.indexOf("/");
  if (slashIdx === -1) throw new Error(`无效的 ACP URL: ${acpUrl}`);
  return { httpUrl: `http://${withoutScheme.slice(0, slashIdx)}`, agentName: withoutScheme.slice(slashIdx + 1) };
}

async function callACP(acpUrl, messages, userId) {
  const { httpUrl, agentName } = parseACPUrl(acpUrl);
  const input = messages.map((msg) => {
    if (typeof msg.content === "string") {
      return { parts: [{ content: msg.content, content_type: "text/plain" }] };
    }
    const parts = [];
    for (const item of msg.content) {
      if (item.type === "text") parts.push({ content: item.text, content_type: "text/plain" });
      else if (item.type === "image_url") parts.push({ content: item.image_url.url, content_type: "image/jpeg" });
    }
    return { parts };
  });

  const res = await fetch(`${httpUrl}/agents/${agentName}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`ACP ${res.status}: ${t.slice(0, 200)}`); }
  const data = await res.json();
  const texts = [];
  for (const msg of data.output || []) {
    for (const part of msg.parts || []) {
      if (part.content_type === "text/plain" || !part.content_type) texts.push(part.content);
    }
  }
  return texts.join("\n") || "(empty response)";
}

// ========== 内置 CLI 适配器 ==========

const TMP_DIR = join(tmpdir(), "wechat-cli-agents");

async function callCLI(cliUrl, messages) {
  const name = cliUrl.replace("cli://", "");
  const lastMsg = messages[messages.length - 1];

  // 提取文本和图片
  let prompt = "";
  const imagePaths = [];
  const tmpFiles = [];

  if (typeof lastMsg.content === "string") {
    prompt = lastMsg.content;
  } else if (Array.isArray(lastMsg.content)) {
    await mkdir(TMP_DIR, { recursive: true });
    for (const part of lastMsg.content) {
      if (part.type === "text") prompt += (prompt ? "\n" : "") + part.text;
      else if (part.type === "image_url" && part.image_url?.url) {
        const tmpPath = join(TMP_DIR, `img-${randomBytes(4).toString("hex")}.jpg`);
        const url = part.image_url.url;
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
  if (!prompt) throw new Error("empty prompt");

  try {
    if (name === "codex") return await runCodex(prompt, imagePaths);
    if (name === "gemini") return await runGemini(prompt, imagePaths);
    if (name === "claude") return await runClaude(prompt, imagePaths);
    if (name === "opencode") return await runOpenCode(prompt, imagePaths);
    if (name === "openclaw") return await runOpenClaw(prompt);
    throw new Error(`未知的内置 CLI Agent: ${name}`);
  } finally {
    for (const f of tmpFiles) unlink(f).catch(() => {});
  }
}

function runCodex(prompt, imagePaths = []) {
  return new Promise(async (resolve, reject) => {
    await mkdir(TMP_DIR, { recursive: true });
    const outFile = join(TMP_DIR, `out-${randomBytes(4).toString("hex")}.txt`);
    const args = ["exec", "--skip-git-repo-check", "--ephemeral", "-o", outFile];
    for (const img of imagePaths) args.push("-i", img);
    args.push("--", prompt);

    const child = crossSpawn("codex", args, { timeout: 300_000, cwd: tmpdir() });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", async () => {
        try {
          const reply = await readFile(outFile, "utf-8").catch(() => "");
          await unlink(outFile).catch(() => {});
          if (reply.trim()) resolve(reply.trim());
          else if (stdout.trim()) resolve(stdout.trim());
          else reject(new Error((stderr || "empty response").trim().slice(0, 300)));
        } catch (e) { reject(e); }
      });
    child.on("error", (err) => reject(err));
  });
}

function runGemini(prompt, imagePaths = []) {
  return new Promise((resolve, reject) => {
    const imageRefs = imagePaths.map((p) => `@${p.replace(/\\/g, "/")}`).join(" ");
    const fullPrompt = imageRefs ? `${imageRefs}\n${prompt}` : prompt;
    const args = ["-p", fullPrompt, "-y", "-o", "json"];
    if (imagePaths.length > 0) {
      const dirs = [...new Set(imagePaths.map((p) => dirname(p)))];
      for (const dir of dirs) args.push("--include-directories", dir);
    }
    const child = crossSpawn("gemini", args, { cwd: homedir(), stdio: ["ignore", "pipe", "pipe"], timeout: 300_000 });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => {
      if (stdout.trim()) {
        try {
          const parsed = JSON.parse(stdout.trim());
          resolve(parsed.response?.trim() || stdout.trim());
        } catch {
          resolve(stdout.trim());
        }
      } else if (code !== 0) reject(new Error((stderr || `exit code ${code}`).trim().slice(0, 300)));
      else resolve("(empty response)");
    });
    child.on("error", (err) => reject(new Error(`gemini CLI 未安装: ${err.message}`)));
  });
}

function runClaude(prompt, imagePaths = []) {
  return new Promise((resolve, reject) => {
    const args = ["--print"];
    let input = prompt;
    if (imagePaths.length > 0) {
      const dirs = [...new Set(imagePaths.map((p) => dirname(p)))];
      args.push("--allowedTools", "Read");
      for (const dir of dirs) args.push("--add-dir", dir);
      input += "\n\n图片文件路径：\n" + imagePaths.map((p) => p.replace(/\\/g, "/")).join("\n");
    }
    const child = crossSpawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 300_000,
    });
    child.stdin.write(input);
    child.stdin.end();
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => {
      if (code !== 0) reject(new Error((stderr + stdout).trim().slice(0, 300) || `exit code ${code}`));
      else resolve(stdout.trim() || "(empty response)");
    });
    child.on("error", (err) => reject(new Error(`claude CLI 未安装: ${err.message}`)));
  });
}

function runOpenCode(prompt, imagePaths = []) {
  return new Promise((resolve, reject) => {
    const args = ["run", prompt];
    for (const img of imagePaths) args.push("-f", img);
    const child = crossSpawn("opencode", args, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 300_000,
      cwd: process.cwd(),
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => {
      const clean = (s) => s.replace(/\x1b\[[0-9;]*m/g, "").trim();
      if (code !== 0) reject(new Error((clean(stderr + stdout) || `exit code ${code}`).slice(0, 300)));
      else resolve(clean(stdout) || "(empty response)");
    });
    child.on("error", (err) => reject(new Error(`opencode CLI 未安装（npm install -g opencode-ai）: ${err.message}`)));
  });
}

function runOpenClaw(prompt) {
  return new Promise((resolve, reject) => {
    const child = crossSpawn("openclaw", [
      "agent", "--agent", "main",
      "--message", prompt, "--json",
    ], {
      cwd: tmpdir(),
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 300_000,
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error((stderr + stdout).trim().slice(0, 300) || `exit code ${code}`));
        return;
      }
      // OpenClaw v2026.3.22+ 将 --json 输出写到 stderr，stdout 为空
      // 合并两个流，从中提取 JSON
      const combined = stdout + stderr;
      try {
        // 找到最外层 JSON 对象的起始位置（跳过 [plugins] 日志行）
        const jsonStart = combined.indexOf("\n{");
        const raw = jsonStart >= 0 ? combined.slice(jsonStart + 1) : combined;
        // 截取到最后一个 } 结束
        const jsonEnd = raw.lastIndexOf("}");
        const jsonStr = jsonEnd >= 0 ? raw.slice(0, jsonEnd + 1) : raw;
        const data = JSON.parse(jsonStr);
        // OpenClaw JSON: { payloads: [{ text: "...", mediaUrl: null }], meta: {...} }
        const payloads = data?.payloads || data?.result?.payloads;
        if (Array.isArray(payloads)) {
          const texts = payloads.map(p => p.text).filter(Boolean);
          if (texts.length) { resolve(texts.join("\n")); return; }
        }
        resolve((data?.summary || data?.reply || data?.text || "").trim() || "(empty response)");
      } catch {
        // JSON 解析失败，过滤掉日志行返回纯文本
        const lines = combined.split("\n").filter(l => !l.match(/^\d{2}:\d{2}:\d{2} \[/) && !l.startsWith("Config warnings") && !l.startsWith("Gateway"));
        resolve(lines.join("\n").trim() || "(empty response)");
      }
    });
    child.on("error", (err) => reject(new Error(`openclaw CLI 未安装: ${err.message}`)));
  });
}
