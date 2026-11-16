// style.js — themes, fonts and edge vocabulary shared by the renderer and the UI.

export const FONTS = {
    sans: { label: 'Sans-serif', css: "Helvetica Neue, Helvetica, Arial, sans-serif" },
    serif: { label: 'Serif (papers)', css: "Georgia, 'Times New Roman', Times, serif" },
    mono: { label: 'Monospace', css: "ui-monospace, Menlo, Consolas, 'Courier New', monospace" },
};

export const EDGE_KINDS = {
    subClassOf: 'Subclass of',
    objectProperty: 'Object property',
    restriction: 'Restriction (some / only / …)',
    type: 'Instance of',
    assertion: 'Property assertion',
    equivalent: 'Equivalent class',
    disjoint: 'Disjoint with',
};

/** stroke-dasharray per edge kind (kept distinct so grayscale prints stay readable). */
/** stroke-dasharray per edge kind (kept distinct so grayscale prints stay readable). */
export const EDGE_DASH = {
    subClassOf: '',
    objectProperty: '',
    restriction: '6 3',
    type: '2 3',
    assertion: '',
    equivalent: '8 3 2 3',
    disjoint: '2 2',
    note: '3 3',
};

/** Arrow head per edge kind: hollow triangle (UML generalisation), filled, open, or none. */
export const EDGE_MARKER = {
    subClassOf: 'hollow',
    objectProperty: 'filled',
    restriction: 'filled',
    type: 'open',
    assertion: 'filled',
    equivalent: null,
    disjoint: null,
    note: null,
};

// Colours follow Protégé's conventions: classes amber/yellow, object properties blue,
// datatype properties green, individuals purple, annotations neutral grey.
//   objectProp / dataProp / annotationProp are the "entity" colours, used for property names
//   (edge labels and rows inside boxes), the legend and the UI lists.
export const THEMES = {
    paper: {
        label: 'Paper (print-friendly)',
        bg: '#ffffff', text: '#111827', muted: '#4b5563',
        classFill: '#fdf1d6', classStroke: '#b45309', classText: '#1c1917',
        indFill: '#f3e8ff', indStroke: '#6b21a8', indText: '#3b0764',
        objectProp: '#1d4ed8', dataProp: '#15803d', annotationProp: '#475569',
        noteFill: '#f8fafc', noteStroke: '#64748b', noteText: '#334155',
        edges: { subClassOf: '#1f2937', objectProperty: '#1d4ed8', restriction: '#4338ca', type: '#6b21a8', assertion: '#1d4ed8', equivalent: '#be185d', disjoint: '#b91c1c', note: '#64748b' },
    },
    vivid: {
        label: 'Vivid (slides & demos)',
        bg: '#ffffff', text: '#1e293b', muted: '#64748b',
        classFill: '#fcd34d', classStroke: '#d97706', classText: '#422006',
        indFill: '#d8b4fe', indStroke: '#9333ea', indText: '#3b0764',
        objectProp: '#2563eb', dataProp: '#166534', annotationProp: '#334155',
        noteFill: '#f1f5f9', noteStroke: '#64748b', noteText: '#1e293b',
        edges: { subClassOf: '#475569', objectProperty: '#2563eb', restriction: '#4f46e5', type: '#9333ea', assertion: '#2563eb', equivalent: '#db2777', disjoint: '#dc2626', note: '#94a3b8' },
    },
    mono: {
        label: 'Black & white',
        bg: '#ffffff', text: '#000000', muted: '#404040',
        classFill: '#ffffff', classStroke: '#000000', classText: '#000000',
        indFill: '#ececec', indStroke: '#000000', indText: '#000000',
        objectProp: '#000000', dataProp: '#000000', annotationProp: '#404040',
        noteFill: '#ffffff', noteStroke: '#404040', noteText: '#000000',
        edges: { subClassOf: '#000000', objectProperty: '#000000', restriction: '#000000', type: '#000000', assertion: '#000000', equivalent: '#000000', disjoint: '#000000', note: '#404040' },
    },
    dark: {
        label: 'Dark',
        bg: '#0f172a', text: '#e2e8f0', muted: '#94a3b8',
        classFill: '#5b3a0b', classStroke: '#fbbf24', classText: '#fef3c7',
        indFill: '#581c87', indStroke: '#d8b4fe', indText: '#f3e8ff',
        objectProp: '#93c5fd', dataProp: '#86efac', annotationProp: '#cbd5e1',
        noteFill: '#1e293b', noteStroke: '#94a3b8', noteText: '#e2e8f0',
        edges: { subClassOf: '#cbd5e1', objectProperty: '#60a5fa', restriction: '#a5b4fc', type: '#c084fc', assertion: '#60a5fa', equivalent: '#f472b6', disjoint: '#f87171', note: '#94a3b8' },
    },
};

export const DEFAULT_STYLE = {
    theme: 'paper',
    font: 'sans',
    fontSize: 13,
    lineWidth: 1.5,
    edgeStyle: 'curved', // 'curved' | 'straight'
    colors: {}, // user overrides of theme colours (bg, classFill, classStroke, indFill, indStroke, objectProp, dataProp, …)
};

export function resolveColors(style) {
    const theme = THEMES[style.theme] ?? THEMES.paper;
    const c = { ...theme, ...style.colors };
    // Property edges follow the (possibly overridden) property colours.
    c.edges = { ...theme.edges };
    if (style.colors?.objectProp) c.edges.objectProperty = c.edges.assertion = style.colors.objectProp;
    return c;
}
