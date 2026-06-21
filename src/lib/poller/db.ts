/**
 * OpenShield — Database Poller
 *
 * Queries database activity from each supported DB type:
 *   - POSTGRES: pg_stat_activity + last statement (via pg_stat_statements)
 *   - MYSQL:    information_schema.processlist + performance_schema
 *   - SQLSERVER: sys.dm_exec_sessions + sys.dm_exec_connections
 *
 * Strategy: poll the "current activity" view — captures logins + active sessions.
 * Historical event tracking requires DB-side audit logs (out of scope for v1).
 *
 * ## Multi-Database Scan Mode (Opsi B)
 * When `monitorAllDatabases: true` is set on the Asset, this poller will:
 *   1. Connect to a "bootstrap" DB (postgres / mysql / master) using
 *      `dbName` as the initial connection target
 *   2. Query the system catalog for ALL user databases
 *   3. Iterate per-DB and capture sessions for each
 *   4. Cache the discovered list in `Asset.discoveredDatabases` (JSON array)
 *   5. Emit one DbEvent per (user, db) pair across all databases
 *
 * For SQL Server, sys.databases queries are scoped to the instance (no DB needed).
 * For PostgreSQL, must have CONNECT privilege on each target DB.
 * For MySQL, SHOW DATABASES requires the PROCESS privilege.
 *
 * Auth: reads encrypted DB credentials from AssetCredential
 *
 * Note: For real audit logs (every query logged), the target DB needs
 *   - PostgreSQL: log_statement = 'all' + log_line_prefix + pgaudit extension
 *   - MySQL: general_log table or audit_log plugin
 *   - SQL Server: SQL Server Audit
 * This poller detects logins/connects — sufficient for security monitoring MVP.
 */

import { Client as PgClient } from "pg";
import mysql from "mysql2/promise";
import sql from "mssql";
import { decrypt } from "@/lib/security/crypto";
import type { DbEventInput } from "./types";

export type DbPollResult = {
  ok: boolean;
  events: DbEventInput[];
  error?: string;
  /**
   * Microsecond-precision cursor for mysql.general_log.event_time.
   * Only set by pollMysqlAuditLog() when ok=true.
   * Persist to Asset.lastAuditEventId so the next cycle resumes
   * exactly where we left off.
   */
  lastAuditEventId?: bigint;
};

/**
 * Decrypt DB credential (connection string or {user,password} JSON)
 */
export function decryptDbCredential(encData: string | null | undefined): {
  user: string;
  password: string;
} | null {
  if (!encData) return null;
  try {
    const dec = decrypt(encData);
    // Try JSON first, fall back to "user:password" format
    if (dec.startsWith("{")) {
      const j = JSON.parse(dec);
      return { user: j.user, password: j.password };
    }
    const [user, ...rest] = dec.split(":");
    return { user, password: rest.join(":") };
  } catch {
    return null;
  }
}

/**
 * Poll PostgreSQL — pull recent logins + active sessions
 */
export async function pollPostgres(params: {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}): Promise<DbPollResult> {
  const client = new PgClient({
    host: params.host,
    port: params.port,
    user: params.user,
    password: params.password,
    database: params.database,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 8_000,
  });

  const events: DbEventInput[] = [];
  try {
    await client.connect();
    // 1. Current sessions (any active = likely a login in last minute)
    const sessions = await client.query<{
      usename: string;
      client_addr: string | null;
      datname: string | null;
      state: string;
      backend_start: Date;
      application_name: string | null;
    }>(`
      SELECT
        usename,
        client_addr::text AS client_addr,
        datname,
        state,
        backend_start,
        application_name
      FROM pg_stat_activity
      WHERE backend_type = 'client backend'
        AND pid <> pg_backend_pid()
        AND datname IS NOT NULL
    `);

    for (const row of sessions.rows) {
      events.push({
        dbType: "POSTGRES",
        username: row.usename,
        sourceIp: row.client_addr ?? undefined,
        database: row.datname ?? undefined,
        status: "SUCCESS",
        eventTime: row.backend_start.toISOString(),
        raw: `app=${row.application_name ?? "n/a"}; state=${row.state}`,
      });
    }

    // 2. Failed login attempts from pg_log (if available via SQL function)
    //    pg_log_backend_memory_contexts, pg_stat_database, etc. — only
    //    available if DBA configured logging_collector. Skip for MVP.

    await client.end();
    return { ok: true, events };
  } catch (err) {
    try {
      await client.end();
    } catch {}
    return {
      ok: false,
      events: [],
      error: `Postgres poll failed: ${(err as Error).message}`,
    };
  }
}

/**
 * Poll MySQL — pull processlist (active sessions = logins)
 */
export async function pollMysql(params: {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}): Promise<DbPollResult> {
  let conn: mysql.Connection | null = null;
  const events: DbEventInput[] = [];
  try {
    conn = await mysql.createConnection({
      host: params.host,
      port: params.port,
      user: params.user,
      password: params.password,
      database: params.database,
      connectTimeout: 10_000,
    });

    // processlist: every connected user session
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT
         USER AS user,
         HOST AS host,
         db,
         COMMAND,
         TIME,
         STATE
       FROM information_schema.processlist
       WHERE ID <> CONNECTION_ID()`
    );

    for (const r of rows) {
      // Parse "user@ip" from HOST. MySQL processlist HOST is "IP:PORT"
      // (e.g. "172.16.19.235:33812") so we split on the FIRST colon.
      // Without this fix, sourceIp was recorded as the port number only.
      const hostStr = String(r.host ?? "");
      const firstColon = hostStr.indexOf(":");
      const ip = firstColon > 0 ? hostStr.substring(0, firstColon) : hostStr;
      const user = String(r.user ?? "").split("@")[0];

      events.push({
        dbType: "MYSQL",
        username: user || "unknown",
        sourceIp: ip || undefined,
        database: (r.db as string) || undefined,
        status: "SUCCESS",
        eventTime: new Date().toISOString(),
        raw: `cmd=${r.COMMAND}; time=${r.TIME}s; state=${r.STATE ?? "n/a"}`,
      });
    }

    return { ok: true, events };
  } catch (err) {
    return {
      ok: false,
      events: [],
      error: `MySQL poll failed: ${(err as Error).message}`,
    };
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}

/**
 * Poll SQL Server — pull active sessions
 */
export async function pollSqlServer(params: {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}): Promise<DbPollResult> {
  let pool: sql.ConnectionPool | null = null;
  const events: DbEventInput[] = [];
  try {
    pool = await sql.connect({
      server: params.host,
      port: params.port,
      user: params.user,
      password: params.password,
      database: params.database,
      connectionTimeout: 10_000,
      requestTimeout: 8_000,
      options: {
        encrypt: true,
        trustServerCertificate: true, // for self-signed
      },
    });

    const result = await pool.request().query<{
      login_name: string;
      client_net_address: string;
      db_name: string;
      status: string;
      login_time: Date;
      program_name: string;
    }>(`
      SELECT
        s.login_name,
        c.client_net_address,
        DB_NAME(s.database_id) AS db_name,
        s.status,
        s.login_time,
        s.program_name
      FROM sys.dm_exec_sessions s
      LEFT JOIN sys.dm_exec_connections c ON s.session_id = c.session_id
      WHERE s.is_user_process = 1
    `);

    for (const r of result.recordset) {
      events.push({
        dbType: "SQLSERVER",
        username: r.login_name,
        sourceIp: r.client_net_address || undefined,
        database: r.db_name || undefined,
        status: "SUCCESS",
        eventTime: r.login_time.toISOString(),
        raw: `app=${r.program_name ?? "n/a"}; status=${r.status}`,
      });
    }

    return { ok: true, events };
  } catch (err) {
    return {
      ok: false,
      events: [],
      error: `SQL Server poll failed: ${(err as Error).message}`,
    };
  } finally {
    if (pool) await pool.close().catch(() => {});
  }
}

/**
 * Dispatcher: poll based on dbType
 */
export async function pollDatabase(params: {
  dbType: "POSTGRES" | "MYSQL" | "SQLSERVER";
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  monitorAllDatabases?: boolean;
  auditConnectionLog?: boolean;
  lastAuditEventId?: bigint | null;
}): Promise<
  DbPollResult & {
    discoveredDatabases?: string[];
    lastAuditEventId?: bigint;
  }
> {
  // Multi-DB scan mode: list databases first, then poll each
  if (params.monitorAllDatabases) {
    return pollAllDatabases(params);
  }
  switch (params.dbType) {
    case "POSTGRES":
      return pollPostgres(params);
    case "MYSQL":
      return pollMysql(params);
    case "SQLSERVER":
      return pollSqlServer(params);
    default:
      return { ok: false, events: [], error: `Unknown dbType: ${params.dbType}` };
  }
}

// ============================================================
// MULTI-DATABASE SCAN MODE (Opsi B)
// ============================================================

/**
 * List all user databases on the server.
 * Returns names suitable for connection (excludes templates, system DBs).
 */
async function listPostgresDatabases(client: PgClient): Promise<string[]> {
  const r = await client.query<{ datname: string }>(`
    SELECT datname FROM pg_database
    WHERE datistemplate = false
      AND datname NOT IN ('postgres')
    ORDER BY datname
  `);
  return r.rows.map((row) => row.datname);
}

async function listMysqlDatabases(conn: mysql.Connection): Promise<string[]> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    `SHOW DATABASES WHERE \`Database\` NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys')`
  );
  return rows.map((r) => String(r.Database));
}

async function listSqlServerDatabases(
  pool: sql.ConnectionPool
): Promise<string[]> {
  const result = await pool.request().query<{ name: string }>(
    `SELECT name FROM sys.databases
     WHERE name NOT IN ('master', 'tempdb', 'model', 'msdb')
       AND state = 0
     ORDER BY name`
  );
  return result.recordset.map((r) => r.name);
}

/**
 * Multi-DB scan: discover databases on server, then poll each for sessions.
 * Returns aggregated events + the discovered database list.
 */
async function pollAllDatabases(params: {
  dbType: "POSTGRES" | "MYSQL" | "SQLSERVER";
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}): Promise<DbPollResult & { discoveredDatabases?: string[] }> {
  const allEvents: DbEventInput[] = [];
  let discovered: string[] = [];

  // Phase 1: Connect to bootstrap DB and list databases
  if (params.dbType === "POSTGRES") {
    const client = new PgClient({
      host: params.host,
      port: params.port,
      user: params.user,
      password: params.password,
      database: params.database || "postgres",
      connectionTimeoutMillis: 10_000,
    });
    try {
      await client.connect();
      discovered = await listPostgresDatabases(client);
    } catch (err) {
      return {
        ok: false,
        events: [],
        error: `PG discovery failed: ${(err as Error).message}`,
      };
    } finally {
      try { await client.end(); } catch {}
    }

    // Phase 2: poll each discovered DB for sessions
    for (const db of discovered) {
      const r = await pollPostgres({ ...params, database: db });
      if (r.ok) allEvents.push(...r.events);
    }
  } else if (params.dbType === "MYSQL") {
    let conn: mysql.Connection | null = null;
    try {
      conn = await mysql.createConnection({
        host: params.host,
        port: params.port,
        user: params.user,
        password: params.password,
        database: params.database || "mysql",
        connectTimeout: 10_000,
      });
      discovered = await listMysqlDatabases(conn);
    } catch (err) {
      return {
        ok: false,
        events: [],
        error: `MySQL discovery failed: ${(err as Error).message}`,
      };
    } finally {
      if (conn) await conn.end().catch(() => {});
    }

    for (const db of discovered) {
      const r = await pollMysql({ ...params, database: db });
      if (r.ok) allEvents.push(...r.events);
    }
  } else if (params.dbType === "SQLSERVER") {
    let pool: sql.ConnectionPool | null = null;
    try {
      pool = await sql.connect({
        server: params.host,
        port: params.port,
        user: params.user,
        password: params.password,
        database: params.database || "master",
        connectionTimeout: 10_000,
        requestTimeout: 8_000,
        options: { encrypt: true, trustServerCertificate: true },
      });
      discovered = await listSqlServerDatabases(pool);
    } catch (err) {
      return {
        ok: false,
        events: [],
        error: `MSSQL discovery failed: ${(err as Error).message}`,
      };
    } finally {
      if (pool) await pool.close().catch(() => {});
    }

    for (const db of discovered) {
      const r = await pollSqlServer({ ...params, database: db });
      if (r.ok) allEvents.push(...r.events);
    }
  }

  return {
    ok: true,
    events: allEvents,
    discoveredDatabases: discovered,
  };
}

// ============================================================
// MYSQL CONNECTION AUDIT LOG (mysql.general_log TABLE)
// ============================================================

/**
 * Parse one row of mysql.general_log into one or more DbEvent inputs.
 *
 * Row shapes (MySQL 8.0):
 *   - "user@host on  using SSL/TLS"          → CONNECT (success)
 *   - "Access denied for user 'u'@'host' ..." → CONNECT (failure)
 *   - "" (empty)                              → QUIT (disconnect)
 *
 * We deliberately IGNORE command_type='Query' rows — query bodies are
 * never persisted to OpenShield (privacy + storage). Only auth events.
 *
 * MySQL's general_log.event_time is microsecond-precision DATETIME(6);
 * we return a string ISO of that timestamp for stable dedup.
 */
function parseGeneralLogRow(row: {
  event_time: Date;
  user_host: string;
  argument: string;
}): DbEventInput[] {
  const arg = String(row.argument ?? "");
  const userHost = String(row.user_host ?? "");

  // user_host format: "user[user] @ host [ip]" or "[user] @ host [ip]"
  // Extract user (first bracket group) and IP (second bracket group).
  const userMatch = userHost.match(/^(?:([^\[]+)\[)?([^\]]*)\]\s*@\s*(?:([^\[]+)\s*)?\[([^\]]+)\]/);
  const username = userMatch?.[2] || "";
  const sourceIp = userMatch?.[4] || undefined;

  const isoTime =
    row.event_time instanceof Date
      ? row.event_time.toISOString()
      : new Date(row.event_time).toISOString();

  // Access denied → failure event
  if (/Access denied/i.test(arg)) {
    return [
      {
        dbType: "MYSQL",
        username: username || "unknown",
        sourceIp,
        database: undefined,
        status: "DENIED",
        eventTime: isoTime,
        raw: `mysql.general_log: ${arg.slice(0, 200)}`,
      },
    ];
  }

  // Successful connect
  if (/^[^@]+@\S+\s+on\s+/i.test(arg) || /using (?:SSL\/TLS|UNIX socket)/i.test(arg)) {
    return [
      {
        dbType: "MYSQL",
        username: username || "unknown",
        sourceIp,
        database: undefined,
        status: "SUCCESS",
        eventTime: isoTime,
        raw: `mysql.general_log: ${arg.slice(0, 200)}`,
      },
    ];
  }

  // Quit / disconnect
  if (arg.trim() === "") {
    return [
      {
        dbType: "MYSQL",
        username: username || "unknown",
        sourceIp,
        database: undefined,
        status: "SUCCESS",
        eventTime: isoTime,
        raw: "mysql.general_log: connection closed",
      },
    ];
  }

  // Anything else (Query command etc.) — intentionally skipped
  return [];
}

/**
 * Poll MySQL connection audit log (mysql.general_log TABLE mode).
 *
 * Reads new Connect/Quit/Access-denied rows since `lastAuditEventId`
 * (microsecond cursor). Requires manual setup on target MySQL:
 *   SET GLOBAL log_output='TABLE';
 *   SET GLOBAL general_log='ON';
 *
 * Returns events + the new cursor (last event_time microseconds) so
 * the caller can persist it for the next cycle.
 */
export async function pollMysqlAuditLog(params: {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  lastAuditEventId?: bigint | null;
}): Promise<
  DbPollResult & { lastAuditEventId?: bigint }
> {
  let conn: mysql.Connection | null = null;
  const events: DbEventInput[] = [];
  try {
    conn = await mysql.createConnection({
      host: params.host,
      port: params.port,
      user: params.user,
      password: params.password,
      database: params.database,
      connectTimeout: 10_000,
    });

    // Convert lastAuditEventId (microseconds since epoch) → Date filter.
    // mysql.general_log.event_time is DATETIME(6) so we filter by
    // event_time > lastSeen with a 1-second safety margin.
    let cursorClause = "";
    const cursorParams: (Date | string | number)[] = [];
    if (params.lastAuditEventId != null) {
      const cursorMs = Number(params.lastAuditEventId) / 1000;
      const cursorDate = new Date(cursorMs - 1000); // 1s safety margin
      cursorClause = "AND event_time > ?";
      cursorParams.push(cursorDate);
    }

    // Limit to Connect/Quit only; skip Query events (privacy + perf).
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT event_time, user_host, argument
       FROM mysql.general_log
       WHERE command_type IN ('Connect', 'Quit')
         ${cursorClause}
       ORDER BY event_time ASC
       LIMIT 500`,
      cursorParams
    );

    let maxTime: bigint | undefined = params.lastAuditEventId ?? undefined;
    for (const r of rows) {
      const parsed = parseGeneralLogRow({
        event_time: r.event_time as Date,
        user_host: String(r.user_host ?? ""),
        argument: String(r.argument ?? ""),
      });
      events.push(...parsed);

      // Track max microsecond timestamp we've seen
      const t = r.event_time instanceof Date ? r.event_time.getTime() : 0;
      const us = BigInt(t) * BigInt(1000);
      if (maxTime === undefined || us > maxTime) maxTime = us;
    }

    return {
      ok: true,
      events,
      lastAuditEventId: maxTime,
    };
  } catch (err) {
    const msg = (err as Error).message;
    // Friendly hint if general_log isn't enabled (table doesn't exist
    // or is empty due to log_output='FILE')
    if (/doesn't exist|no such table/i.test(msg)) {
      return {
        ok: false,
        events: [],
        error:
          "mysql.general_log table not available. Run: SET GLOBAL log_output='TABLE'; SET GLOBAL general_log='ON';",
      };
    }
    return {
      ok: false,
      events: [],
      error: `MySQL audit log poll failed: ${msg}`,
    };
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}
