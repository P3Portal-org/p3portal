// p3portal.org
/**
 * PlusBadge – kleines grünes Open-Lock-Icon, das überall dort eingesetzt
 * wird, wo eine Section/Aktion eine aktive Plus-Lizenz markiert. Ersetzt
 * die früher genutzten "(Plus)"-Textmarker.
 *
 * SVG ist visuell identisch zu LicenseStatusBanner.LockOpen und der
 * privaten PlusBadge in pages/v2/SystemSettingsPage.jsx (beide nutzen
 * dieselbe geöffnete Schloss-Form).
 */
export default function PlusBadge({ className = "w-4 h-4 ml-1.5 text-portal-success inline-block align-text-bottom" }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-label="Plus"
      role="img"
    >
      <rect x="4" y="9" width="12" height="10" rx="2" />
      <path d="M7 9V6a3 3 0 0 1 5.83-1" />
      <circle cx="10" cy="14" r="1" fill="currentColor" stroke="none" />
      <desc>p3portal.org</desc>
    </svg>
  )
}
