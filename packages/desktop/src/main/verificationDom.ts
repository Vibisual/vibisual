/** Fixed app-owned code only. User text/selectors are passed as JSON data, never evaluated as code. */
export function verificationDomScript(request: { operation: 'snapshot' | 'locate' | 'editable' | 'check'; selector?: string; kind?: string; expected?: string; limit?: number }): string {
  return `(() => {
    const request = ${JSON.stringify(request)};
    const rendered = element => {
      const box = element.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) return false;
      for (let node = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.contentVisibility === 'hidden' || Number(style.opacity) === 0) return false;
      }
      return true;
    };
    const visibleBounds = element => {
      if (!rendered(element)) return null;
      const box = element.getBoundingClientRect();
      let left = Math.max(0,box.left), top = Math.max(0,box.top), right = Math.min(innerWidth,box.right), bottom = Math.min(innerHeight,box.bottom);
      for (let node = element.parentElement; node; node = node.parentElement) {
        const style = getComputedStyle(node), bounds = node.getBoundingClientRect();
        if (['hidden','clip','scroll','auto'].includes(style.overflowX)) { left = Math.max(left,bounds.left); right = Math.min(right,bounds.right); }
        if (['hidden','clip','scroll','auto'].includes(style.overflowY)) { top = Math.max(top,bounds.top); bottom = Math.min(bottom,bounds.bottom); }
      }
      return right > left && bottom > top ? {left,top,right,bottom} : null;
    };
    const visible = element => {
      const box = visibleBounds(element); if (!box) return false;
      const hit = document.elementFromPoint((box.left+box.right)/2,(box.top+box.bottom)/2);
      return hit === element || element.contains(hit);
    };
    const selectable = selector => {
      const matches = [...document.querySelectorAll(selector)].filter(rendered);
      if (matches.length !== 1) throw new Error('Expected exactly one visible match; got ' + matches.length);
      return matches[0];
    };
    const selectorFor = element => {
      if (element.id && document.querySelectorAll('#' + CSS.escape(element.id)).length === 1) return '#' + CSS.escape(element.id);
      const path = [];
      let node = element;
      while (node && node !== document.documentElement) {
        let index = 1, previous = node.previousElementSibling;
        while (previous) { if (previous.localName === node.localName) index++; previous = previous.previousElementSibling; }
        path.unshift(node.localName + ':nth-of-type(' + index + ')'); node = node.parentElement;
      }
      return 'html > ' + path.join(' > ');
    };
    const nameFor = element => element.getAttribute('aria-label') || [...(element.getAttribute('aria-labelledby') || '').split(' ')].map(id => document.getElementById(id)?.textContent || '').join(' ').trim() || [...(element.labels || [])].map(label => label.textContent).join(' ') || element.getAttribute('placeholder') || element.getAttribute('title') || element.innerText || element.getAttribute('alt') || '';
    const roleFor = element => element.getAttribute('role') || ({button:'button',a:'link',textarea:'textbox',select:'combobox',input:element.type === 'checkbox' ? 'checkbox' : element.type === 'radio' ? 'radio' : ['button','submit','reset'].includes(element.type) ? 'button' : 'textbox',iframe:'iframe'})[element.localName] || element.localName;
    const visibleText = element => {
      const parts = [], walker = document.createTreeWalker(element,NodeFilter.SHOW_TEXT);
      const maxCharacters = 20000, maxTextNodes = 10000;
      let characters = 0, visited = 0;
      let text;
      while (characters < maxCharacters && visited++ < maxTextNodes && (text=walker.nextNode())) {
        const parent = text.parentElement, value = text.textContent || '';
        if (!parent || !value.trim()) continue;
        const bounds = visibleBounds(parent); if (!bounds) continue;
        const range = document.createRange(); range.selectNodeContents(text);
        const onscreen = rect => {
          const left = Math.max(rect.left,bounds.left), right = Math.min(rect.right,bounds.right), top = Math.max(rect.top,bounds.top), bottom = Math.min(rect.bottom,bounds.bottom);
          if (right <= left || bottom <= top) return false;
          const hit = document.elementFromPoint((left+right)/2,(top+bottom)/2);
          return hit === parent || parent.contains(hit);
        };
        const rects = [...range.getClientRects()];
        if (!rects.some(onscreen)) continue;
        const complete = rects.every(rect => rect.left >= bounds.left && rect.right <= bounds.right && rect.top >= bounds.top && rect.bottom <= bounds.bottom && onscreen(rect));
        if (complete) { parts.push(value.slice(0,maxCharacters-characters)); characters += value.length; continue; }
        // A long text node can straddle the viewport; do not include its invisible suffix.
        let fragment = '';
        for (let i=0; i<value.length && characters<maxCharacters; i++,characters++) {
          range.setStart(text,i); range.setEnd(text,i+1);
          fragment += [...range.getClientRects()].some(onscreen) ? value[i] : ' ';
        }
        parts.push(fragment);
      }
      return parts.join(' ').replace(/\\s+/g,' ').trim();
    };
    if (request.operation === 'snapshot') {
      const elements = [...document.querySelectorAll('button,a,input,textarea,select,[role],[contenteditable=true],iframe')].filter(visible).slice(0, request.limit).map(element => {
        const box = element.getBoundingClientRect();
        return { selector:selectorFor(element), role:roleFor(element), name:nameFor(element).trim().slice(0,200), ...(typeof element.value === 'string' && element.type !== 'password' ? {value:element.value.slice(0,200)} : {}), rect:{x:box.x/innerWidth,y:box.y/innerHeight,width:box.width/innerWidth,height:box.height/innerHeight} };
      });
      return { elements, width:innerWidth, height:innerHeight };
    }
    if (request.operation === 'check') {
      if (request.kind === 'visible') {
        const matches = [...document.querySelectorAll(request.selector)].filter(visible);
        return {passed:matches.length === 1,detail:'Visible matches: ' + matches.length};
      }
      const element = request.selector ? selectable(request.selector) : document.body;
      if (request.selector && !visible(element)) return {passed:false,detail:'The checked target is outside the visible viewport, clipped, or covered.'};
      if (request.kind === 'value') {
        if (!request.selector || typeof element.value !== 'string') throw new Error('A value check needs a form field selector.');
        return {passed:element.value === request.expected,detail:element.type === 'password' ? 'Password field equality checked (value hidden).' : 'Actual value: ' + element.value.slice(0,300)};
      }
      const actual = visibleText(element);
      return {passed:actual.includes(request.expected.replace(/\\s+/g,' ').trim()),detail:'Actual visible text: ' + actual.slice(0,300)};
    }
    const element = request.selector ? selectable(request.selector) : document.activeElement;
    if (!element || !rendered(element)) throw new Error('No visible target field.');
    if (element.disabled || element.getAttribute('aria-disabled') === 'true' || element.closest('[inert]')) throw new Error('The target is disabled.');
    if (request.operation === 'editable') {
      if (element.readOnly || (!element.isContentEditable && !['input','textarea'].includes(element.localName)) || (element.localName === 'input' && ['button','submit','reset','checkbox','radio','file','hidden'].includes(element.type))) throw new Error('The target is not an editable text field.');
      element.focus();
      if (document.activeElement !== element) throw new Error('The input field did not receive focus.');
    }
    element.scrollIntoView({block:'center',inline:'center',behavior:'instant'});
    const box = element.getBoundingClientRect();
    const x = Math.min(innerWidth - 1, Math.max(0, box.x + box.width / 2)), y = Math.min(innerHeight - 1, Math.max(0, box.y + box.height / 2));
    const hit = document.elementFromPoint(x,y);
    if (hit !== element && !element.contains(hit)) throw new Error('The target is covered by another element.');
    return {x,y};
  })()`;
}
