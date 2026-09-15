/** Public development fixtures. These pages are never counted as holdout evidence. */
export function developmentPage(site: 'hn' | 'lobsters', dynamic = false): string {
  const links = ['/item?id=1', 'https://example.test/story-2', '/item?id=3']
  const items = links.map((href, index) => site === 'hn'
    ? `<tr class="athing"><td>${index + 1}</td><td class="titleline"><a href="${href}">Entry ${index + 1}</a></td></tr><tr><td></td><td class="meta">points and comments</td></tr>`
    : `<li class="story"><h2><a href="${href}">Entry ${index + 1}</a></h2><span class="tags">tag</span></li>`).join('')
  const content = site === 'hn' ? `<table id="feed"><tbody>${items}</tbody></table>` : `<ol id="feed">${items}</ol>`
  return `<!doctype html><meta charset="utf-8"><title>${site} development</title><main>${content}</main><aside><div class="story"><a href="/outside">Outside</a></div></aside>${dynamic ? `<script>
    document.addEventListener('fixture:append', () => {
      const root = document.querySelector('${site === 'hn' ? '#feed tbody' : '#feed'}');
      root.insertAdjacentHTML('beforeend', ${JSON.stringify(site === 'hn'
        ? '<tr class="athing"><td>4</td><td class="titleline"><a href="/new">Entry 4</a></td></tr>'
        : '<li class="story"><h2><a href="/new">Entry 4</a></h2></li>')});
    });
  </script>` : ''}`
}
