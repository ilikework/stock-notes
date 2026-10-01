import test from "node:test";
import assert from "node:assert/strict";
import worker, {
  SQL,
  hashPassword,
  verifyPassword,
  validateLogin,
  validateDisplayName,
  validatePassword,
  hashToken,
  sessionCookieHeader,
  PBKDF2_ITERATIONS,
  MAX_USERS,
  COOKIE_NAME,
  parseSinaSuggest,
  searchSymbols,
  catalogProblem,
} from "../src/index.js";
import { markSuggestions } from "../src/pages.js";

function norm(sql) {
  return sql.replace(/\s+/g, " ").trim();
}

class MockDB {
  constructor() {
    this.users = [];
    this.sessions = [];
    this.snapshots = [];
    this.notes = [];
    this.picks = [];
    this.remarks = [];
    this.journals = [];
    this.avatars = [];
    this.catalogParts = [];
    this.catalogMeta = null;
    this.refreshLog = [];
    this.ids = { users: 1, sessions: 1, snapshots: 1 };
  }
  prepare(sql) {
    const text = norm(sql);
    const stmt = (args) => ({
      first: async () => this.exec(text, args, "first"),
      all: async () => ({ results: this.exec(text, args, "all") }),
      run: async () => this.exec(text, args, "run"),
    });
    return { ...stmt([]), bind: (...args) => stmt(args) };
  }
  exec(sql, args, mode) {
    const n = (s) => norm(s);
    if (sql === n(SQL.userByLogin)) {
      const login = String(args[0]).toLowerCase();
      const row = this.users.find((u) => u.login.toLowerCase() === login) || null;
      return mode === "first" ? row : [row].filter(Boolean);
    }
    if (sql === n(SQL.userById)) {
      const row = this.users.find((u) => u.id === args[0]) || null;
      return row;
    }
    if (sql === n(SQL.countUsers)) return { n: this.users.length };
    if (sql === n(SQL.countEnabledAdmins)) {
      return { n: this.users.filter((u) => u.role === "admin" && u.enabled).length };
    }
    if (sql === n(SQL.listUsers)) {
      return this.users
        .slice()
        .sort((a, b) => a.id - b.id)
        .map((u) => ({
          id: u.id,
          login: u.login,
          display_name: u.display_name,
          role: u.role,
          enabled: u.enabled,
          created_at: u.created_at,
        }));
    }
    if (sql === n(SQL.insertUser)) {
      const login = args[0];
      if (this.users.some((u) => u.login.toLowerCase() === login.toLowerCase())) {
        throw new Error("UNIQUE constraint failed: users.login");
      }
      this.users.push({
        id: this.ids.users++,
        login,
        display_name: args[1],
        role: "user",
        enabled: 1,
        password_hash: args[2],
        password_salt: args[3],
        password_iters: args[4],
        created_at: args[5],
        updated_at: args[6],
      });
      return { success: true };
    }
    if (sql === n(SQL.updatePassword)) {
      const user = this.users.find((u) => u.id === args[4]);
      if (user) {
        user.password_hash = args[0];
        user.password_salt = args[1];
        user.password_iters = args[2];
        user.updated_at = args[3];
      }
      return { success: true };
    }
    if (sql === n(SQL.updateEnabled)) {
      const user = this.users.find((u) => u.id === args[2]);
      if (user) {
        user.enabled = args[0];
        user.updated_at = args[1];
      }
      return { success: true };
    }
    if (sql === n(SQL.insertSession)) {
      this.sessions.push({
        id: this.ids.sessions++,
        user_id: args[0],
        token_hash: args[1],
        expires_at: args[2],
        created_at: args[3],
      });
      return { success: true };
    }
    if (sql === n(SQL.sessionByHash)) {
      const session = this.sessions.find((s) => s.token_hash === args[0]);
      if (!session) return null;
      const user = this.users.find((u) => u.id === session.user_id);
      if (!user) return null;
      return {
        expires_at: session.expires_at,
        user_id: user.id,
        login: user.login,
        display_name: user.display_name,
        role: user.role,
        enabled: user.enabled,
      };
    }
    if (sql === n(SQL.deleteSession)) {
      this.sessions = this.sessions.filter((s) => s.token_hash !== args[0]);
      return { success: true };
    }
    if (sql === n(SQL.deleteUserSessions)) {
      this.sessions = this.sessions.filter((s) => s.user_id !== args[0]);
      return { success: true };
    }
    if (sql === n(SQL.deleteExpired)) {
      this.sessions = this.sessions.filter((s) => !(s.expires_at < args[0]));
      return { success: true };
    }
    if (sql.startsWith("INSERT INTO snapshots")) {
      const [sessionDate, session, createdAt, payload] = args;
      const idx = this.snapshots.findIndex(
        (s) => s.session_date === sessionDate && s.session === session
      );
      if (idx === -1) {
        this.snapshots.push({
          id: this.ids.snapshots++,
          session_date: sessionDate,
          session,
          created_at: createdAt,
          payload,
        });
      } else {
        this.snapshots[idx].created_at = createdAt;
        this.snapshots[idx].payload = payload;
      }
      return { success: true };
    }
    if (sql.startsWith("SELECT session_date, session, created_at, payload") && sql.includes("FROM snapshots")) {
      const rows = this.snapshots
        .slice()
        .sort((a, b) => {
          if (a.session_date !== b.session_date) return a.session_date < b.session_date ? 1 : -1;
          if (a.session !== b.session) return a.session < b.session ? 1 : -1;
          return 0;
        })
        .slice(0, 30);
      return rows;
    }
    if (sql === n(SQL.listEnabledUsers)) {
      return this.users
        .filter((u) => u.enabled)
        .slice()
        .sort((a, b) => a.id - b.id)
        .map((u) => ({
          id: u.id,
          login: u.login,
          display_name: u.display_name,
          role: u.role,
        }));
    }
    if (sql === n(SQL.notesByUser)) {
      return this.notes
        .filter((row) => row.user_id === args[0])
        .slice()
        .sort((a, b) => {
          if (a.session_date !== b.session_date) return a.session_date < b.session_date ? 1 : -1;
          if (a.session !== b.session) return a.session < b.session ? 1 : -1;
          return 0;
        })
        .slice(0, 80);
    }
    if (sql === n(SQL.upsertNote)) {
      const [userId, sessionDate, session, createdAt, payload] = args;
      const idx = this.notes.findIndex(
        (row) => row.user_id === userId && row.session_date === sessionDate && row.session === session
      );
      if (idx === -1) {
        this.notes.push({
          user_id: userId,
          session_date: sessionDate,
          session,
          created_at: createdAt,
          payload,
        });
      } else {
        this.notes[idx].created_at = createdAt;
        this.notes[idx].payload = payload;
      }
      return { success: true };
    }
    if (sql === n(SQL.remarksForDay)) {
      return this.remarks
        .filter((row) => row.user_id === args[0] && row.session_date === args[1])
        .map((row) => ({ session: row.session, symbol: row.symbol, text: row.text }));
    }
    if (sql === n(SQL.upsertRemark)) {
      const [userId, sessionDate, session, symbol, remarkText, updatedAt] = args;
      const idx = this.remarks.findIndex(
        (row) =>
          row.user_id === userId &&
          row.session_date === sessionDate &&
          row.session === session &&
          row.symbol === symbol
      );
      if (idx === -1) {
        this.remarks.push({
          user_id: userId,
          session_date: sessionDate,
          session,
          symbol,
          text: remarkText,
          updated_at: updatedAt,
        });
      } else {
        this.remarks[idx].text = remarkText;
        this.remarks[idx].updated_at = updatedAt;
      }
      return { success: true };
    }
    if (sql === n(SQL.deleteRemark)) {
      this.remarks = this.remarks.filter(
        (row) =>
          !(
            row.user_id === args[0] &&
            row.session_date === args[1] &&
            row.session === args[2] &&
            row.symbol === args[3]
          )
      );
      return { success: true };
    }
    if (sql === n(SQL.journalGet)) {
      const row = this.journals.find((item) => item.user_id === args[0] && item.session_date === args[1]);
      return row ? { text: row.text } : null;
    }
    if (sql === n(SQL.upsertJournal)) {
      const idx = this.journals.findIndex(
        (item) => item.user_id === args[0] && item.session_date === args[1]
      );
      if (idx === -1) {
        this.journals.push({
          user_id: args[0],
          session_date: args[1],
          text: args[2],
          updated_at: args[3],
        });
      } else {
        this.journals[idx].text = args[2];
        this.journals[idx].updated_at = args[3];
      }
      return { success: true };
    }
    if (sql === n(SQL.picksByUser)) {
      return this.picks
        .filter((row) => row.user_id === args[0])
        .slice()
        .sort((a, b) => Number(a.position) - Number(b.position) || String(a.symbol).localeCompare(String(b.symbol)))
        .map((row) => ({ symbol: row.symbol, name: row.name, position: row.position }));
    }
    if (sql === n(SQL.insertPick)) {
      if (this.picks.some((row) => row.user_id === args[0] && row.symbol === args[1])) {
        throw new Error("UNIQUE constraint failed: picks");
      }
      this.picks.push({
        user_id: args[0],
        symbol: args[1],
        name: args[2],
        position: args[3],
        created_at: args[4],
      });
      return { success: true };
    }
    if (sql === n(SQL.deletePick)) {
      this.picks = this.picks.filter((row) => !(row.user_id === args[0] && row.symbol === args[1]));
      return { success: true };
    }
    if (sql === n(SQL.updatePickPos)) {
      const row = this.picks.find((item) => item.user_id === args[1] && item.symbol === args[2]);
      if (row) row.position = args[0];
      return { success: true };
    }
    if (sql === n(SQL.avatarGet)) {
      const row = this.avatars.find((item) => item.user_id === args[0]);
      return row ? { data: row.data } : null;
    }
    if (sql === n(SQL.upsertAvatar)) {
      const idx = this.avatars.findIndex((item) => item.user_id === args[0]);
      if (idx === -1) this.avatars.push({ user_id: args[0], data: args[1], updated_at: args[2] });
      else {
        this.avatars[idx].data = args[1];
        this.avatars[idx].updated_at = args[2];
      }
      return { success: true };
    }
    if (sql === n(SQL.catalogMeta)) return this.catalogMeta;
    if (sql === n(SQL.catalogParts)) {
      return this.catalogParts
        .filter((part) => part.generation === args[0])
        .slice()
        .sort((a, b) => a.seq - b.seq)
        .map((part) => ({ seq: part.seq, data: part.data }));
    }
    if (sql === n(SQL.insertCatalogPart)) {
      this.catalogParts.push({ generation: args[0], seq: args[1], data: args[2] });
      return { success: true };
    }
    if (sql === n(SQL.upsertCatalogMeta)) {
      this.catalogMeta = {
        generation: args[0],
        count: args[1],
        parts: args[2],
        updated_at: args[3],
      };
      return { success: true };
    }
    if (sql === n(SQL.deleteOldCatalog)) {
      this.catalogParts = this.catalogParts.filter((part) => part.generation === args[0]);
      return { success: true };
    }
    if (sql === n(SQL.insertRefreshLog)) {
      this.refreshLog.push({ at: args[0], ok: args[1], message: args[2] });
      return { success: true };
    }
    throw new Error("unhandled sql: " + sql);

  }
}

function envWith(db, writeKey = "test-write-key") {
  return { DB: db, WRITE_KEY: writeKey };
}

async function seedAdmin(db, password = "AdminPassw0rd") {
  const hashed = await hashPassword(password);
  db.users.push({
    id: db.ids.users++,
    login: "admin",
    display_name: "管理员",
    role: "admin",
    enabled: 1,
    password_hash: hashed.hash,
    password_salt: hashed.salt,
    password_iters: hashed.iterations,
    created_at: "2026-09-30T00:00:00.000Z",
    updated_at: "2026-09-30T00:00:00.000Z",
  });
  return password;
}

async function login(db, loginName, password) {
  const res = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ login: loginName, password }),
    }),
    envWith(db)
  );
  const body = await res.json();
  const cookie = res.headers.get("set-cookie") || "";
  return { status: res.status, body, cookie };
}

function cookieHeader(setCookie) {
  const token = (setCookie.match(/sn_session=([^;]+)/) || [])[1];
  return token ? COOKIE_NAME + "=" + token : "";
}

test("password hash is salted PBKDF2 and verifies", async () => {
  const a = await hashPassword("correct-horse");
  const b = await hashPassword("correct-horse");
  assert.equal(a.iterations, PBKDF2_ITERATIONS);
  assert.equal(a.hash.length, 64);
  assert.equal(a.salt.length, 32);
  assert.notEqual(a.hash, b.hash);
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.hash, "correct-horse");
  assert.equal(await verifyPassword("correct-horse", a.salt, a.hash, a.iterations), true);
  assert.equal(await verifyPassword("wrong-horse!!", a.salt, a.hash, a.iterations), false);
});

test("login and display name validation", () => {
  assert.equal(validateLogin("admin"), null);
  assert.equal(validateLogin("user_01"), null);
  assert.equal(validateLogin("ab"), null);
  assert.ok(validateLogin("1"));
  assert.ok(validateLogin("13800138000"));
  assert.ok(validateLogin("phone123456789012345678901234567890"));
  assert.ok(validateLogin("管理员"));
  assert.ok(validateLogin("a b"));
  assert.ok(validateLogin(""));
  assert.equal(validateDisplayName("管理员"), null);
  assert.ok(validateDisplayName(""));
  assert.ok(validateDisplayName("x".repeat(33)));
  assert.equal(validatePassword("12345678"), null);
  assert.ok(validatePassword("short"));
  assert.ok(validatePassword("x".repeat(73)));
});

test("session cookie flags", () => {
  const c = sessionCookieHeader("ab".repeat(32));
  assert.match(c, /HttpOnly/);
  assert.match(c, /Secure/);
  assert.match(c, /SameSite=Lax/);
  assert.match(c, /Max-Age=2592000/);
  assert.match(c, /Path=\//);
});

test("logged out visitors only get the login page", async () => {
  const db = new MockDB();
  await seedAdmin(db);
  const home = await worker.fetch(new Request("https://stock-report.stocknotes.workers.dev/"), envWith(db));
  assert.equal(home.status, 303);
  assert.equal(home.headers.get("location"), "/login");
  const login = await worker.fetch(new Request("https://stock-report.stocknotes.workers.dev/login"), envWith(db));
  const text = await login.text();
  assert.equal(login.status, 200);
  assert.match(text, /盘面笔记/);
  assert.match(text, /数据仅供参考，不构成投资建议/);
  assert.match(text, /登录/);
  assert.match(text, /新建用户/);
  assert.match(text, /href="\/signup"/);
  assert.doesNotMatch(text, /区间变化/);
  assert.doesNotMatch(text, /正在读取/);
  const reports = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/reports"),
    envWith(db)
  );
  assert.equal(reports.status, 401);
  const reportsBody = await reports.json();
  assert.equal(reportsBody.ok, false);
  assert.equal("items" in reportsBody, false);
});

test("login stores only a token hash and opens the notes", async () => {
  const db = new MockDB();
  const password = await seedAdmin(db);
  const result = await login(db, "admin", password);
  assert.equal(result.status, 200);
  assert.equal(result.body.role, "admin");
  assert.match(result.cookie, /HttpOnly/);
  assert.match(result.cookie, /Secure/);
  assert.match(result.cookie, /SameSite=Lax/);
  const token = result.cookie.split(";")[0].split("=")[1];
  assert.equal(db.sessions.length, 1);
  assert.notEqual(db.sessions[0].token_hash, token);
  assert.equal(db.sessions[0].token_hash, await hashToken(token));
  assert.equal(db.users[0].password_hash.includes(password), false);
  const page = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/", {
      headers: { cookie: cookieHeader(result.cookie) },
    }),
    envWith(db)
  );
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(html, />账号</);
  assert.match(html, />退出</);
  assert.match(html, /数据仅供参考，不构成投资建议/);
  assert.doesNotMatch(html, /class="tabbar"/);
  assert.doesNotMatch(html, />笔记</);
  assert.doesNotMatch(html, />选股</);
  assert.doesNotMatch(html, />我的</);
  assert.doesNotMatch(html, /用户管理/);
  assert.match(html, /<span class="user">管理员<\/span>/);
  assert.doesNotMatch(html, /class="user"[^>]*href/);
  const reports = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/reports", {
      headers: { cookie: cookieHeader(result.cookie) },
    }),
    envWith(db)
  );
  assert.equal(reports.status, 200);
  const data = await reports.json();
  assert.deepEqual(data.items, []);
});

test("disabled user and bad password cannot log in", async () => {
  const db = new MockDB();
  const password = await seedAdmin(db);
  db.users[0].enabled = 0;
  const disabled = await login(db, "admin", password);
  assert.equal(disabled.status, 401);
  assert.equal(disabled.cookie.includes("sn_session="), false);
  db.users[0].enabled = 1;
  const bad = await login(db, "admin", "not-the-password");
  assert.equal(bad.status, 401);
  const missing = await login(db, "nobody", "12345678");
  assert.equal(missing.status, 401);
});

test("trial user can read notes and change password but not manage users", async () => {
  const db = new MockDB();
  await seedAdmin(db);
  const admin = await login(db, "admin", "AdminPassw0rd");
  const created = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/admin/users", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: cookieHeader(admin.cookie),
      },
      body: JSON.stringify({
        login: "13800138000",
        display_name: "手机号",
        password: "12345678",
        role: "admin",
      }),
    }),
    envWith(db)
  );
  assert.equal(created.status, 400);
  const ok = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/admin/users", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: cookieHeader(admin.cookie),
      },
      body: JSON.stringify({
        login: "trial1",
        display_name: "试用一",
        password: "trial-pass-1",
        role: "admin",
      }),
    }),
    envWith(db)
  );
  const createdBody = await ok.json();
  assert.equal(ok.status, 201);
  assert.equal(createdBody.role, "user");
  const list = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/admin/users", {
      headers: { cookie: cookieHeader(admin.cookie) },
    }),
    envWith(db)
  );
  const listText = await list.text();
  assert.equal(list.status, 200);
  assert.equal(listText.includes("password_hash"), false);
  assert.equal(listText.includes("trial-pass-1"), false);
  const userLogin = await login(db, "trial1", "trial-pass-1");
  assert.equal(userLogin.status, 200);
  assert.equal(userLogin.body.role, "user");
  const denied = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/admin/users", {
      headers: { cookie: cookieHeader(userLogin.cookie) },
    }),
    envWith(db)
  );
  assert.equal(denied.status, 403);
  const userPage = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/", {
      headers: { cookie: cookieHeader(userLogin.cookie) },
    }),
    envWith(db)
  );
  const userHtml = await userPage.text();
  assert.match(userHtml, />笔记</);
  assert.match(userHtml, />选股</);
  assert.match(userHtml, />我的</);
  assert.doesNotMatch(userHtml, /用户管理/);
  assert.doesNotMatch(userHtml, /class="user"[^>]*href/);
  const changed = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/account/password", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: cookieHeader(userLogin.cookie),
      },
      body: JSON.stringify({ current_password: "trial-pass-1", new_password: "trial-pass-2" }),
    }),
    envWith(db)
  );
  assert.equal(changed.status, 200);
  const newCookie = changed.headers.get("set-cookie");
  const oldStill = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/me", {
      headers: { cookie: cookieHeader(userLogin.cookie) },
    }),
    envWith(db)
  );
  assert.equal(oldStill.status, 401);
  const me = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/me", {
      headers: { cookie: cookieHeader(newCookie) },
    }),
    envWith(db)
  );
  assert.equal(me.status, 200);
  const oldPw = await login(db, "trial1", "trial-pass-1");
  assert.equal(oldPw.status, 401);
  const newPw = await login(db, "trial1", "trial-pass-2");
  assert.equal(newPw.status, 200);
});

test("admin disable and reset password", async () => {
  const db = new MockDB();
  await seedAdmin(db);
  const admin = await login(db, "admin", "AdminPassw0rd");
  await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader(admin.cookie) },
      body: JSON.stringify({ login: "trial2", display_name: "试用二", password: "trial-pass-2" }),
    }),
    envWith(db)
  );
  const user = await login(db, "trial2", "trial-pass-2");
  const id = db.users.find((u) => u.login === "trial2").id;
  const selfOff = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/admin/users/" + db.users[0].id + "/enabled", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader(admin.cookie) },
      body: JSON.stringify({ enabled: false }),
    }),
    envWith(db)
  );
  assert.equal(selfOff.status, 400);
  const off = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/admin/users/" + id + "/enabled", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader(admin.cookie) },
      body: JSON.stringify({ enabled: false }),
    }),
    envWith(db)
  );
  assert.equal(off.status, 200);
  const still = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/me", {
      headers: { cookie: cookieHeader(user.cookie) },
    }),
    envWith(db)
  );
  assert.equal(still.status, 401);
  const blocked = await login(db, "trial2", "trial-pass-2");
  assert.equal(blocked.status, 401);
  const on = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/admin/users/" + id + "/enabled", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader(admin.cookie) },
      body: JSON.stringify({ enabled: true }),
    }),
    envWith(db)
  );
  assert.equal(on.status, 200);
  const reset = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/admin/users/" + id + "/password", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader(admin.cookie) },
      body: JSON.stringify({ password: "reset-pass-9" }),
    }),
    envWith(db)
  );
  assert.equal(reset.status, 200);
  assert.equal((await login(db, "trial2", "trial-pass-2")).status, 401);
  assert.equal((await login(db, "trial2", "reset-pass-9")).status, 200);
  const capDb = new MockDB();
  await seedAdmin(capDb);
  const capAdmin = await login(capDb, "admin", "AdminPassw0rd");
  while (capDb.users.length < MAX_USERS) {
    capDb.users.push({
      id: capDb.ids.users++,
      login: "u" + capDb.users.length,
      display_name: "填充",
      role: "user",
      enabled: 1,
      password_hash: "x",
      password_salt: "00",
      password_iters: PBKDF2_ITERATIONS,
      created_at: "2026-09-30T00:00:00.000Z",
      updated_at: "2026-09-30T00:00:00.000Z",
    });
  }
  const capped = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader(capAdmin.cookie) },
      body: JSON.stringify({ login: "overflow", display_name: "超出", password: "12345678" }),
    }),
    envWith(capDb)
  );
  assert.equal(capped.status, 400);
});

test("form login and logout set cookies", async () => {
  const db = new MockDB();
  const password = await seedAdmin(db);
  const res = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "login=admin&password=" + encodeURIComponent(password),
    }),
    envWith(db)
  );
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/");
  const cookie = res.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/);
  const out = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/logout", {
      method: "POST",
      headers: { cookie: cookieHeader(cookie) },
    }),
    envWith(db)
  );
  assert.equal(out.status, 303);
  assert.equal(out.headers.get("location"), "/login");
  assert.match(out.headers.get("set-cookie"), /Max-Age=0/);
  const me = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/me", {
      headers: { cookie: cookieHeader(cookie) },
    }),
    envWith(db)
  );
  assert.equal(me.status, 401);
});

test("write API stays on the write key and keeps stock payload", async () => {
  const db = new MockDB();
  await seedAdmin(db);
  const session = await login(db, "admin", "AdminPassw0rd");
  const stocks = [
    {
      symbol: "600000",
      name: "浦发银行",
      price: 10.5,
      change_pct: 1.2,
      from_open_pct: -0.4,
      volume: 1,
      amount: 2,
      zone: "中性持有",
      reason: "区间",
      pe: 5,
      pb: 0.5,
      pe_pctl: 10,
      pb_pctl: 20,
      dy: 3,
      week52_pctl: 40,
    },
  ];
  const noKey = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/reports", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: cookieHeader(session.cookie),
      },
      body: JSON.stringify({ session_date: "2026-09-30", session: "open", title: "open", stocks }),
    }),
    envWith(db)
  );
  assert.equal(noKey.status, 401);
  const bad = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/reports", {
      method: "POST",
      headers: { authorization: "Bearer wrong", "content-type": "application/json" },
      body: JSON.stringify({ session_date: "2026-09-30", session: "open", title: "open", stocks }),
    }),
    envWith(db, "test-write-key")
  );
  assert.equal(bad.status, 401);
  const post = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/reports", {
      method: "POST",
      headers: { authorization: "Bearer test-write-key", "content-type": "application/json" },
      body: JSON.stringify({ session_date: "2026-09-30", session: "open", title: "open", stocks }),
    }),
    envWith(db, "test-write-key")
  );
  const posted = await post.json();
  assert.equal(post.status, 200);
  assert.deepEqual(posted, { ok: true, session_date: "2026-09-30", session: "open" });
  const stored = JSON.parse(db.snapshots[0].payload);
  assert.deepEqual(stored.stocks, stocks);
  assert.equal(stored.title, "open");
  const again = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/reports", {
      method: "POST",
      headers: { authorization: "Bearer test-write-key", "content-type": "application/json" },
      body: JSON.stringify({ session_date: "2026-09-30", session: "open", title: "open2", stocks: [] }),
    }),
    envWith(db, "test-write-key")
  );
  assert.equal(again.status, 200);
  assert.equal(db.snapshots.length, 1);
  assert.equal(JSON.parse(db.snapshots[0].payload).title, "open2");
  const missingSession = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/reports", {
      method: "POST",
      headers: { authorization: "Bearer test-write-key", "content-type": "application/json" },
      body: JSON.stringify({ session_date: "2026-09-30", session: "noon", stocks: [] }),
    }),
    envWith(db)
  );
  assert.equal(missingSession.status, 400);
  const listed = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/reports", {
      headers: { cookie: cookieHeader(session.cookie) },
    }),
    envWith(db)
  );
  const items = await listed.json();
  assert.equal(items.items.length, 0);
});

test("signup creates one user and enters the app", async () => {
  const db = new MockDB();
  await seedAdmin(db);
  const mismatch = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/signup", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "display_name=阿宁&login=aning&password=pass-word-1&confirm=other-pass",
    }),
    envWith(db)
  );
  assert.equal(mismatch.status, 303);
  assert.equal(mismatch.headers.get("location"), "/signup?e=mismatch");
  const page = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/signup?e=mismatch"),
    envWith(db)
  );
  const signupHtml = await page.text();
  assert.match(signupHtml, /再输入一次密码/);
  assert.match(signupHtml, /两次输入的密码不一致/);
  assert.match(signupHtml, /创建并进入/);
  const created = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        display_name: "阿宁",
        login: "aning",
        password: "pass-word-1",
        confirm: "pass-word-1",
        role: "admin",
      }),
    }),
    envWith(db)
  );
  const body = await created.json();
  assert.equal(created.status, 201);
  assert.equal(body.role, "user");
  assert.equal(body.login, "aning");
  assert.match(created.headers.get("set-cookie"), /HttpOnly/);
  const dup = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        display_name: "另一个",
        login: "aning",
        password: "pass-word-1",
        confirm: "pass-word-1",
      }),
    }),
    envWith(db)
  );
  assert.equal(dup.status, 409);
  const me = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/me", {
      headers: { cookie: cookieHeader(created.headers.get("set-cookie")) },
    }),
    envWith(db)
  );
  const meHtml = await me.text();
  assert.equal(me.status, 200);
  assert.match(meHtml, /阿宁/);
  assert.match(meHtml, /登录名 aning/);
  assert.match(meHtml, />退出</);
  assert.doesNotMatch(meHtml, />登录</);
  assert.doesNotMatch(meHtml, /这台手机不保存多个账号/);
  assert.doesNotMatch(meHtml, /切换/);
  assert.doesNotMatch(meHtml, /用户管理/);
  assert.match(meHtml, /设定头像/);
  assert.match(meHtml, /class="avatar">宁</);
  assert.match(meHtml, /<span class="user">阿宁<\/span>/);
  const css = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/app.css"),
    envWith(db)
  );
  const cssText = await css.text();
  assert.equal(css.status, 200);
  assert.match(cssText, /\.tabbar/);
  assert.match(cssText, /\.btn\.primary/);
  assert.match(meHtml, /href="\/app\.css"/);
});

test("picks are per user, capped at 30, and do not rewrite notes", async () => {
  const db = new MockDB();
  await seedAdmin(db);
  const admin = await login(db, "admin", "AdminPassw0rd");
  const created = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        display_name: "试用",
        login: "picker",
        password: "pick-pass-1",
        confirm: "pick-pass-1",
      }),
    }),
    envWith(db)
  );
  assert.equal(created.status, 201);
  const userCookie = created.headers.get("set-cookie");
  async function pick(cookie, symbol, op) {
    return worker.fetch(
      new Request("https://stock-report.stocknotes.workers.dev/api/picks", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookieHeader(cookie) },
        body: JSON.stringify({ op, symbol }),
      }),
      envWith(db)
    );
  }
  const added = await pick(userCookie, "sh600519", "add");
  const addedBody = await added.json();
  assert.equal(added.status, 200);
  assert.equal(addedBody.picks[0].symbol, "600519");
  await pick(admin.cookie, "300750", "add");
  const mine = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/picks", {
      headers: { cookie: cookieHeader(userCookie) },
    }),
    envWith(db)
  );
  const mineHtml = await mine.text();
  assert.match(mineHtml, /600519/);
  assert.match(mineHtml, /下一场才生效/);
  assert.match(mineHtml, /最多 30 只/);
  assert.doesNotMatch(mineHtml, /300750/);
  const userId = db.users.find((u) => u.login === "picker").id;
  await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/internal/notes", {
      method: "POST",
      headers: { authorization: "Bearer test-write-key", "content-type": "application/json" },
      body: JSON.stringify({
        user_id: userId,
        session_date: "2026-10-01",
        session: "open",
        stocks: [{ symbol: "600519", name: "贵州茅台", price: 1, change_pct: 1, zone: "中性持有" }],
      }),
    }),
    envWith(db, "test-write-key")
  );
  const before = db.notes[0].payload;
  await pick(userCookie, "601398", "add");
  assert.equal(db.notes[0].payload, before);
  assert.equal(JSON.parse(db.notes[0].payload).stocks.length, 1);
  for (let i = 0; i < 28; i++) {
    const res = await pick(userCookie, String(600000 + i), "add");
    assert.equal(res.status, 200);
  }
  const capped = await pick(userCookie, "601988", "add");
  assert.equal(capped.status, 400);
  const moved = await pick(userCookie, "600519", "down");
  assert.equal(moved.status, 200);
  const symbols = db.picks
    .filter((row) => row.user_id === userId)
    .sort((a, b) => a.position - b.position)
    .map((row) => row.symbol);
  assert.notEqual(symbols[0], "600519");
});

test("notes stay per user and remarks survive the next write", async () => {
  const db = new MockDB();
  await seedAdmin(db);
  const owner = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        display_name: "甲",
        login: "usera",
        password: "user-pass-a",
        confirm: "user-pass-a",
      }),
    }),
    envWith(db)
  );
  const other = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        display_name: "乙",
        login: "userb",
        password: "user-pass-b",
        confirm: "user-pass-b",
      }),
    }),
    envWith(db)
  );
  const admin = await login(db, "admin", "AdminPassw0rd");
  const ownerCookie = owner.headers.get("set-cookie");
  const adminId = db.users.find((u) => u.login === "usera").id;
  const otherId = db.users.find((u) => u.login === "userb").id;
  async function write(userId, date, session, stocks) {
    const res = await worker.fetch(
      new Request("https://stock-report.stocknotes.workers.dev/api/internal/notes", {
        method: "POST",
        headers: { authorization: "Bearer test-write-key", "content-type": "application/json" },
        body: JSON.stringify({ user_id: userId, session_date: date, session, stocks }),
      }),
      envWith(db, "test-write-key")
    );
    assert.equal(res.status, 200);
  }
  await write(adminId, "2026-09-30", "open", [
    { symbol: "600519", name: "贵州茅台", price: 1600, change_pct: -1, zone: "中性持有", remark: "不要进电报" },
  ]);
  await write(adminId, "2026-10-01", "open", [
    { symbol: "600519", name: "贵州茅台", price: 1680, change_pct: 1.2, zone: "中性持有", pe: 28, from_open_pct: 0.8 },
    { symbol: "300750", name: "宁德时代", price: 210.5, change_pct: -0.6, zone: "不宜追高", pe_pctl: 72 },
  ]);
  await write(otherId, "2026-10-01", "open", [
    { symbol: "601398", name: "工商银行", price: 5, change_pct: 0.2, zone: "适合关注" },
  ]);
  const remark = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/remarks", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader(ownerCookie) },
      body: JSON.stringify({
        session_date: "2026-10-01",
        session: "open",
        symbol: "300750",
        text: "等收盘再看。",
      }),
    }),
    envWith(db)
  );
  assert.equal(remark.status, 200);
  const journal = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/journal", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader(ownerCookie) },
      body: JSON.stringify({ session_date: "2026-10-01", text: "茅台没动，宁德区间变了。" }),
    }),
    envWith(db)
  );
  assert.equal(journal.status, 200);
  await write(adminId, "2026-10-01", "open", [
    { symbol: "600519", name: "贵州茅台", price: 1688, change_pct: 1.5, zone: "不宜追高", pe: 28 },
    { symbol: "300750", name: "宁德时代", price: 211, change_pct: -0.4, zone: "不宜追高", pe_pctl: 72 },
  ]);
  assert.equal(db.notes.filter((row) => row.user_id === adminId && row.session_date === "2026-10-01" && row.session === "open").length, 1);
  assert.equal(db.notes.filter((row) => row.user_id === otherId).length, 1);
  assert.equal(JSON.parse(db.notes.find((row) => row.user_id === otherId).payload).stocks[0].name, "工商银行");
  const adminNote = JSON.parse(
    db.notes.find((row) => row.user_id === adminId && row.session_date === "2026-10-01" && row.session === "open").payload
  );
  assert.equal(JSON.stringify(adminNote).includes("等收盘再看"), false);
  assert.equal(JSON.stringify(adminNote).includes("茅台没动"), false);
  assert.equal(adminNote.stocks[0].zone, "不宜追高");
  const adminDay = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/d/2026-10-01", {
      headers: { cookie: cookieHeader(admin.cookie) },
    }),
    envWith(db)
  );
  assert.equal(adminDay.status, 303);
  assert.equal(adminDay.headers.get("location"), "/");
  const day = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/d/2026-10-01", {
      headers: { cookie: cookieHeader(ownerCookie) },
    }),
    envWith(db)
  );
  const dayHtml = await day.text();
  assert.match(dayHtml, /消息/);
  assert.match(dayHtml, /开盘分析/);
  assert.match(dayHtml, /等收盘再看。/);
  assert.match(dayHtml, /茅台没动，宁德区间变了。/);
  assert.match(dayHtml, /上次 中性持有 → 这次 不宜追高/);
  assert.match(dayHtml, /区间较上次变化 1 只/);
  assert.doesNotMatch(dayHtml, /工商银行/);
  const otherDay = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/d/2026-10-01", {
      headers: { cookie: cookieHeader(other.headers.get("set-cookie")) },
    }),
    envWith(db)
  );
  const otherHtml = await otherDay.text();
  assert.match(otherHtml, /工商银行/);
  assert.doesNotMatch(otherHtml, /等收盘再看/);
  assert.doesNotMatch(otherHtml, /贵州茅台/);
  const lists = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/internal/watchlists", {
      headers: { authorization: "Bearer test-write-key" },
    }),
    envWith(db, "test-write-key")
  );
  const watch = await lists.json();
  assert.equal(lists.status, 200);
  assert.equal(JSON.stringify(watch).includes("password"), false);
  const compare = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/c/600519?session=open&date=2026-10-01", {
      headers: { cookie: cookieHeader(ownerCookie) },
    }),
    envWith(db)
  );
  const compareHtml = await compare.text();
  assert.match(compareHtml, /近 5 个交易日/);
  assert.match(compareHtml, /前一日 中性持有 → 当日 不宜追高/);
  assert.match(compareHtml, />开盘</);
  assert.match(compareHtml, />收盘</);
  const missing = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/switch"),
    envWith(db)
  );
  assert.equal(missing.status, 404);
});

test("avatar saves for one user and picks reorder without rewriting notes", async () => {
  const db = new MockDB();
  await seedAdmin(db);
  const created = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        display_name: "阿宁",
        login: "face1",
        password: "face-pass-1",
        confirm: "face-pass-1",
      }),
    }),
    envWith(db)
  );
  const cookie = created.headers.get("set-cookie");
  const avatarPage = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/avatar", {
      headers: { cookie: cookieHeader(cookie) },
    }),
    envWith(db)
  );
  const avatarHtml = await avatarPage.text();
  assert.equal(avatarPage.status, 200);
  assert.match(avatarHtml, /设定头像/);
  assert.match(avatarHtml, /从相册选择/);
  assert.match(avatarHtml, /重新选择/);
  assert.match(avatarHtml, /保存/);
  assert.match(avatarHtml, /accept="image\/\*/);
  assert.match(avatarHtml, /class="avatar big">宁</);
  const image = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2w==";
  const saved = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/avatar", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader(cookie) },
      body: JSON.stringify({ image }),
    }),
    envWith(db)
  );
  assert.equal(saved.status, 200);
  const bad = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/avatar", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader(cookie) },
      body: JSON.stringify({ image: "data:image/svg+xml;base64,PHN2Zy8+" }),
    }),
    envWith(db)
  );
  assert.equal(bad.status, 400);
  const me = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/me", {
      headers: { cookie: cookieHeader(cookie) },
    }),
    envWith(db)
  );
  const meHtml = await me.text();
  assert.match(meHtml, /data:image\/jpeg;base64,/);
  assert.doesNotMatch(meHtml, />登录</);
  const admin = await login(db, "admin", "AdminPassw0rd");
  const adminMe = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/me", {
      headers: { cookie: cookieHeader(admin.cookie) },
    }),
    envWith(db)
  );
  const adminHtml = await adminMe.text();
  assert.doesNotMatch(adminHtml, /9j\/4AAQ/);
  const userId = db.users.find((u) => u.login === "face1").id;
  for (const symbol of ["600519", "300750", "600036"]) {
    const res = await worker.fetch(
      new Request("https://stock-report.stocknotes.workers.dev/api/picks", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookieHeader(cookie) },
        body: JSON.stringify({ op: "add", symbol }),
      }),
      envWith(db)
    );
    assert.equal(res.status, 200);
  }
  await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/internal/notes", {
      method: "POST",
      headers: { authorization: "Bearer test-write-key", "content-type": "application/json" },
      body: JSON.stringify({
        user_id: userId,
        session_date: "2026-10-01",
        session: "open",
        stocks: [{ symbol: "600519", name: "贵州茅台", zone: "中性持有" }],
      }),
    }),
    envWith(db, "test-write-key")
  );
  const before = db.notes[0].payload;
  const ordered = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/picks", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader(cookie) },
      body: JSON.stringify({ op: "order", symbols: ["600036", "600519", "300750"] }),
    }),
    envWith(db)
  );
  assert.equal(ordered.status, 200);
  const symbols = db.picks
    .filter((row) => row.user_id === userId)
    .sort((a, b) => a.position - b.position)
    .map((row) => row.symbol);
  assert.deepEqual(symbols, ["600036", "600519", "300750"]);
  assert.equal(db.notes[0].payload, before);
  const removed = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/picks", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader(cookie) },
      body: JSON.stringify({ op: "delete", symbol: "300750" }),
    }),
    envWith(db)
  );
  assert.equal(removed.status, 200);
  assert.equal(db.picks.some((row) => row.user_id === userId && row.symbol === "300750"), false);
  assert.equal(db.notes[0].payload, before);
  const page = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/picks", {
      headers: { cookie: cookieHeader(cookie) },
    }),
    envWith(db)
  );
  const html = await page.text();
  assert.match(html, /按住左侧拖动可排序。拖到屏幕底部的删除区，松手即去掉。/);
  assert.match(html, /拖到这里删除/);
  assert.match(html, /class="handle"/);
  assert.doesNotMatch(html, />上移</);
  assert.doesNotMatch(html, />下移</);
  assert.doesNotMatch(html, />删除</);
});

test("admin home is account management and forms change login", async () => {
  const db = new MockDB();
  await seedAdmin(db);
  const admin = await login(db, "admin", "AdminPassw0rd");
  const created = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        display_name: "阿宁",
        login: "aning",
        password: "pass-word-1",
        confirm: "pass-word-1",
      }),
    }),
    envWith(db)
  );
  assert.equal(created.status, 201);
  const home = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/", {
      headers: { cookie: cookieHeader(admin.cookie) },
    }),
    envWith(db)
  );
  const html = await home.text();
  assert.equal(home.status, 200);
  assert.match(html, />账号</);
  assert.match(html, /登录名 aning/);
  assert.match(html, /class="badge on">启用/);
  assert.match(html, />停用</);
  assert.match(html, />重置密码</);
  assert.match(html, />退出</);
  assert.match(html, /数据仅供参考，不构成投资建议/);
  assert.doesNotMatch(html, /class="tabbar"/);
  assert.doesNotMatch(html, />笔记</);
  assert.doesNotMatch(html, />选股</);
  assert.match(html, /<span class="user">管理员<\/span>/);
  const id = db.users.find((u) => u.login === "aning").id;
  const adminId = db.users.find((u) => u.login === "admin").id;
  const selfOff = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/admin/users/" + adminId + "/enabled", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader(admin.cookie) },
      body: "enabled=0",
    }),
    envWith(db)
  );
  assert.equal(selfOff.status, 303);
  assert.equal(db.users.find((u) => u.login === "admin").enabled, 1);
  const off = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/admin/users/" + id + "/enabled", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader(admin.cookie) },
      body: "enabled=0",
    }),
    envWith(db)
  );
  assert.equal(off.status, 303);
  assert.equal(off.headers.get("location"), "/");
  assert.equal((await login(db, "aning", "pass-word-1")).status, 401);
  const lists = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/internal/watchlists", {
      headers: { authorization: "Bearer test-write-key" },
    }),
    envWith(db, "test-write-key")
  );
  const watch = await lists.json();
  assert.equal(watch.users.some((u) => u.login === "aning"), false);
  const disabledPage = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/", {
      headers: { cookie: cookieHeader(admin.cookie) },
    }),
    envWith(db)
  );
  assert.match(await disabledPage.text(), /class="badge off">已停用/);
  const on = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/admin/users/" + id + "/enabled", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader(admin.cookie) },
      body: "enabled=1",
    }),
    envWith(db)
  );
  assert.equal(on.status, 303);
  assert.equal((await login(db, "aning", "pass-word-1")).status, 200);
  const resetPage = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/reset/" + id, {
      headers: { cookie: cookieHeader(admin.cookie) },
    }),
    envWith(db)
  );
  const resetHtml = await resetPage.text();
  assert.match(resetHtml, /重置密码/);
  assert.match(resetHtml, /新密码/);
  assert.match(resetHtml, /再输入一次/);
  assert.match(resetHtml, />保存</);
  assert.match(resetHtml, /class="code">aning/);
  assert.doesNotMatch(resetHtml, /class="tabbar"/);
  const mismatch = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/reset/" + id, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader(admin.cookie) },
      body: "password=new-pass-2&confirm=other-pass",
    }),
    envWith(db)
  );
  assert.equal(mismatch.status, 303);
  assert.match(mismatch.headers.get("location"), /e=mismatch/);
  const reset = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/reset/" + id, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader(admin.cookie) },
      body: "password=new-pass-2&confirm=new-pass-2",
    }),
    envWith(db)
  );
  assert.equal(reset.status, 303);
  assert.equal(reset.headers.get("location"), "/");
  assert.equal((await login(db, "aning", "pass-word-1")).status, 401);
  const again = await login(db, "aning", "new-pass-2");
  assert.equal(again.status, 200);
  const userHome = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/", {
      headers: { cookie: cookieHeader(again.cookie) },
    }),
    envWith(db)
  );
  const userHtml = await userHome.text();
  assert.match(userHtml, />笔记</);
  assert.match(userHtml, />选股</);
  assert.match(userHtml, />我的</);
  assert.match(userHtml, /class="tabbar"/);
  const listsOn = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/internal/watchlists", {
      headers: { authorization: "Bearer test-write-key" },
    }),
    envWith(db, "test-write-key")
  );
  const watchOn = await listsOn.json();
  assert.equal(watchOn.users.some((u) => u.login === "aning"), true);
});

test("pick suggestions parse shares and the page marks duplicates", async () => {
  const parsed = parseSinaSuggest(
    'var suggestvalue="贵州茅台,11,600519,sh600519,贵州茅台,,;国证粮食,11,399365,sz399365,国证粮食,,;贵州燃气,11,600903,sh600903,贵州燃气,,;贵州轮胎,11,000589,sz000589,贵州轮胎,,;";'
  );
  assert.deepEqual(parsed.map((item) => item.symbol), ["600519", "600903", "000589"]);
  assert.equal(parsed[0].label, "沪");
  assert.equal(parsed[2].label, "深");
  assert.equal("price" in parsed[0], false);
  const marked = markSuggestions(parsed, ["600519"]);
  assert.equal(marked[0].added, true);
  assert.equal(marked[0].on, false);
  assert.equal(marked[1].added, false);
  assert.equal(marked[1].on, true);
  const db = new MockDB();
  await seedAdmin(db);
  const created = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        display_name: "阿宁",
        login: "picksg",
        password: "pick-pass-1",
        confirm: "pick-pass-1",
      }),
    }),
    envWith(db)
  );
  const cookie = created.headers.get("set-cookie");
  const page = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/picks", {
      headers: { cookie: cookieHeader(cookie) },
    }),
    envWith(db)
  );
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(html, /id="suggest"/);
  assert.match(html, /aria-label="代码、名称或拼音"/);
  assert.match(html, /例如 gzmt、茅台/);
  assert.match(html, /最多 30 只，下一场才生效/);
  assert.match(html, /按住左侧拖动可排序。拖到屏幕底部的删除区，松手即去掉。/);
  assert.match(html, /拖到这里删除/);
  assert.match(html, /已添加/);
  assert.doesNotMatch(html, />上移</);
  assert.doesNotMatch(html, />下移</);
  assert.doesNotMatch(html, />删除</);
  assert.doesNotMatch(html, />添加</);
  const anon = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/picks/suggest?q=gzmt"),
    envWith(db)
  );
  assert.equal(anon.status, 401);
  const local = searchSymbols("515100");
  assert.equal(local[0].symbol, "515100");
  assert.equal(local[0].name, "红利低波100ETF景顺");
  assert.equal(local[0].label, "沪");
  assert.equal(searchSymbols("红利100").some((item) => item.symbol === "515100" && item.label === "沪"), true);
  assert.equal(searchSymbols("红利100").some((item) => item.name === "红利100"), true);
  assert.equal(searchSymbols("gzmt")[0].symbol, "600519");
  assert.equal(searchSymbols("茅台").some((item) => item.symbol === "600519"), true);
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("suggest must not call out");
  };
  try {
    const found = await worker.fetch(
      new Request("https://stock-report.stocknotes.workers.dev/api/picks/suggest?q=515100", {
        headers: { cookie: cookieHeader(cookie) },
      }),
      envWith(db)
    );
    const body = await found.json();
    assert.equal(found.status, 200);
    assert.equal(body.items[0].symbol, "515100");
    assert.equal(body.items[0].name, "红利低波100ETF景顺");
    assert.equal(body.items[0].label, "沪");
    assert.equal("price" in body.items[0], false);
    const maotai = await worker.fetch(
      new Request("https://stock-report.stocknotes.workers.dev/api/picks/suggest?q=gzmt", {
        headers: { cookie: cookieHeader(cookie) },
      }),
      envWith(db)
    );
    const maotaiBody = await maotai.json();
    assert.equal(maotaiBody.items[0].symbol, "600519");
    assert.equal(maotaiBody.items[0].name, "贵州茅台");
  } finally {
    globalThis.fetch = original;
  }
});

test("symbol catalog refresh keeps the previous list unless the new one is complete", async () => {
  const db = new MockDB();
  await seedAdmin(db);
  const created = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        display_name: "临时",
        login: "cat1",
        password: "cat-pass-1",
        confirm: "cat-pass-1",
      }),
    }),
    envWith(db)
  );
  const cookie = created.headers.get("set-cookie");
  async function suggest(q) {
    const res = await worker.fetch(
      new Request("https://stock-report.stocknotes.workers.dev/api/picks/suggest?q=" + encodeURIComponent(q), {
        headers: { cookie: cookieHeader(cookie) },
      }),
      envWith(db)
    );
    return res.json();
  }
  const before = await suggest("515100");
  assert.equal(before.items[0].name, "红利低波100ETF景顺");
  const bad = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/internal/symbols", {
      method: "POST",
      headers: { authorization: "Bearer test-write-key", "content-type": "application/json" },
      body: JSON.stringify({ rows: [["515100", "红利低波100ETF景顺", "x"]] }),
    }),
    envWith(db)
  );
  const badBody = await bad.json();
  assert.equal(bad.status, 400);
  assert.equal(badBody.kept, true);
  assert.equal(badBody.error, "名单不完整");
  assert.equal((await suggest("515100")).items[0].name, "红利低波100ETF景顺");
  const failed = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/internal/symbols", {
      method: "POST",
      headers: { authorization: "Bearer test-write-key", "content-type": "application/json" },
      body: JSON.stringify({ error: "名单拉取失败" }),
    }),
    envWith(db)
  );
  assert.equal((await failed.json()).kept, true);
  assert.equal(db.catalogMeta, null);
  const rows = [];
  for (let i = 0; i < 2000; i++) rows.push([String(i).padStart(6, "0"), "名称" + i, "mc"]);
  rows[0] = ["515100", "红利低波100ETF景顺", "hldb", "红利100"];
  rows[1] = ["600519", "茅台新名", "gzmt"];
  assert.equal(catalogProblem(rows), "");
  const saved = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/internal/symbols", {
      method: "POST",
      headers: { authorization: "Bearer test-write-key", "content-type": "application/json" },
      body: JSON.stringify({ rows }),
    }),
    envWith(db)
  );
  const savedBody = await saved.json();
  assert.equal(saved.status, 200);
  assert.equal(savedBody.ok, true);
  assert.equal(savedBody.count, 2000);
  const renamed = await suggest("gzmt");
  assert.equal(renamed.items[0].symbol, "600519");
  assert.equal(renamed.items[0].name, "茅台新名");
  const again = await worker.fetch(
    new Request("https://stock-report.stocknotes.workers.dev/api/internal/symbols", {
      method: "POST",
      headers: { authorization: "Bearer test-write-key", "content-type": "application/json" },
      body: JSON.stringify({ rows: [["515100", "不该写入", "x"]] }),
    }),
    envWith(db)
  );
  assert.equal((await again.json()).kept, true);
  assert.equal((await suggest("gzmt")).items[0].name, "茅台新名");
  assert.equal((await suggest("515100")).items[0].symbol, "515100");
  assert.equal(db.catalogMeta.count, 2000);
});
