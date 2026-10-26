// ทำให้ `env` จาก "cloudflare:workers" มี type ของ bindings
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    TEAM_PIN?: string;
  }
}
