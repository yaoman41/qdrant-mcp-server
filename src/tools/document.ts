/**
 * Document operation tools registration
 */

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EmbeddingProvider } from "../embeddings/base.js";
import { BM25SparseVectorGenerator } from "../embeddings/sparse.js";
import logger from "../logger.js";
import type { QdrantManager } from "../qdrant/client.js";
import { withToolLogging } from "./logging.js";
import * as schemas from "./schemas.js";

const log = logger.child({ component: "tools" });

/** Max UTF-8 file size for file_path documents (5MB). */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** Chunk size (chars) when file/text exceeds this. */
export const CHUNK_SIZE = 1500;
/** Overlap between consecutive chunks (chars). */
export const CHUNK_OVERLAP = 200;

export interface DocumentToolDependencies {
  qdrant: QdrantManager;
  embeddings: EmbeddingProvider;
}

export interface ResolvedDoc {
  id: string | number;
  text: string;
  metadata?: Record<string, any>;
}

/** Deterministic UUID from content (and optional salt e.g. chunk index). */
export function contentHashId(content: string, salt = ""): string {
  const hash = createHash("sha256").update(salt + "\0" + content).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

/** Split text into overlapping chunks; single element if under size. */
export function chunkText(
  text: string,
  size: number = CHUNK_SIZE,
  overlap: number = CHUNK_OVERLAP
): string[] {
  if (text.length <= size) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    chunks.push(text.slice(start, end));
    if (end >= text.length) break;
    start = Math.max(0, end - overlap);
    // Guard against zero-progress if size <= overlap
    if (start >= end) start = end;
  }
  return chunks;
}

type RawDoc = {
  id?: string | number;
  text?: string;
  file_path?: string;
  metadata?: Record<string, any>;
};

/**
 * Expand raw documents: file_path → read UTF-8 (+ chunk), optional id → hash.
 * file_path wins over text when both set.
 */
export function resolveDocuments(rawDocs: RawDoc[]): ResolvedDoc[] {
  const out: ResolvedDoc[] = [];

  for (const doc of rawDocs) {
    let sourceText: string;
    let sourcePath: string | undefined;

    if (doc.file_path) {
      const fp = doc.file_path;
      if (!fp.startsWith("/")) {
        throw new Error(
          `file_path must be absolute, got ${JSON.stringify(fp)}. Example: /Users/yao/.../doc.md`
        );
      }
      let size: number;
      try {
        size = statSync(fp).size;
      } catch {
        throw new Error(`file_path not found: ${fp}`);
      }
      if (size > MAX_FILE_BYTES) {
        throw new Error(
          `file_path too large: ${size} bytes (max ${MAX_FILE_BYTES}). Split the file or raise the limit.`
        );
      }
      sourceText = readFileSync(fp, "utf-8");
      // strip BOM
      if (sourceText.charCodeAt(0) === 0xfeff) {
        sourceText = sourceText.slice(1);
      }
      sourcePath = fp;
    } else if (doc.text !== undefined && doc.text !== null) {
      sourceText = doc.text;
    } else {
      throw new Error("Each document needs text or file_path");
    }

    const parts = chunkText(sourceText);
    for (let i = 0; i < parts.length; i++) {
      const chunk = parts[i];
      const meta: Record<string, any> = { ...(doc.metadata || {}) };
      if (sourcePath) {
        meta.source_path = sourcePath;
        meta.chunk_index = i;
        meta.chunk_total = parts.length;
      } else if (parts.length > 1) {
        meta.chunk_index = i;
        meta.chunk_total = parts.length;
      }

      let id: string | number;
      if (doc.id !== undefined && doc.id !== null && parts.length === 1) {
        id = doc.id;
      } else if (doc.id !== undefined && doc.id !== null && parts.length > 1) {
        // Keep base id unique per chunk
        id = contentHashId(String(doc.id), `chunk:${i}:${chunk}`);
      } else {
        id = contentHashId(chunk, sourcePath ? `${sourcePath}:${i}` : `chunk:${i}`);
      }

      out.push({ id, text: chunk, metadata: Object.keys(meta).length ? meta : undefined });
    }
  }

  return out;
}

export function registerDocumentTools(server: McpServer, deps: DocumentToolDependencies): void {
  const { qdrant, embeddings } = deps;

  // add_documents
  server.registerTool(
    "add_documents",
    {
      title: "Add Documents",
      description:
        "Add documents to a collection. Auto-embeds with the configured provider. " +
        "Prefer file_path (absolute UTF-8 path) for long content — server reads+chunks, no model-side copy. " +
        "text and file_path are alternatives (file_path wins). id optional (SHA-256 deterministic UUID if omitted). " +
        "Files >1500 chars auto-chunk with 200-char overlap; metadata gets source_path + chunk_index.",
      inputSchema: schemas.AddDocumentsSchema,
    },
    withToolLogging("add_documents", async ({ collection, documents }) => {
      log.info({ tool: "add_documents", collection, count: documents.length }, "Tool called");
      // Check if collection exists and get info
      const exists = await qdrant.collectionExists(collection);
      if (!exists) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Collection "${collection}" does not exist. Create it first using create_collection.`,
            },
          ],
          isError: true,
        };
      }

      let resolved: ResolvedDoc[];
      try {
        resolved = resolveDocuments(documents as RawDoc[]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${msg}` }],
          isError: true,
        };
      }

      const collectionInfo = await qdrant.getCollectionInfo(collection);

      // Generate embeddings for all resolved chunks
      const texts = resolved.map((doc) => doc.text);
      const embeddingResults = await embeddings.embedBatch(texts);

      // If hybrid search is enabled, generate sparse vectors and use appropriate method
      if (collectionInfo.hybridEnabled) {
        const sparseGenerator = new BM25SparseVectorGenerator();

        const points = resolved.map((doc, index) => ({
          id: doc.id,
          vector: embeddingResults[index].embedding,
          sparseVector: sparseGenerator.generate(doc.text),
          payload: {
            text: doc.text,
            ...doc.metadata,
          },
        }));

        await qdrant.addPointsWithSparse(collection, points);
      } else {
        const points = resolved.map((doc, index) => ({
          id: doc.id,
          vector: embeddingResults[index].embedding,
          payload: {
            text: doc.text,
            ...doc.metadata,
          },
        }));

        await qdrant.addPoints(collection, points);
      }

      return {
        content: [
          {
            type: "text",
            text: `Successfully added ${resolved.length} document(s) to collection "${collection}" (from ${documents.length} input item(s)).`,
          },
        ],
      };
    })
  );

  // delete_documents
  server.registerTool(
    "delete_documents",
    {
      title: "Delete Documents",
      description: "Delete specific documents from a collection by their IDs.",
      inputSchema: schemas.DeleteDocumentsSchema,
    },
    withToolLogging("delete_documents", async ({ collection, ids }) => {
      log.info({ tool: "delete_documents", collection, count: ids.length }, "Tool called");
      await qdrant.deletePoints(collection, ids);
      return {
        content: [
          {
            type: "text",
            text: `Successfully deleted ${ids.length} document(s) from collection "${collection}".`,
          },
        ],
      };
    })
  );
}
