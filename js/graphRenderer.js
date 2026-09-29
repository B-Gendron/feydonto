// graphRenderer.js — draws the selected sub-graph as a clean SVG, lays it out with ELK,
// and can export it as a standalone SVG / PNG.
//
// Everything visual is set through SVG *attributes* (no external CSS), so an exported
// SVG looks identical when opened in Inkscape, Illustrator, LaTeX, PowerPoint, …

import { FONTS, EDGE_KINDS, EDGE_DASH, EDGE_MARKER, DEFAULT_STYLE, resolveColors } from './style.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const PAD_X = 12;
const PAD_Y = 8;

const svgEl = (name, attrs = {}) => {
    const el = document.createElementNS(SVGNS, name);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
};

export class GraphRenderer {
    constructor(svgId) {
        this.svg = d3.select(`#${svgId}`);
        this.style = { ...DEFAULT_STYLE };
        this.colors = resolveColors(this.style);
        this.handlers = {};
        this.nodes = [];
        this.edges = [];
        this.nodeById = new Map();
        this.edgesOfNode = new Map();
        this.positions = new Map(); // id -> {x, y}; survives across setGraph calls
        this.selectedId = null;
        this._measureCtx = document.createElement('canvas').getContext('2d');

        this.defs = this.svg.append('defs');
        this.bgRect = this.svg.append('rect').attr('class', 'bg').attr('width', '100%').attr('height', '100%').attr('fill', 'transparent');
        this.gRoot = this.svg.append('g').attr('class', 'root');
        this.gEdges = this.gRoot.append('g').attr('class', 'edges');
        this.gLabels = this.gRoot.append('g').attr('class', 'edge-labels');
        this.gNodes = this.gRoot.append('g').attr('class', 'nodes');

        this.zoom = d3.zoom()
            .scaleExtent([0.05, 8])
            .on('zoom', (event) => this.gRoot.attr('transform', event.transform));
        this.svg.call(this.zoom).on('dblclick.zoom', null);
        this.svg.on('click', (event) => {
            if (event.target === this.svg.node() || event.target === this.bgRect.node()) this.handlers.background?.();
        });
        this.svg.on('contextmenu', (event) => {
            if (event.target === this.svg.node() || event.target === this.bgRect.node()) {
                event.preventDefault();
                this.handlers.background?.();
            }
        });
        this.buildMarkers();
    }

    on(name, fn) { this.handlers[name] = fn; return this; }

    // ------------------------------------------------------------------ style

    setStyle(style) {
        this.style = { ...DEFAULT_STYLE, ...style };
        this.colors = resolveColors(this.style);
        this.buildMarkers();
    }

    get fontFamily() { return FONTS[this.style.font]?.css ?? FONTS.sans.css; }
    get fs() { return this.style.fontSize; }

    buildMarkers() {
        const defs = this.defs;
        defs.selectAll('*').remove();
        const sw = this.style.lineWidth;
        const size = 10 + sw * 2;
        const bg = this.colors.bg;
        for (const [kind, shape] of Object.entries(EDGE_MARKER)) {
            if (!shape) continue;
            const color = this.colors.edges[kind];
            const m = defs.append('marker')
                .attr('id', `fy-arrow-${kind}`)
                .attr('viewBox', '0 0 12 12').attr('refX', 11).attr('refY', 6)
                .attr('markerWidth', size).attr('markerHeight', size)
                .attr('markerUnits', 'userSpaceOnUse').attr('orient', 'auto');
            if (shape === 'hollow') {
                m.append('path').attr('d', 'M1,1L11,6L1,11Z').attr('fill', bg).attr('stroke', color).attr('stroke-width', 1.3).attr('stroke-linejoin', 'round');
            } else if (shape === 'filled') {
                m.append('path').attr('d', 'M0.5,1L11,6L0.5,11Z').attr('fill', color).attr('stroke', color).attr('stroke-width', 0.6).attr('stroke-linejoin', 'round');
            } else {
                m.append('path').attr('d', 'M1,1.5L10.5,6L1,10.5').attr('fill', 'none').attr('stroke', color).attr('stroke-width', 1.5).attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round');
            }
        }
    }

    // ---------------------------------------------------------------- measure

    measure(text, size, weight = 400, italic = false) {
        this._measureCtx.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${this.fontFamily}`;
        return this._measureCtx.measureText(text).width;
    }

    sizeNode(n) {
        const fs = this.fs;
        const rowFs = fs * 0.88;
        const lineH = fs * 1.4;
        const rowH = rowFs * 1.4;
        let w = this.measure(n.title, fs, n.kind === 'class' ? 600 : 500);
        let h = PAD_Y * 2 + lineH;
        if (n.subtitle) {
            w = Math.max(w, this.measure(n.subtitle, rowFs, 400, true));
            h += rowH * 0.9;
        }
        if (n.rows.length) {
            for (const r of n.rows) w = Math.max(w, this.measure(r, rowFs));
            h += n.rows.length * rowH + 6;
        }
        n.w = Math.max(72, Math.ceil(w + PAD_X * 2));
        n.h = Math.ceil(h);
        n._lineH = lineH;
        n._rowH = rowH;
        n._rowFs = rowFs;
    }

    // ----------------------------------------------------------------- layout

    /**
     * @param {{nodes, edges}} graph
     * @param {{algorithm, direction, spacing, keepPositions}} layout
     */
    async setGraph(graph, layout) {
        const ticket = (this._ticket = (this._ticket ?? 0) + 1);
        const nodes = graph.nodes.map((n) => ({ ...n }));
        const edges = graph.edges.map((e) => ({ ...e }));
        nodes.forEach((n) => this.sizeNode(n));

        // Cosmetic-only changes (colours, line width…) keep every position: no need to run ELK again.
        const keep = layout.keepPositions;
        const missing = nodes.some((n) => !this.positions.has(n.id));
        const fresh = !keep || missing ? await this.computeLayout(nodes, edges, layout) : new Map();
        if (ticket !== this._ticket) return nodes.length; // a newer call superseded this one

        this.nodes = nodes;
        this.edges = edges;
        const layered = layout.algorithm === 'layered' || layout.algorithm === 'mrtree';
        this.axis = layered ? (layout.direction === 'DOWN' || layout.direction === 'UP' ? 'v' : 'h') : null;
        this.nodeById = new Map(nodes.map((n) => [n.id, n]));
        for (const n of nodes) {
            const kept = keep ? this.positions.get(n.id) : null;
            const p = kept ?? fresh.get(n.id) ?? { x: 0, y: 0 };
            n.x = p.x;
            n.y = p.y;
            this.positions.set(n.id, { x: n.x, y: n.y });
        }
        this.draw();
        return nodes.length;
    }

    async computeLayout(nodes, edges, { algorithm = 'layered', direction = 'DOWN', spacing = 50, layering = 'hierarchy' }) {
        const out = new Map();
        if (!nodes.length) return out;

        const reverse = new Set(['subClassOf', 'type']); // parents above children
        const hierarchical = (k) => reverse.has(k);

        // Layer = taxonomy depth (roots first, individuals below their classes). ELK "partitions" pin
        // that, so property edges only influence ordering inside a layer, not the layering itself.
        const depth = algorithm === 'layered' && layering !== 'flow' ? this.hierarchyDepths(nodes, edges) : null;

        const seenPairs = new Set();
        const elkEdges = [];
        for (const e of edges) {
            if (e.source === e.target) continue;
            if (depth && !hierarchical(e.kind) && depth.get(e.source) === depth.get(e.target)) continue;
            const [s, t] = reverse.has(e.kind) ? [e.target, e.source] : [e.source, e.target];
            const key = `${s}|${t}`;
            if (seenPairs.has(key)) continue;
            seenPairs.add(key);
            elkEdges.push({ id: `e${elkEdges.length}`, sources: [s], targets: [t] });
        }

        if (typeof ELK === 'undefined') return this.fallbackLayout(nodes, elkEdges, spacing);

        const options = {
            'elk.algorithm': algorithm,
            'elk.spacing.nodeNode': String(spacing),
            'elk.separateConnectedComponents': 'true',
            'elk.spacing.componentComponent': String(spacing * 1.5),
            'elk.padding': '[top=20,left=20,bottom=20,right=20]',
        };
        if (algorithm === 'layered') {
            options['elk.direction'] = direction;
            options['elk.layered.spacing.nodeNodeBetweenLayers'] = String(spacing * 1.4);
            options['elk.layered.spacing.edgeNodeBetweenLayers'] = String(spacing * 0.5);
        } else if (algorithm === 'mrtree') {
            options['elk.direction'] = direction;
        } else if (algorithm === 'stress') {
            options['elk.stress.desiredEdgeLength'] = String(spacing * 3.5);
        } else if (algorithm === 'radial') {
            options['elk.radial.radius'] = String(spacing * 2.5);
        }

        if (depth) options['elk.partitioning.activate'] = 'true';

        const elk = new ELK();
        const res = await elk.layout({
            id: 'root',
            layoutOptions: options,
            children: nodes.map((n) => ({
                id: n.id, width: n.w, height: n.h,
                ...(depth ? { layoutOptions: { 'elk.partitioning.partition': String(depth.get(n.id)) } } : {}),
            })),
            edges: elkEdges,
        });
        for (const c of res.children ?? []) out.set(c.id, { x: c.x + c.width / 2, y: c.y + c.height / 2 });
        return out;
    }

    /** Depth of each node in the subclass / instance-of hierarchy (null when there is no hierarchy). */
    hierarchyDepths(nodes, edges) {
        const parents = new Map(nodes.map((n) => [n.id, []]));
        for (const e of edges) if (e.kind === 'subClassOf' || e.kind === 'type') parents.get(e.source)?.push(e.target);
        const memo = new Map();
        const visiting = new Set();
        const depthOf = (id) => {
            if (memo.has(id)) return memo.get(id);
            if (visiting.has(id)) return 0; // cycle
            visiting.add(id);
            let d = 0;
            for (const p of parents.get(id) ?? []) d = Math.max(d, 1 + depthOf(p));
            visiting.delete(id);
            memo.set(id, d);
            return d;
        };
        nodes.forEach((n) => depthOf(n.id));
        return [...memo.values()].some((d) => d > 0) ? memo : null;
    }

    /** Simple force layout used only when ELK could not be loaded. */
    fallbackLayout(inputNodes, elkEdges, spacing) {
        const nodes = inputNodes.map((n) => ({ id: n.id, x: Math.random() * 400, y: Math.random() * 400, r: Math.hypot(n.w, n.h) / 2 }));
        const links = elkEdges.map((e) => ({ source: e.sources[0], target: e.targets[0] }));
        const sim = d3.forceSimulation(nodes)
            .force('link', d3.forceLink(links).id((d) => d.id).distance(spacing * 3))
            .force('charge', d3.forceManyBody().strength(-400))
            .force('collide', d3.forceCollide().radius((d) => d.r + spacing / 2))
            .force('center', d3.forceCenter(0, 0))
            .stop();
        for (let i = 0; i < 300; i++) sim.tick();
        return new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
    }

    // ------------------------------------------------------------------ paint

    draw() {
        this.gEdges.selectAll('*').remove();
        this.gLabels.selectAll('*').remove();
        this.gNodes.selectAll('*').remove();
        const c = this.colors;
        const fs = this.fs;
        const sw = this.style.lineWidth;

        // Parallel-edge bookkeeping
        const groups = new Map();
        for (const e of this.edges) {
            e._src = this.nodeById.get(e.source);
            e._tgt = this.nodeById.get(e.target);
            const key = e.source < e.target ? `${e.source}||${e.target}` : `${e.target}||${e.source}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(e);
        }
        for (const list of groups.values()) list.forEach((e, i) => { e._k = list.length; e._i = i; });

        this.edgesOfNode = new Map(this.nodes.map((n) => [n.id, []]));

        // Edges
        for (const e of this.edges) {
            this.edgesOfNode.get(e.source)?.push(e);
            if (e.target !== e.source) this.edgesOfNode.get(e.target)?.push(e);
            const color = c.edges[e.kind];
            const g = this.gEdges.append('g').attr('class', 'edge');
            e._g = g.node();
            e._path = g.append('path')
                .attr('fill', 'none')
                .attr('stroke', color)
                .attr('stroke-width', sw)
                .attr('stroke-dasharray', EDGE_DASH[e.kind] || null)
                .attr('stroke-linecap', 'round')
                .attr('marker-end', EDGE_MARKER[e.kind] ? `url(#fy-arrow-${e.kind})` : null)
                .node();
            e._hit = g.append('path')
                .attr('class', 'ui-only edge-hit')
                .attr('fill', 'none').attr('stroke', 'transparent').attr('stroke-width', 12)
                .on('click', (event) => { event.stopPropagation(); this.handlers.edgeClick?.(e, event); })
                .node();

            if (e.label) {
                const lg = this.gLabels.append('g').attr('class', 'elabel');
                const lfs = fs * 0.85;
                const tw = this.measure(e.label, lfs, 400, true);
                e._lw = tw + 8;
                e._lh = lfs + 5;
                lg.append('rect').attr('x', -e._lw / 2).attr('y', -e._lh / 2).attr('width', e._lw).attr('height', e._lh)
                    .attr('rx', 3).attr('fill', c.bg).attr('fill-opacity', 0.92);
                lg.append('text').attr('text-anchor', 'middle').attr('dy', '0.34em').attr('font-size', lfs)
                    .attr('font-style', 'italic').attr('fill', color).text(e.label);
                e._label = lg.node();
            }
        }

        // Nodes
        for (const n of this.nodes) {
            const isClass = n.kind === 'class';
            const g = this.gNodes.append('g').attr('class', 'node').attr('data-id', n.id).style('cursor', 'pointer').datum(n);
            n._g = g.node();
            g.append('rect')
                .attr('x', -n.w / 2).attr('y', -n.h / 2).attr('width', n.w).attr('height', n.h)
                .attr('rx', isClass ? 5 : Math.min(n.h / 2, 18))
                .attr('fill', isClass ? c.classFill : c.indFill)
                .attr('stroke', isClass ? c.classStroke : c.indStroke)
                .attr('stroke-width', sw)
                .attr('stroke-dasharray', n.deprecated ? '4 3' : null);
            const textColor = isClass ? c.classText : c.indText;
            let y = -n.h / 2 + PAD_Y + n._lineH / 2;
            g.append('text').attr('x', 0).attr('y', y).attr('dy', '0.34em').attr('text-anchor', 'middle')
                .attr('font-size', this.fs).attr('font-weight', isClass ? 600 : 500).attr('fill', textColor).text(n.title);
            y += n._lineH / 2;
            if (n.subtitle) {
                y += n._rowH * 0.45;
                g.append('text').attr('x', 0).attr('y', y).attr('dy', '0.34em').attr('text-anchor', 'middle')
                    .attr('font-size', n._rowFs).attr('font-style', 'italic').attr('fill', textColor).attr('fill-opacity', 0.85).text(n.subtitle);
                y += n._rowH * 0.45;
            }
            if (n.rows.length) {
                y += 3;
                g.append('line').attr('x1', -n.w / 2).attr('x2', n.w / 2).attr('y1', y).attr('y2', y)
                    .attr('stroke', isClass ? c.classStroke : c.indStroke).attr('stroke-width', sw * 0.6).attr('stroke-opacity', 0.7);
                y += 3;
                for (const row of n.rows) {
                    y += n._rowH / 2;
                    g.append('text').attr('x', -n.w / 2 + PAD_X).attr('y', y).attr('dy', '0.34em')
                        .attr('font-size', n._rowFs).attr('fill', textColor).text(row);
                    y += n._rowH / 2;
                }
            }
            n._ring = g.append('rect').attr('class', 'ui-only')
                .attr('x', -n.w / 2 - 4).attr('y', -n.h / 2 - 4).attr('width', n.w + 8).attr('height', n.h + 8)
                .attr('rx', (isClass ? 5 : Math.min(n.h / 2, 18)) + 3)
                .attr('fill', 'none').attr('stroke', '#f59e0b').attr('stroke-width', 2.5).attr('stroke-dasharray', '5 3')
                .attr('visibility', n.id === this.selectedId ? 'visible' : 'hidden').attr('pointer-events', 'none').node();

            g.on('mouseenter', () => this.highlight(n.id))
                .on('mouseleave', () => this.highlight(null))
                .on('click', (event) => { event.stopPropagation(); this.handlers.nodeClick?.(n, event); })
                .on('dblclick', (event) => { event.stopPropagation(); this.handlers.nodeDblClick?.(n, event); })
                .on('contextmenu', (event) => { event.preventDefault(); event.stopPropagation(); this.handlers.nodeContext?.(n, event); })
                .call(d3.drag()
                    .on('start', () => { this.highlight(null); })
                    .on('drag', (event) => {
                        n.x = event.x;
                        n.y = event.y;
                        this.positions.set(n.id, { x: n.x, y: n.y });
                        this.placeNode(n);
                        this.placeAll();
                    })
                    .on('end', () => this.handlers.moved?.()));
            this.placeNode(n);
        }
        this.placeAll();
    }

    placeNode(n) { n._g.setAttribute('transform', `translate(${n.x},${n.y})`); }

    placeAll() {
        if (this.style.edgeStyle === 'curved') this.assignPorts();
        for (const e of this.edges) this.placeEdge(e);
    }

    /**
     * Which pair of sides an edge connects. In a layered layout every edge between two different layers
     * uses the "flow" sides (bottom/top for top-down), and only same-layer edges use the lateral sides.
     */
    prefersVertical(a, b, dx, dy) {
        if (this.axis === 'v') return Math.abs(dy) >= (a.h + b.h) / 2;
        if (this.axis === 'h') return Math.abs(dx) < (a.w + b.w) / 2;
        return Math.abs(dy) / (a.h / 2 + b.h / 2 + 1) >= Math.abs(dx) / (a.w / 2 + b.w / 2 + 1);
    }

    /**
     * Spread edge end-points along each node side (ordered by where the other end sits),
     * so arrowheads never pile up on one spot and edges cross as little as possible.
     */
    assignPorts() {
        const sides = new Map(this.nodes.map((n) => [n, { top: [], bottom: [], left: [], right: [] }]));
        for (const e of this.edges) {
            const a = e._src;
            const b = e._tgt;
            if (a === b) continue;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            e._vertical = this.prefersVertical(a, b, dx, dy);
            if (e._vertical) {
                const down = dy >= 0;
                sides.get(a)[down ? 'bottom' : 'top'].push({ e, end: 's', other: b.x });
                sides.get(b)[down ? 'top' : 'bottom'].push({ e, end: 't', other: a.x });
            } else {
                const right = dx >= 0;
                sides.get(a)[right ? 'right' : 'left'].push({ e, end: 's', other: b.y });
                sides.get(b)[right ? 'left' : 'right'].push({ e, end: 't', other: a.y });
            }
        }
        for (const [n, bySide] of sides) {
            for (const [side, list] of Object.entries(bySide)) {
                list.sort((p, q) => p.other - q.other || (p.e.id < q.e.id ? -1 : 1));
                const horizontalSide = side === 'top' || side === 'bottom';
                const len = horizontalSide ? n.w : n.h;
                const inset = Math.min(10, len * 0.1);
                list.forEach((item, i) => {
                    const along = -len / 2 + inset + (len - 2 * inset) * (i + 1) / (list.length + 1);
                    const x = horizontalSide ? n.x + along : n.x + (side === 'right' ? n.w / 2 : -n.w / 2);
                    const y = horizontalSide ? n.y + (side === 'bottom' ? n.h / 2 : -n.h / 2) : n.y + along;
                    (item.e._ports ??= {})[item.end] = { x, y };
                });
            }
        }
    }

    placeEdge(e) {
        const { d, lx, ly } = this.geometry(e);
        e._path.setAttribute('d', d);
        e._hit.setAttribute('d', d);
        e._label?.setAttribute('transform', `translate(${lx},${ly})`);
    }

    /** Point where the line from node centre towards (tx,ty) leaves the node's rectangle. */
    anchor(n, tx, ty) {
        const dx = tx - n.x;
        const dy = ty - n.y;
        if (!dx && !dy) return { x: n.x, y: n.y };
        const s = Math.min(dx ? n.w / 2 / Math.abs(dx) : Infinity, dy ? n.h / 2 / Math.abs(dy) : Infinity);
        return { x: n.x + dx * s, y: n.y + dy * s };
    }

    geometry(e) {
        const g = this.rawGeometry(e);
        if (g.pts && e._k > 1) {
            // Parallel edges: slide each label to a different spot along its curve so they never collide.
            const lt = 0.5 + (e._i - (e._k - 1) / 2) * Math.min(0.24, 0.5 / e._k);
            const t = e._src.id < e._tgt.id ? lt : 1 - lt;
            const [p0, p1, p2, p3] = g.pts;
            const u = 1 - t;
            if (p3) {
                g.lx = u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x;
                g.ly = u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y;
            } else {
                g.lx = u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x;
                g.ly = u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y;
            }
        }
        return g;
    }

    rawGeometry(e) {
        const a = e._src;
        const b = e._tgt;
        const f = (v) => Math.round(v * 100) / 100;

        if (a === b) {
            const sx = a.x + a.w / 2 - 16;
            const sy = a.y - a.h / 2;
            const ex = a.x + a.w / 2;
            const ey = a.y - a.h / 2 + 14;
            const lift = 34 + e._i * 20;
            return {
                d: `M${f(sx)},${f(sy)} C${f(sx)},${f(sy - lift)} ${f(ex + lift)},${f(ey - lift)} ${f(ex)},${f(ey)}`,
                lx: sx + (ex - sx) / 2 + lift * 0.45,
                ly: sy - lift * 0.72,
            };
        }

        // Fixed frame per node pair so opposite-direction / parallel edges fan out consistently.
        const [p, q] = a.id < b.id ? [a, b] : [b, a];
        const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
        const nx = -(q.y - p.y) / len;
        const ny = (q.x - p.x) / len;
        const off = (e._i - (e._k - 1) / 2) * 26;

        if (this.style.edgeStyle === 'curved' && e._ports?.s && e._ports?.t) {
            const { s, t } = e._ports;
            if (e._vertical) {
                const my = (s.y + t.y) / 2;
                return { d: `M${f(s.x)},${f(s.y)} C${f(s.x)},${f(my)} ${f(t.x)},${f(my)} ${f(t.x)},${f(t.y)}`, lx: (s.x + t.x) / 2, ly: my,
                    pts: [s, { x: s.x, y: my }, { x: t.x, y: my }, t] };
            }
            const mx = (s.x + t.x) / 2;
            return { d: `M${f(s.x)},${f(s.y)} C${f(mx)},${f(s.y)} ${f(mx)},${f(t.y)} ${f(t.x)},${f(t.y)}`, lx: mx, ly: (s.y + t.y) / 2,
                pts: [s, { x: mx, y: s.y }, { x: mx, y: t.y }, t] };
        }

        // Straight (or slightly bowed when parallel)
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        if (e._k === 1) {
            const s = this.anchor(a, b.x, b.y);
            const t = this.anchor(b, a.x, a.y);
            return { d: `M${f(s.x)},${f(s.y)} L${f(t.x)},${f(t.y)}`, lx: (s.x + t.x) / 2, ly: (s.y + t.y) / 2 };
        }
        const cx = mx + nx * off * 2;
        const cy = my + ny * off * 2;
        const s = this.anchor(a, cx, cy);
        const t = this.anchor(b, cx, cy);
        return {
            d: `M${f(s.x)},${f(s.y)} Q${f(cx)},${f(cy)} ${f(t.x)},${f(t.y)}`,
            lx: 0.25 * s.x + 0.5 * cx + 0.25 * t.x,
            ly: 0.25 * s.y + 0.5 * cy + 0.25 * t.y,
            pts: [s, { x: cx, y: cy }, t],
        };
    }

    // ------------------------------------------------------------ interaction

    highlight(id) {
        const dimNodes = (fn) => this.nodes.forEach((n) => n._g.style.opacity = fn(n));
        if (id == null) {
            this.nodes.forEach((n) => (n._g.style.opacity = ''));
            this.edges.forEach((e) => { e._g.style.opacity = ''; if (e._label) e._label.style.opacity = ''; });
            return;
        }
        const near = new Set([id]);
        for (const e of this.edgesOfNode.get(id) ?? []) { near.add(e.source); near.add(e.target); }
        dimNodes((n) => (near.has(n.id) ? '' : '0.18'));
        for (const e of this.edges) {
            const on = e.source === id || e.target === id;
            e._g.style.opacity = on ? '' : '0.1';
            if (e._label) e._label.style.opacity = on ? '' : '0.1';
        }
    }

    setSelected(id) {
        this.selectedId = id;
        for (const n of this.nodes) n._ring?.setAttribute('visibility', n.id === id ? 'visible' : 'hidden');
    }

    has(id) { return this.nodeById.has(id); }

    contentBBox() {
        const ui = this.gRoot.node().querySelectorAll('.ui-only');
        ui.forEach((n) => n.setAttribute('display', 'none'));
        const bb = this.gRoot.node().getBBox();
        ui.forEach((n) => n.removeAttribute('display'));
        return bb;
    }

    fit(duration = 400, padding = 48) {
        if (!this.nodes.length) return;
        const bb = this.contentBBox();
        const rect = this.svg.node().getBoundingClientRect();
        if (!bb.width || !rect.width) return;
        const k = Math.min((rect.width - padding * 2) / bb.width, (rect.height - padding * 2) / bb.height, 1.6);
        const tx = rect.width / 2 - (bb.x + bb.width / 2) * k;
        const ty = rect.height / 2 - (bb.y + bb.height / 2) * k;
        this.svg.transition().duration(duration).call(this.zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(k));
    }

    /** Re-fit only when the drawing has drifted off-screen or shrunk to a speck. */
    fitIfNeeded() {
        if (!this.nodes.length) return;
        const bb = this.contentBBox();
        const rect = this.svg.node().getBoundingClientRect();
        const t = d3.zoomTransform(this.svg.node());
        const x0 = t.applyX(bb.x), x1 = t.applyX(bb.x + bb.width);
        const y0 = t.applyY(bb.y), y1 = t.applyY(bb.y + bb.height);
        const outside = x0 < 0 || y0 < 0 || x1 > rect.width || y1 > rect.height;
        const tiny = x1 - x0 < rect.width * 0.25 && y1 - y0 < rect.height * 0.25;
        if (outside || tiny) this.fit(350);
    }

    zoomBy(factor) { this.svg.transition().duration(200).call(this.zoom.scaleBy, factor); }

    focusNode(id) {
        const n = this.nodeById.get(id);
        if (!n) return;
        const rect = this.svg.node().getBoundingClientRect();
        const k = d3.zoomTransform(this.svg.node()).k;
        this.svg.transition().duration(450).call(this.zoom.transform,
            d3.zoomIdentity.translate(rect.width / 2 - n.x * k, rect.height / 2 - n.y * k).scale(k));
    }

    // ----------------------------------------------------------------- legend

    legendItems() {
        const items = [];
        const kinds = new Set(this.nodes.map((n) => n.kind));
        if (kinds.has('class')) items.push({ type: 'node', kind: 'class', label: 'Class' });
        if (kinds.has('individual')) items.push({ type: 'node', kind: 'individual', label: 'Individual' });
        const edgeKinds = new Set(this.edges.map((e) => e.kind));
        for (const k of Object.keys(EDGE_KINDS)) if (edgeKinds.has(k)) items.push({ type: 'edge', kind: k, label: EDGE_KINDS[k].replace(/ \(.*\)/, '') });
        return items;
    }

    /** Build a legend <g>; `maxWidth` 0 stacks items vertically. Returns {g, w, h}. */
    buildLegend(maxWidth = 0) {
        const c = this.colors;
        const g = svgEl('g', { 'font-family': this.fontFamily });
        const fs = Math.max(10, this.fs * 0.85);
        let x = 0;
        let y = 0;
        let w = 0;
        const rowH = fs + 14;
        for (const it of this.legendItems()) {
            const tw = this.measure(it.label, fs);
            const itemW = 38 + 8 + tw;
            if (maxWidth && x > 0 && x + itemW > maxWidth) { x = 0; y += rowH; }
            const gy = y + rowH / 2;
            if (it.type === 'node') {
                const cls = it.kind === 'class';
                g.appendChild(svgEl('rect', {
                    x, y: gy - 8, width: 30, height: 16, rx: cls ? 3 : 8,
                    fill: cls ? c.classFill : c.indFill, stroke: cls ? c.classStroke : c.indStroke, 'stroke-width': this.style.lineWidth,
                }));
            } else {
                const attrs = {
                    x1: x, x2: x + 32, y1: gy, y2: gy, stroke: c.edges[it.kind], 'stroke-width': this.style.lineWidth, 'stroke-linecap': 'round',
                };
                if (EDGE_DASH[it.kind]) attrs['stroke-dasharray'] = EDGE_DASH[it.kind];
                if (EDGE_MARKER[it.kind]) attrs['marker-end'] = `url(#fy-arrow-${it.kind})`;
                g.appendChild(svgEl('line', attrs));
            }
            const t = svgEl('text', { x: x + 38, y: gy, dy: '0.34em', 'font-size': fs, fill: c.text });
            t.textContent = it.label;
            g.appendChild(t);
            x += itemW + 22;
            w = Math.max(w, x - 22);
        }
        return { g, w, h: y + rowH };
    }

    // ----------------------------------------------------------------- export

    /** Standalone SVG document. Returns { svg, width, height }. */
    toSVG({ padding = 24, transparent = false, legend = false } = {}) {
        const bb = this.contentBBox();
        const c = this.colors;
        let x = bb.x - padding;
        let y = bb.y - padding;
        let w = bb.width + padding * 2;
        let h = bb.height + padding * 2;

        const root = svgEl('svg', {
            xmlns: SVGNS, 'font-family': this.fontFamily,
        });
        root.appendChild(this.defs.node().cloneNode(true));

        const content = this.gRoot.node().cloneNode(true);
        content.removeAttribute('transform');
        content.querySelectorAll('.ui-only').forEach((n) => n.remove());
        content.querySelectorAll('[style]').forEach((n) => n.removeAttribute('style'));
        content.querySelectorAll('[data-id]').forEach((n) => n.removeAttribute('data-id'));

        let legendNode = null;
        if (legend && this.legendItems().length) {
            const lg = this.buildLegend(Math.max(w - padding * 2, 320));
            const lw = lg.w + padding * 2;
            if (lw > w) { x -= (lw - w) / 2; w = lw; }
            lg.g.setAttribute('transform', `translate(${x + padding},${y + h - padding / 2})`);
            h += lg.h + padding / 2;
            legendNode = lg.g;
        }

        if (!transparent) root.appendChild(svgEl('rect', { x, y, width: w, height: h, fill: c.bg }));
        root.appendChild(content);
        if (legendNode) root.appendChild(legendNode);

        w = Math.ceil(w);
        h = Math.ceil(h);
        root.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
        root.setAttribute('width', w);
        root.setAttribute('height', h);
        const svg = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(root);
        return { svg, width: w, height: h };
    }

    async toPNG({ scale = 2, ...opts } = {}) {
        const { svg, width, height } = this.toSVG(opts);
        const maxSide = 16000;
        const k = Math.min(scale, maxSide / Math.max(width, height));
        const img = new Image();
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = () => reject(new Error('Could not rasterise the SVG'));
            img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(width * k);
        canvas.height = Math.round(height * k);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'));
    }
}
