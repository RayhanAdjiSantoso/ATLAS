// Portals (modals, floating dropdowns) used to render straight into
// document.body — correct when this app owned the whole document. Now that
// it's one page inside ATLAS, index.css scopes every rule under
// .report-generator-app, which never matches an element portaled to <body>
// (a sibling of that wrapper, not a descendant) — the portal would render
// completely unstyled. Portaling into this wrapper instead keeps the
// escape-clipping-ancestors behavior portals are used for here (there's no
// overflow:hidden or transform on .report-generator-app or its ATLAS
// ancestors, so position:fixed children still measure against the viewport
// exactly as they did against document.body).
export function getPortalContainer(): Element {
  return document.querySelector('.report-generator-app') ?? document.body;
}
