interface PeriodInputRowProps {
  colorClass: 'shopee-period' | 'tiktok-period';
  oldValue: string;
  curValue: string;
  onOldChange: (v: string) => void;
  onCurChange: (v: string) => void;
  oldPlaceholder: string;
  curPlaceholder: string;
}

export function PeriodInputRow({ colorClass, oldValue, curValue, onOldChange, onCurChange, oldPlaceholder, curPlaceholder }: PeriodInputRowProps) {
  return (
    <div className="period-input-row">
      <div className={`period-input-field ${colorClass}`}>
        <label>Label Periode Lalu</label>
        <input className="period-text-input" type="text" placeholder={oldPlaceholder} value={oldValue} onChange={(e) => onOldChange(e.target.value)} />
      </div>
      <div className={`period-input-field ${colorClass}`}>
        <label>Label Periode Ini</label>
        <input className="period-text-input" type="text" placeholder={curPlaceholder} value={curValue} onChange={(e) => onCurChange(e.target.value)} />
      </div>
    </div>
  );
}
