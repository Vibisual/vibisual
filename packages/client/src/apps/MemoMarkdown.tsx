import { createContext, useContext, type InputHTMLAttributes, type JSX } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { clipboardBreaks } from '@vibisual/memo';

interface MemoMarkdownProps { text: string; onToggleTask?: (offset: number) => void }

const TaskToggle = createContext<((offset: number) => void) | null>(null);
/** 지금 그리는 목록 항목이 원문에서 시작하는 자리. 체크박스는 순번이 아니라 이 자리로 원문 표식을 찾는다. */
const TaskOffset = createContext<number | null>(null);

function TaskBox(props: InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  const toggle = useContext(TaskToggle);
  const offset = useContext(TaskOffset);
  if (props.type !== 'checkbox' || !toggle || offset === null) return <input {...props} disabled readOnly />;
  return <input type="checkbox" checked={!!props.checked} onChange={() => toggle(offset)} className="cursor-pointer accent-blue-500" />;
}

// 링크는 누를 수 없는 글자로 그린다: 메모 본문의 주소가 앱 창을 이동시키면 안 된다.
const components: Components = {
  a: ({ children }) => <span className="text-blue-300 underline decoration-blue-300/40 underline-offset-2">{children}</span>,
  // 원격 그림은 불러오지 않는다: 메모를 읽는 것만으로 기기 밖에 요청이 나가면 안 된다.
  img: ({ alt }) => (alt ? <span className="text-gray-400">{alt}</span> : null),
  li: ({ node, children, ...props }) => <li {...props}><TaskOffset.Provider value={node?.position?.start.offset ?? null}>{children}</TaskOffset.Provider></li>,
  input: ({ node: _node, ...props }) => <TaskBox {...props} />,
};
const plugins = [remarkGfm, clipboardBreaks];
const THEME = 'prose prose-sm max-w-none [--tw-prose-body:var(--color-gray-200)] [--tw-prose-headings:var(--color-gray-100)] [--tw-prose-links:var(--color-blue-300)] [--tw-prose-bold:var(--color-gray-100)] [--tw-prose-code:var(--color-gray-100)] [--tw-prose-quotes:var(--color-gray-300)] [--tw-prose-quote-borders:var(--color-gray-700)] [--tw-prose-bullets:var(--color-gray-500)] [--tw-prose-counters:var(--color-gray-500)] [--tw-prose-hr:var(--color-gray-800)] [--tw-prose-pre-bg:var(--color-gray-950)] [--tw-prose-pre-code:var(--color-gray-100)] [--tw-prose-th-borders:var(--color-gray-700)] [--tw-prose-td-borders:var(--color-gray-800)] prose-code:text-xs prose-pre:text-xs';

export function MemoMarkdown({ text, onToggleTask }: MemoMarkdownProps): JSX.Element {
  // 평문 한 줄마다 remark/GFM 트리를 만들지 않는다. 서식 가능성이 있으면 기존 렌더러가 맡는다.
  if (/^[\p{L}\p{N}][\p{L}\p{N}\p{Zs},.?!;()%-]*$/u.test(text) && !/^\d+[.)]\s|www\.|\s$/i.test(text)) return <div className={THEME}><p>{text}</p></div>;
  return <TaskToggle.Provider value={onToggleTask ?? null}><div className={THEME}><Markdown remarkPlugins={plugins} components={components}>{text}</Markdown></div></TaskToggle.Provider>;
}
