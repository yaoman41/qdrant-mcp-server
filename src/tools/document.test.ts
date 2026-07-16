/**
 * Tests for add_documents file_path + chunking + content-hash id helpers
 */
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import * as schemas from "./schemas.js";
import {
  CHUNK_OVERLAP,
  CHUNK_SIZE,
  chunkText,
  contentHashId,
  resolveDocuments,
} from "./document.js";

describe("contentHashId", () => {
  it("is deterministic UUID-shaped", () => {
    const a = contentHashId("hello");
    const b = contentHashId("hello");
    expect(a).toBe(b);
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it("differs by content and salt", () => {
    expect(contentHashId("a")).not.toBe(contentHashId("b"));
    expect(contentHashId("same", "0")).not.toBe(contentHashId("same", "1"));
  });
});

describe("chunkText", () => {
  it("returns single chunk when under size", () => {
    expect(chunkText("short")).toEqual(["short"]);
  });

  it("splits long text with overlap", () => {
    const text = "x".repeat(CHUNK_SIZE + 100);
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].length).toBe(CHUNK_SIZE);
    // second chunk starts overlap chars before end of first
    const expectedStart = text.slice(CHUNK_SIZE - CHUNK_OVERLAP, CHUNK_SIZE - CHUNK_OVERLAP + 10);
    expect(chunks[1].startsWith(expectedStart)).toBe(true);
    // full coverage: last char present
    expect(chunks[chunks.length - 1].endsWith("x")).toBe(true);
  });
});

describe("resolveDocuments", () => {
  let tmp: string;

  afterEach(() => {
    if (tmp) {
      try {
        rmSync(tmp, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it("reads file_path and attaches source_path metadata", () => {
    tmp = mkdtempSync(join(tmpdir(), "qdrant-doc-"));
    const fp = join(tmp, "note.md");
    writeFileSync(fp, "hello from file", "utf-8");

    const resolved = resolveDocuments([{ file_path: fp }]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].text).toBe("hello from file");
    expect(resolved[0].metadata?.source_path).toBe(fp);
    expect(resolved[0].metadata?.chunk_index).toBe(0);
    // id is content hash UUID
    expect(String(resolved[0].id)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it("file_path wins over text when both set", () => {
    tmp = mkdtempSync(join(tmpdir(), "qdrant-doc-"));
    const fp = join(tmp, "win.txt");
    writeFileSync(fp, "from-file", "utf-8");
    const resolved = resolveDocuments([{ text: "inline", file_path: fp }]);
    expect(resolved[0].text).toBe("from-file");
  });

  it("chunks long file and unique ids per chunk", () => {
    tmp = mkdtempSync(join(tmpdir(), "qdrant-doc-"));
    const fp = join(tmp, "long.txt");
    writeFileSync(fp, "y".repeat(CHUNK_SIZE + 50), "utf-8");
    const resolved = resolveDocuments([{ file_path: fp }]);
    expect(resolved.length).toBeGreaterThan(1);
    const ids = new Set(resolved.map((r) => r.id));
    expect(ids.size).toBe(resolved.length);
    expect(resolved[0].metadata?.chunk_total).toBe(resolved.length);
    expect(resolved[1].metadata?.chunk_index).toBe(1);
  });

  it("rejects relative path and missing file", () => {
    expect(() => resolveDocuments([{ file_path: "relative.md" }])).toThrow(/absolute/);
    expect(() => resolveDocuments([{ file_path: "/no/such/file-xyz.md" }])).toThrow(
      /not found/
    );
  });

  it("rejects empty document (no text no path)", () => {
    expect(() => resolveDocuments([{ metadata: { a: 1 } }])).toThrow(/text or file_path/);
  });

  it("keeps explicit id for single-chunk text", () => {
    const resolved = resolveDocuments([{ id: "my-id", text: "tiny" }]);
    expect(resolved[0].id).toBe("my-id");
  });
});

describe("AddDocumentsSchema (real export)", () => {
  const schema = z.object(schemas.AddDocumentsSchema as any);

  it("accepts file_path without id", () => {
    expect(() =>
      schema.parse({
        collection: "c",
        documents: [{ file_path: "/tmp/x.md" }],
      })
    ).not.toThrow();
  });

  it("accepts text-only without id", () => {
    expect(() =>
      schema.parse({
        collection: "c",
        documents: [{ text: "hi" }],
      })
    ).not.toThrow();
  });

  it("rejects document with neither text nor file_path", () => {
    expect(() =>
      schema.parse({
        collection: "c",
        documents: [{ id: 1 }],
      })
    ).toThrow();
  });
});

describe("contentHashId vs sha256", () => {
  it("uses sha256 of salt\\0content", () => {
    const content = "payload";
    const salt = "s";
    const full = createHash("sha256").update(salt + "\0" + content).digest("hex");
    const id = contentHashId(content, salt);
    expect(id.startsWith(full.slice(0, 8))).toBe(true);
  });
});
