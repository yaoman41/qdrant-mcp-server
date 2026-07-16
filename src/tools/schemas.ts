/**
 * Consolidated Zod schemas for all MCP tools
 *
 * Note: Schemas are exported as plain objects (not wrapped in z.object()) because
 * McpServer.registerTool() expects schemas in this format. The SDK internally
 * converts these to JSON Schema for the MCP protocol. Each property is a Zod
 * field definition that gets composed into the final schema by the SDK.
 */

import { z } from "zod";

// Collection management schemas
export const CreateCollectionSchema = {
  name: z.string().describe("Name of the collection"),
  distance: z
    .enum(["Cosine", "Euclid", "Dot"])
    .optional()
    .describe("Distance metric (default: Cosine)"),
  enableHybrid: z
    .boolean()
    .optional()
    .describe("Enable hybrid search with sparse vectors (default: false)"),
};

export const DeleteCollectionSchema = {
  name: z.string().describe("Name of the collection to delete"),
};

export const GetCollectionInfoSchema = {
  name: z.string().describe("Name of the collection"),
};

// Document operation schemas
// text OR file_path (prefer file_path for long content — server reads UTF-8, no model copy).
// id optional: omitted → SHA-256 deterministic UUID from content (+ chunk index).
export const AddDocumentsSchema = {
  collection: z.string().describe("Name of the collection"),
  documents: z
    .array(
      z
        .object({
          id: z
            .union([z.string(), z.number()])
            .optional()
            .describe(
              "Unique id (optional). If omitted, server generates deterministic SHA-256 UUID from content."
            ),
          text: z
            .string()
            .optional()
            .describe("Inline text to embed. Prefer file_path for long content."),
          file_path: z
            .string()
            .optional()
            .describe(
              "Absolute UTF-8 file path. Server reads file (max 5MB), auto-chunks >1500 chars (overlap 200). Wins over text if both set."
            ),
          metadata: z
            .record(z.string(), z.any())
            .optional()
            .describe("Optional metadata to store with the document"),
        })
        .superRefine((doc, ctx) => {
          if (!doc.text && !doc.file_path) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Each document needs text or file_path",
              path: ["text"],
            });
          }
        })
    )
    .describe("Array of documents to add (text or file_path per item)"),
};

export const DeleteDocumentsSchema = {
  collection: z.string().describe("Name of the collection"),
  ids: z.array(z.union([z.string(), z.number()])).describe("Array of document IDs to delete"),
};

// Search schemas
export const SemanticSearchSchema = {
  collection: z.string().describe("Name of the collection to search"),
  query: z.string().describe("Search query text"),
  limit: z.number().optional().describe("Maximum number of results (default: 5)"),
  filter: z.record(z.string(), z.any()).optional().describe("Optional metadata filter"),
};

export const HybridSearchSchema = {
  collection: z.string().describe("Name of the collection to search"),
  query: z.string().describe("Search query text"),
  limit: z.number().optional().describe("Maximum number of results (default: 5)"),
  filter: z.record(z.string(), z.any()).optional().describe("Optional metadata filter"),
};

