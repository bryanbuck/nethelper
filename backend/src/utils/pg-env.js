/**
 * libpq connection settings for pg_dump/pg_restore, from Prisma's DATABASE_URL.
 *
 * Passed as PG* environment variables, never on argv (where `ps` shows them).
 * Prisma-only URL parameters (schema, connection_limit, ...) aren't libpq's, so
 * the URL itself can't be handed to the tools.
 */
function pgEnvFromUrl(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }
  if (!/^postgres(ql)?:$/.test(url.protocol)) throw new Error('DATABASE_URL is not a PostgreSQL URL');

  const env = {};
  const params = url.searchParams;
  const host = params.get('host') || decodeURIComponent(url.hostname);
  if (host) env.PGHOST = host;
  if (url.port) env.PGPORT = url.port;
  if (url.username) env.PGUSER = decodeURIComponent(url.username);
  if (url.password) env.PGPASSWORD = decodeURIComponent(url.password);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (database) env.PGDATABASE = database;
  if (params.get('sslmode')) env.PGSSLMODE = params.get('sslmode');
  if (params.get('sslcert')) env.PGSSLCERT = params.get('sslcert');
  if (params.get('sslkey')) env.PGSSLKEY = params.get('sslkey');
  if (params.get('sslrootcert')) env.PGSSLROOTCERT = params.get('sslrootcert');
  env.PGAPPNAME = 'nethelper-app-backup';

  return { env, schema: params.get('schema') || 'public', database };
}

/** Major version from `pg_dump --version` style output ("pg_dump (PostgreSQL) 17.2 (Debian ...)"). */
function parseToolMajor(output) {
  const match = /\(PostgreSQL\)\s+(\d+)(?:\.(\d+))?/.exec(String(output || ''));
  return match ? { major: Number(match[1]), version: match[2] ? `${match[1]}.${match[2]}` : match[1] } : null;
}

module.exports = { pgEnvFromUrl, parseToolMajor };
