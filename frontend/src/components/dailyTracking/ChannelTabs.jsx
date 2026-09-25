import { Plus } from 'lucide-react';

// Visual pattern adapted from reportGenerator's SlotSourceTabs.tsx
// (role="tablist" of buttons with a single active pill) — generalized from
// two fixed buttons to N channels plus a trailing "+ Tambah Channel Baru".
// One shared component for both the Revenue and Spend sections rather than
// two near-duplicate files, since the two only differ in which channel list
// and callbacks they're given.
export default function ChannelTabs({ channels, activeKey, onSelect, onAddChannel }) {
  return (
    <div className="dt-tabs" role="tablist">
      {channels.map((c) => (
        <button
          key={c.key}
          type="button"
          role="tab"
          aria-selected={c.key === activeKey}
          className={`dt-tab${c.key === activeKey ? ' is-active' : ''}`}
          onClick={() => onSelect(c.key)}
        >
          {c.label}
        </button>
      ))}
      {onAddChannel && (
        <button type="button" className="dt-tab dt-tab-add" onClick={onAddChannel}>
          <Plus size={14} /> Tambah Channel Baru
        </button>
      )}
    </div>
  );
}
