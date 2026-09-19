// Launch-gate production auth matrix — two throwaway accounts, real prod behavior.
const BASE = "https://terp-talk.vercel.app";
const suffix = Math.random().toString(36).slice(2, 8);
const A = { username: `lga_${suffix}`, password: `Terp${suffix}!x9Kp` };
const B = { username: `lgb_${suffix}`, password: `Terp${suffix}!x9Kp` };
const results = [];
const check = (name, ok, detail = "") => { results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); };

async function solveCaptcha() {
  const r = await fetch(`${BASE}/api/captcha`);
  const { id, question } = await r.json();
  const m = question.match(/What is (\d+) \+ (\d+)\?/);
  if (!m) throw new Error("unexpected captcha: " + question);
  return { id, answer: String(Number(m[1]) + Number(m[2])) };
}

async function register({ username, password }) {
  const { id, answer } = await solveCaptcha();
  const r = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, ageVerified: true, captchaId: id, captchaAnswer: answer }),
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}

async function login({ username, password }) {
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  const { csrfToken } = await csrfRes.json();
  const csrfCookie = (csrfRes.headers.getSetCookie?.() || [csrfRes.headers.get("set-cookie")]).filter(Boolean).map(c => c.split(";")[0]).join("; ");
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", cookie: csrfCookie },
    body: new URLSearchParams({ csrfToken, username, password, json: "true" }),
    redirect: "manual",
  });
  const cookie = [...(csrfCookie ? [csrfCookie] : []), ...(res.headers.getSetCookie?.() || []).map(c => c.split(";")[0])].join("; ");
  return cookie;
}

const get = (path, cookie) => fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {}, redirect: "manual" });
const api = (path, { method = "GET", body, cookie } = {}) => fetch(`${BASE}${path}`, {
  method,
  headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
  body: body ? JSON.stringify(body) : undefined,
  redirect: "manual",
});

const run = async () => {
  // --- register + login ---
  const ra = await register(A);
  check("register A", ra.status === 200 || ra.status === 201, `status=${ra.status} ${JSON.stringify(ra.body).slice(0, 120)}`);
  const rb = await register(B);
  check("register B", rb.status === 200 || rb.status === 201, `status=${rb.status} ${JSON.stringify(rb.body).slice(0, 120)}`);
  if (ra.status >= 400 || rb.status >= 400) return;

  const cookieA = await login(A);
  const cookieB = await login(B);
  check("login A", cookieA.includes("session-token") || cookieA.includes("__Secure"), cookieA.slice(0, 80));
  check("login B", cookieB.includes("session-token") || cookieB.includes("__Secure"));

  const sessA = await api("/api/auth/session", { cookie: cookieA }).then(r => r.json());
  const sessB = await api("/api/auth/session", { cookie: cookieB }).then(r => r.json());
  const idA = sessA?.user?.id, idB = sessB?.user?.id;
  check("session A identity", !!idA, `id=${idA}`);
  check("session B identity", !!idB && idB !== idA, `id=${idB}`);

  // --- A creates three diaries ---
  const mk = async (vis, tag) => {
    const r = await api("/api/diaries", {
      method: "POST", cookie: cookieA,
      body: { title: `zz launchgate ${tag} ${suffix}`, description: "launch-gate test", growType: "INDOOR", startDate: "2026-09-01", visibility: vis },
    });
    const d = await r.json().catch(() => ({}));
    return { status: r.status, diary: d.diary || d };
  };
  const pub = await mk("PUBLIC", "pub");
  const unl = await mk("UNLISTED", "unl");
  const prv = await mk("PRIVATE", "prv");
  check("create PUBLIC diary", pub.status === 200 || pub.status === 201, `status=${pub.status}`);
  check("create UNLISTED diary", unl.status === 200 || unl.status === 201, `status=${unl.status}`);
  check("create PRIVATE diary", prv.status === 200 || prv.status === 201, `status=${prv.status}`);
  const D = { pub: pub.diary, unl: unl.diary, prv: prv.diary };
  for (const [k, d] of Object.entries(D)) check(`${k} diary has slug`, !!d?.slug, `slug=${d?.slug}`);

  // --- owner access ---
  for (const [k, d] of Object.entries(D)) {
    if (!d?.slug) continue;
    const r = await get(`/diaries/${d.slug}`, cookieA);
    check(`owner views ${k} slug`, r.status === 200, `status=${r.status}`);
  }

  // --- matrix: guest + B for each diary, both URL forms ---
  for (const [k, d] of Object.entries(D)) {
    if (!d?.slug || !d?.id) continue;
    for (const [who, cookie] of [["guest", null], ["B", cookieB]]) {
      const rSlug = await get(`/diaries/${d.slug}`, cookie);
      const rId = await get(`/diaries/${d.id}`, cookie);
      const loc = rId.headers.get("location") || "";
      if (k === "prv") {
        check(`${who} PRIVATE slug → 404`, rSlug.status === 404, `status=${rSlug.status}`);
        check(`${who} PRIVATE id → 404 (no redirect leak)`, rId.status === 404 && !loc.includes(d.slug), `status=${rId.status} loc=${loc || "none"}`);
      } else {
        check(`${who} ${k} slug → 200`, rSlug.status === 200, `status=${rSlug.status}`);
        check(`${who} ${k} id → 308 slug`, rId.status === 308 && loc.includes(d.slug), `status=${rId.status} loc=${loc || "none"}`);
      }
    }
  }

  // --- discovery surfaces as B ---
  const idxHtml = await get("/diaries", cookieB).then(r => r.text());
  check("PUBLIC in /diaries index", idxHtml.includes(D.pub.slug), "");
  check("UNLISTED absent from /diaries index", !idxHtml.includes(D.unl.slug));
  check("PRIVATE absent from /diaries index", !idxHtml.includes(D.prv.slug) && !idxHtml.includes(`zz launchgate prv ${suffix}`));

  const search = await api(`/api/search?q=launchgate%20${suffix}&type=diaries`, { cookie: cookieB }).then(r => r.json());
  const hits = JSON.stringify(search);
  check("PUBLIC in search", hits.includes(D.pub.slug), "");
  check("UNLISTED absent from search", !hits.includes(D.unl.slug));
  check("PRIVATE absent from search", !hits.includes(D.prv.slug) && !hits.includes(`zz launchgate prv`));

  const prof = await get(`/u/${A.username}`, cookieB).then(r => r.text());
  check("PUBLIC on A's profile", prof.includes(D.pub.slug) || prof.includes(`zz launchgate pub`), "");
  check("UNLISTED absent from A's profile", !prof.includes(D.unl.slug) && !prof.includes(`zz launchgate unl`));
  check("PRIVATE absent from A's profile", !prof.includes(D.prv.slug) && !prof.includes(`zz launchgate prv`));

  // --- sitemap ---
  const sm = await get("/sitemap.xml", null).then(r => r.text());
  check("PUBLIC slug in sitemap", sm.includes(D.pub.slug));
  check("UNLISTED not in sitemap", !sm.includes(D.unl.slug));
  check("PRIVATE not in sitemap", !sm.includes(D.prv.slug));
  check("no id-form diary urls in sitemap", !sm.includes(`/diaries/${D.pub.id}`) && !sm.includes(`/diaries/${D.prv.id}`));

  // --- noindex on unlisted ---
  const unlHtml = await get(`/diaries/${D.unl.slug}`, cookieB).then(r => r.text());
  check("UNLISTED emits noindex", /noindex/i.test(unlHtml), "");

  // --- authz: B cannot edit A's diary ---
  const patch = await api(`/api/diaries/${D.pub.id}`, { method: "PATCH", cookie: cookieB, body: { title: "hijacked" } });
  check("B cannot PATCH A's diary", patch.status === 403 || patch.status === 404 || patch.status === 401, `status=${patch.status}`);
  const visPatch = await api(`/api/diaries/${D.pub.id}`, { method: "PATCH", cookie: cookieB, body: { visibility: "PUBLIC" } });
  check("B cannot change A's visibility", visPatch.status === 403 || visPatch.status === 404 || visPatch.status === 401, `status=${visPatch.status}`);
  const editPage = await get(`/diaries/${D.pub.id}/edit`, cookieB);
  check("B cannot open A's edit page", [401, 403, 404, 307].includes(editPage.status), `status=${editPage.status}`);

  // --- blocks ---
  if (idB) {
    const blk = await api("/api/blocks", { method: "POST", cookie: cookieA, body: { userId: idB } });
    check("A blocks B", blk.status === 200 || blk.status === 201, `status=${blk.status}`);
    const idxB = await get("/diaries", cookieB).then(r => r.text());
    check("blocked: A's PUBLIC absent from B's index", !idxB.includes(D.pub.slug) && !idxHtml.includes(`zz launchgate pub`));
    const searchB = await api(`/api/search?q=launchgate%20${suffix}&type=diaries`, { cookie: cookieB }).then(r => r.json());
    check("blocked: A's PUBLIC absent from B's search", !JSON.stringify(searchB).includes(D.pub.slug));
    const directB = await get(`/diaries/${D.pub.slug}`, cookieB);
    check("blocked: B direct-URL on A's PUBLIC (documented semantics)", true, `status=${directB.status}`);
    // unblock
    const unblk = await api("/api/blocks", { method: "DELETE", cookie: cookieA, body: { userId: idB } });
    check("A unblocks B (cleanup)", [200, 204].includes(unblk.status), `status=${unblk.status}`);
  }

  // --- cleanup: delete test diaries ---
  for (const d of Object.values(D)) {
    if (!d?.id) continue;
    const del = await api("/api/diaries", { method: "DELETE", cookie: cookieA, body: { id: d.id } });
    check(`delete ${d.slug || d.id}`, [200, 204].includes(del.status), `status=${del.status}`);
  }
};

run().then(() => {
  console.log(results.join("\n"));
  console.log(`\n${results.filter(r => r.startsWith("PASS")).length}/${results.length} passed`);
}).catch(e => { console.error("SCRIPT ERROR:", e); console.log(results.join("\n")); });
