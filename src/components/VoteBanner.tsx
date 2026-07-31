import { Check, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { VoteAction } from '../domain/types'
import { castVote } from '../services/runtime'
import { useAppStore } from '../store/app-store'

const ACTION_LABELS: Record<VoteAction, string> = {
  pause: '暂停播放', resume: '继续播放', next: '播放下一首', prev: '播放上一首',
  'set-mode': '切换播放模式', 'play-track': '播放指定歌曲', 'remove-track': '移除歌曲',
}

export function VoteBanner() {
  const vote = useAppStore((state) => state.activeVote)
  const currentUserId = useAppStore((state) => state.currentUserId)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!vote) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 200)
    return () => window.clearInterval(timer)
  }, [vote])
  if (!vote) return null
  const approvals = Object.values(vote.votes).filter(Boolean).length
  const rejections = Object.values(vote.votes).filter((value) => !value).length
  const voted = currentUserId in vote.votes
  const remaining = Math.max(0, vote.expiresAt - now)
  const label = vote.action === 'play-track' || vote.action === 'remove-track'
    ? `${ACTION_LABELS[vote.action]}「${String(vote.payload?.trackTitle ?? '')}」`
    : ACTION_LABELS[vote.action]
  return (
    <div className="vote-banner" role="status">
      <div className="vote-copy"><strong>{vote.initiatorNickname} 发起投票：{label}</strong><span>{approvals}/{vote.requiredVotes} 赞成 · {rejections} 反对 · {Math.ceil(remaining / 1000)} 秒</span></div>
      <div className="vote-progress"><span style={{ width: `${Math.min(100, remaining / 300)}%` }} /></div>
      {voted ? <span className="vote-complete">已投票</span> : <div className="vote-actions"><button title="赞成" onClick={() => castVote(true)}><Check size={15} /></button><button title="反对；房主反对将直接否决" onClick={() => castVote(false)}><X size={15} /></button></div>}
    </div>
  )
}
