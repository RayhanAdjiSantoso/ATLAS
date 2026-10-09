import { Activity, FolderOpen, NotebookPen } from 'lucide-react';

// Brand Setting's three sections — everything a brand puts INTO ATLAS. One
// list so the sidebar entry, the page's section bar and the masthead copy
// can never disagree. URLs predate the grouping and are linked from all over
// ATLAS, so they stay as they are.
export const BRAND_SETTING_SECTIONS = [
  {
    to: '/pengaturan-brand',
    label: 'Brand Context',
    hint: 'Status, context & direction',
    Icon: NotebookPen,
    module: 'brand_settings',
    desc: 'Daftar klien MIL Digital: atur status setiap brand, lalu lengkapi brand context dan current direction yang dibaca seluruh analisis ATLAS.',
  },
  {
    to: '/data-brand',
    label: 'Data Collection Hub',
    hint: 'File, meeting & akun iklan',
    Icon: FolderOpen,
    module: 'brand_settings',
    desc: 'File bulanan, catatan meeting, dan akun iklan setiap brand — sumber yang dibaca Business Overview dan Report Generator.',
  },
  {
    to: '/brand-tracking',
    label: 'Brand Tracking',
    hint: 'Revenue & spend harian',
    Icon: Activity,
    module: 'daily_tracking',
    desc: 'Revenue per channel dan belanja iklan setiap hari — sumber angka Executive Snapshot dan laporan bulanan.',
  },
];
