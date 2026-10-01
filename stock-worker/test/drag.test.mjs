import test from "node:test";
import assert from "node:assert/strict";
import { attachPickDrag, reorderSlot, pointInRect } from "../src/pages.js";

test("reorder slot and delete hit use the same geometry as the page", () => {
  assert.equal(reorderSlot([85, 145], 100), 1);
  assert.equal(reorderSlot([85, 145], 10), 0);
  assert.equal(reorderSlot([85, 145], 200), 2);
  assert.equal(pointInRect(20, 520, { left: 0, right: 300, top: 500, bottom: 564 }), true);
  assert.equal(pointInRect(20, 40, { left: 0, right: 300, top: 500, bottom: 564 }), false);
});

function el(className, attrs) {
  const node = {
    className,
    attrs: attrs || {},
    children: [],
    parent: null,
    hidden: false,
    style: {},
    listeners: {},
    rect: { left: 0, right: 320, top: 0, bottom: 50, width: 320, height: 50 },
    classList: null,
    getAttribute(name) { return this.attrs[name] || null; },
    setPointerCapture() {},
    getBoundingClientRect() { return this.rect; },
    closest(sel) {
      const cls = sel.startsWith(".") ? sel.slice(1) : "";
      if (cls && this.className.split(/\s+/).includes(cls)) return this;
      return this.parent ? this.parent.closest(sel) : null;
    },
    appendChild(child) {
      if (child.parent) child.parent.children = child.parent.children.filter((item) => item !== child);
      child.parent = this;
      this.children.push(child);
      return child;
    },
    insertBefore(child, before) {
      if (child.parent) child.parent.children = child.parent.children.filter((item) => item !== child);
      child.parent = this;
      const index = this.children.indexOf(before);
      if (index < 0) this.children.push(child);
      else this.children.splice(index, 0, child);
      return child;
    },
    remove() {
      if (!this.parent) return;
      this.parent.children = this.parent.children.filter((item) => item !== this);
      this.parent = null;
    },
    querySelector(sel) {
      const cls = sel.startsWith(".") ? sel.slice(1) : "";
      const walk = (nodes) => {
        for (const child of nodes) {
          if (child.className.split(/\s+/).includes(cls)) return child;
          const found = walk(child.children || []);
          if (found) return found;
        }
        return null;
      };
      return walk(this.children);
    },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    dispatch(type, event) { if (this.listeners[type]) this.listeners[type](event); },
  };
  node.classList = {
    contains(name) { return node.className.split(/\s+/).includes(name); },
    add(name) { if (!node.classList.contains(name)) node.className = (node.className + " " + name).trim(); },
    remove(name) { node.className = node.className.split(/\s+/).filter((part) => part !== name).join(" "); },
  };
  return node;
}

function build() {
  const doc = el("", {});
  doc.byId = {};
  doc.getElementById = (id) => doc.byId[id] || null;
  doc.querySelector = (sel) => doc.querySelectorAll && doc.querySelector(sel);
  doc.createElement = () => el("", {});
  const list = el("stack", {});
  list.id = "pick-list";
  doc.byId["pick-list"] = list;
  const zone = el("del", {});
  zone.id = "drop-delete";
  zone.hidden = true;
  zone.rect = { left: 0, right: 300, top: 500, bottom: 564, width: 300, height: 64 };
  doc.byId["drop-delete"] = zone;
  const dock = el("dock", {});
  doc.children = [list, zone, dock];
  doc.querySelector = (sel) => {
    if (sel === ".dock") return dock;
    return null;
  };
  const symbols = ["600519", "300750", "600036"];
  const rows = symbols.map((symbol, index) => {
    const row = el("row", { "data-symbol": symbol });
    row.rect = { left: 0, right: 320, top: index * 60, bottom: index * 60 + 50, width: 320, height: 50 };
    const handle = el("handle", {});
    row.appendChild(handle);
    list.appendChild(row);
    return { row, handle };
  });
  const calls = [];
  attachPickDrag(doc, (body) => { calls.push(body); return Promise.resolve(); });
  return { list, zone, dock, rows, calls };
}

function order(list) {
  return list.children.filter((child) => child.classList.contains("row")).map((row) => row.getAttribute("data-symbol"));
}

test("pointer drag reorders and does not delete", () => {
  const { list, rows, calls, zone } = build();
  const handle = rows[0].handle;
  list.dispatch("pointerdown", { target: handle, pointerId: 1, clientX: 10, clientY: 10, preventDefault() {} });
  list.dispatch("pointermove", { target: handle, pointerId: 1, clientX: 10, clientY: 100, preventDefault() {} });
  list.dispatch("pointerup", { target: handle, pointerId: 1, clientX: 10, clientY: 100, preventDefault() {} });
  assert.equal(zone.hidden, true);
  assert.deepEqual(order(list), ["300750", "600519", "600036"]);
  assert.deepEqual(calls, [{ op: "order", symbols: ["300750", "600519", "600036"] }]);
});

test("touch drag into the delete zone removes the stock", () => {
  const { list, rows, calls } = build();
  const handle = rows[1].handle;
  list.dispatch("touchstart", {
    target: handle,
    touches: [{ clientX: 12, clientY: 70 }],
    preventDefault() {},
  });
  list.dispatch("touchmove", {
    target: handle,
    touches: [{ clientX: 12, clientY: 530 }],
    preventDefault() {},
  });
  list.dispatch("touchend", {
    target: handle,
    changedTouches: [{ clientX: 12, clientY: 530 }],
    preventDefault() {},
  });
  assert.deepEqual(order(list), ["600519", "600036"]);
  assert.deepEqual(calls, [{ op: "delete", symbol: "300750" }]);
});
