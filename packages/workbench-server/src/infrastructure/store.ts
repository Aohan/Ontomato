import pg from "pg";
import type { BaseStore, Item, Operation, OperationResults } from "@langchain/langgraph";
import { getPostgresPool, qualifiedTable } from "./postgres";

interface SearchItem extends Item {
  score?: number;
}

export class PostgresStore implements BaseStore {
  private pool: pg.Pool;

  constructor() {
    this.pool = getPostgresPool();
  }

  async start(): Promise<void> {}

  async stop(): Promise<void> {}

  private namespaceToString(namespace: string[]): string {
    return namespace.join("/");
  }

  private stringToNamespace(str: string): string[] {
    return str ? str.split("/") : [];
  }

  async get(namespace: string[], key: string): Promise<Item | null> {
    const ns = this.namespaceToString(namespace);
    const result = await this.pool.query(
      `SELECT * FROM ${qualifiedTable("kv_store")} WHERE namespace = $1 AND key = $2`,
      [ns, key]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      namespace,
      key: row.key,
      value: row.value,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async search(
    namespacePrefix: string[],
    options?: {
      filter?: Record<string, unknown>;
      limit?: number;
      offset?: number;
      query?: string;
    }
  ): Promise<SearchItem[]> {
    const nsPrefix = this.namespaceToString(namespacePrefix);
    const limit = options?.limit ?? 10;
    const offset = options?.offset ?? 0;

    const result = await this.pool.query(
      `SELECT * FROM ${qualifiedTable("kv_store")}
       WHERE namespace = $1 OR starts_with(namespace, $1 || '/')
       ORDER BY updated_at DESC
       LIMIT $2 OFFSET $3`,
      [nsPrefix, limit, offset]
    );

    return result.rows.map((row) => ({
      namespace: this.stringToNamespace(row.namespace),
      key: row.key,
      value: row.value,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async put(
    namespace: string[],
    key: string,
    value: Record<string, unknown>,
    _index?: false | string[]
  ): Promise<void> {
    const ns = this.namespaceToString(namespace);
    const now = new Date();
    await this.pool.query(
      `INSERT INTO ${qualifiedTable("kv_store")} (namespace, key, value, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (namespace, key)
       DO UPDATE SET value = $3, updated_at = $5`,
      [ns, key, JSON.stringify(value), now, now]
    );
  }

  async delete(namespace: string[], key: string): Promise<void> {
    const ns = this.namespaceToString(namespace);
    await this.pool.query(
      `DELETE FROM ${qualifiedTable("kv_store")} WHERE namespace = $1 AND key = $2`,
      [ns, key]
    );
  }

  async deleteByNamespace(namespace: string[]): Promise<void> {
    const ns = this.namespaceToString(namespace);
    await this.pool.query(
      `DELETE FROM ${qualifiedTable("kv_store")} WHERE namespace = $1 OR starts_with(namespace, $1 || '/')`,
      [ns]
    );
  }

  async listNamespaces(options?: {
    prefix?: string[];
    suffix?: string[];
    maxDepth?: number;
    limit?: number;
    offset?: number;
  }): Promise<string[][]> {
    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;

    const result = await this.pool.query(
      `SELECT DISTINCT namespace FROM ${qualifiedTable("kv_store")}
       ORDER BY namespace
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return result.rows.map((row) => this.stringToNamespace(row.namespace));
  }

  async batch<Op extends Operation[]>(operations: Op): Promise<OperationResults<Op>> {
    const results: unknown[] = [];
    for (const op of operations) {
      if ("key" in op && "namespace" in op) {
        if ("value" in op) {
          await this.put(op.namespace, op.key, op.value as Record<string, unknown>);
          results.push(undefined);
        } else {
          const item = await this.get(op.namespace, op.key);
          results.push(item);
        }
      } else if ("namespacePrefix" in op) {
        const items = await this.search(op.namespacePrefix, {
          filter: op.filter,
          limit: op.limit,
          offset: op.offset,
          query: op.query,
        });
        results.push(items);
      }
    }
    return results as OperationResults<Op>;
  }
}
