interface OmzetFieldProps {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
}

// Ported from the original formatOmzetInput/parseOmzetInput: the field
// reformats to a thousands-separated "Rp" display as the user types, and
// gains the "filled" style once it holds a value.
export function OmzetField({ label, value, onChange }: OmzetFieldProps) {
  return (
    <div className={`omzet-field${value !== null ? ' filled' : ''}`}>
      <label>{label}</label>
      <div className="omzet-input-wrap">
        <span className="omzet-prefix">Rp</span>
        <input
          className="omzet-input"
          type="text"
          placeholder="0"
          value={value !== null ? value.toLocaleString('id-ID') : ''}
          onChange={(e) => {
            const digits = e.target.value.replace(/[^\d]/g, '');
            onChange(digits ? parseInt(digits, 10) : null);
          }}
        />
      </div>
    </div>
  );
}
