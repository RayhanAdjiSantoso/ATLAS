// Shared types used across the parsing/calculation modules.
// A parsed sheet row: SheetJS's sheet_to_json({defval}) always returns
// plain objects keyed by header name, with mixed string/number cell values.
export type SheetRow = Record<string, unknown>;

export type Sentiment = 'higher-better' | 'lower-better' | 'neutral';
export type DeltaClassName = 'delta-good' | 'delta-bad' | 'delta-neutral';

export interface DeltaResult {
  deltaNum: number | null;
  deltaStr: string;
}
