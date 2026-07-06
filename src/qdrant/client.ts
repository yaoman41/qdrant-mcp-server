import { createHash } from "node:crypto";
import { QdrantClient } from "@qdrant/js-client-rest";
import logger from "../logger.js";

/**
 * Connection-level errors that are safe to retry: the request never reached Qdrant,
 * so retrying is safe even for writes. Covers the intermittent macOS dual-NIC
 * EHOSTUNREACH (two interfaces on the same subnet → transient ARP-reject route) and
 * undici connect timeouts (UND_ERR_*).
 */
const TRANSIENT_NET_CODES = new Set([
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
]);

function errCode(error: any): string | undefined {
  const c = error?.code ?? error?.cause?.code ?? error?.errno;
  return c == null ? undefined : String(c);
}

/** True for intermittent connection-level failures that are safe to retry. */
function isTransientNetworkError(error: any): boolean {
  const codes = [error?.code, error?.cause?.code, error?.errno]
    .filter((c) => c != null)
    .map(String);
  return codes.some((c) => TRANSIENT_NET_CODES.has(c) || c.startsWith("UND_ERR_"));
}

function httpStatus(error: any): number | undefined {
  const s = error?.status ?? error?.response?.status ?? error?.statusCode;
  return typeof s === "number" ? s : undefined;
}

/**
 * True ONLY for a genuine "collection not found" (HTTP 404 / not-found message).
 * A network/auth/server error must NOT be classified as not-found — otherwise a broken
 * connection gets mislabelled as a deleted collection.
 */
function isNotFoundError(error: any): boolean {
  if (httpStatus(error) === 404) return true;
  const msg = String(error?.message ?? error ?? "").toLowerCase();
  return (
    msg.includes("not found") || msg.includes("doesn't exist") || msg.includes("does not exist")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface CollectionInfo {
  name: string;
  vectorSize: number;
  pointsCount: number;
  distance: "Cosine" | "Euclid" | "Dot";
  hybridEnabled?: boolean;
}

export interface SearchResult {
  id: string | number;
  score: number;
  payload?: Record<string, any>;
}

export interface SparseVector {
  indices: number[];
  values: number[];
}

export class QdrantManager {
  private log = logger.child({ component: "qdrant" });
  private client: QdrantClient;
  private readonly retryBaseMs: number;
  private readonly maxRetries: number;

  constructor(
    url: string = "http://localhost:6333",
    apiKey?: string,
    opts: { retryBaseMs?: number; maxRetries?: number } = {}
  ) {
    this.client = new QdrantClient({ url, apiKey });
    this.retryBaseMs = opts.retryBaseMs ?? 300;
    this.maxRetries = opts.maxRetries ?? 3;
  }

  /**
   * Runs a Qdrant client call, retrying only transient connection errors with
   * exponential backoff + jitter. Non-transient errors (404, auth, server errors) throw
   * immediately. Guards against the intermittent macOS dual-NIC EHOSTUNREACH where the
   * LAN path is momentarily unavailable while ARP re-resolves.
   */
  private async withRetry<T>(op: string, fn: () => Promise<T>): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        return await fn();
      } catch (error) {
        if (attempt >= this.maxRetries || !isTransientNetworkError(error)) {
          throw error;
        }
        attempt++;
        const backoff = this.retryBaseMs * 3 ** (attempt - 1);
        const delay = Math.round(backoff * (0.8 + Math.random() * 0.4)); // ±20% jitter
        this.log.warn(
          { op, attempt, maxRetries: this.maxRetries, delayMs: delay, code: errCode(error) },
          "transient Qdrant network error — retrying (LAN path may be flapping)"
        );
        await sleep(delay);
      }
    }
  }

  /**
   * Converts a string ID to UUID format if it's not already a UUID.
   * Qdrant requires string IDs to be in UUID format.
   */
  private normalizeId(id: string | number): string | number {
    if (typeof id === "number") {
      return id;
    }

    // Check if already a valid UUID (8-4-4-4-12 format)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(id)) {
      return id;
    }

    // Convert arbitrary string to deterministic UUID v5-like format
    const hash = createHash("sha256").update(id).digest("hex");
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
  }

  async createCollection(
    name: string,
    vectorSize: number,
    distance: "Cosine" | "Euclid" | "Dot" = "Cosine",
    enableSparse: boolean = false
  ): Promise<void> {
    this.log.debug({ collection: name, vectorSize, distance, enableSparse }, "createCollection");
    const config: any = {};

    // When hybrid search is enabled, use named vectors
    if (enableSparse) {
      config.vectors = {
        dense: {
          size: vectorSize,
          distance,
        },
      };
      config.sparse_vectors = {
        text: {
          modifier: "idf",
        },
      };
    } else {
      // Standard unnamed vector configuration
      config.vectors = {
        size: vectorSize,
        distance,
      };
    }

    await this.withRetry("createCollection", () => this.client.createCollection(name, config));
  }

  async collectionExists(name: string): Promise<boolean> {
    try {
      await this.withRetry("getCollection", () => this.client.getCollection(name));
      return true;
    } catch (error: any) {
      if (isNotFoundError(error)) {
        return false;
      }
      // NOT a missing collection — surface the real cause (network / auth / server error)
      // instead of the misleading "collection does not exist".
      const detail = errCode(error) ?? httpStatus(error) ?? error?.message ?? String(error);
      throw new Error(
        `Qdrant existence check for collection "${name}" failed: ${detail}. ` +
          "This is a connectivity/service error, NOT a missing collection."
      );
    }
  }

  async listCollections(): Promise<string[]> {
    const response = await this.withRetry("getCollections", () => this.client.getCollections());
    return response.collections.map((c) => c.name);
  }

  async getCollectionInfo(name: string): Promise<CollectionInfo> {
    const info = await this.withRetry("getCollection", () => this.client.getCollection(name));
    const vectorConfig = info.config.params.vectors;

    // Handle both named and unnamed vector configurations
    let size = 0;
    let distance: "Cosine" | "Euclid" | "Dot" = "Cosine";
    let hybridEnabled = false;

    // Check if sparse vectors are configured
    if (info.config.params.sparse_vectors) {
      hybridEnabled = true;
    }

    if (typeof vectorConfig === "object" && vectorConfig !== null) {
      // Check for unnamed vector config (has 'size' directly)
      if ("size" in vectorConfig) {
        size = typeof vectorConfig.size === "number" ? vectorConfig.size : 0;
        distance = vectorConfig.distance as "Cosine" | "Euclid" | "Dot";
      } else if ("dense" in vectorConfig) {
        // Named vector config for hybrid search
        const denseConfig = vectorConfig.dense as any;
        size = typeof denseConfig.size === "number" ? denseConfig.size : 0;
        distance = denseConfig.distance as "Cosine" | "Euclid" | "Dot";
      }
    }

    return {
      name,
      vectorSize: size,
      pointsCount: info.points_count || 0,
      distance,
      hybridEnabled,
    };
  }

  async deleteCollection(name: string): Promise<void> {
    this.log.debug({ collection: name }, "deleteCollection");
    await this.withRetry("deleteCollection", () => this.client.deleteCollection(name));
  }

  async addPoints(
    collectionName: string,
    points: Array<{
      id: string | number;
      vector: number[];
      payload?: Record<string, any>;
    }>
  ): Promise<void> {
    this.log.debug({ collection: collectionName, count: points.length }, "addPoints");
    try {
      // Normalize all IDs to ensure string IDs are in UUID format
      const normalizedPoints = points.map((point) => ({
        ...point,
        id: this.normalizeId(point.id),
      }));

      await this.withRetry("upsert", () =>
        this.client.upsert(collectionName, {
          wait: true,
          points: normalizedPoints,
        })
      );
    } catch (error: any) {
      const errorMessage = error?.data?.status?.error || error?.message || String(error);
      throw new Error(`Failed to add points to collection "${collectionName}": ${errorMessage}`);
    }
  }

  async search(
    collectionName: string,
    vector: number[],
    limit: number = 5,
    filter?: Record<string, any>
  ): Promise<SearchResult[]> {
    this.log.debug({ collection: collectionName, limit }, "search");
    // Convert simple key-value filter to Qdrant filter format
    // Accepts either:
    // 1. Simple format: {"category": "database"}
    // 2. Qdrant format: {must: [{key: "category", match: {value: "database"}}]}
    let qdrantFilter: Record<string, any> | undefined;
    if (filter && Object.keys(filter).length > 0) {
      // Check if already in Qdrant format (has must/should/must_not keys)
      if (filter.must || filter.should || filter.must_not) {
        qdrantFilter = filter;
      } else {
        // Convert simple key-value format to Qdrant format
        qdrantFilter = {
          must: Object.entries(filter).map(([key, value]) => ({
            key,
            match: { value },
          })),
        };
      }
    }

    // Check if collection uses named vectors (hybrid mode)
    const collectionInfo = await this.getCollectionInfo(collectionName);

    const results = await this.withRetry("search", () =>
      this.client.search(collectionName, {
        vector: collectionInfo.hybridEnabled ? { name: "dense", vector } : vector,
        limit,
        filter: qdrantFilter,
      })
    );

    return results.map((result) => ({
      id: result.id,
      score: result.score,
      payload: result.payload || undefined,
    }));
  }

  async getPoint(
    collectionName: string,
    id: string | number
  ): Promise<{ id: string | number; payload?: Record<string, any> } | null> {
    try {
      const normalizedId = this.normalizeId(id);
      const points = await this.withRetry("retrieve", () =>
        this.client.retrieve(collectionName, {
          ids: [normalizedId],
        })
      );

      if (points.length === 0) {
        return null;
      }

      return {
        id: points[0].id,
        payload: points[0].payload || undefined,
      };
    } catch (error: any) {
      // Genuine "not found" → null; a network/service error must surface, not be masked.
      if (isNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  async deletePoints(collectionName: string, ids: (string | number)[]): Promise<void> {
    this.log.debug({ collection: collectionName, count: ids.length }, "deletePoints");
    // Normalize IDs to ensure string IDs are in UUID format
    const normalizedIds = ids.map((id) => this.normalizeId(id));

    await this.withRetry("delete", () =>
      this.client.delete(collectionName, {
        wait: true,
        points: normalizedIds,
      })
    );
  }

  /**
   * Deletes points matching a filter condition.
   * Useful for deleting all chunks associated with a specific file path.
   */
  async deletePointsByFilter(collectionName: string, filter: Record<string, any>): Promise<void> {
    this.log.debug({ collection: collectionName }, "deletePointsByFilter");
    await this.withRetry("delete", () =>
      this.client.delete(collectionName, {
        wait: true,
        filter: filter,
      })
    );
  }

  /**
   * Performs hybrid search combining semantic vector search with sparse vector (keyword) search
   * using Reciprocal Rank Fusion (RRF) to combine results
   */
  async hybridSearch(
    collectionName: string,
    denseVector: number[],
    sparseVector: SparseVector,
    limit: number = 5,
    filter?: Record<string, any>,
    _semanticWeight: number = 0.7
  ): Promise<SearchResult[]> {
    this.log.debug({ collection: collectionName, limit }, "hybridSearch");
    // Convert simple key-value filter to Qdrant filter format
    let qdrantFilter: Record<string, any> | undefined;
    if (filter && Object.keys(filter).length > 0) {
      if (filter.must || filter.should || filter.must_not) {
        qdrantFilter = filter;
      } else {
        qdrantFilter = {
          must: Object.entries(filter).map(([key, value]) => ({
            key,
            match: { value },
          })),
        };
      }
    }

    // Calculate prefetch limits based on weights
    // We fetch more results than needed to ensure good fusion results
    const prefetchLimit = Math.max(20, limit * 4);

    try {
      const results = await this.withRetry("query", () =>
        this.client.query(collectionName, {
        prefetch: [
          {
            query: denseVector,
            using: "dense",
            limit: prefetchLimit,
            filter: qdrantFilter,
          },
          {
            query: sparseVector,
            using: "text",
            limit: prefetchLimit,
            filter: qdrantFilter,
          },
        ],
        query: {
          fusion: "rrf",
        },
        limit: limit,
        with_payload: true,
        })
      );

      return results.points.map((result: any) => ({
        id: result.id,
        score: result.score,
        payload: result.payload || undefined,
      }));
    } catch (error: any) {
      const errorMessage = error?.data?.status?.error || error?.message || String(error);
      throw new Error(`Hybrid search failed on collection "${collectionName}": ${errorMessage}`);
    }
  }

  /**
   * Adds points with both dense and sparse vectors for hybrid search
   */
  async addPointsWithSparse(
    collectionName: string,
    points: Array<{
      id: string | number;
      vector: number[];
      sparseVector: SparseVector;
      payload?: Record<string, any>;
    }>
  ): Promise<void> {
    this.log.debug({ collection: collectionName, count: points.length }, "addPointsWithSparse");
    try {
      // Normalize all IDs to ensure string IDs are in UUID format
      const normalizedPoints = points.map((point) => ({
        id: this.normalizeId(point.id),
        vector: {
          dense: point.vector,
          text: point.sparseVector,
        },
        payload: point.payload,
      }));

      await this.withRetry("upsert", () =>
        this.client.upsert(collectionName, {
          wait: true,
          points: normalizedPoints,
        })
      );
    } catch (error: any) {
      const errorMessage = error?.data?.status?.error || error?.message || String(error);
      throw new Error(
        `Failed to add points with sparse vectors to collection "${collectionName}": ${errorMessage}`
      );
    }
  }
}
