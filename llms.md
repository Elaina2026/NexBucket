# LLMS.txt - VanillaDatabase AI & Agent Reference Guide

> VanillaDatabase (VanillaDB) is a multi-tenant, zero-configuration SQLite cloud database engine featuring real-time event streaming (SSE), database-scoped media storage with HTTP 206 range streaming, multi-database DDL/DML converter (MySQL, PostgreSQL, MongoDB, CSV), AI Vector Cosine Similarity Search, granular API token permissions, HMAC-SHA256 webhooks, and automated scheduled backups.

---

## 1. Unified Architecture & The Master API Key Model

VanillaDatabase simplifies cloud database access into **1 Single Base URL** per database instance, where the **API Token (Master Key)** acts as the single source of truth for capabilities, permissions, and security policies.

- **Unified Base URL**: `https://<host>/v1/databases/<database_id>`
- **Master API Key (`Authorization: Bearer vdb_live_...`)**:
  - Automatically unlocks and authorizes Data Plane features based on assigned permissions:
    - `database:read` — Parameterized SQL `SELECT`, Table CRUD `select()`, Realtime SSE live events, Media file reading & HTTP 206 range streaming.
    - `database:write` — `INSERT`, `UPDATE`, `DELETE`, Atomic Batch Transactions, Media file upload & deletion.
    - `database:ddl` — Schema mutations (`CREATE TABLE`, `ALTER TABLE`, `DROP TABLE`, `CREATE INDEX`).
    - `database:admin` — Full unconstrained access across all features.
  - Table-level access control: Restrict tokens to specific tables (`allowed_tables`, `denied_tables`).
  - Native Rate Limiting: Enforce per-minute request caps per token to prevent abuse.

---

## 2. API Endpoints under the Unified Base URL

All Data Plane operations branch from the single database Base URL:

| Feature / Action | HTTP Method & Sub-path | Token Permission Required |
| :--- | :--- | :--- |
| **SQL Query Engine** | `POST /query` | `database:read` (SELECT) / `database:write` (DML) |
| **Atomic Transactions** | `POST /batch` | `database:write` |
| **Table CRUD (Rows)** | `GET /tables/:table/rows`<br>`POST /tables/:table/rows`<br>`PUT /tables/:table/rows`<br>`DELETE /tables/:table/rows` | `database:read`<br>`database:write`<br>`database:write`<br>`database:write` |
| **Realtime Event Stream** | `GET /realtime?table=<table_name>` | `database:read` (Accepts Bearer header, `?token=`, or session cookie) |
| **Media File Storage** | `GET /files`<br>`POST /files`<br>`DELETE /files/:fileId` | `database:read`<br>`database:write`<br>`database:write` |
| **Media Stream (Range 206)** | `GET /files/:fileId/view` | `database:read` (Supports `Range: bytes=start-end`) |

Control Plane Endpoints (Admin Session Auth):
| Feature / Action | HTTP Method & Sub-path | Description |
| :--- | :--- | :--- |
| **Multi-DB Import** | `POST /api/admin/databases/:id/import` | Auto-translates and ingests MySQL, Postgres, Mongo (JSON/NDJSON), CSV |
| **1-Click Create from Dump**| `POST /api/admin/databases/import-new` | Creates new database directly initialized from uploaded dump file |
| **Database Export** | `GET /api/admin/databases/:id/export?format=sqlite\|sql\|csv\|json` | Direct export to SQLite binary (.db), SQL Dump, CSV, JSON |
| **Download Backup** | `GET /api/admin/backups/:backupId/download` | Direct download of WAL-consistent SQLite snapshot (.sqlite) |
| **Explain Query Plan** | `POST /api/admin/databases/:id/explain` | Analyzes execution plan, indexes, and full table scans |
| **System & Security Logs** | `GET /api/admin/activity`<br>`GET /api/admin/audit` | Live API query metrics, execution duration, and admin audit trail |

---

## 3. Core Capabilities for AI / LLM Agents

### 3.1. Parameterized SQL Execution
- **Endpoint**: `POST /v1/databases/:databaseId/query`
- **Headers**:
  ```http
  Authorization: Bearer <API_TOKEN>
  Content-Type: application/json
  ```
- **Payload Schema**:
  ```json
  {
    "sql": "SELECT * FROM users WHERE status = ? LIMIT 10",
    "params": ["active"]
  }
  ```
- **Response Schema**:
  ```json
  {
    "success": true,
    "data": {
      "columns": ["id", "username", "status"],
      "rows": [
        {"id": 1, "username": "alice", "status": "active"}
      ],
      "rowCount": 1,
      "changes": 0,
      "lastInsertRowid": 0,
      "durationMs": 0.42
    }
  }
  ```

---

### 3.2. Atomic Batch Transactions (ACID)
- **Endpoint**: `POST /v1/databases/:databaseId/batch`
- **Payload Schema**:
  ```json
  {
    "transaction": true,
    "statements": [
      {
        "sql": "INSERT INTO orders (user_id, total) VALUES (?, ?)",
        "params": [1, 99.5]
      },
      {
        "sql": "UPDATE accounts SET balance = balance - ? WHERE id = ?",
        "params": [99.5, 1]
      }
    ]
  }
  ```
- **Response Schema**:
  ```json
  {
    "success": true,
    "data": {
      "results": [
        {"statementIndex": 0, "result": {"changes": 1, "lastInsertRowid": 10}},
        {"statementIndex": 1, "result": {"changes": 1, "lastInsertRowid": 0}}
      ],
      "totalDurationMs": 1.1
    }
  }
  ```

---

### 3.3. AI Vector Cosine Similarity Search (Embeddings / RAG)
VanillaDatabase includes native SQLite scalar functions for vector similarity:
- `vec_cosine_similarity(vec1_json, vec2_json)`: Returns cosine similarity score (0.0 to 1.0; 1.0 = identical direction).
- `vec_cosine_distance(vec1_json, vec2_json)`: Returns cosine distance (0.0 = identical).

Example RAG Query:
```sql
SELECT id, title, content,
       vec_cosine_similarity(embedding, '[0.012, 0.421, -0.198, 0.087]') as similarity
FROM documents
WHERE similarity >= 0.75
ORDER BY similarity DESC
LIMIT 5;
```

---

### 3.4. Multi-Database Converter & Ingestion
VanillaDatabase automatically transforms external formats into SQLite:
- **MySQL**: Translates backticks, converts `AUTO_INCREMENT` -> `AUTOINCREMENT`, strips `ENGINE=InnoDB` and comments, converts inline `KEY` -> `CREATE INDEX`.
- **PostgreSQL**: Converts `SERIAL` -> `INTEGER PRIMARY KEY AUTOINCREMENT`, strips `public.` prefixes, converts `COPY FROM stdin` blocks into `INSERT INTO` statements.
- **MongoDB / JSON / NDJSON**: Infers column types (`INTEGER`, `REAL`, `TEXT`) and creates structured relational tables with atomic batch inserts.

---

### 3.5. Full-Text Search (FTS5)
Create and query virtual FTS5 tables directly:
```sql
CREATE VIRTUAL TABLE articles_fts USING fts5(title, content, tokenize='unicode61');
INSERT INTO articles_fts (title, content) VALUES ('SQLite Guide', 'VanillaDatabase is super fast');
SELECT * FROM articles_fts WHERE articles_fts MATCH 'VanillaDatabase';
```

---

## 4. Official Client SDK Reference (v1.3.0)

### 4.1. Installation
```bash
# Node.js / TypeScript SDK
npm install @nullex/vanilladb

# Python SDK
pip install vanilladatabase
```

Environment Configuration:
```env
VANILLA_DB_URL=http://localhost:3000/v1/databases/db_your_database_id
VANILLA_DB_TOKEN=vdb_live_your_api_token_here
```

---

### 4.2. TypeScript / Node.js SDK (`@nullex/vanilladb`)

```typescript
import { VanillaDatabase } from '@nullex/vanilladb';
import fs from 'node:fs';

// 1. Initialize with Unified URL and Master Token
const db = new VanillaDatabase({
  url: process.env.VANILLA_DB_URL!,
  token: process.env.VANILLA_DB_TOKEN!
});

// 2. Fluent Table CRUD Builder (No SQL needed)
// Insert row
await db.from('users').insert({ username: 'alice', score: 100 });

// Select rows with pagination & sorting
const { rows } = await db.from('users').select({
  limit: 10,
  orderBy: 'score',
  order: 'DESC'
});
console.log('Top Users:', rows);

// Update row(s)
await db.from('users').update({ id: 1 }, { score: 200 });

// Delete row
await db.from('users').delete({ id: 1 });

// 3. AI Vector Cosine Similarity Search
const matches = await db.vectorSearch({
  table: 'document_embeddings',
  vectorColumn: 'embedding',
  vector: [0.012, 0.421, -0.198, 0.087],
  limit: 5,
  threshold: 0.7
});
console.log('RAG Matches:', matches);

// 4. Parameterized Raw SQL Query with TypeScript Generics
interface UserRecord {
  id: number;
  username: string;
  score: number;
}
const queryRes = await db.query<UserRecord>(
  'SELECT id, username, score FROM users WHERE score >= ? ORDER BY score DESC LIMIT ?',
  [50, 10]
);
console.log('Query result:', queryRes.rows);

// 5. Atomic Batch Transaction
await db.batch([
  { sql: 'UPDATE users SET score = score - ? WHERE id = ?', params: [25, 2] },
  { sql: 'UPDATE users SET score = score + ? WHERE id = ?', params: [25, 3] },
  { sql: 'INSERT INTO transfers (from_id, to_id, amount) VALUES (?, ?, ?)', params: [2, 3, 25] }
], true);

// 6. Realtime SSE Live Events Subscription
const unsubscribe = db.subscribe((event) => {
  console.log(`[Realtime Event] Type: ${event.type} | Table: ${event.table}`, event.data);
}, 'users');

// 7. Media & File Storage (Upload, Stream Range 206, Delete)
const imageBuffer = fs.readFileSync('./avatar.png');
const file = await db.uploadFile(imageBuffer, 'avatar.png', 'image/png');
console.log('Stream URL:', db.getFileUrl(file.id));

// Delete file
await db.deleteFile(file.id);
```

---

### 4.3. Python SDK (`vanilladatabase`)

```python
import os
from vanilladb import VanillaDatabase

# 1. Initialize with Unified URL and Master Token
db = VanillaDatabase(
    url=os.getenv("VANILLA_DB_URL", "http://localhost:3000/v1/databases/db_123"),
    token=os.getenv("VANILLA_DB_TOKEN", "vdb_live_your_api_token_here")
)

# 2. Table CRUD Builder (No SQL needed)
# Insert row
db.table("users").insert({"username": "elaina", "score": 250})

# Select rows
users = db.table("users").select(limit=10, order_by="score", order="DESC")
print("Top Users:", users["rows"])

# Update row(s)
db.table("users").update(where={"id": 1}, values={"score": 300})

# Delete row
db.table("users").delete({"id": 1})

# 3. AI Vector Cosine Similarity Search
matches = db.vector_search(
    table="document_embeddings",
    vector_column="embedding",
    vector=[0.012, 0.421, -0.198, 0.087],
    limit=5,
    threshold=0.75
)
print("Vector matches:", matches)

# 4. Parameterized Raw SQL Query
res = db.query("SELECT * FROM users WHERE score >= ?", [100])
print("Users:", res["rows"])

# 5. Atomic Batch Transaction
db.batch([
    {"sql": "UPDATE users SET score = score - ? WHERE username = ?", "params": [50, "elaina"]},
    {"sql": "INSERT INTO logs (event) VALUES (?)", "params": ["score_deducted"]}
], transaction=True)

# 6. Media Storage (Upload, Stream Range 206, Delete)
uploaded = db.upload_file("avatar.png", filename="elaina_avatar.png", content_type="image/png")
print("Stream URL:", db.get_file_url(uploaded["id"]))
db.delete_file(uploaded["id"])

# 7. Realtime SSE Event Stream
# def on_event(event):
#     print("Live Event:", event)
# db.subscribe(on_event, table="users")
```

---

## 5. AI Agent System Prompt Template

Inject this snippet when giving an LLM agent access to a VanillaDatabase instance:

```markdown
You are connected to a VanillaDatabase SQLite Cloud instance.
Unified Database URL: ${VANILLA_DB_URL}
API Token: ${VANILLA_DB_TOKEN}

Usage Rules:
1. Connect via official SDKs (@nullex/vanilladb in Node.js, vanilladatabase in Python) using 1 Base URL and Bearer Token.
2. The API Token is the master key governing all permissions (queries, transactions, realtime, storage).
3. Use `db.from(table)` / `db.table(table)` for simple CRUD operations, and parameterized `db.query(sql, params)` for complex queries.
4. For multi-statement mutations, use `db.batch([...], transaction=True)` to guarantee ACID atomicity.
5. For semantic vector search, use `db.vectorSearch({...})` or native `vec_cosine_similarity` in SQL.
6. Upload media files via `db.uploadFile()` and stream them via `db.getFileUrl(fileId)` with HTTP 206 partial content support.
```

---

## 6. Client Integration Best Practices & Troubleshooting

Critical production guidelines to avoid common pitfalls (timeouts, deadlocks, connection drops, and API rejections):

### 6.1. Network Timeouts & Background Workers
- **Default Timeout**: Set client HTTP timeout to at least `30_000ms` (30s) or `45_000ms` (45s).
- **Background Tasks (e.g. sweeps, schedulers, cron jobs)**: Background sweeps across growing tables need custom timeout allowances (`60_000ms`).
- **Transient Error Retry**: Implement automatic retries with exponential backoff (e.g. 3 attempts, 1s/2s/4s delay) for network errors (`ETIMEDOUT`, `ECONNRESET`, `UND_ERR_CONNECT_TIMEOUT`, `request-timeout`). Never retry client-side `4xx` errors (400, 401, 403, 404).

### 6.2. SQLite Concurrency & Query Optimization
- **Index Composite Columns**: Tables queried periodically by status and timestamp (e.g. `WHERE status = 'pending' AND expires_at <= ?`) **must** have composite indexes:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_entitlements_status_expiry ON entitlements(status, expires_at);
  ```
  *Lack of indexes triggers full-table scans that block SQLite's synchronous single-thread execution.*
- **Batch Processing with `LIMIT`**: Avoid unbounded batch queries or sweeping operations (`DELETE ... WHERE expires_at < now`). Slice operations into bounded chunks:
  ```sql
  DELETE FROM queue_jobs WHERE id IN (SELECT id FROM queue_jobs WHERE status = 'expired' LIMIT 500);
  ```
- **Transaction Scope**: Keep transactions small and fast to prevent `SQLITE_BUSY` contention on WAL checkpoints.

### 6.3. HTTP vs. HTTPS & Reverse Proxy Settings
- **Protocol Matching**: Do not force HTTPS for local development or internal networks (`http://localhost:3000` or `http://127.0.0.1:3000`). Attempting TLS handshakes against plain HTTP ports causes 15–30s connection hangs.
- **Nginx Reverse Proxy Configuration**:
  ```nginx
  upstream vanilladb_backend {
      server 127.0.0.1:3000;
      keepalive 32;
  }
  server {
      location / {
          proxy_pass http://vanilladb_backend;
          proxy_http_version 1.1;
          proxy_set_header Connection "";
          proxy_connect_timeout 60s;
          proxy_read_timeout 60s;
          proxy_send_timeout 60s;
      }
  }
  ```

### 6.4. Realtime SSE & Webhook Dispatching
- **Discord & Slack Webhooks**: Webhook payloads are automatically formatted as rich embeds. When sending custom payloads, ensure valid payload schemas to prevent Discord `400 Bad Request` rejections.
- **SSE Heartbeat Handling**: The Realtime SSE endpoint emits ping heartbeats (`event: ping`) every 20s. Clients should ignore ping events and automatically reconnect with backoff on stream termination.

