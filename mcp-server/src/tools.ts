import fs from 'node:fs/promises'
import path from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

async function getAllMdFiles(dir: string): Promise<string[]> {
  const results: string[] = []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...await getAllMdFiles(full))
    } else if (entry.name.endsWith('.md')) {
      results.push(full)
    }
  }
  return results
}

function normalizePath(vaultDir: string, notePath: string): string {
  const p = notePath.endsWith('.md') ? notePath : `${notePath}.md`
  // Prevent path traversal
  const resolved = path.resolve(vaultDir, p)
  if (!resolved.startsWith(vaultDir + path.sep) && resolved !== vaultDir) {
    throw new Error('Invalid path')
  }
  return resolved
}

export function registerTools(server: McpServer, vaultDir: string): void {
  server.tool(
    'note_read',
    'Read a note from the vault. Returns the full markdown content.',
    { path: z.string().describe('Note path relative to vault root, e.g. "Ideas/Project-X" (without .md)') },
    async ({ path: notePath }) => {
      const full = normalizePath(vaultDir, notePath)
      const content = await fs.readFile(full, 'utf-8').catch(() => null)
      if (content === null) return { content: [{ type: 'text' as const, text: `Note not found: ${notePath}` }], isError: true }
      return { content: [{ type: 'text' as const, text: content }] }
    },
  )

  server.tool(
    'note_search',
    'Search notes by keyword. Returns matching snippets and paths — not full file contents.',
    {
      query: z.string().describe('Search term (case-insensitive)'),
      limit: z.number().int().min(1).max(50).default(10).describe('Max results to return'),
    },
    async ({ query, limit }) => {
      const files = await getAllMdFiles(vaultDir)
      const lower = query.toLowerCase()
      const hits: { path: string; snippet: string }[] = []

      for (const file of files) {
        if (hits.length >= limit) break
        const content = await fs.readFile(file, 'utf-8').catch(() => '')
        const idx = content.toLowerCase().indexOf(lower)
        if (idx === -1) continue
        const start = Math.max(0, idx - 60)
        const end = Math.min(content.length, idx + query.length + 60)
        const snippet =
          (start > 0 ? '…' : '') + content.slice(start, end).replace(/\n/g, ' ') + (end < content.length ? '…' : '')
        hits.push({ path: path.relative(vaultDir, file).replace(/\.md$/, ''), snippet })
      }

      if (hits.length === 0) return { content: [{ type: 'text' as const, text: 'No results found.' }] }
      const text = hits.map(h => `**${h.path}**\n${h.snippet}`).join('\n\n---\n\n')
      return { content: [{ type: 'text' as const, text: text }] }
    },
  )

  server.tool(
    'note_upsert',
    'Create or update a note. Pass the complete markdown content including frontmatter. ' +
      'For new notes use frontmatter with type, tags, related_to. ' +
      'Writes to vault-mirror and syncs back to Obsidian via the bridge.',
    {
      path: z.string().describe('Note path relative to vault root, e.g. "Ideas/Project-X" (without .md)'),
      content: z.string().describe('Full markdown content of the note, including frontmatter'),
    },
    async ({ path: notePath, content }) => {
      const full = normalizePath(vaultDir, notePath)
      await fs.mkdir(path.dirname(full), { recursive: true })
      await fs.writeFile(full, content, 'utf-8')
      return { content: [{ type: 'text' as const, text: `Saved: ${notePath}` }] }
    },
  )

  server.tool(
    'note_list',
    'List all notes in the vault (paths only, no content).',
    { prefix: z.string().optional().describe('Optional path prefix to filter, e.g. "Projects/"') },
    async ({ prefix }) => {
      const files = await getAllMdFiles(vaultDir)
      let paths = files.map(f => path.relative(vaultDir, f).replace(/\.md$/, ''))
      if (prefix) paths = paths.filter(p => p.startsWith(prefix))
      return { content: [{ type: 'text' as const, text: paths.join('\n') || '(empty)' }] }
    },
  )
}
