interface MarkdownNode { type: string; value?: string; children?: MarkdownNode[] }

/** 표의 줄바꿈만 허용한다. 나머지 HTML은 Markdown 렌더러의 기본 정책을 따른다. */
export function clipboardBreaks(): (tree: MarkdownNode) => void {
  return (tree: MarkdownNode): void => {
    const visit = (node: MarkdownNode, inCell: boolean): void => {
      const cell = inCell || node.type === 'tableCell';
      if (cell && node.type === 'html' && /^<br\s*\/?\s*>$/i.test(node.value ?? '')) { node.type = 'break'; delete node.value; }
      node.children?.forEach(child => visit(child, cell));
    };
    visit(tree, false);
  };
}
