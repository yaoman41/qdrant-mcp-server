/**
 * Collection management tools registration
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EmbeddingProvider } from "../embeddings/base.js";
import logger from "../logger.js";
import type { QdrantManager } from "../qdrant/client.js";
import { safeJsonStringify } from "../util/safe-json.js";
import { withToolLogging } from "./logging.js";
import * as schemas from "./schemas.js";

const log = logger.child({ component: "tools" });

export interface CollectionToolDependencies {
  qdrant: QdrantManager;
  embeddings: EmbeddingProvider;
}

export function registerCollectionTools(server: McpServer, deps: CollectionToolDependencies): void {
  const { qdrant, embeddings } = deps;

  // create_collection
  server.registerTool(
    "create_collection",
    {
      title: "Create Collection",
      description:
        "Create a new vector collection in Qdrant. The collection will be configured with the embedding provider's dimensions automatically. Set enableHybrid to true to enable hybrid search combining semantic and keyword search.\n\n⚠️ MORDECO RULE: Do NOT use this for collection name 'mordeco_kb' — it is auto-managed by R1601 RAG sync ecosystem (Mac→git push→ai-server cron→n8n */15 incremental). Recreating breaks incremental state. If schema migration needed, SSH ai-server and run: python3 _tools/audit/qdrant-kb-sync-v2.py --source-dir ... --force-recreate. To query existing data, use mcp__qdrant__semantic_search or hybrid_search.",
      inputSchema: schemas.CreateCollectionSchema,
    },
    withToolLogging("create_collection", async ({ name, distance, enableHybrid }) => {
      log.info({ tool: "create_collection", collection: name }, "Tool called");
      const vectorSize = embeddings.getDimensions();
      await qdrant.createCollection(name, vectorSize, distance, enableHybrid || false);

      let message = `Collection "${name}" created successfully with ${vectorSize} dimensions and ${distance || "Cosine"} distance metric.`;
      if (enableHybrid) {
        message += " Hybrid search is enabled for this collection.";
      }

      return {
        content: [{ type: "text", text: message }],
      };
    })
  );

  // list_collections
  server.registerTool(
    "list_collections",
    {
      title: "List Collections",
      description: "List all available collections in Qdrant.",
      inputSchema: {},
    },
    withToolLogging("list_collections", async () => {
      log.info({ tool: "list_collections" }, "Tool called");
      const collections = await qdrant.listCollections();
      return {
        content: [{ type: "text", text: safeJsonStringify(collections) }],
      };
    })
  );

  // get_collection_info
  server.registerTool(
    "get_collection_info",
    {
      title: "Get Collection Info",
      description:
        "Get detailed information about a collection including vector size, point count, and distance metric.",
      inputSchema: schemas.GetCollectionInfoSchema,
    },
    withToolLogging("get_collection_info", async ({ name }) => {
      log.info({ tool: "get_collection_info", collection: name }, "Tool called");
      const info = await qdrant.getCollectionInfo(name);
      return {
        content: [{ type: "text", text: safeJsonStringify(info) }],
      };
    })
  );

  // delete_collection
  server.registerTool(
    "delete_collection",
    {
      title: "Delete Collection",
      description: "Delete a collection and all its documents.\n\n⚠️ MORDECO RULE: Do NOT delete collection 'mordeco_kb' — it is protected (R1601 RAG auto-sync ecosystem will break: state file orphaned + n8n cron */15 fails). Other collections (knowledge_base for Azmile / mordeco_zhtw_spike for one-off test) safe to delete.",
      inputSchema: schemas.DeleteCollectionSchema,
    },
    withToolLogging("delete_collection", async ({ name }) => {
      log.info({ tool: "delete_collection", collection: name }, "Tool called");
      await qdrant.deleteCollection(name);
      return {
        content: [{ type: "text", text: `Collection "${name}" deleted successfully.` }],
      };
    })
  );
}
