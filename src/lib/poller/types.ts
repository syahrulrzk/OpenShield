/**
 * OpenShield — Poller types
 */

export type SshEventInput = {
  username: string;
  sourceIp: string;
  status: "SUCCESS" | "FAILED" | "INVALID";
  method?: string;
  eventTime: string; // ISO
  country?: string;
  raw?: string;
};

export type DbEventInput = {
  dbType: "POSTGRES" | "MYSQL" | "SQLSERVER";
  username: string;
  sourceIp?: string;
  database?: string;
  status: "SUCCESS" | "FAILED" | "DENIED";
  eventTime: string; // ISO
  raw?: string;
};

export type PollerAssetSummary = {
  id: string;
  hostname: string;
  category: "SSH" | "DATABASE";
  environment: string;
  userId: string;
  sshUser: string | null;
  sshPort: number;
  dbType: string;
  dbHost: string | null;
  dbPort: number | null;
  dbName: string | null;
  dbUser: string | null;
  pollerCursor: string | null;
  sshEncData: string | null;
  dbEncData: string | null;
};

export type PollerRunResult = {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  totalAssets: number;
  success: number;
  failed: number;
  skipped: number;
  eventsCollected: number;
  eventsInserted: number;
  errors: Array<{ assetId: string; hostname: string; error: string }>;
};
