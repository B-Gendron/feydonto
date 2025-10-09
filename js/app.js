// app.js - Main application logic and UI handling

import { OntologyParser } from './ontologyParser.js';
import { GraphRenderer } from './graphRenderer.js';

class OntologyVisualizerApp {
    constructor() {
        this.parser = new OntologyParser();
        this.renderer = new GraphRenderer('graph');
        this.currentData = null;
        
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        // File input handler
        document.getElementById('fileInput').addEventListener('change', (e) => {
            this.handleFileUpload(e);
        });

        // Load example button
        document.getElementById('loadExample').addEventListener('click', () => {
            this.loadExampleOntology();
        });

        // Reset zoom button
        document.getElementById('resetZoom').addEventListener('click', () => {
            this.renderer.resetZoom();
        });

        // Window resize handler
        window.addEventListener('resize', () => {
            if (this.currentData) {
                this.renderer.render(this.currentData);
            }
        });
    }

    async handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        try {
            const text = await file.text();
            const xmlDoc = new DOMParser().parseFromString(text, 'text/xml');
            
            // Check for parsing errors
            const parserError = xmlDoc.querySelector('parsererror');
            if (parserError) {
                throw new Error('Invalid XML format');
            }
            
            this.currentData = this.parser.parseOWL(xmlDoc);
            this.displayGraph(this.currentData);
        } catch (error) {
            alert('Error parsing ontology: ' + error.message);
            console.error(error);
        }
    }

    async loadExampleOntology() {
        try {
            // Fetch the example ontology file
            const response = await fetch('examples/sample-ontology.owl');
            
            if (!response.ok) {
                throw new Error('Could not load example ontology');
            }
            
            const text = await response.text();
            const xmlDoc = new DOMParser().parseFromString(text, 'text/xml');
            
            this.currentData = this.parser.parseOWL(xmlDoc);
            this.displayGraph(this.currentData);
        } catch (error) {
            console.error('Error loading example:', error);
            
            // Fallback: use inline example if file doesn't exist
            this.loadInlineExample();
        }
    }

    loadInlineExample() {
        const exampleOWL = `<?xml version="1.0"?>
<rdf:RDF xmlns="http://www.example.org/ontology#"
     xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
     xmlns:owl="http://www.w3.org/2002/07/owl#"
     xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#">
    
    <owl:Ontology rdf:about="http://www.example.org/ontology"/>
    
    <!-- Classes -->
    <owl:Class rdf:about="http://www.example.org/ontology#Animal">
        <rdfs:label>Animal</rdfs:label>
    </owl:Class>
    
    <owl:Class rdf:about="http://www.example.org/ontology#Mammal">
        <rdfs:label>Mammal</rdfs:label>
        <rdfs:subClassOf rdf:resource="http://www.example.org/ontology#Animal"/>
    </owl:Class>
    
    <owl:Class rdf:about="http://www.example.org/ontology#Bird">
        <rdfs:label>Bird</rdfs:label>
        <rdfs:subClassOf rdf:resource="http://www.example.org/ontology#Animal"/>
    </owl:Class>
    
    <owl:Class rdf:about="http://www.example.org/ontology#Dog">
        <rdfs:label>Dog</rdfs:label>
        <rdfs:subClassOf rdf:resource="http://www.example.org/ontology#Mammal"/>
    </owl:Class>
    
    <owl:Class rdf:about="http://www.example.org/ontology#Cat">
        <rdfs:label>Cat</rdfs:label>
        <rdfs:subClassOf rdf:resource="http://www.example.org/ontology#Mammal"/>
    </owl:Class>
    
    <owl:Class rdf:about="http://www.example.org/ontology#Person">
        <rdfs:label>Person</rdfs:label>
    </owl:Class>
    
    <!-- Object Properties -->
    <owl:ObjectProperty rdf:about="http://www.example.org/ontology#owns">
        <rdfs:label>owns</rdfs:label>
        <rdfs:domain rdf:resource="http://www.example.org/ontology#Person"/>
        <rdfs:range rdf:resource="http://www.example.org/ontology#Animal"/>
    </owl:ObjectProperty>
    
    <owl:ObjectProperty rdf:about="http://www.example.org/ontology#eats">
        <rdfs:label>eats</rdfs:label>
        <rdfs:domain rdf:resource="http://www.example.org/ontology#Animal"/>
        <rdfs:range rdf:resource="http://www.example.org/ontology#Animal"/>
    </owl:ObjectProperty>
    
</rdf:RDF>`;
        
        const xmlDoc = new DOMParser().parseFromString(exampleOWL, 'text/xml');
        this.currentData = this.parser.parseOWL(xmlDoc);
        this.displayGraph(this.currentData);
    }

    displayGraph(data) {
        // Hide welcome message
        const welcomeDiv = document.getElementById('welcome');
        if (welcomeDiv) {
            welcomeDiv.style.display = 'none';
        }
        
        // Render the graph
        this.renderer.render(data);
        
        // Update statistics in the sidebar
        this.updateStatistics(data);
    }

    updateStatistics(data) {
        const classCount = document.getElementById('classCount');
        const propertyCount = document.getElementById('propertyCount');
        const relationCount = document.getElementById('relationCount');
        
        if (classCount) classCount.textContent = data.classes.size;
        if (propertyCount) propertyCount.textContent = data.properties.size;
        if (relationCount) relationCount.textContent = data.links.length;
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const app = new OntologyVisualizerApp();
    
    // Expose app instance globally for debugging
    window.ontologyApp = app;
});


// const parser = new OntologyParser();
// const renderer = new GraphRenderer('graph');
// let currentData = null;

// document.getElementById('fileInput').addEventListener('change', async (e) => {
//     const file = e.target.files[0];
//     if (!file) return;
    
//     try {
//         const text = await file.text();
//         const xmlDoc = new DOMParser().parseFromString(text, 'text/xml');
        
//         currentData = parser.parseOWL(xmlDoc);
//         displayGraph(currentData);
//     } catch (error) {
//         alert('Error parsing ontology: ' + error.message);
//         console.error(error);
//     }
// });

// document.getElementById('loadExample').addEventListener('click', () => {
//     loadExampleOntology();
// });

// document.getElementById('resetZoom').addEventListener('click', () => {
//     renderer.resetZoom();
// });

// function displayGraph(data) {
//     document.getElementById('welcome').style.display = 'none';
    
//     renderer.render(data);
    
//     // Update statistics
//     document.getElementById('classCount').textContent = data.classes.size;
//     document.getElementById('propertyCount').textContent = data.properties.size;
//     document.getElementById('relationCount').textContent = data.links.length;
// }

// function loadExampleOntology() {
//     const exampleOWL = `<?xml version="1.0"?>
// <rdf:RDF xmlns="http://www.example.org/ontology#"
// xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
// xmlns:owl="http://www.w3.org/2002/07/owl#"
// xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#">

// <owl:Ontology rdf:about="http://www.example.org/ontology"/>

// <!-- Classes -->
// <owl:Class rdf:about="http://www.example.org/ontology#Animal">
// <rdfs:label>Animal</rdfs:label>
// </owl:Class>

// <owl:Class rdf:about="http://www.example.org/ontology#Mammal">
// <rdfs:label>Mammal</rdfs:label>
// <rdfs:subClassOf rdf:resource="http://www.example.org/ontology#Animal"/>
// </owl:Class>

// <owl:Class rdf:about="http://www.example.org/ontology#Bird">
// <rdfs:label>Bird</rdfs:label>
// <rdfs:subClassOf rdf:resource="http://www.example.org/ontology#Animal"/>
// </owl:Class>

// <owl:Class rdf:about="http://www.example.org/ontology#Dog">
// <rdfs:label>Dog</rdfs:label>
// <rdfs:subClassOf rdf:resource="http://www.example.org/ontology#Mammal"/>
// </owl:Class>

// <owl:Class rdf:about="http://www.example.org/ontology#Cat">
// <rdfs:label>Cat</rdfs:label>
// <rdfs:subClassOf rdf:resource="http://www.example.org/ontology#Mammal"/>
// </owl:Class>

// <owl:Class rdf:about="http://www.example.org/ontology#Person">
// <rdfs:label>Person</rdfs:label>
// </owl:Class>

// <!-- Object Properties -->
// <owl:ObjectProperty rdf:about="http://www.example.org/ontology#owns">
// <rdfs:label>owns</rdfs:label>
// <rdfs:domain rdf:resource="http://www.example.org/ontology#Person"/>
// <rdfs:range rdf:resource="http://www.example.org/ontology#Animal"/>
// </owl:ObjectProperty>

// <owl:ObjectProperty rdf:about="http://www.example.org/ontology#eats">
// <rdfs:label>eats</rdfs:label>
// <rdfs:domain rdf:resource="http://www.example.org/ontology#Animal"/>
// <rdfs:range rdf:resource="http://www.example.org/ontology#Animal"/>
// </owl:ObjectProperty>

// </rdf:RDF>`;
    
//     const xmlDoc = new DOMParser().parseFromString(exampleOWL, 'text/xml');
//     currentData = parser.parseOWL(xmlDoc);
//     displayGraph(currentData);
// }

// // Resize handler
// window.addEventListener('resize', () => {
//     if (currentData) {
//         renderer.render(currentData);
//     }
// });