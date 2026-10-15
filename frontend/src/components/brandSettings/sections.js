import { Activity, FolderOpen, NotebookPen } from 'lucide-react';

// Brand Setting's two sections — how a brand is set up in ATLAS: its context,
// direction and annual target, and its files and ad accounts. One list so
// the sidebar entry, the page's section bar and the masthead copy can never
// disagree. URLs predate the grouping and are linked from all over ATLAS, so
// they stay as they are.
//
// Brand Tracking (the brand's daily figures, targets and meetings) is its
// own sidebar page: BRAND_TRACKING below.
export const BRAND_SETTING_SECTIONS = [
  {
    to: '/pengaturan-brand',
    label: 'Setup Context & Brand Direction',
    hint: 'Status, context & direction',
    Icon: NotebookPen,
    module: 'brand_settings',
    desc: 'Daftar klien MIL Digital: atur status setiap brand, lalu lengkapi brand context dan current direction yang dibaca seluruh analisis ATLAS.',
  },
  {
    to: '/data-brand',
    label: 'Data Collection Hub',
    hint: 'File & akun iklan',
    Icon: FolderOpen,
    module: 'brand_settings',
    desc: 'File bulanan dan akun iklan setiap brand — sumber yang dibaca Business Overview dan Report Generator.',
  },
];

export const BRAND_TRACKING = {
  to: '/brand-tracking',
  label: 'Brand Tracking',
  hint: 'Harian, target & meeting',
  Icon: Activity,
  module: 'daily_tracking',
  desc: 'Revenue per channel dan belanja iklan setiap hari, target bulanan dan tahunan, serta catatan meeting — sumber angka Executive Snapshot dan laporan bulanan.',
};
