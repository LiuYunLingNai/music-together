import { useMemo } from 'react'
import { marked } from 'marked'
import { Card } from '../components/ui'
import apiMarkdown from '../docs/api.md?raw'

export default function DocsPage() {
  const html = useMemo(() => marked.parse(apiMarkdown) as string, [])

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-400 dark:text-zinc-500">Music Together 后端 REST 与 WebSocket 协议清单（由 Marked 渲染）</p>
      <Card>
        {/* api.md 为仓库内置文档，内容可信，直接渲染 */}
        <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
      </Card>
    </div>
  )
}
