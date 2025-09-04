"use client";

import { useEffect, useRef } from "react";
import mermaid from "mermaid";

interface MermaidRendererProps {
  code: string;
  id: string;
}

const MermaidRenderer: React.FC<MermaidRendererProps> = ({ code, id }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const renderDiagram = async () => {
      try {
        // Initialize mermaid (optional if global config needed)
        mermaid.initialize({ startOnLoad: false });

        // render returns { svg: string; bindFunctions: () => void }
        const { svg } = await mermaid.render(id, code);

        if (containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      } catch (err: any) {
        if (containerRef.current) {
          containerRef.current.innerHTML = `<pre style="color:red;">Error rendering Mermaid diagram: ${err.message}</pre>`;
        }
        console.error(err);
      }
    };

    renderDiagram();
  }, [code, id]);

  return <div ref={containerRef} className="mermaid" />;
};

export default MermaidRenderer;
