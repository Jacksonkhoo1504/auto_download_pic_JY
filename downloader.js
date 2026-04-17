import fs from "fs";
import path from "path";
import https from "https";
import { URL } from "url";

const CONFIG_FILE = "./config.json";
const API_URL = "https://xinzhi.aimei.group/web/casually/upload_history_new";

function loadEnv() {
  if (!fs.existsSync(".env")) return;
  for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
    const [key, ...rest] = line.split("=");
    if (key && rest.length) process.env[key.trim()] = rest.join("=").trim();
  }
}

function loadConfig() {
  loadEnv();
  const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  if (!cfg.cookie && process.env.PHPSESSID) {
    cfg.cookie = `PHPSESSID=${process.env.PHPSESSID}`;
  }
  return cfg;
}

function loadState(stateFile) {
  if (!fs.existsSync(stateFile)) return { downloadedIds: [] };
  return JSON.parse(fs.readFileSync(stateFile, "utf8"));
}

function saveState(stateFile, state) {
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

function sanitizeFolderName(name) {
  return name.replace(/[/\\?%*:|"<>]/g, "-").trim() || "未分类";
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(destPath)) return resolve(false);

    const dir = path.dirname(destPath);
    fs.mkdirSync(dir, { recursive: true });

    const file = fs.createWriteStream(destPath);
    https
      .get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          file.close();
          fs.unlinkSync(destPath);
          return downloadFile(res.headers.location, destPath)
            .then(resolve)
            .catch(reject);
        }
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve(true);
        });
      })
      .on("error", (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
  });
}

async function fetchPage(config, page) {
  const body = JSON.stringify({
    ...config.requestBody,
    page_size: config.pageSize,
    page,
  });

  const url = new URL(API_URL);
  const options = {
    hostname: url.hostname,
    path: url.pathname,
    method: "POST",
    headers: {
      Host: "xinzhi.aimei.group",
      Accept: "*/*",
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      frontend: "frontend",
      "Accept-Language": "en-GB,en;q=0.9",
      Origin: "https://xinzhi.aimei.group",
      Referer: "https://xinzhi.aimei.group/frontend/",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15 DingTalk(8.2.13-macOS-arm64-52962592) nw DTWKWebView Channel/201200 Architecture/arm64 2ndType/overseas webDt/PC",
      Cookie: config.cookie,
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSON parse failed: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function syncNewFiles() {
  const config = loadConfig();
  const state = loadState(config.stateFile);
  const downloadedIds = new Set(state.downloadedIds);

  console.log(`[${new Date().toISOString()}] 开始同步...`);

  let page = 1;
  let totalNew = 0;
  let stopPaging = false;

  while (!stopPaging) {
    let json;
    try {
      json = await fetchPage(config, page);
    } catch (err) {
      console.error(`第 ${page} 页请求失败:`, err.message);
      break;
    }

    if (json.code !== 0 || !json.data?.data?.length) {
      if (json.code !== 0) {
        console.error("API 返回错误:", json.code, json.msg || "");
        if (json.code === 401 || json.code === 403) {
          console.error("⚠️  Session 已过期，请更新 config.json 里的 cookie");
        }
      }
      break;
    }

    const dateGroups = json.data.data;

    for (const dateGroup of dateGroups) {
      for (const item of dateGroup.items) {
        const category = sanitizeFolderName(item.material_category_name || "未分类");
        const uploader = sanitizeFolderName(item.user_name || "unknown");

        for (const file of item.list) {
          if (downloadedIds.has(String(file.id))) {
            stopPaging = true;
            continue;
          }

          const ext = file.file_suffix || (file.file_classification === "video" ? "mov" : "jpg");
          const filename = `${file.created_at}_${file.id}.${ext}`;
          const destPath = path.join(config.downloadDir, category, uploader, filename);

          try {
            const downloaded = await downloadFile(file.url, destPath);
            if (downloaded) {
              console.log(`  ✓ [${category}] ${filename}`);
              totalNew++;
            }
            downloadedIds.add(String(file.id));
          } catch (err) {
            console.error(`  ✗ 下载失败 ${file.url}: ${err.message}`);
          }
        }
      }
    }

    const totalItems = json.data.count;
    const fetchedSoFar = page * config.pageSize;
    if (fetchedSoFar >= totalItems || stopPaging) break;
    page++;
  }

  state.downloadedIds = [...downloadedIds];
  state.lastSync = new Date().toISOString();
  saveState(config.stateFile, state);

  console.log(`[${new Date().toISOString()}] 同步完成，新下载 ${totalNew} 个文件`);
}

async function main() {
  const config = loadConfig();

  await syncNewFiles();

  if (process.argv.includes("--watch")) {
    const intervalMs = config.pollIntervalMinutes * 60 * 1000;
    console.log(`\n轮询模式已开启，每 ${config.pollIntervalMinutes} 分钟检查一次新文件\n`);
    setInterval(syncNewFiles, intervalMs);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
