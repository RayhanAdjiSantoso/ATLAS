interface InlineNoticeProps {
  title: string;
  children?: React.ReactNode;
  tone?: 'error' | 'info';
}

// Replaces window.alert() for validation/empty/error feedback — stays put
// in context (next to the dropzone/field it's about) instead of blocking
// the page, so the guidance is still visible while the user fixes it.
export function InlineNotice({ title, children, tone = 'error' }: InlineNoticeProps) {
  return (
    <div className={`inline-notice ${tone}`} role="alert">
      <span className="inline-notice-icon" aria-hidden="true">
        {tone === 'error' ? '⚠' : 'ℹ'}
      </span>
      <div>
        <div className="inline-notice-title">{title}</div>
        {children}
      </div>
    </div>
  );
}
