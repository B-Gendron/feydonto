class OntologyParser {
    constructor() {
        this.classes = new Map();
        this.properties = new Map();
        this.relationships = [];
    }

    parseOWL(xmlDoc) {
        const namespaces = this.extractNamespaces(xmlDoc);
        
        // Parse classes
        this.parseClasses(xmlDoc, namespaces);
        
        // Parse properties
        this.parseProperties(xmlDoc, namespaces);
        
        return this.buildGraph();
    }

    extractNamespaces(xmlDoc) {
        const ns = {
            owl: 'http://www.w3.org/2002/07/owl#',
            rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
            rdfs: 'http://www.w3.org/2000/01/rdf-schema#'
        };
        return ns;
    }

    parseClasses(xmlDoc, ns) {
        // Parse owl:Class elements
        const classes = xmlDoc.querySelectorAll('owl\\:Class, Class');
        
        classes.forEach(cls => {
            const about = cls.getAttribute('rdf:about') || cls.getAttribute('about');
            if (!about) return;
            
            const id = this.extractLocalName(about);
            const label = this.getLabel(cls) || id;
            
            this.classes.set(id, {
                id,
                label,
                uri: about,
                type: 'class'
            });
            
            // Parse subClassOf relationships
            const subClassOf = cls.querySelectorAll('rdfs\\:subClassOf, subClassOf');
            subClassOf.forEach(sub => {
                const resource = sub.getAttribute('rdf:resource') || sub.getAttribute('resource');
                if (resource) {
                    const parentId = this.extractLocalName(resource);
                    this.relationships.push({
                        source: id,
                        target: parentId,
                        type: 'subClassOf'
                    });
                }
            });
        });
    }

    parseProperties(xmlDoc, ns) {
        // Parse ObjectProperty and DatatypeProperty
        const properties = xmlDoc.querySelectorAll(
            'owl\\:ObjectProperty, ObjectProperty, owl\\:DatatypeProperty, DatatypeProperty'
        );
        
        properties.forEach(prop => {
            const about = prop.getAttribute('rdf:about') || prop.getAttribute('about');
            if (!about) return;
            
            const id = this.extractLocalName(about);
            const label = this.getLabel(prop) || id;
            
            this.properties.set(id, {
                id,
                label,
                uri: about,
                type: 'property'
            });
            
            // Parse domain and range
            const domain = prop.querySelector('rdfs\\:domain, domain');
            const range = prop.querySelector('rdfs\\:range, range');
            
            if (domain && range) {
                const domainResource = domain.getAttribute('rdf:resource') || domain.getAttribute('resource');
                const rangeResource = range.getAttribute('rdf:resource') || range.getAttribute('resource');
                
                if (domainResource && rangeResource) {
                    const sourceId = this.extractLocalName(domainResource);
                    const targetId = this.extractLocalName(rangeResource);
                    
                    this.relationships.push({
                        source: sourceId,
                        target: targetId,
                        type: 'property',
                        label: label
                    });
                }
            }
        });
    }

    getLabel(element) {
        const label = element.querySelector('rdfs\\:label, label');
        return label ? label.textContent.trim() : null;
    }

    extractLocalName(uri) {
        const parts = uri.split(/[#\/]/);
        return parts[parts.length - 1];
    }

    buildGraph() {
        const nodes = [
            ...Array.from(this.classes.values()),
            ...Array.from(this.properties.values())
        ];
        
        return {
            nodes,
            links: this.relationships,
            classes: this.classes,
            properties: this.properties
        };
    }
}