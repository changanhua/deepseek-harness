const appendText = (parent, value) => parent.append(document.createTextNode(value))

const appendInline = (parent, value) => {
  let offset = 0
  const token = /\\([\\`*_[\]()])|`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g
  for (const match of value.matchAll(token)) {
    appendText(parent, value.slice(offset, match.index))
    if (match[1] !== undefined) {
      appendText(parent, match[1])
    } else if (match[2] !== undefined) {
      const code = document.createElement('code')
      code.textContent = match[2]
      parent.append(code)
    } else if (match[3] !== undefined) {
      const strong = document.createElement('strong')
      strong.textContent = match[3]
      parent.append(strong)
    } else {
      const link = document.createElement('a')
      link.textContent = match[4]
      link.href = match[5]
      link.target = '_blank'
      link.rel = 'noreferrer'
      parent.append(link)
    }
    offset = match.index + match[0].length
  }
  appendText(parent, value.slice(offset))
}

const paragraph = (value, tag = 'p') => {
  const node = document.createElement(tag)
  appendInline(node, value)
  return node
}

/** Render the capture Markdown without parsing capture text as HTML. */
export const renderMarkdown = (container, markdown) => {
  container.replaceChildren()
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n')
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) { index += 1; continue }
    if (line.startsWith('```')) {
      const code = []
      index += 1
      while (index < lines.length && !lines[index].startsWith('```')) code.push(lines[index++])
      if (index < lines.length) index += 1
      const pre = document.createElement('pre')
      const node = document.createElement('code')
      node.textContent = code.join('\n')
      pre.append(node)
      container.append(pre)
      continue
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line)
    if (heading) { container.append(paragraph(heading[2], `h${heading[1].length}`)); index += 1; continue }
    if (line.startsWith('> ')) {
      const quote = document.createElement('blockquote')
      appendInline(quote, line.slice(2))
      container.append(quote)
      index += 1
      continue
    }
    if (/^[-*]\s+/.test(line)) {
      const list = document.createElement('ul')
      while (index < lines.length && /^[-*]\s+/.test(lines[index])) {
        const item = document.createElement('li')
        appendInline(item, lines[index].replace(/^[-*]\s+/, ''))
        list.append(item)
        index += 1
      }
      container.append(list)
      continue
    }
    if (/^\d+\.\s+/.test(line)) {
      const list = document.createElement('ol')
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        const item = document.createElement('li')
        appendInline(item, lines[index].replace(/^\d+\.\s+/, ''))
        list.append(item)
        index += 1
      }
      container.append(list)
      continue
    }
    const values = [line]
    index += 1
    while (index < lines.length && lines[index].trim() && !/^(#{1,3}\s|```|> |[-*]\s+|\d+\.\s+)/.test(lines[index])) values.push(lines[index++])
    container.append(paragraph(values.join(' ')))
  }
}
