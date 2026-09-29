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
export const EDGE_DASH = {
    subClassOf: '',
    objectProperty: '',
    restriction: '6 3',
    type: '2 3',
    assertion: '',
    equivalent: '8 3 2 3',
    disjoint: '2 2',
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
};

export const THEMES = {
    paper: {
        label: 'Paper (print-friendly)',
        bg: '#ffffff', text: '#111827', muted: '#4b5563',
        classFill: '#e0ecff', classStroke: '#1e3a8a', classText: '#0f172a',
        indFill: '#f3e8ff', indStroke: '#6b21a8', indText: '#3b0764',
        edges: { subClassOf: '#1f2937', objectProperty: '#1d4ed8', restriction: '#047857', type: '#6b21a8', assertion: '#6b21a8', equivalent: '#b45309', disjoint: '#b91c1c' },
    },
    vivid: {
        label: 'Vivid (slides & demos)',
        bg: '#ffffff', text: '#1e293b', muted: '#64748b',
        classFill: '#3b82f6', classStroke: '#1d4ed8', classText: '#ffffff',
        indFill: '#a855f7', indStroke: '#7e22ce', indText: '#ffffff',
        edges: { subClassOf: '#64748b', objectProperty: '#2563eb', restriction: '#059669', type: '#a855f7', assertion: '#9333ea', equivalent: '#d97706', disjoint: '#dc2626' },
    },
    mono: {
        label: 'Black & white',
        bg: '#ffffff', text: '#000000', muted: '#404040',
        classFill: '#ffffff', classStroke: '#000000', classText: '#000000',
        indFill: '#ececec', indStroke: '#000000', indText: '#000000',
        edges: { subClassOf: '#000000', objectProperty: '#000000', restriction: '#000000', type: '#000000', assertion: '#000000', equivalent: '#000000', disjoint: '#000000' },
    },
    dark: {
        label: 'Dark',
        bg: '#0f172a', text: '#e2e8f0', muted: '#94a3b8',
        classFill: '#1e3a8a', classStroke: '#93c5fd', classText: '#e0f2fe',
        indFill: '#581c87', indStroke: '#d8b4fe', indText: '#f3e8ff',
        edges: { subClassOf: '#94a3b8', objectProperty: '#60a5fa', restriction: '#34d399', type: '#c084fc', assertion: '#c084fc', equivalent: '#fbbf24', disjoint: '#f87171' },
    },
};

export const DEFAULT_STYLE = {
    theme: 'paper',
    font: 'sans',
    fontSize: 13,
    lineWidth: 1.5,
    edgeStyle: 'curved', // 'curved' | 'straight'
    colors: {}, // user overrides of theme colours (bg, classFill, classStroke, indFill, indStroke)
};

export function resolveColors(style) {
    const theme = THEMES[style.theme] ?? THEMES.paper;
    return { ...theme, ...style.colors, edges: theme.edges };
}
