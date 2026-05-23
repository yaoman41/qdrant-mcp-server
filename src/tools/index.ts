/**
 * Tool registration orchestrator
 *
 * Mordeco fork: tree-sitter dependency removed (Node 24 build incompatibility).
 * Code-indexing tools (index_codebase / search_code / reindex_changes /
 * get_index_status / clear_index) and git-history tools (index_git_history /
 * search_git_history / index_new_commits / get_git_index_status /
 * clear_git_index) are no longer registered. Federated tools (contextual_search
 * / federated_search) are likewise dropped since they depend on those indexers.
 *
 * Kept tools (pure vector + text, no AST):
 *   - create_collection / list_collections / get_collection_info / delete_collection
 *   - add_documents / delete_documents
 *   - semantic_search / hybrid_search
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EmbeddingProvider } from "../embeddings/base.js";
import type { QdrantManager } from "../qdrant/client.js";
import { registerCollectionTools } from "./collection.js";
import { registerDocumentTools } from "./document.js";
import { registerSearchTools } from "./search.js";

export interface ToolDependencies {
  qdrant: QdrantManager;
  embeddings: EmbeddingProvider;
}

/**
 * Register all MCP tools on the server
 */
export function registerAllTools(server: McpServer, deps: ToolDependencies): void {
  registerCollectionTools(server, {
    qdrant: deps.qdrant,
    embeddings: deps.embeddings,
  });

  registerDocumentTools(server, {
    qdrant: deps.qdrant,
    embeddings: deps.embeddings,
  });

  registerSearchTools(server, {
    qdrant: deps.qdrant,
    embeddings: deps.embeddings,
  });
}

// Re-export schemas for external use
export * from "./schemas.js";
