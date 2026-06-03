/**
 * Utilities for parsing electrical component values into SI base units.
 *
 * Ported from peterb154/jlcpcb-search-mcp `value_parser.py`. Each parser is a
 * pure function returning the value in a base unit (ohms, farads, volts,
 * amperes, watts) or `null` when the input cannot be parsed.
 */

/**
 * Parse a resistance value to ohms.
 *
 * @example
 * parseResistance("10k")    // 10000
 * parseResistance("4.7K")   // 4700
 * parseResistance("1M")     // 1000000
 * parseResistance("10R")    // 10
 * parseResistance("100ohm") // 100
 */
export function parseResistance(value: string): number | null {
  if (!value) return null;
  const s = value.trim().toUpperCase();

  const match = s.match(/^([\d.]+)\s*([KMRΩ])?(?:OHM)?S?$/);
  if (!match) return null;

  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;

  const multipliers: Record<string, number> = { K: 1e3, M: 1e6, R: 1, "Ω": 1 };
  const mult = match[2] ? multipliers[match[2]] ?? 1 : 1;
  return base * mult;
}

/**
 * Parse a capacitance value to farads. With no unit suffix the value is
 * assumed to be microfarads (matching upstream behaviour).
 *
 * @example
 * parseCapacitance("10uF")  // 1e-5
 * parseCapacitance("10µF")  // 1e-5
 * parseCapacitance("100nF") // 1e-7
 * parseCapacitance("22pF")  // 2.2e-11
 * parseCapacitance("0.1uF") // 1e-7
 */
export function parseCapacitance(value: string): number | null {
  if (!value) return null;
  // Normalize the micro sign (U+00B5) and Greek mu (U+03BC) to "u" *before*
  // uppercasing — `"µ".toUpperCase()` becomes Greek capital "Μ", not "U".
  const s = value.trim().replace(/[µμ]/g, "u").toUpperCase();

  const match = s.match(/^([\d.]+)\s*([FPNUM])?F?$/);
  if (!match) return null;

  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;

  const multipliers: Record<string, number> = {
    F: 1,
    M: 1e-3, // millifarads (rare)
    U: 1e-6, // microfarads
    N: 1e-9, // nanofarads
    P: 1e-12, // picofarads
  };
  // Default to microfarads when no unit is supplied.
  const mult = match[2] ? multipliers[match[2]] ?? 1e-6 : 1e-6;
  return base * mult;
}

/**
 * Parse a voltage value to volts.
 *
 * @example
 * parseVoltage("5V")   // 5
 * parseVoltage("3.3V") // 3.3
 * parseVoltage("12")   // 12
 */
export function parseVoltage(value: string): number | null {
  if (!value) return null;
  const s = value.trim().toUpperCase();

  const match = s.match(/^([\d.]+)\s*V?$/);
  if (!match) return null;

  const base = Number(match[1]);
  return Number.isFinite(base) ? base : null;
}

/**
 * Parse a current value to amperes.
 *
 * @example
 * parseCurrent("2A")    // 2
 * parseCurrent("100mA") // 0.1
 * parseCurrent("1.5")   // 1.5
 */
export function parseCurrent(value: string): number | null {
  if (!value) return null;
  const s = value.trim().toUpperCase();

  const match = s.match(/^([\d.]+)\s*(M)?A?$/);
  if (!match) return null;

  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;

  return match[2] === "M" ? base * 1e-3 : base;
}

/**
 * Parse a power value to watts.
 *
 * @example
 * parsePower("50mW")  // 0.05
 * parsePower("250mW") // 0.25
 * parsePower("1W")    // 1
 */
export function parsePower(value: string): number | null {
  if (!value) return null;
  const s = value.trim().toUpperCase();

  const match = s.match(/^([\d.]+)\s*(M)?W?$/);
  if (!match) return null;

  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;

  return match[2] === "M" ? base * 1e-3 : base;
}
