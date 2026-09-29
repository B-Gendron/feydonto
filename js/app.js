// app.js — FeydOnto UI: choose what to show, inspect it, style it, export it.

import { parseRDF } from './rdf.js';
import { Ontology } from './ontologyParser.js';
import { buildGraph, DEFAULT_OPTS } from './viewModel.js';
import { GraphRenderer } from './graphRenderer.js';
import { THEMES, FONTS, EDGE_KINDS, DEFAULT_STYLE, resolveColors } from './style.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Tiny hyperscript helper. */
function h(tag, props = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'checked' || k === 'indeterminate' || k === 'value') el[k] = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
    return el;
}

const KIND_LABEL = { class: 'Class', individual: 'Individual', objectProperty: 'Object property', dataProperty: 'Datatype property' };
const EDGE_LABEL = { ...EDGE_KINDS };
const MAX_ROWS = 250;

class App {
    constructor() {
        this.renderer = new GraphRenderer('graph');
        this.ont = null;
        this.fileName = '';
        this.sel = { visible: new Set(), disabledProps: new Set() };
        this.opts = structuredClone(DEFAULT_OPTS);
        this.style = structuredClone(DEFAULT_STYLE);
        this.layout = { algorithm: 'layered', layering: 'hierarchy', direction: 'DOWN', spacing: 50, auto: true };
        this.showLegend = false;
        this.selected = null;
        this.expanded = new Set();       // expanded class-tree rows
        this.expandedGroups = new Set(); // expanded individual groups
        this.filters = { classes: '', properties: '', individuals: '' };
        this.undoStack = [];
        this.redoStack = [];
        this._token = 0;

        this.buildStaticControls();
        this.bindUI();
        this.bindRenderer();
        this.syncControls();
        this.updateUndoButtons();
        this.renderer.setStyle(this.style);
        this.applyCanvasBg();
    }

    // ================================================================ loading

    async loadFile(file) {
        try {
            await this.loadText(await file.text(), file.name);
        } catch (e) {
            this.toast(e.message, true);
        }
    }

    async loadUrl(url, name) {
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            await this.loadText(await res.text(), name || decodeURIComponent(url.split('/').pop().split('?')[0]) || 'ontology');
        } catch (e) {
            const hint = location.protocol === 'file:'
                ? ' — open FeydOnto through a local web server (e.g. `python3 -m http.server`) to load examples.'
                : ' (remote servers must allow cross-origin requests).';
            this.toast(`Could not load ${url}: ${e.message}${hint}`, true);
        }
    }

    async loadText(text, name) {
        let ont;
        try {
            ont = new Ontology(await parseRDF(text, name), name);
        } catch (e) {
            console.error(e);
            this.toast(`Could not read "${name}": ${e.message}`, true);
            return;
        }
        if (!ont.classes.size && !ont.individuals.size) {
            this.toast(`No classes or individuals found in "${name}".`, true);
            return;
        }
        this.ont = ont;
        this.fileName = name;
        this.selected = null;
        this.undoStack = [];
        this.redoStack = [];
        this.expanded.clear();
        this.expandedGroups.clear();
        this.renderer.positions.clear();
        this.initSelection();
        document.title = `FeydOnto — ${ont.title || name}`;
        $('#welcome').hidden = true;
        $('#canvasTools').hidden = false;
        this.renderInspector();
        await this.refresh('force', { fit: true });
        const s = ont.stats;
        const shown = [...this.sel.visible].filter((i) => ont.classes.has(i)).length;
        this.toast(shown < s.classes
            ? `Loaded ${s.classes} classes, ${s.individuals} individuals. Showing ${shown} classes — pick more in the left panel.`
            : `Loaded ${s.classes} classes, ${s.individuals} individuals, ${s.objectProps + s.dataProps} properties.`);
    }

    /** Sensible starting view: everything for small ontologies, the top of the hierarchy for big ones. */
    initSelection() {
        const ont = this.ont;
        this.sel.visible = new Set();
        this.sel.disabledProps = new Set();
        if (ont.classes.size <= 60) {
            for (const i of ont.classes.keys()) this.sel.visible.add(i);
        } else {
            const roots = this.classRoots();
            for (const r of roots) {
                if (this.sel.visible.size >= 60) break;
                this.sel.visible.add(r);
            }
            for (const r of roots) {
                for (const c of ont.classes.get(r).subClasses) if (this.sel.visible.size < 60) this.sel.visible.add(c);
            }
        }
    }

    // ============================================================= state/undo

    snapshot() { return { visible: [...this.sel.visible], disabled: [...this.sel.disabledProps] }; }

    restore(s) {
        this.sel.visible = new Set(s.visible);
        this.sel.disabledProps = new Set(s.disabled);
    }

    /** Apply a user-driven change to the selection, with undo support, then redraw. */
    commit(fn, mode = 'auto') {
        this.undoStack.push(this.snapshot());
        if (this.undoStack.length > 100) this.undoStack.shift();
        this.redoStack = [];
        fn();
        return this.refresh(mode);
    }

    undo() {
        if (!this.undoStack.length) return;
        this.redoStack.push(this.snapshot());
        this.restore(this.undoStack.pop());
        this.refresh('auto');
    }

    redo() {
        if (!this.redoStack.length) return;
        this.undoStack.push(this.snapshot());
        this.restore(this.redoStack.pop());
        this.refresh('auto');
    }

    updateUndoButtons() {
        $('#undoBtn').disabled = !this.undoStack.length;
        $('#redoBtn').disabled = !this.redoStack.length;
    }

    /** Add nodes to the view (individuals bring their classes along when enabled). */
    addNodes(iris) {
        for (const i of iris) {
            this.sel.visible.add(i);
            const ind = this.ont.individuals.get(i);
            if (ind && this.opts.autoIncludeTypes) ind.types.forEach((t) => this.sel.visible.add(t));
        }
    }

    show(iris) {
        if (iris.every((i) => this.sel.visible.has(i))) return Promise.resolve();
        return this.commit(() => this.addNodes(iris));
    }
    hide(iris) { return this.commit(() => iris.forEach((i) => this.sel.visible.delete(i))); }

    // ================================================================ refresh

    async refresh(mode = 'auto', { fit = false } = {}) {
        if (!this.ont) return;
        const token = ++this._token;
        const graph = buildGraph(this.ont, this.sel, this.opts);
        const keep = mode === 'keep' || (mode === 'auto' && !this.layout.auto);
        this.renderer.setStyle(this.style);
        this.applyCanvasBg();
        this.renderLists();
        this.renderInspector();
        this.updateCounts();
        this.updateUndoButtons();
        try {
            await this.renderer.setGraph(graph, { ...this.layout, keepPositions: keep });
            if (token !== this._token) return;
            this.renderer.setSelected(this.selected);
            if (fit) this.renderer.fit(0);
            else if (mode === 'force') this.renderer.fit(350);
            else if (mode === 'auto') this.renderer.fitIfNeeded();
            this.renderLegend();
        } catch (e) {
            console.error(e);
            this.toast('Layout failed: ' + e.message, true);
        }
    }

    applyCanvasBg() {
        $('#canvas').style.backgroundColor = resolveColors(this.style).bg;
    }

    updateCounts() {
        const ont = this.ont;
        if (!ont) return;
        const vis = [...this.sel.visible];
        const c = vis.filter((i) => ont.classes.has(i)).length;
        const n = vis.filter((i) => ont.individuals.has(i)).length;
        $('#counts').textContent = `Showing ${c}/${ont.classes.size} classes` +
            (ont.individuals.size ? ` · ${n}/${ont.individuals.size} individuals` : '');
    }

    renderLegend() {
        const svg = $('#legend');
        const c = resolveColors(this.style);
        const lg = this.showLegend ? this.renderer.buildLegend(0) : null;
        if (!lg || !lg.g.childNodes.length) { svg.hidden = true; return; }
        svg.replaceChildren(lg.g);
        svg.setAttribute('width', Math.ceil(lg.w) + 2);
        svg.setAttribute('height', Math.ceil(lg.h));
        svg.style.width = Math.ceil(lg.w) + 26 + 'px';
        svg.style.height = Math.ceil(lg.h) + 16 + 'px';
        svg.style.background = c.bg;
        svg.setAttribute('viewBox', `-1 0 ${Math.ceil(lg.w) + 2} ${Math.ceil(lg.h)}`);
        svg.hidden = false;
    }

    // ======================================================== renderer events

    bindRenderer() {
        this.renderer
            .on('nodeClick', (n) => this.select(n.id))
            .on('nodeDblClick', (n) => this.show([...this.ont.neighbors(n.id)].filter((i) => this.ont.classes.has(i) || this.ont.individuals.has(i))))
            .on('nodeContext', (n, ev) => this.showContext(n, ev))
            .on('edgeClick', (e) => this.inspectEdge(e))
            .on('background', () => { this.closeContext(); this.select(null); });
    }

    select(iri, { focus = false } = {}) {
        this.selected = iri;
        this.closeContext();
        this.renderer.setSelected(iri && this.renderer.has(iri) ? iri : null);
        this.renderInspector();
        this.renderLists();
        if (iri) this.activateTab('right', 'inspect');
        if (focus && iri && this.renderer.has(iri)) this.renderer.focusNode(iri);
    }

    async reveal(iri) {
        const ont = this.ont;
        if (ont.objectProps.has(iri) || ont.dataProps.has(iri)) {
            if (this.sel.disabledProps.has(iri)) await this.commit(() => this.sel.disabledProps.delete(iri));
            this.select(iri);
            return;
        }
        if (!this.sel.visible.has(iri)) await this.commit(() => this.addNodes([iri]));
        this.select(iri, { focus: true });
    }

    // =============================================================== context

    showContext(n, ev) {
        const ont = this.ont;
        const iri = n.id;
        const isClass = ont.classes.has(iri);
        const fresh = (set) => [...set].filter((i) => !this.sel.visible.has(i));
        const neighbours = fresh([...ont.neighbors(iri)].filter((i) => ont.classes.has(i) || ont.individuals.has(i)));
        const items = [{ title: n.title }];

        if (isClass) {
            const sub = fresh(ont.classes.get(iri).subClasses);
            const desc = fresh(ont.descendants(iri));
            const anc = fresh(ont.ancestors(iri));
            const inds = fresh(ont.individualsOf(iri));
            if (sub.length) items.push({ label: `Show subclasses (+${sub.length})`, run: () => this.show(sub) });
            if (desc.length > sub.length) items.push({ label: `Show all descendants (+${desc.length})`, run: () => this.show(desc) });
            if (anc.length) items.push({ label: `Show all superclasses (+${anc.length})`, run: () => this.show(anc) });
            if (inds.length) items.push({ label: `Show its individuals (+${inds.length})`, run: () => this.confirmMany(inds.length, () => this.show(inds)) });
        } else {
            const types = fresh(ont.individuals.get(iri).types);
            if (types.length) items.push({ label: `Show its class (+${types.length})`, run: () => this.show(types) });
        }
        if (neighbours.length) items.push({ label: `Show connected (+${neighbours.length})`, run: () => this.show(neighbours) });
        items.push('-');
        items.push({
            label: 'Isolate (only this + connected)',
            run: () => this.commit(() => {
                const keep = new Set([iri, ...[...ont.neighbors(iri)].filter((i) => ont.classes.has(i) || ont.individuals.has(i))]);
                this.sel.visible = keep;
            }),
        });
        items.push({ label: 'Hide', run: () => this.hide([iri]) });
        items.push('-');
        items.push({ label: 'Copy IRI', run: () => navigator.clipboard?.writeText(iri).then(() => this.toast('IRI copied')) });

        const menu = $('#ctxMenu');
        menu.replaceChildren(...items.map((it) => {
            if (it === '-') return h('hr');
            if (it.title) return h('div', { class: 'ctx-title' }, it.title);
            return h('button', { onclick: () => { this.closeContext(); it.run(); } }, it.label);
        }));
        const box = $('#canvas').getBoundingClientRect();
        menu.hidden = false;
        const x = Math.min(ev.clientX - box.left, box.width - menu.offsetWidth - 8);
        const y = Math.min(ev.clientY - box.top, box.height - menu.offsetHeight - 8);
        menu.style.left = Math.max(4, x) + 'px';
        menu.style.top = Math.max(4, y) + 'px';
    }

    closeContext() { $('#ctxMenu').hidden = true; }

    confirmMany(n, fn) {
        if (n <= 150 || confirm(`Show ${n} nodes at once? Large diagrams can be hard to read.`)) fn();
    }

    // ================================================================== lists

    byName(a, b) { return this.ont.nameOf(a).localeCompare(this.ont.nameOf(b), undefined, { sensitivity: 'base' }); }

    matches(iri, q) { return this.ont.nameOf(iri).toLowerCase().includes(q) || iri.toLowerCase().includes(q); }

    renderLists() {
        if (!this.ont) return;
        this.renderClassList();
        this.renderPropertyList();
        this.renderIndividualList();
    }

    withScroll(box, fn) {
        const top = box.scrollTop;
        box.replaceChildren();
        fn();
        box.scrollTop = top;
    }

    classRoots() {
        const ont = this.ont;
        const cmp = (a, b) => this.byName(a, b);
        const roots = [...ont.classes.values()].filter((c) => c.superClasses.size === 0).map((c) => c.iri).sort(cmp);
        const seen = new Set();
        const stack = [...roots];
        while (stack.length) {
            const i = stack.pop();
            if (seen.has(i)) continue;
            seen.add(i);
            stack.push(...ont.classes.get(i).subClasses);
        }
        for (const i of ont.classes.keys()) if (!seen.has(i)) roots.push(i); // classes only reachable through cycles
        return roots;
    }

    renderClassList() {
        const box = $('#listClasses');
        const ont = this.ont;
        const q = this.filters.classes.trim().toLowerCase();
        this.withScroll(box, () => {
            if (q) {
                const found = [...ont.classes.keys()].filter((i) => this.matches(i, q)).sort((a, b) => this.byName(a, b));
                found.slice(0, MAX_ROWS).forEach((i) => box.append(this.classRow(i, 0, false)));
                if (!found.length) box.append(h('p', { class: 'hint' }, 'No class matches.'));
                if (found.length > MAX_ROWS) box.append(h('p', { class: 'hint' }, `…and ${found.length - MAX_ROWS} more — refine the filter.`));
                return;
            }
            const walk = (iri, depth, path) => {
                box.append(this.classRow(iri, depth, true));
                if (!this.expanded.has(iri)) return;
                const kids = [...ont.classes.get(iri).subClasses].filter((c) => c !== iri && !path.includes(c)).sort((a, b) => this.byName(a, b));
                for (const c of kids) walk(c, depth + 1, [...path, iri]);
            };
            this.classRoots().forEach((r) => walk(r, 0, []));
        });
    }

    classRow(iri, depth, tree) {
        const ont = this.ont;
        const c = ont.classes.get(iri);
        const on = this.sel.visible.has(iri);
        let partial = false;
        if (!on && c.subClasses.size) for (const d of ont.descendants(iri)) if (this.sel.visible.has(d)) { partial = true; break; }
        const hasKids = tree && c.subClasses.size > 0;
        const nInd = ont.individualsOf(iri).length;
        return h('div', { class: 'row' + (this.selected === iri ? ' selected' : ''), style: `padding-left:${6 + depth * 14}px` },
            h('span', {
                class: 'caret' + (hasKids ? '' : ' empty'),
                onclick: () => { this.expanded.has(iri) ? this.expanded.delete(iri) : this.expanded.add(iri); this.renderClassList(); },
            }, this.expanded.has(iri) ? '▼' : '▶'),
            h('input', {
                type: 'checkbox', checked: on, indeterminate: partial,
                onclick: (e) => {
                    const set = e.shiftKey ? [iri, ...ont.descendants(iri)] : [iri];
                    const checked = e.target.checked;
                    this.commit(() => set.forEach((i) => (checked ? this.sel.visible.add(i) : this.sel.visible.delete(i))));
                },
            }),
            h('span', { class: 'name', title: iri, onclick: () => this.select(iri, { focus: true }) }, ont.nameOf(iri)),
            nInd ? h('span', { class: 'badge', title: `${nInd} individual(s)` }, '◆' + nInd) : null);
    }

    renderPropertyList() {
        const box = $('#listProperties');
        const ont = this.ont;
        const q = this.filters.properties.trim().toLowerCase();
        this.withScroll(box, () => {
            const group = (title, map, describe) => {
                const iris = [...map.keys()].filter((i) => !q || this.matches(i, q)).sort((a, b) => this.byName(a, b));
                if (!iris.length) return;
                box.append(h('div', { class: 'group-title' }, `${title} (${iris.length})`));
                for (const iri of iris.slice(0, MAX_ROWS)) {
                    box.append(h('div', { class: 'row' + (this.selected === iri ? ' selected' : '') },
                        h('span', { class: 'caret empty' }),
                        h('input', {
                            type: 'checkbox', checked: !this.sel.disabledProps.has(iri),
                            onclick: (e) => this.commit(() => (e.target.checked ? this.sel.disabledProps.delete(iri) : this.sel.disabledProps.add(iri))),
                        }),
                        h('span', { class: 'name', title: iri, onclick: () => this.select(iri) }, ont.nameOf(iri)),
                        h('span', { class: 'dim' }, describe(map.get(iri)))));
                }
            };
            const names = (list) => list.map((i) => ont.nameOf(i)).join('|');
            group('Object properties', ont.objectProps, (p) => (p.domains.length || p.ranges.length ? `${names(p.domains) || '?'} → ${names(p.ranges) || '?'}` : ''));
            group('Datatype properties', ont.dataProps, (p) => (p.domains.length ? `${names(p.domains)} → ${p.rangeTexts.join('|')}` : ''));
            if (!box.childNodes.length) box.append(h('p', { class: 'hint' }, q ? 'No property matches.' : 'This ontology declares no properties.'));
        });
    }

    renderIndividualList() {
        const box = $('#listIndividuals');
        const ont = this.ont;
        const q = this.filters.individuals.trim().toLowerCase();
        this.withScroll(box, () => {
            if (!ont.individuals.size) {
                box.append(h('p', { class: 'hint' }, 'This ontology has no individuals.'));
                return;
            }
            const groups = new Map();
            for (const ind of ont.individuals.values()) {
                if (q && !this.matches(ind.iri, q)) continue;
                const key = ind.types[0] ?? '';
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(ind.iri);
            }
            if (!groups.size) box.append(h('p', { class: 'hint' }, 'No individual matches.'));
            const keys = [...groups.keys()].sort((a, b) => (a && b ? this.byName(a, b) : a ? -1 : 1));
            for (const key of keys) {
                const list = groups.get(key).sort((a, b) => this.byName(a, b));
                const nOn = list.filter((i) => this.sel.visible.has(i)).length;
                const open = q || this.expandedGroups.has(key);
                box.append(h('div', { class: 'row' },
                    h('span', {
                        class: 'caret',
                        onclick: () => { this.expandedGroups.has(key) ? this.expandedGroups.delete(key) : this.expandedGroups.add(key); this.renderIndividualList(); },
                    }, open ? '▼' : '▶'),
                    h('input', {
                        type: 'checkbox', checked: nOn === list.length, indeterminate: nOn > 0 && nOn < list.length,
                        onclick: (e) => {
                            const checked = e.target.checked;
                            if (checked) this.confirmMany(list.length, () => this.show(list));
                            else this.hide(list);
                        },
                    }),
                    h('span', { class: 'name', onclick: () => { this.expandedGroups.has(key) ? this.expandedGroups.delete(key) : this.expandedGroups.add(key); this.renderIndividualList(); } },
                        key ? ont.nameOf(key) : '(no class)'),
                    h('span', { class: 'badge' }, `${nOn}/${list.length}`)));
                if (!open) continue;
                for (const iri of list.slice(0, MAX_ROWS)) {
                    box.append(h('div', { class: 'row' + (this.selected === iri ? ' selected' : ''), style: 'padding-left:28px' },
                        h('input', {
                            type: 'checkbox', checked: this.sel.visible.has(iri),
                            onclick: (e) => (e.target.checked ? this.show([iri]) : this.hide([iri])),
                        }),
                        h('span', { class: 'name', title: iri, onclick: () => this.select(iri, { focus: true }) }, ont.nameOf(iri))));
                }
                if (list.length > MAX_ROWS) box.append(h('p', { class: 'hint', style: 'padding-left:28px' }, `…and ${list.length - MAX_ROWS} more — use the filter.`));
            }
        });
    }

    bulk(action) {
        const ont = this.ont;
        if (!ont) return;
        switch (action) {
            case 'classes-all': this.commit(() => ont.classes.forEach((_, i) => this.sel.visible.add(i)), 'force'); break;
            case 'classes-none': this.commit(() => ont.classes.forEach((_, i) => this.sel.visible.delete(i))); break;
            case 'props-all': this.commit(() => this.sel.disabledProps.clear()); break;
            case 'props-none': this.commit(() => { ont.objectProps.forEach((_, i) => this.sel.disabledProps.add(i)); ont.dataProps.forEach((_, i) => this.sel.disabledProps.add(i)); }); break;
            case 'inds-all': this.confirmMany(ont.individuals.size, () => this.show([...ont.individuals.keys()])); break;
            case 'inds-none': this.commit(() => ont.individuals.forEach((_, i) => this.sel.visible.delete(i))); break;
        }
    }

    // =============================================================== inspector

    link(iri) {
        const ont = this.ont;
        const isNode = ont.classes.has(iri) || ont.individuals.has(iri);
        const a = h('a', { class: 'ent-link', title: iri, onclick: () => (isNode ? this.reveal(iri) : this.select(iri)) }, ont.nameOf(iri));
        if (isNode && !this.sel.visible.has(iri)) {
            return h('span', {}, a, h('button', { class: 'add-btn', title: 'Add to view', onclick: () => this.show([iri]) }, '+'));
        }
        return a;
    }

    listSection(title, iris, limit = 30) {
        if (!iris.length) return null;
        const shown = iris.slice(0, limit);
        return [
            h('h5', {}, `${title} (${iris.length})`),
            h('ul', {}, shown.map((i) => h('li', {}, this.link(i))), iris.length > limit ? h('li', { class: 'muted' }, `…and ${iris.length - limit} more`) : null),
        ];
    }

    textSection(title, texts, cls = 'expr') {
        if (!texts.length) return null;
        return [h('h5', {}, title), h('ul', {}, texts.map((t) => h('li', { class: cls }, t)))];
    }

    renderInspector() {
        const box = $('#inspector');
        const ont = this.ont;
        const iri = this.selected;
        const ent = ont && iri ? ont.entity(iri) : null;
        if (!ent) {
            box.replaceChildren(h('p', { class: 'muted' }, ont
                ? 'Click a node or an edge to see its details. Double-click a node to reveal its neighbours; right-click for more actions.'
                : 'Click a node or an edge to see its details.'));
            return;
        }
        const parts = [
            h('span', { class: 'kind' }, KIND_LABEL[ent.kind]),
            h('h3', {}, ont.nameOf(iri)),
            h('div', { class: 'iri' }, iri),
            ent.comment ? h('p', { class: 'comment' }, ent.comment) : null,
        ];
        if (ent.kind === 'class') {
            parts.push(
                this.listSection('Superclasses', [...ent.superClasses]),
                this.listSection('Subclasses', [...ent.subClasses]),
                this.listSection('Equivalent to', [...ent.equivalent]),
                this.listSection('Disjoint with', [...ent.disjoint]),
                this.textSection('Definition (equivalent class)', ent.equivalentExprs.map((t) => ont.exprText(t))),
                this.textSection('Also subclass of', ent.superExprs.map((t) => ont.exprText(t))),
                this.textSection('Attributes', ent.attributes.map((a) => `${ont.nameOf(a.prop)}${a.range ? ' : ' + a.range : ''}`)),
                this.listSection('Individuals', ont.individualsOf(iri), 15));
        } else if (ent.kind === 'individual') {
            parts.push(
                this.listSection('Types', ent.types),
                ent.objectAssertions.length ? [h('h5', {}, 'Relations'), h('ul', {}, ent.objectAssertions.map((a) => h('li', {}, h('i', {}, ont.nameOf(a.prop)), ' → ', this.link(a.target))))] : null,
                this.textSection('Values', ent.dataAssertions.map((a) => `${ont.nameOf(a.prop)} = ${a.value.value}`), 'plain'));
        } else {
            parts.push(
                ent.flags.length ? [h('h5', {}, 'Characteristics'), h('p', {}, ent.flags.join(', '))] : null,
                this.listSection('Domain', ent.domains),
                ent.kind === 'objectProperty' ? this.listSection('Range', ent.ranges) : this.textSection('Range', ent.rangeTexts, 'plain'),
                ent.inverseOf ? [h('h5', {}, 'Inverse of'), h('ul', {}, h('li', {}, ont.nameOf(ent.inverseOf)))] : null,
                this.listSection('Sub-property of', [...ent.superProps].filter((p) => ont.entity(p)), 10));
        }
        box.replaceChildren(...parts.flat().filter(Boolean));
    }

    inspectEdge(e) {
        const ont = this.ont;
        if (e.prop && ont.entity(e.prop)) { this.select(e.prop); return; }
        this.selected = null;
        this.renderer.setSelected(null);
        $('#inspector').replaceChildren(
            h('span', { class: 'kind' }, EDGE_LABEL[e.kind] ?? e.kind),
            h('h3', {}, e.label || EDGE_LABEL[e.kind]),
            h('ul', {}, h('li', {}, this.link(e.source), ' → ', this.link(e.target))));
        this.activateTab('right', 'inspect');
    }

    // ================================================================= search

    bindSearch() {
        const input = $('#globalSearch');
        const box = $('#searchResults');
        let results = [];
        let active = 0;
        const close = () => { box.hidden = true; active = 0; };
        const paint = () => {
            box.replaceChildren(...results.map((r, i) => h('button', {
                class: i === active ? 'active' : '',
                onmousedown: (e) => { e.preventDefault(); choose(r); },
            }, h('span', { class: 'dim' }, KIND_LABEL[r.kind]), h('span', {}, r.name))));
            box.hidden = !results.length;
        };
        const choose = (r) => { close(); input.value = ''; input.blur(); this.reveal(r.iri); };
        input.addEventListener('input', () => {
            const q = input.value.trim().toLowerCase();
            results = [];
            if (q && this.ont) {
                const pool = [this.ont.classes, this.ont.individuals, this.ont.objectProps, this.ont.dataProps];
                for (const map of pool) {
                    for (const [iri, e] of map) {
                        if (this.matches(iri, q)) results.push({ iri, kind: e.kind, name: this.ont.nameOf(iri) });
                        if (results.length >= 200) break;
                    }
                }
                results.sort((a, b) => (a.name.toLowerCase().startsWith(q) ? 0 : 1) - (b.name.toLowerCase().startsWith(q) ? 0 : 1) || a.name.localeCompare(b.name));
                results = results.slice(0, 12);
            }
            active = 0;
            paint();
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') { active = Math.min(active + 1, results.length - 1); paint(); e.preventDefault(); }
            else if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); paint(); e.preventDefault(); }
            else if (e.key === 'Enter' && results[active]) choose(results[active]);
            else if (e.key === 'Escape') { close(); input.blur(); }
        });
        input.addEventListener('blur', () => setTimeout(close, 100));
    }

    // ============================================================== controls

    buildStaticControls() {
        // Edge-kind checkboxes
        $('#edgeKindBoxes').replaceChildren(...Object.entries(EDGE_KINDS).map(([kind, label]) =>
            h('label', { class: 'check' },
                h('input', {
                    type: 'checkbox', 'data-edge-kind': kind,
                    onchange: (e) => { this.opts.edgeKinds[kind] = e.target.checked; this.refresh('auto'); },
                }), label)));
        // Theme & font selects
        $('#styTheme').replaceChildren(...Object.entries(THEMES).map(([k, t]) => h('option', { value: k }, t.label)));
        $('#styFont').replaceChildren(...Object.entries(FONTS).map(([k, f]) => h('option', { value: k }, f.label)));
    }

    syncControls() {
        const o = this.opts;
        $$('[data-edge-kind]').forEach((cb) => (cb.checked = !!o.edgeKinds[cb.dataset.edgeKind]));
        $('#optAttributes').checked = o.attributes;
        $('#optIndValues').checked = o.individualValues;
        $('#optTypeDisplay').value = o.typeDisplay;
        $('#optEdgeLabels').checked = o.edgeLabels;
        $('#optHideIsolated').checked = o.hideIsolated;
        $('#optAutoTypes').checked = o.autoIncludeTypes;
        $('#optLabelMode').value = o.labelMode;
        $('#layAlgorithm').value = this.layout.algorithm;
        $('#layLayering').value = this.layout.layering;
        $('#layDirection').value = this.layout.direction;
        $('#laySpacing').value = this.layout.spacing;
        $('#laySpacingOut').textContent = this.layout.spacing;
        $('#layAuto').checked = this.layout.auto;
        $('#styTheme').value = this.style.theme;
        $('#styFont').value = this.style.font;
        $('#styFontSize').value = this.style.fontSize;
        $('#styFontSizeOut').textContent = this.style.fontSize;
        $('#styLine').value = this.style.lineWidth;
        $('#styLineOut').textContent = this.style.lineWidth;
        $('#styEdgeStyle').value = this.style.edgeStyle;
        $('#styLegend').checked = this.showLegend;
        this.syncColorInputs();
    }

    syncColorInputs() {
        const c = resolveColors(this.style);
        $$('[data-color]').forEach((inp) => (inp.value = c[inp.dataset.color]));
    }

    activateTab(side, name) {
        const nav = $(`[data-tabs="${side}"]`);
        $$('.tab', nav).forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
        const panel = nav.parentElement;
        $$('.tab-body', panel).forEach((b) => b.classList.toggle('active', b.dataset.body === name));
    }

    bindUI() {
        // Tabs
        $$('.tabs').forEach((nav) => nav.addEventListener('click', (e) => {
            const t = e.target.closest('.tab');
            if (t) this.activateTab(nav.dataset.tabs, t.dataset.tab);
        }));

        // File / example / URL
        $('#fileInput').addEventListener('change', (e) => { if (e.target.files[0]) this.loadFile(e.target.files[0]); e.target.value = ''; });
        $('#exampleSelect').addEventListener('change', (e) => { if (e.target.value) this.loadUrl(e.target.value); e.target.value = ''; });
        $$('[data-example]').forEach((b) => b.addEventListener('click', () => this.loadUrl(b.dataset.example)));
        $('#loadUrl').addEventListener('click', () => {
            const url = prompt('URL of an RDF/XML, OWL or Turtle file:');
            if (url) this.loadUrl(url.trim());
        });

        // Filters and bulk buttons
        for (const key of ['classes', 'properties', 'individuals']) {
            $(`#filter${key[0].toUpperCase() + key.slice(1)}`).addEventListener('input', (e) => {
                this.filters[key] = e.target.value;
                this.renderLists();
            });
        }
        $$('[data-bulk]').forEach((b) => b.addEventListener('click', () => this.bulk(b.dataset.bulk)));

        // Canvas tools
        $('#zoomIn').addEventListener('click', () => this.renderer.zoomBy(1.4));
        $('#zoomOut').addEventListener('click', () => this.renderer.zoomBy(1 / 1.4));
        $('#fitView').addEventListener('click', () => this.renderer.fit());
        const relayout = () => this.refresh('force');
        $('#relayout').addEventListener('click', relayout);
        $('#relayout2').addEventListener('click', relayout);
        $('#undoBtn').addEventListener('click', () => this.undo());
        $('#redoBtn').addEventListener('click', () => this.redo());
        $('#canvas').addEventListener('click', (e) => { if (!e.target.closest('#ctxMenu')) this.closeContext(); });

        // Display options
        const bindCheck = (id, fn, mode = 'auto') => $(id).addEventListener('change', (e) => { fn(e.target.checked); this.refresh(mode); });
        bindCheck('#optAttributes', (v) => (this.opts.attributes = v));
        bindCheck('#optIndValues', (v) => (this.opts.individualValues = v));
        bindCheck('#optEdgeLabels', (v) => (this.opts.edgeLabels = v));
        bindCheck('#optHideIsolated', (v) => (this.opts.hideIsolated = v));
        $('#optAutoTypes').addEventListener('change', (e) => { this.opts.autoIncludeTypes = e.target.checked; });
        $('#optTypeDisplay').addEventListener('change', (e) => { this.opts.typeDisplay = e.target.value; this.refresh('auto'); });
        $('#optLabelMode').addEventListener('change', (e) => { this.opts.labelMode = e.target.value; this.refresh('auto'); });

        // Layout
        $('#layAlgorithm').addEventListener('change', (e) => { this.layout.algorithm = e.target.value; this.refresh('force'); });
        $('#layLayering').addEventListener('change', (e) => { this.layout.layering = e.target.value; this.refresh('force'); });
        $('#layDirection').addEventListener('change', (e) => { this.layout.direction = e.target.value; this.refresh('force'); });
        $('#laySpacing').addEventListener('input', (e) => { this.layout.spacing = +e.target.value; $('#laySpacingOut').textContent = e.target.value; });
        $('#laySpacing').addEventListener('change', () => this.refresh('force'));
        $('#layAuto').addEventListener('change', (e) => { this.layout.auto = e.target.checked; });

        // Style
        $('#styTheme').addEventListener('change', (e) => { this.style.theme = e.target.value; this.style.colors = {}; this.syncColorInputs(); this.refresh('keep'); });
        $('#styFont').addEventListener('change', (e) => { this.style.font = e.target.value; this.refresh('auto'); });
        $('#styFontSize').addEventListener('input', (e) => { this.style.fontSize = +e.target.value; $('#styFontSizeOut').textContent = e.target.value; });
        $('#styFontSize').addEventListener('change', () => this.refresh('auto'));
        $('#styLine').addEventListener('input', (e) => { this.style.lineWidth = +e.target.value; $('#styLineOut').textContent = e.target.value; this.refresh('keep'); });
        $('#styEdgeStyle').addEventListener('change', (e) => { this.style.edgeStyle = e.target.value; this.refresh('keep'); });
        $$('[data-color]').forEach((inp) => inp.addEventListener('input', () => { this.style.colors[inp.dataset.color] = inp.value; this.refresh('keep'); }));
        $('#resetColors').addEventListener('click', () => { this.style.colors = {}; this.syncColorInputs(); this.refresh('keep'); });
        $('#styLegend').addEventListener('change', (e) => { this.showLegend = e.target.checked; this.renderLegend(); });

        // Export
        $('#expPad').addEventListener('input', (e) => ($('#expPadOut').textContent = e.target.value));
        $('#expSvg').addEventListener('click', () => this.exportSvg());
        $('#expPng').addEventListener('click', () => this.exportPng());
        $('#expCopy').addEventListener('click', () => this.copyPng());

        // Views
        $('#saveView').addEventListener('click', () => this.saveView());
        $('#loadViewInput').addEventListener('change', (e) => { if (e.target.files[0]) this.loadView(e.target.files[0]); e.target.value = ''; });

        this.bindSearch();
        this.bindDragDrop();
        this.bindKeys();
    }

    bindDragDrop() {
        const zone = $('#dropzone');
        let depth = 0;
        const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
        window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { depth++; zone.hidden = false; } });
        window.addEventListener('dragleave', (e) => { if (hasFiles(e) && --depth <= 0) { depth = 0; zone.hidden = true; } });
        window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
        window.addEventListener('drop', (e) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            depth = 0;
            zone.hidden = true;
            const f = e.dataTransfer.files[0];
            if (f) f.name.toLowerCase().endsWith('.json') ? this.loadView(f) : this.loadFile(f);
        });
    }

    bindKeys() {
        window.addEventListener('keydown', (e) => {
            const el = document.activeElement;
            const typing = el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && /^(text|search|url)$/.test(el.type)));
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !typing) {
                e.preventDefault();
                e.shiftKey ? this.redo() : this.undo();
            } else if (e.key === '/' && !typing) {
                e.preventDefault();
                $('#globalSearch').focus();
            } else if (e.key === 'Escape') {
                this.closeContext();
                if (!typing) this.select(null);
            } else if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && this.selected && this.renderer.has(this.selected)) {
                e.preventDefault();
                this.hide([this.selected]);
                this.select(null);
            }
        });
    }

    // ================================================================= export

    baseName() { return (this.fileName || 'ontology').replace(/\.[^.]+$/, '') + '-feydonto'; }

    exportOpts() {
        return { padding: +$('#expPad').value, transparent: $('#expTransparent').checked, legend: $('#expLegend').checked };
    }

    download(blob, name) {
        const url = URL.createObjectURL(blob);
        const a = h('a', { href: url, download: name });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    hasGraph() {
        if (this.ont && this.renderer.nodes.length) return true;
        this.toast('Nothing to export yet — show some classes first.', true);
        return false;
    }

    exportSvg() {
        if (!this.hasGraph()) return;
        const { svg } = this.renderer.toSVG(this.exportOpts());
        this.download(new Blob([svg], { type: 'image/svg+xml' }), this.baseName() + '.svg');
    }

    async exportPng() {
        if (!this.hasGraph()) return;
        try {
            const blob = await this.renderer.toPNG({ ...this.exportOpts(), scale: +$('#expScale').value });
            this.download(blob, this.baseName() + '.png');
        } catch (e) { this.toast(e.message, true); }
    }

    async copyPng() {
        if (!this.hasGraph()) return;
        try {
            const blob = await this.renderer.toPNG({ ...this.exportOpts(), scale: +$('#expScale').value });
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            this.toast('Image copied to clipboard');
        } catch (e) { this.toast('Could not copy: ' + e.message, true); }
    }

    // ============================================================ save / load

    saveView() {
        if (!this.ont) { this.toast('Open an ontology first.', true); return; }
        const data = {
            feydonto: 1,
            file: this.fileName,
            ontology: this.ont.iri,
            visible: [...this.sel.visible],
            disabledProps: [...this.sel.disabledProps],
            opts: this.opts,
            style: this.style,
            layout: this.layout,
            showLegend: this.showLegend,
            positions: Object.fromEntries(this.renderer.positions),
        };
        this.download(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), this.baseName() + '.view.json');
    }

    async loadView(file) {
        try {
            if (!this.ont) throw new Error('open the ontology first, then load its saved view.');
            const d = JSON.parse(await file.text());
            if (d.feydonto !== 1) throw new Error('this is not a FeydOnto view file.');
            const known = (i) => this.ont.classes.has(i) || this.ont.individuals.has(i);
            this.sel.visible = new Set((d.visible ?? []).filter(known));
            this.sel.disabledProps = new Set(d.disabledProps ?? []);
            this.opts = { ...structuredClone(DEFAULT_OPTS), ...d.opts, edgeKinds: { ...DEFAULT_OPTS.edgeKinds, ...d.opts?.edgeKinds } };
            this.style = { ...structuredClone(DEFAULT_STYLE), ...d.style };
            this.layout = { ...this.layout, ...d.layout };
            this.showLegend = !!d.showLegend;
            this.renderer.positions = new Map(Object.entries(d.positions ?? {}));
            this.undoStack = [];
            this.redoStack = [];
            this.syncControls();
            await this.refresh('keep', { fit: true });
            this.toast('View restored');
        } catch (e) {
            this.toast('Could not load view: ' + e.message, true);
        }
    }

    // =================================================================== toast

    toast(msg, isError = false) {
        const t = $('#toast');
        t.textContent = msg;
        t.classList.toggle('error', isError);
        t.hidden = false;
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => (t.hidden = true), isError ? 7000 : 4000);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    window.feydonto = app; // handy for debugging in the console

    const params = new URLSearchParams(location.search);
    if (params.get('url')) app.loadUrl(params.get('url'));
    else if (params.get('example')) app.loadUrl(`examples/${params.get('example')}`);
});
