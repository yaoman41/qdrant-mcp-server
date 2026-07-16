import logger from "../logger.js";
import type { EmbeddingProvider, ProviderConfig } from "./base.js";
import { OpenAIEmbeddings } from "./openai.js";

// Mordeco fork 2026-07-16: cohere / voyage / ollama providers tree-shaken.
// Production (MCP client env + R1601 sync) uses openai/text-embedding-3-small only.
// Sparse BM25 (sparse.ts) is NOT a dense provider and stays — hybrid_search needs it.
// To restore a removed provider, pull from upstream mhalder/qdrant-mcp-server.
export type EmbeddingProviderType = "openai";

export interface FactoryConfig extends ProviderConfig {
  provider: EmbeddingProviderType;
}

export class EmbeddingProviderFactory {
  static create(config: FactoryConfig): EmbeddingProvider {
    const { provider, model, dimensions, rateLimitConfig, apiKey } = config;

    logger.info({ provider, model }, "Creating embedding provider");

    switch (provider) {
      case "openai":
        if (!apiKey) {
          throw new Error("API key is required for OpenAI provider");
        }
        return new OpenAIEmbeddings(
          apiKey,
          model || "text-embedding-3-small",
          dimensions,
          rateLimitConfig
        );

      default:
        throw new Error(
          `Unknown embedding provider: ${provider}. This Mordeco fork supports only: openai ` +
            `(cohere/voyage/ollama tree-shaken 2026-07-16 — restore from upstream if needed)`
        );
    }
  }

  static createFromEnv(): EmbeddingProvider {
    const provider = (
      process.env.EMBEDDING_PROVIDER || "openai"
    ).toLowerCase() as EmbeddingProviderType;

    const apiKey = process.env.OPENAI_API_KEY;

    // Common configuration
    const model = process.env.EMBEDDING_MODEL;
    const dimensions = process.env.EMBEDDING_DIMENSIONS
      ? parseInt(process.env.EMBEDDING_DIMENSIONS, 10)
      : undefined;

    // Validate dimensions
    if (dimensions !== undefined && (Number.isNaN(dimensions) || dimensions <= 0)) {
      throw new Error(
        `Invalid EMBEDDING_DIMENSIONS: must be a positive integer, got "${process.env.EMBEDDING_DIMENSIONS}"`
      );
    }

    // Rate limiting configuration
    const maxRequestsPerMinute = process.env.EMBEDDING_MAX_REQUESTS_PER_MINUTE
      ? parseInt(process.env.EMBEDDING_MAX_REQUESTS_PER_MINUTE, 10)
      : undefined;

    // Validate maxRequestsPerMinute
    if (
      maxRequestsPerMinute !== undefined &&
      (Number.isNaN(maxRequestsPerMinute) || maxRequestsPerMinute <= 0)
    ) {
      throw new Error(
        `Invalid EMBEDDING_MAX_REQUESTS_PER_MINUTE: must be a positive integer, got "${process.env.EMBEDDING_MAX_REQUESTS_PER_MINUTE}"`
      );
    }

    const retryAttempts = process.env.EMBEDDING_RETRY_ATTEMPTS
      ? parseInt(process.env.EMBEDDING_RETRY_ATTEMPTS, 10)
      : undefined;

    // Validate retryAttempts
    if (retryAttempts !== undefined && (Number.isNaN(retryAttempts) || retryAttempts < 0)) {
      throw new Error(
        `Invalid EMBEDDING_RETRY_ATTEMPTS: must be a non-negative integer, got "${process.env.EMBEDDING_RETRY_ATTEMPTS}"`
      );
    }

    const retryDelayMs = process.env.EMBEDDING_RETRY_DELAY
      ? parseInt(process.env.EMBEDDING_RETRY_DELAY, 10)
      : undefined;

    // Validate retryDelayMs
    if (retryDelayMs !== undefined && (Number.isNaN(retryDelayMs) || retryDelayMs < 0)) {
      throw new Error(
        `Invalid EMBEDDING_RETRY_DELAY: must be a non-negative integer, got "${process.env.EMBEDDING_RETRY_DELAY}"`
      );
    }

    const rateLimitConfig = {
      maxRequestsPerMinute,
      retryAttempts,
      retryDelayMs,
    };

    return EmbeddingProviderFactory.create({
      provider,
      model,
      dimensions,
      rateLimitConfig,
      apiKey,
    });
  }
}
