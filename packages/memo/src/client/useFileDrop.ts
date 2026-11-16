import { useRef, useState, type DragEvent } from 'react';

interface FileDropHandlers {
  onDragEnter: (event: DragEvent<HTMLElement>) => void; onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: () => void; onDrop: (event: DragEvent<HTMLElement>) => void;
}
const hasFiles = (event: DragEvent<HTMLElement>): boolean => Array.from(event.dataTransfer?.types ?? []).includes('Files');

export function useFileDrop(onFiles: (files: File[]) => void, locked: boolean): { dragging: boolean; bind: FileDropHandlers } {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const end = (): void => { depth.current = 0; setDragging(false); };
  const bind: FileDropHandlers = {
    onDragEnter: event => { if (locked || !hasFiles(event)) return; event.preventDefault(); depth.current++; setDragging(true); },
    onDragOver: event => { if (locked || !hasFiles(event)) return; event.preventDefault(); },
    onDragLeave: () => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); },
    onDrop: event => {
      if (!hasFiles(event)) return;
      event.preventDefault(); end();
      if (!locked && event.dataTransfer.files.length) onFiles(Array.from(event.dataTransfer.files));
    },
  };
  return { dragging, bind };
}
