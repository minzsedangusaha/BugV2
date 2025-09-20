const express = require("express");
const bodyParser = require("body-parser");
const TelegramBot = require("node-telegram-bot-api");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");
const cookieParser = require("cookie-parser");
const path = require("path");

const PORT = process.env.PORT || 3000;

// ⚠️ embed langsung — sebaiknya pindah ke env var
const TELEGRAM_TOKEN = "8429120709:AAGfgPr5kdkgCH0HChiIhUKWotZE7gPoiX0";
const JWT_SECRET = muslih
  process.env.JWT_SECRET ||
  "muslih";

// --- DB setup ---
const db = new Database("data.db");
db.exec(`
CREATE TABLE IF NOT EXISTS keys (
  key TEXT PRIMARY KEY,
  expires_at INTEGER,
  revoked INTEGER DEFAULT 0,
  created_at INTEGER
);
`);

// helper parse YYYYMMDD
function parseYYYYMMDD(str) {
  if (/^\\d{8}$/.test(str)) {
    const y = parseInt(str.slice(0, 4), 10);
    const m = parseInt(str.slice(4, 6), 10) - 1;
    const d = parseInt(str.slice(6, 8), 10);
    return new Date(Date.UTC(y, m, d, 23, 59, 59));
  }
  return null;
}

// --- Telegram Bot ---
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

bot.onText(/\\/addkey (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const input = match[1].trim();
  const m = input.match(/^(.+)-(\\d{8})$/);
  if (!m)
    return bot.sendMessage(
      chatId,
      "Format salah. Gunakan: /addkey NAME-YYYYMMDD"
    );

  const name = m[1];
  const dateStr = m[2];
  const dt = parseYYYYMMDD(dateStr);
  if (!dt) return bot.sendMessage(chatId, "Tanggal salah.");

  db.prepare(
    "INSERT OR REPLACE INTO keys(key, expires_at, revoked, created_at) VALUES(?,?,0,?)"
  ).run(name, Math.floor(dt.getTime() / 1000), Math.floor(Date.now() / 1000));

  bot.sendMessage(
    chatId,
    `Key ${name} ditambahkan, expired ${dt.toISOString().slice(0, 10)}`
  );
});

bot.onText(/\\/listkeys/, (msg) => {
  const rows = db.prepare("SELECT * FROM keys").all();
  if (!rows.length) return bot.sendMessage(msg.chat.id, "Belum ada key");
  const now = Math.floor(Date.now() / 1000);
  const out = rows.map((r) => {
    const exp = new Date(r.expires_at * 1000).toISOString().slice(0, 10);
    const status = r.revoked
      ? "REVOKED"
      : r.expires_at < now
      ? "EXPIRED"
      : "ACTIVE";
    return `${r.key} — ${exp} — ${status}`;
  });
  bot.sendMessage(msg.chat.id, out.join("\\n"));
});

bot.onText(/\\/revoke (.+)/, (msg, match) => {
  const key = match[1].trim();
  db.prepare("UPDATE keys SET revoked=1 WHERE key=?").run(key);
  bot.sendMessage(msg.chat.id, `Key ${key} revoked`);
});

// --- Express ---
const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cookieParser());

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "login.html")));

app.post("/validate", (req, res) => {
  const key = (req.body.key || "").trim();
  if (!key) return res.redirect("/?error=empty");
  const row = db.prepare("SELECT * FROM keys WHERE key=?").get(key);
  if (!row) return res.redirect("/?error=invalid");
  const now = Math.floor(Date.now() / 1000);
  if (row.revoked) return res.redirect("/?error=revoked");
  if (row.expires_at < now) return res.redirect("/?error=expired");

  const ttl = row.expires_at - now;
  const token = jwt.sign({ sub: key }, JWT_SECRET, { expiresIn: ttl });

  res.cookie("minzx_token", token, {
    httpOnly: true,
    maxAge: ttl * 1000,
    sameSite: "lax",
  });
  res.redirect("/menu");
});

app.get("/menu", (req, res) => {
  const token = req.cookies && req.cookies.minzx_token;
  if (!token) return res.redirect("/?error=unauth");
  try {
    jwt.verify(token, JWT_SECRET);
    return res.sendFile(path.join(__dirname, "menu.html"));
  } catch (e) {
    return res.redirect("/?error=unauth");
  }
});

app.get("/logout", (req, res) => {
  res.clearCookie("minzx_token");
  res.redirect("/");
});

app.listen(PORT, () => console.log("Server running on port", PORT));