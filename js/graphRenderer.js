class GraphRenderer {
    constructor(svgId) {
        this.svg = d3.select(`#${svgId}`);
        this.g = this.svg.append('g');
        this.width = 0;
        this.height = 0;
        this.simulation = null;
        
        this.setupZoom();
        this.setupMarkers();
    }

    setupZoom() {
        const zoom = d3.zoom()
            .scaleExtent([0.1, 4])
            .on('zoom', (event) => {
                this.g.attr('transform', event.transform);
            });
        
        this.svg.call(zoom);
        this.zoom = zoom;
    }

    setupMarkers() {
        const defs = this.svg.append('defs');
        
        // Arrow for subClassOf
        defs.append('marker')
            .attr('id', 'arrow-subclass')
            .attr('viewBox', '0 -5 10 10')
            .attr('refX', 20)
            .attr('refY', 0)
            .attr('markerWidth', 6)
            .attr('markerHeight', 6)
            .attr('orient', 'auto')
            .append('path')
            .attr('d', 'M0,-5L10,0L0,5')
            .attr('fill', '#999');
        
        // Arrow for properties
        defs.append('marker')
            .attr('id', 'arrow-property')
            .attr('viewBox', '0 -5 10 10')
            .attr('refX', 20)
            .attr('refY', 0)
            .attr('markerWidth', 6)
            .attr('markerHeight', 6)
            .attr('orient', 'auto')
            .append('path')
            .attr('d', 'M0,-5L10,0L0,5')
            .attr('fill', '#667eea');
    }

    render(data) {
        this.g.selectAll('*').remove();
        
        const container = document.querySelector('.canvas');
        this.width = container.clientWidth;
        this.height = container.clientHeight;
        
        this.svg
            .attr('width', this.width)
            .attr('height', this.height);
        
        // Create force simulation
        this.simulation = d3.forceSimulation(data.nodes)
            .force('link', d3.forceLink(data.links)
                .id(d => d.id)
                .distance(d => d.type === 'subClassOf' ? 100 : 150))
            .force('charge', d3.forceManyBody().strength(-400))
            .force('center', d3.forceCenter(this.width / 2, this.height / 2))
            .force('collision', d3.forceCollide().radius(50));
        
        // Create links
        const link = this.g.append('g')
            .selectAll('line')
            .data(data.links)
            .enter().append('line')
            .attr('class', d => `link link-${d.type}`)
            .attr('stroke-width', d => d.type === 'subClassOf' ? 2 : 1.5);
        
        // Create link labels
        const linkLabel = this.g.append('g')
            .selectAll('text')
            .data(data.links.filter(d => d.label))
            .enter().append('text')
            .attr('class', 'link-label')
            .text(d => d.label);
        
        // Create nodes
        const node = this.g.append('g')
            .selectAll('g')
            .data(data.nodes)
            .enter().append('g')
            .attr('class', 'node')
            .call(d3.drag()
                .on('start', (event, d) => this.dragStarted(event, d))
                .on('drag', (event, d) => this.dragged(event, d))
                .on('end', (event, d) => this.dragEnded(event, d)));
        
        // Add circles to nodes
        node.append('circle')
            .attr('r', d => d.type === 'property' ? 8 : 15)
            .attr('fill', d => {
                if (d.type === 'property') return '#ed8936';
                // Check if it's a root class (no parent)
                const hasParent = data.links.some(l => 
                    l.source.id === d.id && l.type === 'subClassOf');
                return hasParent ? '#48bb78' : '#667eea';
            });
        
        // Add labels to nodes
        node.append('text')
            .attr('class', 'node-label')
            .attr('dy', 25)
            .attr('text-anchor', 'middle')
            .text(d => d.label);
        
        // Add tooltips
        const tooltip = d3.select('#tooltip');
        node.on('mouseover', (event, d) => {
            tooltip
                .style('opacity', 1)
                .html(`<strong>${d.label}</strong><br>Type: ${d.type}<br>URI: ${d.uri}`)
                .style('left', (event.pageX + 10) + 'px')
                .style('top', (event.pageY - 10) + 'px');
        })
        .on('mouseout', () => {
            tooltip.style('opacity', 0);
        });
        
        // Update positions on tick
        this.simulation.on('tick', () => {
            link
                .attr('x1', d => d.source.x)
                .attr('y1', d => d.source.y)
                .attr('x2', d => d.target.x)
                .attr('y2', d => d.target.y);
            
            linkLabel
                .attr('x', d => (d.source.x + d.target.x) / 2)
                .attr('y', d => (d.source.y + d.target.y) / 2);
            
            node.attr('transform', d => `translate(${d.x},${d.y})`);
        });
    }

    dragStarted(event, d) {
        if (!event.active) this.simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
    }

    dragged(event, d) {
        d.fx = event.x;
        d.fy = event.y;
    }

    dragEnded(event, d) {
        if (!event.active) this.simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
    }

    resetZoom() {
        this.svg.transition().duration(750).call(
            this.zoom.transform,
            d3.zoomIdentity
        );
    }
}