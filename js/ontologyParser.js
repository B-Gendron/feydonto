// ontologyParser.js — turns an RDF Store into an ontology model
// (classes, properties, individuals, and the candidate edges between them).

import { NS, RDF, isBlank, isLiteral } from './rdf.js';

const OWL = (n) => NS.owl + n;
const RDFS = (n) => NS.rdfs + n;

const BUILTIN_NS = [NS.rdf, NS.rdfs, NS.owl, NS.xsd, 'http://www.w3.org/2003/11/swrl#', 'http://www.w3.org/2003/11/swrlb#'];
export const isBuiltin = (iri) => typeof iri === 'string' && BUILTIN_NS.some((n) => iri.startsWith(n));

const COMMENT_PREDICATES = [RDFS('comment'), NS.skos + 'definition', NS.dcterms + 'description', NS.dc + 'description'];
// Annotation predicates recognised without an owl:AnnotationProperty declaration.
const BUILTIN_ANNOTATIONS = new Set([
    RDFS('label'), RDFS('comment'), RDFS('seeAlso'), RDFS('isDefinedBy'),
    OWL('versionInfo'), OWL('deprecated'), OWL('priorVersion'), OWL('backwardCompatibleWith'), OWL('incompatibleWith'),
]);
// Vocabularies whose literal-valued properties are treated as annotations (skos:definition, dcterms:creator, …).
const ANNOTATION_NS = [NS.skos, NS.dc, NS.dcterms];
/** Short prefixes for well-known vocabularies, used when the file does not declare them. */
const KNOWN_PREFIXES = Object.entries(NS);

const PROPERTY_FLAGS = ['Functional', 'InverseFunctional', 'Transitive', 'Symmetric', 'Asymmetric', 'Reflexive', 'Irreflexive'];
const SCHEMA_TYPES = new Set([
    OWL('Class'), RDFS('Class'), OWL('ObjectProperty'), OWL('DatatypeProperty'), OWL('AnnotationProperty'),
    OWL('Ontology'), OWL('Restriction'), RDFS('Datatype'), NS.rdf + 'Property', OWL('FunctionalProperty'),
    OWL('InverseFunctionalProperty'), OWL('TransitiveProperty'), OWL('SymmetricProperty'), OWL('AsymmetricProperty'),
    OWL('ReflexiveProperty'), OWL('IrreflexiveProperty'), OWL('AllDisjointClasses'), OWL('AllDifferent'),
    OWL('AllDisjointProperties'), OWL('Axiom'), OWL('Annotation'), OWL('DataRange'), OWL('DeprecatedClass'),
]);

export function localName(iri) {
    const trimmed = iri.replace(/[#/]+$/, '');
    const m = trimmed.match(/[^#/:]+$/);
    let name = m ? m[0] : trimmed;
    try { name = decodeURIComponent(name); } catch { /* keep raw */ }
    return name;
}

const FACET_SYMBOLS = { minInclusive: '≥', maxInclusive: '≤', minExclusive: '>', maxExclusive: '<' };

export class Ontology {
    constructor(store, name = '') {
        this.store = store;
        this.name = name;
        this.prefixes = store.prefixes;
        this.labelMode = 'label'; // 'label' | 'local' | 'qname'

        this.iri = null;
        this.title = null;
        this.classes = new Map();
        this.objectProps = new Map();
        this.dataProps = new Map();
        this.individuals = new Map();
        this.annotationProps = new Map();
        this.annotationLangs = new Set();
        this.edges = [];
        this._neighbors = null;
        this._individualsByClass = new Map();

        this.build();
    }

    // ------------------------------------------------------------------ naming

    qname(iri) {
        let best = null;
        for (const [prefix, ns] of Object.entries(this.prefixes)) {
            if (ns && iri.startsWith(ns) && (!best || ns.length > best.ns.length)) best = { prefix, ns };
        }
        return best ? `${best.prefix}:${iri.slice(best.ns.length)}` : null;
    }

    entity(iri) {
        return this.classes.get(iri) || this.objectProps.get(iri) || this.dataProps.get(iri) || this.individuals.get(iri)
            || this.annotationProps.get(iri) || null;
    }

    /** Name of an annotation property: well-known vocabularies keep their prefix (rdfs:comment, skos:definition). */
    annotationName(iri) {
        if (this.labelMode !== 'local') {
            for (const [prefix, ns] of KNOWN_PREFIXES) if (iri.startsWith(ns)) return `${prefix}:${iri.slice(ns.length)}`;
        }
        return this.nameOf(iri);
    }

    /** Human name of an IRI under the current label mode. */
    nameOf(iri) {
        if (this.labelMode === 'local') return localName(iri);
        if (this.labelMode === 'qname') return this.qname(iri) ?? localName(iri);
        return this.entity(iri)?.label ?? localName(iri);
    }

    // ------------------------------------------------------------------- build

    labelOf(s) {
        const st = this.store;
        const cands = [...st.literals(s, RDFS('label')), ...st.literals(s, NS.skos + 'prefLabel')];
        if (!cands.length) return null;
        return (cands.find((l) => l.lang === 'en') || cands.find((l) => !l.lang) || cands[0]).value.trim();
    }

    commentOf(s) {
        for (const p of COMMENT_PREDICATES) {
            const c = this.store.literals(s, p);
            if (c.length) return (c.find((l) => l.lang === 'en') || c[0]).value.trim();
        }
        return null;
    }

    typesOf(s) { return this.store.nodes(s, RDF.type); }

    subjectsOfType(t) { return this.store.subjectsOf(RDF.type, t).filter((s) => !isBlank(s)); }

    /** Named classes mentioned by a class expression; unions are flattened. */
    flattenNamed(term, seen = new Set()) {
        if (isLiteral(term) || seen.has(term)) return [];
        seen.add(term);
        if (!isBlank(term)) return isBuiltin(term) ? [] : [term];
        const union = this.store.first(term, OWL('unionOf'));
        return union ? this.store.list(union).flatMap((m) => this.flattenNamed(m, seen)) : [];
    }

    ensureClass(iri) {
        if (isBuiltin(iri) || isBlank(iri)) return null;
        let c = this.classes.get(iri);
        if (!c) {
            c = this.makeEntity(iri, 'class');
            Object.assign(c, {
                superClasses: new Set(), subClasses: new Set(), equivalent: new Set(), disjoint: new Set(),
                restrictions: [], superExprs: [], equivalentExprs: [], attributes: [],
            });
            this.classes.set(iri, c);
        }
        return c;
    }

    makeEntity(iri, kind) {
        return {
            iri, kind,
            label: this.labelOf(iri) ?? localName(iri),
            comment: this.commentOf(iri),
            deprecated: this.store.literals(iri, OWL('deprecated')).some((l) => l.value === 'true'),
        };
    }

    build() {
        const st = this.store;

        // Header
        const header = this.subjectsOfType(OWL('Ontology'))[0];
        if (header) {
            this.iri = header;
            this.title = st.literals(header, NS.dc + 'title')[0]?.value
                ?? st.literals(header, NS.dcterms + 'title')[0]?.value
                ?? this.labelOf(header);
        }

        // Declared entities
        for (const iri of this.subjectsOfType(OWL('AnnotationProperty'))) if (!isBlank(iri)) this.declareAnnotationProp(iri);
        for (const t of [OWL('Class'), RDFS('Class')]) for (const iri of this.subjectsOfType(t)) this.ensureClass(iri);

        const declareProp = (iri, kind) => {
            if (isBuiltin(iri)) return;
            const map = kind === 'objectProperty' ? this.objectProps : this.dataProps;
            if (map.has(iri)) return;
            const p = this.makeEntity(iri, kind);
            Object.assign(p, { domains: [], ranges: [], rangeTexts: [], flags: [], superProps: new Set(), inverseOf: null });
            for (const f of PROPERTY_FLAGS) if (this.typesOf(iri).includes(OWL(f + 'Property'))) p.flags.push(f);
            map.set(iri, p);
        };
        for (const iri of this.subjectsOfType(OWL('ObjectProperty'))) declareProp(iri, 'objectProperty');
        for (const iri of this.subjectsOfType(OWL('DatatypeProperty'))) declareProp(iri, 'dataProperty');
        // Property-characteristic declarations without an explicit ObjectProperty type
        for (const f of PROPERTY_FLAGS) {
            for (const iri of this.subjectsOfType(OWL(f + 'Property'))) {
                if (!this.dataProps.has(iri) && !this.annotationProps.has(iri)) declareProp(iri, 'objectProperty');
            }
        }

        this.buildClassAxioms();
        this.buildPropertyAxioms();
        this.buildIndividuals();
        this.buildAttributes();
        this.buildAnnotations();
        this.buildEdges();
    }

    declareAnnotationProp(iri, implicit = false) {
        let p = this.annotationProps.get(iri);
        if (!p) {
            p = this.makeEntity(iri, 'annotationProperty');
            Object.assign(p, { domains: [], ranges: [], rangeTexts: [], flags: [], superProps: new Set(), inverseOf: null, uses: 0, implicit, annotations: [] });
            this.annotationProps.set(iri, p);
        }
        return p;
    }

    /** Is (p, o) an annotation assertion rather than a data/object property assertion? */
    isAnnotation(p, o) {
        if (this.annotationProps.has(p) || BUILTIN_ANNOTATIONS.has(p)) return true;
        if (this.objectProps.has(p) || this.dataProps.has(p)) return false;
        // skos:broader etc. between individuals stay relations; literal values are annotations.
        return ANNOTATION_NS.some((n) => p.startsWith(n)) && (isLiteral(o) || !this.individuals.has(o));
    }

    /** All annotation assertions on every named entity: ent.annotations = [{prop, value}]. */
    buildAnnotations() {
        const st = this.store;
        const maps = [this.classes, this.objectProps, this.dataProps, this.individuals];
        const collect = (ent) => {
            ent.annotations = [];
            for (const p of st.predicates(ent.iri)) {
                for (const o of st.objects(ent.iri, p)) {
                    if (isBlank(o) || !this.isAnnotation(p, o)) continue;
                    ent.annotations.push({ prop: p, value: o });
                    if (isLiteral(o) && o.lang) this.annotationLangs.add(o.lang.toLowerCase());
                }
            }
        };
        for (const map of maps) for (const ent of map.values()) collect(ent);
        // Annotation properties can themselves be annotated; collect before counting so new ones are included.
        for (const ent of [...this.annotationProps.values()]) collect(ent);
        const annotated = [...maps, this.annotationProps].flatMap((m) => [...m.values()]);
        for (const ent of annotated) for (const a of ent.annotations) this.declareAnnotationProp(a.prop, true).uses++;
    }

    buildClassAxioms() {
        const st = this.store;
        // Implicit classes from axioms
        for (const c of [...this.classes.values()]) {
            for (const p of [RDFS('subClassOf'), OWL('equivalentClass'), OWL('disjointWith')]) {
                for (const o of st.nodes(c.iri, p)) if (!isBlank(o)) this.ensureClass(o);
            }
        }

        for (const c of [...this.classes.values()]) {
            for (const o of st.nodes(c.iri, RDFS('subClassOf'))) {
                if (!isBlank(o)) {
                    const sup = this.ensureClass(o);
                    if (sup && sup !== c) { c.superClasses.add(sup.iri); sup.subClasses.add(c.iri); }
                } else {
                    c.superExprs.push(o);
                    const r = this.restrictionInfo(o);
                    if (r) c.restrictions.push(r);
                }
            }
            for (const o of st.nodes(c.iri, OWL('equivalentClass'))) {
                if (!isBlank(o)) {
                    const other = this.ensureClass(o);
                    if (other && other !== c) { c.equivalent.add(other.iri); other.equivalent.add(c.iri); }
                } else {
                    c.equivalentExprs.push(o);
                }
            }
            for (const o of st.nodes(c.iri, OWL('disjointWith'))) {
                if (isBlank(o)) continue;
                const other = this.ensureClass(o);
                if (other && other !== c) { c.disjoint.add(other.iri); other.disjoint.add(c.iri); }
            }
        }
        // owl:AllDisjointClasses / owl:disjointUnionOf are left to the inspector-level view for now.
    }

    buildPropertyAxioms() {
        const st = this.store;
        for (const map of [this.objectProps, this.dataProps]) {
            for (const p of map.values()) {
                for (const d of st.nodes(p.iri, RDFS('domain'))) {
                    for (const c of this.flattenNamed(d)) if (this.ensureClass(c)) p.domains.push(c);
                }
                for (const r of st.nodes(p.iri, RDFS('range'))) {
                    if (map === this.objectProps) {
                        for (const c of this.flattenNamed(r)) if (this.ensureClass(c)) p.ranges.push(c);
                    } else {
                        p.rangeTexts.push(this.exprText(r));
                    }
                }
                for (const sp of st.nodes(p.iri, RDFS('subPropertyOf'))) if (!isBlank(sp)) p.superProps.add(sp);
                const inv = st.nodes(p.iri, OWL('inverseOf'))[0];
                if (inv && !isBlank(inv)) p.inverseOf = inv;
            }
        }
    }

    buildIndividuals() {
        const st = this.store;
        for (const s of st.subjects()) {
            if (isBlank(s) || isBuiltin(s)) continue;
            if (this.classes.has(s) || this.objectProps.has(s) || this.dataProps.has(s) || this.annotationProps.has(s) || s === this.iri) continue;
            const types = this.typesOf(s);
            if (types.some((t) => SCHEMA_TYPES.has(t))) continue;
            const classTypes = types.filter((t) => !isBuiltin(t) && !isBlank(t));
            if (!classTypes.length && !types.includes(OWL('NamedIndividual'))) continue;

            const ind = this.makeEntity(s, 'individual');
            ind.types = [];
            for (const t of classTypes) if (this.ensureClass(t)) ind.types.push(t);
            ind.objectAssertions = [];
            ind.dataAssertions = [];
            this.individuals.set(s, ind);
            for (const t of ind.types) {
                if (!this._individualsByClass.has(t)) this._individualsByClass.set(t, []);
                this._individualsByClass.get(t).push(s);
            }
        }

        // Assertions
        for (const ind of this.individuals.values()) {
            for (const p of st.predicates(ind.iri)) {
                if (isBuiltin(p) || this.annotationProps.has(p)) continue;
                for (const o of st.objects(ind.iri, p)) {
                    if (this.isAnnotation(p, o)) continue;
                    if (isLiteral(o)) {
                        if (!this.dataProps.has(p) && !this.objectProps.has(p)) this.implicitProp(p, 'dataProperty');
                        ind.dataAssertions.push({ prop: p, value: o });
                    } else if (this.individuals.has(o)) {
                        if (!this.dataProps.has(p) && !this.objectProps.has(p)) this.implicitProp(p, 'objectProperty');
                        ind.objectAssertions.push({ prop: p, target: o });
                    }
                }
            }
        }
    }

    implicitProp(iri, kind) {
        const p = this.makeEntity(iri, kind);
        Object.assign(p, { domains: [], ranges: [], rangeTexts: [], flags: [], superProps: new Set(), inverseOf: null, implicit: true });
        (kind === 'objectProperty' ? this.objectProps : this.dataProps).set(iri, p);
    }

    buildAttributes() {
        for (const p of this.dataProps.values()) {
            for (const d of p.domains) {
                this.classes.get(d)?.attributes.push({ prop: p.iri, range: p.rangeTexts.join(' | ') });
            }
        }
    }

    buildEdges() {
        const edges = this.edges;
        const seen = new Set();
        const add = (e) => {
            e.id = `${e.kind}|${e.source}|${e.target}|${e.prop ?? ''}|${e.label ?? ''}`;
            if (seen.has(e.id)) return;
            seen.add(e.id);
            edges.push(e);
        };
        const pair = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
        const undirectedDone = new Set();

        for (const c of this.classes.values()) {
            for (const sup of c.superClasses) add({ kind: 'subClassOf', source: c.iri, target: sup });
            for (const r of c.restrictions) {
                if (r.filler && this.classes.has(r.filler) && r.kind !== 'value' && r.kind !== 'self') {
                    add({ kind: 'restriction', source: c.iri, target: r.filler, prop: r.prop, restriction: r.kind, n: r.n });
                }
            }
            for (const o of c.equivalent) {
                const k = 'eq' + pair(c.iri, o);
                if (!undirectedDone.has(k)) { undirectedDone.add(k); add({ kind: 'equivalent', source: c.iri, target: o }); }
            }
            for (const o of c.disjoint) {
                const k = 'dj' + pair(c.iri, o);
                if (!undirectedDone.has(k)) { undirectedDone.add(k); add({ kind: 'disjoint', source: c.iri, target: o }); }
            }
        }
        for (const p of this.objectProps.values()) {
            for (const d of p.domains) for (const r of p.ranges) add({ kind: 'objectProperty', source: d, target: r, prop: p.iri });
        }
        for (const ind of this.individuals.values()) {
            for (const t of ind.types) add({ kind: 'type', source: ind.iri, target: t });
            for (const a of ind.objectAssertions) add({ kind: 'assertion', source: ind.iri, target: a.target, prop: a.prop });
        }
    }

    // ------------------------------------------------------------- restrictions

    /** Describe an owl:Restriction blank node (null when it is not a simple restriction). */
    restrictionInfo(node) {
        const st = this.store;
        const prop = st.nodes(node, OWL('onProperty'))[0];
        if (!prop) return null;
        const num = (p) => {
            const l = st.literals(node, OWL(p))[0];
            return l ? Number(l.value) : null;
        };
        const named = (t) => (t && !isBlank(t) ? t : null);

        let t;
        if ((t = st.first(node, OWL('someValuesFrom'))) !== undefined) return { prop, kind: 'some', filler: named(t) };
        if ((t = st.first(node, OWL('allValuesFrom'))) !== undefined) return { prop, kind: 'only', filler: named(t) };
        if ((t = st.first(node, OWL('hasValue'))) !== undefined) return { prop, kind: 'value', filler: null, value: t };
        if (st.first(node, OWL('hasSelf')) !== undefined) return { prop, kind: 'self', filler: null };
        for (const [kind, plain, qualified] of [
            ['min', 'minCardinality', 'minQualifiedCardinality'],
            ['max', 'maxCardinality', 'maxQualifiedCardinality'],
            ['exactly', 'cardinality', 'qualifiedCardinality'],
        ]) {
            const n = num(plain) ?? num(qualified);
            if (n !== null) {
                const filler = named(st.nodes(node, OWL('onClass'))[0] ?? st.nodes(node, OWL('onDataRange'))[0] ?? null);
                return { prop, kind, n, filler };
            }
        }
        return null;
    }

    /** Manchester-style text for a class/data-range expression. */
    exprText(term, nested = false, depth = 0) {
        const st = this.store;
        if (depth > 12) return '…';
        if (isLiteral(term)) return `"${term.value}"`;
        if (!isBlank(term)) return this.nameOf(term);

        const paren = (s) => (nested ? `(${s})` : s);
        const members = (head, sep) => paren(st.list(head).map((m) => this.exprText(m, true, depth + 1)).join(sep));

        const r = this.restrictionInfo(term);
        if (r) {
            const p = this.nameOf(r.prop);
            const f = r.value !== undefined ? this.exprText(r.value, true, depth + 1)
                : r.filler ? this.nameOf(r.filler)
                : this.restrictionFillerText(term, depth);
            const kw = { some: 'some', only: 'only', value: 'value', min: `min ${r.n}`, max: `max ${r.n}`, exactly: `exactly ${r.n}`, self: 'Self' }[r.kind];
            return paren(`${p} ${kw}${r.kind === 'self' ? '' : ' ' + f}`.trim());
        }
        let h;
        if ((h = st.first(term, OWL('intersectionOf')))) return members(h, ' and ');
        if ((h = st.first(term, OWL('unionOf')))) return members(h, ' or ');
        if ((h = st.first(term, OWL('oneOf')))) return '{' + st.list(h).map((m) => this.exprText(m, true, depth + 1)).join(', ') + '}';
        if ((h = st.first(term, OWL('complementOf')))) return paren('not ' + this.exprText(h, true, depth + 1));
        if ((h = st.first(term, OWL('datatypeComplementOf')))) return paren('not ' + this.exprText(h, true, depth + 1));

        const onDt = st.nodes(term, OWL('onDatatype'))[0];
        if (onDt) {
            const facets = [];
            for (const f of st.list(st.first(term, OWL('withRestrictions')) ?? RDF.nil)) {
                for (const p of st.predicates(f)) {
                    if (!p.startsWith(NS.xsd)) continue;
                    const key = p.slice(NS.xsd.length);
                    const v = st.literals(f, p)[0]?.value ?? '';
                    const num = Number(v);
                    const shown = Number.isFinite(num) && v !== '' ? String(+num.toFixed(3)) : v;
                    facets.push(`${FACET_SYMBOLS[key] ?? key} ${shown}`);
                }
            }
            return `${this.nameOf(onDt)}[${facets.join(', ')}]`;
        }
        return '⟨anonymous⟩';
    }

    restrictionFillerText(node, depth) {
        const st = this.store;
        for (const p of ['someValuesFrom', 'allValuesFrom', 'onClass', 'onDataRange']) {
            const t = st.first(node, OWL(p));
            if (t !== undefined) return this.exprText(t, true, depth + 1);
        }
        return '';
    }

    // ---------------------------------------------------------------- traversal

    individualsOf(classIri) { return this._individualsByClass.get(classIri) ?? []; }

    descendants(iri) {
        const out = new Set();
        const stack = [iri];
        while (stack.length) {
            for (const c of this.classes.get(stack.pop())?.subClasses ?? []) if (!out.has(c) && c !== iri) { out.add(c); stack.push(c); }
        }
        return out;
    }

    ancestors(iri) {
        const out = new Set();
        const stack = [iri];
        while (stack.length) {
            for (const c of this.classes.get(stack.pop())?.superClasses ?? []) if (!out.has(c) && c !== iri) { out.add(c); stack.push(c); }
        }
        return out;
    }

    /** Undirected neighbours of an entity through all candidate edges. */
    neighbors(iri) {
        if (!this._neighbors) {
            const m = new Map();
            const link = (a, b) => { if (!m.has(a)) m.set(a, new Set()); m.get(a).add(b); };
            for (const e of this.edges) { link(e.source, e.target); link(e.target, e.source); }
            this._neighbors = m;
        }
        return this._neighbors.get(iri) ?? new Set();
    }

    get stats() {
        return {
            classes: this.classes.size,
            objectProps: this.objectProps.size,
            dataProps: this.dataProps.size,
            individuals: this.individuals.size,
            annotationProps: this.annotationProps.size,
            triples: this.store.tripleCount,
        };
    }
}
