import { spawn, execSync } from "node:child_process";
import { writeFile, readFile, rename, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";
import pc from "picocolors";

/**
 * 启动桥：配置 OpenClaw Gateway → 连接微信 ↔ Agent HTTP
 */
export async function start(agentUrl) {
  // 1. 检查 Agent 是否可达
  console.log(pc.dim(`🔍 检查 Agent: ${agentUrl}`));
  const reachable = await checkAgent(agentUrl);
  if (!reachable) {
    console.error(pc.red(`❌ 无法连接 Agent: ${agentUrl}`));
    console.error(pc.dim("   请确认 Agent 已启动并监听该地址"));
    process.exit(1);
  }
  console.log(pc.green("✅ Agent 可达"));

  // 2. 确保 OpenClaw 已安装
  if (!commandExists("openclaw")) {
    console.log(pc.yellow("⏳ 正在安装 OpenClaw Gateway..."));
    try {
      execSync("npm install -g openclaw@latest", { stdio: "inherit" });
      console.log(pc.green("✅ OpenClaw 已安装"));
    } catch {
      console.error(pc.red("❌ 安装失败，请手动运行: npm install -g openclaw"));
      process.exit(1);
    }
  }

  // 3. 写入配置（备份已有配置）
  console.log(pc.dim("📝 写入网关配置..."));
  await writeConfig(agentUrl);

  // 4. 停止已有网关（如果在跑）
  try { execSync("openclaw gateway stop", { stdio: "ignore" }); } catch {}

  // 5. 启动 Gateway
  console.log(pc.green("🚀 启动网关..."));
  console.log(pc.dim("   微信扫码后即可开始对话"));
  console.log();

  const gateway = spawn("openclaw", ["gateway", "run"], {
    stdio: "inherit",
    env: { ...process.env },
  });

  gateway.on("error", (err) => {
    console.error(pc.red(`网关启动失败: ${err.message}`));
    process.exit(1);
  });

  gateway.on("exit", (code) => {
    process.exit(code || 0);
  });

  // Ctrl+C 清理
  process.on("SIGINT", () => {
    gateway.kill("SIGINT");
  });
}

/**
 * 检查 Agent URL 是否可达
 */
async function checkAgent(agentUrl) {
  try {
    const res = await fetch(agentUrl, { method: "GET", signal: AbortSignal.timeout(5000) });
    return true;
  } catch {
    // GET 可能 404 但服务在跑，也算可达
    // 只有完全连不上才算失败
    try {
      await fetch(agentUrl + "/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [] }),
        signal: AbortSignal.timeout(5000),
      });
      return true;
    } catch (err) {
      return err.cause?.code !== "ECONNREFUSED";
    }
  }
}

/**
 * 写入 OpenClaw 配置，将 Agent URL 注册为自定义 Provider
 * 如果已有配置，先备份为 openclaw.json.bak
 */
async function writeConfig(agentUrl) {
  const openclawDir = resolve(homedir(), ".openclaw");
  await mkdir(openclawDir, { recursive: true });

  const configPath = resolve(openclawDir, "openclaw.json");
  const backupPath = resolve(openclawDir, "openclaw.json.bak");

  // 备份已有配置
  try {
    const existing = await readFile(configPath, "utf-8");
    if (existing.trim()) {
      await rename(configPath, backupPath);
      console.log(pc.dim(`   已备份原配置 → openclaw.json.bak`));
    }
  } catch {
    // 文件不存在，无需备份
  }

  const config = {
    gateway: {
      mode: "local",
    },
    models: {
      providers: {
        "wechat-to-anything": {
          baseUrl: agentUrl,
          api: "openai-completions",
          models: [{ id: "default", name: "default" }],
        },
      },
    },
  };

  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
}

function commandExists(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
