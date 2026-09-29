// viewModel.js — from (ontology + what the user chose to show) to the nodes/edges that get drawn.

export const DEFAULT_OPTS = {
    edgeKinds: {
        subClassOf: true, objectProperty: true, restriction: true,
        type: true, assertion: true, equivalent: true, disjoint: false,
    },
    attributes: true,         // datatype properties as rows inside class boxes
    individualValues: true,   // data assertions as rows inside individual boxes
    typeDisplay: 'edge',      // 'edge' | 'inline' | 'both' — how an individual shows its class
    edgeLabels: true,
    labelMode: 'label',       // 'label' | 'local' | 'qname'
    hideIsolated: false,
    autoIncludeTypes: true,   // showing an individual also shows its class(es)
    maxValueLength: 36,
};

const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

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
 * @param {Ontology} ont
 * @param {{visible:Set<string>, disabledProps:Set<string>}} sel
 * @param {typeof DEFAULT_OPTS} opts
 */
export function buildGraph(ont, sel, opts) {
    ont.labelMode = opts.labelMode;
    const nodes = [];
    const ids = new Set();

    for (const iri of sel.visible) {
        const cls = ont.classes.get(iri);
        const ind = cls ? null : ont.individuals.get(iri);
        if (!cls && !ind) continue;

        const node = { id: iri, kind: cls ? 'class' : 'individual', title: ont.nameOf(iri), subtitle: '', rows: [] };
        if (cls) {
            if (opts.attributes) {
                for (const a of cls.attributes) {
                    if (sel.disabledProps.has(a.prop)) continue;
                    node.rows.push(a.range ? `${ont.nameOf(a.prop)} : ${a.range}` : ont.nameOf(a.prop));
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
                    node.rows.push(`${ont.nameOf(a.prop)} = ${truncate(a.value.value, opts.maxValueLength)}`);
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
        edges.push({ id: e.id, kind: e.kind, source: e.source, target: e.target, prop: e.prop ?? null, label: opts.edgeLabels ? label : '' });
    }

    let outNodes = nodes;
    if (opts.hideIsolated) {
        const connected = new Set();
        for (const e of edges) { connected.add(e.source); connected.add(e.target); }
        outNodes = nodes.filter((n) => connected.has(n.id));
    }
    return { nodes: outNodes, edges };
}
