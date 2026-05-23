# Qdrant MCP Server

[![CI](https://github.com/mhalder/qdrant-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/mhalder/qdrant-mcp-server/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/mhalder/qdrant-mcp-server/branch/main/graph/badge.svg)](https://codecov.io/gh/mhalder/qdrant-mcp-server)

A Model Context Protocol (MCP) server providing semantic search capabilities using Qdrant vector database with multiple embedding providers.

## Mordeco Fork Notes

This is a Mordeco-internal fork of [mhalder/qdrant-mcp-server](https://github.com/mhalder/qdrant-mcp-server).

**What's dropped vs upstream**:
- All `tree-sitter` based code-search tools (`index_codebase`, `search_code`, `reindex_changes`, `get_index_status`, `clear_index`)
- All git-history indexing tools (`index_git_history`, `search_git_history`, `index_new_commits`, `get_git_index_status`, `clear_git_index`)
- `federated_search` / `contextual_search`
- Entire `src/code/` and `src/git/` directories (dead source removed)

**What's kept**: 8 core tools — `create_collection` / `list_collections` / `get_collection_info` / `delete_collection` / `add_documents` / `delete_documents` / `semantic_search` / `hybrid_search`

**Why**: Mordeco only needs pure vector + text search for `_knowledge/` SOPs. Code-search & git-history out of scope. The tree-sitter native module also had Node 24 compatibility issues that prompted this fork.

**Installation**: No `CXXFLAGS` flag needed — tree-sitter dependency dropped. Plain `npm install` works on Node 22 and 24.

**Maintenance**: Minimal — pull upstream changes only for security patches in kept tools. Upstream PR opportunity: the `CharacterChunker` fallback approach for dropping tree-sitter could be contributed back.

---

## Features

- **Zero Setup**: Works out of the box with Ollama - no API keys required
- **Privacy-First**: Local embeddings and vector storage - data never leaves your machine
- **Multiple Providers**: Ollama (default), OpenAI, Cohere, and Voyage AI
- **Hybrid Search**: Combine semantic and keyword search for better results
- **Semantic Search**: Natural language search with metadata filtering
- **Configurable Prompts**: Create custom prompts for guided workflows without code changes
- **Rate Limiting**: Intelligent throttling with exponential backoff
- **Full CRUD**: Create, search, and manage collections and documents
- **Structured Logging**: JSON logging via Pino with configurable log levels
- **Flexible Deployment**: Run locally (stdio) or as a remote HTTP server
- **API Key Authentication**: Connect to secured Qdrant instances (Qdrant Cloud, self-hosted with API keys)

## Quick Start

### Prerequisites

- Node.js 22.x or 24.x
- Podman or Docker with Compose support (for running Qdrant locally)

### Installation

```bash
# Clone and install
git clone https://github.com/yaoman41/qdrant-mcp-server.git
cd qdrant-mcp-server
npm install

# Start Qdrant (choose one)
podman compose up -d   # Using Podman
docker compose up -d   # Using Docker

# Build
npm run build
```

### Configuration

#### Local Setup (stdio transport)

```bash
claude mcp add --transport stdio qdrant -- node /path/to/qdrant-mcp-server/build/index.js
```

Or add to `~/.claude.json`:

```json
{
  "mcpServers": {
    "qdrant": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/qdrant-mcp-server/build/index.js"]
    }
  }
}
```

For Qdrant Cloud or secured instances, add `--env QDRANT_API_KEY=your-key` or set in env config.

**Try it:**

```
Create a collection called "notes" and add a document about machine learning
```

**Enable example prompts:** Copy `prompts.example.json` to `prompts.json` and restart. Use `/prompt` to list available prompts.

#### Remote Setup (HTTP transport)

> **Warning**: When deploying the HTTP transport in production:
>
> - **Always** run behind a reverse proxy (nginx, Caddy) with HTTPS
> - Implement authentication/authorization at the proxy level
> - Use firewalls to restrict access to trusted networks
> - Never expose directly to the public internet without protection
> - Consider implementing rate limiting at the proxy level
> - Monitor server logs for suspicious activity

**Start the server:**

```bash
TRANSPORT_MODE=http HTTP_PORT=3000 node build/index.js
```

**Option 1: Using `claude mcp add`**

```bash
claude mcp add --transport http qdrant http://your-server:3000/mcp
```

**Option 2: Add to `~/.claude.json`**

```json
{
  "mcpServers": {
    "qdrant": {
      "type": "http",
      "url": "http://your-server:3000/mcp"
    }
  }
}
```

**Using a different provider:**

```json
"env": {
  "EMBEDDING_PROVIDER": "openai",  // or "cohere", "voyage"
  "OPENAI_API_KEY": "sk-...",      // provider-specific API key
  "QDRANT_URL": "http://localhost:6333"
}
```

Restart after making changes.

See [Advanced Configuration](#advanced-configuration) section below for all options.

## Tools

### Collection Management

| Tool                  | Description                                                          |
| --------------------- | -------------------------------------------------------------------- |
| `create_collection`   | Create collection with specified distance metric (Cosine/Euclid/Dot) |
| `list_collections`    | List all collections                                                 |
| `get_collection_info` | Get collection details and statistics                                |
| `delete_collection`   | Delete collection and all documents                                  |

### Document Operations

| Tool               | Description                                                                   |
| ------------------ | ----------------------------------------------------------------------------- |
| `add_documents`    | Add documents with automatic embedding (supports string/number IDs, metadata) |
| `semantic_search`  | Natural language search with optional metadata filtering                      |
| `hybrid_search`    | Hybrid search combining semantic and keyword (BM25) search with RRF           |
| `delete_documents` | Delete specific documents by ID                                               |

### Resources

- `qdrant://collections` - List all collections
- `qdrant://collection/{name}` - Collection details

## Configurable Prompts

Create custom prompts tailored to your specific use cases without modifying code. Prompts provide guided workflows for common tasks.

**Note**: By default, the server looks for `prompts.json` in the project root directory. If the file exists, prompts are automatically loaded. You can specify a custom path using the `PROMPTS_CONFIG_FILE` environment variable.

### Setup

1. **Create a prompts configuration file** (e.g., `prompts.json` in the project root):

   See [`prompts.example.json`](prompts.example.json) for example configurations you can copy and customize.

2. **Configure the server** (optional - only needed for custom path):

If you place `prompts.json` in the project root, no additional configuration is needed. To use a custom path:

```json
{
  "mcpServers": {
    "qdrant": {
      "command": "node",
      "args": ["/path/to/qdrant-mcp-server/build/index.js"],
      "env": {
        "QDRANT_URL": "http://localhost:6333",
        "PROMPTS_CONFIG_FILE": "/custom/path/to/prompts.json"
      }
    }
  }
}
```

3. **Use prompts** in your AI assistant:

**Claude Code:**

```bash
/mcp__qdrant__find_similar_docs papers "neural networks" 10
```

**VSCode:**

```bash
/mcp.qdrant.find_similar_docs papers "neural networks" 10
```

### Example Prompts

See [`prompts.example.json`](prompts.example.json) for ready-to-use prompts including:

- `setup_rag_collection` - Create RAG-optimized collections
- `analyze_and_optimize` - Collection insights and recommendations
- `compare_search_strategies` - Semantic vs hybrid search comparison
- `migrate_to_hybrid` - Collection migration guide
- `debug_search_quality` - Troubleshoot poor search results
- `build_knowledge_base` - Structured documentation with metadata

### Template Syntax

Templates use `{{variable}}` placeholders:

- Required arguments must be provided
- Optional arguments use defaults if not specified
- Unknown variables are left as-is in the output

## Examples

See [examples/](examples/) directory for detailed guides:

- **[Basic Usage](examples/basic/)** - Create collections, add documents, search
- **[Hybrid Search](examples/hybrid-search/)** - Combine semantic and keyword search
- **[Knowledge Base](examples/knowledge-base/)** - Structured documentation with metadata
- **[Advanced Filtering](examples/filters/)** - Complex boolean filters
- **[Rate Limiting](examples/rate-limiting/)** - Batch processing with cloud providers

## Advanced Configuration

### Environment Variables

#### Core Configuration

| Variable                  | Description                                              | Default               |
| ------------------------- | -------------------------------------------------------- | --------------------- |
| `TRANSPORT_MODE`          | "stdio" or "http"                                        | stdio                 |
| `HTTP_PORT`               | Port for HTTP transport                                  | 3000                  |
| `HTTP_REQUEST_TIMEOUT_MS` | Request timeout for HTTP transport (ms)                  | 300000                |
| `EMBEDDING_PROVIDER`      | "ollama", "openai", "cohere", "voyage"                   | ollama                |
| `QDRANT_URL`              | Qdrant server URL                                        | http://localhost:6333 |
| `QDRANT_API_KEY`          | API key for Qdrant authentication                        | -                     |
| `LOG_LEVEL`               | Logging level (fatal/error/warn/info/debug/trace/silent) | info                  |
| `PROMPTS_CONFIG_FILE`     | Path to prompts configuration JSON                       | prompts.json          |

#### Embedding Configuration

| Variable                            | Description              | Default           |
| ----------------------------------- | ------------------------ | ----------------- |
| `EMBEDDING_MODEL`                   | Model name               | Provider-specific |
| `EMBEDDING_BASE_URL`                | Custom API URL           | Provider-specific |
| `EMBEDDING_MAX_REQUESTS_PER_MINUTE` | Rate limit               | Provider-specific |
| `EMBEDDING_RETRY_ATTEMPTS`          | Retry count              | 3                 |
| `EMBEDDING_RETRY_DELAY`             | Initial retry delay (ms) | 1000              |
| `OPENAI_API_KEY`                    | OpenAI API key           | -                 |
| `COHERE_API_KEY`                    | Cohere API key           | -                 |
| `VOYAGE_API_KEY`                    | Voyage AI API key        | -                 |

### Provider Comparison

| Provider   | Models                                                          | Dimensions     | Rate Limit | Notes                |
| ---------- | --------------------------------------------------------------- | -------------- | ---------- | -------------------- |
| **Ollama** | `nomic-embed-text` (default), `mxbai-embed-large`, `all-minilm` | 768, 1024, 384 | None       | Local, no API key    |
| **OpenAI** | `text-embedding-3-small` (default), `text-embedding-3-large`    | 1536, 3072     | 3500/min   | Cloud API            |
| **Cohere** | `embed-english-v3.0` (default), `embed-multilingual-v3.0`       | 1024           | 100/min    | Multilingual support |
| **Voyage** | `voyage-2` (default), `voyage-large-2`, `voyage-code-2`         | 1024, 1536     | 300/min    | Code-specialized     |

**Note:** Ollama models require pulling before use:

- Podman: `podman exec ollama ollama pull <model-name>`
- Docker: `docker exec ollama ollama pull <model-name>`

## Troubleshooting

| Issue                         | Solution                                                                    |
| ----------------------------- | --------------------------------------------------------------------------- |
| **Qdrant not running**        | `podman compose up -d` or `docker compose up -d`                            |
| **Collection missing**        | Create collection first before adding documents                             |
| **Ollama not running**        | Verify with `curl http://localhost:11434`, start with `podman compose up -d` |
| **Model missing**             | `podman exec ollama ollama pull nomic-embed-text`                           |
| **Rate limit errors**         | Adjust `EMBEDDING_MAX_REQUESTS_PER_MINUTE` to match your provider tier      |
| **API key errors**            | Verify correct API key in environment configuration                         |
| **Qdrant unauthorized**       | Set `QDRANT_API_KEY` environment variable for secured instances             |
| **Filter errors**             | Ensure Qdrant filter format, check field names match metadata               |
| **Search returns no results** | Try broader queries or check collection exists with `list_collections`      |

## Development

```bash
npm run dev          # Development with auto-reload
npm run build        # Production build
npm run type-check   # TypeScript validation
npm test             # Run test suite
npm run test:coverage # Coverage report
```

### Testing

Tests cover all 8 kept tools across collection management, document operations, search, embeddings, and transport layers.

**CI/CD**: GitHub Actions runs build, type-check, and tests on Node.js 22.x and 24.x for every push/PR.

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for:

- Development workflow
- Conventional commit format (`feat:`, `fix:`, `BREAKING CHANGE:`)
- Testing requirements (run `npm test`, `npm run type-check`, `npm run build`)

**Automated releases**: Semantic versioning via conventional commits - `feat:` → minor, `fix:` → patch, `BREAKING CHANGE:` → major.

## License
