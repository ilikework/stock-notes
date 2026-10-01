import { APP_CSS, loginPage, signupPage, notesPage, dayPage, picksPage, mePage, avatarPage, comparePage, adminPage, adminResetPage } from "./pages.js";
import { SYMBOLS } from "./symbols.js";
export const PBKDF2_ITERATIONS = 15000;
export const MAX_USERS = 100;
export const SESSION_SECONDS = 30 * 24 * 60 * 60;
export const COOKIE_NAME = "sn_session";

const DUMMY_SALT = "0123456789abcdeffedcba9876543210";
const DUMMY_HASH = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

export const SQL = {
  userByLogin:
    "SELECT id, login, display_name, role, enabled, password_hash, password_salt, password_iters FROM users WHERE login = ? COLLATE NOCASE",
  userById:
    "SELECT id, login, display_name, role, enabled, password_hash, password_salt, password_iters FROM users WHERE id = ?",
  countUsers: "SELECT COUNT(*) AS n FROM users",
  countEnabledAdmins: "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND enabled = 1",
  listUsers:
    "SELECT id, login, display_name, role, enabled, created_at FROM users ORDER BY id ASC",
  insertUser:
    "INSERT INTO users (login, display_name, role, enabled, password_hash, password_salt, password_iters, created_at, updated_at) VALUES (?, ?, 'user', 1, ?, ?, ?, ?, ?)",
  updatePassword:
    "UPDATE users SET password_hash = ?, password_salt = ?, password_iters = ?, updated_at = ? WHERE id = ?",
  updateEnabled: "UPDATE users SET enabled = ?, updated_at = ? WHERE id = ?",
  insertSession:
    "INSERT INTO sessions (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)",
  sessionByHash:
    "SELECT s.expires_at AS expires_at, u.id AS user_id, u.login AS login, u.display_name AS display_name, u.role AS role, u.enabled AS enabled FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?",
  deleteSession: "DELETE FROM sessions WHERE token_hash = ?",
  deleteUserSessions: "DELETE FROM sessions WHERE user_id = ?",
  deleteExpired: "DELETE FROM sessions WHERE expires_at < ?",
};

function bytesToHex(buf) {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

function hexToBytes(hex) {
  if (typeof hex !== "string" || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
    throw new Error("bad hex");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function timingSafeEqual(a, b) {
  const aa = String(a);
  const bb = String(b);
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa.charCodeAt(i) ^ bb.charCodeAt(i);
  return diff === 0;
}

async function pbkdf2Hex(password, saltBytes, iterations) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" },
    key,
    256
  );
  return bytesToHex(bits);
}

export async function hashPassword(password, iterations = PBKDF2_ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2Hex(password, salt, iterations);
  return { hash, salt: bytesToHex(salt), iterations };
}

export async function verifyPassword(password, saltHex, hashHex, iterations) {
  let salt;
  try {
    salt = hexToBytes(saltHex);
  } catch {
    return false;
  }
  const iters = Number(iterations);
  if (!Number.isInteger(iters) || iters < 1000 || iters > 1000000) return false;
  const got = await pbkdf2Hex(String(password), salt, iters);
  return timingSafeEqual(got, String(hashHex).toLowerCase());
}

export async function hashToken(token) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return bytesToHex(buf);
}

export function newSessionToken() {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

export function validateLogin(login) {
  if (typeof login !== "string") return "登录名须为2到32位，以字母开头，只含字母、数字和下划线";
  const s = login.trim();
  if (!/^[A-Za-z][A-Za-z0-9_]{1,31}$/.test(s)) {
    return "登录名须为2到32位，以字母开头，只含字母、数字和下划线";
  }
  return null;
}

export function validateDisplayName(name) {
  if (typeof name !== "string") return "显示名须为1到32个字符";
  const s = name.trim();
  if ([...s].length < 1 || [...s].length > 32) return "显示名须为1到32个字符";
  if (/[\u0000-\u001F\u007F]/.test(s)) return "显示名包含非法字符";
  return null;
}

export function validatePassword(password) {
  if (typeof password !== "string") return "密码须为8到72个字符";
  if (password.length < 8 || password.length > 72) return "密码须为8到72个字符";
  return null;
}

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export function sessionCookieHeader(token) {
  return (
    COOKIE_NAME +
    "=" +
    token +
    "; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=" +
    String(SESSION_SECONDS)
  );
}

export function clearCookieHeader() {
  return COOKIE_NAME + "=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0";
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extra,
    },
  });
}

function html(body, status = 200, extra = {}) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extra,
    },
  });
}

function redirect(location, extra = {}) {
  return new Response(null, {
    status: 303,
    headers: {
      location,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extra,
    },
  });
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

async function readText(request, limit) {
  const text = await request.text();
  if (text.length > limit) return { error: json({ ok: false, error: "请求无效" }, 400) };
  return { text };
}

function parseForm(text) {
  const out = {};
  for (const part of text.split("&")) {
    if (!part) continue;
    const idx = part.indexOf("=");
    const rawK = idx === -1 ? part : part.slice(0, idx);
    const rawV = idx === -1 ? "" : part.slice(idx + 1);
    const k = decodeURIComponent(rawK.replace(/\+/g, " "));
    const v = decodeURIComponent(rawV.replace(/\+/g, " "));
    out[k] = v;
  }
  return out;
}

async function getSession(request, env) {
  const token = parseCookies(request.headers.get("cookie") || "")[COOKIE_NAME];
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const tokenHash = await hashToken(token);
  const row = await env.DB.prepare(SQL.sessionByHash).bind(tokenHash).first();
  if (!row) return null;
  if (String(row.expires_at) <= new Date().toISOString()) {
    await env.DB.prepare(SQL.deleteSession).bind(tokenHash).run();
    return null;
  }
  if (!row.enabled) return null;
  return {
    user_id: row.user_id,
    login: row.login,
    display_name: row.display_name,
    role: row.role,
    enabled: row.enabled,
    token,
    tokenHash,
  };
}

async function createSession(env, userId) {
  const token = newSessionToken();
  const tokenHash = await hashToken(token);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_SECONDS * 1000);
  await env.DB.prepare(SQL.insertSession)
    .bind(userId, tokenHash, expires.toISOString(), now.toISOString())
    .run();
  return token;
}

async function checkCredentials(env, loginName, password) {
  const loginError = validateLogin(loginName);
  const passwordError = validatePassword(password);
  const lookup = !loginError;
  const user = lookup
    ? await env.DB.prepare(SQL.userByLogin).bind(String(loginName).trim()).first()
    : null;
  const ok = await verifyPassword(
    typeof password === "string" ? password : "",
    user ? user.password_salt : DUMMY_SALT,
    user ? user.password_hash : DUMMY_HASH,
    user ? user.password_iters : PBKDF2_ITERATIONS
  );
  if (loginError || passwordError || !user || !ok || !user.enabled) return { ok: false };
  return { ok: true, user };
}

async function loginJson(request, env) {
  const bodyRead = await readText(request, 4096);
  if (bodyRead.error) return bodyRead.error;
  let body;
  try {
    body = JSON.parse(bodyRead.text || "{}");
  } catch {
    return json({ ok: false, error: "请求无效" }, 400);
  }
  const result = await checkCredentials(env, body.login, body.password);
  if (!result.ok) return json({ ok: false, error: "登录名或密码不正确" }, 401);
  await env.DB.prepare(SQL.deleteExpired).bind(new Date().toISOString()).run();
  const token = await createSession(env, result.user.id);
  return json(
    {
      ok: true,
      login: result.user.login,
      display_name: result.user.display_name,
      role: result.user.role,
    },
    200,
    { "set-cookie": sessionCookieHeader(token) }
  );
}

async function loginForm(request, env) {
  const bodyRead = await readText(request, 4096);
  if (bodyRead.error) return redirect("/login?e=1");
  let form;
  try {
    form = parseForm(bodyRead.text || "");
  } catch {
    return redirect("/login?e=1");
  }
  const result = await checkCredentials(env, form.login, form.password);
  if (!result.ok) return redirect("/login?e=1");
  await env.DB.prepare(SQL.deleteExpired).bind(new Date().toISOString()).run();
  const token = await createSession(env, result.user.id);
  return redirect("/", { "set-cookie": sessionCookieHeader(token) });
}

async function logout(request, env, asForm) {
  const token = parseCookies(request.headers.get("cookie") || "")[COOKIE_NAME];
  if (token && /^[0-9a-f]{64}$/.test(token)) {
    const tokenHash = await hashToken(token);
    await env.DB.prepare(SQL.deleteSession).bind(tokenHash).run();
  }
  if (asForm) return redirect("/login", { "set-cookie": clearCookieHeader() });
  return json({ ok: true }, 200, { "set-cookie": clearCookieHeader() });
}

async function applyPasswordChange(env, userId, currentPassword, newPassword) {
  const user = await env.DB.prepare(SQL.userById).bind(userId).first();
  if (!user || !user.enabled) return { error: "请先登录", status: 401 };
  const currentOk = await verifyPassword(
    currentPassword,
    user.password_salt,
    user.password_hash,
    user.password_iters
  );
  if (!currentOk) return { error: "当前密码不正确", status: 400, code: "bad" };
  const passwordError = validatePassword(newPassword);
  if (passwordError) return { error: passwordError, status: 400, code: "short" };
  if (newPassword === currentPassword) {
    return { error: "新密码不能与当前密码相同", status: 400, code: "same" };
  }
  const hashed = await hashPassword(newPassword);
  const now = new Date().toISOString();
  await env.DB.prepare(SQL.updatePassword)
    .bind(hashed.hash, hashed.salt, hashed.iterations, now, userId)
    .run();
  await env.DB.prepare(SQL.deleteUserSessions).bind(userId).run();
  const token = await createSession(env, userId);
  return { token };
}

async function changePasswordJson(request, env) {
  const session = await getSession(request, env);
  if (!session) return json({ ok: false, error: "请先登录" }, 401);
  const bodyRead = await readText(request, 4096);
  if (bodyRead.error) return bodyRead.error;
  let body;
  try {
    body = JSON.parse(bodyRead.text || "{}");
  } catch {
    return json({ ok: false, error: "请求无效" }, 400);
  }
  const result = await applyPasswordChange(
    env,
    session.user_id,
    body.current_password,
    body.new_password
  );
  if (result.error) return json({ ok: false, error: result.error }, result.status);
  return json({ ok: true }, 200, { "set-cookie": sessionCookieHeader(result.token) });
}

async function changePasswordForm(request, env) {
  const session = await getSession(request, env);
  if (!session) return redirect("/login");
  const bodyRead = await readText(request, 4096);
  if (bodyRead.error) return redirect("/me");
  let form;
  try {
    form = parseForm(bodyRead.text || "");
  } catch {
    return redirect("/me");
  }
  if (form.new_password !== form.confirm_password) return redirect("/me");
  const result = await applyPasswordChange(
    env,
    session.user_id,
    form.current_password,
    form.new_password
  );
  if (result.error) return redirect("/me");
  return redirect("/me", { "set-cookie": sessionCookieHeader(result.token) });
}

async function requireAdmin(request, env) {
  const session = await getSession(request, env);
  if (!session) return { error: json({ ok: false, error: "请先登录" }, 401) };
  if (session.role !== "admin") return { error: json({ ok: false, error: "没有权限" }, 403) };
  return { session };
}

async function adminUsers(request, env, path) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  if (request.method === "GET" && path === "/api/admin/users") {
    const rows = await env.DB.prepare(SQL.listUsers).all();
    const users = (rows.results || []).map((u) => ({
      id: u.id,
      login: u.login,
      display_name: u.display_name,
      role: u.role,
      enabled: !!u.enabled,
      created_at: u.created_at,
    }));
    return json({ ok: true, users });
  }
  if (request.method === "POST" && path === "/api/admin/users") {
    const bodyRead = await readText(request, 4096);
    if (bodyRead.error) return bodyRead.error;
    let body;
    try {
      body = JSON.parse(bodyRead.text || "{}");
    } catch {
      return json({ ok: false, error: "请求无效" }, 400);
    }
    const loginError = validateLogin(body.login);
    if (loginError) return json({ ok: false, error: loginError }, 400);
    const nameError = validateDisplayName(body.display_name);
    if (nameError) return json({ ok: false, error: nameError }, 400);
    const passwordError = validatePassword(body.password);
    if (passwordError) return json({ ok: false, error: passwordError }, 400);
    const login = body.login.trim();
    const displayName = body.display_name.trim();
    const existing = await env.DB.prepare(SQL.userByLogin).bind(login).first();
    if (existing) return json({ ok: false, error: "登录名已存在" }, 409);
    const countRow = await env.DB.prepare(SQL.countUsers).first();
    if (Number(countRow && countRow.n) >= MAX_USERS) {
      return json({ ok: false, error: "用户数量已达上限" }, 400);
    }
    const hashed = await hashPassword(body.password);
    const now = new Date().toISOString();
    try {
      await env.DB.prepare(SQL.insertUser)
        .bind(login, displayName, hashed.hash, hashed.salt, hashed.iterations, now, now)
        .run();
    } catch (err) {
      if (String(err && err.message || err).includes("UNIQUE")) {
        return json({ ok: false, error: "登录名已存在" }, 409);
      }
      throw err;
    }
    const created = await env.DB.prepare(SQL.userByLogin).bind(login).first();
    return json(
      {
        ok: true,
        id: created.id,
        login: created.login,
        display_name: created.display_name,
        role: created.role,
      },
      201
    );
  }
  const match = path.match(/^\/api\/admin\/users\/(\d+)\/(enabled|password)$/);
  if (!match || request.method !== "POST") {
    return json({ ok: false, error: "not found" }, 404);
  }
  const id = Number(match[1]);
  if (!Number.isInteger(id) || id < 1) return json({ ok: false, error: "用户不存在" }, 404);
  const target = await env.DB.prepare(SQL.userById).bind(id).first();
  if (!target) return json({ ok: false, error: "用户不存在" }, 404);
  const bodyRead = await readText(request, 4096);
  if (bodyRead.error) return bodyRead.error;
  let body;
  try {
    body = JSON.parse(bodyRead.text || "{}");
  } catch {
    return json({ ok: false, error: "请求无效" }, 400);
  }
  if (match[2] === "enabled") {
    if (typeof body.enabled !== "boolean") return json({ ok: false, error: "请求无效" }, 400);
    const result = await applyEnabledChange(env, gate.session, target, body.enabled);
    if (result.error) return json({ ok: false, error: result.error }, result.status);
    return json({ ok: true, id, enabled: body.enabled });
  }
  const result = await applyAdminPassword(env, gate.session, target, body.password);
  if (result.error) return json({ ok: false, error: result.error }, result.status);
  return json({ ok: true, id });
}

async function applyEnabledChange(env, actor, target, enabled) {
  const id = Number(target.id);
  if (id === Number(actor.user_id) && !enabled) {
    return { error: "不能禁用自己", status: 400 };
  }
  if (target.role === "admin" && !enabled) {
    const admins = await env.DB.prepare(SQL.countEnabledAdmins).first();
    if (Number(admins && admins.n) <= 1) {
      return { error: "至少保留一个启用的管理员", status: 400 };
    }
    return { error: "不能停用管理员", status: 400 };
  }
  const now = new Date().toISOString();
  await env.DB.prepare(SQL.updateEnabled).bind(enabled ? 1 : 0, now, id).run();
  if (!enabled) await env.DB.prepare(SQL.deleteUserSessions).bind(id).run();
  return { ok: true };
}

async function applyAdminPassword(env, actor, target, password) {
  const id = Number(target.id);
  const passwordError = validatePassword(password);
  if (passwordError) return { error: passwordError, status: 400 };
  if (id === Number(actor.user_id) || target.role === "admin") {
    return { error: "请到账号页修改自己的密码", status: 400 };
  }
  const hashed = await hashPassword(password);
  const now = new Date().toISOString();
  await env.DB.prepare(SQL.updatePassword)
    .bind(hashed.hash, hashed.salt, hashed.iterations, now, id)
    .run();
  await env.DB.prepare(SQL.deleteUserSessions).bind(id).run();
  return { ok: true };
}



Object.assign(SQL, {
  listEnabledUsers:
    "SELECT id, login, display_name, role FROM users WHERE enabled = 1 ORDER BY id ASC",
  notesByUser:
    "SELECT session_date, session, created_at, payload FROM notes WHERE user_id = ? ORDER BY session_date DESC, session DESC LIMIT 80",
  upsertNote:
    "INSERT INTO notes (user_id, session_date, session, created_at, payload) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, session_date, session) DO UPDATE SET created_at = excluded.created_at, payload = excluded.payload",
  remarksForDay:
    "SELECT session, symbol, text FROM remarks WHERE user_id = ? AND session_date = ?",
  upsertRemark:
    "INSERT INTO remarks (user_id, session_date, session, symbol, text, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, session_date, session, symbol) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at",
  deleteRemark:
    "DELETE FROM remarks WHERE user_id = ? AND session_date = ? AND session = ? AND symbol = ?",
  journalGet: "SELECT text FROM day_journal WHERE user_id = ? AND session_date = ?",
  upsertJournal:
    "INSERT INTO day_journal (user_id, session_date, text, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, session_date) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at",
  picksByUser:
    "SELECT symbol, name, position FROM picks WHERE user_id = ? ORDER BY position ASC, symbol ASC",
  insertPick:
    "INSERT INTO picks (user_id, symbol, name, position, created_at) VALUES (?, ?, ?, ?, ?)",
  deletePick: "DELETE FROM picks WHERE user_id = ? AND symbol = ?",
  updatePickPos: "UPDATE picks SET position = ? WHERE user_id = ? AND symbol = ?",
  avatarGet: "SELECT data FROM avatars WHERE user_id = ?",
  upsertAvatar:
    "INSERT INTO avatars (user_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
  catalogMeta: "SELECT generation, count, parts, updated_at FROM symbol_catalog_meta WHERE id = 1",
  catalogParts: "SELECT seq, data FROM symbol_catalog_blob WHERE generation = ? ORDER BY seq ASC",
  insertCatalogPart: "INSERT INTO symbol_catalog_blob (generation, seq, data) VALUES (?, ?, ?)",
  upsertCatalogMeta:
    "INSERT INTO symbol_catalog_meta (id, generation, count, parts, updated_at) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET generation = excluded.generation, count = excluded.count, parts = excluded.parts, updated_at = excluded.updated_at",
  deleteOldCatalog: "DELETE FROM symbol_catalog_blob WHERE generation != ?",
  insertRefreshLog: "INSERT INTO symbol_refresh_log (at, ok, message) VALUES (?, ?, ?)",
});

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS picks (
    user_id INTEGER NOT NULL,
    symbol TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, symbol)
  )`,
  `CREATE TABLE IF NOT EXISTS notes (
    user_id INTEGER NOT NULL,
    session_date TEXT NOT NULL,
    session TEXT NOT NULL,
    created_at TEXT NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY (user_id, session_date, session)
  )`,
  `CREATE TABLE IF NOT EXISTS remarks (
    user_id INTEGER NOT NULL,
    session_date TEXT NOT NULL,
    session TEXT NOT NULL,
    symbol TEXT NOT NULL,
    text TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, session_date, session, symbol)
  )`,
  `CREATE TABLE IF NOT EXISTS day_journal (
    user_id INTEGER NOT NULL,
    session_date TEXT NOT NULL,
    text TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, session_date)
  )`,
  `CREATE TABLE IF NOT EXISTS avatars (
    user_id INTEGER PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS symbol_catalog_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    generation INTEGER NOT NULL,
    count INTEGER NOT NULL,
    parts INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS symbol_catalog_blob (
    generation INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (generation, seq)
  )`,
  `CREATE TABLE IF NOT EXISTS symbol_refresh_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    ok INTEGER NOT NULL,
    message TEXT NOT NULL
  )`,
];

let schemaReady = false;

async function ensureSchema(env) {
  if (schemaReady) return;
  if (!env || !env.DB || typeof env.DB.batch !== "function" || typeof env.DB.exec !== "function") return;
  try {
    for (const statement of SCHEMA_STATEMENTS) {
      await env.DB.exec(statement);
    }
  } catch (err) {
    console.error("schema", err && err.message ? err.message : "failed");
  }
  schemaReady = true;
}

const STOCK_FIELDS = [
  "symbol",
  "name",
  "price",
  "change_pct",
  "from_open_pct",
  "volume",
  "amount",
  "zone",
  "reason",
  "pe",
  "pb",
  "pe_pctl",
  "pb_pctl",
  "dy",
  "week52_pctl",
];

function clipText(value, max) {
  return [...String(value)].slice(0, max).join("");
}

function normalizeSymbol(raw) {
  if (typeof raw !== "string") return null;
  const stripped = raw.trim().toLowerCase().replace(/^(sh|sz|bj)/, "");
  if (!/^\d{6}$/.test(stripped)) return null;
  return stripped;
}

function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validSession(value) {
  return value === "open" || value === "close";
}

function formatCnDate(iso) {
  const parts = String(iso).split("-");
  return String(Number(parts[1])) + "月" + String(Number(parts[2])) + "日";
}

function parsePayload(raw) {
  try {
    const data = JSON.parse(raw || "{}");
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function fmtNum(value, digits) {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return n.toFixed(digits).replace(/\.?0+$/, "");
}

function fmtPct(value) {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  const sign = n > 0 ? "+" : "";
  return sign + n.toFixed(2).replace(/\.?0+$/, "") + "%";
}

function fmtPrice(value) {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

function direction(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "";
  return n > 0 ? "up" : "down";
}

function countChanges(stocks, prevStocks) {
  const prev = {};
  for (const stock of prevStocks || []) {
    if (stock && stock.symbol) prev[stock.symbol] = stock.zone || "";
  }
  let n = 0;
  for (const stock of stocks || []) {
    if (!stock || !stock.symbol) continue;
    if (prev[stock.symbol] && prev[stock.symbol] !== (stock.zone || "")) n += 1;
  }
  return n;
}

function sessionMessage(label, stocks, prevStocks, withPeriod) {
  const changes = countChanges(stocks, prevStocks);
  let text = label + "分析已更新，共 " + stocks.length + " 只";
  if (changes > 0) text += "，区间较上次变化 " + changes + " 只";
  if (withPeriod) text += "。";
  return text;
}

function prevStocks(rows, session, date) {
  let best = null;
  for (const row of rows) {
    if (row.session !== session || !(row.session_date < date)) continue;
    if (!best || row.session_date > best.session_date) best = row;
  }
  return best ? parsePayload(best.payload).stocks || [] : [];
}

function zoneMap(stocks) {
  const map = {};
  for (const stock of stocks || []) {
    if (stock && stock.symbol) map[stock.symbol] = stock.zone || "";
  }
  return map;
}

function chipsFor(stock) {
  const chips = [];
  const fromOpen = fmtPct(stock.from_open_pct);
  if (fromOpen) chips.push("距开盘 " + fromOpen);
  const pe = fmtNum(stock.pe, 1);
  if (pe) chips.push("PE " + pe);
  const pb = fmtNum(stock.pb, 1);
  if (pb) chips.push("PB " + pb);
  const pctl = stock.pe_pctl != null && stock.pe_pctl !== "" ? stock.pe_pctl : stock.week52_pctl;
  const pctlText = fmtNum(pctl, 0);
  if (pctlText) chips.push("分位 " + pctlText + "%");
  return chips;
}

function viewStock(stock, session, date, prev, remark) {
  const before = prev[stock.symbol];
  const zone = stock.zone || "";
  const zoneText = before && before !== zone ? "上次 " + before + " → 这次 " + zone : zone;
  const change = fmtPct(stock.change_pct) || "—";
  return {
    symbol: stock.symbol || "",
    name: stock.name || stock.symbol || "",
    price: fmtPrice(stock.price),
    change,
    dir: direction(stock.change_pct),
    zone: zoneText,
    chips: chipsFor(stock),
    remark: remark || "",
    date,
    session,
    href: "/c/" + encodeURIComponent(stock.symbol || "") + "?session=" + session + "&date=" + encodeURIComponent(date),
  };
}

function cleanStock(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const key of STOCK_FIELDS) {
    if (raw[key] !== undefined) out[key] = raw[key];
  }
  if (typeof out.symbol === "string") out.symbol = out.symbol.trim();
  if (typeof out.name === "string") out.name = clipText(out.name, 32);
  if (typeof out.zone === "string") out.zone = clipText(out.zone, 32);
  if (typeof out.reason === "string") out.reason = clipText(out.reason, 200);
  return out;
}

function authorized(request, env) {
  const expected = env.WRITE_KEY || "";
  const got = request.headers.get("authorization") || "";
  return !!expected && got === "Bearer " + expected;
}

async function readJson(request, limit) {
  const bodyRead = await readText(request, limit);
  if (bodyRead.error) return bodyRead;
  try {
    return { data: JSON.parse(bodyRead.text || "{}") };
  } catch {
    return { error: json({ ok: false, error: "请求无效" }, 400) };
  }
}

async function loadNotes(env, userId) {
  const rows = await env.DB.prepare(SQL.notesByUser).bind(userId).all();
  return rows.results || [];
}

async function loadPicks(env, userId) {
  const rows = await env.DB.prepare(SQL.picksByUser).bind(userId).all();
  return rows.results || [];
}

function groupDays(rows) {
  const order = [];
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.session_date)) {
      map.set(row.session_date, {});
      order.push(row.session_date);
    }
    map.get(row.session_date)[row.session] = row;
  }
  return order.map((date) => ({ date, sessions: map.get(date) }));
}

function dayMessage(rows, date, sessions) {
  const key = sessions.close ? "close" : sessions.open ? "open" : "";
  if (!key) return "";
  const label = key === "close" ? "收盘" : "开盘";
  const stocks = parsePayload(sessions[key].payload).stocks || [];
  return sessionMessage(label, stocks, prevStocks(rows, key, date), false);
}

async function createUserAccount(env, loginRaw, displayRaw, password) {
  const loginError = validateLogin(loginRaw);
  if (loginError) return { error: loginError, status: 400 };
  const nameError = validateDisplayName(displayRaw);
  if (nameError) return { error: nameError, status: 400 };
  const passwordError = validatePassword(password);
  if (passwordError) return { error: passwordError, status: 400 };
  const login = String(loginRaw).trim();
  const displayName = String(displayRaw).trim();
  const existing = await env.DB.prepare(SQL.userByLogin).bind(login).first();
  if (existing) return { error: "登录名已存在", status: 409 };
  const countRow = await env.DB.prepare(SQL.countUsers).first();
  if (Number(countRow && countRow.n) >= MAX_USERS) {
    return { error: "用户数量已达上限", status: 400 };
  }
  const hashed = await hashPassword(password);
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(SQL.insertUser)
      .bind(login, displayName, hashed.hash, hashed.salt, hashed.iterations, now, now)
      .run();
  } catch (err) {
    if (String((err && err.message) || err).includes("UNIQUE")) {
      return { error: "登录名已存在", status: 409 };
    }
    throw err;
  }
  const created = await env.DB.prepare(SQL.userByLogin).bind(login).first();
  await env.DB.prepare(SQL.deleteExpired).bind(now).run();
  const token = await createSession(env, created.id);
  return { token, user: created };
}

async function signupJson(request, env) {
  const bodyRead = await readJson(request, 4096);
  if (bodyRead.error) return bodyRead.error;
  const body = bodyRead.data || {};
  if (body.password !== body.confirm && body.confirm !== undefined && body.password !== body.password2) {
    // confirm checked below
  }
  const confirm = body.confirm !== undefined ? body.confirm : body.password2;
  if (confirm !== undefined && confirm !== body.password) {
    return json({ ok: false, error: "两次输入的密码不一致" }, 400);
  }
  const result = await createUserAccount(env, body.login, body.display_name, body.password);
  if (result.error) return json({ ok: false, error: result.error }, result.status);
  return json(
    {
      ok: true,
      login: result.user.login,
      display_name: result.user.display_name,
      role: result.user.role,
    },
    201,
    { "set-cookie": sessionCookieHeader(result.token) }
  );
}

async function signupForm(request, env) {
  const bodyRead = await readText(request, 4096);
  if (bodyRead.error) return redirect("/signup?e=bad");
  let form;
  try {
    form = parseForm(bodyRead.text || "");
  } catch {
    return redirect("/signup?e=bad");
  }
  if (form.password !== form.confirm) return redirect("/signup?e=mismatch");
  const result = await createUserAccount(env, form.login, form.display_name, form.password);
  if (result.error) {
    const code = result.status === 409 ? "exists" : "bad";
    return redirect("/signup?e=" + code);
  }
  return redirect("/", { "set-cookie": sessionCookieHeader(result.token) });
}

function signupErrorText(code) {
  if (code === "mismatch") return "两次输入的密码不一致";
  if (code === "exists") return "登录名已存在";
  if (code === "bad") return "请检查显示名、登录名和密码";
  return "";
}

async function requireUser(request, env) {
  const session = await getSession(request, env);
  if (!session) return { error: redirect("/login") };
  return { session };
}

async function lookupQuoteName(symbol) {
  const market = symbol.startsWith("5") || symbol.startsWith("6") || symbol.startsWith("9") ? "sh" : "sz";
  const response = await fetch("https://qt.gtimg.cn/q=" + market + symbol, {
    headers: { "user-agent": "Mozilla/5.0" },
  });
  if (!response.ok) return "";
  const buf = await response.arrayBuffer();
  let text = "";
  try {
    text = new TextDecoder("gbk").decode(buf);
  } catch {
    text = new TextDecoder().decode(buf);
  }
  const match = text.match(/="([^"]*)"/);
  if (!match) return "";
  const parts = match[1].split("~");
  return (parts[1] || "").trim();
}

function listedShare(market, symbol) {
  if (market === "sh") return /^(600|601|603|605|688|689)\d{3}$/.test(symbol);
  if (market === "sz") return /^(000|001|002|003|300|301)\d{3}$/.test(symbol);
  if (market === "bj") return /^[489]\d{5}$/.test(symbol);
  return false;
}

export function parseSinaSuggest(text) {
  const match = String(text || "").match(/"([^"]*)"/);
  if (!match) return [];
  const labels = { sh: "沪", sz: "深", bj: "京" };
  const items = [];
  const seen = new Set();
  for (const row of match[1].split(";")) {
    if (!row) continue;
    const parts = row.split(",");
    const symbol = parts[2] || "";
    const full = String(parts[3] || "").toLowerCase();
    const name = clipText(String(parts[4] || parts[0] || "").trim(), 32);
    if (!/^\d{6}$/.test(symbol) || seen.has(symbol)) continue;
    const market = full.startsWith("sh") ? "sh" : full.startsWith("sz") ? "sz" : full.startsWith("bj") ? "bj" : "";
    if (!market || !listedShare(market, symbol)) continue;
    seen.add(symbol);
    items.push({ symbol, name: name || symbol, market, label: labels[market] });
    if (items.length >= 8) break;
  }
  return items;
}

export function searchSymbols(query, rows = SYMBOLS) {
  const q = String(query || "").trim().slice(0, 16);
  if (!q || /[\u0000-\u001f]/.test(q)) return [];
  const lower = q.toLowerCase();
  const digits = /^\d+$/.test(q);
  const letters = /^[a-z]+$/i.test(lower);
  const found = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const symbol = row[0];
    const name = row[1];
    const initials = row[2] || "";
    const alias = row[3] || "";
    let rank = 99;
    if (digits) {
      if (symbol === q) rank = 0;
      else if (symbol.startsWith(q)) rank = 1;
    }
    if (letters && initials) {
      if (initials === lower) rank = Math.min(rank, 2);
      else if (initials.startsWith(lower)) rank = Math.min(rank, 3);
    }
    if (name === q || alias === q) rank = Math.min(rank, 4);
    else if (name.startsWith(q) || (alias && alias.startsWith(q))) rank = Math.min(rank, 5);
    else if (name.includes(q) || (alias && alias.includes(q))) rank = Math.min(rank, 6);
    if (rank === 99) continue;
    found.push({ rank, symbol, name, initials, alias });
  }
  found.sort((a, b) => a.rank - b.rank || a.initials.length - b.initials.length || (a.symbol < b.symbol ? -1 : 1));
  return found.slice(0, 8).map((item) => ({
    symbol: item.symbol,
    name: item.name,
    market: item.symbol.startsWith("5") || item.symbol.startsWith("6") || item.symbol.startsWith("9") ? "sh" : "sz",
    label: item.symbol.startsWith("5") || item.symbol.startsWith("6") || item.symbol.startsWith("9") ? "沪" : "深",
  }));
}


export const MIN_CATALOG = 2000;
const catalogCache = new WeakMap();

export function catalogProblem(rows) {
  if (!Array.isArray(rows) || rows.length < MIN_CATALOG) return "名单不完整";
  const seen = new Set();
  let found = false;
  for (const row of rows) {
    if (!Array.isArray(row)) return "名单格式无效";
    const symbol = String(row[0] || "");
    const name = String(row[1] || "").trim();
    if (!/^\d{6}$/.test(symbol) || !name || seen.has(symbol)) return "名单格式无效";
    seen.add(symbol);
    if (symbol === "515100" && name) found = true;
  }
  if (!found) return "缺少515100";
  return "";
}

async function encodeCatalog(rows) {
  const stream = new Blob([JSON.stringify(rows)]).stream().pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  const b64 = btoa(binary);
  const parts = [];
  for (let i = 0; i < b64.length; i += 48000) parts.push(b64.slice(i, i + 48000));
  return parts;
}

async function decodeCatalog(parts) {
  const b64 = parts.map((part) => part.data || "").join("");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  const text = await new Response(stream).text();
  return JSON.parse(text);
}

async function logRefresh(env, ok, message) {
  try {
    await env.DB.prepare(SQL.insertRefreshLog).bind(new Date().toISOString(), ok ? 1 : 0, clipText(message, 200)).run();
  } catch {
    // a log failure must not change search
  }
}

async function loadCatalog(env) {
  const cached = catalogCache.get(env.DB);
  try {
    const meta = await env.DB.prepare(SQL.catalogMeta).first();
    if (!meta || Number(meta.count) < MIN_CATALOG || !meta.generation) return cached || SYMBOLS;
    if (cached && cached.generation === meta.generation) return cached.rows;
    const parts = await env.DB.prepare(SQL.catalogParts).bind(meta.generation).all();
    const rows = await decodeCatalog(parts.results || []);
    if (catalogProblem(rows)) return cached || SYMBOLS;
    catalogCache.set(env.DB, { generation: meta.generation, rows });
    return rows;
  } catch {
    return cached || SYMBOLS;
  }
}

async function storeCatalog(env, rows) {
  const parts = await encodeCatalog(rows);
  const current = await env.DB.prepare(SQL.catalogMeta).first();
  const generation = Number(current && current.generation) + 1 || 1;
  for (let i = 0; i < parts.length; i++) {
    await env.DB.prepare(SQL.insertCatalogPart).bind(generation, i, parts[i]).run();
  }
  const now = new Date().toISOString();
  await env.DB.prepare(SQL.upsertCatalogMeta).bind(generation, rows.length, parts.length, now).run();
  catalogCache.set(env.DB, { generation, rows });
  try {
    await env.DB.prepare(SQL.deleteOldCatalog).bind(generation).run();
  } catch {
    // old generations are unused once meta moves
  }
  await logRefresh(env, true, "已更新 " + rows.length);
  return { count: rows.length, generation };
}

async function replaceCatalog(request, env) {
  if (!authorized(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
  const bodyRead = await readText(request, 2000000);
  if (bodyRead.error) return bodyRead.error;
  let body;
  try {
    body = JSON.parse(bodyRead.text || "{}");
  } catch {
    return json({ ok: false, error: "请求无效" }, 400);
  }
  if (body && body.error && !body.rows) {
    await logRefresh(env, false, String(body.error));
    return json({ ok: false, kept: true });
  }
  const problem = catalogProblem(body && body.rows);
  if (problem) {
    await logRefresh(env, false, problem);
    return json({ ok: false, error: problem, kept: true }, 400);
  }
  try {
    const saved = await storeCatalog(env, body.rows);
    return json({ ok: true, count: saved.count, generation: saved.generation });
  } catch {
    await logRefresh(env, false, "写入失败");
    return json({ ok: false, error: "写入失败", kept: true }, 500);
  }
}

async function catalogStatus(request, env) {
  if (!authorized(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
  try {
    const meta = await env.DB.prepare(SQL.catalogMeta).first();
    if (!meta) return json({ ok: true, count: 0, generation: 0, source: "bundle" });
    return json({
      ok: true,
      count: meta.count,
      generation: meta.generation,
      updated_at: meta.updated_at,
      source: "d1",
    });
  } catch {
    return json({ ok: true, count: 0, source: "bundle" });
  }
}

async function suggestPicks(request, env) {
  const session = await getSession(request, env);
  if (!session) return json({ ok: false, error: "请先登录" }, 401);
  const raw = new URL(request.url).searchParams.get("q") || "";
  const rows = await loadCatalog(env);
  return json({ ok: true, items: searchSymbols(raw, rows) });
}

async function resolveName(env, userId, symbol) {
  if (env.LOOKUP_NAMES === "1") {
    try {
      const quoted = await lookupQuoteName(symbol);
      if (quoted) return clipText(quoted, 32);
    } catch {
      // keep a local name
    }
  }
  const notes = await loadNotes(env, userId);
  for (const row of notes) {
    const stocks = parsePayload(row.payload).stocks || [];
    const hit = stocks.find((stock) => stock && stock.symbol === symbol && stock.name);
    if (hit) return clipText(String(hit.name), 32);
  }
  return symbol;
}


async function applyOrder(env, userId, symbols) {
  if (!Array.isArray(symbols)) return { error: "请求无效" };
  const rows = await loadPicks(env, userId);
  const have = new Set(rows.map((row) => row.symbol));
  const next = [];
  for (const raw of symbols) {
    const symbol = normalizeSymbol(typeof raw === "string" ? raw : "");
    if (!symbol || !have.has(symbol) || next.includes(symbol)) continue;
    next.push(symbol);
  }
  for (const row of rows) {
    if (!next.includes(row.symbol)) next.push(row.symbol);
  }
  for (let i = 0; i < next.length; i++) {
    await env.DB.prepare(SQL.updatePickPos).bind(i, userId, next[i]).run();
  }
  return { ok: true };
}

async function applyPick(env, userId, op, symbolRaw) {
  const symbol = normalizeSymbol(symbolRaw);
  if (!symbol) return { error: "代码须为6位数字" };
  const rows = await loadPicks(env, userId);
  if (op === "add") {
    if (rows.some((row) => row.symbol === symbol)) return { error: "已在列表中" };
    if (rows.length >= 30) return { error: "最多 30 只" };
    const name = await resolveName(env, userId, symbol);
    const position = rows.length ? Math.max(...rows.map((row) => Number(row.position) || 0)) + 1 : 0;
    try {
      await env.DB.prepare(SQL.insertPick)
        .bind(userId, symbol, name, position, new Date().toISOString())
        .run();
    } catch (err) {
      if (String((err && err.message) || err).includes("UNIQUE")) return { error: "已在列表中" };
      throw err;
    }
    return { ok: true };
  }
  if (op === "delete") {
    await env.DB.prepare(SQL.deletePick).bind(userId, symbol).run();
    return { ok: true };
  }
  if (op === "up" || op === "down") {
    const ordered = rows
      .slice()
      .sort((a, b) => Number(a.position) - Number(b.position) || String(a.symbol).localeCompare(String(b.symbol)));
    const index = ordered.findIndex((row) => row.symbol === symbol);
    if (index < 0) return { error: "不在列表中" };
    const next = op === "up" ? index - 1 : index + 1;
    if (next < 0 || next >= ordered.length) return { ok: true };
    const swapped = ordered.slice();
    const hold = swapped[index];
    swapped[index] = swapped[next];
    swapped[next] = hold;
    for (let i = 0; i < swapped.length; i++) {
      await env.DB.prepare(SQL.updatePickPos).bind(i, userId, swapped[i].symbol).run();
    }
    return { ok: true };
  }
  return { error: "请求无效" };
}

async function picksPost(request, env, asForm) {
  const session = await getSession(request, env);
  if (!session) {
    if (asForm) return redirect("/login");
    return json({ ok: false, error: "请先登录" }, 401);
  }
  let op = "";
  let symbol = "";
  let symbols = [];
  if (asForm) {
    const bodyRead = await readText(request, 4096);
    if (bodyRead.error) return redirect("/picks?e=bad");
    let form;
    try {
      form = parseForm(bodyRead.text || "");
    } catch {
      return redirect("/picks?e=bad");
    }
    op = form.op || "";
    symbol = form.symbol || "";
  } else {
    const bodyRead = await readJson(request, 8192);
    if (bodyRead.error) return bodyRead.error;
    op = bodyRead.data.op || "";
    symbol = bodyRead.data.symbol || "";
    symbols = Array.isArray(bodyRead.data.symbols) ? bodyRead.data.symbols : [];
  }
  const result = op === "order"
    ? await applyOrder(env, session.user_id, asForm ? [] : symbols)
    : await applyPick(env, session.user_id, op, symbol);
  if (asForm) {
    if (result.error) return redirect("/picks?e=" + encodeURIComponent(result.error));
    return redirect("/picks");
  }
  if (result.error) return json({ ok: false, error: result.error }, 400);
  const picks = await loadPicks(env, session.user_id);
  return json({ ok: true, picks });
}

async function saveRemark(request, env) {
  const session = await getSession(request, env);
  if (!session) return json({ ok: false, error: "请先登录" }, 401);
  const bodyRead = await readJson(request, 8000);
  if (bodyRead.error) return bodyRead.error;
  const body = bodyRead.data || {};
  if (!validDate(body.session_date) || !validSession(body.session)) {
    return json({ ok: false, error: "请求无效" }, 400);
  }
  const symbol = normalizeSymbol(body.symbol || "");
  if (!symbol) return json({ ok: false, error: "代码须为6位数字" }, 400);
  const text = clipText(String(body.text || "").replace(/\s+/g, " ").trim(), 80);
  const now = new Date().toISOString();
  if (!text) {
    await env.DB.prepare(SQL.deleteRemark).bind(session.user_id, body.session_date, body.session, symbol).run();
    return json({ ok: true });
  }
  await env.DB.prepare(SQL.upsertRemark)
    .bind(session.user_id, body.session_date, body.session, symbol, text, now)
    .run();
  return json({ ok: true });
}

async function saveJournal(request, env) {
  const session = await getSession(request, env);
  if (!session) return json({ ok: false, error: "请先登录" }, 401);
  const bodyRead = await readJson(request, 8000);
  if (bodyRead.error) return bodyRead.error;
  const body = bodyRead.data || {};
  if (!validDate(body.session_date)) return json({ ok: false, error: "请求无效" }, 400);
  const text = clipText(String(body.text || "").replace(/\r\n/g, "\n").trim(), 500);
  await env.DB.prepare(SQL.upsertJournal)
    .bind(session.user_id, body.session_date, text, new Date().toISOString())
    .run();
  return json({ ok: true });
}

async function writeReport(request, env) {
  if (!authorized(request, env)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "bad json" }, { status: 400 });
  }
  const session = body.session;
  const sessionDate = body.session_date;
  if (session !== "open" && session !== "close") {
    return Response.json({ ok: false, error: "session must be open or close" }, { status: 400 });
  }
  if (typeof sessionDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) {
    return Response.json({ ok: false, error: "session_date must be YYYY-MM-DD" }, { status: 400 });
  }
  if (!Array.isArray(body.stocks)) {
    return Response.json({ ok: false, error: "stocks must be an array" }, { status: 400 });
  }
  const createdAt = new Date().toISOString();
  const payload = JSON.stringify({
    session_date: sessionDate,
    session,
    title: body.title || "",
    stocks: body.stocks,
  });
  await env.DB.prepare(
    `INSERT INTO snapshots (session_date, session, created_at, payload)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(session_date, session) DO UPDATE SET
       created_at = excluded.created_at,
       payload = excluded.payload`
  ).bind(sessionDate, session, createdAt, payload).run();
  return Response.json({ ok: true, session_date: sessionDate, session });
}

async function writeUserNote(request, env) {
  if (!authorized(request, env)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  const bodyRead = await readJson(request, 500000);
  if (bodyRead.error) return bodyRead.error;
  const body = bodyRead.data || {};
  const userId = Number(body.user_id);
  if (!Number.isInteger(userId) || userId < 1) return json({ ok: false, error: "用户不存在" }, 400);
  const user = await env.DB.prepare(SQL.userById).bind(userId).first();
  if (!user || !user.enabled) return json({ ok: false, error: "用户不存在" }, 400);
  if (!validSession(body.session) || !validDate(body.session_date)) {
    return json({ ok: false, error: "请求无效" }, 400);
  }
  if (!Array.isArray(body.stocks) || body.stocks.length > 30) {
    return json({ ok: false, error: "stocks must be an array" }, 400);
  }
  const stocks = body.stocks.map(cleanStock);
  const createdAt = new Date().toISOString();
  const payload = JSON.stringify({
    title: typeof body.title === "string" ? body.title : body.session,
    stocks,
  });
  await env.DB.prepare(SQL.upsertNote)
    .bind(userId, body.session_date, body.session, createdAt, payload)
    .run();
  return json({ ok: true, user_id: userId, session_date: body.session_date, session: body.session });
}

async function listWatchlists(request, env) {
  if (!authorized(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
  const users = await env.DB.prepare(SQL.listEnabledUsers).all();
  const out = [];
  for (const user of users.results || []) {
    const picks = await loadPicks(env, user.id);
    out.push({
      id: user.id,
      login: user.login,
      display_name: user.display_name,
      role: user.role,
      picks: picks.map((pick) => ({
        symbol: pick.symbol,
        name: pick.name,
        position: pick.position,
      })),
    });
  }
  return json({ ok: true, users: out });
}

async function listUserReports(request, env) {
  const session = await getSession(request, env);
  if (!session) return json({ ok: false, error: "请先登录" }, 401);
  const rows = await loadNotes(env, session.user_id);
  const items = rows.map((row) => {
    const payload = parsePayload(row.payload);
    return {
      session_date: row.session_date,
      session: row.session,
      created_at: row.created_at,
      title: payload.title || "",
      stocks: payload.stocks || [],
    };
  });
  return json({ items });
}

function buildDayModel(rows, date, remarks, journal) {
  const sessions = {};
  for (const row of rows) {
    if (row.session_date === date) sessions[row.session] = row;
  }
  const remarkMap = {};
  for (const remark of remarks) {
    remarkMap[remark.session + ":" + remark.symbol] = remark.text || "";
  }
  const messages = [];
  let open = null;
  let close = null;
  for (const key of ["open", "close"]) {
    if (!sessions[key]) continue;
    const stocks = parsePayload(sessions[key].payload).stocks || [];
    const label = key === "open" ? "开盘" : "收盘";
    messages.push(sessionMessage(label, stocks, prevStocks(rows, key, date), true));
    const prev = zoneMap(prevStocks(rows, key, date));
    const views = stocks.map((stock) =>
      viewStock(stock, key, date, prev, remarkMap[key + ":" + stock.symbol] || "")
    );
    if (key === "open") open = views;
    else close = views;
  }
  return {
    date,
    label: formatCnDate(date),
    messages,
    open,
    close,
    journal: journal || "",
  };
}


const MAX_AVATAR = 120000;

function validAvatar(data) {
  if (typeof data !== "string" || data.length < 32 || data.length > MAX_AVATAR) return false;
  return /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(data);
}

async function loadAvatar(env, userId) {
  const row = await env.DB.prepare(SQL.avatarGet).bind(userId).first();
  return row && row.data ? row.data : "";
}

async function saveAvatar(request, env) {
  const session = await getSession(request, env);
  if (!session) return json({ ok: false, error: "请先登录" }, 401);
  const bodyRead = await readJson(request, MAX_AVATAR + 2000);
  if (bodyRead.error) return bodyRead.error;
  const image = bodyRead.data && bodyRead.data.image;
  if (!validAvatar(image)) return json({ ok: false, error: "请选择一张图片" }, 400);
  await env.DB.prepare(SQL.upsertAvatar)
    .bind(session.user_id, image, new Date().toISOString())
    .run();
  return json({ ok: true });
}

async function renderAdmin(env, session, error) {
  const rows = await env.DB.prepare(SQL.listUsers).all();
  const users = (rows.results || []).filter((u) => u.role !== "admin");
  return html(adminPage(session, users, error || ""));
}

async function gateApp(request, env) {
  const gate = await requireUser(request, env);
  if (gate.error) return gate;
  if (gate.session.role === "admin") return { error: redirect("/") };
  return gate;
}

async function pageNotes(request, env) {
  const gate = await requireUser(request, env);
  if (gate.error) return gate.error;
  if (gate.session.role === "admin") {
    const error = new URL(request.url).searchParams.get("e") || "";
    return renderAdmin(env, gate.session, error.slice(0, 80));
  }
  const rows = await loadNotes(env, gate.session.user_id);
  const days = groupDays(rows).map((day) => ({
    date: day.date,
    label: formatCnDate(day.date),
    message: dayMessage(rows, day.date, day.sessions),
    open: !!day.sessions.open,
    close: !!day.sessions.close,
  }));
  return html(notesPage(gate.session, days));
}

async function pageDay(request, env, date) {
  const gate = await gateApp(request, env);
  if (gate.error) return gate.error;
  const rows = await loadNotes(env, gate.session.user_id);
  const remarkRows = await env.DB.prepare(SQL.remarksForDay).bind(gate.session.user_id, date).all();
  const journal = await env.DB.prepare(SQL.journalGet).bind(gate.session.user_id, date).first();
  const model = buildDayModel(rows, date, remarkRows.results || [], journal ? journal.text : "");
  return html(dayPage(gate.session, model));
}

async function pagePicks(request, env, error) {
  const gate = await gateApp(request, env);
  if (gate.error) return gate.error;
  const picks = await loadPicks(env, gate.session.user_id);
  return html(picksPage(gate.session, picks, error));
}

async function pageMe(request, env) {
  const gate = await gateApp(request, env);
  if (gate.error) return gate.error;
  const avatar = await loadAvatar(env, gate.session.user_id);
  return html(mePage(gate.session, avatar));
}

async function pageAvatar(request, env) {
  const gate = await gateApp(request, env);
  if (gate.error) return gate.error;
  const avatar = await loadAvatar(env, gate.session.user_id);
  return html(avatarPage(gate.session, avatar));
}

async function pageCompare(request, env, symbol, url) {
  const gate = await gateApp(request, env);
  if (gate.error) return gate.error;
  const sessionName = url.searchParams.get("session") === "open" ? "open" : "close";
  const date = validDate(url.searchParams.get("date") || "") ? url.searchParams.get("date") : "";
  const rows = await loadNotes(env, gate.session.user_id);
  const matched = [];
  const ordered = rows
    .filter((row) => row.session === sessionName)
    .slice()
    .sort((a, b) => (a.session_date < b.session_date ? 1 : -1));
  for (const row of ordered) {
    const stocks = parsePayload(row.payload).stocks || [];
    const stock = stocks.find((item) => item && item.symbol === symbol);
    if (!stock) continue;
    matched.push({ date: row.session_date, stock });
    if (matched.length >= 5) break;
  }
  matched.reverse();
  const viewRows = matched.map((item, index) => {
    const prev = index > 0 ? matched[index - 1].stock.zone || "" : "";
    const zone = item.stock.zone || "";
    const zoneText = prev && prev !== zone ? "前一日 " + prev + " → 当日 " + zone : zone;
    return {
      label: formatCnDate(item.date),
      zone: zoneText,
      price: fmtPrice(item.stock.price),
      change: fmtPct(item.stock.change_pct) || "—",
      dir: direction(item.stock.change_pct),
      chips: chipsFor(item.stock),
    };
  });
  const latest = matched.length ? matched[matched.length - 1].stock : null;
  const back = date ? "/d/" + date : "/";
  return html(
    comparePage(gate.session, {
      symbol,
      name: (latest && latest.name) || symbol,
      session: sessionName,
      date,
      back,
      rows: viewRows,
    })
  );
}


async function adminEnabledForm(request, env, id) {
  const gate = await requireUser(request, env);
  if (gate.error) return gate.error;
  if (gate.session.role !== "admin") return redirect("/");
  const bodyRead = await readText(request, 2048);
  if (bodyRead.error) return redirect("/");
  const form = parseForm(bodyRead.text);
  const target = await env.DB.prepare(SQL.userById).bind(id).first();
  if (!target || target.role === "admin") return redirect("/?e=" + encodeURIComponent("不能停用管理员"));
  const enabled = form.enabled === "1";
  const result = await applyEnabledChange(env, gate.session, target, enabled);
  if (result.error) return redirect("/?e=" + encodeURIComponent(result.error));
  return redirect("/");
}

async function adminResetGet(request, env, id) {
  const gate = await requireUser(request, env);
  if (gate.error) return gate.error;
  if (gate.session.role !== "admin") return redirect("/");
  const target = await env.DB.prepare(SQL.userById).bind(id).first();
  if (!target || target.role === "admin") return redirect("/");
  const code = new URL(request.url).searchParams.get("e") || "";
  const error = code === "mismatch" ? "两次输入的密码不一致" : code === "bad" ? "密码须为8到72个字符" : "";
  return html(adminResetPage(target, error));
}

async function adminResetPost(request, env, id) {
  const gate = await requireUser(request, env);
  if (gate.error) return gate.error;
  if (gate.session.role !== "admin") return redirect("/");
  const target = await env.DB.prepare(SQL.userById).bind(id).first();
  if (!target || target.role === "admin") return redirect("/");
  const bodyRead = await readText(request, 2048);
  if (bodyRead.error) return redirect("/reset/" + id + "?e=bad");
  const form = parseForm(bodyRead.text);
  if (form.password !== form.confirm) return redirect("/reset/" + id + "?e=mismatch");
  const result = await applyAdminPassword(env, gate.session, target, form.password);
  if (result.error) return redirect("/reset/" + id + "?e=bad");
  return redirect("/");
}

async function handle(request, env) {
  await ensureSchema(env);
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === "GET" && path === "/app.css") {
    return new Response(APP_CSS, {
      headers: {
        "content-type": "text/css; charset=utf-8",
        "cache-control": "no-cache",
        "x-content-type-options": "nosniff",
      },
    });
  }
  if (request.method === "POST" && path === "/api/reports") return writeReport(request, env);
  if (request.method === "GET" && path === "/api/reports") return listUserReports(request, env);
  if (request.method === "POST" && path === "/api/internal/notes") return writeUserNote(request, env);
  if (request.method === "POST" && path === "/api/internal/symbols") return replaceCatalog(request, env);
  if (request.method === "GET" && path === "/api/internal/symbols") return catalogStatus(request, env);
  if (request.method === "GET" && path === "/api/internal/watchlists") return listWatchlists(request, env);
  if (request.method === "POST" && path === "/api/login") return loginJson(request, env);
  if (request.method === "POST" && path === "/login") return loginForm(request, env);
  if (request.method === "POST" && path === "/api/signup") return signupJson(request, env);
  if (request.method === "POST" && path === "/signup") return signupForm(request, env);
  if (request.method === "POST" && path === "/api/logout") return logout(request, env, false);
  if (request.method === "POST" && path === "/logout") return logout(request, env, true);
  if (request.method === "GET" && path === "/api/me") {
    const session = await getSession(request, env);
    if (!session) return json({ ok: false, error: "请先登录" }, 401);
    return json({
      ok: true,
      login: session.login,
      display_name: session.display_name,
      role: session.role,
    });
  }
  if (request.method === "POST" && path === "/api/account/password") return changePasswordJson(request, env);
  if (request.method === "POST" && path === "/account/password") return changePasswordForm(request, env);
  if (path === "/api/admin/users" || path.startsWith("/api/admin/users/")) {
    return adminUsers(request, env, path);
  }
  const enabledForm = path.match(/^\/admin\/users\/(\d+)\/enabled$/);
  if (request.method === "POST" && enabledForm) {
    return adminEnabledForm(request, env, Number(enabledForm[1]));
  }
  const resetForm = path.match(/^\/reset\/(\d+)$/);
  if (resetForm && request.method === "GET") return adminResetGet(request, env, Number(resetForm[1]));
  if (resetForm && request.method === "POST") return adminResetPost(request, env, Number(resetForm[1]));
  if (request.method === "GET" && path === "/api/picks/suggest") return suggestPicks(request, env);
  if (request.method === "POST" && path === "/api/picks") return picksPost(request, env, false);
  if (request.method === "POST" && path === "/picks") return picksPost(request, env, true);
  if (request.method === "POST" && path === "/api/avatar") return saveAvatar(request, env);
  if (request.method === "POST" && path === "/api/remarks") return saveRemark(request, env);
  if (request.method === "POST" && path === "/api/journal") return saveJournal(request, env);
  if (request.method === "GET" && (path === "/login" || path === "/signup")) {
    const session = await getSession(request, env);
    if (session) return redirect("/");
    if (path === "/signup") return html(signupPage(signupErrorText(url.searchParams.get("e") || "")));
    const loginError = url.searchParams.get("e") === "1" ? "登录名或密码不正确" : "";
    return html(loginPage(loginError));
  }
  if (request.method === "GET" && (path === "/" || path === "/index.html")) return pageNotes(request, env);
  if (request.method === "GET" && path === "/picks") {
    return pagePicks(request, env, url.searchParams.get("e") || "");
  }
  if (request.method === "GET" && path === "/me") return pageMe(request, env);
  if (request.method === "GET" && path === "/avatar") return pageAvatar(request, env);
  if (request.method === "GET" && path === "/account") return redirect("/me");
  const dayMatch = path.match(/^\/d\/(\d{4}-\d{2}-\d{2})$/);
  if (request.method === "GET" && dayMatch) return pageDay(request, env, dayMatch[1]);
  const compareMatch = path.match(/^\/c\/(\d{6})$/);
  if (request.method === "GET" && compareMatch) return pageCompare(request, env, compareMatch[1], url);
  return new Response("not found", { status: 404, headers: { "cache-control": "no-store" } });
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (err) {
      console.error("worker error", err && err.message ? err.message : "failed");
      return json({ ok: false, error: "服务器错误" }, 500);
    }
  },
};
