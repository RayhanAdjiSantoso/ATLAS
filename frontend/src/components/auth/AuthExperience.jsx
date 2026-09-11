import { BarChart3, Database, FileCheck2, Layers3, ShieldCheck, Sparkles } from 'lucide-react';
import atlasWordmark from '../../assets/atlas-wordmark.png';
import { MilMark } from '../../reportGenerator/components/MilMark';

const WORKFLOW = [
  { label: 'Data terpusat', detail: 'Satu sumber untuk setiap brand', Icon: Database },
  { label: 'Analisis menyeluruh', detail: 'Kinerja bisnis lintas kanal', Icon: BarChart3 },
  { label: 'Laporan siap pakai', detail: 'Insight untuk dibawa ke klien', Icon: FileCheck2 },
];

export default function AuthExperience({ children, mode = 'login' }) {
  return (
    <div className="mil-ui">
      <div className="auth-experience">
        <div className="auth-orb auth-orb-one" aria-hidden />
        <div className="auth-orb auth-orb-two" aria-hidden />

        <main className="auth-frame">
          <section className="auth-entry" aria-label={mode === 'register' ? 'Daftar akun ATLAS' : 'Masuk ke ATLAS'}>
            <div className="auth-entry-top">
              <img className="auth-wordmark" src={atlasWordmark} alt="ATLAS · MIL Digital" />
              <span className="auth-access-badge">
                <ShieldCheck size={14} aria-hidden />
                Ruang kerja terlindungi
              </span>
            </div>

            <div className="auth-entry-body">{children}</div>

            <p className="auth-entry-note">Akses terpusat untuk seluruh workspace dan data brand Anda.</p>
          </section>

          <aside className="auth-story" aria-label="Alur kerja ATLAS">
            <MilMark className="auth-story-mark" />
            <span className="auth-story-ring auth-story-ring-one" aria-hidden />
            <span className="auth-story-ring auth-story-ring-two" aria-hidden />

            <div className="auth-story-top">
              <span className="auth-story-status"><i aria-hidden />Sistem intelijen MIL Digital</span>
              <Sparkles size={19} aria-hidden />
            </div>

            <div className="auth-story-copy">
              <h2>Dari data mentah ke keputusan yang siap dibawa ke klien.</h2>
              <p>ATLAS menyatukan pengelolaan brand, pembacaan performa, dan pembuatan laporan dalam satu alur kerja.</p>
            </div>

            <ol className="auth-workflow">
              {WORKFLOW.map(({ label, detail, Icon }, index) => (
                <li key={label} style={{ animationDelay: `${0.35 + index * 0.09}s` }}>
                  <span className="auth-workflow-index">0{index + 1}</span>
                  <span className="auth-workflow-icon" aria-hidden><Icon /></span>
                  <span><strong>{label}</strong><small>{detail}</small></span>
                </li>
              ))}
            </ol>

            <div className="auth-story-footer">
              <span><Layers3 size={16} aria-hidden /> Satu workspace</span>
              <span>Analisis bisnis · Pelaporan · Automasi</span>
            </div>
          </aside>
        </main>
      </div>
    </div>
  );
}
