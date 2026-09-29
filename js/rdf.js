// rdf.js — minimal RDF toolkit: triple store, RDF/XML parser, Turtle/N-Triples via N3.js.
//
// Term representation (kept deliberately tiny):
//   IRI            -> string           'http://ex.org/A'
//   blank node     -> string           '_:b1'
//   literal        -> object           { value, lang, datatype }   (lang/datatype '' when absent)

export const NS = {
    rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
    rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
    owl: 'http://www.w3.org/2002/07/owl#',
    xsd: 'http://www.w3.org/2001/XMLSchema#',
    skos: 'http://www.w3.org/2004/02/skos/core#',
    dc: 'http://purl.org/dc/elements/1.1/',
    dcterms: 'http://purl.org/dc/terms/',
};

export const RDF = {
    type: NS.rdf + 'type',
    first: NS.rdf + 'first',
    rest: NS.rdf + 'rest',
    nil: NS.rdf + 'nil',
};

export const isBlank = (t) => typeof t === 'string' && t.startsWith('_:');
export const isLiteral = (t) => typeof t === 'object' && t !== null;
export const literal = (value, lang = '', datatype = '') => ({ value, lang, datatype });

const termKey = (o) => (typeof o === 'string' ? o : `"${o.value}"@${o.lang}^^${o.datatype}`);

export class Store {
    constructor() {
        this.spo = new Map(); // s -> Map(p -> [o])
        this.pos = new Map(); // p -> Map(o -> [s])   (non-literal objects only)
        this.prefixes = {};
        this.tripleCount = 0;
    }

    add(s, p, o) {
        let po = this.spo.get(s);
        if (!po) this.spo.set(s, (po = new Map()));
        let os = po.get(p);
        if (!os) po.set(p, (os = []));
        const key = termKey(o);
        if (os.some((x) => termKey(x) === key)) return;
        os.push(o);
        this.tripleCount++;
        if (typeof o === 'string') {
            let m = this.pos.get(p);
            if (!m) this.pos.set(p, (m = new Map()));
            let ss = m.get(o);
            if (!ss) m.set(o, (ss = []));
            ss.push(s);
        }
    }

    objects(s, p) { return this.spo.get(s)?.get(p) ?? []; }
    /** Non-literal objects (IRIs and blank nodes). */
    nodes(s, p) { return this.objects(s, p).filter((o) => typeof o === 'string'); }
    literals(s, p) { return this.objects(s, p).filter(isLiteral); }
    first(s, p) { return this.objects(s, p)[0]; }
    subjectsOf(p, o) { return this.pos.get(p)?.get(o) ?? []; }
    subjects() { return this.spo.keys(); }
    predicates(s) { return [...(this.spo.get(s)?.keys() ?? [])]; }
    has(s) { return this.spo.has(s); }

    /** Walk an rdf:List starting at `head`. */
    list(head) {
        const out = [];
        const seen = new Set();
        let n = head;
        while (n && n !== RDF.nil && !seen.has(n)) {
            seen.add(n);
            const f = this.first(n, RDF.first);
            if (f !== undefined) out.push(f);
            n = this.first(n, RDF.rest);
        }
        return out;
    }
}

// ---------------------------------------------------------------------------
// RDF/XML
// ---------------------------------------------------------------------------

const XMLNS = 'http://www.w3.org/2000/xmlns/';
const XMLNS_XML = 'http://www.w3.org/XML/1998/namespace';
const RDF_CORE_ATTRS = new Set(['about', 'ID', 'nodeID', 'resource', 'parseType', 'datatype', 'bagID']);

class RdfXmlParser {
    constructor(store, docBase) {
        this.store = store;
        this.docBase = docBase;
        this.counter = 0;
        this.nodeIds = new Map();
    }

    resolve(ref, base) {
        try {
            return base ? new URL(ref, base).href : new URL(ref).href;
        } catch {
            return ref;
        }
    }

    bnode() { return `_:b${++this.counter}`; }
    namedBnode(id) {
        if (!this.nodeIds.has(id)) this.nodeIds.set(id, `_:n_${id}`);
        return this.nodeIds.get(id);
    }

    collectPrefixes(doc) {
        for (const el of doc.querySelectorAll('*')) {
            for (const a of el.attributes) {
                if (a.namespaceURI === XMLNS) {
                    const prefix = a.name === 'xmlns' ? '' : a.localName;
                    if (!(prefix in this.store.prefixes)) this.store.prefixes[prefix] = a.value;
                }
            }
        }
    }

    parse(doc) {
        this.collectPrefixes(doc);
        const root = doc.documentElement;
        const base = root.hasAttributeNS(XMLNS_XML, 'base')
            ? this.resolve(root.getAttributeNS(XMLNS_XML, 'base'), this.docBase)
            : this.docBase;
        if (root.namespaceURI === NS.rdf && root.localName === 'RDF') {
            const lang = root.getAttributeNS(XMLNS_XML, 'lang') || '';
            for (const child of root.children) this.nodeElement(child, base, lang);
        } else {
            this.nodeElement(root, base, '');
        }
    }

    scope(el, base, lang) {
        if (el.hasAttributeNS(XMLNS_XML, 'base')) base = this.resolve(el.getAttributeNS(XMLNS_XML, 'base'), base);
        if (el.hasAttributeNS(XMLNS_XML, 'lang')) lang = el.getAttributeNS(XMLNS_XML, 'lang');
        return [base, lang];
    }

    /** Add triples for property-attributes (everything that is not an RDF/XML/xmlns keyword). */
    propertyAttributes(el, subject, base, lang) {
        for (const a of el.attributes) {
            if (a.namespaceURI === XMLNS || a.namespaceURI === XMLNS_XML || !a.namespaceURI) continue;
            if (a.namespaceURI === NS.rdf) {
                if (a.localName === 'type') {
                    this.store.add(subject, RDF.type, this.resolve(a.value, base));
                    continue;
                }
                if (RDF_CORE_ATTRS.has(a.localName) || a.localName === 'li') continue;
            }
            this.store.add(subject, a.namespaceURI + a.localName, literal(a.value, lang));
        }
    }

    hasPropertyAttributes(el) {
        for (const a of el.attributes) {
            if (a.namespaceURI === XMLNS || a.namespaceURI === XMLNS_XML || !a.namespaceURI) continue;
            if (a.namespaceURI === NS.rdf && RDF_CORE_ATTRS.has(a.localName)) continue;
            return true;
        }
        return false;
    }

    nodeElement(el, base, lang) {
        [base, lang] = this.scope(el, base, lang);
        const rdfAttr = (n) => (el.hasAttributeNS(NS.rdf, n) ? el.getAttributeNS(NS.rdf, n) : null);

        let subject;
        if (rdfAttr('about') !== null) subject = this.resolve(rdfAttr('about'), base);
        else if (rdfAttr('ID') !== null) subject = this.resolve('#' + rdfAttr('ID'), base);
        else if (rdfAttr('nodeID') !== null) subject = this.namedBnode(rdfAttr('nodeID'));
        else subject = this.bnode();

        if (!(el.namespaceURI === NS.rdf && el.localName === 'Description')) {
            this.store.add(subject, RDF.type, el.namespaceURI + el.localName);
        }
        this.propertyAttributes(el, subject, base, lang);

        let li = 0;
        for (const child of el.children) this.propertyElement(child, subject, base, lang, () => ++li);
        return subject;
    }

    propertyElement(el, subject, base, lang, nextLi) {
        [base, lang] = this.scope(el, base, lang);
        let predicate = el.namespaceURI + el.localName;
        if (predicate === NS.rdf + 'li') predicate = `${NS.rdf}_${nextLi()}`;
        const rdfAttr = (n) => (el.hasAttributeNS(NS.rdf, n) ? el.getAttributeNS(NS.rdf, n) : null);
        const parseType = rdfAttr('parseType');
        const store = this.store;

        if (parseType === 'Resource') {
            const obj = this.bnode();
            store.add(subject, predicate, obj);
            let li = 0;
            for (const child of el.children) this.propertyElement(child, obj, base, lang, () => ++li);
            return;
        }
        if (parseType === 'Collection') {
            const items = [...el.children].map((c) => this.nodeElement(c, base, lang));
            let head = RDF.nil;
            for (let i = items.length - 1; i >= 0; i--) {
                const cell = this.bnode();
                store.add(cell, RDF.first, items[i]);
                store.add(cell, RDF.rest, head);
                head = cell;
            }
            store.add(subject, predicate, head);
            return;
        }
        if (parseType === 'Literal') {
            const ser = new XMLSerializer();
            const xml = [...el.childNodes].map((n) => ser.serializeToString(n)).join('');
            store.add(subject, predicate, literal(xml, '', NS.rdf + 'XMLLiteral'));
            return;
        }

        const resource = rdfAttr('resource');
        const nodeID = rdfAttr('nodeID');
        if (resource !== null || nodeID !== null || (el.children.length === 0 && this.hasPropertyAttributes(el))) {
            const obj = resource !== null ? this.resolve(resource, base)
                : nodeID !== null ? this.namedBnode(nodeID)
                : this.bnode();
            this.propertyAttributes(el, obj, base, lang);
            store.add(subject, predicate, obj);
            return;
        }
        if (el.children.length > 0) {
            store.add(subject, predicate, this.nodeElement(el.children[0], base, lang));
            return;
        }
        const dt = rdfAttr('datatype');
        store.add(subject, predicate, literal(el.textContent, dt ? '' : lang, dt ? this.resolve(dt, base) : ''));
    }
}

// ---------------------------------------------------------------------------
// Turtle / N-Triples / N3 (through N3.js)
// ---------------------------------------------------------------------------

function parseTurtle(text, store, base) {
    const N3 = window.N3;
    if (!N3) throw new Error('The N3.js library could not be loaded (are you offline?), so Turtle files cannot be read.');
    const conv = (t) => (t.termType === 'BlankNode' ? '_:' + t.value : t.value);
    return new Promise((resolve, reject) => {
        const parser = new N3.Parser({ baseIRI: base });
        parser.parse(text, (err, quad, prefixes) => {
            if (err) return reject(err);
            if (quad) {
                let o;
                if (quad.object.termType === 'Literal') {
                    const dt = quad.object.datatype?.value ?? '';
                    const plain = dt === NS.xsd + 'string' || dt === NS.rdf + 'langString';
                    o = literal(quad.object.value, quad.object.language || '', plain ? '' : dt);
                } else {
                    o = conv(quad.object);
                }
                store.add(conv(quad.subject), quad.predicate.value, o);
            } else {
                for (const [k, v] of Object.entries(prefixes || {})) store.prefixes[k] = typeof v === 'string' ? v : v.value;
                resolve();
            }
        });
    });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const XML_START = /^<(\?xml|!DOCTYPE|!--|[A-Za-z_][\w.-]*:[\w.-]+[\s>/])/;

/** Parse RDF text (RDF/XML or Turtle/N-Triples, auto-detected) into a Store. */
export async function parseRDF(text, filename = '') {
    const store = new Store();
    const t = text.replace(/^﻿/, '').trimStart();
    const base = 'urn:x-feydonto:' + (filename || 'document');

    if (XML_START.test(t)) {
        const doc = new DOMParser().parseFromString(t, 'application/xml');
        const err = doc.getElementsByTagName('parsererror')[0];
        if (err) throw new Error('Invalid XML: ' + err.textContent.trim().split('\n')[0]);
        const root = doc.documentElement;
        if (root.namespaceURI === NS.owl && root.localName === 'Ontology') {
            throw new Error('This is OWL/XML syntax. Please re-save it from Protégé as "RDF/XML" or "Turtle" (File → Save as…).');
        }
        new RdfXmlParser(store, base).parse(doc);
    } else if (/^[{[]/.test(t)) {
        throw new Error('JSON-LD is not supported yet. Please convert the file to RDF/XML or Turtle.');
    } else if (/^(Prefix|Ontology)\s*\(/.test(t)) {
        throw new Error('This is OWL Functional syntax. Please re-save it from Protégé as "RDF/XML" or "Turtle".');
    } else {
        try {
            await parseTurtle(t, store, base);
        } catch (e) {
            throw new Error('Could not parse as Turtle: ' + e.message);
        }
    }
    if (store.tripleCount === 0) throw new Error('No RDF statements found in this file.');
    return store;
}
