import { APP_CSS } from "./appcss.js";

export { APP_CSS };

export const LAYOUT_CSS = `
html, body { width: auto; min-height: 100%; max-width: 100%; }
body { overflow-x: hidden; }
a.card-link { display: block; color: inherit; text-decoration: none; }
a.name { color: inherit; text-decoration: none; }
a.text-toggle {
  text-decoration: none;
  display: inline-flex;
  align-items: center;
}
.actions form { flex: 1; margin: 0; }
.actions form .btn { width: 100%; }
.dock form.dock-row { margin: 0; }
form.stack-btn { margin: 0; }
.warn { color: #c0392b; margin: 8px 0 0; font-size: 14px; }
.meta { margin: 2px 0 0; font-size: 13px; color: #666; }
.badge { display: inline-block; margin-top: 6px; font-size: 13px; font-weight: 650; }
.badge.on { color: #1e7a46; }
.badge.off { color: #a12622; }
.actions { display: flex; gap: 8px; margin-top: 12px; }
.actions .btn, .actions a.btn { flex: 1; }
.stock-line > :first-child { min-width: 0; flex: 1 1 auto; }
.quote { flex: none; }
.who { display: flex; align-items: center; gap: 14px; }
.avatar {
  width: 72px; height: 72px; border-radius: 50%;
  background: #1f4b99; color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 28px; font-weight: 650; flex: none; overflow: hidden;
}
.avatar.big { width: 160px; height: 160px; font-size: 64px; margin: 8px auto 20px; }
.avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
.setlink { display: inline-block; margin-top: 6px; color: #1f4b99; font-size: 15px; text-decoration: none; }
.center { text-align: center; }
.gap { margin-top: 10px; }
.filepick { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.row {
  display: flex; align-items: center; gap: 12px;
  background: #fff; border: 1px solid #e6e6e6; border-radius: 8px;
  padding: 12px 14px; min-height: 56px; min-width: 0;
}
.handle { width: 22px; flex: none; display: flex; flex-direction: column; gap: 4px; touch-action: none; cursor: grab; }
.handle i { display: block; height: 2px; background: #5c6570; border-radius: 1px; }
.row .pick-label { min-width: 0; }
.row.lift {
  position: fixed; z-index: 7; left: 12px; right: 12px;
  box-shadow: 0 8px 20px rgba(26,26,26,.16);
}
.gapline { height: 56px; border: 1px dashed #1f4b99; border-radius: 8px; background: #eef3fb; }
.del {
  position: fixed; left: 12px; right: 12px; bottom: 68px; z-index: 6;
  min-height: 64px; border-radius: 8px;
  background: #a12622; color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; font-weight: 650;
}
.del[hidden] { display: none; }
.suggest {
  position: fixed;
  left: 12px; right: 12px;
  bottom: 132px;
  z-index: 7;
  background: #fff;
  border: 1px solid #e6e6e6;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 4px 16px rgba(0,0,0,.08);
}
.suggest[hidden] { display: none; }
.suggest .hit {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 48px;
  padding: 8px 14px;
  border: 0;
  border-top: 1px solid #eee;
  background: #fff;
  color: inherit;
  font: inherit;
  text-align: left;
}
.suggest .hit:first-child { border-top: 0; }
.suggest .hit.on, .suggest .hit:hover { background: #f3f6fb; }
.suggest .hit:disabled, .suggest .hit:disabled:hover { background: #fff; }
.mkt {
  font-size: 12px;
  color: #5c6570;
  border: 1px solid #e6e6e6;
  border-radius: 4px;
  padding: 1px 6px;
  margin-left: 8px;
}
.added { font-size: 13px; color: #999; }
.dock input.typing {
  border-color: #1f4b99;
  box-shadow: 0 0 0 1px #1f4b99;
}
@media (orientation: landscape) {
  main.pad { max-width: 960px; margin-left: auto; margin-right: auto; }
  .topbar, .tabbar, .dock {
    max-width: 960px;
    margin-left: auto;
    margin-right: auto;
  }
  .stock-line { flex-wrap: nowrap; }
  .name, .code { white-space: nowrap; }
  .row .name, .row .code { white-space: nowrap; }
  .del, .row.lift, .suggest { max-width: 936px; }
}
`;

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

function doc(title, body) {
  return (
    "<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">" +
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">" +
    "<title>" + esc(title) + "</title>" +
    "<link rel=\"stylesheet\" href=\"/app.css\">" +
    "<style>" + LAYOUT_CSS + "</style></head><body>" +
    body +
    "</body></html>"
  );
}

function topbar(displayName) {
  return (
    "<header class=\"topbar\"><div class=\"brand\">盘面笔记</div>" +
    "<span class=\"user\">" + esc(displayName) + "</span></header>"
  );
}

function tabbar(active) {
  const item = (href, label, key) =>
    "<a href=\"" + href + "\"" + (active === key ? " class=\"active\"" : "") + ">" + label + "</a>";
  return (
    "<nav class=\"tabbar\">" +
    item("/", "笔记", "notes") +
    item("/picks", "选股", "picks") +
    item("/me", "我的", "me") +
    "</nav>"
  );
}

function warn(text) {
  return text ? "<p class=\"warn\">" + esc(text) + "</p>" : "";
}

export function loginPage(error) {
  const body =
    "<main class=\"pad\">" +
    "<h1 class=\"page-title\">盘面笔记</h1>" +
    "<p class=\"disclaimer\">数据仅供参考，不构成投资建议。</p>" +
    "<section class=\"card\" style=\"margin-top:16px\">" +
    "<h2 class=\"section-title\">登录</h2>" +
    "<form method=\"post\" action=\"/login\">" +
    "<label class=\"field\" for=\"login-name\">登录名</label>" +
    "<input class=\"field-gap\" id=\"login-name\" name=\"login\" type=\"text\" autocomplete=\"off\" maxlength=\"32\">" +
    "<label class=\"field\" for=\"login-pass\">密码</label>" +
    "<input class=\"field-gap\" id=\"login-pass\" name=\"password\" type=\"password\" autocomplete=\"off\" maxlength=\"72\">" +
    "<button class=\"btn primary tight\" type=\"submit\">登录</button>" +
    warn(error) +
    "</form></section>" +
    "<a class=\"textlink\" href=\"/signup\">新建用户</a>" +
    "</main>";
  return doc("登录", body);
}

export function signupPage(error) {
  const body =
    "<main class=\"pad\">" +
    "<h1 class=\"page-title\">盘面笔记</h1>" +
    "<p class=\"disclaimer\">数据仅供参考，不构成投资建议。</p>" +
    "<section class=\"card\" style=\"margin-top:16px\">" +
    "<h2 class=\"section-title\">新建用户</h2>" +
    "<form method=\"post\" action=\"/signup\">" +
    "<label class=\"field\" for=\"su-display\">显示名</label>" +
    "<input class=\"field-gap\" id=\"su-display\" name=\"display_name\" type=\"text\" autocomplete=\"off\" maxlength=\"32\">" +
    "<label class=\"field\" for=\"su-name\">登录名</label>" +
    "<input class=\"field-gap\" id=\"su-name\" name=\"login\" type=\"text\" autocomplete=\"off\" maxlength=\"32\">" +
    "<label class=\"field\" for=\"su-pass\">密码</label>" +
    "<input class=\"field-gap\" id=\"su-pass\" name=\"password\" type=\"password\" autocomplete=\"off\" maxlength=\"72\">" +
    "<label class=\"field\" for=\"su-pass2\">再输入一次密码</label>" +
    "<input class=\"field-gap\" id=\"su-pass2\" name=\"confirm\" type=\"password\" autocomplete=\"off\" maxlength=\"72\">" +
    "<button class=\"btn primary tight\" type=\"submit\">创建并进入</button>" +
    warn(error) +
    "</form></section>" +
    "<a class=\"textlink\" href=\"/login\">已有账号，去登录</a>" +
    "</main>";
  return doc("新建用户", body);
}

export function notesPage(user, days) {
  const cards = days.length
    ? days.map((day) => {
        const openCls = day.open ? "pill on" : "pill off";
        const closeCls = day.close ? "pill on" : "pill off";
        return (
          "<a class=\"card-link\" href=\"/d/" + esc(day.date) + "\">" +
          "<article class=\"card\">" +
          "<h2 class=\"day-date\">" + esc(day.label) + "</h2>" +
          "<p class=\"day-msg\">" + esc(day.message) + "</p>" +
          "<div class=\"tags\"><span class=\"" + openCls + "\">开盘</span><span class=\"" + closeCls + "\">收盘</span></div>" +
          "</article></a>"
        );
      }).join("")
    : "<p class=\"note\">还没有笔记。</p>";
  const body =
    topbar(user.display_name) +
    "<main class=\"pad with-tab\">" +
    "<p class=\"disclaimer\" style=\"margin-bottom:12px\">数据仅供参考，不构成投资建议。</p>" +
    "<div class=\"stack\">" + cards + "</div></main>" +
    tabbar("notes");
  return doc("笔记", body);
}

function stockBlock(stock) {
  const chgCls = stock.dir === "up" ? "chg up" : stock.dir === "down" ? "chg down" : "chg";
  const chips = (stock.chips || [])
    .map((chip) => "<span class=\"chip\">" + esc(chip) + "</span>")
    .join("");
  const remarkCls = stock.remark ? "remark" : "remark ghost";
  const remarkText = stock.remark ? stock.remark : "写一句";
  return (
    "<div class=\"stock\">" +
    "<div class=\"stock-line\">" +
    "<div><a class=\"name\" href=\"" + esc(stock.href) + "\">" + esc(stock.name) + "</a>" +
    "<span class=\"code\">" + esc(stock.symbol) + "</span></div>" +
    "<div class=\"quote\"><span class=\"price\">" + esc(stock.price) + "</span>" +
    "<span class=\"" + chgCls + "\">" + esc(stock.change) + "</span></div></div>" +
    "<div class=\"zone\">" + esc(stock.zone) + "</div>" +
    (chips ? "<div class=\"chips\">" + chips + "</div>" : "") +
    "<div class=\"" + remarkCls + "\" contenteditable=\"true\" data-remark=\"1\" data-empty=\"" +
    (stock.remark ? "0" : "1") + "\" data-date=\"" + esc(stock.date) + "\" data-session=\"" +
    esc(stock.session) + "\" data-symbol=\"" + esc(stock.symbol) + "\">" + esc(remarkText) + "</div>" +
    "</div>"
  );
}

const DAY_SCRIPT = `
function postJson(url, body) {
  return fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}
document.querySelectorAll("[data-remark]").forEach(function (el) {
  el.addEventListener("focus", function () {
    if (el.getAttribute("data-empty") === "1") {
      el.textContent = "";
      el.classList.remove("ghost");
    }
  });
  el.addEventListener("blur", function () {
    var text = (el.textContent || "").replace(/\\s+/g, " ").trim();
    if (!text) {
      el.textContent = "写一句";
      el.classList.add("ghost");
      el.setAttribute("data-empty", "1");
    } else {
      el.textContent = text;
      el.classList.remove("ghost");
      el.setAttribute("data-empty", "0");
    }
    postJson("/api/remarks", {
      session_date: el.getAttribute("data-date"),
      session: el.getAttribute("data-session"),
      symbol: el.getAttribute("data-symbol"),
      text: text
    });
  });
});
var journal = document.getElementById("journal");
if (journal) {
  journal.addEventListener("blur", function () {
    postJson("/api/journal", { session_date: journal.getAttribute("data-date"), text: journal.value });
  });
}
`;

export function dayPage(user, model) {
  const blocks = [];
  if (model.messages.length) {
    blocks.push(
      "<section class=\"card\"><h3 class=\"block-title\">消息</h3>" +
      model.messages.map((line) => "<p class=\"msg-line\">" + esc(line) + "</p>").join("") +
      "</section>"
    );
  }
  if (model.open) {
    blocks.push(
      "<section class=\"card\"><h3 class=\"block-title\">开盘分析</h3>" +
      model.open.map(stockBlock).join("") +
      "</section>"
    );
  }
  if (model.close) {
    blocks.push(
      "<section class=\"card\"><h3 class=\"block-title\">收盘分析</h3>" +
      model.close.map(stockBlock).join("") +
      "</section>"
    );
  }
  blocks.push(
    "<section class=\"card\"><h3 class=\"block-title\">这一天我写的</h3>" +
    "<textarea id=\"journal\" data-date=\"" + esc(model.date) + "\">" + esc(model.journal) + "</textarea>" +
    "</section>"
  );
  blocks.push("<p class=\"disclaimer\">数据仅供参考，不构成投资建议。</p>");
  const empty = !model.open && !model.close
    ? "<p class=\"note\">这一天还没有笔记。</p>"
    : "";
  const body =
    "<main class=\"pad day-page\">" +
    "<a class=\"back\" href=\"/\">返回</a>" +
    "<h2 class=\"section-title\" style=\"margin-top:2px\">" + esc(model.label) + "</h2>" +
    empty +
    "<div class=\"stack\">" + blocks.join("") + "</div></main>" +
    tabbar("notes") +
    "<script>" + DAY_SCRIPT + "</script>";
  return doc(model.label, body);
}


export function avatarLetter(name) {
  const chars = [...String(name || "").trim()];
  return chars.length ? chars[chars.length - 1] : "";
}

function avatarBox(name, data, big) {
  const cls = "avatar" + (big ? " big" : "");
  if (data) {
    return '<div class="' + cls + '"><img alt="" src="' + esc(data) + '"></div>';
  }
  return '<div class="' + cls + '">' + esc(avatarLetter(name)) + "</div>";
}

export function reorderSlot(centers, y) {
  for (var i = 0; i < centers.length; i++) if (y < centers[i]) return i;
  return centers.length;
}

export function pointInRect(x, y, rect) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

export function attachPickDrag(doc, post) {
  var list = doc.getElementById("pick-list");
  var zone = doc.getElementById("drop-delete");
  var dock = doc.querySelector(".dock");
  var suggest = doc.getElementById("suggest");
  if (!list || !zone) return;
  post = post || function (body) {
    return fetch("/api/picks", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
  };
  var drag = null;

  function rows() {
    return [].filter.call(list.children, function (el) {
      return el.classList && el.classList.contains("row");
    });
  }

  function clearGap() {
    var gap = list.querySelector(".gapline");
    if (gap && gap.remove) gap.remove();
  }

  function place(y) {
    clearGap();
    var gap = doc.createElement("div");
    gap.className = "gapline";
    var others = rows().filter(function (row) { return row !== drag.row; });
    var centers = others.map(function (row) {
      var box = row.getBoundingClientRect();
      return box.top + box.height / 2;
    });
    var index = reorderSlot(centers, y);
    if (index >= others.length) list.appendChild(gap);
    else list.insertBefore(gap, others[index]);
  }

  function finish(ev, cancel) {
    if (!drag) return;
    var row = drag.row;
    var symbol = row.getAttribute("data-symbol");
    var zoneBox = zone.getBoundingClientRect();
    var drop = !cancel && pointInRect(ev.clientX, ev.clientY, zoneBox);
    row.classList.remove("lift");
    if (row.style) {
      row.style.top = "";
      row.style.left = "";
      row.style.right = "";
    }
    var gap = list.querySelector(".gapline");
    if (drop) {
      if (gap && gap.remove) gap.remove();
      if (row.remove) row.remove();
      post({ op: "delete", symbol: symbol });
    } else if (gap) {
      list.insertBefore(row, gap);
      if (gap.remove) gap.remove();
      post({
        op: "order",
        symbols: rows().map(function (item) { return item.getAttribute("data-symbol"); })
      });
    }
    zone.hidden = true;
    if (dock) dock.hidden = false;
    if (suggest) suggest.hidden = false;
    drag = null;
  }

  function start(ev, row) {
    if (ev.preventDefault) ev.preventDefault();
    drag = { row: row, id: ev.pointerId };
    row.classList.add("lift");
    zone.hidden = false;
    if (dock) dock.hidden = true;
    if (suggest) suggest.hidden = true;
    if (row.setPointerCapture && ev.pointerId != null) {
      try { row.setPointerCapture(ev.pointerId); } catch (err) {}
    }
    move(ev);
  }

  function move(ev) {
    if (!drag) return;
    if (ev.pointerId != null && drag.id != null && ev.pointerId !== drag.id) return;
    if (ev.preventDefault) ev.preventDefault();
    if (drag.row.style) drag.row.style.top = (ev.clientY - 28) + "px";
    place(ev.clientY);
  }

  function fromTouch(ev, touch) {
    return {
      preventDefault: function () { if (ev.preventDefault) ev.preventDefault(); },
      clientX: touch.clientX,
      clientY: touch.clientY,
      pointerId: null,
      target: ev.target
    };
  }

  list.addEventListener("pointerdown", function (ev) {
    var handle = ev.target && ev.target.closest && ev.target.closest(".handle");
    if (!handle) return;
    var row = handle.closest(".row");
    if (!row) return;
    start(ev, row);
  });
  list.addEventListener("pointermove", function (ev) { if (drag) move(ev); });
  list.addEventListener("pointerup", function (ev) { if (drag) finish(ev, false); });
  list.addEventListener("pointercancel", function (ev) { if (drag) finish(ev, true); });
  list.addEventListener("touchstart", function (ev) {
    var handle = ev.target && ev.target.closest && ev.target.closest(".handle");
    if (!handle) return;
    var touch = ev.touches && ev.touches[0];
    if (!touch) return;
    var row = handle.closest(".row");
    if (!row) return;
    start(fromTouch(ev, touch), row);
  }, false);
  list.addEventListener("touchmove", function (ev) {
    if (!drag) return;
    var touch = ev.touches && ev.touches[0];
    if (!touch) return;
    move(fromTouch(ev, touch));
  }, false);
  list.addEventListener("touchend", function (ev) {
    if (!drag) return;
    var touch = (ev.changedTouches && ev.changedTouches[0]) || { clientX: 0, clientY: 0 };
    finish(fromTouch(ev, touch), false);
  });
}


export function markSuggestions(items, owned) {
  var have = {};
  for (var i = 0; i < owned.length; i++) have[owned[i]] = true;
  var marked = false;
  var out = [];
  for (var j = 0; j < items.length; j++) {
    var item = items[j] || {};
    var added = !!have[item.symbol];
    var on = !added && !marked;
    if (on) marked = true;
    out.push({
      symbol: item.symbol,
      name: item.name,
      label: item.label || "",
      added: added,
      on: on
    });
  }
  return out;
}

export function attachPickSuggest(doc) {
  var input = doc.getElementById("pick-q");
  var box = doc.getElementById("suggest");
  var list = doc.getElementById("pick-list");
  if (!input || !box || !list) return;
  var timer = null;
  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }
  function owned() {
    var out = [];
    var rows = list.querySelectorAll ? list.querySelectorAll(".row") : [];
    for (var i = 0; i < rows.length; i++) out.push(rows[i].getAttribute("data-symbol"));
    return out;
  }
  function render(items) {
    var marked = markSuggestions(items, owned());
    if (!marked.length) {
      box.hidden = true;
      box.innerHTML = "";
      input.classList.toggle("typing", input.value.trim().length > 0);
      return;
    }
    box.innerHTML = marked.map(function (item) {
      return '<button type="button" class="hit' + (item.on ? " on" : "") + '" data-symbol="' + escHtml(item.symbol) + '"' + (item.added ? " disabled" : "") + ">" +
        '<div><span class="name">' + escHtml(item.name) + '</span><span class="code">' + escHtml(item.symbol) + "</span>" +
        (item.label ? '<span class="mkt">' + escHtml(item.label) + "</span>" : "") + "</div>" +
        (item.added ? '<span class="added">已添加</span>' : "") + "</button>";
    }).join("");
    box.hidden = false;
    input.classList.add("typing");
  }
  function search() {
    var q = input.value.trim();
    if (!q) { render([]); return; }
    fetch("/api/picks/suggest?q=" + encodeURIComponent(q), { credentials: "same-origin" })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (input.value.trim() !== q) return;
        render((data && data.items) || []);
      })
      .catch(function () { render([]); });
  }
  input.addEventListener("input", function () {
    if (timer) clearTimeout(timer);
    timer = setTimeout(search, 180);
  });
  box.addEventListener("click", function (ev) {
    var btn = ev.target && ev.target.closest ? ev.target.closest(".hit") : null;
    if (!btn || btn.disabled) return;
    var symbol = btn.getAttribute("data-symbol");
    fetch("/api/picks", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "add", symbol: symbol })
    }).then(function (res) {
      if (!res.ok) return;
      if (doc.location) doc.location.reload();
    }).catch(function () {});
  });
}

export function picksPage(user, picks, error) {
  const cards = picks.map((pick) => (
    '<div class="row" data-symbol="' + esc(pick.symbol) + '">' +
    '<span class="handle" aria-label="拖动"><i></i><i></i><i></i></span>' +
    '<div class="pick-label"><span class="name">' + esc(pick.name) + '</span><span class="code">' + esc(pick.symbol) + "</span></div></div>"
  )).join("");
  const script =
    reorderSlot.toString() + "\n" +
    pointInRect.toString() + "\n" +
    markSuggestions.toString() + "\n" +
    attachPickDrag.toString() + "\n" +
    attachPickSuggest.toString() + "\n" +
    "attachPickDrag(document);\nattachPickSuggest(document);\n";
  const body =
    topbar(user.display_name) +
    '<main class="pad with-tab with-dock">' +
    '<p class="disclaimer">数据仅供参考，不构成投资建议。</p>' +
    '<p class="note" style="margin:8px 0 12px">按住左侧拖动可排序。拖到屏幕底部的删除区，松手即去掉。</p>' +
    warn(error) +
    '<div class="stack" id="pick-list">' + cards + "</div></main>" +
    '<div class="del" id="drop-delete" hidden>拖到这里删除</div>' +
    '<div class="suggest" id="suggest" hidden></div>' +
    '<div class="dock"><div class="dock-row">' +
    '<input id="pick-q" type="text" aria-label="代码、名称或拼音" maxlength="16" autocomplete="off">' +
    '</div>' +
    '<p class="note">输入代码、名称或拼音，点一条加入。例如 gzmt、茅台。最多 30 只，下一场才生效。</p></div>' +
    tabbar("picks") +
    "<script>" + script + "</script>";
  return doc("选股", body);
}

export function mePage(user, avatar) {
  const body =
    topbar(user.display_name) +
    '<main class="pad with-tab">' +
    '<p class="disclaimer">数据仅供参考，不构成投资建议。</p>' +
    '<div class="stack" style="margin-top:12px">' +
    '<article class="card">' +
    '<h2 class="section-title">我的</h2>' +
    '<div class="who">' +
    avatarBox(user.display_name, avatar, false) +
    "<div>" +
    '<p style="margin:0;font-size:16px;font-weight:650">' + esc(user.display_name) + "</p>" +
    '<p class="note">登录名 ' + esc(user.login) + "</p>" +
    '<a class="setlink" href="/avatar">设定头像</a>' +
    "</div></div></article>" +
    '<form class="stack-btn" method="post" action="/logout"><button class="btn secondary" type="submit">退出</button></form>' +
    "</div></main>" +
    tabbar("me");
  return doc("我的", body);
}

const AVATAR_SCRIPT = `
var file = document.getElementById("file");
var pick = document.getElementById("pick");
var again = document.getElementById("again");
var save = document.getElementById("save");
var box = document.getElementById("preview");
var pending = "";
function showPreview(url) {
  box.innerHTML = '<img alt="" src="' + url.replace(/"/g, "") + '">';
  box.className = "avatar big";
  pick.hidden = true;
  again.hidden = false;
  save.hidden = false;
}
function readFile(blob) {
  var img = new Image();
  var local = URL.createObjectURL(blob);
  img.onload = function () {
    var size = 256;
    var canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext("2d");
    var scale = Math.max(size / img.width, size / img.height);
    var w = img.width * scale;
    var h = img.height * scale;
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    URL.revokeObjectURL(local);
    pending = canvas.toDataURL("image/jpeg", 0.82);
    showPreview(pending);
  };
  img.src = local;
}
pick.addEventListener("click", function () { file.click(); });
again.addEventListener("click", function () { file.click(); });
file.addEventListener("change", function () {
  var blob = file.files && file.files[0];
  if (!blob) return;
  readFile(blob);
});
save.addEventListener("click", function () {
  if (!pending) return;
  save.disabled = true;
  fetch("/api/avatar", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ image: pending })
  }).then(function (res) {
    if (!res.ok) { save.disabled = false; return; }
    location.href = "/me";
  }).catch(function () { save.disabled = false; });
});
`;

export function avatarPage(user, avatar) {
  const body =
    '<main class="pad">' +
    '<a class="back" href="/me">返回</a>' +
    '<h1 class="page-title">设定头像</h1>' +
    '<p class="disclaimer" style="margin:8px 0 16px">数据仅供参考，不构成投资建议。</p>' +
    '<section class="card center">' +
    '<div id="preview">' + avatarBox(user.display_name, avatar, true) + "</div>" +
    '<input class="filepick" id="file" type="file" accept="image/*">' +
    '<button class="btn primary" id="pick" type="button">从相册选择</button>' +
    '<button class="btn secondary" id="again" type="button" hidden>重新选择</button>' +
    '<button class="btn primary gap" id="save" type="button" hidden>保存</button>' +
    "</section></main>" +
    "<script>" + AVATAR_SCRIPT + "</script>";
  return doc("设定头像", body);
}



export function adminPage(user, users, error) {
  const cards = (users || []).map((u) => {
    const on = Number(u.enabled) === 1 || u.enabled === true;
    const toggle =
      '<form method="post" action="/admin/users/' + esc(u.id) + '/enabled">' +
      '<input type="hidden" name="enabled" value="' + (on ? "0" : "1") + '">' +
      '<button class="btn secondary" type="submit">' + (on ? "停用" : "启用") + "</button></form>";
    return (
      '<article class="card">' +
      '<div class="name">' + esc(u.display_name) + "</div>" +
      '<p class="meta">登录名 ' + esc(u.login) + "</p>" +
      '<div class="badge ' + (on ? "on" : "off") + '">' + (on ? "启用" : "已停用") + "</div>" +
      '<div class="actions">' + toggle +
      '<a class="btn primary" href="/reset/' + esc(u.id) + '">重置密码</a>' +
      "</div></article>"
    );
  }).join("");
  const body =
    topbar(user.display_name) +
    '<main class="pad">' +
    '<p class="disclaimer">数据仅供参考，不构成投资建议。</p>' +
    '<h1 class="page-title" style="margin-top:12px">账号</h1>' +
    '<div class="stack" style="margin-top:12px">' +
    cards +
    warn(error) +
    '<form class="stack-btn" method="post" action="/logout"><button class="btn secondary" type="submit">退出</button></form>' +
    "</div></main>";
  return doc("账号", body);
}

export function adminResetPage(target, error) {
  const body =
    '<main class="pad">' +
    '<a class="back" href="/">返回</a>' +
    '<h1 class="page-title">重置密码</h1>' +
    '<p class="disclaimer" style="margin:8px 0 16px">数据仅供参考，不构成投资建议。</p>' +
    '<section class="card">' +
    '<p style="margin:0 0 12px;font-size:16px;font-weight:650">' + esc(target.display_name) +
    ' <span class="code">' + esc(target.login) + "</span></p>" +
    '<form method="post" action="/reset/' + esc(target.id) + '">' +
    '<label class="field" for="p1">新密码</label>' +
    '<input class="field-gap" id="p1" name="password" type="password" autocomplete="off" maxlength="72">' +
    '<label class="field" for="p2">再输入一次</label>' +
    '<input class="field-gap" id="p2" name="confirm" type="password" autocomplete="off" maxlength="72">' +
    '<button class="btn primary tight" type="submit">保存</button>' +
    warn(error) +
    "</form></section></main>";
  return doc("重置密码", body);
}

export function comparePage(user, model) {
  const other = model.session === "close" ? "open" : "close";
  const otherLabel = other === "open" ? "开盘" : "收盘";
  const currentLabel = model.session === "close" ? "收盘" : "开盘";
  const href = "/c/" + encodeURIComponent(model.symbol) + "?session=" + other + "&date=" + encodeURIComponent(model.date || "");
  const cards = model.rows.length
    ? model.rows.map((row) => {
        const chgCls = row.dir === "up" ? "chg up" : row.dir === "down" ? "chg down" : "chg";
        const chips = (row.chips || []).map((chip) => "<span class=\"chip\">" + esc(chip) + "</span>").join("");
        return (
          "<article class=\"card\">" +
          "<h2 class=\"day-date\">" + esc(row.label) + "</h2>" +
          "<div class=\"zone\">" + esc(row.zone) + "</div>" +
          "<div class=\"quote\" style=\"margin-top:4px\"><span class=\"price\">" + esc(row.price) + "</span>" +
          "<span class=\"" + chgCls + "\">" + esc(row.change) + "</span></div>" +
          (chips ? "<div class=\"chips\">" + chips + "</div>" : "") +
          "</article>"
        );
      }).join("")
    : "<p class=\"note\">还没有这场分析。</p>";
  const body =
    "<main class=\"pad with-tab\">" +
    "<a class=\"back\" href=\"" + esc(model.back) + "\">返回</a>" +
    "<div class=\"head-row\" style=\"margin-top:4px\">" +
    "<span class=\"name\">" + esc(model.name) + "</span><span class=\"code\">" + esc(model.symbol) + "</span></div>" +
    "<div class=\"session-row\"><span class=\"session-label\">" + currentLabel + "</span>" +
    "<a class=\"text-toggle\" href=\"" + esc(href) + "\">" + otherLabel + "</a></div>" +
    "<p class=\"note\" style=\"margin-bottom:12px\">近 5 个交易日</p>" +
    "<div class=\"stack\">" + cards +
    "<p class=\"disclaimer\">数据仅供参考，不构成投资建议。</p></div></main>" +
    tabbar("notes");
  return doc("对比", body);
}
