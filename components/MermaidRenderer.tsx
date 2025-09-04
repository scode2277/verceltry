"use client";

import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";

interface MermaidRendererProps {
  code: string;
  id: string;
}

const MermaidRenderer: React.FC<MermaidRendererProps> = ({ code, id }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const initializeMermaid = async () => {
      try {
        // Initialize Mermaid with better configuration
        mermaid.initialize({
          startOnLoad: false,
          theme: 'default',
          securityLevel: 'loose',
          fontFamily: 'Arial, sans-serif',
          flowchart: {
            useMaxWidth: true,
            htmlLabels: true,
          },
        });
        setIsInitialized(true);
      } catch (err) {
        console.error('Failed to initialize Mermaid:', err);
        setError('Failed to initialize Mermaid renderer');
        setIsLoading(false);
      }
    };

    initializeMermaid();
  }, []);

  useEffect(() => {
    if (!isInitialized || !containerRef.current) return;

    const renderMermaid = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // Clean and validate the code
        const cleanCode = code.trim();
        
        if (!cleanCode) {
          throw new Error('Empty diagram code provided');
        }

        // Ensure the code starts with a diagram type
        const diagramTypes = [
          'graph', 'flowchart', 'sequenceDiagram', 'classDiagram', 
          'stateDiagram', 'erDiagram', 'journey', 'gantt', 
          'pie', 'gitgraph', 'mindmap', 'timeline', 'block'
        ];
        
        const hasValidType = diagramTypes.some(type => 
          cleanCode.toLowerCase().startsWith(type.toLowerCase())
        );

        if (!hasValidType) {
          throw new Error(`Invalid diagram type. Must start with one of: ${diagramTypes.join(', ')}`);
        }

        // Clear previous content
        if (containerRef.current) {
          containerRef.current.innerHTML = '';
        }

        // Generate unique ID if needed
        const uniqueId = `mermaid-${id}-${Date.now()}`;
        
        // Render the diagram
        const { svg } = await mermaid.render(uniqueId, cleanCode);

        if (containerRef.current) {
          containerRef.current.innerHTML = svg;
          
          // Add some basic styling to the SVG
          const svgElement = containerRef.current.querySelector('svg');
          if (svgElement) {
            svgElement.style.maxWidth = '100%';
            svgElement.style.height = 'auto';
            svgElement.style.display = 'block';
            svgElement.style.margin = '0 auto';
          }
        }
        
        setIsLoading(false);
      } catch (err: any) {
        console.error('Mermaid rendering error:', err);
        console.error('Failed code:', code);
        
        setError(err.message || 'Unknown error occurred');
        
        if (containerRef.current) {
          containerRef.current.innerHTML = `
            <div style="
              border: 2px dashed #ff6b6b;
              border-radius: 8px;
              padding: 16px;
              background-color: #fff5f5;
              color: #d63031;
              font-family: monospace;
              font-size: 14px;
              line-height: 1.4;
            ">
              <strong>Mermaid Diagram Error:</strong><br/>
              ${err.message || 'Unknown error'}<br/><br/>
              <strong>Diagram Code:</strong><br/>
              <pre style="
                background: #f8f9fa;
                padding: 8px;
                border-radius: 4px;
                overflow-x: auto;
                margin-top: 8px;
                font-size: 12px;
              ">${code}</pre>
            </div>
          `;
        }
        
        setIsLoading(false);
      }
    };

    renderMermaid();
  }, [code, id, isInitialized]);

 

  return (
    <div 
      ref={containerRef} 
      className="mermaid-container"
      style={{
        margin: '16px 0',
        textAlign: 'center'
      }}
    />
  );
};

export default MermaidRenderer;
