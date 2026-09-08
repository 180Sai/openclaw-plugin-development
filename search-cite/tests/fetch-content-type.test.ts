import { describe, it, expect } from "vitest";
import { isSupportedTextContentType } from "../src/fetch.js";

describe("isSupportedTextContentType", () => {
  it("accepts text/* types", () => {
    expect(isSupportedTextContentType("text/html")).toBe(true);
    expect(isSupportedTextContentType("text/plain; charset=utf-8")).toBe(true);
  });

  it("accepts known text-ish media types", () => {
    expect(isSupportedTextContentType("application/xhtml+xml")).toBe(true);
    expect(isSupportedTextContentType("application/xml")).toBe(true);
    expect(isSupportedTextContentType("application/json")).toBe(true);
    expect(isSupportedTextContentType("application/ld+json")).toBe(true);
  });

  it("rejects binary types that would poison extracted text", () => {
    expect(isSupportedTextContentType("application/pdf")).toBe(false);
    expect(isSupportedTextContentType("application/octet-stream")).toBe(false);
    expect(isSupportedTextContentType("image/png")).toBe(false);
    expect(isSupportedTextContentType("application/zip")).toBe(false);
  });

  it("treats missing content-type as text", () => {
    expect(isSupportedTextContentType("")).toBe(true);
  });
});