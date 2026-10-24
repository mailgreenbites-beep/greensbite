// Green Bites order API for Netlify. Stores data in Netlify Blobs.
// Set the environment variable ADMIN_PASSWORD in Netlify (Site configuration > Environment variables).
import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

export const config = { path: "/api/*" };

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const PATH_RE = /^[A-Za-z0-9_\-.~:@+]{1,200}(\/[A-Za-z0-9_\-.~:@+]{1,200}){0,14}$/;
const parent = (p) => { const i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); };
const json = (code, obj) => new Response(JSON.stringify(obj), { status: code, headers: { "content-type": "application/json", "cache-control": "no-store" } });

function canRead(p, isCol, uid, adm) {
  if (adm) return true;
  const s = p.split("/"), c = s[0];
  if (["catalog", "catimg", "status"].includes(c)) return true;
  if (["orders", "live", "customers", "team"].includes(c)) return !isCol && s[1] === uid;
  if (c === "dispatch") return s[1] === uid;
  return false;
}
function canWrite(p, uid, adm) {
  if (adm) return true;
  const s = p.split("/"), c = s[0];
  if (["orders", "live", "customers"].includes(c)) return s.length === 2 && s[1] === uid;
  if (c === "dispatch") return s[1] === uid && s[2] !== "orders";
  return false;
}

export default async (req) => {
  const store = getStore({ name: "greenbites", consistency: "strong" });
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api/, "");
  const ip = req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "";
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
  try {
    let bodyJson = {};
    if (req.method === "POST" || req.method === "PUT") {
      const t = await req.text();
      if (t.length > 5.5 * 1024 * 1024) return json(413, { error: "too big" });
      try { bodyJson = t ? JSON.parse(t) : {}; } catch (e) { return json(400, { error: "bad json" }); }
    }
    if (route === "/session" && req.method === "POST") {
      const b = bodyJson;
      if (typeof b.uid === "string" && /^u_[A-Za-z0-9_-]{10,40}$/.test(b.uid) && b.secret) {
        const cur = await store.get("s/" + b.uid, { type: "json" });
        if (cur && cur.h === sha(b.secret)) return json(200, { uid: b.uid, secret: b.secret, admin: !!cur.admin });
      }
      const uid = "u_" + crypto.randomBytes(16).toString("base64url"), secret = crypto.randomBytes(24).toString("base64url");
      await store.setJSON("s/" + uid, { h: sha(secret), t: Date.now() });
      return json(200, { uid, secret, admin: false });
    }
    const uid = req.headers.get("x-uid"), sec = req.headers.get("x-secret");
    let me = { uid: null, adm: false }, sess = null;
    if (uid && /^u_[A-Za-z0-9_-]{10,40}$/.test(uid) && sec) {
      sess = await store.get("s/" + uid, { type: "json" });
      if (sess && sess.h === sha(sec)) me = { uid, adm: !!sess.admin };
    }
    if (!me.uid) return json(401, { error: "no session" });

    if (route === "/admin/login" && req.method === "POST") {
      if (!ADMIN_PASSWORD) return json(500, { error: "ADMIN_PASSWORD is not set on the server" });
      const rk = "r/" + sha(ip || "x").slice(0, 24), now = Date.now();
      let r = (await store.get(rk, { type: "json" })) || { n: 0, t: now };
      if (now - r.t > 10 * 60e3) r = { n: 0, t: now };
      if (r.n >= 8) return json(429, { error: "Too many attempts. Wait a few minutes." });
      const a = Buffer.from(sha(bodyJson.password || "")), c = Buffer.from(sha(ADMIN_PASSWORD));
      if (!crypto.timingSafeEqual(a, c)) { r.n++; await store.setJSON(rk, r); return json(403, { error: "Wrong password" }); }
      await store.setJSON("s/" + uid, { ...sess, admin: true });
      return json(200, { admin: true });
    }
    if (route === "/admin/logout" && req.method === "POST") {
      await store.setJSON("s/" + uid, { ...sess, admin: false });
      return json(200, { admin: false });
    }
    if (route === "/me") return json(200, { uid: me.uid, admin: me.adm });

    if (route === "/col" && req.method === "GET") {
      const p = url.searchParams.get("path") || "";
      if (!PATH_RE.test(p)) return json(400, { error: "bad path" });
      if (!canRead(p, true, me.uid, me.adm)) return json(403, { error: "denied" });
      const v = (await store.get("v/" + p, { type: "text" })) || "0";
      if (url.searchParams.get("v") === v && v !== "0") return json(200, { v: Number(v), same: true });
      const pre = "d/" + p + "/", { blobs } = await store.list({ prefix: pre });
      const keys = blobs.map((b) => b.key).filter((k) => k.indexOf("/", pre.length) < 0);
      const docs = [];
      for (let i = 0; i < keys.length; i += 20) {
        const part = await Promise.all(keys.slice(i, i + 20).map(async (k) => { const d = await store.get(k, { type: "json" }); return d ? { id: k.slice(pre.length), data: d.d, version: d.v } : null; }));
        part.forEach((x) => x && docs.push(x));
      }
      return json(200, { v: Number(v), docs });
    }

    if (route === "/doc") {
      if (req.method === "PUT") {
        const q = bodyJson.path;
        if (typeof q !== "string" || !PATH_RE.test(q) || q.split("/").length % 2) return json(400, { error: "bad path" });
        if (!bodyJson.data || typeof bodyJson.data !== "object" || Array.isArray(bodyJson.data)) return json(400, { error: "bad data" });
        if (!canWrite(q, me.uid, me.adm)) return json(403, { error: "denied" });
        const old = await store.get("d/" + q, { type: "json" });
        await store.setJSON("d/" + q, { d: bodyJson.data, v: ((old && old.v) || 0) + 1, t: Date.now() });
        await store.set("v/" + parent(q), String(Date.now()));
        return json(200, { ok: true });
      }
      const p = url.searchParams.get("path");
      if (!p || !PATH_RE.test(p) || p.split("/").length % 2) return json(400, { error: "bad path" });
      if (req.method === "GET") {
        if (!canRead(p, false, me.uid, me.adm)) return json(403, { error: "denied" });
        const d = await store.get("d/" + p, { type: "json" });
        return json(200, d ? { exists: true, data: d.d, version: d.v } : { exists: false });
      }
      if (req.method === "DELETE") {
        if (!canWrite(p, me.uid, me.adm)) return json(403, { error: "denied" });
        await store.delete("d/" + p);
        await store.set("v/" + parent(p), String(Date.now()));
        return json(200, { ok: true });
      }
    }
    return json(404, { error: "not found" });
  } catch (e) {
    return json(500, { error: "server error" });
  }
};
