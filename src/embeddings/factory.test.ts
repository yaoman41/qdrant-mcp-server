import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmbeddingProviderFactory } from "./factory.js";
import { OpenAIEmbeddings } from "./openai.js";

vi.mock("../logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
}));

describe("EmbeddingProviderFactory", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe("create", () => {
    describe("Unknown provider", () => {
      it("should throw error for unknown provider", () => {
        expect(() =>
          EmbeddingProviderFactory.create({
            provider: "unknown" as any,
          })
        ).toThrow("Unknown embedding provider: unknown");
      });

      it("should explain tree-shake in error message (Mordeco fork: openai only)", () => {
        expect(() =>
          EmbeddingProviderFactory.create({
            provider: "ollama" as any,
          })
        ).toThrow("supports only: openai");
      });
    });

    describe("OpenAI provider", () => {
      it("should throw error if API key is missing", () => {
        expect(() =>
          EmbeddingProviderFactory.create({
            provider: "openai",
          })
        ).toThrow("API key is required for OpenAI provider");
      });

      it("should create OpenAI provider with API key", () => {
        const provider = EmbeddingProviderFactory.create({
          provider: "openai",
          apiKey: "test-key",
        });

        expect(provider).toBeInstanceOf(OpenAIEmbeddings);
        expect(provider.getModel()).toBe("text-embedding-3-small");
        expect(provider.getDimensions()).toBe(1536);
      });

      it("should use custom model", () => {
        const provider = EmbeddingProviderFactory.create({
          provider: "openai",
          apiKey: "test-key",
          model: "text-embedding-3-large",
        });

        expect(provider.getModel()).toBe("text-embedding-3-large");
        expect(provider.getDimensions()).toBe(3072);
      });

      it("should use custom dimensions", () => {
        const provider = EmbeddingProviderFactory.create({
          provider: "openai",
          apiKey: "test-key",
          dimensions: 512,
        });

        expect(provider.getDimensions()).toBe(512);
      });

      it("should pass rate limit config", () => {
        const provider = EmbeddingProviderFactory.create({
          provider: "openai",
          apiKey: "test-key",
          rateLimitConfig: {
            maxRequestsPerMinute: 1000,
            retryAttempts: 5,
            retryDelayMs: 2000,
          },
        });

        expect(provider).toBeInstanceOf(OpenAIEmbeddings);
      });
    });
  });

  describe("createFromEnv", () => {
    it("should default to OpenAI provider (Mordeco fork)", () => {
      delete process.env.EMBEDDING_PROVIDER;
      process.env.OPENAI_API_KEY = "test-key";

      const provider = EmbeddingProviderFactory.createFromEnv();

      expect(provider).toBeInstanceOf(OpenAIEmbeddings);
    });

    it("should create OpenAI provider from environment", () => {
      process.env.EMBEDDING_PROVIDER = "openai";
      process.env.OPENAI_API_KEY = "test-openai-key";

      const provider = EmbeddingProviderFactory.createFromEnv();

      expect(provider).toBeInstanceOf(OpenAIEmbeddings);
    });

    it("should throw for tree-shaken provider from environment", () => {
      process.env.EMBEDDING_PROVIDER = "cohere";
      process.env.COHERE_API_KEY = "test-cohere-key";

      expect(() => EmbeddingProviderFactory.createFromEnv()).toThrow(
        "supports only: openai"
      );
    });

    it("should be case insensitive for provider name", () => {
      process.env.EMBEDDING_PROVIDER = "OpenAI";
      process.env.OPENAI_API_KEY = "test-key";

      const provider = EmbeddingProviderFactory.createFromEnv();

      expect(provider).toBeInstanceOf(OpenAIEmbeddings);
    });

    it("should use custom model from environment", () => {
      process.env.EMBEDDING_PROVIDER = "openai";
      process.env.OPENAI_API_KEY = "test-key";
      process.env.EMBEDDING_MODEL = "text-embedding-3-large";

      const provider = EmbeddingProviderFactory.createFromEnv();

      expect(provider.getModel()).toBe("text-embedding-3-large");
    });

    it("should use custom dimensions from environment", () => {
      process.env.EMBEDDING_PROVIDER = "openai";
      process.env.OPENAI_API_KEY = "test-key";
      process.env.EMBEDDING_DIMENSIONS = "512";

      const provider = EmbeddingProviderFactory.createFromEnv();

      expect(provider.getDimensions()).toBe(512);
    });

    it("should use rate limit config from environment", () => {
      process.env.EMBEDDING_PROVIDER = "openai";
      process.env.OPENAI_API_KEY = "test-key";
      process.env.EMBEDDING_MAX_REQUESTS_PER_MINUTE = "1000";
      process.env.EMBEDDING_RETRY_ATTEMPTS = "5";
      process.env.EMBEDDING_RETRY_DELAY = "2000";

      const provider = EmbeddingProviderFactory.createFromEnv();

      expect(provider).toBeInstanceOf(OpenAIEmbeddings);
    });

    describe("Environment variable validation", () => {
      it("should throw error for invalid EMBEDDING_DIMENSIONS (NaN)", () => {
        process.env.EMBEDDING_PROVIDER = "openai";
        process.env.OPENAI_API_KEY = "test-key";
        process.env.EMBEDDING_DIMENSIONS = "not-a-number";

        expect(() => EmbeddingProviderFactory.createFromEnv()).toThrow(
          'Invalid EMBEDDING_DIMENSIONS: must be a positive integer, got "not-a-number"'
        );
      });

      it("should throw error for invalid EMBEDDING_DIMENSIONS (negative)", () => {
        process.env.EMBEDDING_PROVIDER = "openai";
        process.env.OPENAI_API_KEY = "test-key";
        process.env.EMBEDDING_DIMENSIONS = "-100";

        expect(() => EmbeddingProviderFactory.createFromEnv()).toThrow(
          'Invalid EMBEDDING_DIMENSIONS: must be a positive integer, got "-100"'
        );
      });

      it("should throw error for invalid EMBEDDING_DIMENSIONS (zero)", () => {
        process.env.EMBEDDING_PROVIDER = "openai";
        process.env.OPENAI_API_KEY = "test-key";
        process.env.EMBEDDING_DIMENSIONS = "0";

        expect(() => EmbeddingProviderFactory.createFromEnv()).toThrow(
          'Invalid EMBEDDING_DIMENSIONS: must be a positive integer, got "0"'
        );
      });

      it("should throw error for invalid EMBEDDING_MAX_REQUESTS_PER_MINUTE (NaN)", () => {
        process.env.EMBEDDING_PROVIDER = "openai";
        process.env.OPENAI_API_KEY = "test-key";
        process.env.EMBEDDING_MAX_REQUESTS_PER_MINUTE = "invalid";

        expect(() => EmbeddingProviderFactory.createFromEnv()).toThrow(
          'Invalid EMBEDDING_MAX_REQUESTS_PER_MINUTE: must be a positive integer, got "invalid"'
        );
      });

      it("should throw error for invalid EMBEDDING_MAX_REQUESTS_PER_MINUTE (negative)", () => {
        process.env.EMBEDDING_PROVIDER = "openai";
        process.env.OPENAI_API_KEY = "test-key";
        process.env.EMBEDDING_MAX_REQUESTS_PER_MINUTE = "-50";

        expect(() => EmbeddingProviderFactory.createFromEnv()).toThrow(
          'Invalid EMBEDDING_MAX_REQUESTS_PER_MINUTE: must be a positive integer, got "-50"'
        );
      });

      it("should throw error for invalid EMBEDDING_RETRY_ATTEMPTS (NaN)", () => {
        process.env.EMBEDDING_PROVIDER = "openai";
        process.env.OPENAI_API_KEY = "test-key";
        process.env.EMBEDDING_RETRY_ATTEMPTS = "abc";

        expect(() => EmbeddingProviderFactory.createFromEnv()).toThrow(
          'Invalid EMBEDDING_RETRY_ATTEMPTS: must be a non-negative integer, got "abc"'
        );
      });

      it("should throw error for invalid EMBEDDING_RETRY_ATTEMPTS (negative)", () => {
        process.env.EMBEDDING_PROVIDER = "openai";
        process.env.OPENAI_API_KEY = "test-key";
        process.env.EMBEDDING_RETRY_ATTEMPTS = "-5";

        expect(() => EmbeddingProviderFactory.createFromEnv()).toThrow(
          'Invalid EMBEDDING_RETRY_ATTEMPTS: must be a non-negative integer, got "-5"'
        );
      });

      it("should throw error for invalid EMBEDDING_RETRY_DELAY (NaN)", () => {
        process.env.EMBEDDING_PROVIDER = "openai";
        process.env.OPENAI_API_KEY = "test-key";
        process.env.EMBEDDING_RETRY_DELAY = "xyz";

        expect(() => EmbeddingProviderFactory.createFromEnv()).toThrow(
          'Invalid EMBEDDING_RETRY_DELAY: must be a non-negative integer, got "xyz"'
        );
      });

      it("should throw error for invalid EMBEDDING_RETRY_DELAY (negative)", () => {
        process.env.EMBEDDING_PROVIDER = "openai";
        process.env.OPENAI_API_KEY = "test-key";
        process.env.EMBEDDING_RETRY_DELAY = "-1000";

        expect(() => EmbeddingProviderFactory.createFromEnv()).toThrow(
          'Invalid EMBEDDING_RETRY_DELAY: must be a non-negative integer, got "-1000"'
        );
      });

      it("should accept valid EMBEDDING_RETRY_ATTEMPTS (zero)", () => {
        process.env.EMBEDDING_PROVIDER = "openai";
        process.env.OPENAI_API_KEY = "test-key";
        process.env.EMBEDDING_RETRY_ATTEMPTS = "0";

        const provider = EmbeddingProviderFactory.createFromEnv();

        expect(provider).toBeInstanceOf(OpenAIEmbeddings);
      });

      it("should accept valid EMBEDDING_RETRY_DELAY (zero)", () => {
        process.env.EMBEDDING_PROVIDER = "openai";
        process.env.OPENAI_API_KEY = "test-key";
        process.env.EMBEDDING_RETRY_DELAY = "0";

        const provider = EmbeddingProviderFactory.createFromEnv();

        expect(provider).toBeInstanceOf(OpenAIEmbeddings);
      });
    });
  });
});
