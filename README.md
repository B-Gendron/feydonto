# FeydOnto

An ontology viewer built for **figures you can put in papers and demos**.
Named after Feydo, a very good cat.

- **Choose exactly what to draw** – tick individual classes, properties and *individuals*
  (e.g. three individuals out of ten thousand). Shift-click a class to include its whole subtree.
- **Explore from the canvas** – double-click a node to reveal its neighbours; right-click for
  *show subclasses / superclasses / individuals / connected*, *isolate*, *hide*.
- **Publication-quality output** – hierarchical (ELK) layout where layers = taxonomy depth, UML-style
  hollow subclass arrows, datatype properties as attribute rows inside class boxes, `some / only / min / max`
  restrictions as labelled edges, print-friendly and black & white themes, serif fonts, legend.
- **Export** clean, editable **SVG** (real text, no external CSS) or **PNG** up to 4×, or copy the PNG to the clipboard.
- **Reproducible figures** – *Save view* stores selection, layout, positions and style as JSON; *Load view* restores it.
- Undo / redo (Ctrl/⌘+Z), quick search (`/`), drag & drop files, `?url=https://…/onto.ttl` deep links.

Reads **RDF/XML** (`.rdf`, `.owl`), **Turtle**, **N-Triples**. (Protégé's OWL/XML and Functional syntax: re-save as RDF/XML or Turtle.)

## Run

It is a static site with ES modules, so serve the folder over HTTP:

```sh
python3 -m http.server 8000     # then open http://localhost:8000
```

It can be hosted as-is on GitHub Pages. Libraries (d3, elkjs, N3.js) are loaded from CDNs.

## Layout of the code

| file | role |
| --- | --- |
| `js/rdf.js` | triple store, RDF/XML parser, Turtle via N3.js |
| `js/ontologyParser.js` | RDF → classes / properties / individuals / restrictions, Manchester-style expression text |
| `js/viewModel.js` | ontology + user selection → the nodes and edges to draw |
| `js/graphRenderer.js` | ELK layout, SVG drawing, edge routing, SVG/PNG export |
| `js/style.js` | themes, fonts, edge vocabulary |
| `js/app.js` | UI: lists, inspector, context menu, undo, save/load view |

## Not yet supported

JSON-LD and OWL/XML input; class expressions other than simple restrictions are shown as text in the
inspector, not as diagram nodes; property hierarchies (`subPropertyOf`) are listed in the inspector only.
