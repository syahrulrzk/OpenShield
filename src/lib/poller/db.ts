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
      // Parse "user@ip" from HOST
      const hostStr = String(r.host ?? "");
      const lastAt = hostStr.lastIndexOf(":");
      const ip = lastAt > 0 ? hostStr.substring(lastAt + 1) : hostStr;
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
}): Promise<DbPollResult> {
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
