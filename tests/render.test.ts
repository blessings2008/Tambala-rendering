import { describe, expect, it } from "vitest";
import { getDimensions } from "../src/render";

describe("video format dimensions", () => {
  it("uses vertical dimensions for short-form social video", () => {
    expect(getDimensions("vertical")).toEqual({ width: 1080, height: 1920 });
  });

  it("supports square and landscape output", () => {
    expect(getDimensions("square")).toEqual({ width: 1080, height: 1080 });
    expect(getDimensions("landscape")).toEqual({ width: 1920, height: 1080 });
  });
});
