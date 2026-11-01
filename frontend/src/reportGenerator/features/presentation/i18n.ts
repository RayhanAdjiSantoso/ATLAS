import type { Lang, NarrativeField, Text2 } from './types';

// The words on a slide that are not data. The builder's own screens stay in
// Indonesian like the rest of Report Generator; these follow the report's language.
const CHROME = {
  monthlyOverview: { id: 'Monthly Overview', en: 'Monthly Overview' },
  agenda: { id: 'Agenda', en: 'Agenda' },
  metric: { id: 'Metrik', en: 'Metrics' },
  changes: { id: 'Perubahan', en: 'Changes' },
  action: { id: 'Tindakan', en: 'Action' },
  owner: { id: 'PIC', en: 'Owner' },
  priority: { id: 'Prioritas', en: 'Priority' },
  target: { id: 'Target', en: 'Target' },
  status: { id: 'Status', en: 'Status' },
  top: { id: 'Performa Teratas', en: 'Top Performers' },
  bottom: { id: 'Performa Terbawah', en: 'Bottom Performers' },
  spend: { id: 'Spend', en: 'Spend' },
  dataNotAvailable: { id: 'Data not available', en: 'Data not available' },
  noData: { id: 'Data untuk bagian ini belum tersedia di ATLAS.', en: 'Data for this part is not available in ATLAS yet.' },
  supportingBadge: { id: 'Data pendukung', en: 'Supporting data' },
  sourcePrefix: { id: 'Sumber', en: 'Source' },
  atlasSource: { id: 'Sumber: ATLAS', en: 'Source: ATLAS' },
  thanks: { id: 'Terima Kasih', en: 'Thank You' },
  continued: { id: 'lanjutan', en: 'continued' },
  high: { id: 'Tinggi', en: 'High' },
  medium: { id: 'Sedang', en: 'Medium' },
  low: { id: 'Rendah', en: 'Low' },
} satisfies Record<string, Text2>;

export type ChromeKey = keyof typeof CHROME;

export function chrome(key: ChromeKey, lang: Lang): string {
  return CHROME[key][lang];
}

export const FIELD_TITLE: Record<NarrativeField, Text2> = {
  takeaways: { id: 'Key Takeaways', en: 'Key Takeaways' },
  findings: { id: 'Findings', en: 'Findings' },
  insights: { id: 'Insights', en: 'Insights' },
  wins: { id: 'Win & Success Stories', en: 'Win & Success Stories' },
  risks: { id: 'Risk & Challenges', en: 'Risk & Challenges' },
};
