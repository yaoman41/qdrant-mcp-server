/**
 * Safe JSON serialization utility.
 *
 * Qdrant point IDs are uint64 values generated from sha256 truncation.
 * Values > 2^53 exceed JavaScript's Number.MAX_SAFE_INTEGER, so the qdrant-js
 * client returns them as BigInt. The default JSON.stringify throws
 * "Do not know how to serialize a BigInt" in that case.
 *
 * This module provides a drop-in replacer that converts BigInt → string so
 * the MCP tool result remains valid JSON without losing precision.
 */

/**
 * JSON replacer that converts BigInt values to their decimal string representation.
 * All other values pass through unchanged.
 */
export function bigIntReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

/**
 * Drop-in replacement for JSON.stringify that handles BigInt values.
 * Preserves precision by serialising BigInt as a decimal string.
 *
 * @param value  - Any value (may contain nested BigInt)
 * @param indent - Optional indentation spaces (default: 2)
 */
export function safeJsonStringify(value: unknown, indent = 2): string {
  return JSON.stringify(value, bigIntReplacer, indent);
}
