// Table Formats. Dimensions are metres, measured cushion nose to cushion nose.

const INCH = 0.0254;

export type FormatId = 'us9' | 'us7' | 'uk' | 'cn';

export interface TableFormat {
  id: FormatId;
  name: string;
  short: string;
  length: number;
  width: number;
  objectR: number;
  cueR: number;
  cornerMouth: number;
  sideMouth: number;
  /** How object balls look: numbered solids/stripes, or UK reds and yellows. */
  balls: 'numbered' | 'redsYellows';
  /**
   * Angle between the cushion nose and the pocket facing (WPA: 142° corner, 104° side).
   * Rounded snooker-style pockets have no flat facing; 135°/90° approximates them as straight,
   * untapered jaws. Visual only: pocketing is decided by the jaw points.
   */
  cornerFacingDeg: number;
  sideFacingDeg: number;
}

export const FORMATS: Record<FormatId, TableFormat> = {
  // WPA: 100" x 50", corners 4½–4⅝", sides 5–5⅛".
  us9: {
    id: 'us9',
    name: 'US 9ft',
    short: 'US 9ft',
    length: 100 * INCH,
    width: 50 * INCH,
    objectR: 1.125 * INCH,
    cueR: 1.125 * INCH,
    cornerMouth: 4.5 * INCH,
    sideMouth: 5 * INCH,
    balls: 'numbered',
    cornerFacingDeg: 142,
    sideFacingDeg: 104,
  },
  // 7ft bar box: 78" x 39", WPA pocket mouths (upper end of the range).
  us7: {
    id: 'us7',
    name: 'US 7ft bar box',
    short: 'US 7ft',
    length: 78 * INCH,
    width: 39 * INCH,
    objectR: 1.125 * INCH,
    cueR: 1.125 * INCH,
    cornerMouth: 4.625 * INCH,
    sideMouth: 5.125 * INCH,
    balls: 'numbered',
    cornerFacingDeg: 142,
    sideFacingDeg: 104,
  },
  // Blackball 7ft: ~72" x 36", 2" object balls, 1⅞" cue ball. Corner mouth ~1.6 ball widths;
  // the side mouth is an estimate.
  uk: {
    id: 'uk',
    name: 'UK blackball',
    short: 'UK',
    length: 72 * INCH,
    width: 36 * INCH,
    objectR: 1 * INCH,
    cueR: 0.9375 * INCH,
    cornerMouth: 3.2 * INCH,
    sideMouth: 3.5 * INCH,
    balls: 'redsYellows',
    cornerFacingDeg: 135,
    sideFacingDeg: 90,
  },
  // Chinese 8-ball (heyball): 100" x 50", 2¼" balls, snooker-style corners ~85mm.
  // The side mouth is an estimate.
  cn: {
    id: 'cn',
    name: 'Chinese 8-ball',
    short: 'Chinese',
    length: 100 * INCH,
    width: 50 * INCH,
    objectR: 1.125 * INCH,
    cueR: 1.125 * INCH,
    cornerMouth: 0.085,
    sideMouth: 0.095,
    balls: 'numbered',
    cornerFacingDeg: 135,
    sideFacingDeg: 90,
  },
};

export const FORMAT_IDS = Object.keys(FORMATS) as FormatId[];
export const DEFAULT_FORMAT: FormatId = 'us9';
export const isFormatId = (s: unknown): s is FormatId => typeof s === 'string' && s in FORMATS;
