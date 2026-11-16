// viewModel.js — from (ontology + what the user chose to show) to the nodes/edges that get drawn.

import { isLiteral } from './rdf.js';

export const DEFAULT_OPTS = {
    edgeKinds: {
        subClassOf: true, objectProperty: true, restriction: true,
        type: true, assertion: true, equivalent: true, disjoint: false,
    },
    attributes: true,         // datatype properties as rows inside class boxes
    individualValues: true,   // data assertions as rows inside individual boxes
    typeDisplay: 'edge',      // 'edge' | 'inline' | 'both' — how an individual shows its class
    edgeLabels: true,
    subClassLabel: '',        // text drawn on subclass-of arrows ('' = none)
    typeLabel: '',            // text drawn on instance-of arrows ('' = none)
    labelMode: 'label',       // 'label' | 'local' | 'qname'
    hideIsolated: false,
    autoIncludeTypes: true,   // showing an individual also shows its class(es)
    maxValueLength: 36,
    annotations: 'badge',     // 'none' | 'badge' (presence marker + tooltip) | 'rows' (inside the box) | 'note' (UML note)
    annotationLang: '',       // '' = every language; otherwise this language + untagged literals
    annotationMaxLength: 200, // 0 = full text
};

/** Prefix of note node ids; a note belongs to the entity whose IRI follows the prefix. */
export const NOTE_PREFIX = 'note:';

const truncate = (s, n) => (n && s.length > n ? s.slice(0, n - 1) + '…' : s);

function restrictionLabel(ont, e) {
    const p = ont.nameOf(e.prop);
    switch (e.restriction) {
        case 'some': return `${p} some`;
        case 'only': return `${p} only`;
        case 'min': return `${p} ≥ ${e.n}`;
        case 'max': return `${p} ≤ ${e.n}`;
        case 'exactly': return `${p} = ${e.n}`;
        default: return p;
    }
}

/**
 * Annotations of an entity that the user wants to see, as display rows {kind, prop, sep, value}.
 * @returns {{kind:'annotation', prop:string, sep:string, value:string}[]}
 */
export function annotationRows(ont, ent, sel, opts, { truncateTo = opts.annotationMaxLength } = {}) {
    const lang = opts.annotationLang;
    const out = [];
    for (const a of ent.annotations ?? []) {
        if (sel.disabledProps.has(a.prop)) continue;
        let value;
        if (isLiteral(a.value)) {
            const l = (a.value.lang || '').toLowerCase();
            if (lang && l && l !== lang && !l.startsWith(lang + '-')) continue;
            value = a.value.value.trim().replace(/\s+/g, ' ');
            if (l && !lang) value += ` @${l}`;
        } else {
            value = ont.entity(a.value) ? ont.nameOf(a.value) : a.value;
        }
        out.push({ kind: 'annotation', prop: ont.annotationName(a.prop), sep: ': ', value: truncate(value, truncateTo) });
    }
    return out;
}

/**
 * @param {Ontology} ont
 * @param {{visible:Set<string>, disabledProps:Set<string>}} sel
 * @param {typeof DEFAULT_OPTS} opts
 */
export function buildGraph(ont, sel, opts) {
    ont.labelMode = opts.labelMode;
    const nodes = [];
    const ids = new Set();
    const notes = [];

    for (const iri of sel.visible) {
        const cls = ont.classes.get(iri);
        const ind = cls ? null : ont.individuals.get(iri);
        if (!cls && !ind) continue;

        const node = { id: iri, kind: cls ? 'class' : 'individual', title: ont.nameOf(iri), subtitle: '', rows: [], notes: [] };
        if (cls) {
            if (opts.attributes) {
                for (const a of cls.attributes) {
                    if (sel.disabledProps.has(a.prop)) continue;
                    node.rows.push({ kind: 'data', prop: ont.nameOf(a.prop), sep: a.range ? ' : ' : '', value: a.range || '' });
                }
            }
            if (cls.deprecated) node.deprecated = true;
        } else {
            if (opts.typeDisplay !== 'edge' && ind.types.length) {
                node.subtitle = ': ' + ind.types.map((t) => ont.nameOf(t)).join(', ');
            }
            if (opts.individualValues) {
                for (const a of ind.dataAssertions) {
                    if (sel.disabledProps.has(a.prop)) continue;
                    node.rows.push({ kind: 'data', prop: ont.nameOf(a.prop), sep: ' = ', value: truncate(a.value.value, opts.maxValueLength) });
                }
            }
        }

        if (opts.annotations !== 'none') {
            const ann = annotationRows(ont, cls ?? ind, sel, opts);
            if (ann.length) {
                if (opts.annotations === 'rows') node.notes = ann;
                else if (opts.annotations === 'note') {
                    notes.push({ id: NOTE_PREFIX + iri, kind: 'note', owner: iri, title: '', subtitle: '', rows: [], notes: ann });
                } else {
                    node.badge = ann.length;
                    node.tooltip = annotationRows(ont, cls ?? ind, sel, opts, { truncateTo: 600 })
                        .map((r) => r.prop + r.sep + r.value).join('\n');
                }
            }
        }
        nodes.push(node);
        ids.add(iri);
    }

    let edges = [];
    for (const e of ont.edges) {
        if (!opts.edgeKinds[e.kind]) continue;
        if (e.kind === 'type' && opts.typeDisplay === 'inline') continue;
        if (!ids.has(e.source) || !ids.has(e.target)) continue;
        if (e.prop && sel.disabledProps.has(e.prop)) continue;

        let label = '';
        if (e.kind === 'objectProperty' || e.kind === 'assertion') label = ont.nameOf(e.prop);
        else if (e.kind === 'restriction') label = restrictionLabel(ont, e);
        else if (e.kind === 'disjoint') label = 'disjoint';
        else if (e.kind === 'equivalent') label = '≡';
        else if (e.kind === 'subClassOf') label = opts.subClassLabel ?? '';
        else if (e.kind === 'type') label = opts.typeLabel ?? '';
        edges.push({ id: e.id, kind: e.kind, source: e.source, target: e.target, prop: e.prop ?? null, label: opts.edgeLabels ? label.trim() : '' });
    }

    let outNodes = nodes;
    if (opts.hideIsolated) {
        const connected = new Set();
        for (const e of edges) { connected.add(e.source); connected.add(e.target); }
        outNodes = nodes.filter((n) => connected.has(n.id));
    }
    // Notes are attached after the isolation filter so that a lone annotated node does not count as connected.
    const kept = new Set(outNodes.map((n) => n.id));
    for (const n of notes) {
        if (!kept.has(n.owner)) continue;
        outNodes.push(n);
        edges.push({ id: `note|${n.owner}`, kind: 'note', source: n.owner, target: n.id, prop: null, label: '' });
    }
    return { nodes: outNodes, edges };
}
