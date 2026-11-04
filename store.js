// Armazenamento chave/valor: Postgres (DATABASE_URL) ou arquivo JSON (desenvolvimento).
const fs = require('fs');
async function makeStore() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === '0' ? false : { rejectUnauthorized: false }, max: 8 });
    await pool.query('CREATE TABLE IF NOT EXISTS kv (path text PRIMARY KEY, data jsonb NOT NULL, at bigint NOT NULL DEFAULT 0)');
    await pool.query("CREATE INDEX IF NOT EXISTS kv_prefix ON kv (path text_pattern_ops)");
    return {
      kind: 'postgres',
      async get(p) { const r = await pool.query('SELECT data FROM kv WHERE path=$1', [p]); return r.rows[0] ? r.rows[0].data : null; },
      async set(p, d) { await pool.query('INSERT INTO kv(path,data,at) VALUES($1,$2,$3) ON CONFLICT (path) DO UPDATE SET data=$2, at=$3', [p, JSON.stringify(d), Number(d.at) || Date.now()]); },
      async del(p) { await pool.query('DELETE FROM kv WHERE path=$1', [p]); },
      async list(prefix, limit = 500, newest = true) {
        const r = await pool.query('SELECT path,data FROM kv WHERE path LIKE $1 ORDER BY at ' + (newest ? 'DESC' : 'ASC') + ' LIMIT $2', [prefix.replace(/[%_\\]/g, '\\$&') + '%', limit]);
        return r.rows.map(x => ({ path: x.path, data: x.data }));
      },
      async count(prefix) { const r = await pool.query('SELECT count(*)::int n FROM kv WHERE path LIKE $1', [prefix.replace(/[%_\\]/g, '\\$&') + '%']); return r.rows[0].n; },
      async trim(prefix, keep) { await pool.query('DELETE FROM kv WHERE path LIKE $1 AND path NOT IN (SELECT path FROM kv WHERE path LIKE $1 ORDER BY at DESC LIMIT $2)', [prefix.replace(/[%_\\]/g, '\\$&') + '%', keep]); }
    };
  }
  const file = process.env.DATA_FILE || './data.json';
  let m = {};
  try { m = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
  let t = null;
  const flush = () => { clearTimeout(t); t = setTimeout(() => { try { fs.writeFileSync(file + '.tmp', JSON.stringify(m)); fs.renameSync(file + '.tmp', file); } catch (e) {} }, 200); };
  const ls = (prefix) => Object.keys(m).filter(k => k.startsWith(prefix));
  return {
    kind: 'file',
    async get(p) { return m[p] ? JSON.parse(JSON.stringify(m[p])) : null; },
    async set(p, d) { m[p] = JSON.parse(JSON.stringify(d)); flush(); },
    async del(p) { delete m[p]; flush(); },
    async list(prefix, limit = 500, newest = true) {
      const a = ls(prefix).map(k => ({ path: k, data: m[k] })).sort((x, y) => (newest ? -1 : 1) * ((x.data.at || 0) - (y.data.at || 0)));
      return a.slice(0, limit);
    },
    async count(prefix) { return ls(prefix).length; },
    async trim(prefix, keep) { const a = ls(prefix).sort((x, y) => (m[y].at || 0) - (m[x].at || 0)); a.slice(keep).forEach(k => delete m[k]); flush(); }
  };
}
module.exports = { makeStore };
