import { describe, it, expect } from "vitest";
import {
  parseResistance,
  parseCapacitance,
  parseVoltage,
  parseCurrent,
  parsePower,
} from "../value-parser.js";

describe("parseResistance", () => {
  it.each([
    ["10k", 10000],
    ["4.7K", 4700],
    ["1M", 1_000_000],
    ["10R", 10],
    ["100", 100],
    ["100ohm", 100],
    ["10kohm", 10000],
  ])("parses %s -> %d", (input, expected) => {
    expect(parseResistance(input)).toBe(expected);
  });

  it.each(["", "abc", "1.2.3x"])("returns null for %j", (input) => {
    expect(parseResistance(input)).toBeNull();
  });
});

describe("parseCapacitance", () => {
  it.each([
    ["10uF", 1e-5],
    ["10µF", 1e-5],
    ["100nF", 1e-7],
    ["22pF", 2.2e-11],
    ["0.1uF", 1e-7],
    ["100", 1e-4], // no unit -> microfarads
  ])("parses %s", (input, expected) => {
    expect(parseCapacitance(input)).toBeCloseTo(expected as number, 15);
  });

  it("returns null for empty input", () => {
    expect(parseCapacitance("")).toBeNull();
  });
});

describe("parseVoltage", () => {
  it.each([
    ["5V", 5],
    ["3.3V", 3.3],
    ["12", 12],
    ["50v", 50],
  ])("parses %s -> %d", (input, expected) => {
    expect(parseVoltage(input)).toBeCloseTo(expected as number, 10);
  });

  it("returns null for junk", () => {
    expect(parseVoltage("xyz")).toBeNull();
  });
});

describe("parseCurrent", () => {
  it.each([
    ["2A", 2],
    ["100mA", 0.1],
    ["500ma", 0.5],
    ["1.5", 1.5],
  ])("parses %s", (input, expected) => {
    expect(parseCurrent(input)).toBeCloseTo(expected as number, 10);
  });
});

describe("parsePower", () => {
  it.each([
    ["50mW", 0.05],
    ["250mW", 0.25],
    ["1W", 1],
  ])("parses %s", (input, expected) => {
    expect(parsePower(input)).toBeCloseTo(expected as number, 10);
  });
});
