import { describe, expect, it } from "vitest";

import { safeUrl } from "./safeUrl";

describe("safeUrl", () => {
  it("passes http and https through unchanged", () => {
    expect(safeUrl("https://example.com/listing/1")).toBe(
      "https://example.com/listing/1",
    );
    expect(safeUrl("http://example.com/a")).toBe("http://example.com/a");
  });

  it("refuses javascript: scheme", () => {
    expect(safeUrl("javascript:alert(1)")).toBe("#");
    expect(safeUrl("JavaScript:alert(1)")).toBe("#");
    // Whitespace-padded variants that browsers tolerate
    expect(safeUrl("  javascript:alert(1)  ")).toBe("#");
  });

  it("refuses data:, file:, mailto:, tel:", () => {
    expect(safeUrl("data:text/html,<script>alert(1)</script>")).toBe("#");
    expect(safeUrl("file:///etc/passwd")).toBe("#");
    expect(safeUrl("mailto:a@b.c")).toBe("#");
    expect(safeUrl("tel:+15555555555")).toBe("#");
  });

  it("returns # for empty / null / undefined", () => {
    expect(safeUrl("")).toBe("#");
    expect(safeUrl(null)).toBe("#");
    expect(safeUrl(undefined)).toBe("#");
    expect(safeUrl("   ")).toBe("#");
  });

  it("returns # for malformed non-http strings", () => {
    expect(safeUrl("not a url")).toBe("#");
    expect(safeUrl("//no-scheme.com/path")).toBe("#");
  });

  it("accepts relative-looking http(s) fallback", () => {
    // URL() would throw on this; the regex fallback lets it through.
    expect(safeUrl("https://")).toBe("https://");
  });
});
