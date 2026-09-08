/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const env = fs.readFileSync(".env", "utf8");
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=["']?(.*?)["']?$/);
  if (m) process.env[m[1]] = m[2];
}
const Pusher = require("pusher");
const p = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS: true,
});
p.trigger("test-channel", "test-event", { ok: true })
  .then(() => { console.log("PUSHER OK — credentials valid"); process.exit(0) })
  .catch((e) => { console.log("PUSHER FAIL:", e.message); process.exit(1) });
